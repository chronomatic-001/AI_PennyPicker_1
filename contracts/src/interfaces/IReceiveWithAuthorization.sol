// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IReceiveWithAuthorization — EIP-3009 receive surface used by the dormant §10.1 fallback.
/// @notice Verified on Arc testnet USDC (Circle FiatTokenV2, 0x3600…0000) in Unit 03a / OQ6: a probe
///         call reverts with "FiatTokenV2: authorization is expired", proving the function exists and
///         runs FiatTokenV2 logic. The PRIMARY rail does NOT use this — it binds an EIP-3009
///         TransferWithAuthorization to the GatewayWalletBatched domain (ARCHITECTURE I-1). This
///         interface backs the fallback path only (BLUEPRINT §4.3 / §10.1).
/// @dev `receiveWithAuthorization` (vs `transferWithAuthorization`) enforces `msg.sender == to`, so a
///      contract can be the payee and atomically pull authorized funds into itself.
interface IReceiveWithAuthorization {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
