# Aztec Protocol Funding

## Description

This bot detects when Aztec Protocol was used to fund an EOA, as well as when that EOA interacts with a contract.

## Supported Chains

- Ethereum

## Alerts

- AZTEC-PROTOCOL-FUNDING
  - Fired when Aztec Protocol was used to fund an EOA
  - Severity is always set to "low"
  - Type is always set to "info"
  - Labels:
    ```
      entityType: EntityType.Address,
      label: 'MixerFunded',
      confidence: 1,
      entity: account
    ```
  

- AK-AZTEC-PROTOCOL-FUNDED-ACCOUNT-INTERACTION-0
  - Fired when a transaction contains contract interactions from a Aztec Protocol funded account
  - Severity is always set to "low"
  - Type is always set to "suspicious"'
  - Labels
    ```
      entity: txEvent.to,
      entityType: EntityType.Address,
      label: 'Attacker',
      confidence: 0.001
    ```
    ```
      entity: txEvent.hash,
      entityType: EntityType.Transaction,
      label: 'Attack',
      confidence: 0.001
    ```

## Test Data

#### AZTEC-PROTOCOL-FUNDING

Due to the limitation on the number of findings per request, the bot publishes alerts in batches. 
Therefore, to test these alerts, you need to scan the whole block.

```bash
$ npm run block 15826198
```

#### AK-AZTEC-PROTOCOL-FUNDED-ACCOUNT-INTERACTION-0

The following command should detect the finding with account 0x4f6420e54191389555d33c0850e8ec66dccbcd45.

```bash
$ npm run range 15851384..15851427
```

