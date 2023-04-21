import { providers } from 'ethers';
import BigNumber from 'bignumber.js';
import {
  getStorageContractAddresses,
  getOpcodeContractAddresses,
  getCreatedContracts,
} from 'forta-helpers';
import {
  Finding,
  Initialize,
  HandleTransaction,
  TransactionEvent,
  getEthersBatchProvider,
} from 'forta-agent';
import { BotAnalytics, FortaBotStorage, InMemoryBotStorage } from 'forta-bot-analytics';
import { Logger, LoggerLevel } from './logger';
import { BotConfig, DataContainer } from './types';
import {
  FUNDING_ALERT_ID,
  FUNDED_ACCOUNT_INTERACTION_ALERT_ID,
  createFundingFinding,
  createInteractionFinding,
  createDeploymentFinding,
  FUNDED_ACCOUNT_DEPLOYMENT_ALERT_ID,
} from './findings';

const data: DataContainer = {} as any;
const provider = getEthersBatchProvider();
const isDevelopment = process.env.NODE_ENV !== 'production';
const logger = new Logger(isDevelopment ? LoggerLevel.DEBUG : LoggerLevel.INFO);
const botConfig = require('../bot-config.json');

// https://github.com/forta-network/forta-bot-sdk/pull/201
const MAX_FINDINGS_PER_REQUEST = 50;

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
    data.analytics = new BotAnalytics(
      isDevelopment ? new InMemoryBotStorage(logger.info) : new FortaBotStorage(logger.info),
      {
        key: chainId.toString(),
        syncTimeout: 30 * 60, // 30m
        maxSyncDelay: 7 * 24 * 60 * 60, // 7d
        observableInterval: 5 * 24 * 60 * 60, // 5d
        defaultAnomalyScore: {
          [FUNDING_ALERT_ID]: config.defaultAnomalyScore.funding,
          [FUNDED_ACCOUNT_INTERACTION_ALERT_ID]: config.defaultAnomalyScore.interaction,
          [FUNDED_ACCOUNT_DEPLOYMENT_ALERT_ID]: config.defaultAnomalyScore.deployment,
        },
        logFn: logger.info,
      },
    );
    data.isInitialized = true;

    logger.debug('Initialized');
  };
};

const provideHandleTransaction = (data: DataContainer): HandleTransaction => {
  return async function handleTransaction(txEvent: TransactionEvent) {
    if (!data.isInitialized) throw new Error('DataContainer is not initialized');

    const findings: Finding[] = data.findings;

    await data.analytics.sync(txEvent.timestamp);

    const createdContracts = getCreatedContracts(txEvent);

    if (createdContracts.length > 0) {
      // update statistics on the number of contract creations
      createdContracts.forEach(() =>
        data.analytics.incrementBotTriggers(txEvent.timestamp, FUNDED_ACCOUNT_DEPLOYMENT_ALERT_ID),
      );

      // check if the contract has been deployed by one of the funded accounts
      if (data.fundedAddresses.has(txEvent.from.toLowerCase())) {
        // update statistics on the number of suspicious contract creations
        createdContracts.forEach(() =>
          data.analytics.incrementAlertTriggers(
            txEvent.timestamp,
            FUNDED_ACCOUNT_DEPLOYMENT_ALERT_ID,
          ),
        );

        for (const contract of createdContracts) {
          const contractsInStorage = await getStorageContractAddresses(
            contract.address,
            data.provider,
            undefined,
            txEvent.blockNumber,
          );
          const contractsInOpcode = await getOpcodeContractAddresses(
            await data.provider.getCode(contract.address),
            data.provider,
          );

          data.findings.push(
            createDeploymentFinding(
              txEvent.hash,
              txEvent.from.toLowerCase(),
              contract.address.toLowerCase(),
              [...contractsInStorage, ...contractsInOpcode],
              data.analytics.getAnomalyScore(FUNDED_ACCOUNT_DEPLOYMENT_ALERT_ID),
            ),
          );
        }
      }
    }

    const getFindingsBatch = () => findings.splice(0, MAX_FINDINGS_PER_REQUEST);

    if (!txEvent.to) return getFindingsBatch();

    // check if it is an interaction to an EOA
    if ((await data.provider.getCode(txEvent.to)) === '0x') return getFindingsBatch();

    data.analytics.incrementBotTriggers(txEvent.timestamp, FUNDED_ACCOUNT_INTERACTION_ALERT_ID);

    // update statistics on the number of ether transfers in the network
    for (const trace of txEvent.traces) {
      // check if it is a transfer to EOA and the transferred value is greater than 0
      if (
        trace.action.value !== '0x0' &&
        trace.action.to &&
        (await data.provider.getCode(trace.action.to)) === '0x'
      ) {
        data.analytics.incrementBotTriggers(txEvent.timestamp, FUNDING_ALERT_ID);
      }
    }

    // check if it is a transaction to aztec protocol
    if (data.aztecAddresses.includes(txEvent.to.toLowerCase())) {
      for (const trace of txEvent.traces) {
        if (!trace.action.to) continue;

        // check if aztec protocol transfers funds to some account
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

              data.analytics.incrementAlertTriggers(txEvent.timestamp, FUNDING_ALERT_ID);
              // push a finding that the account was funded
              findings.push(
                createFundingFinding(
                  txEvent.hash,
                  trace.action.to.toLowerCase(),
                  new BigNumber(trace.action.value, 16),
                  data.chainId,
                  data.analytics.getAnomalyScore(FUNDING_ALERT_ID),
                ),
              );
            }
          }
        }
      }
      // check if the funded account interacts with a contract
    } else if (data.fundedAddresses.has(txEvent.from.toLowerCase())) {
      data.analytics.incrementAlertTriggers(txEvent.timestamp, FUNDED_ACCOUNT_INTERACTION_ALERT_ID);
      findings.push(
        createInteractionFinding(
          txEvent,
          data.analytics.getAnomalyScore(FUNDED_ACCOUNT_INTERACTION_ALERT_ID),
        ),
      );
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
