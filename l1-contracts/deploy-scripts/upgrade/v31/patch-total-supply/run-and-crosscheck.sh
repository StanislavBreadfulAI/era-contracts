#!/usr/bin/env bash
#
# Reproduces the v31 totalSupply-fix upgrade-data patch with BOTH the Solidity (forge) script
# and the TypeScript cross-check, and asserts they produce identical calls.
#
# Both read the *previous* v31 upgrade data ON CHAIN from the Era ChainTypeManager
# (`config.json` -> `eraCtm`, on the RPC named by `l1RpcUrlEnv`).
#
# Prerequisites:
#   - the RPC env var named in config.json (e.g. TENDERLY_SEPOLIA) is exported,
#   - foundry-zksync (pinned, see ../../../../recompute_hashes.sh) on PATH so `l1-contracts/zkout/*`
#     holds the rebuilt artifacts that carry the fix, and
#   - `AllContractsHashes.json` regenerated with `yarn calculate-hashes:fix`.
#
# Run from the l1-contracts directory:  ./deploy-scripts/upgrade/v31/patch-total-supply/run-and-crosscheck.sh
set -euo pipefail

cd "$(dirname "$0")/../../../.."   # -> l1-contracts

SCRIPT=deploy-scripts/upgrade/v31/PatchTotalSupplyV31UpgradeData.s.sol

echo "==> [1/2] Building the patch calls (forge; previous data from the CTM, new hashes from build artifacts)"
forge script "$SCRIPT" --sig "runCalldata()" --ffi

echo "==> [2/2] Re-deriving the patch calls (TypeScript; previous data from the CTM, new hashes from AllContractsHashes.json) and cross-checking"
npx ts-node scripts/patch-total-supply-crosscheck.ts
