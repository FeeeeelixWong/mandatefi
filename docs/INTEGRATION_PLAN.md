# MandateFi Integration Plan

## Objective

Replace every scenario-only element in the prototype with inspectable BNB Smart Chain evidence while preserving a clear custody boundary.

## Runtime Boundaries

| Component | Responsibility | Trust boundary |
| --- | --- | --- |
| Marketplace web app | Discovery, comparison, mandate authoring, revoke UI | Never stores owner private keys |
| Catalog adapter | Normalizes agent identity, reputation, and activity | Read-only data from 8004scan and Agent Studio |
| Mandate service | Validates cap, allowed contracts, expiry, and requested call | Rejects any call outside the signed policy |
| Altana session | Gives the agent temporary scoped authority | Revocable by the owner; expires automatically |
| Strategy agent | Produces a deterministic action proposal | Cannot expand its own authority |
| BSC contracts | Execute selected protocol calls and emit receipts | Publicly inspectable source of truth |

## Phase 1: Data

1. ✅ Connect to the anonymous 8004scan API with runtime schema validation.
2. ✅ Show the live BNB identity count, latest registrations, provenance, and source status.
3. Obtain the hackathon 8004scan Pro API credential for higher rate limits.
4. Map each MandateFi strategy to a registered identity and raw evidence source.
5. Replace `src/data/agents.ts` scenario values only after comparable measured evidence exists.

## Phase 2: Bounded Activation

1. ✅ Connect an EIP-1193 owner wallet and enforce BSC Testnet chain ID 97.
2. ✅ Read the owner's native tBNB balance from BSC Testnet.
3. ✅ Pin the initial safe verification target to Altana KeyStore `isValidKey(address,bytes32)`: zero call value, `0.003 tBNB/day` native gas cap, and no token or protocol spend permission.
4. ✅ Build a public passkey-controlled session with an explicit expiry.
5. ✅ Implement public session registration in the Altana KeyStore.
6. ✅ Implement a session-signed verification call and explorer evidence links.
7. ✅ Implement passkey-authorized revoke and persistence of the revoke receipt.
8. Run the funded browser flow and publish its grant, execute, and revoke transaction hashes.
9. Pin verified PancakeSwap/Venus/Lista contract addresses and token-specific spend limits before enabling strategy execution.

## Phase 3: Strategy Proof

Implement one deterministic action per category before expanding sophistication:

- **Rebalancing:** detect an out-of-range PancakeSwap V3 position and propose a bounded rebalance.
- **Grid Trading:** place one grid leg inside an owner-defined inventory limit.
- **Yield Optimisation:** compare net APY and move only when the configured hurdle is met.
- **Health Factor:** simulate a Venus position and submit one allowed protective action.

Each action record must include inputs, decision, requested authority, transaction hash, outcome, and owner-visible receipt.

## Acceptance Tests

- The permission builder exposes only the pinned KeyStore verification selector.
- A call over the capital limit is rejected.
- An expired or revoked session cannot execute.
- A permitted action produces a BSC Testnet transaction and receipt.
- Marketplace metrics link to their raw source.
- Every demo path can be repeated from a clean wallet.

## Implemented frontend boundaries

- `src/hooks/useInjectedWallet.ts`: injected-wallet lifecycle, account/chain events, network switching, and balance refresh.
- `src/services/erc8004.ts`: public 8004scan API boundary with Zod validation.
- `src/data/agents.ts`: explicitly simulated strategy catalog until every agent has a registered identity and measured execution evidence.
- `src/integrations/altana.ts`: passkey wallet persistence, public session grant, session verification execution, and revoke.
- `src/hooks/useAltanaWallet.ts`: browser lifecycle, funding, progress, balance, and safe error handling.
