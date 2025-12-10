// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { HARD_CODED_CHAIN_ID} from "../system-contracts/contracts/Constants.sol";
import {L2_BOOTLOADER_ADDRESS} from "../common/l2-helpers/L2ContractAddresses.sol";
import {Unauthorized} from "../l2-contracts/contracts/errors/L2ContractErrors.sol";

event SettlementLayerChainIdUpdated(uint256 indexed newSettlementLayerChainId);

/**
 * @author Matter Labs
 * @custom:security-contact security@matterlabs.dev
 * @notice Contract that stores some of the context variables, that may be either
 * block-scoped, tx-scoped or system-wide.
 */
contract SystemContext {
    /// @notice The chainId of the settlement layer.
    /// @notice This value will be deprecated in the future, it should not be used by external contracts.
    uint256 public currentSettlementLayerChainId;

    /// @notice Modifier that makes sure that the method
    /// can only be called from the bootloader.
    modifier onlyCallFromBootloader() {
        if (msg.sender != L2_BOOTLOADER_ADDRESS) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    function setSettlementLayerChainId(uint256 _newSettlementLayerChainId) external onlyCallFromBootloader {
        /// Before the genesis upgrade is processed, the block.chainid is wrong. So we skip the setting of the settlement layer chain id.
        /// We set it again after the genesis upgrade is processed.
        if (currentSettlementLayerChainId != _newSettlementLayerChainId && block.chainid != HARD_CODED_CHAIN_ID) {
            currentSettlementLayerChainId = _newSettlementLayerChainId;
            emit SettlementLayerChainIdUpdated(_newSettlementLayerChainId);
        }
    }
}
