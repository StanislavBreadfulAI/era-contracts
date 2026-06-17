# v31 `totalSupply` fix — upgrade-data patch

This directory holds the tooling that patches the **already-deployed v31 upgrade data** after
the base-token `totalSupply` fix in `L2AssetTracker`
(`_needToForceSetAssetMigrationOnL2` no longer reads the base token `totalSupply()` before it
is backfilled).

## Why the upgrade data has to be patched

The fix changes the compiled **L2AssetTracker** bytecode. Several L2 genesis/upgrade contracts
embed the L2AssetTracker bytecode hash, so re-running the hash tooling
(`yarn calculate-hashes:fix`) shows that **more than one** deployed-bytecode (zk) hash changes:
`L2AssetTracker`, `L2GenesisUpgrade`, `L2GenesisForceDeploymentsHelper`, `L2ComplexUpgrader`,
`L2V30TestnetSystemProxiesUpgrade` (every other entry in `AllContractsHashes.json` is identical).

The L2 force-deployment hashes are baked into the v31 upgrade data the Era `ChainTypeManager`
stores:
- the v31 upgrade `DiamondCutData` registered with `setNewVersionUpgrade`, and
- the `ChainCreationParams` set with `setChainCreationParams` (its `forceDeploymentsData`
  embeds the L2 `FixedForceDeploymentsData`, which carries `assetTrackerBytecodeInfo`).

So after the fix we must (a) re-register the corrected upgrade cut, (b) update the chain
creation params used for newly-created chains, and (c) re-run the upgrade on chains that
already executed the buggy v31 upgrade.

## Obtaining the previous upgrade data on chain

The `ChainTypeManager` only keeps the **hashes** of the upgrade cut / chain creation params on
chain (`upgradeCutHash`, `initialCutHash`), but it emits the full data and records the block:

- `setUpgradeDiamondCut` → `emit NewUpgradeCutData(protocolVersion, diamondCutData)` and
  `upgradeCutDataBlock[protocolVersion] = block.number`.
- `setChainCreationParams` → `emit NewChainCreationParams(..., newInitialCut, ..., forceDeploymentsData, ...)`
  and `newChainCreationParamsBlock[protocolVersion] = block.number`.

So both scripts read the previous upgrade data straight from the CTM (no fixture):

1. read `upgradeCutDataBlock[oldProtocolVersion]` and `newChainCreationParamsBlock[newProtocolVersion]`,
2. fetch the `NewUpgradeCutData` / `NewChainCreationParams` events at those blocks
   (`vm.eth_getLogs` in Solidity, `provider.getLogs` in TypeScript),
3. decode the previous upgrade `DiamondCutData` and `ChainCreationParams`, and
4. **verify** them against the stored `upgradeCutHash` / `initialCutHash` (the event data is
   exactly the `abi.encode(...)` that was hashed).

This mirrors how the era-contracts emergency stage-upgrade scripts source the previous proposal
(cf. matter-labs/era-contracts#2213).

## What the scripts do

A zk bytecode hash is a unique 32-byte value, so the patch is a **byte-aligned find-and-replace
of the old hash with the new hash** inside the decoded cut + chain creation params — no fragile
deep re-encoding, and trivial to reproduce in two independent implementations.

- **`PatchTotalSupplyV31UpgradeData.s.sol`** (Solidity / forge) — the authoritative script.
  For each affected force-deployment contract it reads the **old** hash from the on-chain
  `FixedForceDeploymentsData` and the **new** hash from the build artifacts (`zkout/*`),
  replaces every occurrence, and emits the patch `Call[]`:
  1. `setUpgradeDiamondCut(patchedCut, oldProtocolVersion)`
  2. `setChainCreationParams(patchedParams)`
  3. `executeUpgrade(chainId, patchedCut)` for every already-upgraded chain.
- **`../../../../scripts/patch-total-supply-crosscheck.ts`** (TypeScript) — re-derives exactly
  the same `Call[]`, reading the **new** hashes from `AllContractsHashes.json` instead of the
  artifacts, and asserts `keccak256(abi.encode(Call[]))` equals the Solidity output. Because the
  two implementations source the new hashes differently, an identical result also proves
  `AllContractsHashes.json` is consistent with the artifacts.

## Config (`config.json`)

| field | meaning |
| --- | --- |
| `l1RpcUrlEnv` | name of the env var holding the L1 RPC URL (e.g. `TENDERLY_SEPOLIA`) |
| `eraCtm` | Era `ChainTypeManager` address |
| `oldProtocolVersion` / `newProtocolVersion` | the versions the v31 upgrade goes from / to |
| `alreadyUpgradedChains` | chain ids already on v31 that must re-run the upgrade |
| `affectedForceDeployContracts` | force-deployment contracts whose bytecode the fix changed (`["L2AssetTracker"]`) |

The defaults target the **stage Era CTM on Sepolia** (`0x8b448ac7…`), which is on v31
(`0x1f00000000`) and upgrades chains from `0x1d00000004` (0.29.4).

## Outputs (git-ignored, regenerated on each run)

- `patched-calls.sol.json` / `patched-calls.ts.json` — `{ encodedCalls, callsKeccak }`.

## Reproduce

From `l1-contracts/` (with the RPC env var exported, the pinned foundry-zksync on `PATH`, the
`zkout` artifacts rebuilt with the fix, and `AllContractsHashes.json` regenerated):

```bash
./deploy-scripts/upgrade/v31/patch-total-supply/run-and-crosscheck.sh
# or:
yarn patch-total-supply:crosscheck
```

The run ends with `CROSS-CHECK OK` when the Solidity and TypeScript outputs match.

## Notes

- The new hashes come from the local build artifacts / `AllContractsHashes.json`, so they must be
  built from the **same era-contracts revision that was deployed** plus the fix. Against an
  environment built from a different revision the script still demonstrates the on-chain
  retrieval, the hash verification, and an identical forge/TS result, but the operator must build
  from the deployed revision to produce deployable calldata.
- Executing the emitted calls (via the ProtocolUpgradeHandler / a fork simulation) is the next
  step for an operator and is out of scope here — this tooling generates and cross-checks the
  calldata.
