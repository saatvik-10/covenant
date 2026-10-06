// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/CovenantVerifier.sol";

contract DeployVerifier is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        // owner defaults to the recorded demo wallet; override via GMX_EXECUTOR
        address owner = vm.envOr("GMX_EXECUTOR", address(0x0Ac16B86d0396Bb7558f144fBb9FbbB91857ff4b));
        vm.startBroadcast(deployerPrivateKey);

        CovenantVerifier verifier = new CovenantVerifier(
            0x6EDCE65403992e310A62460808c4b910D972f10f, // LZ Endpoint
            owner,
            40168,
            0x4750376b9378294138Cf7B7D69a2d243f4940f71,
            0xCF4c2C4c53157BcC01A596e3788fFF69cBBCD201,
            0xb6fC4C9eB02C35A134044526C62bb15014Ac0Bcc,
            0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773
        );

        console.log("CovenantVerifier deployed at:", address(verifier));

        vm.stopBroadcast();
    }
}