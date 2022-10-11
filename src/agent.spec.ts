import { ethers } from 'ethers';
import { createAddress } from 'forta-agent-tools';
import { TestTransactionEvent } from 'forta-agent-tools/lib/test';
import { HandleTransaction, Network } from 'forta-agent';
import { BotConfig, DataContainer } from './types';
import { Logger, LoggerLevel } from './logger';
import agent from './agent';
import { createFinding } from './findings';

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
        observationDays: 21,
        aztecAddressByChainId: { [network]: [aztecAddress1, aztecAddress2] },
        developerAbbreviation: 'TEST',
      };
      const initialize = provideInitialize(data, config, provider, logger, true);

      await initialize();

      expect(data.isInitialized).toStrictEqual(true);
      expect(data.isDevelopment).toStrictEqual(true);
      expect(data.aztecAddresses).toContain([aztecAddress1, aztecAddress2]);
      expect(data.logger).toStrictEqual(logger);
      expect(data.provider).toStrictEqual(provider);
    });
  });

  describe('handleTransaction()', () => {
    let mockData: DataContainer;
    let mockProvider: jest.MockedObject<ethers.providers.JsonRpcProvider>;
    let handleTransaction: HandleTransaction;

    const invokerAddress = createAddress('0x1111');
    const aztecAddress1 = createAddress('0x2222');
    const someContractAddress = createAddress('0x00FF');

    const defaultNetwork = Network.MAINNET;
    const defaultBotConfig: BotConfig = {
      developerAbbreviation: 'TEST',
      aztecAddressByChainId: { [defaultNetwork]: [aztecAddress1] },
      observationDays: 31 * 6, // 6 months
    };

    // mock getCode so that agent knows whether the address is a contract or not
    function mockContractAddresses(...addresses: string[]) {
      mockProvider.getCode.mockImplementation(async (address: string | Promise<string>) =>
        addresses.includes(<string>address) ? '0x0f0f' : '0x',
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
      mockContractAddresses(aztecAddress1, someContractAddress);
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
      const targetAddress = createAddress('0x9999');

      mockContractAddresses(nonAztecContractAddress);

      // funding from some non-Aztec service
      tx = new TestTransactionEvent();
      tx.setFrom(invokerAddress);
      tx.setTo(nonAztecContractAddress);
      tx.addTraces({
        from: nonAztecContractAddress,
        to: targetAddress,
        value: ethers.utils.parseEther('0.5').toHexString(),
      });
      findings = await handleTransaction(tx);

      expect(findings).toStrictEqual([]);

      // contract interaction
      tx = new TestTransactionEvent();
      tx.setFrom(targetAddress);
      tx.setTo(someContractAddress);
      findings = await handleTransaction(tx);

      expect(findings).toStrictEqual([]);
    });

    it('returns empty findings if there was no contract interaction', async () => {
      let tx, findings;
      const targetAddress = createAddress('0x9999');
      const eoaAddress = createAddress('0xEA1');

      // funding from Aztec contract
      tx = new TestTransactionEvent();
      tx.setFrom(invokerAddress);
      tx.setTo(aztecAddress1);
      tx.addTraces({
        from: aztecAddress1,
        to: targetAddress,
        value: ethers.utils.parseEther('0.5').toHexString(),
      });
      findings = await handleTransaction(tx);

      expect(findings).toStrictEqual([]);

      // interaction with EOA
      tx = new TestTransactionEvent();
      tx.setFrom(targetAddress);
      tx.setTo(eoaAddress);
      findings = await handleTransaction(tx);

      expect(findings).toStrictEqual([]);
    });

    it('returns a finding if an account was funded and then interacted with a contract', async () => {
      let tx, findings;
      const targetAddress = createAddress('0x9999');

      // funding from Aztec contract
      tx = new TestTransactionEvent();
      tx.setFrom(invokerAddress);
      tx.setTo(aztecAddress1);
      tx.addTraces({
        from: aztecAddress1,
        to: targetAddress,
        value: ethers.utils.parseEther('0.5').toHexString(),
      });
      findings = await handleTransaction(tx);

      expect(findings).toStrictEqual([]);

      // interaction with some contract
      tx = new TestTransactionEvent();
      tx.setFrom(targetAddress);
      tx.setTo(someContractAddress);
      findings = await handleTransaction(tx);

      expect(findings).toStrictEqual([createFinding()]);
    });

    it('handles observation period properly', async () => {
      async function emulateFundingAndContractInteraction(
        targetAddress: string,
        initialTimestamp: number,
        interactionTimestamp: number,
      ) {
        let tx: TestTransactionEvent;

        // funding from Aztec contract
        tx = new TestTransactionEvent();
        tx.setTimestamp(initialTimestamp);
        tx.setFrom(invokerAddress);
        tx.setTo(aztecAddress1);
        tx.addTraces({
          from: aztecAddress1,
          to: targetAddress,
          value: ethers.utils.parseEther('0.5').toHexString(),
        });

        const findings = await handleTransaction(tx);

        expect(findings).toStrictEqual([]);

        // interaction with some contract
        tx = new TestTransactionEvent();
        tx.setTimestamp(interactionTimestamp);
        tx.setFrom(targetAddress);
        tx.setTo(someContractAddress);
        return await handleTransaction(tx);
      }

      const initialTimestamp = Math.floor(Date.now() / 1000);

      let findings = emulateFundingAndContractInteraction(
        '0x9988',
        initialTimestamp,
        initialTimestamp + defaultBotConfig.observationDays * 24 * 60 * 60,
      );

      expect(findings).toStrictEqual([createFinding()]);

      findings = emulateFundingAndContractInteraction(
        '0x9977',
        initialTimestamp,
        initialTimestamp + defaultBotConfig.observationDays * 24 * 60 * 60 + 1,
      );

      expect(findings).toStrictEqual([]);
    });

    it.todo(
      'returns a finding if an account was not directly funded and then interacted with a contract',
    );
  });
});
