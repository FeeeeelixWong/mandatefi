# MandateFi BSC Testnet Runbook

## What This Flow Proves

The current live path proves an owner-controlled four-module PancakeSwap portfolio:

1. The owner manually enters a tBNB funding amount, outcome, risk, liquidity access, and duration. The product provides no preset deposit amounts or fixed UI maximum; the amount must leave more than the protected Gas reserve, and wallet balance plus the live route determine executable size.
2. A dedicated allocation agent compares USDT and USDC yield, TVL, peg deviation, eligible opportunities, and live PancakeSwap normalization quotes.
3. The owner reviews the AI-selected base asset and its evidence; this recommendation does not grant wallet authority.
4. MandateFi generates a four-sleeve PancakeSwap strategy and explicit guardrails.
5. The UI labels Swap, V2 Liquidity, MasterChef V2 Farm, and flexible CAKE Pool Earn as live activation adapters.
6. A device passkey controls an Altana smart wallet.
7. The owner deposits tBNB into the Passkey smart account; any existing tBNB in this dedicated account counts toward the target.
8. On activation, the owner Passkey converts all tBNB above `0.003 tBNB` to the reviewed AI-selected stablecoin before granting AI authority.
9. The owner Passkey approves bounded stablecoin, CAKE, and LP allowances for exact official targets. The session itself cannot call token `approve`.
10. An expiring Altana session executes Swap, mints CAKE/WBNB V2 LP, stakes LP in MasterChef V2 PID 4, and deposits CAKE into the flexible CakePool.
11. MandateFi reads wallet, Farm, and CakePool positions after deployment and records a receipt for every stage.
12. The owner can inspect decisions, pause local checks, revoke the session onchain, or use the owner Passkey to withdraw Earn/Farm, remove LP with minimum outputs, and return liquid assets.

Recurring cross-product migrations remain owner-approved in this MVP. Initial four-module deployment and full owner unwind are live; testnet position quantities are execution evidence, not return projections.

## Live Swap Policy

| Constraint | Source | Enforcement |
| --- | --- | --- |
| Network | BSC Testnet, chain `97` | Wallet and Altana configuration |
| Managed value | Owner input, capped by wallet value | Strategy and Swap evaluator |
| Liquid-reserve target | Reserve sleeve from the composed owner strategy | Swap evaluator |
| Drift and action limits | Selected risk profile | Swap evaluator |
| Funding | tBNB deposited into the owner Passkey account | Injected-wallet transfer |
| Portfolio base | AI-selected test USDT `0x337610...34dDd` or test USDC `0xCA8eB2...623D` | Typed selection evidence, owner review, owner-signed startup conversion, and token-specific policy |
| Gas | Target `0.003 tBNB`; refill trigger below `0.0015 tBNB` | Deterministic balance check and recorded reverse Swap |
| Router | Token-specific verified PancakeSwap V2 testnet router | Altana call permission |
| Methods | Exact Swap, V2 LP add/remove, MasterChef V2 deposit/withdraw, and CakePool deposit/withdraw selectors | Altana call permission; token `approve` deliberately excluded |
| Native and token daily caps | Derived from managed value and risk | Altana spend permission |
| Recipient | Active Altana smart wallet | Transaction builder |
| Slippage | 0.5%, 1%, or 1.5% by risk profile | PancakeSwap calldata |
| Session lifetime | Owner-selected duration | Altana expiry |

## Browser Flow

1. Open MandateFi over HTTPS or `localhost` in a passkey-capable browser.
2. Select **Build my strategy**.
3. Manually enter the managed amount, objective, risk, liquidity access, and duration.
4. Let the allocation agent compare USDT and USDC, then review its selected base asset, confidence, rationale, and evidence.
5. Review the four-sleeve allocation, ordered PancakeSwap actions, coverage, and hard limits.
6. Continue to approval and inspect exact Swap, LP, Farm, Earn, token, contract, spend-cap, and expiry boundaries.
7. Connect an injected wallet and switch to BNB Smart Chain Testnet.
8. Create or recover the Altana passkey smart wallet.
9. Deposit the missing tBNB needed to reach the displayed funding target. Existing tBNB in this dedicated account may be reused.
10. Select **Normalize and start** and approve the owner Passkey startup conversion.
11. Approve bounded token allowances for the displayed official PancakeSwap targets.
12. Approve the Passkey prompt that grants the bounded, expiring AI session.
13. Wait for Swap, LP mint, Farm stake, and Earn deposit receipts. A failed stage stops subsequent deployment and remains visible in **Activity**.
14. Inspect live protocol quantities in **Portfolio**, transaction evidence in **Activity**, and exact permissions in **Guardrails**.
15. Select **Revoke onchain** to remove AI authority, or **Exit assets** to revoke first, withdraw Earn/Farm, remove LP, and return liquid assets to the connected owner wallet.

If the grant succeeds but execution fails, MandateFi retains the public grant information and keeps revoke available. A partial activation never becomes an invisible authorization.

## Custody and Runtime Boundary

- The injected wallet only deposits tBNB into the owner's smart account and receives assets on owner exit.
- Stablecoin selection is advisory and produces no transaction permission. Initial tBNB-to-stablecoin normalization remains owner-signed and occurs before the scoped AI session exists.
- Stablecoin capital and the protected tBNB Gas reserve remain separate in planning, reporting, and caps.
- Every future stablecoin-to-tBNB Gas refill has purpose `GAS_TOP_UP` and a dedicated Activity record.
- The owner passkey remains in the device authenticator.
- Only JSON-safe credential metadata and public transaction evidence are persisted.
- The scoped session signer exists in memory for the active browser session.
- A page reload discards that signer; the onchain policy remains revocable.
- The current app scans triggers every minute while the tab is active. Recurring Swap and Gas refill can execute under the scoped session; LP/Farm/Earn migrations remain owner-approved.
- Production continuous management and audited mainnet adapter versions follow `INTEGRATION_PLAN.md`.

## Verified Reference Run

| Step | Transaction |
| --- | --- |
| Fund smart wallet `0x2cd25c624f1a9e75c2991db6f8636f712c38914a` with `0.01 tBNB` | [`0xd06ce7...ffc70b`](https://testnet.bscscan.com/tx/0xd06ce74431c7b33c1d8299e1c073f39da727fde034f56841862e103631ffc70b) |
| Register passkey admin and an expiring session | [`0x726ed5...7e263`](https://testnet.bscscan.com/tx/0x726ed597395ef065e84ac93c1cbbbbadbed6680f690e77c12c86e440cdb7e263) |
| Execute a session-scoped KeyStore verification | [`0xfd00b2...5dc3a`](https://testnet.bscscan.com/tx/0xfd00b2341d4366840f0125ba0279c50ef0aaf8d7f522d9658332fdf14cf5dc3a) |

These receipts verify the wallet and session lifecycle. The next acceptance run must record fresh Swap, LP, Farm, and Earn transactions from this exact build; do not reuse the verification transaction as protocol-execution evidence.
