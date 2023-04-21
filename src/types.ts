import { Finding, Network } from 'forta-agent';
import { BotAnalytics } from 'forta-bot-analytics';
import { providers } from 'ethers';
import { Logger } from './logger';

export type DataContainer = {
  logger: Logger;
  provider: providers.JsonRpcProvider;
  aztecAddresses: string[];
  fundedAddresses: Set<string>;
  addressLimit: number;
  chainId: Network;
  analytics: BotAnalytics;
  findings: Finding[];
  isDevelopment: boolean;
  isInitialized: boolean;
};

export type BotConfig = {
  developerAbbreviation: string;
  defaultAnomalyScore: {
    funding: number;
    interaction: number;
    deployment: number;
  };
  addressLimit: number;
  aztecAddressesByChainId: {
    [chainId: number]: string[];
  };
};
