// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "contracts/upgrades/BytecodesSupplier.sol";
import "contracts/common/l2-helpers/L2ContractHelper.sol";

contract BytecodesSupplierTest is Test {
    BytecodesSupplier bytecodesSupplier;
    bytes internal bytecode1 = hex"0000000000000000000000000000000000000000000000000000000000000000";
    bytes internal bytecode2 = hex"1111111111111111111111111111111111111111111111111111111111111111";

    // Declare the event to use with vm.expectEmit
    event BytecodePublished(bytes32 indexed bytecodeHash, bytes bytecode);

    function setUp() public {
        bytecodesSupplier = new BytecodesSupplier();
    }

    function testPublishNewBytecode() public {
        bytes memory bytecode = bytecode1;

        // Calculate the bytecode hash using the same function as the contract
        bytes32 bytecodeHash = L2ContractHelper.hashL2Bytecode(bytecode);

        // Expect the event to be emitted
        vm.expectEmit(true, false, false, true);
        emit BytecodePublished(bytecodeHash, bytecode);

        // Publish the bytecode
        bytecodesSupplier.publishEraVMBytecode(bytecode);

        // Check that the publishing block mapping is updated
        uint256 publishedBlock = bytecodesSupplier.eraVMPublishingBlock(bytecodeHash);
        assertEq(publishedBlock, block.number);
    }

    function testPublishBytecodeOverwrite() public {
        bytes memory bytecode = bytecode1;

        // Calculate the bytecode hash
        bytes32 bytecodeHash = L2ContractHelper.hashL2Bytecode(bytecode);

        // Publish the bytecode
        bytecodesSupplier.publishEraVMBytecode(bytecode);

        vm.roll(block.number + 1);

        // Publish the same bytecode again to overwrite the publishing block
        bytecodesSupplier.publishEraVMBytecode(bytecode);

        uint256 publishedBlock = bytecodesSupplier.eraVMPublishingBlock(bytecodeHash);
        assertEq(publishedBlock, block.number);
    }

    function testPublishMultipleBytecodes() public {
        bytes[] memory bytecodes = new bytes[](2);
        bytecodes[0] = bytecode1;
        bytecodes[1] = bytecode2;

        // Expect events for each bytecode published
        for (uint256 i = 0; i < bytecodes.length; ++i) {
            bytes32 bytecodeHash = L2ContractHelper.hashL2Bytecode(bytecodes[i]);
            vm.expectEmit(true, false, false, true);
            emit BytecodePublished(bytecodeHash, bytecodes[i]);
        }

        // Publish multiple bytecodes
        bytecodesSupplier.publishBytecodes(bytecodes);

        // Check that both bytecodes are published
        for (uint256 i = 0; i < bytecodes.length; ++i) {
            bytes32 bytecodeHash = L2ContractHelper.hashL2Bytecode(bytecodes[i]);
            uint256 publishedBlock = bytecodesSupplier.eraVMPublishingBlock(bytecodeHash);
            assertEq(publishedBlock, block.number);
        }
    }

    function testPublishMultipleBytecodesWithDuplicate() public {
        bytes[] memory bytecodes = new bytes[](2);
        bytecodes[0] = bytecode1;
        bytecodes[1] = bytecode2;

        // Publish the first bytecode
        bytecodesSupplier.publishEraVMBytecode(bytecodes[0]);

        vm.roll(block.number + 1);

        // Now publish both bytecodes, one of which is already published
        bytecodesSupplier.publishBytecodes(bytecodes);

        bytes32 bytecodeHash = L2ContractHelper.hashL2Bytecode(bytecodes[0]);
        uint256 publishedBlock = bytecodesSupplier.eraVMPublishingBlock(bytecodeHash);
        assertEq(publishedBlock, block.number);
    }
}
