# MandateFi BSC Testnet Runbook

## What This Flow Proves

The current live path proves the owner-controlled foundation of the broader multi-strategy product:

1. The owner selects managed capital, an outcome, risk, liquidity access, and duration.
2. MandateFi generates a four-sleeve PancakeSwap strategy and explicit guardrails.
3. The UI labels each action as live, owner approval, or adapter planned.
4. A device passkey controls an Altana smart wallet.
5. The live Swap adapter reads tBNB/BUSD balances and a PancakeSwap V2 quote.
6. The owner reviews the action, slippage, methods, spend caps, and expiry.
7. An expiring Altana session can execute only the permitted Swap path.
8. The owner can inspect the decision, pause local checks, or revoke the session onchain.

This runbook does not claim that Infinity Liquidity, Farms, or Earn adapters are already autonomous. They are part of the generated strategy and are clearly marked by their current coverage.

## Live Swap Policy

| Constraint | Source | Enforcement |
| --- | --- | --- |
| Network | BSC Testnet, chain `97` | Wallet and Altana configuration |
| Managed value | Owner input, capped by wallet value | Strategy and Swap evaluator |
| Liquid-reserve target | Reserve sleeve from the composed owner strategy | Swap evaluator |
| Drift and action limits | Selected risk profile | Swap evaluator |
| Router | PancakeSwap V2 `0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3` | Altana call permission |
| Methods | Two Swap methods plus BUSD approval | Altana call permission |
| Native and token daily caps | Derived from managed value and risk | Altana spend permission |
| Recipient | Active Altana smart wallet | Transaction builder |
| Slippage | 0.5%, 1%, or 1.5% by risk profile | PancakeSwap calldata |
| Session lifetime | Owner-selected duration | Altana expiry |

## Browser Flow

1. Open MandateFi over HTTPS or `localhost` in a passkey-capable browser.
2. Select **Build my strategy**.
3. Enter the managed amount, objective, risk, liquidity access, and duration.
4. Review the four-sleeve allocation, ordered PancakeSwap actions, coverage, and hard limits.
5. Continue to approval and inspect the exact live Swap permissions.
6. Connect an injected wallet and switch to BNB Smart Chain Testnet.
7. Create or recover the Altana passkey smart wallet.
8. Fund the displayed smart wallet with sufficient tBNB for the managed amount and gas reserve.
9. Select **Approve and activate** and approve the passkey prompt.
10. Wait for the grant and any required first Swap action to confirm.
11. Inspect **Portfolio**, **Activity**, and **Guardrails**.
12. Select **Revoke onchain** when the mandate should no longer have authority.

If the grant succeeds but execution fails, MandateFi retains the public grant information and keeps revoke available. A partial activation never becomes an invisible authorization.

## Custody and Runtime Boundary

- The injected wallet only funds the smart wallet.
- The owner passkey remains in the device authenticator.
- Only JSON-safe credential metadata and public transaction evidence are persisted.
- The scoped session signer exists in memory for the active browser session.
- A page reload discards that signer; the onchain policy remains revocable.
- The current app scans triggers every minute while the tab is active, then runs the live Swap review only when a trigger is present.
- Production continuous management and additional adapters follow `INTEGRATION_PLAN.md`.

## Verified Reference Run

| Step | Transaction |
| --- | --- |
| Fund smart wallet `0x2cd25c624f1a9e75c2991db6f8636f712c38914a` with `0.01 tBNB` | [`0xd06ce7...ffc70b`](https://testnet.bscscan.com/tx/0xd06ce74431c7b33c1d8299e1c073f39da727fde034f56841862e103631ffc70b) |
| Register passkey admin and an expiring session | [`0x726ed5...7e263`](https://testnet.bscscan.com/tx/0x726ed597395ef065e84ac93c1cbbbbadbed6680f690e77c12c86e440cdb7e263) |
| Execute a session-scoped KeyStore verification | [`0xfd00b2...5dc3a`](https://testnet.bscscan.com/tx/0xfd00b2341d4366840f0125ba0279c50ef0aaf8d7f522d9658332fdf14cf5dc3a) |

These receipts verify the wallet and session lifecycle. Record the next owner-authorized live Swap separately after executing this exact build; do not reuse the verification transaction as Swap evidence.
