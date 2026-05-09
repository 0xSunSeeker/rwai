// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IReputationRegistry
/// @notice ERC-8004 Reputation Registry interface
/// @dev Deployed at 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 on Mantle Mainnet
interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 filehash
    ) external;
}
