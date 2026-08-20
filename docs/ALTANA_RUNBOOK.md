# MandateFi BSC Testnet Runbook

## What This Flow Proves

The live product demonstrates a complete owner-controlled portfolio mandate:

1. A device passkey controls an Altana smart wallet.
2. The owner defines managed capital, a goal, risk, and duration.
3. MandateFi reads tBNB and BUSD balances and a live PancakeSwap V2 price.
4. The deterministic engine proposes BUY_STABLE, BUY_NATIVE, or HOLD.
5. The owner reviews the allocation, quote, slippage, methods, and spend caps.
6. An expiring Altana session executes only the permitted first action.
7. The dashboard records the decision and receipt.
8. The owner can pause local checks or revoke the session onchain.

## Dynamic Policy

| Constraint | Source | Enforcement |
| --- | --- | --- |
| Network | BSC Testnet, chain `97` | Wallet and Altana client configuration |
| Managed value | Owner input, capped by wallet value | Portfolio engine |
| Target allocation | Goal plus risk profile | Portfolio engine |
| Drift and action limits | Selected risk profile | Portfolio engine |
| Router | PancakeSwap V2 `0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3` | Altana call permission |
| Methods | Two swap methods plus BUSD approval | Altana call permission |
| Native and token daily caps | Derived from managed value and risk | Altana spend permission |
| Recipient | Activating Altana smart wallet | Transaction builder |
| Slippage | 0.5%, 1%, or 1.5% by risk profile | PancakeSwap calldata |
| Session lifetime | Owner-selected duration | Altana expiry |

## Browser Flow

1. Open MandateFi over HTTPS or `localhost` in a passkey-capable browser.
2. Select **Create mandate**.
3. Enter the managed amount and duration.
4. Choose an investment goal and risk profile.
5. Review the target allocation, current drift, initial action, quote, and guardrails.
6. Connect an injected wallet and switch to BNB Smart Chain Testnet.
7. Create or recover the Altana passkey smart wallet.
8. Fund the displayed smart wallet with sufficient tBNB for the managed amount and gas reserve.
9. Select **Approve & start mandate** and approve the passkey prompt.
10. Wait for the grant and any required first swap to confirm.
11. Inspect **Portfolio**, **Decision log**, and **Policies**.
12. Use **Revoke onchain** when the mandate should no longer have authority.

If the grant succeeds but execution fails, MandateFi retains the public grant information and keeps revoke available. A partial activation never becomes an invisible authorization.

## Custody and Runtime Boundary

- The injected wallet only funds the smart wallet.
- The owner passkey remains in the device authenticator.
- Only JSON-safe credential metadata and public transaction evidence are persisted.
- The scoped session signer exists in memory for the active browser session.
- A page reload discards that signer; the onchain policy remains revocable.
- The current app checks every 60 seconds only while its tab is active.
- Production continuous management requires a secure always-on executor described in `INTEGRATION_PLAN.md`.

## Verified Reference Run

| Step | Transaction |
| --- | --- |
| Fund smart wallet `0x2cd25c624f1a9e75c2991db6f8636f712c38914a` with `0.01 tBNB` | [`0xd06ce7...ffc70b`](https://testnet.bscscan.com/tx/0xd06ce74431c7b33c1d8299e1c073f39da727fde034f56841862e103631ffc70b) |
| Register passkey admin and an expiring session | [`0x726ed5...7e263`](https://testnet.bscscan.com/tx/0x726ed597395ef065e84ac93c1cbbbbadbed6680f690e77c12c86e440cdb7e263) |
| Execute a session-scoped KeyStore verification | [`0xfd00b2...5dc3a`](https://testnet.bscscan.com/tx/0xfd00b2341d4366840f0125ba0279c50ef0aaf8d7f522d9658332fdf14cf5dc3a) |

These receipts verify the wallet and session lifecycle. Record the next owner-authorized dynamic swap separately after executing this exact build; do not reuse the verification transaction as swap evidence.
