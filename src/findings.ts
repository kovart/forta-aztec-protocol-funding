import BigNumber from 'bignumber.js';
import { Finding, FindingSeverity, FindingType, Network } from 'forta-agent';

const botConfig = require('../bot-config.json');

export const createFundingFinding = (account: string, value: BigNumber, network: Network) => {
  const tokenSymbolByNetwork: { [network: number]: string } = {
    [Network.MAINNET]: 'ETH',
  };

  const etherValue = value.div(new BigNumber(10).pow(18));

  return Finding.from({
    alertId: `${botConfig.developerAbbreviation}-AZTEC-PROTOCOL-FUNDING`,
    name: 'Aztec Protocol Funding',
    description: `Account ${account} was funded by ${etherValue.toFormat()} ${
      tokenSymbolByNetwork[network]
    }`,
    severity: FindingSeverity.Low,
    type: FindingType.Info,
    addresses: [account],
  });
};

export const createInteractionFinding = (from: string, to: string) => {
  return Finding.from({
    alertId: `${botConfig.developerAbbreviation}-AZTEC-PROTOCOL-FUNDED-ACCOUNT-INTERACTION-0`,
    name: 'Aztec Protocol funded account interacted with a contract',
    description: `${from} interacted with contract ${to}`,
    severity: FindingSeverity.Low,
    type: FindingType.Suspicious,
    addresses: [from.toLowerCase(), to.toLowerCase()],
  });
};
