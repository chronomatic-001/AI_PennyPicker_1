// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockQQQ — mock tokenized Nasdaq-100 ETF (testnet demo prop).
/// @notice Standard OpenZeppelin ERC-20, 18 decimals. Its single privileged capability is `mint`,
///         restricted to the PennyVault that deployed it. No pause, no blacklist, no upgradeability —
///         testnet scope only (BLUEPRINT §4.2 / §4.4). Production analogue (a compliant RWA token) is
///         deferred, not forgotten.
contract MockQQQ is ERC20 {
    /// @notice The sole authorized minter — the PennyVault that deployed this token.
    address public immutable vault;

    constructor(address vault_) ERC20("Mock Nasdaq-100 ETF", "mQQQ") {
        vault = vault_;
    }

    /// @notice Mint fractional mQQQ shares (18 dp). Restricted to the vault.
    function mint(address to, uint256 shares) external {
        require(msg.sender == vault, "only vault");
        _mint(to, shares);
    }
}
