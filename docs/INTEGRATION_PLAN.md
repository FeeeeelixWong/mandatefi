# MandateFi Production Integration Plan

## Objective

Turn the current BSC Testnet proof into a secure, observable, always-on AI DeFi portfolio manager while preserving the owner's explicit mandate.

## Strategy and Execution Are Separate

The strategy engine can already compose a complete portfolio across reserve, spot, liquidity, and farm/earn sleeves. Each sleeve is executed through an isolated adapter so an unfinished integration can never be mistaken for live authority.

| Adapter | Responsibility | Current coverage | Production completion |
| --- | --- | --- | --- |
| Swap | Build spot and reserve baskets | Live on BSC Testnet | Universal Router/Permit2 review, route simulation, broader token registry |
| Infinity Liquidity | Create, adjust, and exit LP positions | Owner approval required | Position manager adapter, range model, fee and IL accounting |
| Farms | Stake eligible LP positions and claim incentives | Planned | Farm discovery, reward valuation, approval and unstake paths |
| Earn | Allocate eligible single-token positions and compound | Planned | Product registry, lock/exit checks, harvest threshold, receipt reconciliation |

## Runtime Boundaries

| Component | Responsibility | Trust boundary |
| --- | --- | --- |
| Product UI | Mandate setup, strategy review, approval, status, pause, and revoke | Never stores owner or session private keys persistently |
| Strategy engine | Deterministic allocation, opportunity scoring, and guardrails | Cannot sign, broadcast, or alter its mandate |
| Adapter registry | Converts an approved strategy action into protocol-specific calldata | Cannot call a contract or selector outside its reviewed manifest |
| Secure executor | Schedules checks and holds the scoped session signer in an enclave | Cannot exceed the registered Altana permissions |
| Altana session | Enforces contracts, methods, spend caps, expiry, and revoke | Cannot access the owner passkey |
| PancakeSwap | Executes approved Swap, Liquidity, Farms, and Earn actions | Receives only policy-bounded calldata |
| BNB Smart Chain | Stores grants, revocations, transactions, and receipts | Public source of truth |

## Portfolio Review Cycle

1. Read balances, positions, rewards, prices, liquidity, fees, and exit conditions.
2. Reject stale, missing, or divergent market inputs.
3. Recompute the desired sleeve allocation from the immutable mandate version.
4. Compare current positions with targets and opportunity thresholds.
5. Produce `HOLD`, an executable adapter action, or an owner-approval request.
6. Simulate the selected action and recheck every limit immediately before signing.
7. Execute once, reconcile the receipt and balances, then append the decision evidence.

## Production Milestones

### 1. Secure continuous execution

- Run each mandate on a scheduled worker.
- Store the scoped signer only in a hardware-backed enclave or equivalent isolated runtime.
- Use an idempotency key per mandate, adapter, and decision window.
- Lock each mandate during execution to prevent concurrent actions.

### 2. Complete PancakeSwap adapters

- Upgrade Swap routing to the reviewed production router stack.
- Add Infinity liquidity create, increase, decrease, collect, and exit actions.
- Add Farms discovery, stake, unstake, and reward-claim actions.
- Add Earn allocation and compounding only for reviewed products with explicit exit semantics.
- Version each adapter manifest with contracts, selectors, tokens, and risk assumptions.

### 3. Reliable strategy inputs

- Compare route quotes with independent price sources.
- Track LP fee APR separately from incentive APR.
- Model impermanent loss and range-exit probability.
- Deduct gas and execution costs from every expected-return comparison.
- Refuse to optimize from stale, incomplete, or unverifiable data.

### 4. Operational safety

- Never rebroadcast after an ambiguous submission result.
- Reconcile receipts and balances before creating another action.
- Alert on failures, expired grants, cap exhaustion, abnormal price movement, and stuck positions.
- Preserve an append-only decision and execution audit log.
- Require explicit owner approval for every mandate or adapter-version migration.

## Acceptance Criteria

- The same mandate and market snapshot produce the same strategy decision.
- Sleeve allocations always total 100% and remain inside reserve, LP, and position limits.
- A call outside an adapter's approved contract or selector is rejected.
- An action above the relevant spend or turnover limit is rejected.
- An expired or revoked session cannot execute.
- Concurrent checks produce at most one onchain action.
- Every action, approval request, or HOLD has inputs, rationale, policy version, and evidence.
- Planned adapters are never displayed as live.
- No private key appears in browser storage, application logs, or analytics.
