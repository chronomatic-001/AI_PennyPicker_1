// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PennyVault} from "../src/PennyVault.sol";
import {MockQQQ} from "../src/MockQQQ.sol";

/// @dev Minimal EIP-3009 USDC stand-in (6 decimals) for the dormant fallback test. Mirrors the
///      `receiveWithAuthorization` semantics that matter here: caller must be the payee (`to`), and the
///      authorization must not be expired. Signature fields are ignored (no signing in this unit test).
contract MockEIP3009USDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256, /* validAfter */
        uint256 validBefore,
        bytes32, /* nonce */
        uint8, /* v */
        bytes32, /* r */
        bytes32 /* s */
    ) external {
        require(block.timestamp < validBefore, "FiatTokenV2: authorization is expired");
        require(msg.sender == to, "FiatTokenV2: caller must be the payee");
        _transfer(from, to, value);
    }
}

contract PennyVaultTest is Test {
    PennyVault internal vault;
    MockQQQ internal mqqq;
    MockEIP3009USDC internal usdc;

    address internal operator = makeAddr("operator");
    address internal beneficiary = makeAddr("beneficiary");
    address internal stranger = makeAddr("stranger");

    // paymentRef = keccak256(utf8(confirmation_ref)) per SYSTEM_DESIGN §4.3.
    bytes32 internal constant REF_A = keccak256("confirmation-A");
    bytes32 internal constant REF_B = keccak256("confirmation-B");

    // Exact expected shares (SYSTEM_DESIGN §4.4): usdcAmount * 1e18 / 500e6.
    uint256 internal constant SHARES_A = 4.3e15; // $2.15 -> 0.0043 mQQQ
    uint256 internal constant SHARES_B = 1.9e16; // $9.50 -> 0.0190 mQQQ

    function setUp() public {
        usdc = new MockEIP3009USDC();
        vault = new PennyVault(operator, address(usdc));
        mqqq = vault.MQQQ();
    }

    /// @dev Encode a string `require` revert exactly as Solidity does: Error(string).
    function _err(string memory message) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("Error(string)", message);
    }

    // ---------------------------------------------------------------- mint math (§4.4)

    function test_mintMath_eventA() public {
        vm.prank(operator);
        vault.settleAndMint(beneficiary, 2_150000, REF_A, "coffee coupon");

        assertEq(mqqq.balanceOf(beneficiary), SHARES_A);
        assertEq(vault.totalConfirmedUsdc(), 2_150000);
        assertEq(vault.totalSweptUsdc(beneficiary), 2_150000);
        assertTrue(vault.processedPayments(REF_A));
    }

    function test_mintMath_eventB() public {
        vm.prank(operator);
        vault.settleAndMint(beneficiary, 9_500000, REF_B, "subscription leak");

        assertEq(mqqq.balanceOf(beneficiary), SHARES_B);
    }

    function test_mqqq_metadata() public view {
        assertEq(mqqq.name(), "Mock Nasdaq-100 ETF");
        assertEq(mqqq.symbol(), "mQQQ");
        assertEq(mqqq.decimals(), 18);
        assertEq(address(mqqq.vault()), address(vault));
    }

    // ---------------------------------------------------------------- idempotency (I-2)

    function test_duplicateRefReverts() public {
        vm.startPrank(operator);
        vault.settleAndMint(beneficiary, 2_150000, REF_A, "first");
        vm.expectRevert(_err("duplicate payment ref"));
        vault.settleAndMint(beneficiary, 2_150000, REF_A, "again");
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- access control

    function test_nonOperatorReverts() public {
        vm.prank(stranger);
        vm.expectRevert(_err("not operator"));
        vault.settleAndMint(beneficiary, 2_150000, REF_A, "x");
    }

    function test_recordSettlement_nonOperatorReverts() public {
        vm.prank(stranger);
        vm.expectRevert(_err("not operator"));
        vault.recordSettlement(1, keccak256("batch"));
    }

    function test_nonVaultMintReverts() public {
        // a stranger cannot mint mQQQ directly...
        vm.prank(stranger);
        vm.expectRevert(_err("only vault"));
        mqqq.mint(beneficiary, 1e18);

        // ...and neither can the operator: only the vault contract is the minter.
        vm.prank(operator);
        vm.expectRevert(_err("only vault"));
        mqqq.mint(beneficiary, 1e18);
    }

    // ---------------------------------------------------------------- ledger accounting

    function test_ledgerAccumulates() public {
        vm.startPrank(operator);
        vault.settleAndMint(beneficiary, 2_150000, REF_A, "a");
        vault.settleAndMint(beneficiary, 9_500000, REF_B, "b");

        assertEq(vault.totalConfirmedUsdc(), 11_650000); // $11.65 closing frame
        assertEq(vault.totalSweptUsdc(beneficiary), 11_650000);
        assertEq(mqqq.balanceOf(beneficiary), SHARES_A + SHARES_B);
        assertEq(vault.totalSettledUsdc(), 0); // nothing settled yet

        vault.recordSettlement(2_150000, keccak256("batch-1"));
        vault.recordSettlement(9_500000, keccak256("batch-2"));
        assertEq(vault.totalSettledUsdc(), 11_650000); // confirmed and settled converge
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- dormant fallback (§10.1)

    function test_investWithAuthorization_pullsAndMints() public {
        // the buyer (here the beneficiary, for simplicity) holds raw USDC outside Gateway
        usdc.mintTo(beneficiary, 2_150000);

        PennyVault.Eip3009Auth memory auth = PennyVault.Eip3009Auth({
            from: beneficiary,
            validAfter: 0,
            validBefore: block.timestamp + 1 hours,
            nonce: keccak256("nonce-1"),
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });

        // permissionless: anyone may submit a valid authorization; the signature is the authority
        vault.investWithAuthorization(beneficiary, 2_150000, REF_A, "fallback invest", auth);

        assertEq(usdc.balanceOf(address(vault)), 2_150000); // funds pulled atomically to the vault
        assertEq(usdc.balanceOf(beneficiary), 0);
        assertEq(mqqq.balanceOf(beneficiary), SHARES_A); // shares minted via the same path
        assertEq(vault.totalConfirmedUsdc(), 2_150000);
        assertTrue(vault.processedPayments(REF_A));
    }

    function test_investWithAuthorization_duplicateRefReverts() public {
        usdc.mintTo(beneficiary, 4_300000);

        PennyVault.Eip3009Auth memory auth1 = PennyVault.Eip3009Auth({
            from: beneficiary,
            validAfter: 0,
            validBefore: block.timestamp + 1 hours,
            nonce: keccak256("n1"),
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });
        vault.investWithAuthorization(beneficiary, 2_150000, REF_A, "f1", auth1);

        PennyVault.Eip3009Auth memory auth2 = PennyVault.Eip3009Auth({
            from: beneficiary,
            validAfter: 0,
            validBefore: block.timestamp + 1 hours,
            nonce: keccak256("n2"),
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });
        vm.expectRevert(_err("duplicate payment ref"));
        vault.investWithAuthorization(beneficiary, 2_150000, REF_A, "f2", auth2);
    }

    function test_investWithAuthorization_expiredAuthReverts() public {
        usdc.mintTo(beneficiary, 2_150000);
        vm.warp(1000);
        PennyVault.Eip3009Auth memory auth = PennyVault.Eip3009Auth({
            from: beneficiary,
            validAfter: 0,
            validBefore: 1, // already expired
            nonce: keccak256("n"),
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });
        vm.expectRevert(_err("FiatTokenV2: authorization is expired"));
        vault.investWithAuthorization(beneficiary, 2_150000, REF_A, "expired", auth);
    }
}
