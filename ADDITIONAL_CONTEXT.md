# Additional Context for Reviewing This Codebase

This file captures project-specific context needed to apply REVIEW_GUIDE.md effectively to the era-contracts repository, particularly the Anvil interop test infrastructure.

---

## Chain Topology

The Anvil interop test environment operates multiple ZKSync chains with distinct settlement roles:
- **L1** (Anvil default: chain ID 31337): Ethereum settlement layer
- **Direct-settled chains**: ZKSync chains whose batches are committed directly to L1
- **Gateway chain**: A ZKSync chain that also acts as a settlement layer for other chains
- **GW-settled chains**: ZKSync chains whose batches are committed to the gateway chain instead of L1

Named constants for all chain IDs must exist in the codebase (e.g. `DIRECT_CHAIN_ID`, `GW_CHAIN_ID`). Raw numeric chain IDs in test code are a violation. If a test iterates only over chains of one role, check whether a negative test for the other roles is also needed.

---

## Key Contracts and Their Roles

### L1 / Protocol
- **L1MessageRoot / MessageRootBase**: Aggregates cross-chain message roots for L2→L1 message verification via Merkle proofs. Prefer using real proofs (build a small Merkle tree) over mocking. A `DummyL1MessageRoot` exists as a test-only implementation — it should be deployed via deployment scripts rather than patched into a live address at runtime.
- **InteropCenter**: Handles L2→L2 cross-chain token transfer routing.
- **L1AssetRouter / L1NativeTokenVault**: L1 side of bridging. Tracks per-chain balances. For GW-settled chains, balances are tracked under the gateway's chain ID, not the settled chain's ID — this is a known subtlety that should be documented wherever it affects balance assertions.
- **GWAssetTracker**: Gateway-side tracker; `processLogsAndMessages` must be called by the **operator** (an EOA) in production, not the diamond proxy. Impersonating the diamond proxy is an acceptable short-term workaround, but should be noted as a known gap.

### L2
- **L2AssetRouter**: L2 side of bridging. The `withdraw()` entrypoint is the correct way to initiate withdrawals — do not bypass it by calling `L2NTV.bridgeBurn` directly, even if `withdraw()` is not `payable` on plain EVM/Anvil. Fix the caller or the test setup instead.
- **L2NTV (L2NativeTokenVault)**: Handles native token minting/burning on L2.
- **L2InteropHandler**: Handles incoming interop messages on L2.
- **L2Bridgehub**: L2-side registry of chains.

---

## Balance Tracker Utility

`BalanceTracker` (in `src/helpers/balance-tracker.ts`) is the intended utility for comparing balances before and after operations. It takes snapshots and computes deltas.

- A `BalanceSnapshot` contains: `l1TokenBalance`, `l2TokenBalance`, `l1ChainBalance`, `gwChainBalance`
- All four fields should be asserted in meaningful tests, not just the ones that are convenient
- For GW-settled chains, `l1ChainBalance` internally reads the GW's chain balance — this is a known design limitation. Tests should ideally track both the GW chain balance and the settled chain balance separately.
- When comparing balances inline (before/after subtraction), prefer using the tracker snapshot instead

---

## Proof Verification

The codebase uses Merkle proofs for L2→L1 message verification via `L1MessageRoot`. In test environments it is feasible (and preferred) to:
1. Construct a small Merkle tree from the actual message hashes
2. Pass the real proof to the verification function

Replacing `L1MessageRoot`'s bytecode with a `DummyL1MessageRoot` that skips proof checks diverges from production behavior. If a mock is truly needed, deploy a test-specific implementation from the start via deployment scripts rather than patching bytecode at runtime.

---

## Impersonation Patterns

Anvil supports `hardhat_impersonateAccount` to call contracts as arbitrary addresses. This is used in tests to:
- Call `GWAssetTracker.processLogsAndMessages` by impersonating the diamond proxy (bypasses `onlyChain` modifier)
- Call `L2NTV.bridgeBurn` by impersonating `L2AssetRouter` (bypasses the caller check)

In production:
- `processLogsAndMessages` should be called by the **operator** (an EOA), not the diamond proxy
- Withdrawals should go through `L2AssetRouter.withdraw()` from an EOA

When reviewing: flag any impersonation that impersonates a higher-privilege or more complex entity than necessary.

---

## Common Utilities to Check for Consistent Use

The test infrastructure provides several utilities that should be used consistently rather than re-implemented inline:

| Utility | Purpose |
|---|---|
| `BalanceTracker` / `createBalanceTrackerFromState` | Take snapshots and compute balance deltas; use instead of manual arithmetic |
| `computeBalanceDeltas` | Compute all delta fields from two snapshots at once |
| `queryEthAssetId` | Resolve the ETH asset ID from the deployed NTV contract |
| `getChainIdByRole` / `getChainIdsByRole` | Look up chain IDs by semantic role; use instead of hardcoded literals |
| `encodeNtvAssetId` | Encode an NTV asset ID; use instead of inline `keccak256(abi.encode(...))` |

If code is doing balance arithmetic manually, looking up chains by iterating an array, or encoding asset IDs inline, flag it and suggest using the appropriate utility.

---

## Absolute Rules from Project Guidelines (AGENTS.md)

These are hard requirements specific to this codebase:

### Never kill Anvil globally
Never run `pkill -f anvil` or `killall anvil`. Use the `cleanup.sh` script in the anvil-interop directory.

### Never override storage slots in tests
`anvil_setStorageAt` / `hardhat_setStorageAt` must not be used to bypass contract logic. Use real contract call flows instead. Flag any usage of these APIs in test code.

### Never declare ABIs inline in TypeScript
All ABIs must be imported from the centralized `contracts.ts` file (or equivalent). Inline ABI arrays like `["function someMethod()"]` passed directly to `new Contract(addr, [...], provider)` are forbidden.

### Never use try-catch or staticcall in Solidity
In `.sol` files: `try/catch` blocks and `staticcall` are forbidden — they mask errors. Fail fast instead.

---

## ZKSync-Specific Solidity Rules (from AGENTS.md)

- L2 contracts **do not support constructors or immutables** — everything must be initialized via storage (e.g., `initL2` functions)
- L1 contracts may use immutables; check if the value is deterministically derivable from other contracts before adding a new one
- Never use `try-catch` or `staticcall` — if something reverts, fix the root cause
- Constants belong in `common/Config.sol` (L1) or `Constants.sol` (system-contracts)
