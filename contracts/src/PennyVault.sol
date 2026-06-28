// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockQQQ} from "./MockQQQ.sol";
import {IReceiveWithAuthorization} from "./interfaces/IReceiveWithAuthorization.sol";

/// @title PennyVault — the on-chain portfolio register (testnet demo scope).
/// @notice Mints fractional mQQQ at a fixed mock NAV on verified payment confirmations, idempotent per
///         paymentRef, and tracks a confirmed-vs-settled ledger that mirrors the rail's instant-confirm /
///         batch-settle reality. Spec: BLUEPRINT_v1.2.1 §4.3 + SYSTEM_DESIGN §4.2.
/// @dev Invariants upheld: I-2 (one mint per paymentRef, on-chain via `processedPayments`),
///      I-5 (exact-amount authorizations enforced upstream; the contract mints the exact confirmed amount).
contract PennyVault {
    /// @notice The mQQQ token this vault mints. Deployed by this vault, which is its sole minter.
    MockQQQ public immutable MQQQ;

    /// @notice Native USDC (EIP-3009) — used ONLY by the dormant §10.1 fallback. Arc testnet: 0x3600…0000.
    ///         Injected at construction so tests can supply a mock EIP-3009 token.
    IReceiveWithAuthorization public immutable USDC;

    /// @notice Backend Mint Orchestrator EOA — the only caller of settleAndMint / recordSettlement.
    address public operator;

    /// @notice 500 USDC per mQQQ share (USDC = 6 decimals).
    uint256 public constant MOCK_NAV_USDC = 500e6;

    /// @notice Sum of Nanopayments-confirmed sweeps.
    uint256 public totalConfirmedUsdc;
    /// @notice Recorded as batched settlement lands (true-up).
    uint256 public totalSettledUsdc;

    /// @notice Idempotency guard (I-2): one mint per payment ref, ever.
    mapping(bytes32 => bool) public processedPayments;
    /// @notice Per-beneficiary lifetime sweeps.
    mapping(address => uint256) public totalSweptUsdc;

    event SweepConfirmed(
        address indexed beneficiary, uint256 usdcAmount, uint256 sharesMinted, bytes32 indexed paymentRef, string memo
    );
    event SettlementRecorded(uint256 usdcAmount, bytes32 indexed batchRef);

    /// @notice EIP-3009 authorization bundle consumed by the dormant fallback.
    struct Eip3009Auth {
        address from;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    /// @param operator_ backend Mint Orchestrator EOA (OPERATOR_PRIVATE_KEY).
    /// @param usdc_ native USDC (EIP-3009) address — used only by the dormant fallback; injectable for tests.
    constructor(address operator_, address usdc_) {
        operator = operator_;
        USDC = IReceiveWithAuthorization(usdc_);
        MQQQ = new MockQQQ(address(this));
    }

    /// @notice PRIMARY path. Called by the Mint Orchestrator after Nanopayments confirms the sweep.
    ///         `paymentRef` is derived deterministically from the confirmation, so each verified
    ///         payment mints exactly once (I-2).
    function settleAndMint(address beneficiary, uint256 usdcAmount, bytes32 paymentRef, string calldata memo)
        external
        onlyOperator
    {
        _settleAndMint(beneficiary, usdcAmount, paymentRef, memo);
    }

    /// @notice Records a landed Gateway netted-batch settlement, keeping the confirmed/settled pair
    ///         reconciled for the dashboard's settlement ledger.
    function recordSettlement(uint256 usdcAmount, bytes32 batchRef) external onlyOperator {
        totalSettledUsdc += usdcAmount;
        emit SettlementRecorded(usdcAmount, batchRef);
    }

    /// @notice DORMANT §10.1 FALLBACK — NOT called by the backend unless the human explicitly engages
    ///         §10.1. Pulls the agent's authorized USDC via native EIP-3009 `receiveWithAuthorization`
    ///         and mints atomically, removing the operator from the trust path. Permissionless by design:
    ///         the agent's signature IS the authorization, and `receiveWithAuthorization` enforces that
    ///         only this vault (as `to`) can pull the signed funds.
    function investWithAuthorization(
        address beneficiary,
        uint256 usdcAmount,
        bytes32 paymentRef,
        string calldata memo,
        Eip3009Auth calldata auth
    ) external {
        // `to` is hardwired to this vault: EIP-3009 receiveWithAuthorization requires msg.sender == to.
        USDC.receiveWithAuthorization(
            auth.from, address(this), usdcAmount, auth.validAfter, auth.validBefore, auth.nonce, auth.v, auth.r, auth.s
        );
        _settleAndMint(beneficiary, usdcAmount, paymentRef, memo);
    }

    /// @dev Shared idempotent mint path (I-2) used by both the primary and fallback entrypoints.
    function _settleAndMint(address beneficiary, uint256 usdcAmount, bytes32 paymentRef, string calldata memo)
        internal
    {
        require(!processedPayments[paymentRef], "duplicate payment ref");
        processedPayments[paymentRef] = true;

        totalConfirmedUsdc += usdcAmount;
        totalSweptUsdc[beneficiary] += usdcAmount;

        uint256 shares = usdcAmount * 1e18 / MOCK_NAV_USDC; // $2.15 (2_150000) -> 0.0043e18 = 4.3e15
        MQQQ.mint(beneficiary, shares);

        emit SweepConfirmed(beneficiary, usdcAmount, shares, paymentRef, memo);
    }
}
