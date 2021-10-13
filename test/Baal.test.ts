import { ethers } from 'hardhat'
import { solidity } from 'ethereum-waffle'
import { use, expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from '@ethersproject/bignumber'
import { ContractFactory } from '@ethersproject/contracts'

import { Baal } from '../src/types/Baal'
import { SafeBaalSummoner } from '../src/types/SafeBaalSummoner'
import { TestErc20 } from '../src/types/TestErc20'
import { RageQuitBank } from '../src/types/RageQuitBank'
import { MultiSend } from '../src/types/MultiSend'
import { GnosisSafe } from '../src/types/GnosisSafe'
import { CompatibilityFallbackHandler } from '../src/types/CompatibilityFallbackHandler'
import { encodeMultiAction, generateNonce } from '../src/util'

use(solidity)

// chai
//   .use(require('chai-as-promised'))
//   .should();

const revertMessages = {
  molochConstructorShamanCannotBe0: 'shaman cannot be 0',
  molochConstructorGuildTokenCannotBe0: 'guildToken cannot be 0',
  molochConstructorSummonerCannotBe0: 'summoner cannot be 0',
  molochConstructorSharesCannotBe0: 'shares cannot be 0',
  molochConstructorMinVotingPeriodCannotBe0: 'minVotingPeriod cannot be 0',
  molochConstructorMaxVotingPeriodCannotBe0: 'maxVotingPeriod cannot be 0',
  submitProposalVotingPeriod: '!votingPeriod',
  submitProposalArrays: '!array parity',
  submitProposalArrayMax: 'array max',
  submitProposalFlag: '!flag',
  submitVoteTimeEnded: 'ended',
  proposalMisnumbered: '!exist',
}

const zeroAddress = '0x0000000000000000000000000000000000000000'

async function blockTime() {
  const block = await ethers.provider.getBlock('latest')
  return block.timestamp
}

async function blockNumber() {
  const block = await ethers.provider.getBlock('latest')
  return block.number
}

async function moveForwardPeriods(periods: number) {
  const goToTime = deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS * periods
  await ethers.provider.send('evm_increaseTime', [goToTime])
  return true
}

const deploymentConfig = {
  GRACE_PERIOD_IN_SECONDS: 43200,
  MIN_VOTING_PERIOD_IN_SECONDS: 172800,
  MAX_VOTING_PERIOD_IN_SECONDS: 432000,
  TOKEN_NAME: 'wrapped ETH',
  TOKEN_SYMBOL: 'WETH',
}

describe('Baal contract', function () {
  let BaalContract: ContractFactory
  let BaalSummonerContract: ContractFactory
  let GnosisSafeContract: ContractFactory
  let CompatibilityFallbackHandler: ContractFactory
  let MultisendContract: ContractFactory
  let ShamanContract: ContractFactory
  let ERC20: ContractFactory

  let baal: Baal
  let baalSingleton: Baal
  let baalSummoner: SafeBaalSummoner
  let weth: TestErc20
  let shaman: RageQuitBank

  let gnosisSafeSingleton: GnosisSafe
  let multisend: MultiSend
  let compatibilityFallbackHandler: CompatibilityFallbackHandler

  let applicant: SignerWithAddress
  let summoner: SignerWithAddress

  let proposal: { [key: string]: any }

  const loot = 500
  const shares = 100
  const sharesPaused = false
  const lootPaused = false

  const yes = true
  const no = false

  this.beforeAll(async function () {
    BaalContract = await ethers.getContractFactory('Baal')
    BaalSummonerContract = await ethers.getContractFactory('SafeBaalSummoner')
    GnosisSafeContract = await ethers.getContractFactory('GnosisSafe')
    CompatibilityFallbackHandler = await ethers.getContractFactory('CompatibilityFallbackHandler')
    MultisendContract = await ethers.getContractFactory('MultiSend')
    ShamanContract = await ethers.getContractFactory('RageQuitBank')
    ERC20 = await ethers.getContractFactory('TestERC20')
    ;[summoner, applicant] = await ethers.getSigners()

    gnosisSafeSingleton = (await GnosisSafeContract.deploy()) as GnosisSafe
    multisend = (await MultisendContract.deploy()) as MultiSend
    compatibilityFallbackHandler = (await CompatibilityFallbackHandler.deploy()) as CompatibilityFallbackHandler

    baalSingleton = (await BaalContract.deploy()) as Baal

    baalSummoner = (await BaalSummonerContract.deploy(
      baalSingleton.address,
      gnosisSafeSingleton.address,
      compatibilityFallbackHandler.address,
      multisend.address
    )) as SafeBaalSummoner
  })

  beforeEach(async function () {
    weth = (await ERC20.deploy('WETH', 'WETH', 10000000)) as TestErc20

    shaman = (await ShamanContract.deploy()) as RageQuitBank

    const abiCoder = ethers.utils.defaultAbiCoder

    const periods = abiCoder.encode(
      ['uint32', 'uint32', 'uint32', 'bool', 'bool'],
      [
        deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS,
        deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS,
        deploymentConfig.GRACE_PERIOD_IN_SECONDS,
        lootPaused,
        sharesPaused,
      ]
    )

    const setPeriods = await baalSingleton.interface.encodeFunctionData('setPeriods', [periods])
    const setGuildTokens = await baalSingleton.interface.encodeFunctionData('setGuildTokens', [[weth.address]])
    const setShaman = await baalSingleton.interface.encodeFunctionData('setShamans', [[shaman.address], true])
    const mintShares = await baalSingleton.interface.encodeFunctionData('mintShares', [[summoner.address], [shares]])
    const mintLoot = await baalSingleton.interface.encodeFunctionData('mintLoot', [[summoner.address], [loot]])
    const delegateSummoners = await baalSingleton.interface.encodeFunctionData('delegateSummoners', [[summoner.address], [summoner.address]])

    const initalizationActions = [setPeriods, setGuildTokens, setShaman, mintShares, mintLoot, delegateSummoners]
    // encodeMultiAction(
    //   multisend,
    //   [setPeriods, setGuildTokens, setShaman, mintShares, mintLoot, delegateSummoners],
    //   [baal.address, baal.address, baal.address, baal.address, baal.address, baal.address],
    //   [BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0)],
    //   [0, 0, 0, 0, 0, 0]
    // )


    const salt = await generateNonce()
    await baalSummoner.SummonBaalAndSafe('rise', '0x' + salt, deploymentConfig.TOKEN_NAME, deploymentConfig.TOKEN_SYMBOL, initalizationActions)

    const newBaalCount = (await baalSummoner.baalCount()).toNumber()
    const newBaalAddress = await baalSummoner.baalList(newBaalCount - 1)
    baal = (await BaalContract.attach(newBaalAddress)) as Baal

    await shaman.init(baal.address)

    const selfTransferAction = encodeMultiAction(multisend, ['0x'], [baal.address], [BigNumber.from(0)], [0])

    proposal = {
      flag: 0,
      votingPeriod: 175000,
      account: summoner.address,
      data: selfTransferAction,
      details: 'all hail baal',
    }
  })

  describe('constructor', function () {
    it('verify deployment parameters', async function () {
      const now = await blockTime()

      const decimals = await baal.decimals()
      expect(decimals).to.equal(18)

      const gracePeriod = await baal.gracePeriod()
      expect(gracePeriod).to.equal(deploymentConfig.GRACE_PERIOD_IN_SECONDS)

      const minVotingPeriod = await baal.minVotingPeriod()
      expect(minVotingPeriod).to.equal(deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS)

      const maxVotingPeriod = await baal.maxVotingPeriod()
      expect(maxVotingPeriod).to.equal(deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS)

      const name = await baal.name()
      expect(name).to.equal(deploymentConfig.TOKEN_NAME)

      const symbol = await baal.symbol()
      expect(symbol).to.equal(deploymentConfig.TOKEN_SYMBOL)

      const lootPaused = await baal.lootPaused()
      expect(lootPaused).to.be.false

      const sharesPaused = await baal.sharesPaused()
      expect(sharesPaused).to.be.false

      const shamans = await baal.shamans(shaman.address)
      expect(shamans).to.be.true

      const guildTokens = await baal.getGuildTokens()
      expect(guildTokens[0]).to.equal(weth.address)

      const summonerData = await baal.members(summoner.address)
      expect(summonerData.loot).to.equal(500)
      expect(summonerData.highestIndexYesVote).to.equal(0)

      const totalLoot = await baal.totalLoot()
      expect(totalLoot).to.equal(500)
    })
  })

  describe('memberAction', function () {
    it('happy case - verify loot', async function () {
      await baal.memberAction(shaman.address, loot / 2, shares / 2, true)
      const lootData = await baal.members(summoner.address)
      expect(lootData.loot).to.equal(1000)
    })

    it('happy case - verify shares', async function () {
      await baal.memberAction(shaman.address, loot / 2, shares / 2, true)
      const sharesData = await baal.balanceOf(summoner.address)
      expect(sharesData).to.equal(200)
    })
  })

  describe('submitProposal', function () {
    it('happy case', async function () {
      const countBefore = await baal.proposalCount()

      await baal.submitProposal(proposal.votingPeriod, proposal.data, ethers.utils.id(proposal.details))

      const countAfter = await baal.proposalCount()
      expect(countAfter).to.equal(countBefore.add(1))
    })

    it('require fail - voting period too low', async function () {
      expect(
        baal.submitProposal(deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS - 100, proposal.data, ethers.utils.id(proposal.details))
      ).to.be.revertedWith(revertMessages.submitProposalVotingPeriod)
    })

    it('require fail - voting period too high', async function () {
      expect(
        baal.submitProposal(deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS + 100, proposal.data, ethers.utils.id(proposal.details))
      ).to.be.revertedWith(revertMessages.submitProposalVotingPeriod)
    })
  })

  describe('submitVote', function () {
    beforeEach(async function () {
      await baal.submitProposal(proposal.votingPeriod, proposal.data, ethers.utils.id(proposal.details))
    })

    it('happy case - yes vote', async function () {
      await baal.submitVote(1, yes)
      const prop = await baal.proposals(1)
      const nCheckpoints = await baal.numCheckpoints(summoner.address)
      const votes = (await baal.checkpoints(summoner.address, nCheckpoints)).votes
      expect(prop.yesVotes).to.equal(votes)
    })

    it('happy case - no vote', async function () {
      await baal.submitVote(1, no)
      const prop = await baal.proposals(1)
      const nCheckpoints = await baal.numCheckpoints(summoner.address)
      const votes = (await baal.checkpoints(summoner.address, nCheckpoints)).votes
      expect(prop.noVotes).to.equal(votes)
    })

    it('require fail - voting period has ended', async function () {
      await moveForwardPeriods(2)
      expect(baal.submitVote(1, no)).to.be.revertedWith(revertMessages.submitVoteTimeEnded)
    })
  })

  describe('processProposal', function () {
    it('happy case yes wins', async function () {
      const beforeProcessed = await baal.proposals(1)
      await baal.submitProposal(proposal.votingPeriod, proposal.data, ethers.utils.id(proposal.details))
      await baal.submitVote(1, yes)
      await moveForwardPeriods(2)
      await baal.processProposal(1)
      const afterProcessed = await baal.proposals(1)
      expect(afterProcessed).to.deep.equal(beforeProcessed)
    })

    it('happy case no wins', async function () {
      const beforeProcessed = await baal.proposals(1)
      await baal.submitProposal(proposal.votingPeriod, proposal.data, ethers.utils.id(proposal.details))
      await baal.submitVote(1, no)
      await moveForwardPeriods(2)
      await baal.processProposal(1)
      const afterProcessed = await baal.proposals(1)
      expect(afterProcessed).to.deep.equal(beforeProcessed)
    })

    it('require fail - proposal does not exist', async function () {
      await baal.submitProposal(proposal.votingPeriod, proposal.data, ethers.utils.id(proposal.details))
      await baal.submitVote(1, yes)
      expect(baal.processProposal(2)).to.be.revertedWith('!exist')
    })

    it('require fail - voting period has not ended', async function () {
      await baal.submitProposal(proposal.votingPeriod, proposal.data, ethers.utils.id(proposal.details))
      await baal.submitVote(1, yes)
      await baal.submitProposal(proposal.votingPeriod, proposal.data, ethers.utils.id(proposal.details))
      await baal.submitVote(2, yes)
      await moveForwardPeriods(2)
      expect(baal.processProposal(2)).to.be.revertedWith('prev!processed')
    })
  })

  describe('ragequit', function () {
    beforeEach(async function () {
      await baal.submitProposal(proposal.votingPeriod, proposal.data, ethers.utils.id(proposal.details))
    })

    it('happy case - full ragequit', async function () {
      const lootBefore = (await baal.members(summoner.address)).loot
      await baal.ragequit(summoner.address, loot, shares)
      const lootAfter = (await baal.members(summoner.address)).loot
      expect(lootAfter).to.equal(lootBefore.sub(loot))
    })

    it('happy case - partial ragequit', async function () {
      const lootBefore = (await baal.members(summoner.address)).loot
      const lootToBurn = 200
      const sharesToBurn = 70
      await baal.ragequit(summoner.address, lootToBurn, sharesToBurn)
      const lootAfter = (await baal.members(summoner.address)).loot
      expect(lootAfter).to.equal(lootBefore.sub(lootToBurn))
    })

    it('require fail - proposal voting has not ended', async function () {
      const lootBefore = (await baal.members(summoner.address)).loot
      await baal.submitVote(1, yes)
      expect(baal.ragequit(summoner.address, loot, shares)).to.be.revertedWith('processed')
    })
  })

  describe('getCurrentVotes', function () {
    it('happy case - account with votes', async function () {
      const currentVotes = await baal.getCurrentVotes(summoner.address)
      const nCheckpoints = await baal.numCheckpoints(summoner.address)
      const checkpoints = await baal.checkpoints(summoner.address, nCheckpoints.sub(1))
      const votes = checkpoints.votes
      expect(currentVotes).to.equal(votes)
    })

    it('happy case - account without votes', async function () {
      const currentVotes = await baal.getCurrentVotes(shaman.address)
      expect(currentVotes).to.equal(0)
    })
  })

  describe('getPriorVotes', function () {
    beforeEach(async function () {
      await baal.submitProposal(proposal.votingPeriod, proposal.data, ethers.utils.id(proposal.details))
    })

    it('happy case - yes vote', async function () {
      const blockT = await blockTime()
      await baal.submitVote(1, yes)
      const priorVote = await baal.getPriorVotes(summoner.address, blockT)
      const nCheckpoints = await baal.numCheckpoints(summoner.address)
      const votes = (await baal.checkpoints(summoner.address, nCheckpoints.sub(1))).votes
      expect(priorVote).to.equal(votes)
    })

    it('happy case - no vote', async function () {
      const blockT = await blockTime()
      await baal.submitVote(1, no)
      const priorVote = await baal.getPriorVotes(summoner.address, blockT)
      const nCheckpoints = await baal.numCheckpoints(summoner.address)
      const votes = (await baal.checkpoints(summoner.address, nCheckpoints.sub(1))).votes
      expect(priorVote).to.equal(votes)
    })

    it('require fail - timestamp not determined', async function () {
      const blockT = await blockTime()
      expect(baal.getPriorVotes(summoner.address, blockT)).to.be.revertedWith('!determined')
    })
  })
})
