// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// solhint-disable no-console, gas-custom-errors

import {Script, console2} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {Diamond} from "contracts/state-transition/libraries/Diamond.sol";
import {ChainCreationParams, IChainTypeManager} from "contracts/state-transition/IChainTypeManager.sol";
import {FixedForceDeploymentsData} from "contracts/state-transition/l2-deps/IL2GenesisUpgrade.sol";
import {L2ContractHelper} from "contracts/common/l2-helpers/L2ContractHelper.sol";

import {IProtocolUpgradeHandler} from "../../interfaces/IProtocolUpgradeHandler.sol";

/// @dev Minimal view surface of the Era `ChainTypeManager` used to locate the previous
///      v31 upgrade data on chain. `upgradeCutDataBlock` / `newChainCreationParamsBlock`
///      are public mappings on `ChainTypeManagerBase` (not in `IChainTypeManager`).
interface ICTMReader {
    function initialCutHash() external view returns (bytes32);

    function upgradeCutHash(uint256 protocolVersion) external view returns (bytes32);

    function upgradeCutDataBlock(uint256 protocolVersion) external view returns (uint256);

    function newChainCreationParamsBlock(uint256 protocolVersion) external view returns (uint256);
}

/// @notice One-off patch proposal for the v31 base-token `totalSupply` fix.
///
/// The fix (`L2AssetTracker._needToForceSetAssetMigrationOnL2` no longer reads the base
/// token `totalSupply()` before it is backfilled) changes the compiled L2AssetTracker
/// bytecode. Its zk bytecode hash is baked into the v31 upgrade data the Era
/// `ChainTypeManager` stores:
///   - the v31 upgrade `DiamondCutData` (registered with `setNewVersionUpgrade`), and
///   - the `ChainCreationParams` (`setChainCreationParams`) used for newly-created chains.
///
/// The `ChainTypeManager` only keeps the *hashes* of those structs on chain, but it emits
/// the full data in `NewUpgradeCutData` / `NewChainCreationParams` and records the block in
/// which it did so (`upgradeCutDataBlock` / `newChainCreationParamsBlock`). This script reads
/// those blocks, fetches the events with `vm.eth_getLogs`, decodes the previous upgrade data,
/// and verifies it against the stored hashes — i.e. it **obtains the previous upgrade calldata
/// on chain from the CTM**, the way the era-contracts emergency stage-upgrade scripts do
/// (cf. matter-labs/era-contracts#2213).
///
/// It then swaps every stale L2 bytecode hash for the freshly-built one (a zk bytecode hash is
/// a unique 32-byte value, so a byte-aligned find-and-replace is unambiguous) and emits the
/// patch calls:
///   1. `setUpgradeDiamondCut(patchedCut, oldProtocolVersion)`
///   2. `setChainCreationParams(patchedParams)`
///   3. `executeUpgrade(chainId, patchedCut)` for every already-upgraded chain.
///
/// `scripts/patch-total-supply-crosscheck.ts` reads the same events from the same RPC and
/// re-derives the identical `Call[]`, asserting `keccak256(abi.encode(Call[]))` matches.
contract PatchTotalSupplyV31UpgradeData is Script {
    using stdJson for string;

    // keccak256("NewUpgradeCutData(uint256,((address,uint8,bool,bytes4[])[],address,bytes))")
    bytes32 internal constant NEW_UPGRADE_CUT_DATA_TOPIC =
        0xf99295383247eabb6bee8798669fa768502f8843d3be0e82a0aa81d7b6c4f60c;
    // keccak256("NewChainCreationParams(address,bytes32,uint64,bytes32,((address,uint8,bool,bytes4[])[],address,bytes),bytes32,bytes,bytes32)")
    bytes32 internal constant NEW_CHAIN_CREATION_PARAMS_TOPIC =
        0x78533eeda9f2d7a68099b21fd160302020d3e480e3646d52e2098122b8fff34f;

    struct PatchConfig {
        string l1RpcUrlEnv;
        address eraCtm;
        uint256 oldProtocolVersion;
        uint256 newProtocolVersion;
        uint256[] alreadyUpgradedChains;
        string[] affectedForceDeployContracts;
    }

    struct Replacement {
        string contractName;
        bytes32 oldHash;
        bytes32 newHash;
    }

    struct PreviousData {
        bytes cutEncoded; // abi.encode(DiamondCutData) — the stored v31 upgrade cut
        bytes ccpEncoded; // abi.encode(ChainCreationParams)
    }

    /// @notice Reads the previous v31 upgrade data on chain, patches the L2 bytecode hashes,
    ///         and writes the resulting calls to `patch-total-supply/patched-calls.sol.json`.
    function runCalldata() external {
        string memory dir = _patchDir();
        PatchConfig memory cfg = _loadConfig(dir);

        vm.createSelectFork(vm.envString(cfg.l1RpcUrlEnv));

        PreviousData memory prev = _fetchAndVerifyPreviousData(cfg);
        Replacement[] memory replacements = _computeReplacements(prev, cfg);
        _logReplacements(replacements);

        IProtocolUpgradeHandler.Call[] memory patchedCalls = _buildPatchedCalls(prev, replacements, cfg);
        _writeOutput(dir, abi.encode(patchedCalls), patchedCalls.length);
    }

    /*//////////////////////////////////////////////////////////////
                       On-chain data retrieval
    //////////////////////////////////////////////////////////////*/

    function _fetchAndVerifyPreviousData(PatchConfig memory cfg) internal returns (PreviousData memory prev) {
        ICTMReader ctm = ICTMReader(cfg.eraCtm);

        uint256 cutBlock = ctm.upgradeCutDataBlock(cfg.oldProtocolVersion);
        uint256 ccpBlock = ctm.newChainCreationParamsBlock(cfg.newProtocolVersion);
        require(cutBlock != 0, "no upgrade cut recorded for oldProtocolVersion");
        require(ccpBlock != 0, "no chain creation params recorded for newProtocolVersion");

        prev.cutEncoded = _fetchUpgradeCutData(cfg.eraCtm, cutBlock, cfg.oldProtocolVersion);
        prev.ccpEncoded = _fetchChainCreationParams(cfg.eraCtm, ccpBlock);

        // The CTM stores keccak256(abi.encode(...)); the event data is exactly that encoding.
        require(
            keccak256(prev.cutEncoded) == ctm.upgradeCutHash(cfg.oldProtocolVersion),
            "decoded upgrade cut does not match on-chain upgradeCutHash"
        );
        Diamond.DiamondCutData memory initialCut = _decodeChainCreationParams(prev.ccpEncoded).diamondCut;
        require(
            keccak256(abi.encode(initialCut)) == ctm.initialCutHash(),
            "decoded initial cut does not match on-chain initialCutHash"
        );

        console2.log("Loaded previous v31 upgrade data from CTM:", cfg.eraCtm);
        console2.log("  upgrade cut block:", cutBlock);
        console2.log("  chain creation params block:", ccpBlock);
    }

    /// @dev `NewUpgradeCutData(uint256 indexed protocolVersion, DiamondCutData diamondCutData)`:
    ///      the only non-indexed field is the cut, so `log.data == abi.encode(cut)`.
    function _fetchUpgradeCutData(
        address ctm,
        uint256 blockNumber,
        uint256 oldProtocolVersion
    ) internal returns (bytes memory) {
        bytes32[] memory topics = new bytes32[](2);
        topics[0] = NEW_UPGRADE_CUT_DATA_TOPIC;
        topics[1] = bytes32(oldProtocolVersion);
        Vm.EthGetLogs[] memory logs = vm.eth_getLogs(blockNumber, blockNumber, ctm, topics);
        require(logs.length == 1, "expected exactly one NewUpgradeCutData log");
        return logs[0].data;
    }

    /// @dev `NewChainCreationParams(...)` has no indexed fields; `log.data` is the abi.encode of
    ///      the full tuple. We reconstruct `ChainCreationParams` and return `abi.encode(params)`.
    function _fetchChainCreationParams(address ctm, uint256 blockNumber) internal returns (bytes memory) {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = NEW_CHAIN_CREATION_PARAMS_TOPIC;
        Vm.EthGetLogs[] memory logs = vm.eth_getLogs(blockNumber, blockNumber, ctm, topics);
        require(logs.length == 1, "expected exactly one NewChainCreationParams log");
        return abi.encode(_chainCreationParamsFromEvent(logs[0].data));
    }

    function _chainCreationParamsFromEvent(bytes memory data) internal pure returns (ChainCreationParams memory p) {
        (
            address genesisUpgrade,
            bytes32 genesisBatchHash,
            uint64 genesisIndexRepeatedStorageChanges,
            bytes32 genesisBatchCommitment,
            Diamond.DiamondCutData memory newInitialCut,
            ,
            bytes memory forceDeploymentsData,

        ) = abi.decode(
                data,
                (address, bytes32, uint64, bytes32, Diamond.DiamondCutData, bytes32, bytes, bytes32)
            );
        p.genesisUpgrade = genesisUpgrade;
        p.genesisBatchHash = genesisBatchHash;
        p.genesisIndexRepeatedStorageChanges = genesisIndexRepeatedStorageChanges;
        p.genesisBatchCommitment = genesisBatchCommitment;
        p.diamondCut = newInitialCut;
        p.forceDeploymentsData = forceDeploymentsData;
    }

    /*//////////////////////////////////////////////////////////////
                           Core patch logic
    //////////////////////////////////////////////////////////////*/

    /// @dev For each affected force-deployment contract, the OLD hash is the value currently
    ///      embedded in the on-chain `FixedForceDeploymentsData`, and the NEW hash is computed
    ///      from the freshly-built artifacts. Only contracts whose hash actually changed are
    ///      returned.
    function _computeReplacements(
        PreviousData memory prev,
        PatchConfig memory cfg
    ) internal view returns (Replacement[] memory) {
        FixedForceDeploymentsData memory ffd = abi.decode(
            _decodeChainCreationParams(prev.ccpEncoded).forceDeploymentsData,
            (FixedForceDeploymentsData)
        );

        Replacement[] memory tmp = new Replacement[](cfg.affectedForceDeployContracts.length);
        uint256 count;
        for (uint256 i = 0; i < cfg.affectedForceDeployContracts.length; ++i) {
            string memory name = cfg.affectedForceDeployContracts[i];
            bytes32 oldHash = _onChainForceDeployHash(ffd, name);
            bytes32 newHash = _currentZkBytecodeHash(name);
            if (oldHash != newHash) {
                tmp[count++] = Replacement({contractName: name, oldHash: oldHash, newHash: newHash});
            }
        }

        Replacement[] memory out = new Replacement[](count);
        for (uint256 i = 0; i < count; ++i) {
            out[i] = tmp[i];
        }
        return out;
    }

    function _buildPatchedCalls(
        PreviousData memory prev,
        Replacement[] memory replacements,
        PatchConfig memory cfg
    ) internal pure returns (IProtocolUpgradeHandler.Call[] memory) {
        // Patch every occurrence of each stale hash in both encoded blobs, then decode back.
        Diamond.DiamondCutData memory patchedCut = abi.decode(
            _replaceAll(prev.cutEncoded, replacements),
            (Diamond.DiamondCutData)
        );
        ChainCreationParams memory patchedParams = _decodeChainCreationParams(
            _replaceAll(prev.ccpEncoded, replacements)
        );

        uint256 n = 2 + cfg.alreadyUpgradedChains.length;
        IProtocolUpgradeHandler.Call[] memory calls = new IProtocolUpgradeHandler.Call[](n);

        calls[0] = IProtocolUpgradeHandler.Call({
            target: cfg.eraCtm,
            value: 0,
            data: abi.encodeCall(IChainTypeManager.setUpgradeDiamondCut, (patchedCut, cfg.oldProtocolVersion))
        });
        calls[1] = IProtocolUpgradeHandler.Call({
            target: cfg.eraCtm,
            value: 0,
            data: abi.encodeCall(IChainTypeManager.setChainCreationParams, (patchedParams))
        });
        for (uint256 i = 0; i < cfg.alreadyUpgradedChains.length; ++i) {
            calls[2 + i] = IProtocolUpgradeHandler.Call({
                target: cfg.eraCtm,
                value: 0,
                data: abi.encodeCall(IChainTypeManager.executeUpgrade, (cfg.alreadyUpgradedChains[i], patchedCut))
            });
        }
        return calls;
    }

    /// @dev Replaces every byte-aligned occurrence of each `oldHash` with its `newHash`.
    function _replaceAll(bytes memory data, Replacement[] memory replacements) internal pure returns (bytes memory) {
        for (uint256 r = 0; r < replacements.length; ++r) {
            _replaceWord(data, replacements[r].oldHash, replacements[r].newHash);
        }
        return data;
    }

    function _replaceWord(bytes memory data, bytes32 oldWord, bytes32 newWord) internal pure {
        if (data.length < 32) {
            return;
        }
        for (uint256 i = 0; i + 32 <= data.length; ++i) {
            bool matchHere = true;
            for (uint256 j = 0; j < 32; ++j) {
                if (data[i + j] != oldWord[j]) {
                    matchHere = false;
                    break;
                }
            }
            if (matchHere) {
                for (uint256 j = 0; j < 32; ++j) {
                    data[i + j] = newWord[j];
                }
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                              Helpers
    //////////////////////////////////////////////////////////////*/

    function _decodeChainCreationParams(bytes memory encoded) internal pure returns (ChainCreationParams memory p) {
        p = abi.decode(encoded, (ChainCreationParams));
    }

    /// @dev Returns the bytecode hash currently embedded in the on-chain `FixedForceDeploymentsData`
    ///      for `contractName`. The `*Info` fields are `abi.encode(bytes32)`.
    function _onChainForceDeployHash(
        FixedForceDeploymentsData memory ffd,
        string memory contractName
    ) internal pure returns (bytes32) {
        bytes32 n = keccak256(bytes(contractName));
        if (n == keccak256("L2AssetTracker")) return abi.decode(ffd.assetTrackerBytecodeInfo, (bytes32));
        if (n == keccak256("BeaconProxy")) return ffd.l2TokenProxyBytecodeHash;
        if (n == keccak256("L2Bridgehub")) return abi.decode(ffd.bridgehubBytecodeInfo, (bytes32));
        if (n == keccak256("L2AssetRouter")) return abi.decode(ffd.l2AssetRouterBytecodeInfo, (bytes32));
        if (n == keccak256("L2NativeTokenVault")) return abi.decode(ffd.l2NtvBytecodeInfo, (bytes32));
        if (n == keccak256("L2MessageRoot")) return abi.decode(ffd.messageRootBytecodeInfo, (bytes32));
        if (n == keccak256("L2ChainAssetHandler")) return abi.decode(ffd.chainAssetHandlerBytecodeInfo, (bytes32));
        if (n == keccak256("InteropCenter")) return abi.decode(ffd.interopCenterBytecodeInfo, (bytes32));
        if (n == keccak256("InteropHandler")) return abi.decode(ffd.interopHandlerBytecodeInfo, (bytes32));
        if (n == keccak256("UpgradeableBeaconDeployer")) return abi.decode(ffd.beaconDeployerInfo, (bytes32));
        if (n == keccak256("BaseTokenHolder")) return abi.decode(ffd.baseTokenHolderBytecodeInfo, (bytes32));
        revert(string.concat("unknown force-deploy contract: ", contractName));
    }

    function _currentZkBytecodeHash(string memory contractName) internal view returns (bytes32) {
        string memory path = string.concat(vm.projectRoot(), "/zkout/", contractName, ".sol/", contractName, ".json");
        string memory json = vm.readFile(path);
        return L2ContractHelper.hashL2Bytecode(json.readBytes(".bytecode.object"));
    }

    function _writeOutput(string memory dir, bytes memory encoded, uint256 callCount) internal {
        console2.log("Patched call count:", callCount);
        console2.log("Patched calls keccak:");
        console2.logBytes32(keccak256(encoded));

        string memory obj = "patched";
        vm.serializeBytes(obj, "encodedCalls", encoded);
        string memory json = vm.serializeBytes32(obj, "callsKeccak", keccak256(encoded));
        string memory out = string.concat(dir, "/patched-calls.sol.json");
        vm.writeJson(json, out);
        console2.log("Wrote", out);
    }

    function _loadConfig(string memory dir) internal view returns (PatchConfig memory cfg) {
        string memory json = vm.readFile(string.concat(dir, "/config.json"));
        cfg.l1RpcUrlEnv = json.readString(".l1RpcUrlEnv");
        cfg.eraCtm = json.readAddress(".eraCtm");
        cfg.oldProtocolVersion = json.readUint(".oldProtocolVersion");
        cfg.newProtocolVersion = json.readUint(".newProtocolVersion");
        cfg.alreadyUpgradedChains = json.readUintArray(".alreadyUpgradedChains");
        cfg.affectedForceDeployContracts = json.readStringArray(".affectedForceDeployContracts");
    }

    function _logReplacements(Replacement[] memory replacements) internal pure {
        console2.log("Bytecode-hash replacements:", replacements.length);
        for (uint256 i = 0; i < replacements.length; ++i) {
            console2.log(string.concat("  ", replacements[i].contractName));
            console2.logBytes32(replacements[i].oldHash);
            console2.logBytes32(replacements[i].newHash);
        }
    }

    function _patchDir() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deploy-scripts/upgrade/v31/patch-total-supply");
    }
}
