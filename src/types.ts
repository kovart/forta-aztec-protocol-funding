import { providers } from 'ethers';
import { Logger } from './logger';

export type DataContainer = {
  logger: Logger;
  provider: providers.JsonRpcProvider;
  aztecAddresses: string[];
  fundedAccounts: Set<string>,
  isDevelopment: boolean;
  isInitialized: boolean;
};

export type BotConfig = {
  developerAbbreviation: string;
  observationDays: number;
  aztecAddressByChainId: {
    [chainId: number]: string[];
  };
};
