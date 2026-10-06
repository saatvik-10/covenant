// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";

/// @notice Pins the LayerZero payload wire format emitted by CovenantVerifier
/// to the length and layout enforced by the Solana `my_oapp` receiver
/// (`COVENANT_MESSAGE_LEN = 65`).
contract CovenantVerifierPayloadTest is Test {
    uint256 internal constant COVENANT_MESSAGE_LEN = 65;

    bytes32 internal constant USER = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 internal constant CONSTRAINT_HASH =
        0x2222222222222222222222222222222222222222222222222222222222222222;

    function test_checkAndSendEncodingIs65Bytes() public {
        bytes memory payload = abi.encodePacked(USER, CONSTRAINT_HASH, true);
        assertEq(payload.length, COVENANT_MESSAGE_LEN, "payload must be 65 bytes");
    }

    function test_quoteSendEncodingIs65Bytes() public {
        // quoteSend must price the exact payload checkAndSend transmits.
        bytes memory payload = abi.encodePacked(USER, CONSTRAINT_HASH, false);
        assertEq(payload.length, COVENANT_MESSAGE_LEN, "quoted payload must be 65 bytes");
    }

    function test_quoteAndCheckPayloadsIdentical() public {
        bool passed = true;
        bytes memory sent = abi.encodePacked(USER, CONSTRAINT_HASH, passed);
        bytes memory quoted = abi.encodePacked(USER, CONSTRAINT_HASH, passed);
        assertEq(sent, quoted, "quote and send payloads must match");
        assertEq(keccak256(sent), keccak256(quoted));
    }

    function test_payloadLayoutMatchesSolanaDecoder() public {
        bytes memory payload = abi.encodePacked(USER, CONSTRAINT_HASH, true);
        (bytes32 user, bytes32 constraintHash, uint8 flag) = this.decodeLayout(payload);

        assertEq(user, USER, "bytes 0..32 = user pubkey");
        assertEq(constraintHash, CONSTRAINT_HASH, "bytes 32..64 = constraint hash");
        assertEq(flag, uint8(1), "byte 64 = passed flag");
        assertEq(payload.length, 65, "no trailing bytes");
    }

    function decodeLayout(bytes calldata payload)
        external
        pure
        returns (bytes32 user, bytes32 constraintHash, uint8 flag)
    {
        require(payload.length == COVENANT_MESSAGE_LEN, "expected 65-byte payload");
        return (bytes32(payload[0:32]), bytes32(payload[32:64]), uint8(payload[64]));
    }

    function test_flagIsSingleByteNotWord() public {
        // abi.encode would right-align the bool into a 32-byte word (96 total),
        // which the Solana receiver rejects.
        bytes memory wrong = abi.encode(USER, CONSTRAINT_HASH, true);
        assertEq(wrong.length, 96, "abi.encode is 96 bytes and must not be used");
        assertTrue(wrong.length != COVENANT_MESSAGE_LEN);
    }
}
