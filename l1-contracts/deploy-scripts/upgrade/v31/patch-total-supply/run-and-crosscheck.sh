#!/usr/bin/env bash
#
# Reproduces the v31 totalSupply-fix upgrade-data patch with BOTH the Solidity (forge) script
# and the TypeScript cross-check, and asserts they produce identical calls.
#
# Prerequisites:
#   - foundry-zksync (the pinned version, see ../../../../recompute_hashes.sh) on PATH so that
#     `l1-contracts/zkout/*` contains the rebuilt artifacts that carry the fix, and
#   - `AllContractsHashes.json` regenerated with `yarn calculate-hashes:fix`.
#
# Run from the l1-contracts directory:  ./deploy-scripts/upgrade/v31/patch-total-supply/run-and-crosscheck.sh
set -euo pipefail

cd "$(dirname "$0")/../../../.."   # -> l1-contracts

SCRIPT=deploy-scripts/upgrade/v31/PatchTotalSupplyV31UpgradeData.s.sol

echo "==> [1/3] Generating the example previous-upgrade-data fixture (forge)"
forge script "$SCRIPT" --sig "generateExampleProposal()" --ffi >/dev/null

echo "==> [2/3] Building the patch calls (forge / Solidity, hashes from build artifacts)"
forge script "$SCRIPT" --sig "runCalldata()" --ffi

echo "==> [3/3] Re-deriving the patch calls (TypeScript, hashes from AllContractsHashes.json) and cross-checking"
npx ts-node scripts/patch-total-supply-crosscheck.ts
