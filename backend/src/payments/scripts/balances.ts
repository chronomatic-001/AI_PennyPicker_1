import "dotenv/config";

import { createPublicClient, erc20Abi, formatUnits, http, isAddress, type Address } from "viem";
import { arcTestnet } from "viem/chains";
import {
  addressExplorerUrl,
  describeCircleBalances,
  getWalletById,
  getWalletsWithBalances,
} from "../circle-client.js";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

async function main(): Promise<void> {
  const address = await resolveAddress();
  const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl),
  });

  const [nativeGasWei, erc20Decimals, erc20Balance] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    client.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);
  const sdkWallets = await getWalletsWithBalances(address);

  const lines = [
    `address=${address}`,
    `explorer=${addressExplorerUrl(address)}`,
    "",
    "Arc native gas USDC (18 dp, never use for sweep/mint math)",
    `nativeGasWei=${nativeGasWei.toString()}`,
    `nativeGasUsdc=${formatUnits(nativeGasWei, 18)}`,
    "",
    "Arc ERC-20 USDC interface (6 dp app money)",
    `erc20Address=${USDC_ADDRESS}`,
    `erc20Decimals=${erc20Decimals}`,
    `erc20MicroUsdc=${erc20Balance.toString()}`,
    `erc20Usdc=${formatUnits(erc20Balance, erc20Decimals)}`,
    "",
    "Circle SDK balance view",
    ...formatSdkBalances(sdkWallets),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function resolveAddress(): Promise<Address> {
  const addressArg = process.argv[2];
  if (addressArg) {
    if (!isAddress(addressArg)) {
      throw new Error(`Invalid address argument: ${addressArg}`);
    }
    return addressArg;
  }

  const walletId = process.env.CIRCLE_WALLET_ID;
  if (!walletId) {
    throw new Error("Set CIRCLE_WALLET_ID or pass an address argument");
  }
  const wallet = await getWalletById(walletId);
  return wallet.address as Address;
}

function formatSdkBalances(wallets: Awaited<ReturnType<typeof getWalletsWithBalances>>): string[] {
  if (wallets.length === 0) {
    return ["No Circle developer-controlled wallet balance was returned for this address."];
  }

  return wallets.flatMap((wallet) => [
    `walletId=${wallet.id} accountType=${wallet.accountType} blockchain=${wallet.blockchain}`,
    ...describeCircleBalances(wallet.tokenBalances),
  ]);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`balances failed: ${message}\n`);
  process.exit(1);
});
