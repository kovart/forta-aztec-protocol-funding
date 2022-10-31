import { Finding, Network } from 'forta-agent';
import { providers } from 'ethers';
import { Logger } from './logger';

export type DataContainer = {
  logger: Logger;
  provider: providers.JsonRpcProvider;
  aztecAddresses: string[];
  fundedAddresses: Set<string>;
  addressLimit: number;
  chainId: Network;
  findings: Finding[];
  isDevelopment: boolean;
  isInitialized: boolean;
};

export type BotConfig = {
  developerAbbreviation: string;
  addressLimit: number;
  aztecAddressesByChainId: {
    [chainId: number]: string[];
  };
};
