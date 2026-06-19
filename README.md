# Penalty Perps Arena

A Three.js prototype for a Solana meme-coin game inspired by Roach Racing Club's market-momentum loop, rebuilt as a fictional global penalty-kick arena.

## What It Does

- Shows a clean 3D penalty arena with striker, keeper, ball, and goal.
- Lets the player choose a paper `Long` or `Short` position on a live simulated SOL chart.
- Moves player momentum based on whether the market moves with or against the selected side.
- Resolves a penalty kick into shot points, market points, streak bonus, and leaderboard score.
- Displays AI squads as clearly labeled simulated opponents with no reward eligibility.
- Includes token/wallet UI placeholders for future Solana + Privy integration.

## Guardrails

The current perps mechanic is paper/simulated only:

- No deposits
- No custody
- No real margin
- No real liquidation
- No real USDC balance

## Development

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Build

```bash
npm run build
```

## Next Integrations

- Privy auth for username, X/Twitter, and wallet login.
- Solana wallet verification and SPL token holder checks.
- Real market data source for paper settlement.
- Backend leaderboard, daily attempts, AI squad simulation, and admin controls.
