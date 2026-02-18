# Contracts (Base Sepolia)

## 1) Prerequisites
- Install Foundry: `https://book.getfoundry.sh/getting-started/installation`
- Copy root `.env.example` to `.env.local` and set:
  - `DEPLOYER_PRIVATE_KEY`

## 2) Install dependencies
From `contracts` directory:

```bash
forge install foundry-rs/forge-std
```

## 3) Deploy to Base Sepolia
From `contracts` directory:

```bash
forge script script/DeployGaslessScoreGame.s.sol:DeployGaslessScoreGame \
  --rpc-url base_sepolia \
  --broadcast
```

Copy deployed contract address and set it as:

`NEXT_PUBLIC_GAME_CONTRACT_ADDRESS`

