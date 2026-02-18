// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {GaslessScoreGame} from "../src/GaslessScoreGame.sol";

contract DeployGaslessScoreGame is Script {
    function run() external returns (GaslessScoreGame game) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);
        game = new GaslessScoreGame();
        vm.stopBroadcast();
    }
}

