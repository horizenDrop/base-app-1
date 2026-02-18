# Base Tap Score (Gasless Mini App)

Lightweight Base Mini App (game) with:
- local tap game UI
- Solidity contract for onchain best score
- gasless submissions via `wallet_sendCalls` + `paymasterService`
- `farcaster.json` manifest for Base App / Mini App discovery

## Project structure
- `app/page.tsx`: mini game + wallet + gasless onchain submit
- `app/api/paymaster/route.ts`: paymaster proxy (keeps real endpoint server-side)
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
3. Fill:
- `NEXT_PUBLIC_GAME_CONTRACT_ADDRESS` (after deploy)
- `PAYMASTER_SERVICE_URL` (CDP paymaster URL or your paymaster backend)
4. Run app:
```bash
npm run dev
```

## Deploy contract (Base Sepolia)
See `contracts/README.md`.

## Gasless flow used
1. App checks wallet capabilities via `wallet_getCapabilities`.
2. App calls `wallet_sendCalls` with:
   - `chainId = 0x14a34` (Base Sepolia)
   - contract call `submitScore(score)`
   - `capabilities.paymasterService.url` (proxy route by default)

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

