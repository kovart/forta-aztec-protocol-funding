import { Finding, FindingSeverity, FindingType } from 'forta-agent';

const botConfig = require('../bot-config.json');

export const createFinding = (from: string, to: string) => {
  return Finding.from({
    alertId: `${botConfig.developerAbbreviation}-AZTEC-PROTOCOL-FUNDED-ACCOUNT-INTERACTION-0`,
    name: 'Aztec Protocol funded account interacted with a contract',
    description: `${from} interacted with contract ${to}`,
    severity: FindingSeverity.Low,
    type: FindingType.Suspicious,
    addresses: [from.toLowerCase(), to.toLowerCase()],
  });
};
