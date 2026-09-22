// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import "@layerzerolabs/oapp-evm/contracts/oapp/libs/OAppOptionsType3.sol";
import "./interfaces/IGmxReader.sol";

contract CovenantVerifier is OApp, OAppOptionsType3 {
    IGmxReader public immutable reader;
    address public immutable dataStore;
    address public immutable market;
    address public immutable collateralToken;

    uint32 public solanaEid;

    event VerdictComputed(
        bytes32 indexed userPubkey,
        bytes32 indexed constraintHash,
        address executor,
        uint256 shortSizeUsd,
        bool passed
    );

    event VerdictSent(bytes32 indexed userPubkey, bytes32 indexed constraintHash, bool passed);

    constructor(
        address _endpoint,
        address _owner,
        uint32 _solanaEid,
        address _reader,
        address _dataStore,
        address _market,
        address _collateralToken
    ) OApp(_endpoint, _owner) Ownable(_owner) {
        require(_dataStore != address(0), "zero dataStore");
        require(_market != address(0), "zero market");
        require(_collateralToken != address(0), "zero collateralToken");

        solanaEid = _solanaEid;
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
        bytes32 key = _positionKey(executor, false);
        IGmxReader.Position memory pos = reader.getPosition(dataStore, key);

        shortSizeUsd = pos.numbers.sizeInUsd;
        passed = shortSizeUsd >= maxNetExposureUsd;
    }

    /// @notice Reads the real GMX position, evaluates it, and sends the
    /// verdict to Solana via LayerZero. Caller must pay the LZ messaging fee
    /// as msg.value — use quoteSend() first to know how much.
    function checkAndSend(
        bytes32 userPubkey,
        bytes32 constraintHash,
        address executor,
        uint256 maxNetExposureUsd,
        bytes calldata extraOptions
    ) external payable returns (bool passed) {
        uint256 shortSizeUsd;
        (shortSizeUsd, passed) = checkPosition(executor, maxNetExposureUsd);

        emit VerdictComputed(userPubkey, constraintHash, executor, shortSizeUsd, passed);

        bytes memory payload = abi.encode(userPubkey, constraintHash, passed);
        bytes memory options = combineOptions(solanaEid, 1, extraOptions);

        _lzSend(
            solanaEid,
            payload,
            options,
            MessagingFee(msg.value, 0),
            payable(msg.sender)
        );

        emit VerdictSent(userPubkey, constraintHash, passed);
    }

    function quoteSend(
        bytes32 userPubkey,
        bytes32 constraintHash,
        bool passed,
        bytes calldata extraOptions
    ) external view returns (MessagingFee memory fee) {
        bytes memory payload = abi.encode(userPubkey, constraintHash, passed);
        bytes memory options = combineOptions(solanaEid, 1, extraOptions);
        fee = _quote(solanaEid, payload, options, false);
}

    /// @dev Required by OApp — this contract doesn't receive messages, only sends.
    function _lzReceive(
        Origin calldata,
        bytes32,
        bytes calldata,
        address,
        bytes calldata
    ) internal override {
        revert("CovenantVerifier: send-only, does not receive");
    }
}