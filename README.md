# Pragma (Base Mini App)

Lightweight Base Mini App (game) with:
- local tap game UI
- Solidity contract for onchain best score
- onchain score submissions from wallet (paid gas)
- `farcaster.json` manifest for Base App / Mini App discovery

## Project structure
- `app/page.tsx`: game + wallet + onchain score submit
- `public/.well-known/farcaster.json`: Mini App manifest
- `contracts/src/GaslessScoreGame.sol`: smart contract
- `contracts/script/DeployGaslessScoreGame.s.sol`: deployment script (Foundry)

## Quick start
1. Install deps:
```bash
npm install
```
2. Copy env file:
```bash
cp .env.example .env.local
```
3. Fill (optional for persistence):
- `REDIS_URL` or `KV_REST_API_URL/KV_REST_API_TOKEN`
4. Run app:
```bash
npm run dev
```

## Deploy contract (Base Sepolia)
See `contracts/README.md`.

## Onchain submit flow
1. App submits a wallet transaction on Base mainnet (`0x2105`).
2. On success, app marks the run as verified in leaderboard storage.

## Prepare for Base App launch
1. Deploy app to a public HTTPS domain.
2. Update URLs in `public/.well-known/farcaster.json`:
- `iconUrl`
- `homeUrl`
- `imageUrl`
- `splashImageUrl`
- optional `webhookUrl`
3. Add valid signed `accountAssociation` in the same file.
4. Verify manifest is reachable:
- `https://YOUR_DOMAIN/.well-known/farcaster.json`
5. Submit in Base App builder/discovery flow.

## Useful links
- https://join.base.app/
- https://www.base.org/build
- https://docs.base.org/get-started/build-app
- https://docs.base.org/get-started/deploy-smart-contracts
