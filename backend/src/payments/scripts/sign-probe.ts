import "dotenv/config";

import { zeroAddress, type Address } from "viem";
import {
  ARC_TESTNET_CHAIN,
  getWalletById,
  signTypedData,
} from "../circle-client.js";

const CHAIN_ID = 5042002;
const GATEWAY_WALLET_ADDRESS =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;

async function main(): Promise<void> {
  requireExplicitConfirmation();

  const walletId = process.env.CIRCLE_WALLET_ID;
  if (!walletId) {
    throw new Error("Set CIRCLE_WALLET_ID before running the signing probe");
  }

  const wallet = await getWalletById(walletId);
  const payload = buildExpiredTransferWithAuthorizationPayload(wallet.address as Address);
  const signature = await signTypedData({
    walletId,
    data: JSON.stringify(payload),
    memo: "AI PennyPicker OQ7 dummy EIP-712 signing probe; expired and never submitted",
  });

  const passed = signature.startsWith("0x") && signature.length >= 132;
  if (!passed) {
    throw new Error("Circle returned a signature in an unexpected format");
  }

  process.stdout.write(
    [
      "PASS: Circle Wallets signTypedData returned a valid-looking signature.",
      "The raw signature was not printed.",
      `walletId=${wallet.id}`,
      `walletAddress=${wallet.address}`,
      `chain=${ARC_TESTNET_CHAIN}`,
    ].join("\n") + "\n",
  );
}

function requireExplicitConfirmation(): void {
  if (!process.argv.includes("--confirm-dummy-signature")) {
    throw new Error(
      "Refusing to sign typed data without --confirm-dummy-signature. " +
      "This probe signs an expired dummy authorization and prints no signature.",
    );
  }
}

function buildExpiredTransferWithAuthorizationPayload(from: Address): object {
  return {
    domain: {
      name: "GatewayWalletBatched",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: process.env.GATEWAY_WALLET_ADDRESS || GATEWAY_WALLET_ADDRESS,
    },
    primaryType: "TransferWithAuthorization",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    message: {
      from,
      to: zeroAddress,
      value: "1",
      validAfter: "0",
      validBefore: "1",
      nonce: "0x0000000000000000000000000000000000000000000000000000000000000000",
    },
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sign-probe failed: ${message}\n`);
  process.exit(1);
});
