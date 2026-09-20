// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IGmxReader {
    struct Addresses {
        address account;
        address market;
        address collateralTokens;
    }

    struct Numbers {
        uint256 sizeInUsd;
        uint256 sizeInTokens;
        uint256 collateralAmount;
        int256 pendingImpactAmount;
        uint256 borrowingFactor;
        uint256 fundingFeeAmountPerSize;
        uint256 longTokenClaimableFundingAmountPerSize;
        uint256 shortTokenClaimableFundingAmountPerSize;
        uint256 increasedAtTime;
        uint256 decreasedAtTime;
    }

    struct Flags {
        bool isLong;
    }

    struct Position {
        Addresses addresses;
        Numbers numbers;
        Flags flags;
    }

    function getPosition(address datastore, bytes32 key) external view returns (Position memory);
} 