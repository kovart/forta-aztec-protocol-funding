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

export const AZTEC_PROTOCOL_FUNDING_ALERT_ID = `${botConfig.developerAbbreviation}-AZTEC-PROTOCOL-FUNDING`;
export const AZTEC_PROTOCOL_FUNDED_ACCOUNT_INTERACTION_ALERT_ID = `${botConfig.developerAbbreviation}-AZTEC-PROTOCOL-FUNDED-ACCOUNT-INTERACTION-0`;

export const createFundingFinding = (
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
    alertId: AZTEC_PROTOCOL_FUNDING_ALERT_ID,
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
        entity: account,
        remove: false,
      }),
    ],
    metadata: {
      anomaly_score: anomalyScore.toString(),
    },
  });
};

export const createInteractionFinding = (txEvent: TransactionEvent, anomalyScore: number) => {
  return Finding.from({
    alertId: AZTEC_PROTOCOL_FUNDED_ACCOUNT_INTERACTION_ALERT_ID,
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
        confidence: 0.001,
        remove: false,
      }),
      Label.fromObject({
        entity: txEvent.hash,
        entityType: EntityType.Transaction,
        label: 'Attack',
        confidence: 0.001,
        remove: false,
      }),
    ],
    metadata: {
      anomaly_score: anomalyScore.toString(),
    },
  });
};
