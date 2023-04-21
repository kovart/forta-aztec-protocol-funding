import BigNumber from 'bignumber.js';
import {
  EntityType,
  Finding,
  FindingSeverity,
  FindingType,
  Label,
  Network,
  TransactionEvent,
} from 'forta-agent';

const botConfig = require('../bot-config.json');

export const FUNDING_ALERT_ID = `${botConfig.developerAbbreviation}-AZTEC-PROTOCOL-FUNDING`;
export const FUNDED_ACCOUNT_INTERACTION_ALERT_ID = `${botConfig.developerAbbreviation}-AZTEC-PROTOCOL-FUNDED-ACCOUNT-INTERACTION-0`;
export const FUNDED_ACCOUNT_DEPLOYMENT_ALERT_ID = `${botConfig.developerAbbreviation}-AZTEC-PROTOCOL-FUNDED-ACCOUNT-DEPLOYMENT`;

export const createFundingFinding = (
  txHash: string,
  account: string,
  value: BigNumber,
  network: Network,
  anomalyScore: number,
) => {
  const tokenSymbolByNetwork: { [network: number]: string } = {
    [Network.MAINNET]: 'ETH',
  };

  const etherValue = value.div(new BigNumber(10).pow(18));

  return Finding.from({
    alertId: FUNDING_ALERT_ID,
    name: 'Aztec Protocol Funding',
    description: `Account ${account} was funded by ${etherValue.toFormat()} ${
      tokenSymbolByNetwork[network]
    }`,
    severity: FindingSeverity.Low,
    type: FindingType.Info,
    addresses: [account],
    labels: [
      Label.fromObject({
        entityType: EntityType.Address,
        label: 'MixerFunded',
        confidence: 1,
        entity: account
      }),
    ],
    metadata: {
      txHash: txHash,
      anomalyScore: anomalyScore.toString(),
    },
  });
};

export const createInteractionFinding = (txEvent: TransactionEvent, anomalyScore: number) => {
  return Finding.from({
    alertId: FUNDED_ACCOUNT_INTERACTION_ALERT_ID,
    name: 'Aztec Protocol funded account interacted with a contract',
    description: `${txEvent.from} interacted with contract ${txEvent.to}`,
    severity: FindingSeverity.Low,
    type: FindingType.Suspicious,
    addresses: [txEvent.from.toLowerCase(), txEvent.to!.toLowerCase()],
    labels: [
      Label.fromObject({
        entity: txEvent.to!,
        entityType: EntityType.Address,
        label: 'Attacker',
        confidence: 0.001
      }),
      Label.fromObject({
        entity: txEvent.hash,
        entityType: EntityType.Transaction,
        label: 'Attack',
        confidence: 0.001
      }),
    ],
    metadata: {
      txHash: txEvent.hash,
      anomalyScore: anomalyScore.toString(),
    },
  });
};

export const createDeploymentFinding = (
  txHash: string,
  account: string,
  contractAddress: string,
  containedAddresses: string[],
  anomalyScore: number,
) => {
  return Finding.fromObject({
    alertId: FUNDED_ACCOUNT_DEPLOYMENT_ALERT_ID,
    name: 'Suspicious Contract Creation by Aztec Protocol funded account',
    description: `${account} created contract ${contractAddress}`,
    severity: FindingSeverity.High,
    type: FindingType.Suspicious,
    addresses: [account, contractAddress, ...containedAddresses],
    labels: [
      Label.fromObject({
        entityType: EntityType.Address,
        label: 'Attacker',
        confidence: 0.1,
        entity: account
      }),
      Label.fromObject({
        entityType: EntityType.Address,
        label: 'Exploit',
        confidence: 0.1,
        entity: contractAddress
      }),
    ],
    metadata: {
      txHash: txHash,
      containedAddresses: JSON.stringify(containedAddresses),
      anomalyScore: anomalyScore.toString(),
    }
  });
};
