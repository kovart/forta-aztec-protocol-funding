import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';
import { createAddress } from 'forta-agent-tools';
import { TestTransactionEvent } from 'forta-agent-tools/lib/test';
import { HandleTransaction, Network } from 'forta-agent';
import { BotConfig, DataContainer } from './types';
import { Logger, LoggerLevel } from './logger';
import { createInteractionFinding, createFundingFinding } from './findings';
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
      };
      const initialize = provideInitialize(data, config, provider, logger, true);

      await initialize();

      expect(data.isInitialized).toStrictEqual(true);
      expect(data.isDevelopment).toStrictEqual(true);
      expect(data.chainId).toStrictEqual(network);
      expect(data.findings).toStrictEqual([]);
      expect(data.aztecAddresses).toEqual(expect.arrayContaining([aztecAddress1, aztecAddress2]));
      expect(data.logger).toStrictEqual(logger);
      expect(data.provider).toStrictEqual(provider);
    });
  });

  describe('handleTransaction()', () => {
    let mockData: DataContainer;
    let mockProvider: jest.MockedObject<ethers.providers.JsonRpcProvider>;
    let handleTransaction: HandleTransaction;

    const aztecAddress = createAddress('0x2222');
    const invokerAddress = createAddress('0x1111');
    const someContractAddress = createAddress('0x00FF');

    const defaultNetwork = Network.MAINNET;
    const defaultBotConfig: BotConfig = {
      developerAbbreviation: 'TEST',
      aztecAddressesByChainId: { [defaultNetwork]: [aztecAddress] },
      addressLimit: 10000,
    };

    // mock getCode so that agent knows whether the address is a contract or not
    function mockContractAddresses(...addresses: string[]) {
      mockProvider.getCode.mockImplementation(async (address: string | Promise<string>) =>
        addresses.includes(<string>address) ? '0xff' : '0x',
      );
    }

    beforeEach(async () => {
      mockData = {} as any;
      mockProvider = {
        getCode: jest.fn(),
        // make the agent think we are in the target network
        getNetwork: jest.fn().mockImplementation(async () => ({
          chainId: defaultNetwork.valueOf(),
          name: Network[defaultNetwork],
        })),
      } as any;
      mockContractAddresses(aztecAddress, someContractAddress);
      const initialize = provideInitialize(
        mockData,
        defaultBotConfig,
        mockProvider,
        new Logger(LoggerLevel.ERROR),
        false,
      );
      handleTransaction = provideHandleTransaction(mockData);
      await initialize();
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
        createFundingFinding(fundedAddress, fundedValue, defaultNetwork),
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

      expect(findings).toStrictEqual([createInteractionFinding(tx.from, tx.to!)]);
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
      expect(findings).toStrictEqual([
        createInteractionFinding(getTestAddress(0), someContractAddress),
      ]);

      // add one more funded account that causes the storage to be exceeded
      await emulateFunding(getTestAddress(addressLimit));
      // check if we detect contract interaction of the address that should have been removed
      findings = await emulateInteraction(getTestAddress(0));
      // we should not fire any findings
      expect(findings).toHaveLength(0);
    });

    it.todo(
      'returns a finding if an account was not directly funded and then interacted with a contract',
    );
  });
});
