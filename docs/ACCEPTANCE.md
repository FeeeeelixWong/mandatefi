# MandateFi Delivery Acceptance

This checklist defines what "working" means for the hackathon build. A strategy preview or simulated receipt does not pass.

## 1. Automated release gates

- `npm test` passes deterministic strategy, policy, receipt-completion, and permission-boundary tests.
- `npm run lint` passes.
- `npm run build` passes for the browser and Vercel API runtimes.
- `npm run verify:pancake -- <smart-wallet>` confirms runtime bytecode and readable positions for the official testnet Router, CAKE token, CAKE/WBNB LP, MasterChef V2, and CakePool.
- The Altana session contains exact contract selectors and spend caps, expires with the mandate, and never includes ERC-20 `approve`, Farm/Earn `withdraw`, or LP-removal authority.

## 2. Owner acceptance journey

1. Enter a tBNB amount, goal, risk profile, liquidity need, and mandate term.
2. Review the AI-selected stablecoin and its timestamped evidence.
3. Approve the owner-signed tBNB normalization transaction.
4. Approve bounded allowances to the exact official PancakeSwap contracts.
5. Approve the scoped, revocable Altana session.
6. Confirm all four terminal module receipts in **Activity**:
   - **Swap:** stablecoin to the bounded market sleeve.
   - **LP:** CAKE/WBNB liquidity minted.
   - **Farm:** the minted LP amount staked in MasterChef V2 PID 4.
   - **Earn:** CAKE deposited into the flexible CakePool. Converting to CAKE alone does not count.
7. Confirm the dashboard reads the reserve, market tBNB, wallet/staked LP, and CakePool shares directly from BSC Testnet.
8. Revoke the session or run **Exit assets** and confirm CakePool withdrawal, Farm withdrawal, LP removal, liquid-asset return, and preserved Gas reserve.

## 3. Failure acceptance

- A failed stage is recorded as `FAILED`, never as a completed module.
- Execution stops after the first failed stage; later actions are not attempted with partial assumptions.
- A module counts as complete only after its terminal operation confirms.
- Missing or stale market, yield, or cost evidence cannot broaden authority or bypass the deterministic gate.
- Refreshing the page can still read public protocol positions even when the in-memory session signer is unavailable.

## 4. Required public evidence

Before final judging, add explorer links for one fresh end-to-end run:

| Proof | Required result |
| --- | --- |
| Owner normalization | Confirmed stablecoin funding transaction |
| Bounded approvals | Confirmed owner transaction to exact adapters |
| Session grant | Confirmed scoped Altana grant |
| Swap | Confirmed Router transaction |
| LP | Confirmed CAKE/WBNB mint transaction |
| Farm | Confirmed MasterChef V2 PID 4 deposit |
| Earn | Confirmed flexible CakePool deposit |
| Position probe | Non-zero values where expected from `npm run verify:pancake` |
| Owner exit | Confirmed unwind and asset return transactions |

Code, automated checks, and read-only contract verification are release-ready. The fresh owner-signed 4/4 run and its explorer links remain the final external acceptance gate whenever adapters or permissions change.
