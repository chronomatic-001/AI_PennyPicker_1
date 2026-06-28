import "dotenv/config";

import {
  ARC_TESTNET_CHAIN,
  addressExplorerUrl,
  getOrCreateAgentWallet,
} from "../circle-client.js";

async function main(): Promise<void> {
  const result = await getOrCreateAgentWallet();
  const wallet = result.wallet;
  const lines = [
    `Circle wallet source: ${result.source}`,
    `Circle chain: ${ARC_TESTNET_CHAIN}`,
    `CIRCLE_WALLET_ID=${wallet.id}`,
    `walletAddress=${wallet.address}`,
    `walletSetId=${wallet.walletSetId}`,
    `explorer=${addressExplorerUrl(wallet.address)}`,
    "Record CIRCLE_WALLET_ID in backend/.env. Do not paste secrets into chat.",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`create-wallet failed: ${message}\n`);
  process.exit(1);
});
