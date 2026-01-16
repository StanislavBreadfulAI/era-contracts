// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import {L2ContractHelper} from "../common/l2-helpers/L2ContractHelper.sol";

/// @author Matter Labs
/// @custom:security-contact security@matterlabs.dev
/// @notice Contract that is used to track published L2 bytecodes.
/// It will be the contract to which the preimages for the factory dependencies protocol upgrade transaction
/// will be submitted to.
/// @dev The contract has no access control as anyone is allowed to publish any bytecode.
contract BytecodesSupplier {
    /// @notice Event emitted when a bytecode is published.
    event BytecodePublished(bytes32 indexed bytecodeHash, bytes bytecode);

    /// @notice Mapping of bytecode hashes to the block number when they were published.
    /// @dev Publishing block can be overridden since providers might not want to return old data.
    mapping(bytes32 bytecodeHash => uint256 blockNumber) public eraVMPublishingBlock;

    /// @notice Mapping of EVM bytecode hashes to the block number when they were published.
    /// @dev Publishing block can be overridden since providers might not want to return old data.
    mapping(bytes32 bytecodeHash => uint256 blockNumber) public evmPublishingBlock;

    /// @notice Publishes the EraVM bytecode hash and the bytecode itself.
    /// @param _bytecode Bytecode to be published.
    function publishEraVMBytecode(bytes calldata _bytecode) public {
        bytes32 bytecodeHash = L2ContractHelper.hashL2BytecodeCalldata(_bytecode);

        // Can be overridden since providers might not want to return old data.
        eraVMPublishingBlock[bytecodeHash] = block.number;

        emit BytecodePublished(bytecodeHash, _bytecode);
    }

    /// @notice Publishes the bytecode in EVM mode.
    /// @param _bytecode Bytecode to be published.
    function publishEvmBytecode(bytes calldata _bytecode) public {
        bytes32 bytecodeHash = keccak256(_bytecode);

        // Can be overridden since providers might not want to return old data.
        evmPublishingBlock[bytecodeHash] = block.number;

        emit BytecodePublished(bytecodeHash, _bytecode);
    }

    /// @notice Publishes multiple bytecodes.
    /// @param _bytecodes Array of bytecodes to be published.
    function publishBytecodes(bytes[] calldata _bytecodes) external {
        // solhint-disable-next-line gas-length-in-loops
        for (uint256 i = 0; i < _bytecodes.length; ++i) {
            publishEraVMBytecode(_bytecodes[i]);
        }
    }
}
