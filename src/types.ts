import { providers } from 'ethers';
import { Logger } from './logger';

export type DataContainer = {
  logger: Logger;
  provider: providers.JsonRpcProvider;
  aztecAddresses: string[];
  fundedAddresses: Set<string>;
  addressLimit: number;
  isDevelopment: boolean;
  isInitialized: boolean;
};

export type BotConfig = {
  developerAbbreviation: string;
  addressLimit: number;
  aztecAddressByChainId: {
    [chainId: number]: string[];
  };
};
