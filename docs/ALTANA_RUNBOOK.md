# Altana BSC Testnet Runbook

## What This Proves

The current MandateFi integration proves the complete authority lifecycle without moving strategy assets:

1. A device passkey controls an Altana smart wallet.
2. The owner registers a public, expiring session in Altana KeyStore.
3. The session executes a BSC Testnet call to `isValidKey(address,bytes32)`.
4. The owner revokes the session with the passkey.
5. Grant, execution, and revoke receipts link to BscScan.

The session has one allowed selector. Its verification call transfers zero value, and its only spend allowance is a `0.003 tBNB/day` native fee cap for gas. PancakeSwap, Venus, and Lista calls are not enabled until their Testnet addresses, selectors, assets, and token-specific limits are pinned.

## Browser Flow

1. Open MandateFi over HTTPS or `localhost` in a passkey-capable browser.
2. Connect an injected EVM wallet and switch to BNB Smart Chain Testnet (`97`).
3. Select an agent and complete the policy form.
4. Create a passkey smart wallet, or recover an existing MandateFi passkey.
5. Fund the displayed smart-wallet address with `0.01 tBNB` through the connected wallet.
6. Select **Register onchain** and approve the passkey prompt.
7. Wait for the Altana grant and session verification to confirm.
8. Open **My mandates** and inspect both transaction links.
9. Select **Revoke**, approve the passkey prompt, and inspect the revoke transaction.

If registration succeeds but the immediate verification call cannot produce evidence, MandateFi still persists the live grant and keeps **Revoke** available. This prevents a partially completed activation from becoming an invisible authorization.

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
