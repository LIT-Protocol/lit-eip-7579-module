// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LitPKPExecutor
 * @dev ERC-7579 Executor Module that enables Lit Protocol PKP signing for smart accounts
 * @author Vincent Team
 */
contract LitPKPExecutor is ReentrancyGuard {
    using ECDSA for bytes32;

    // ERC-7579 Module Type - Executor
    uint256 public constant MODULE_TYPE = 2;
    
    // Events
    event ModuleInstalled(address indexed account, address indexed pkpAddress, bytes32 indexed pkpTokenId);
    event ModuleUninstalled(address indexed account, address indexed pkpAddress);
    event OperationExecuted(address indexed account, address indexed target, uint256 value, bytes data);
    event PKPSignatureVerified(address indexed account, bytes32 operationHash, address pkpAddress);

    // Errors
    error InvalidModule();
    error InvalidSignature();
    error ExecutionFailed();
    error ModuleNotInstalled();
    error ModuleAlreadyInstalled();
    error UnauthorizedPKP();

    // Struct to store PKP information for each account
    struct PKPInfo {
        address pkpEthAddress;    // PKP Ethereum address
        bytes32 pkpTokenId;       // PKP Token ID
        bool isInstalled;         // Installation status
    }

    // Mapping from smart account address to PKP info
    mapping(address => PKPInfo) public accountPKPs;

    // Mapping to track if a PKP is already used by another account
    mapping(address => address) public pkpToAccount;

    /**
     * @dev Install the module for a smart account
     * @param data Encoded PKP data (pkpEthAddress, pkpTokenId)
     */
    function onInstall(bytes calldata data) external {
        (address pkpEthAddress, bytes32 pkpTokenId) = abi.decode(data, (address, bytes32));
        
        if (accountPKPs[msg.sender].isInstalled) {
            revert ModuleAlreadyInstalled();
        }

        if (pkpToAccount[pkpEthAddress] != address(0)) {
            revert UnauthorizedPKP();
        }

        accountPKPs[msg.sender] = PKPInfo({
            pkpEthAddress: pkpEthAddress,
            pkpTokenId: pkpTokenId,
            isInstalled: true
        });

        pkpToAccount[pkpEthAddress] = msg.sender;

        emit ModuleInstalled(msg.sender, pkpEthAddress, pkpTokenId);
    }

    /**
     * @dev Uninstall the module from a smart account
     */
    function onUninstall(bytes calldata) external {
        PKPInfo storage pkpInfo = accountPKPs[msg.sender];
        
        if (!pkpInfo.isInstalled) {
            revert ModuleNotInstalled();
        }

        address pkpEthAddress = pkpInfo.pkpEthAddress;
        
        delete accountPKPs[msg.sender];
        delete pkpToAccount[pkpEthAddress];

        emit ModuleUninstalled(msg.sender, pkpEthAddress);
    }

    /**
     * @dev Check if the module is installed for an account
     * @param account The smart account address
     * @param moduleTypeId The module type ID (should be 2 for executor)
     * @return True if module is installed
     */
    function isModuleInstalled(address account, uint256 moduleTypeId) external view returns (bool) {
        if (moduleTypeId != MODULE_TYPE) {
            return false;
        }
        return accountPKPs[account].isInstalled;
    }

    /**
     * @dev Execute an operation signed by the PKP
     * @param target The target contract address
     * @param value The value to send
     * @param data The call data
     * @param pkpSignature The signature from the PKP
     * @return result The result of the execution
     */
    function executeFromExecutor(
        address target,
        uint256 value,
        bytes calldata data,
        bytes calldata pkpSignature
    ) external nonReentrant returns (bytes memory result) {
        PKPInfo storage pkpInfo = accountPKPs[msg.sender];
        
        if (!pkpInfo.isInstalled) {
            revert ModuleNotInstalled();
        }

        // Create the operation hash
        bytes32 operationHash = keccak256(
            abi.encodePacked(
                msg.sender,  // smart account address
                target,      // target address
                value,       // value
                data,        // call data
                block.chainid, // chain ID to prevent replay attacks
                address(this)  // executor address
            )
        );

        // Verify the PKP signature
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", operationHash));
        address recoveredSigner = ECDSA.recover(ethSignedMessageHash, pkpSignature);

        if (recoveredSigner != pkpInfo.pkpEthAddress) {
            revert InvalidSignature();
        }

        emit PKPSignatureVerified(msg.sender, operationHash, pkpInfo.pkpEthAddress);

        // Execute the operation
        (bool success, bytes memory returnData) = target.call{value: value}(data);
        
        if (!success) {
            revert ExecutionFailed();
        }

        emit OperationExecuted(msg.sender, target, value, data);
        
        return returnData;
    }

    /**
     * @dev Get PKP information for an account
     * @param account The smart account address
     * @return pkpEthAddress The PKP Ethereum address
     * @return pkpTokenId The PKP Token ID
     * @return isInstalled Whether the module is installed
     */
    function getPKPInfo(address account) external view returns (
        address pkpEthAddress,
        bytes32 pkpTokenId,
        bool isInstalled
    ) {
        PKPInfo storage pkpInfo = accountPKPs[account];
        return (pkpInfo.pkpEthAddress, pkpInfo.pkpTokenId, pkpInfo.isInstalled);
    }

    /**
     * @dev Create operation hash for signing
     * @param account The smart account address
     * @param target The target contract address
     * @param value The value to send
     * @param data The call data
     * @return operationHash The hash to be signed
     */
    function getOperationHash(
        address account,
        address target,
        uint256 value,
        bytes calldata data
    ) external view returns (bytes32 operationHash) {
        return keccak256(
            abi.encodePacked(
                account,     // smart account address
                target,      // target address
                value,       // value
                data,        // call data
                block.chainid, // chain ID
                address(this)  // executor address
            )
        );
    }

    /**
     * @dev Check if this contract supports ERC-7579
     */
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC7579Module).interfaceId;
    }
}

/**
 * @dev Interface for ERC-7579 modules
 */
interface IERC7579Module {
    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
    function isModuleInstalled(address account, uint256 moduleTypeId) external view returns (bool);
}