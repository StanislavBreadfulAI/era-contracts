// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;
// solhint-disable gas-custom-errors

import {StdStorage, Test, console, stdStorage} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {SharedL2ContractDeployer} from "./_SharedL2ContractDeployer.sol";
import {
    GW_ASSET_TRACKER,
    GW_ASSET_TRACKER_ADDR,
    L2_ASSET_TRACKER,
    L2_ASSET_TRACKER_ADDR,
    L2_BASE_TOKEN_HOLDER_ADDR,
    L2_CHAIN_ASSET_HANDLER,
    L2_BOOTLOADER_ADDRESS,
    L2_BRIDGEHUB,
    L2_COMPLEX_UPGRADER_ADDR,
    L2_MESSAGE_ROOT_ADDR,
    L2_NATIVE_TOKEN_VAULT_ADDR,
    L2_BASE_TOKEN_SYSTEM_CONTRACT,
    L2_SYSTEM_CONTEXT_SYSTEM_CONTRACT
} from "contracts/common/l2-helpers/L2ContractInterfaces.sol";
import {ProcessLogsInput} from "contracts/state-transition/chain-interfaces/IExecutor.sol";
import {IERC20} from "@openzeppelin/contracts-v4/token/ERC20/IERC20.sol";
import {MAX_TOKEN_BALANCE} from "contracts/bridge/asset-tracker/IAssetTrackerBase.sol";
import {L2AssetTracker} from "contracts/bridge/asset-tracker/L2AssetTracker.sol";
import {IL2AssetTracker} from "contracts/bridge/asset-tracker/IL2AssetTracker.sol";
import {AssetAlreadyRegistered, AssetIdNotRegistered} from "contracts/bridge/asset-tracker/AssetTrackerErrors.sol";
import {BaseTokenPreV31TotalSupplyNotSet} from "contracts/common/L1ContractErrors.sol";
import {INativeTokenVaultBase} from "contracts/bridge/ntv/INativeTokenVaultBase.sol";
import {L2NativeTokenVault} from "contracts/bridge/ntv/L2NativeTokenVault.sol";
import {TestnetERC20Token} from "contracts/dev-contracts/TestnetERC20Token.sol";
import {DataEncoding} from "contracts/common/libraries/DataEncoding.sol";

import {L2AssetTrackerData} from "./L2AssetTrackerData.sol";
import {L2UtilsBase} from "../l2-tests-in-l1-context/L2UtilsBase.sol";

abstract contract L2AssetTrackerTest is Test, SharedL2ContractDeployer {
    using stdStorage for StdStorage;

    function test_processLogsAndMessages() public {
        finalizeDepositWithChainId(271);
        finalizeDepositWithChainId(260);

        vm.chainId(GATEWAY_CHAIN_ID);

        // Set up token balances for chain operators to pay settlement fees
        uint256[] memory chainIds = new uint256[](2);
        chainIds[0] = 271;
        chainIds[1] = 260;
        L2UtilsBase.setupTokenBalancesForChainOperators(chainIds);

        bytes[] memory input2 = L2AssetTrackerData.getData2();
        for (uint256 i = 0; i < input2.length; i++) {
            this.printProcess(abi.decode(input2[i], (ProcessLogsInput)));
            return;
        }

        ProcessLogsInput[] memory testData = L2AssetTrackerData.getData();

        // Verify test data is not empty
        assertTrue(testData.length > 0, "Test data should not be empty");

        // Add the required previous batch roots for batches 1-4
        // The test is trying to add batch 5, so we need batches 1-4 to exist first
        bytes32 dummyBatchRoot = keccak256("dummy_batch_root");
        for (uint256 i = 1; i <= 4; i++) {
            stdstore
                .target(address(L2_MESSAGE_ROOT_ADDR))
                .sig("chainBatchRoots(uint256,uint256)")
                .with_key(271)
                .with_key(i)
                .checked_write(bytes32(uint256(dummyBatchRoot) + i));
        }

        uint256 successCount = 0;

        for (uint256 i = 0; i < testData.length; i++) {
            console.log("Processing test data index", i, "for chainId", testData[i].chainId);
            // Verify each test data entry has valid chain ID
            assertTrue(testData[i].chainId > 0, "Chain ID should be positive");

            // Set the current batch number to 4 so that batch 5 can be added next
            if (testData[i].batchNumber > 0) {
                stdstore
                    .target(address(L2_MESSAGE_ROOT_ADDR))
                    .sig("currentChainBatchNumber(uint256)")
                    .with_key(testData[i].chainId)
                    .checked_write(testData[i].batchNumber - 1);
            }

            storeChainBalance(
                testData[i].chainId,
                0x444c07697a6b15219c574dcc0ee09b479f6171009a6afd65b93e6f028cfa031b,
                100
            );
            storeChainBalance(
                testData[i].chainId,
                0xa6203e30497f83b9f5f056745b6ff94f7e22d88bacea03d4dd4393d66217a86f,
                100
            );
            storeChainBalance(
                testData[i].chainId,
                0x8592bf3100a24d737aba8ba9895f6801b9ec30200dc016dd8369f3171cbd1921,
                100
            );
            storeChainBalance(
                testData[i].chainId,
                0xb615cd4917043452e354e4797dc23e4d6106663f7a37249d54f5996dd2347710,
                100
            );
            storeChainBalance(
                testData[i].chainId,
                0xb1f317b7effffcd4e3cf53784ae442ecc4e835c532aaf0e60a046fa8efb96e85,
                100
            );
            storeChainBalance(
                testData[i].chainId,
                0xb5eab7cc8c9114c3115a034b49b3d87b0b352aa88c2a9d5ff7339cde105aa44c,
                100
            );

            stdstore
                .target(address(L2_CHAIN_ASSET_HANDLER))
                .sig("migrationNumber(uint256)")
                .with_key(271)
                .checked_write(uint256(1));

            bytes32[] memory txHashes = getTxHashes(testData[i]);

            // Loop over l1TxHashes in testData[i] and for each mark balanceChange version number as 1
            // Note: balanceChange is internal, so we calculate storage slot manually
            // balanceChange is at slot 155 in GWAssetTracker
            for (uint256 j = 0; j < txHashes.length; j++) {
                // Calculate storage slot: keccak256(txHash, keccak256(chainId, 155))
                bytes32 innerSlot = keccak256(abi.encode(testData[i].chainId, uint256(155)));
                bytes32 structSlot = keccak256(abi.encode(txHashes[j], innerSlot));
                // Write 1 to the version field (first byte of the struct)
                vm.store(address(GW_ASSET_TRACKER), structSlot, bytes32(uint256(1)));
            }

            console.log("About to call processLogsAndMessages for index", i);

            // Get the ZKChain address for this chain - this will be the caller and the settlement fee payer
            address zkChainAddr = L2_BRIDGEHUB.getZKChain(testData[i].chainId);

            // Update settlementFeePayer to be the ZKChain address (which has tokens and approval)
            testData[i].settlementFeePayer = zkChainAddr;

            vm.prank(zkChainAddr);

            (bool success, bytes memory data) = GW_ASSET_TRACKER_ADDR.call(
                abi.encodeCall(GW_ASSET_TRACKER.processLogsAndMessages, testData[i])
            );

            if (!success) {
                assembly {
                    revert(add(data, 0x20), mload(data))
                }
            }
            assertTrue(success, string.concat("processLogsAndMessages should succeed for iteration ", vm.toString(i)));
            successCount++;
            console.log("success", i);
        }

        assertEq(successCount, testData.length, "All processLogsAndMessages calls should succeed");
    }

    function getTxHashes(ProcessLogsInput memory input) public returns (bytes32[] memory) {
        bytes32[] memory txHashes = new bytes32[](input.logs.length);
        uint256 length = 0;
        for (uint256 i = 0; i < input.logs.length; i++) {
            if (input.logs[i].sender == L2_BOOTLOADER_ADDRESS) {
                length++;
            }
        }
        uint256 j;
        for (uint256 i = 0; i < input.logs.length; i++) {
            if (input.logs[i].sender == L2_BOOTLOADER_ADDRESS) {
                txHashes[j++] = input.logs[i].key;
            }
        }
        return txHashes;
    }

    function storeChainBalance(uint256 chainId, bytes32 assetId, uint256 balance) public {
        stdstore
            .target(address(GW_ASSET_TRACKER))
            .sig("chainBalance(uint256,bytes32)")
            .with_key(chainId)
            .with_key(assetId)
            .checked_write(balance);
    }

    function printProcess(ProcessLogsInput memory) public {
        /// its just here so that the ProcessLogsInput is printed in console
    }

    function test_registerLegacyToken_nativeToken() public {
        bytes32 assetId = keccak256("test_asset_id");

        // Mock the asset as being native to the current chain
        stdstore
            .target(address(L2_NATIVE_TOKEN_VAULT_ADDR))
            .sig("originChainId(bytes32)")
            .with_key(assetId)
            .checked_write(block.chainid);

        // Mock token address
        address mockTokenAddress = address(0x1234);
        stdstore
            .target(address(L2_NATIVE_TOKEN_VAULT_ADDR))
            .sig("tokenAddress(bytes32)")
            .with_key(assetId)
            .checked_write(uint256(uint160(mockTokenAddress)));

        // Mock NTV balance (tokens locked from previous bridge operations)
        uint256 ntvBalance = 300;
        vm.mockCall(
            mockTokenAddress,
            abi.encodeWithSelector(IERC20.balanceOf.selector, address(L2_NATIVE_TOKEN_VAULT_ADDR)),
            abi.encode(ntvBalance)
        );

        // Call the migration function
        L2_ASSET_TRACKER.registerLegacyToken(assetId);

        // Verify chainBalance was calculated correctly
        // Expected: MAX_TOKEN_BALANCE - ntvBalance
        uint256 expectedBalance = MAX_TOKEN_BALANCE - ntvBalance;
        uint256 actualBalance = L2AssetTracker(L2_ASSET_TRACKER_ADDR).chainBalance(block.chainid, assetId);

        assertEq(actualBalance, expectedBalance, "Chain balance should be correctly migrated");
    }

    function test_handleInitiateBridgingOnL2_requiresTokenRegistration() public {
        TestnetERC20Token token = new TestnetERC20Token("NativeToken", "NTV", 18);
        bytes32 assetId = DataEncoding.encodeNTVAssetId(block.chainid, address(token));
        uint256 amount = 7;

        vm.expectRevert(abi.encodeWithSelector(AssetIdNotRegistered.selector, assetId));
        vm.prank(address(L2_NATIVE_TOKEN_VAULT_ADDR));
        L2_ASSET_TRACKER.handleInitiateBridgingOnL2(L1_CHAIN_ID, assetId, amount, block.chainid);

        INativeTokenVaultBase(L2_NATIVE_TOKEN_VAULT_ADDR).registerToken(address(token));
        uint256 balanceBefore = L2AssetTracker(L2_ASSET_TRACKER_ADDR).chainBalance(block.chainid, assetId);
        assertEq(balanceBefore, MAX_TOKEN_BALANCE, "Native token should be initialized on registration");

        vm.prank(address(L2_NATIVE_TOKEN_VAULT_ADDR));
        L2_ASSET_TRACKER.handleInitiateBridgingOnL2(L1_CHAIN_ID, assetId, amount, block.chainid);

        uint256 balanceAfter = L2AssetTracker(L2_ASSET_TRACKER_ADDR).chainBalance(block.chainid, assetId);
        assertEq(balanceAfter, balanceBefore - amount, "Native token chain balance should decrease after withdrawal");
    }

    function test_handleFinalizeBridgingOnL2_requiresTokenRegistration() public {
        TestnetERC20Token token = new TestnetERC20Token("LegacyToken", "LGC", 18);
        address l1Token = makeAddr("legacy_l1_token");
        bytes32 assetId = DataEncoding.encodeNTVAssetId(L1_CHAIN_ID, l1Token);
        uint256 amount = 11;

        vm.expectRevert(abi.encodeWithSelector(AssetIdNotRegistered.selector, assetId));
        vm.prank(address(L2_NATIVE_TOKEN_VAULT_ADDR));
        L2_ASSET_TRACKER.handleFinalizeBridgingOnL2(L1_CHAIN_ID, assetId, amount, L1_CHAIN_ID, address(token));

        stdstore.target(sharedBridgeLegacy).sig("l1TokenAddress(address)").with_key(address(token)).checked_write(
            l1Token
        );
        L2NativeTokenVault(L2_NATIVE_TOKEN_VAULT_ADDR).setLegacyTokenAssetId(address(token));

        vm.prank(address(L2_NATIVE_TOKEN_VAULT_ADDR));
        L2_ASSET_TRACKER.handleFinalizeBridgingOnL2(L1_CHAIN_ID, assetId, amount, L1_CHAIN_ID, address(token));

        uint256 chainBalance = L2AssetTracker(L2_ASSET_TRACKER_ADDR).chainBalance(block.chainid, assetId);
        assertEq(chainBalance, 0, "Foreign token chain balance should remain zero");
    }

    function test_handleFinalizeBaseTokenBridgingOnL2() public {
        // Test handling base token bridging into L2
        bytes32 baseTokenAssetId = keccak256("base_token_asset_id");
        uint256 amount = 300;
        uint256 l1ChainId = 1;

        // Mock base token asset ID
        stdstore.target(L2_ASSET_TRACKER_ADDR).sig("BASE_TOKEN_ASSET_ID()").checked_write(uint256(baseTokenAssetId));

        // Mock L1 chain ID
        stdstore.target(L2_ASSET_TRACKER_ADDR).sig("L1_CHAIN_ID()").checked_write(l1ChainId);

        // Set initial chain balance (should be 0 for incoming tokens)
        stdstore
            .target(L2_ASSET_TRACKER_ADDR)
            .sig("chainBalance(uint256,bytes32)")
            .with_key(block.chainid)
            .with_key(baseTokenAssetId)
            .checked_write(uint256(0));

        // Mock origin chain ID for base token (L1)
        stdstore
            .target(address(L2_NATIVE_TOKEN_VAULT_ADDR))
            .sig("originChainId(bytes32)")
            .with_key(baseTokenAssetId)
            .checked_write(l1ChainId);

        // Mock totalSupply on L2_BASE_TOKEN_SYSTEM_CONTRACT (needed for foreign token total supply calculation)
        vm.mockCall(
            address(L2_BASE_TOKEN_SYSTEM_CONTRACT),
            abi.encodeWithSelector(IERC20.totalSupply.selector),
            abi.encode(1000)
        );

        // Mock currentSettlementLayerChainId to return L1 (not in gateway mode)
        vm.mockCall(
            address(L2_SYSTEM_CONTEXT_SYSTEM_CONTRACT),
            abi.encodeWithSelector(L2_SYSTEM_CONTEXT_SYSTEM_CONTRACT.currentSettlementLayerChainId.selector),
            abi.encode(l1ChainId)
        );

        uint256 depositsBefore = _readTotalSuccessfulDepositsFromL1(baseTokenAssetId);

        // Call as BaseTokenHolder (onlyBaseTokenHolderOrL2BaseToken modifier)
        vm.prank(L2_BASE_TOKEN_HOLDER_ADDR);
        L2_ASSET_TRACKER.handleFinalizeBaseTokenBridgingOnL2(l1ChainId, amount);

        // Verify chain balance did NOT increase (foreign token, not native)
        uint256 finalBalance = L2AssetTracker(L2_ASSET_TRACKER_ADDR).chainBalance(block.chainid, baseTokenAssetId);
        assertEq(finalBalance, 0, "Chain balance should remain 0 for foreign tokens");

        // Verify totalSuccessfulDepositsFromL1 increased by amount
        uint256 depositsAfter = _readTotalSuccessfulDepositsFromL1(baseTokenAssetId);
        assertEq(depositsAfter - depositsBefore, amount, "totalSuccessfulDepositsFromL1 should increase by amount");
    }

    /// @notice On Era, L2BaseTokenEra.mint() calls handleFinalizeBaseTokenBridgingOnL2 directly
    /// (msg.sender = L2_BASE_TOKEN_SYSTEM_CONTRACT). This must be allowed by access control.
    function test_handleFinalizeBaseTokenBridgingOnL2_calledByL2BaseToken() public {
        bytes32 baseTokenAssetId = keccak256("base_token_asset_id");
        uint256 amount = 300;
        uint256 l1ChainId = 1;

        stdstore.target(L2_ASSET_TRACKER_ADDR).sig("BASE_TOKEN_ASSET_ID()").checked_write(uint256(baseTokenAssetId));
        stdstore.target(L2_ASSET_TRACKER_ADDR).sig("L1_CHAIN_ID()").checked_write(l1ChainId);
        stdstore
            .target(address(L2_NATIVE_TOKEN_VAULT_ADDR))
            .sig("originChainId(bytes32)")
            .with_key(baseTokenAssetId)
            .checked_write(l1ChainId);

        vm.mockCall(
            address(L2_BASE_TOKEN_SYSTEM_CONTRACT),
            abi.encodeWithSelector(IERC20.totalSupply.selector),
            abi.encode(1000)
        );

        // Mock currentSettlementLayerChainId to return L1 (not in gateway mode)
        vm.mockCall(
            address(L2_SYSTEM_CONTEXT_SYSTEM_CONTRACT),
            abi.encodeWithSelector(L2_SYSTEM_CONTEXT_SYSTEM_CONTRACT.currentSettlementLayerChainId.selector),
            abi.encode(l1ChainId)
        );

        uint256 depositsBefore = _readTotalSuccessfulDepositsFromL1(baseTokenAssetId);

        // Call as L2BaseToken (the Era flow: L2BaseTokenEra.mint() → asset tracker)
        vm.prank(address(L2_BASE_TOKEN_SYSTEM_CONTRACT));
        L2_ASSET_TRACKER.handleFinalizeBaseTokenBridgingOnL2(l1ChainId, amount);

        // Verify totalSuccessfulDepositsFromL1 increased by amount
        uint256 depositsAfter = _readTotalSuccessfulDepositsFromL1(baseTokenAssetId);
        assertEq(depositsAfter - depositsBefore, amount, "totalSuccessfulDepositsFromL1 should increase by amount");
    }

    /// @notice A random address must not be able to call handleFinalizeBaseTokenBridgingOnL2.
    function test_handleFinalizeBaseTokenBridgingOnL2_revertUnauthorized() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        L2_ASSET_TRACKER.handleFinalizeBaseTokenBridgingOnL2(1, 100);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  registerBaseTokenDuringUpgrade
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Verifies that registerBaseTokenDuringUpgrade registers the base token correctly.
    function test_registerBaseTokenDuringUpgrade_registersBaseToken() public {
        bytes32 baseTokenAssetId = keccak256("base_token_asset_id");

        // Set BASE_TOKEN_ASSET_ID (the function reads it internally)
        stdstore.target(L2_ASSET_TRACKER_ADDR).sig("BASE_TOKEN_ASSET_ID()").checked_write(uint256(baseTokenAssetId));

        // Verify not registered yet
        assertFalse(
            L2AssetTracker(L2_ASSET_TRACKER_ADDR).isAssetRegistered(baseTokenAssetId),
            "Should not be registered before call"
        );

        // Expect BaseTokenRegisteredDuringUpgrade event
        vm.expectEmit(true, false, false, false, L2_ASSET_TRACKER_ADDR);
        emit IL2AssetTracker.BaseTokenRegisteredDuringUpgrade(baseTokenAssetId);

        // Call as ComplexUpgrader (onlyUpgrader)
        vm.prank(L2_COMPLEX_UPGRADER_ADDR);
        L2_ASSET_TRACKER.registerBaseTokenDuringUpgrade();

        // Verify registered
        assertTrue(
            L2AssetTracker(L2_ASSET_TRACKER_ADDR).isAssetRegistered(baseTokenAssetId),
            "Should be registered after call"
        );

        // Verify totalPreV31TotalSupply was set to {isSaved: true, amount: 0}
        (bool isSaved, uint256 amount) = L2AssetTracker(L2_ASSET_TRACKER_ADDR).totalPreV31TotalSupply(baseTokenAssetId);
        assertTrue(isSaved, "totalPreV31TotalSupply.isSaved should be true");
        assertEq(amount, 0, "totalPreV31TotalSupply.amount should be 0");
    }

    /// @notice Verifies that registerBaseTokenDuringUpgrade reverts if already registered.
    function test_registerBaseTokenDuringUpgrade_revertIfAlreadyRegistered() public {
        bytes32 baseTokenAssetId = keccak256("base_token_asset_id");

        stdstore.target(L2_ASSET_TRACKER_ADDR).sig("BASE_TOKEN_ASSET_ID()").checked_write(uint256(baseTokenAssetId));

        // Pre-register the asset
        stdstore
            .target(L2_ASSET_TRACKER_ADDR)
            .sig("isAssetRegistered(bytes32)")
            .with_key(baseTokenAssetId)
            .checked_write(true);

        vm.prank(L2_COMPLEX_UPGRADER_ADDR);
        vm.expectRevert(abi.encodeWithSelector(AssetAlreadyRegistered.selector, baseTokenAssetId));
        L2_ASSET_TRACKER.registerBaseTokenDuringUpgrade();
    }

    /// @notice Verifies that only the ComplexUpgrader can call registerBaseTokenDuringUpgrade.
    function test_registerBaseTokenDuringUpgrade_revertUnauthorized() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        L2_ASSET_TRACKER.registerBaseTokenDuringUpgrade();
    }

    function test_initiateL1ToGatewayMigrationOnL2() public {
        // Test initiating L1 to Gateway migration on L2
        bytes32 assetId = keccak256("migration_asset_id");
        uint256 originChainId = 1;
        address tokenAddress = address(0x5678);
        address originalToken = address(0x9ABC);
        uint256 totalSupply = 10000;

        // Mock settlement layer chain ID (not L1)
        vm.mockCall(
            address(L2_SYSTEM_CONTEXT_SYSTEM_CONTRACT),
            abi.encodeWithSelector(bytes4(keccak256("currentSettlementLayerChainId()"))),
            abi.encode(270) // Gateway chain ID
        );

        // Mock token address
        stdstore
            .target(address(L2_NATIVE_TOKEN_VAULT_ADDR))
            .sig("tokenAddress(bytes32)")
            .with_key(assetId)
            .checked_write(uint256(uint160(tokenAddress)));

        // Mock origin chain ID
        stdstore
            .target(address(L2_NATIVE_TOKEN_VAULT_ADDR))
            .sig("originChainId(bytes32)")
            .with_key(assetId)
            .checked_write(originChainId);

        // Mock origin token (using mockCall since originToken is a function with logic)
        vm.mockCall(
            address(L2_NATIVE_TOKEN_VAULT_ADDR),
            abi.encodeWithSignature("originToken(bytes32)", assetId),
            abi.encode(originalToken)
        );

        // Mock chain migration number
        stdstore
            .target(address(L2_CHAIN_ASSET_HANDLER))
            .sig("migrationNumber(uint256)")
            .with_key(block.chainid)
            .checked_write(uint256(2));

        // Set asset migration number to 0 (not yet migrated)
        stdstore
            .target(L2_ASSET_TRACKER_ADDR)
            .sig("assetMigrationNumber(uint256,bytes32)")
            .with_key(block.chainid)
            .with_key(assetId)
            .checked_write(uint256(0));

        // Mock total supply
        vm.mockCall(tokenAddress, abi.encodeWithSelector(IERC20.totalSupply.selector), abi.encode(totalSupply));

        // Mock sendMessageToL1 to avoid revert
        vm.mockCall(address(L2_BRIDGEHUB), abi.encodeWithSignature("sendMessageToL1(bytes)"), abi.encode(bytes32(0)));

        // Get asset migration number before migration
        uint256 assetMigrationNumBefore = L2AssetTracker(L2_ASSET_TRACKER_ADDR).assetMigrationNumber(
            block.chainid,
            assetId
        );

        // Verify initial state
        assertEq(assetMigrationNumBefore, 0, "Asset migration number should be 0 before migration");

        // Record logs to capture the event
        vm.recordLogs();

        // Call the migration function
        L2_ASSET_TRACKER.initiateL1ToGatewayMigrationOnL2(assetId);

        // Verify the L1ToGatewayMigrationInitiated event was emitted
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertTrue(logs.length > 0, "Should emit L1ToGatewayMigrationInitiated event");

        // Find the L1ToGatewayMigrationInitiated event
        bool foundEvent = false;
        bytes32 eventSignature = IL2AssetTracker.L1ToGatewayMigrationInitiated.selector;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == eventSignature) {
                foundEvent = true;
                // Verify the indexed assetId matches
                assertEq(logs[i].topics[1], assetId, "Event assetId should match");
                break;
            }
        }
        assertTrue(foundEvent, "L1ToGatewayMigrationInitiated event should be emitted");
    }

    // ════════════════════════════════════════════════════════════════════════════════
    //  Regression: base-token `totalSupply()` usage during finalization vs. the
    //  pre-V31 total-supply backfill (ZKsync OS chains upgraded from a pre-v31 version).
    //
    //  `_needToForceSetAssetMigrationOnL2` decides whether to force-set a token's
    //  migration number by reading `totalSupply()` (a `== 0` value is a proxy for
    //  "no deposit has ever been finalized"). On a ZKsync OS chain that upgraded from
    //  a pre-v31 version, the base token's `totalSupply()` is *not readable* until it
    //  has been backfilled via `backFillZKSyncOSBaseTokenV31MigrationData()` — the call
    //  reverts with `BaseTokenPreV31TotalSupplyNotSet` (see `L2BaseTokenZKOS.totalSupply()`).
    //
    //  Before the fix, the very first base-token deposit finalization after the upgrade
    //  (`handleFinalizeBaseTokenBridgingOnL2`) reverted with that error until someone
    //  backfilled the supply, effectively bricking base-token deposits in that window.
    //  The fix short-circuits the `totalSupply()` read for the base token while a
    //  backfill is pending: such chains were already running before v31, so their base
    //  token always has a non-zero supply and the migration number must never be
    //  force-set.
    // ════════════════════════════════════════════════════════════════════════════════

    uint256 internal constant _BASE_FINALIZE_AMOUNT = 300;
    uint256 internal constant _BASE_FINALIZE_L1_CHAIN_ID = 1;
    uint256 internal constant _CHAIN_MIGRATION_NUMBER = 3;

    /// @dev Mirrors the V31-upgrade setup of an *existing* chain whose base token is
    ///      registered during the upgrade (`registerBaseTokenDuringUpgrade`) and which
    ///      settles on L1. `_assetId` is an arbitrary, not-yet-registered asset id.
    function _setUpBaseTokenForFinalize(bytes32 baseTokenAssetId) internal {
        stdstore.target(L2_ASSET_TRACKER_ADDR).sig("BASE_TOKEN_ASSET_ID()").checked_write(uint256(baseTokenAssetId));
        stdstore.target(L2_ASSET_TRACKER_ADDR).sig("L1_CHAIN_ID()").checked_write(_BASE_FINALIZE_L1_CHAIN_ID);
        stdstore
            .target(address(L2_NATIVE_TOKEN_VAULT_ADDR))
            .sig("originChainId(bytes32)")
            .with_key(baseTokenAssetId)
            .checked_write(_BASE_FINALIZE_L1_CHAIN_ID);

        // Register the base token exactly as the V31 upgrade does for existing chains.
        vm.prank(L2_COMPLEX_UPGRADER_ADDR);
        L2_ASSET_TRACKER.registerBaseTokenDuringUpgrade();

        // Settle on L1 so the deposit accounting branch is exercised.
        vm.mockCall(
            address(L2_SYSTEM_CONTEXT_SYSTEM_CONTRACT),
            abi.encodeWithSelector(L2_SYSTEM_CONTEXT_SYSTEM_CONTRACT.currentSettlementLayerChainId.selector),
            abi.encode(_BASE_FINALIZE_L1_CHAIN_ID)
        );

        // Give the chain a non-zero migration number so that a force-set (if it happened)
        // would be observable as a non-zero asset migration number.
        stdstore
            .target(address(L2_CHAIN_ASSET_HANDLER))
            .sig("migrationNumber(uint256)")
            .with_key(block.chainid)
            .checked_write(_CHAIN_MIGRATION_NUMBER);
    }

    function _setNeedBaseTokenBackfill(bool value) internal {
        stdstore.target(L2_ASSET_TRACKER_ADDR).sig("needBaseTokenTotalSupplyBackfill()").checked_write(value);
    }

    /// @dev Makes the base token behave like a ZKsync OS base token whose pre-V31 supply
    ///      has not yet been backfilled: any `totalSupply()` call reverts.
    function _mockBaseTokenTotalSupplyReverts() internal {
        vm.mockCallRevert(
            address(L2_BASE_TOKEN_SYSTEM_CONTRACT),
            abi.encodeWithSelector(IERC20.totalSupply.selector),
            abi.encodeWithSelector(BaseTokenPreV31TotalSupplyNotSet.selector)
        );
    }

    function _mockBaseTokenTotalSupply(uint256 supply) internal {
        vm.mockCall(
            address(L2_BASE_TOKEN_SYSTEM_CONTRACT),
            abi.encodeWithSelector(IERC20.totalSupply.selector),
            abi.encode(supply)
        );
    }

    /// @notice The core regression: finalizing a base-token deposit must succeed while the
    ///         pre-V31 total supply is still pending backfill, even though `totalSupply()`
    ///         reverts. The migration number must NOT be force-set in that window.
    function test_handleFinalizeBaseTokenBridgingOnL2_succeedsWhileBackfillPending() public {
        bytes32 baseTokenAssetId = keccak256("zkos_base_token_pending_backfill");
        _setUpBaseTokenForFinalize(baseTokenAssetId);
        _setNeedBaseTokenBackfill(true);
        _mockBaseTokenTotalSupplyReverts();

        uint256 depositsBefore = _readTotalSuccessfulDepositsFromL1(baseTokenAssetId);

        // Must not revert (before the fix this reverted with BaseTokenPreV31TotalSupplyNotSet).
        vm.prank(L2_BASE_TOKEN_HOLDER_ADDR);
        L2_ASSET_TRACKER.handleFinalizeBaseTokenBridgingOnL2(_BASE_FINALIZE_L1_CHAIN_ID, _BASE_FINALIZE_AMOUNT);

        assertEq(
            _readTotalSuccessfulDepositsFromL1(baseTokenAssetId) - depositsBefore,
            _BASE_FINALIZE_AMOUNT,
            "deposit accounting should be updated"
        );
        assertEq(
            L2AssetTracker(L2_ASSET_TRACKER_ADDR).assetMigrationNumber(block.chainid, baseTokenAssetId),
            0,
            "migration number must not be force-set while the base-token supply is unknown"
        );
    }

    /// @notice Explicitly verify that the `totalSupply()` read is skipped while a backfill is
    ///         pending: a deposit finalization must succeed even if a revert is the only thing
    ///         `totalSupply()` could return.
    function test_handleFinalizeBaseTokenBridgingOnL2_doesNotReadTotalSupplyWhileBackfillPending() public {
        bytes32 baseTokenAssetId = keccak256("zkos_base_token_no_total_supply_read");
        _setUpBaseTokenForFinalize(baseTokenAssetId);
        _setNeedBaseTokenBackfill(true);
        _mockBaseTokenTotalSupplyReverts();

        vm.prank(L2_BASE_TOKEN_HOLDER_ADDR);
        L2_ASSET_TRACKER.handleFinalizeBaseTokenBridgingOnL2(_BASE_FINALIZE_L1_CHAIN_ID, _BASE_FINALIZE_AMOUNT);
    }

    /// @notice After the backfill completed (`needBaseTokenTotalSupplyBackfill == false`) the
    ///         live `totalSupply()` is readable again and finalization keeps working. With a
    ///         non-zero supply the migration number is (correctly) not force-set.
    function test_handleFinalizeBaseTokenBridgingOnL2_afterBackfillReadsTotalSupply() public {
        bytes32 baseTokenAssetId = keccak256("zkos_base_token_after_backfill");
        _setUpBaseTokenForFinalize(baseTokenAssetId);
        _setNeedBaseTokenBackfill(false);
        _mockBaseTokenTotalSupply(1000);

        uint256 depositsBefore = _readTotalSuccessfulDepositsFromL1(baseTokenAssetId);

        vm.prank(L2_BASE_TOKEN_HOLDER_ADDR);
        L2_ASSET_TRACKER.handleFinalizeBaseTokenBridgingOnL2(_BASE_FINALIZE_L1_CHAIN_ID, _BASE_FINALIZE_AMOUNT);

        assertEq(
            _readTotalSuccessfulDepositsFromL1(baseTokenAssetId) - depositsBefore,
            _BASE_FINALIZE_AMOUNT,
            "deposit accounting should be updated after backfill"
        );
        assertEq(
            L2AssetTracker(L2_ASSET_TRACKER_ADDR).assetMigrationNumber(block.chainid, baseTokenAssetId),
            0,
            "non-zero supply must not force-set the migration number"
        );
    }

    /// @notice Sanity check that the `totalSupply() == 0` proxy is still honored once the supply
    ///         is readable (no backfill pending): a zero supply force-sets the migration number.
    ///         This guards against the fix accidentally disabling the normal force-set path.
    function test_handleFinalizeBaseTokenBridgingOnL2_zeroSupplyForceSetsMigrationNumber() public {
        bytes32 baseTokenAssetId = keccak256("base_token_zero_supply_force_set");
        _setUpBaseTokenForFinalize(baseTokenAssetId);
        _setNeedBaseTokenBackfill(false);
        _mockBaseTokenTotalSupply(0);

        vm.prank(L2_BASE_TOKEN_HOLDER_ADDR);
        L2_ASSET_TRACKER.handleFinalizeBaseTokenBridgingOnL2(_BASE_FINALIZE_L1_CHAIN_ID, _BASE_FINALIZE_AMOUNT);

        assertEq(
            L2AssetTracker(L2_ASSET_TRACKER_ADDR).assetMigrationNumber(block.chainid, baseTokenAssetId),
            _CHAIN_MIGRATION_NUMBER,
            "zero supply should force-set the migration number to the chain migration number"
        );
    }
}
