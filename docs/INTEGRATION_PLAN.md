# MandateFi Production Plan

## Objective

Move the current BSC Testnet product from an active-browser executor to a secure, observable, always-on portfolio-management service without changing the owner-approved policy model.

## Runtime Boundaries

| Component | Responsibility | Trust boundary |
| --- | --- | --- |
| Product UI | Mandate setup, approval, portfolio status, decision log, pause, revoke | Never stores owner or session private keys persistently |
| Portfolio engine | Deterministic allocation, drift, action size, and slippage calculation | Cannot sign, broadcast, or alter policy |
| Secure executor | Schedules checks and holds the scoped session signer in an enclave | Cannot exceed the registered Altana permission set |
| Altana session | Enforces allowed contracts, methods, spend caps, expiry, and revoke | Cannot access the owner passkey |
| PancakeSwap V2 | Quotes and executes the approved BNB/BUSD rebalance | Receives only bounded transaction calldata |
| BNB Smart Chain | Stores grants, revocations, swaps, and receipts | Public source of truth |

## Production Milestones

### 1. Durable execution

- Run the portfolio evaluator on a scheduled worker.
- Store the scoped session signer only in a hardware-backed enclave or equivalent isolated signer.
- Use an idempotency key per mandate and decision window.
- Lock each mandate during execution to prevent concurrent rebalances.

### 2. Reliable market inputs

- Compare the direct PancakeSwap quote with a secondary price source.
- Reject stale, missing, or divergent prices.
- Simulate every transaction immediately before broadcast.
- Requote when the transaction misses its bounded quote lifetime.

### 3. Operational safety

- Add retry classes that never rebroadcast after an ambiguous submission result.
- Reconcile receipts and balances before creating another action.
- Alert on failed checks, expired grants, cap exhaustion, and abnormal price movement.
- Preserve an append-only decision and execution audit log.

### 4. Product expansion

- Add more stablecoins only after token-decimal, liquidity, and contract reviews.
- Add additional protocols through isolated adapters with their own method allowlists.
- Keep risk profiles versioned so an active mandate never changes silently.
- Require explicit owner approval for every policy migration.

## Acceptance Criteria

- The same snapshot always produces the same policy decision.
- A call outside the allowed contract or selector is rejected by the session policy.
- A trade above native or token daily limits is rejected.
- An expired or revoked session cannot execute.
- Concurrent checks produce at most one onchain action.
- Every action or HOLD decision has inputs, rationale, policy version, and evidence.
- No private key is present in browser storage, application logs, or analytics.
