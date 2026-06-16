// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// solhint-disable no-console, gas-custom-errors

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {Diamond} from "contracts/state-transition/libraries/Diamond.sol";
import {ChainCreationParams, IChainTypeManager} from "contracts/state-transition/IChainTypeManager.sol";
import {FixedForceDeploymentsData} from "contracts/state-transition/l2-deps/IL2GenesisUpgrade.sol";
import {L2ContractHelper} from "contracts/common/l2-helpers/L2ContractHelper.sol";

import {IProtocolUpgradeHandler} from "../../interfaces/IProtocolUpgradeHandler.sol";

/// @notice One-off patch proposal for the v31 base-token `totalSupply` fix.
///
/// The fix (`L2AssetTracker._needToForceSetAssetMigrationOnL2` no longer reads the base
/// token `totalSupply()` before it is backfilled) changes the compiled L2AssetTracker
/// bytecode. Because several L2 genesis/upgrade contracts embed the L2AssetTracker
/// bytecode hash in their own bytecode, *more than one* deployed-bytecode hash changes
/// (see `patch-total-supply/README.md`).
///
/// Those zk bytecode hashes are baked into the v31 upgrade data that the Era
/// `ChainTypeManager` stores:
///   - the stored v31 upgrade `DiamondCutData` (registered with `setNewVersionUpgrade`),
///     whose post-upgrade calldata embeds the L2 `FixedForceDeploymentsData`; and
///   - the `ChainCreationParams` (`setChainCreationParams`) used for newly-created chains,
///     whose `forceDeploymentsData` embeds the same `FixedForceDeploymentsData`.
///
/// This script takes the *previous* v31 upgrade proposal (the `IProtocolUpgradeHandler.Call[]`
/// that was emitted when v31 was rolled out), swaps every stale L2 bytecode hash for the
/// freshly-built one, and emits the calls needed to:
///   1. re-register the corrected v31 upgrade cut (`setUpgradeDiamondCut`),
///   2. update the chain creation params (`setChainCreationParams`), and
///   3. re-run the upgrade on chains that already executed the buggy v31 upgrade
///      (`executeUpgrade`).
///
/// The replacement is done at the raw-bytes level: a zk bytecode hash is a unique 32-byte
/// value, so finding the old hash and writing the new one in its place is unambiguous and,
/// crucially, trivial to reproduce in an independent implementation. The companion
/// `scripts/patch-total-supply-crosscheck.ts` performs the exact same transformation and
/// the two outputs are asserted to be byte-for-byte identical
/// (see `patch-total-supply/run-and-crosscheck.sh`).
contract PatchTotalSupplyV31UpgradeData is Script {
    using stdJson for string;

    /// @dev Every L2 force-deployment / genesis-upgrade contract whose zk bytecode hash can
    ///      appear in the v31 upgrade data. The script computes each one's *current* hash
    ///      from the build artifacts and compares it with the *previous* hash (read from the
    ///      `previous-bytecode-hashes.json` fixture); whatever differs is replaced.
    ///
    ///      Keeping the full list (not just `L2AssetTracker`) is deliberate: the contracts
    ///      that embed the asset-tracker hash also change, and listing them here makes the
    ///      script discover that automatically instead of hard-coding "only asset tracker".
    string[] internal CANDIDATE_CONTRACTS = [
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
        "BeaconProxy"
    ];

    struct Replacement {
        string contractName;
        bytes32 oldHash;
        bytes32 newHash;
    }

    /// @notice Entry point: read the previous upgrade data, patch it and write the resulting
    ///         calls to `patch-total-supply/patched-calls.sol.json` (also logged to stdout).
    function runCalldata() external {
        string memory dir = _patchDir();
        Replacement[] memory replacements = _computeReplacements(dir);
        _logReplacements(replacements);

        IProtocolUpgradeHandler.Call[] memory patchedCalls = _buildPatchedCalls(
            _loadPreviousCalls(dir),
            replacements,
            _loadConfig(dir)
        );

        _writeOutput(dir, abi.encode(patchedCalls), patchedCalls.length);
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

    /// @notice Helper that (re)generates the example previous-upgrade-data fixture using the
    ///         *previous* bytecode hashes, so the whole flow is reproducible from scratch.
    ///         Not part of the real proposal — see README.
    function generateExampleProposal() external {
        string memory dir = _patchDir();
        PatchConfig memory cfg = _loadConfig(dir);
        string memory prevJson = vm.readFile(string.concat(dir, "/previous-bytecode-hashes.json"));

        bytes memory forceDeploymentsData = abi.encode(_buildExampleForceDeployments(prevJson, cfg));
        Diamond.DiamondCutData memory cut = _buildExampleCut(prevJson, cfg, forceDeploymentsData);

        IProtocolUpgradeHandler.Call[] memory calls = _buildExampleCalls(cfg, cut, forceDeploymentsData);

        string memory out = string.concat(dir, "/previous-upgrade-data.json");
        string memory json = "prev";
        json = json.serialize("calls", abi.encode(calls));
        vm.writeJson(json, out);
        console2.log("Wrote example proposal to", out);
    }

    /// @dev Representative `FixedForceDeploymentsData` carrying the previous L2 hashes.
    function _buildExampleForceDeployments(
        string memory prevJson,
        PatchConfig memory cfg
    ) internal pure returns (FixedForceDeploymentsData memory ffd) {
        ffd.l1ChainId = cfg.l1ChainId;
        ffd.eraChainId = cfg.eraChainId;
        ffd.l2TokenProxyBytecodeHash = _readPrev(prevJson, "BeaconProxy");
        ffd.bridgehubBytecodeInfo = abi.encode(_readPrev(prevJson, "L2Bridgehub"));
        ffd.l2AssetRouterBytecodeInfo = abi.encode(_readPrev(prevJson, "L2AssetRouter"));
        ffd.l2NtvBytecodeInfo = abi.encode(_readPrev(prevJson, "L2NativeTokenVault"));
        ffd.messageRootBytecodeInfo = abi.encode(_readPrev(prevJson, "L2MessageRoot"));
        ffd.chainAssetHandlerBytecodeInfo = abi.encode(_readPrev(prevJson, "L2ChainAssetHandler"));
        ffd.beaconDeployerInfo = abi.encode(_readPrev(prevJson, "UpgradeableBeaconDeployer"));
        ffd.baseTokenHolderBytecodeInfo = abi.encode(_readPrev(prevJson, "BaseTokenHolder"));
        ffd.interopCenterBytecodeInfo = abi.encode(_readPrev(prevJson, "InteropCenter"));
        ffd.interopHandlerBytecodeInfo = abi.encode(_readPrev(prevJson, "InteropHandler"));
        ffd.assetTrackerBytecodeInfo = abi.encode(_readPrev(prevJson, "L2AssetTracker"));
    }

    /// @dev The upgrade cut's post-upgrade calldata embeds the force-deployments blob plus the
    ///      hashes of the genesis/upgrade machinery that also carry the asset-tracker hash.
    function _buildExampleCut(
        string memory prevJson,
        PatchConfig memory cfg,
        bytes memory forceDeploymentsData
    ) internal pure returns (Diamond.DiamondCutData memory cut) {
        bytes32[] memory machineryHashes = new bytes32[](4);
        machineryHashes[0] = _readPrev(prevJson, "L2GenesisUpgrade");
        machineryHashes[1] = _readPrev(prevJson, "L2GenesisForceDeploymentsHelper");
        machineryHashes[2] = _readPrev(prevJson, "L2ComplexUpgrader");
        machineryHashes[3] = _readPrev(prevJson, "L2V30TestnetSystemProxiesUpgrade");

        cut.facetCuts = new Diamond.FacetCut[](0);
        cut.initAddress = cfg.genesisUpgrade;
        cut.initCalldata = abi.encode(forceDeploymentsData, machineryHashes);
    }

    function _buildExampleCalls(
        PatchConfig memory cfg,
        Diamond.DiamondCutData memory cut,
        bytes memory forceDeploymentsData
    ) internal pure returns (IProtocolUpgradeHandler.Call[] memory calls) {
        ChainCreationParams memory params;
        params.genesisUpgrade = cfg.genesisUpgrade;
        params.diamondCut = cut;
        params.forceDeploymentsData = forceDeploymentsData;

        calls = new IProtocolUpgradeHandler.Call[](2);
        calls[0] = IProtocolUpgradeHandler.Call({target: cfg.eraCtm, value: 0, data: _encodeSetNewVersionUpgrade(cut, cfg)});
        calls[1] = IProtocolUpgradeHandler.Call({
            target: cfg.eraCtm,
            value: 0,
            data: abi.encodeCall(IChainTypeManager.setChainCreationParams, (params))
        });
    }

    function _encodeSetNewVersionUpgrade(
        Diamond.DiamondCutData memory cut,
        PatchConfig memory cfg
    ) internal pure returns (bytes memory) {
        return
            abi.encodeCall(
                IChainTypeManager.setNewVersionUpgrade,
                (cut, cfg.oldProtocolVersion, cfg.oldProtocolVersionDeadline, cfg.newProtocolVersion, cfg.verifier)
            );
    }

    /*//////////////////////////////////////////////////////////////
                           Core patch logic
    //////////////////////////////////////////////////////////////*/

    struct PatchConfig {
        address eraCtm;
        uint256 oldProtocolVersion;
        uint256 oldProtocolVersionDeadline;
        uint256 newProtocolVersion;
        address verifier;
        address genesisUpgrade;
        uint256 l1ChainId;
        uint256 eraChainId;
        uint256[] alreadyUpgradedChains;
    }

    /// @dev Builds the patched proposal: for each previous CTM call we rewrite its calldata,
    ///      then re-express it as the appropriate patch call, and finally append one
    ///      `executeUpgrade` per already-upgraded chain.
    function _buildPatchedCalls(
        IProtocolUpgradeHandler.Call[] memory previousCalls,
        Replacement[] memory replacements,
        PatchConfig memory cfg
    ) internal pure returns (IProtocolUpgradeHandler.Call[] memory) {
        (Diamond.DiamondCutData memory patchedCut, bytes memory patchedChainCreationCalldata) = _extractPatched(
            previousCalls,
            replacements,
            cfg.eraCtm
        );

        uint256 n = 2 + cfg.alreadyUpgradedChains.length;
        IProtocolUpgradeHandler.Call[] memory calls = new IProtocolUpgradeHandler.Call[](n);

        // 1. Overwrite the stored v31 upgrade cut so future upgraders get the fixed bytecode.
        calls[0] = IProtocolUpgradeHandler.Call({
            target: cfg.eraCtm,
            value: 0,
            data: abi.encodeCall(IChainTypeManager.setUpgradeDiamondCut, (patchedCut, cfg.oldProtocolVersion))
        });

        // 2. Update chain creation params for newly-created chains (calldata already patched).
        calls[1] = IProtocolUpgradeHandler.Call({target: cfg.eraCtm, value: 0, data: patchedChainCreationCalldata});

        // 3. Re-run the upgrade on chains that already executed the buggy v31 upgrade.
        for (uint256 i = 0; i < cfg.alreadyUpgradedChains.length; ++i) {
            calls[2 + i] = IProtocolUpgradeHandler.Call({
                target: cfg.eraCtm,
                value: 0,
                data: abi.encodeCall(IChainTypeManager.executeUpgrade, (cfg.alreadyUpgradedChains[i], patchedCut))
            });
        }

        return calls;
    }

    /// @dev Scans the previous calls for the Era-CTM `setNewVersionUpgrade` and
    ///      `setChainCreationParams` calls, applies the hash replacements to each, and returns
    ///      the patched upgrade cut and the patched `setChainCreationParams` calldata.
    function _extractPatched(
        IProtocolUpgradeHandler.Call[] memory previousCalls,
        Replacement[] memory replacements,
        address eraCtm
    ) internal pure returns (Diamond.DiamondCutData memory patchedCut, bytes memory patchedChainCreationCalldata) {
        bool foundCut;
        bool foundParams;

        for (uint256 i = 0; i < previousCalls.length; ++i) {
            if (previousCalls[i].target != eraCtm) {
                continue;
            }
            bytes4 selector = _selector(previousCalls[i].data);
            bytes memory patchedData = _replaceAll(previousCalls[i].data, replacements);

            if (selector == IChainTypeManager.setNewVersionUpgrade.selector) {
                patchedCut = _decodeCut(_stripSelector(patchedData));
                foundCut = true;
            } else if (selector == IChainTypeManager.setChainCreationParams.selector) {
                patchedChainCreationCalldata = patchedData;
                foundParams = true;
            }
        }

        require(foundCut, "no setNewVersionUpgrade call in previous data");
        require(foundParams, "no setChainCreationParams call in previous data");
    }

    /// @dev `setNewVersionUpgrade` args are `abi.encode(cut, oldPV, deadline, newPV, verifier)`.
    ///      `cut` is the first (dynamic) parameter, so decoding it alone reads the same head
    ///      offset and ignores the trailing scalars — and keeps the decoder off the stack limit.
    function _decodeCut(bytes memory args) internal pure returns (Diamond.DiamondCutData memory cut) {
        cut = abi.decode(args, (Diamond.DiamondCutData));
    }

    /// @dev Computes the old->new replacement set from the previous hashes fixture and the
    ///      freshly-built artifacts. Only contracts whose hash actually changed are returned.
    function _computeReplacements(string memory dir) internal view returns (Replacement[] memory) {
        string memory prevJson = vm.readFile(string.concat(dir, "/previous-bytecode-hashes.json"));

        Replacement[] memory tmp = new Replacement[](CANDIDATE_CONTRACTS.length);
        uint256 count;
        for (uint256 i = 0; i < CANDIDATE_CONTRACTS.length; ++i) {
            string memory name = CANDIDATE_CONTRACTS[i];
            bytes32 oldHash = _readPrev(prevJson, name);
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

    /// @dev Replaces every occurrence of each `oldHash` with its `newHash` in `data`.
    function _replaceAll(
        bytes memory data,
        Replacement[] memory replacements
    ) internal pure returns (bytes memory) {
        for (uint256 r = 0; r < replacements.length; ++r) {
            data = _replaceWord(data, replacements[r].oldHash, replacements[r].newHash);
        }
        return data;
    }

    /// @dev Replaces all aligned and unaligned occurrences of a 32-byte `oldWord` with `newWord`.
    function _replaceWord(bytes memory data, bytes32 oldWord, bytes32 newWord) internal pure returns (bytes memory) {
        if (data.length < 32) {
            return data;
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
        return data;
    }

    /*//////////////////////////////////////////////////////////////
                              Helpers
    //////////////////////////////////////////////////////////////*/

    function _currentZkBytecodeHash(string memory contractName) internal view returns (bytes32) {
        string memory path = string.concat(
            vm.projectRoot(),
            "/zkout/",
            contractName,
            ".sol/",
            contractName,
            ".json"
        );
        string memory json = vm.readFile(path);
        bytes memory bytecode = json.readBytes(".bytecode.object");
        return L2ContractHelper.hashL2Bytecode(bytecode);
    }

    function _readPrev(string memory json, string memory contractName) internal pure returns (bytes32) {
        return json.readBytes32(string.concat(".", contractName));
    }

    function _loadPreviousCalls(string memory dir) internal view returns (IProtocolUpgradeHandler.Call[] memory) {
        string memory json = vm.readFile(string.concat(dir, "/previous-upgrade-data.json"));
        bytes memory raw = json.readBytes(".calls");
        return abi.decode(raw, (IProtocolUpgradeHandler.Call[]));
    }

    function _loadConfig(string memory dir) internal view returns (PatchConfig memory cfg) {
        string memory json = vm.readFile(string.concat(dir, "/config.json"));
        cfg.eraCtm = json.readAddress(".eraCtm");
        cfg.oldProtocolVersion = json.readUint(".oldProtocolVersion");
        cfg.oldProtocolVersionDeadline = json.readUint(".oldProtocolVersionDeadline");
        cfg.newProtocolVersion = json.readUint(".newProtocolVersion");
        cfg.verifier = json.readAddress(".verifier");
        cfg.genesisUpgrade = json.readAddress(".genesisUpgrade");
        cfg.l1ChainId = json.readUint(".l1ChainId");
        cfg.eraChainId = json.readUint(".eraChainId");
        cfg.alreadyUpgradedChains = json.readUintArray(".alreadyUpgradedChains");
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

    function _selector(bytes memory data) internal pure returns (bytes4 sel) {
        require(data.length >= 4, "calldata too short");
        assembly {
            sel := mload(add(data, 0x20))
        }
    }

    function _stripSelector(bytes memory data) internal pure returns (bytes memory args) {
        require(data.length >= 4, "calldata too short");
        args = new bytes(data.length - 4);
        for (uint256 i = 4; i < data.length; ++i) {
            args[i - 4] = data[i];
        }
    }
}
