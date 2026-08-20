# Altana BSC Testnet Runbook

## What This Proves

MandateFi now supports two authority lifecycles. The Safe Treasury Rebalance path proves a bounded strategy action:

1. A device passkey controls an Altana smart wallet.
2. The owner registers a public, expiring session in Altana KeyStore.
3. MandateFi fetches a fresh PancakeSwap V2 quote for `0.001 tBNB → BUSD`.
4. The session executes `swapExactETHForTokens` with 1% maximum slippage and a ten-minute deadline.
5. BUSD is returned to the Altana smart wallet and the before/after balance delta is recorded.
6. The owner revokes the session with the passkey.
7. Grant, swap, and revoke receipts link to BscScan.

Catalog-only agents keep the earlier verification profile: one `isValidKey(address,bytes32)` selector, zero call value, and a `0.003 tBNB/day` native fee cap.

## Safe Treasury Rebalance Policy

| Constraint | Value | Enforcement |
| --- | --- | --- |
| Network | BSC Testnet, chain `97` | Altana client configuration |
| Router | `0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3` | Altana call permission |
| Method | `swapExactETHForTokens(uint256,address[],address,uint256)` | Altana call permission |
| Daily native cap | `0.004 tBNB` | Altana spend permission |
| Per-run amount | `0.001 tBNB` | MandateFi executor |
| Path | WBNB `0xae13...a7cd` → BUSD `0x7886...F2A7` | MandateFi executor |
| Recipient | The activating Altana smart wallet | MandateFi executor |
| Slippage | 1%; `amountOutMin = quote × 99%` | PancakeSwap transaction calldata |
| Quote lifetime | 10 minutes | PancakeSwap transaction deadline |

## Browser Flow

1. Open MandateFi over HTTPS or `localhost` in a passkey-capable browser.
2. Connect an injected EVM wallet and switch to BNB Smart Chain Testnet (`97`).
3. Select **Range Pilot**, inspect the live quote and policy, and continue.
4. Create a passkey smart wallet, or recover an existing MandateFi passkey.
5. Fund the displayed smart-wallet address with `0.01 tBNB` through the connected wallet.
6. Select **Authorize & execute** and approve the passkey prompt.
7. Wait for the Altana grant and bounded PancakeSwap swap to confirm.
8. Open **My mandates** and inspect the grant, swap, and BUSD received.
9. Select **Revoke**, approve the passkey prompt, and inspect the revoke transaction.

If registration succeeds but the immediate swap cannot produce evidence, MandateFi still persists the live grant and keeps **Revoke** available. This prevents a partially completed activation from becoming an invisible authorization.

## Custody Boundary

- The injected wallet is only used to send test gas to the smart wallet.
- The passkey private material remains in the device authenticator.
- Only the JSON-safe credential ID and public key are stored in local storage.
- The generated session signer remains in memory and is used for the immediate verification call.
- Persisted mandate metadata contains public keys and transaction hashes, never a private key.
- A page reload cannot reuse the session signer, but the owner can still revoke by public key with the recovered passkey.

## Current Contracts

| Component | BSC Testnet address |
| --- | --- |
| Altana KeyStore | `0x6b8361C29d05D498b1a12B54A37310f94171E94A` |
| Altana KeyStore Controller | `0xb530D1971f5453F3359518343F05D0AedFfF7e12` |

The SDK uses the Altana BSC Testnet relay at `https://testnet-relay.altana.network` and public chain ID `97`.

## Verified Reference Run

The following public run was completed from the deployed MandateFi product on 20 August 2026:

| Step | Transaction |
| --- | --- |
| Fund smart wallet `0x2cd25c624f1a9e75c2991db6f8636f712c38914a` with `0.01 tBNB` | [`0xd06ce7...ffc70b`](https://testnet.bscscan.com/tx/0xd06ce74431c7b33c1d8299e1c073f39da727fde034f56841862e103631ffc70b) |
| Register the passkey admin and expiring session in Altana KeyStore | [`0x726ed5...7e263`](https://testnet.bscscan.com/tx/0x726ed597395ef065e84ac93c1cbbbbadbed6680f690e77c12c86e440cdb7e263) |
| Execute the session-scoped zero-value KeyStore verification | [`0xfd00b2...5dc3a`](https://testnet.bscscan.com/tx/0xfd00b2341d4366840f0125ba0279c50ef0aaf8d7f522d9658332fdf14cf5dc3a) |

Post-run RPC verification returned two active public KeyStore entries and two account keys: one permanent super-admin passkey and one non-admin session expiring at `2026-09-19T13:16:07Z`.
