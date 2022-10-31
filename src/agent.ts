import { providers } from 'ethers';
import {
  Finding,
  Initialize,
  HandleTransaction,
  TransactionEvent,
  getEthersProvider,
} from 'forta-agent';
import { Logger, LoggerLevel } from './logger';
import { BotConfig, DataContainer } from './types';
import { createFundingFinding, createInteractionFinding } from './findings';
import BigNumber from 'bignumber.js';

const data: DataContainer = {} as any;
const provider = getEthersProvider();
const isDevelopment = process.env.NODE_ENV !== 'production';
const logger = new Logger(isDevelopment ? LoggerLevel.DEBUG : LoggerLevel.WARN);
const botConfig = require('../bot-config.json');

// https://github.com/forta-network/forta-bot-sdk/pull/201
const MAX_FINDINGS_PER_REQUEST = 10;

const provideInitialize = (
  data: DataContainer,
  config: BotConfig,
  provider: providers.JsonRpcProvider,
  logger: Logger,
  isDevelopment: boolean,
): Initialize => {
  return async function initialize() {
    const { chainId } = await provider.getNetwork();

    data.logger = logger;
    data.provider = provider;
    data.isDevelopment = isDevelopment;
    data.chainId = chainId;
    data.findings = [];
    data.aztecAddresses = config.aztecAddressesByChainId[chainId].map((a) => a.toLowerCase());
    data.addressLimit = config.addressLimit;
    data.fundedAddresses = new Set();
    data.isInitialized = true;

    logger.debug('Initialized');
  };
};

const provideHandleTransaction = (data: DataContainer): HandleTransaction => {
  return async function handleTransaction(txEvent: TransactionEvent) {
    if (!data.isInitialized) throw new Error('DataContainer is not initialized');

    const findings: Finding[] = data.findings;

    const getFindingsBatch = () => findings.splice(0, MAX_FINDINGS_PER_REQUEST);

    if (!txEvent.to) return getFindingsBatch();

    // check if it is a transaction to aztec protocol
    if (data.aztecAddresses.includes(txEvent.to.toLowerCase())) {
      for (const trace of txEvent.traces) {
        // check if it aztec protocol transfer funds to some account
        if (data.aztecAddresses.includes(trace.action.from.toLowerCase())) {
          // check if transferred value is greater than 0
          if (trace.action.value !== '0x0') {
            // check if the funds are transferred to EOA
            if ((await data.provider.getCode(trace.action.to)) === '0x') {
              // add account to trackable address set
              data.fundedAddresses.add(trace.action.to.toLowerCase());
              // check if the trackable address set is exceeded
              if (data.fundedAddresses.size > data.addressLimit) {
                // remove first item in the set
                const it = data.fundedAddresses.values();
                const first = it.next().value;
                data.fundedAddresses.delete(first);
              }

              // push a finding that the account was funded
              findings.push(
                createFundingFinding(
                  trace.action.to.toLowerCase(),
                  new BigNumber(trace.action.value, 16),
                  data.chainId,
                ),
              );
            }
          }
        }
      }
    } else if (data.fundedAddresses.has(txEvent.from.toLowerCase())) {
      // check if the funded account interacts with a contract
      if ((await data.provider.getCode(txEvent.to)) !== '0x') {
        findings.push(createInteractionFinding(txEvent.from, txEvent.to));
      }
    }

    return getFindingsBatch();
  };
};

export default {
  initialize: provideInitialize(data, botConfig, provider, logger, isDevelopment),
  handleTransaction: provideHandleTransaction(data),

  provideInitialize,
  provideHandleTransaction,
};
