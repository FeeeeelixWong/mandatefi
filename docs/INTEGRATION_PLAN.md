# MandateFi Production Integration Plan

## Objective

Turn the current BSC Testnet proof into a secure, observable, always-on AI DeFi portfolio manager while preserving the owner's explicit mandate.

## Strategy and Execution Are Separate

The strategy engine can already compose a complete portfolio across reserve, spot, liquidity, and farm/earn sleeves. Each sleeve is executed through an isolated adapter so an unfinished integration can never be mistaken for live authority.

| Adapter | Responsibility | Current coverage | Production completion |
| --- | --- | --- | --- |
| Swap | Build spot and reserve baskets | Live on BSC Testnet | Universal Router/Permit2 review, route simulation, broader token registry |
| V2 Liquidity | Create and exit CAKE/WBNB LP positions | Live activation and owner exit on BSC Testnet | Mainnet pair registry, fee and IL accounting, migration simulation |
| Farms | Stake and withdraw CAKE/WBNB LP in MasterChef V2 PID 4 | Live activation and owner exit on BSC Testnet | Farm discovery, reward valuation, harvest and migration paths |
| Earn | Deposit and withdraw CAKE in the flexible CakePool | Live activation and owner exit on BSC Testnet | Product registry, compound threshold, reward accounting, audited mainnet product selection |

## Runtime Boundaries

| Component | Responsibility | Trust boundary |
| --- | --- | --- |
| Product UI | Mandate setup, strategy review, approval, status, pause, and revoke | Never stores owner or session private keys persistently |
| Trigger engine | Lightweight schedule, drift, event, cash-flow, and expiry scans | Cannot recommend or execute a transaction |
| Expert model endpoint | Produces a schema-validated typed recommendation from the versioned prompt | Cannot sign, broadcast, create arbitrary calldata, or alter its mandate |
| Strategy and risk gate | Deterministic allocation, adapter coverage, cooldown, and guardrails | Cannot sign, broadcast, or expand authority |
| Adapter registry | Converts an approved strategy action into protocol-specific calldata | Cannot call a contract or selector outside its reviewed manifest |
| Secure executor | Schedules checks and holds the scoped session signer in an enclave | Cannot exceed the registered Altana permissions |
| Altana session | Enforces contracts, methods, spend caps, expiry, and revoke | Cannot access the owner passkey |
| PancakeSwap | Executes approved Swap, Liquidity, Farms, and Earn actions | Receives only policy-bounded calldata |
| BNB Smart Chain | Stores grants, revocations, transactions, and receipts | Public source of truth |

## Portfolio Review Cycle

1. Scan schedule, drift, market-risk, cash-flow, and expiry triggers without trading.
2. Read balances, positions, rewards, prices, liquidity, fees, and exit conditions only when a review is triggered.
3. Reject stale, missing, or divergent market inputs.
4. Recompute the desired sleeve allocation from the immutable mandate version.
5. Submit normalized inputs to the server-side, versioned expert prompt and validate its typed response.
6. Apply the deterministic mandate, cooldown, and adapter-coverage gate.
7. Simulate the selected action and recheck every limit immediately before signing.
8. Execute once, reconcile the receipt and balances, then append the decision evidence.

## Production Milestones

### 1. Secure continuous execution

- Run each mandate on a scheduled worker.
- Store the scoped signer only in a hardware-backed enclave or equivalent isolated runtime.
- Use an idempotency key per mandate, adapter, and decision window.
- Lock each mandate during execution to prevent concurrent actions.

### 2. Productionize PancakeSwap adapters

- Upgrade Swap routing to the reviewed production router stack.
- Add Infinity liquidity create, increase, decrease, collect, and exit actions after the V2 reference path is audited.
- Extend the live Farm stake/withdraw path with discovery, reward valuation, harvest, and migration.
- Extend the live flexible CakePool deposit/withdraw path with a reviewed product registry and cost-aware compounding.
- Version each adapter manifest with contracts, selectors, tokens, and risk assumptions.

### 3. Reliable strategy inputs

- Compare route quotes with independent price sources.
- Track LP fee APR separately from incentive APR.
- Model impermanent loss and range-exit probability.
- Deduct gas and execution costs from every expected-return comparison.
- Refuse to optimize from stale, incomplete, or unverifiable data.
- Version model prompts and validate every response before the deterministic gate.
- Keep model credentials and prompt execution on the server, outside the static client.

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
- Activation adapters are displayed as live only when they have an execution call, position reader, receipt, and owner exit path.
- No private key appears in browser storage, application logs, or analytics.
