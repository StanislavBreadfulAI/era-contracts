/**
 * Cross-check for `deploy-scripts/upgrade/v31/PatchTotalSupplyV31UpgradeData.s.sol`.
 *
 * Like the Solidity script, this obtains the previous v31 upgrade data **on chain from the Era
 * ChainTypeManager**: it reads `upgradeCutDataBlock` / `newChainCreationParamsBlock`, fetches the
 * `NewUpgradeCutData` / `NewChainCreationParams` events, decodes the previous upgrade cut and
 * chain creation params, and verifies them against the on-chain `upgradeCutHash` / `initialCutHash`.
 *
 * It then re-derives the patch calls exactly like the Solidity script, except the *new* bytecode
 * hashes are read from `AllContractsHashes.json` (the repo's hash tooling output) rather than from
 * the build artifacts. Finally it asserts `keccak256(abi.encode(Call[]))` equals the Solidity
 * script's output — proving the two implementations agree (and, because they source the new hashes
 * differently, that AllContractsHashes.json is consistent with the artifacts).
 *
 * Usage: ts-node scripts/patch-total-supply-crosscheck.ts
 * Requires the RPC env var named in config.json (e.g. TENDERLY_SEPOLIA) to be set.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const L1_ROOT = path.resolve(__dirname, "..");
const PATCH_DIR = path.join(L1_ROOT, "deploy-scripts/upgrade/v31/patch-total-supply");
const ALL_CONTRACTS_HASHES = path.resolve(L1_ROOT, "..", "AllContractsHashes.json");

const abi = ethers.utils.defaultAbiCoder;

const DIAMOND_CUT_TYPE =
  "tuple(tuple(address facet, uint8 action, bool isFreezable, bytes4[] selectors)[] facetCuts, address initAddress, bytes initCalldata)";
const CHAIN_CREATION_PARAMS_TYPE =
  "tuple(address genesisUpgrade, bytes32 genesisBatchHash, uint64 genesisIndexRepeatedStorageChanges, bytes32 genesisBatchCommitment, " +
  DIAMOND_CUT_TYPE +
  " diamondCut, bytes forceDeploymentsData)";
const CALL_ARRAY_TYPE = "tuple(address target, uint256 value, bytes data)[]";

// FixedForceDeploymentsData (only the layout matters for decoding the embedded hashes).
const FFD_TYPE =
  "tuple(uint256 l1ChainId, uint256 gatewayChainId, uint256 eraChainId, address l1AssetRouter, bytes32 l2TokenProxyBytecodeHash, address aliasedL1Governance, uint256 maxNumberOfZKChains, bytes bridgehubBytecodeInfo, bytes l2AssetRouterBytecodeInfo, bytes l2NtvBytecodeInfo, bytes messageRootBytecodeInfo, bytes chainAssetHandlerBytecodeInfo, bytes interopCenterBytecodeInfo, bytes interopHandlerBytecodeInfo, bytes assetTrackerBytecodeInfo, bytes beaconDeployerInfo, bytes baseTokenHolderBytecodeInfo, address l2SharedBridgeLegacyImpl, address l2BridgedStandardERC20Impl, address aliasedChainRegistrationSender, address dangerousTestOnlyForcedBeacon, bytes32 zkTokenAssetId)";

const NEW_CHAIN_CREATION_PARAMS_EVENT =
  "event NewChainCreationParams(address genesisUpgrade, bytes32 genesisBatchHash, uint64 genesisIndexRepeatedStorageChanges, bytes32 genesisBatchCommitment, " +
  DIAMOND_CUT_TYPE +
  " newInitialCut, bytes32 newInitialCutHash, bytes forceDeploymentsData, bytes32 forceDeploymentHash)";

const eventsIface = new ethers.utils.Interface([
  "event NewUpgradeCutData(uint256 indexed protocolVersion, " + DIAMOND_CUT_TYPE + " diamondCutData)",
  NEW_CHAIN_CREATION_PARAMS_EVENT,
]);
const NEW_UPGRADE_CUT_DATA_TOPIC = eventsIface.getEventTopic("NewUpgradeCutData");
const NEW_CHAIN_CREATION_PARAMS_TOPIC = eventsIface.getEventTopic("NewChainCreationParams");

const ctmIface = new ethers.utils.Interface([
  `function setChainCreationParams(${CHAIN_CREATION_PARAMS_TYPE} _chainCreationParams)`,
  `function setUpgradeDiamondCut(${DIAMOND_CUT_TYPE} _cutData, uint256 _oldProtocolVersion)`,
  `function executeUpgrade(uint256 _chainId, ${DIAMOND_CUT_TYPE} _diamondCut)`,
  "function initialCutHash() view returns (bytes32)",
  "function upgradeCutHash(uint256) view returns (bytes32)",
  "function upgradeCutDataBlock(uint256) view returns (uint256)",
  "function newChainCreationParamsBlock(uint256) view returns (uint256)",
]);

// FixedForceDeploymentsData field that holds each force-deploy contract's bytecode hash.
const FFD_FIELD: Record<string, string> = {
  L2AssetTracker: "assetTrackerBytecodeInfo",
  L2Bridgehub: "bridgehubBytecodeInfo",
  L2AssetRouter: "l2AssetRouterBytecodeInfo",
  L2NativeTokenVault: "l2NtvBytecodeInfo",
  L2MessageRoot: "messageRootBytecodeInfo",
  L2ChainAssetHandler: "chainAssetHandlerBytecodeInfo",
  InteropCenter: "interopCenterBytecodeInfo",
  InteropHandler: "interopHandlerBytecodeInfo",
  UpgradeableBeaconDeployer: "beaconDeployerInfo",
  BaseTokenHolder: "baseTokenHolderBytecodeInfo",
};

interface PatchConfig {
  l1RpcUrlEnv: string;
  eraCtm: string;
  oldProtocolVersion: ethers.BigNumber;
  newProtocolVersion: ethers.BigNumber;
  alreadyUpgradedChains: ethers.BigNumber[];
  affectedForceDeployContracts: string[];
}

interface Replacement {
  contractName: string;
  oldHash: string;
  newHash: string;
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadConfig(): PatchConfig {
  const c = readJson(path.join(PATCH_DIR, "config.json"));
  return {
    l1RpcUrlEnv: c.l1RpcUrlEnv,
    eraCtm: c.eraCtm,
    oldProtocolVersion: ethers.BigNumber.from(c.oldProtocolVersion),
    newProtocolVersion: ethers.BigNumber.from(c.newProtocolVersion),
    alreadyUpgradedChains: (c.alreadyUpgradedChains as Array<string | number>).map((x) => ethers.BigNumber.from(x)),
    affectedForceDeployContracts: c.affectedForceDeployContracts,
  };
}

function newHashFromAllContractsHashes(contractName: string): string {
  const all: { contractName: string; zkBytecodeHash: string | null }[] = readJson(ALL_CONTRACTS_HASHES);
  const entry = all.find((c) => c.contractName === `l1-contracts/${contractName}`);
  if (!entry || !entry.zkBytecodeHash) {
    throw new Error(`AllContractsHashes.json missing zkBytecodeHash for l1-contracts/${contractName}`);
  }
  return entry.zkBytecodeHash.toLowerCase();
}

/** Byte-aligned find-and-replace of each 32-byte oldHash with newHash (mirrors Solidity _replaceWord). */
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
        for (let j = 0; j < 32; j++) data[i + j] = newWord[j];
      }
    }
  }
  return ethers.utils.hexlify(Uint8Array.from(data));
}

async function getSingleLog(
  provider: ethers.providers.Provider,
  address: string,
  topics: (string | null)[],
  block: number
): Promise<ethers.providers.Log> {
  const logs = await provider.getLogs({ address, topics, fromBlock: block, toBlock: block });
  if (logs.length !== 1) {
    throw new Error(`expected exactly one log, got ${logs.length}`);
  }
  return logs[0];
}

async function main() {
  const cfg = loadConfig();
  const rpcUrl = process.env[cfg.l1RpcUrlEnv];
  if (!rpcUrl) {
    throw new Error(`RPC env var ${cfg.l1RpcUrlEnv} is not set`);
  }
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const ctm = new ethers.Contract(cfg.eraCtm, ctmIface, provider);

  // --- obtain the previous upgrade data on chain ---
  const cutBlock = (await ctm.upgradeCutDataBlock(cfg.oldProtocolVersion)).toNumber();
  const ccpBlock = (await ctm.newChainCreationParamsBlock(cfg.newProtocolVersion)).toNumber();
  if (cutBlock === 0 || ccpBlock === 0) {
    throw new Error("CTM has no recorded upgrade cut / chain creation params blocks for these versions");
  }

  const cutLog = await getSingleLog(
    provider,
    cfg.eraCtm,
    [NEW_UPGRADE_CUT_DATA_TOPIC, ethers.utils.hexZeroPad(cfg.oldProtocolVersion.toHexString(), 32)],
    cutBlock
  );
  const cutEncoded = cutLog.data; // abi.encode(DiamondCutData)

  const ccpLog = await getSingleLog(provider, cfg.eraCtm, [NEW_CHAIN_CREATION_PARAMS_TOPIC], ccpBlock);
  const ccpEvent = eventsIface.decodeEventLog("NewChainCreationParams", ccpLog.data, ccpLog.topics);
  const chainCreationParams = [
    ccpEvent.genesisUpgrade,
    ccpEvent.genesisBatchHash,
    ccpEvent.genesisIndexRepeatedStorageChanges,
    ccpEvent.genesisBatchCommitment,
    ccpEvent.newInitialCut,
    ccpEvent.forceDeploymentsData,
  ];
  const ccpEncoded = abi.encode([CHAIN_CREATION_PARAMS_TYPE], [chainCreationParams]);

  // --- verify against the on-chain hashes ---
  const onChainCutHash = (await ctm.upgradeCutHash(cfg.oldProtocolVersion)).toLowerCase();
  if (ethers.utils.keccak256(cutEncoded).toLowerCase() !== onChainCutHash) {
    throw new Error("decoded upgrade cut does not match on-chain upgradeCutHash");
  }
  const onChainInitialCutHash = (await ctm.initialCutHash()).toLowerCase();
  if (ethers.utils.keccak256(abi.encode([DIAMOND_CUT_TYPE], [ccpEvent.newInitialCut])).toLowerCase() !== onChainInitialCutHash) {
    throw new Error("decoded initial cut does not match on-chain initialCutHash");
  }

  // --- compute replacements (old from chain, new from AllContractsHashes.json) ---
  const [ffd] = abi.decode([FFD_TYPE], ccpEvent.forceDeploymentsData);
  const replacements: Replacement[] = [];
  for (const name of cfg.affectedForceDeployContracts) {
    let oldHash: string;
    if (name === "BeaconProxy") {
      oldHash = ffd.l2TokenProxyBytecodeHash.toLowerCase();
    } else {
      const field = FFD_FIELD[name];
      if (!field) throw new Error(`unknown force-deploy contract: ${name}`);
      oldHash = abi.decode(["bytes32"], (ffd as any)[field])[0].toLowerCase();
    }
    const newHash = newHashFromAllContractsHashes(name);
    if (oldHash !== newHash) {
      replacements.push({ contractName: name, oldHash, newHash });
    }
  }

  console.log(`Loaded previous v31 upgrade data from CTM: ${cfg.eraCtm}`);
  console.log(`  upgrade cut block: ${cutBlock}, chain creation params block: ${ccpBlock}`);
  console.log(`Bytecode-hash replacements: ${replacements.length}`);
  for (const r of replacements) console.log(`  ${r.contractName}\n    ${r.oldHash}\n    ${r.newHash}`);

  // --- patch and rebuild the calls ---
  const [patchedCut] = abi.decode([DIAMOND_CUT_TYPE], replaceAll(cutEncoded, replacements));
  const [patchedParams] = abi.decode([CHAIN_CREATION_PARAMS_TYPE], replaceAll(ccpEncoded, replacements));

  const calls: Array<[string, ethers.BigNumber, string]> = [];
  calls.push([
    cfg.eraCtm,
    ethers.constants.Zero,
    ctmIface.encodeFunctionData("setUpgradeDiamondCut", [patchedCut, cfg.oldProtocolVersion]),
  ]);
  calls.push([
    cfg.eraCtm,
    ethers.constants.Zero,
    ctmIface.encodeFunctionData("setChainCreationParams", [patchedParams]),
  ]);
  for (const chainId of cfg.alreadyUpgradedChains) {
    calls.push([
      cfg.eraCtm,
      ethers.constants.Zero,
      ctmIface.encodeFunctionData("executeUpgrade", [chainId, patchedCut]),
    ]);
  }

  const encoded = abi.encode([CALL_ARRAY_TYPE], [calls]);
  const keccak = ethers.utils.keccak256(encoded);
  console.log(`Patched call count: ${calls.length}`);
  console.log(`Patched calls keccak: ${keccak}`);

  const outPath = path.join(PATCH_DIR, "patched-calls.ts.json");
  fs.writeFileSync(outPath, JSON.stringify({ encodedCalls: encoded, callsKeccak: keccak }, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);

  const solPath = path.join(PATCH_DIR, "patched-calls.sol.json");
  if (fs.existsSync(solPath)) {
    const sol = readJson(solPath);
    if ((sol.callsKeccak as string).toLowerCase() !== keccak.toLowerCase()) {
      console.error("MISMATCH: TS and Solidity patched calls differ");
      console.error(`  sol keccak: ${(sol.callsKeccak as string).toLowerCase()}`);
      console.error(`  ts  keccak: ${keccak.toLowerCase()}`);
      process.exit(1);
    }
    console.log("CROSS-CHECK OK: TS keccak(abi.encode(Call[])) is identical to the Solidity script output.");
  } else {
    console.log("(Solidity output not found; run the forge script first to cross-check.)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
