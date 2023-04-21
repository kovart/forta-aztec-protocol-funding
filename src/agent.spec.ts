import BigNumber from 'bignumber.js';
import { BigNumberish, ethers } from 'ethers';
import { createAddress } from 'forta-agent-tools';
import { TestTransactionEvent } from 'forta-agent-tools/lib/test';
import { BotAnalytics } from 'forta-bot-analytics';
import { HandleTransaction, Network } from 'forta-agent';
import { BotConfig, DataContainer } from './types';
import { Logger, LoggerLevel } from './logger';
import {
  createInteractionFinding,
  createFundingFinding,
  FUNDING_ALERT_ID,
  FUNDED_ACCOUNT_INTERACTION_ALERT_ID,
  createDeploymentFinding, FUNDED_ACCOUNT_DEPLOYMENT_ALERT_ID,
} from './findings';
import agent from './agent';

const { provideInitialize, provideHandleTransaction } = agent;

describe('Forta agent', () => {
  describe('initialize()', () => {
    it('should initialize properly', async () => {
      const data: DataContainer = {} as any;
      const logger = new Logger();
      const network = Network.MAINNET;
      const provider = new ethers.providers.JsonRpcProvider('');
      // make the agent think we are in the target network
      provider.getNetwork = async () => ({
        chainId: network.valueOf(),
        name: Network[network],
      });
      const [aztecAddress1, aztecAddress2] = [createAddress('0x1'), createAddress('0x2')];
      const config: BotConfig = {
        addressLimit: 10000,
        aztecAddressesByChainId: { [network]: [aztecAddress1, aztecAddress2] },
        developerAbbreviation: 'TEST',
        defaultAnomalyScore: {
          funding: 0.123,
          interaction: 0.321,
          deployment: 0.222,
        },
      };
      const initialize = provideInitialize(data, config, provider, logger, false);

      await initialize();

      expect(data.isInitialized).toStrictEqual(true);
      expect(data.isDevelopment).toStrictEqual(false);
      expect(data.chainId).toStrictEqual(network);
      expect(data.analytics).toBeInstanceOf(BotAnalytics);
      expect(data.findings).toStrictEqual([]);
      expect(data.aztecAddresses).toEqual(expect.arrayContaining([aztecAddress1, aztecAddress2]));
      expect(data.logger).toStrictEqual(logger);
      expect(data.provider).toStrictEqual(provider);
    });
  });

  describe('handleTransaction()', () => {
    jest.setTimeout(25000);

    let mockData: DataContainer;
    let mockProvider: jest.MockedObject<ethers.providers.JsonRpcProvider>;

    const bytecodeByAddress = new Map<string, string>();
    const storageByAddress = new Map<string, string[]>();

    let handleTransaction: HandleTransaction;

    const aztecAddress = createAddress('0x2222');
    const invokerAddress = createAddress('0x1111');
    const someContractAddress = createAddress('0x00ff');

    const defaultNetwork = Network.MAINNET;
    const defaultBotConfig: BotConfig = {
      developerAbbreviation: 'TEST',
      aztecAddressesByChainId: { [defaultNetwork]: [aztecAddress] },
      addressLimit: 10000,
      defaultAnomalyScore: {
        funding: 0.123,
        interaction: 0.321,
        deployment: 0.222,
      },
    };

    // mock getCode so that agent knows whether the address is a contract or not
    function mockContractAddresses(...addresses: string[]) {
      for (const address of addresses) {
        bytecodeByAddress.set(address, '0xff');
      }
    }

    function mockContractDeployment(
      tx: TestTransactionEvent,
      deployer: string,
      contractAddress: string,
      storageContracts: string[] = [],
      opcodeContracts: string[] = [],
    ) {
      tx.traces.push({
        type: 'create',
        blockNumber: 0,
        traceAddress: [],
        subtraces: 0,
        transactionHash: '0x',
        transactionPosition: 0,
        error: '',
        blockHash: '0x',
        action: {
          from: deployer,
          to: '',
        } as any,
        result: {
          address: contractAddress,
        } as any,
      });

      if (storageContracts.length > 0) {
        storageByAddress.set(
          contractAddress,
          storageContracts.map((c, i) =>
            i % 2 == 0 ? '0x' + c.slice(2).padStart(64, '0') : c.padEnd(66, '0'),
          ),
        );
      }
      if (opcodeContracts.length > 0) {
        bytecodeByAddress.set(
          contractAddress,
          '0x' + opcodeContracts.map((c) => `73${c.slice(2)}`).join(''),
        );
      }
    }

    beforeEach(async () => {
      mockData = {} as any;
      mockProvider = {
        getCode: jest.fn(),
        getStorageAt: jest.fn(),
        getNetwork: jest.fn().mockImplementation(async () => ({
          chainId: defaultNetwork.valueOf(),
          name: Network[defaultNetwork],
        })),
      } as any;

      bytecodeByAddress.clear();
      storageByAddress.clear();

      handleTransaction = provideHandleTransaction(mockData);

      await provideInitialize(
        mockData,
        defaultBotConfig,
        mockProvider,
        new Logger(LoggerLevel.ERROR),
        true,
      )();

      mockProvider.getCode.mockImplementation(async (address) => {
        return bytecodeByAddress.get(await address) || '0x';
      });

      mockProvider.getStorageAt.mockImplementation(async (address, position) => {
        return (
          storageByAddress.get(await address)?.[Number(position.toString())] ||
          ethers.constants.HashZero
        );
      });

      mockContractAddresses(aztecAddress, someContractAddress);
    });

    it('returns empty findings if there was no funding from the service', async () => {
      let tx, findings;
      const nonAztecContractAddress = createAddress('0xAAAFFF');
      const fundedAddress = createAddress('0xaaaa');

      mockContractAddresses(nonAztecContractAddress);

      // funding from some non-Aztec service
      tx = new TestTransactionEvent();
      tx.setFrom(invokerAddress);
      tx.setTo(nonAztecContractAddress);
      tx.addTraces({
        from: nonAztecContractAddress,
        to: fundedAddress,
        value: ethers.utils.parseEther('0.5').toHexString(),
      });
      findings = await handleTransaction(tx);

      expect(findings).toStrictEqual([]);

      // contract interaction
      tx = new TestTransactionEvent();
      tx.setFrom(fundedAddress);
      tx.setTo(someContractAddress);
      findings = await handleTransaction(tx);

      expect(findings).toStrictEqual([]);
    });

    it('returns a finding if the service funded an account', async () => {
      const fundedAddress = createAddress('0xaaaa');
      const fundedValue = new BigNumber(ethers.utils.parseEther('0.5').toString());

      // funding from Aztec contract
      const tx = new TestTransactionEvent();
      tx.setFrom(invokerAddress);
      tx.setTo(aztecAddress);
      tx.addTraces({
        from: aztecAddress,
        to: fundedAddress,
        value: fundedValue.toString(16),
      });

      const findings = await handleTransaction(tx);

      expect(findings).toStrictEqual([
        createFundingFinding(
          tx.hash,
          fundedAddress,
          fundedValue,
          defaultNetwork,
          defaultBotConfig.defaultAnomalyScore.funding,
        ),
      ]);
    });

    it('returns a finding if an account was funded and then interacted with a contract', async () => {
      const fundedAddress = createAddress('0xaaaa');

      // funding from Aztec contract
      let tx = new TestTransactionEvent();
      tx.setFrom(invokerAddress);
      tx.setTo(aztecAddress);
      tx.addTraces({
        from: aztecAddress,
        to: fundedAddress,
        value: ethers.utils.parseEther('0.5').toHexString(),
      });

      await handleTransaction(tx);

      // interaction with some contract
      tx = new TestTransactionEvent();
      tx.setFrom(fundedAddress);
      tx.setTo(someContractAddress);
      const findings = await handleTransaction(tx);

      expect(findings).toStrictEqual([
        createInteractionFinding(tx, defaultBotConfig.defaultAnomalyScore.interaction),
      ]);
    });

    it('returns a finding if an account was funded and then created a contract', async () => {
      const fundedAddress = createAddress('0xaaaa');
      const regularAddress = createAddress('0xbbbb');
      const createdContract0 = createAddress('0xff0');
      const createdContract1 = createAddress('0xff1');
      const createdContract2 = createAddress('0xff2');
      const createdContract3 = createAddress('0xff3');
      const createdContract4 = createAddress('0xff4');

      // funding from Aztec contract
      let tx = new TestTransactionEvent();
      tx.setFrom(invokerAddress);
      tx.setTo(aztecAddress);
      tx.addTraces({
        from: aztecAddress,
        to: fundedAddress,
        value: ethers.utils.parseEther('0.5').toHexString(),
      });

      await handleTransaction(tx);

      tx = new TestTransactionEvent();
      tx.setFrom(regularAddress);
      tx.setTo('');

      let findings = await handleTransaction(tx);
      mockContractDeployment(tx, regularAddress, createdContract0);

      expect(findings).toHaveLength(0);

      tx = new TestTransactionEvent();
      tx.setFrom(fundedAddress);
      tx.setTo('');

      const opcodeContracts = [createAddress('0x6666'), createAddress('0x5555')];
      const storageContracts = [createAddress('0x8888'), createAddress('0x9999')];

      mockContractAddresses(...opcodeContracts, ...storageContracts);

      mockContractDeployment(tx, fundedAddress, createdContract1);
      mockContractDeployment(
        tx,
        fundedAddress,
        createdContract2,
        storageContracts,
        opcodeContracts,
      );
      mockContractDeployment(tx, fundedAddress, createdContract3, [], opcodeContracts);
      mockContractDeployment(tx, fundedAddress, createdContract4, storageContracts, []);

      findings = await handleTransaction(tx);

      expect(findings).toHaveLength(4);
      expect(findings).toContainEqual(
        createDeploymentFinding(
          tx.hash,
          fundedAddress,
          createdContract1,
          [],
          defaultBotConfig.defaultAnomalyScore.deployment,
        ),
      );
      expect(findings).toContainEqual(
        createDeploymentFinding(
          tx.hash,
          fundedAddress,
          createdContract2,
          [...storageContracts, ...opcodeContracts],
          defaultBotConfig.defaultAnomalyScore.deployment,
        ),
      );
      expect(findings).toContainEqual(
        createDeploymentFinding(
          tx.hash,
          fundedAddress,
          createdContract3,
          opcodeContracts,
          defaultBotConfig.defaultAnomalyScore.deployment,
        ),
      );
      expect(findings).toContainEqual(
        createDeploymentFinding(
          tx.hash,
          fundedAddress,
          createdContract4,
          storageContracts,
          defaultBotConfig.defaultAnomalyScore.deployment,
        ),
      );
    });

    it('removes old funded accounts when address limit is exceeded', async () => {
      const addressLimit = 10;
      const data: DataContainer = {} as any;
      const config: BotConfig = {
        ...defaultBotConfig,
        addressLimit: addressLimit,
      };
      const initialize = provideInitialize(
        data,
        config,
        mockProvider,
        new Logger(LoggerLevel.ERROR),
        false,
      );
      const handleTransaction = provideHandleTransaction(data);

      await initialize();

      async function emulateFunding(fundedAddress: string) {
        const tx = new TestTransactionEvent();
        tx.setFrom(invokerAddress);
        tx.setTo(aztecAddress);
        tx.addTraces({
          from: aztecAddress,
          to: fundedAddress,
          value: ethers.utils.parseEther('0.5').toHexString(),
        });
        return await handleTransaction(tx);
      }

      async function emulateInteraction(targetAddress: string) {
        const tx = new TestTransactionEvent();
        tx.setFrom(targetAddress);
        tx.setTo(someContractAddress);
        return await handleTransaction(tx);
      }

      const getTestAddress = (i: number) => createAddress('0x4444' + i);

      // emulate Aztec funding
      for (let i = 0; i < addressLimit; i++) {
        const address = getTestAddress(i);
        await emulateFunding(address);
      }

      // check if we detect contract interaction
      let findings = await emulateInteraction(getTestAddress(0));
      const tx = new TestTransactionEvent();
      tx.setFrom(getTestAddress(0));
      tx.setTo(someContractAddress);
      expect(findings).toStrictEqual([
        createInteractionFinding(tx, defaultBotConfig.defaultAnomalyScore.interaction),
      ]);

      // add one more funded account that causes the storage to be exceeded
      await emulateFunding(getTestAddress(addressLimit));
      // check if we detect contract interaction of the address that should have been removed
      findings = await emulateInteraction(getTestAddress(0));
      // we should not fire any findings
      expect(findings).toHaveLength(0);
    });

    it('uses analytics properly', async () => {
      const mockAnomalyScore = 0.123;

      const mockAnalytics: jest.Mocked<BotAnalytics> = {
        sync: jest.fn(),
        incrementBotTriggers: jest.fn(),
        incrementAlertTriggers: jest.fn(),
        getAnomalyScore: jest.fn().mockReturnValue(mockAnomalyScore),
      } as any;

      mockData.analytics = mockAnalytics;

      let tx = new TestTransactionEvent();
      tx.setTimestamp(10);

      await handleTransaction(tx);

      expect(mockAnalytics.sync).toBeCalledWith(10);

      mockAnalytics.sync.mockClear();

      const contractAddress1 = createAddress('0xff1');
      const contractAddress2 = createAddress('0xff2');
      const contractAddress3 = createAddress('0xff3');

      mockContractAddresses(aztecAddress, contractAddress1, contractAddress2, contractAddress3);

      tx = new TestTransactionEvent();
      tx.setTimestamp(20);
      tx.setTo(contractAddress1);
      tx.addTraces({
        from: contractAddress1,
        to: createAddress('0xaa0'),
        value: ethers.utils.parseEther('0.1').toHexString(),
      });
      // should be ignored because of transfer to a contract
      tx.addTraces({
        from: createAddress('0xaa1'),
        to: contractAddress1,
        value: ethers.utils.parseEther('0.1').toHexString(),
      });
      tx.addTraces({
        from: contractAddress2,
        to: createAddress('0xaa2'),
        value: ethers.utils.parseEther('0.2').toHexString(),
      });
      // should be ignored because of transferred value equals 0
      tx.addTraces({
        from: contractAddress3,
        to: createAddress('0xaa3'),
        value: '0x0',
      });

      await handleTransaction(tx);

      expect(mockAnalytics.sync).toBeCalledWith(20);
      expect(mockAnalytics.incrementBotTriggers).toHaveBeenCalledTimes(3);
      expect(
        mockAnalytics.incrementBotTriggers.mock.calls.filter((c) => c[1] === FUNDING_ALERT_ID),
      ).toHaveLength(2);
      expect(
        mockAnalytics.incrementBotTriggers.mock.calls.filter(
          (c) => c[1] === FUNDED_ACCOUNT_INTERACTION_ALERT_ID,
        ),
      ).toHaveLength(1);
      expect(mockAnalytics.incrementAlertTriggers).toBeCalledTimes(0);

      mockAnalytics.sync.mockClear();
      mockAnalytics.incrementBotTriggers.mockClear();

      const fundedAddress = createAddress('0xaaaa');

      // funding from Aztec contract
      tx = new TestTransactionEvent();
      tx.setTimestamp(30);
      tx.setFrom(invokerAddress);
      tx.setTo(aztecAddress);
      tx.addTraces({
        from: aztecAddress,
        to: fundedAddress,
        value: ethers.utils.parseEther('0.5').toHexString(),
      });

      await handleTransaction(tx);

      expect(mockAnalytics.sync).toBeCalledWith(30);
      expect(mockAnalytics.incrementBotTriggers).toBeCalledTimes(2);
      expect(
        mockAnalytics.incrementBotTriggers.mock.calls.filter((c) => c[1] === FUNDING_ALERT_ID),
      ).toHaveLength(1);
      expect(
        mockAnalytics.incrementBotTriggers.mock.calls.filter(
          (c) => c[1] === FUNDED_ACCOUNT_INTERACTION_ALERT_ID,
        ),
      ).toHaveLength(1);

      expect(mockAnalytics.incrementAlertTriggers).toBeCalledTimes(1);
      expect(mockAnalytics.incrementAlertTriggers).toBeCalledWith(30, FUNDING_ALERT_ID);

      mockAnalytics.sync.mockClear();
      mockAnalytics.incrementBotTriggers.mockClear();
      mockAnalytics.incrementAlertTriggers.mockClear();

      // interaction with some contract
      tx = new TestTransactionEvent();
      tx.setTimestamp(40);
      tx.setFrom(fundedAddress);
      tx.setTo(contractAddress1);

      await handleTransaction(tx);

      expect(mockAnalytics.sync).toBeCalledWith(40);
      expect(mockAnalytics.incrementBotTriggers).toBeCalledTimes(1);
      expect(mockAnalytics.incrementAlertTriggers).toBeCalledTimes(1);
      expect(mockAnalytics.incrementBotTriggers).toBeCalledWith(
        40,
        FUNDED_ACCOUNT_INTERACTION_ALERT_ID,
      );
      expect(mockAnalytics.incrementAlertTriggers).toBeCalledWith(
        40,
        FUNDED_ACCOUNT_INTERACTION_ALERT_ID,
      );

      mockAnalytics.sync.mockClear();
      mockAnalytics.incrementBotTriggers.mockClear();
      mockAnalytics.incrementAlertTriggers.mockClear();

      const deployedContract1 = createAddress('0xff1')
      const deployedContract2 = createAddress('0xff2')

      // contract deployment
      tx = new TestTransactionEvent();
      tx.setTimestamp(40);
      tx.setFrom(fundedAddress);
      tx.setTo('');

      mockContractDeployment(tx, fundedAddress, deployedContract1)
      mockContractDeployment(tx, fundedAddress, deployedContract2)

      await handleTransaction(tx);

      expect(mockAnalytics.sync).toBeCalledWith(40);
      expect(mockAnalytics.incrementBotTriggers).toBeCalledTimes(2);
      expect(mockAnalytics.incrementAlertTriggers).toBeCalledTimes(2);
      expect(mockAnalytics.incrementBotTriggers).toBeCalledWith(
        40,
        FUNDED_ACCOUNT_DEPLOYMENT_ALERT_ID,
      );
      expect(mockAnalytics.incrementAlertTriggers).toBeCalledWith(
        40,
        FUNDED_ACCOUNT_DEPLOYMENT_ALERT_ID,
      );
    });
  });
});
