/**
 * Cross-check for `deploy-scripts/upgrade/v31/PatchTotalSupplyV31UpgradeData.s.sol`.
 *
 * The v31 base-token `totalSupply` fix changes the compiled L2AssetTracker bytecode and,
 * transitively, the bytecode of the L2 genesis/upgrade contracts that embed its hash. Those
 * zk bytecode hashes are baked into the v31 upgrade data the Era ChainTypeManager stores
 * (the upgrade `DiamondCutData` and the `ChainCreationParams`).
 *
 * This script independently re-derives the same patch calls the Solidity script produces:
 *   - it reads the *new* bytecode hashes from `AllContractsHashes.json` (the file the repo's
 *     `calculate-hashes` tooling regenerates) instead of from the build artifacts, and
 *   - it reads the same previous-upgrade-data / previous-hashes / config fixtures.
 *
 * It then byte-replaces every stale 32-byte hash, rebuilds the patch calls, and prints the
 * keccak of `abi.encode(Call[])`. `run-and-crosscheck.sh` asserts this equals the Solidity
 * script's output, proving the two implementations agree.
 *
 * Usage: ts-node scripts/patch-total-supply-crosscheck.ts
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const L1_ROOT = path.resolve(__dirname, "..");
const PATCH_DIR = path.join(L1_ROOT, "deploy-scripts/upgrade/v31/patch-total-supply");
const ALL_CONTRACTS_HASHES = path.resolve(L1_ROOT, "..", "AllContractsHashes.json");

// Must match `CANDIDATE_CONTRACTS` in PatchTotalSupplyV31UpgradeData.s.sol.
const CANDIDATE_CONTRACTS = [
  "L2AssetTracker",
  "L2GenesisUpgrade",
  "L2GenesisForceDeploymentsHelper",
  "L2ComplexUpgrader",
  "L2V30TestnetSystemProxiesUpgrade",
  "L2Bridgehub",
  "L2AssetRouter",
  "L2NativeTokenVault",
  "L2MessageRoot",
  "L2ChainAssetHandler",
  "UpgradeableBeaconDeployer",
  "BaseTokenHolder",
  "InteropCenter",
  "InteropHandler",
  "BeaconProxy",
];

const abi = ethers.utils.defaultAbiCoder;

// Struct + function fragments mirroring IChainTypeManager / Diamond.
const DIAMOND_CUT_TYPE =
  "tuple(tuple(address facet, uint8 action, bool isFreezable, bytes4[] selectors)[] facetCuts, address initAddress, bytes initCalldata)";
const CHAIN_CREATION_PARAMS_TYPE =
  "tuple(address genesisUpgrade, bytes32 genesisBatchHash, uint64 genesisIndexRepeatedStorageChanges, bytes32 genesisBatchCommitment, " +
  DIAMOND_CUT_TYPE +
  " diamondCut, bytes forceDeploymentsData)";
const CALL_ARRAY_TYPE = "tuple(address target, uint256 value, bytes data)[]";

const ctmIface = new ethers.utils.Interface([
  `function setNewVersionUpgrade(${DIAMOND_CUT_TYPE} _cutData, uint256 _oldProtocolVersion, uint256 _oldProtocolVersionDeadline, uint256 _newProtocolVersion, address _verifier)`,
  `function setChainCreationParams(${CHAIN_CREATION_PARAMS_TYPE} _chainCreationParams)`,
  `function setUpgradeDiamondCut(${DIAMOND_CUT_TYPE} _cutData, uint256 _oldProtocolVersion)`,
  `function executeUpgrade(uint256 _chainId, ${DIAMOND_CUT_TYPE} _diamondCut)`,
]);

const SELECTORS = {
  setNewVersionUpgrade: ctmIface.getSighash("setNewVersionUpgrade"),
  setChainCreationParams: ctmIface.getSighash("setChainCreationParams"),
};

interface Call {
  target: string;
  value: ethers.BigNumber;
  data: string;
}

interface PatchConfig {
  eraCtm: string;
  oldProtocolVersion: ethers.BigNumber;
  oldProtocolVersionDeadline: ethers.BigNumber;
  newProtocolVersion: ethers.BigNumber;
  verifier: string;
  genesisUpgrade: string;
  l1ChainId: ethers.BigNumber;
  eraChainId: ethers.BigNumber;
  alreadyUpgradedChains: ethers.BigNumber[];
}

interface Replacement {
  contractName: string;
  oldHash: string;
  newHash: string;
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadNewHashes(): Record<string, string> {
  const all: { contractName: string; zkBytecodeHash: string | null }[] = readJson(ALL_CONTRACTS_HASHES);
  const byName = new Map(all.map((c) => [c.contractName, c.zkBytecodeHash]));
  const res: Record<string, string> = {};
  for (const name of CANDIDATE_CONTRACTS) {
    const key = `l1-contracts/${name}`;
    const h = byName.get(key);
    if (!h) {
      throw new Error(`AllContractsHashes.json missing zkBytecodeHash for ${key}`);
    }
    res[name] = h.toLowerCase();
  }
  return res;
}

function computeReplacements(): Replacement[] {
  const prev: Record<string, string> = readJson(path.join(PATCH_DIR, "previous-bytecode-hashes.json"));
  const next = loadNewHashes();
  const out: Replacement[] = [];
  for (const name of CANDIDATE_CONTRACTS) {
    const oldHash = prev[name].toLowerCase();
    const newHash = next[name];
    if (oldHash !== newHash) {
      out.push({ contractName: name, oldHash, newHash });
    }
  }
  return out;
}

/**
 * Replaces every byte-aligned occurrence of each 32-byte oldHash with newHash.
 * Operates on the raw byte array (exactly like the Solidity `_replaceWord` byte scan) so the
 * two implementations cannot diverge on alignment.
 */
function replaceAll(dataHex: string, replacements: Replacement[]): string {
  const data = Array.from(ethers.utils.arrayify(dataHex));
  for (const r of replacements) {
    const oldWord = Array.from(ethers.utils.arrayify(r.oldHash));
    const newWord = Array.from(ethers.utils.arrayify(r.newHash));
    for (let i = 0; i + 32 <= data.length; i++) {
      let matchHere = true;
      for (let j = 0; j < 32; j++) {
        if (data[i + j] !== oldWord[j]) {
          matchHere = false;
          break;
        }
      }
      if (matchHere) {
        for (let j = 0; j < 32; j++) {
          data[i + j] = newWord[j];
        }
      }
    }
  }
  return ethers.utils.hexlify(Uint8Array.from(data));
}

function loadConfig(): PatchConfig {
  const c = readJson(path.join(PATCH_DIR, "config.json"));
  return {
    eraCtm: c.eraCtm,
    oldProtocolVersion: ethers.BigNumber.from(c.oldProtocolVersion),
    oldProtocolVersionDeadline: ethers.BigNumber.from(c.oldProtocolVersionDeadline),
    newProtocolVersion: ethers.BigNumber.from(c.newProtocolVersion),
    verifier: c.verifier,
    genesisUpgrade: c.genesisUpgrade,
    l1ChainId: ethers.BigNumber.from(c.l1ChainId),
    eraChainId: ethers.BigNumber.from(c.eraChainId),
    alreadyUpgradedChains: (c.alreadyUpgradedChains as Array<string | number>).map((x) => ethers.BigNumber.from(x)),
  };
}

function loadPreviousCalls(): Call[] {
  const raw = readJson(path.join(PATCH_DIR, "previous-upgrade-data.json")).calls as string;
  const [decoded] = abi.decode([CALL_ARRAY_TYPE], raw);
  return decoded.map((c: any) => ({ target: c.target, value: c.value, data: c.data }));
}

function main() {
  const cfg = loadConfig();
  const previousCalls = loadPreviousCalls();
  const replacements = computeReplacements();

  console.log(`Bytecode-hash replacements: ${replacements.length}`);
  for (const r of replacements) {
    console.log(`  ${r.contractName}\n    ${r.oldHash}\n    ${r.newHash}`);
  }

  // Locate and patch the Era-CTM calls.
  let patchedCut: any = undefined;
  let patchedChainCreationData: string | undefined = undefined;

  for (const call of previousCalls) {
    if (call.target.toLowerCase() !== cfg.eraCtm.toLowerCase()) {
      continue;
    }
    const selector = call.data.slice(0, 10);
    const patchedData = replaceAll(call.data, replacements);

    if (selector === SELECTORS.setNewVersionUpgrade) {
      // cut is the first (dynamic) parameter; decoding it alone mirrors the Solidity helper.
      const args = "0x" + patchedData.slice(10);
      [patchedCut] = abi.decode([DIAMOND_CUT_TYPE], args);
    } else if (selector === SELECTORS.setChainCreationParams) {
      patchedChainCreationData = patchedData.startsWith("0x") ? patchedData : "0x" + patchedData;
    }
  }

  if (patchedCut === undefined) {
    throw new Error("no setNewVersionUpgrade call in previous data");
  }
  if (patchedChainCreationData === undefined) {
    throw new Error("no setChainCreationParams call in previous data");
  }

  const calls: Call[] = [];
  // 1. Overwrite the stored v31 upgrade cut.
  calls.push({
    target: cfg.eraCtm,
    value: ethers.constants.Zero,
    data: ctmIface.encodeFunctionData("setUpgradeDiamondCut", [patchedCut, cfg.oldProtocolVersion]),
  });
  // 2. Update chain creation params (raw patched calldata).
  calls.push({ target: cfg.eraCtm, value: ethers.constants.Zero, data: patchedChainCreationData });
  // 3. Re-run the upgrade on already-upgraded chains.
  for (const chainId of cfg.alreadyUpgradedChains) {
    calls.push({
      target: cfg.eraCtm,
      value: ethers.constants.Zero,
      data: ctmIface.encodeFunctionData("executeUpgrade", [chainId, patchedCut]),
    });
  }

  const encoded = abi.encode(
    [CALL_ARRAY_TYPE],
    [calls.map((c) => [c.target, c.value, c.data])]
  );
  const keccak = ethers.utils.keccak256(encoded);

  console.log(`Patched call count: ${calls.length}`);
  console.log(`Patched calls keccak: ${keccak}`);

  const outPath = path.join(PATCH_DIR, "patched-calls.ts.json");
  fs.writeFileSync(outPath, JSON.stringify({ encodedCalls: encoded, callsKeccak: keccak }, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);

  // If the Solidity output is present, cross-check it.
  const solPath = path.join(PATCH_DIR, "patched-calls.sol.json");
  if (fs.existsSync(solPath)) {
    const sol = readJson(solPath);
    const solKeccak = (sol.callsKeccak as string).toLowerCase();
    if (solKeccak !== keccak.toLowerCase()) {
      console.error("MISMATCH: TS and Solidity patched calls differ");
      console.error(`  sol keccak: ${solKeccak}`);
      console.error(`  ts  keccak: ${keccak.toLowerCase()}`);
      if (sol.encodedCalls) {
        console.error(`  sol encoded: ${(sol.encodedCalls as string).toLowerCase()}`);
        console.error(`  ts  encoded: ${encoded.toLowerCase()}`);
      }
      process.exit(1);
    }
    console.log("CROSS-CHECK OK: TS keccak(abi.encode(Call[])) is identical to the Solidity script output.");
  } else {
    console.log("(Solidity output not found; run the forge script first to cross-check.)");
  }
}

main();
