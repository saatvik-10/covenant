// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IGmxReader.sol";

contract CovenantVerifier {
    IGmxReader public immutable reader;
    address public immutable dataStore;
    address public immutable market;
    address public immutable collateralToken;

    event VerdictComputed(
        bytes32 indexed userPubkey,
        bytes32 indexed constraintHash,
        address executor,
        uint256 shortSizeUsd,
        bool passed
    );

    constructor(address _reader, address _dataStore, address _market, address _collateralToken) {
        reader = IGmxReader(_reader);
        dataStore = _dataStore;
        market = _market;
        collateralToken = _collateralToken;
    }

    function _positionKey(address account, bool isLong) internal view returns (bytes32) {
        return keccak256(abi.encode(account, market, collateralToken, isLong));
    }

    function checkPosition(
        address executor,
        uint256 maxNetExposureUsd
    ) public view returns (uint256 shortSizeUsd, bool passed) {
        bytes32 key = _positionKey(executor, false); //false = short
        IGmxReader.Position memory pos = reader.getPosition(dataStore, key);

        shortSizeUsd = pos.numbers.sizeInUsd;
        passed = shortSizeUsd >= maxNetExposureUsd;
    }

    function checkAndRecord(
        bytes32 userPubkey,
        bytes32 constraintHash,
        address executor,
        uint256 maxNetExposureUsd
    ) external returns (bool passed) {
        uint256 shortSizeUsd;
        (shortSizeUsd, passed) = checkPosition(executor, maxNetExposureUsd);

        emit VerdictComputed(userPubkey, constraintHash, executor, shortSizeUsd, passed);
    }
}