// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PennyVault} from "../src/PennyVault.sol";
import {MockQQQ} from "../src/MockQQQ.sol";

/// @title Deploy — Arc testnet deployment of PennyVault (which deploys MockQQQ).
/// @notice Run (dry):       forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL
///         Run (broadcast): forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --broadcast
/// @dev Reads OPERATOR_PRIVATE_KEY (the disclosed operator/deployer EOA, I-4) and USDC_ADDRESS from env.
///      The deployer EOA is set as the vault operator. USDC is only used by the dormant §10.1 fallback.
contract Deploy is Script {
    // Arc testnet native USDC (EIP-3009), confirmed in Unit 03a / OQ6.
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 operatorPk = vm.envUint("OPERATOR_PRIVATE_KEY");
        address operator = vm.addr(operatorPk);
        address usdc = vm.envOr("USDC_ADDRESS", ARC_USDC);

        vm.startBroadcast(operatorPk);
        PennyVault vault = new PennyVault(operator, usdc);
        vm.stopBroadcast();

        MockQQQ mqqq = vault.MQQQ();

        console.log("operator (deployer):", operator);
        console.log("USDC (fallback)    :", usdc);
        console.log("PennyVault         :", address(vault));
        console.log("MockQQQ (mQQQ)     :", address(mqqq));
        console.log("MOCK_NAV_USDC      :", vault.MOCK_NAV_USDC());
    }
}
