[Version 2]
Every month, we lose track of small amounts of money—a dollar that can be saved with a coupon, or a subscription we forgot to cancel and more. Finding these micro-savings is one thing, but the bigger issue is that on traditional rails, these amounts are too small and too expensive to move.
AI PennyPicker is an autonomous agent that finds these small savings and instantly invests them on-chain—making micro-investing effortless.
To demonstrate this, we've pre-set two common real-world scenarios and pre-funded the agent's Circle Gateway balance. It's a prototype that shows a complete machine-to-machine micro-investment flow, built end-to-end on Circle's stack.
Let's start the demo. The agent immediately finds a $2.15 coupon saving from a coffee run and asks for my permission. Because security is paramount, nothing moves without human approval.
Once I click Approve, watch the feed update in real time:
First, the agent calls our merchant endpoint, which responds with a 402 Payment Required — an x402 challenge carrying the exact amount, payee address, and the Circle Gateway as the verifying contract.
Second, the agent builds an EIP-3009 "TransferWithAuthorization" — a single-use, cryptographically signed order for exactly $2.15 of USDC — and signs it through Circle Wallets, so no private key ever leaves Circle's MPC.
Third, the signed authorization is submitted over the open x402 protocol to Circle Nanopayments, which verifies the signature, deducts the $2.15 from the pre-funded Circle Gateway balance off-chain in milliseconds, and returns an instant confirmation — no gas, no block to wait for.
Fourth, because the payment is already deducted, the mint doesn't wait for on-chain settlement: our backend immediately calls the PennyVault contract on Arc, which rejects any duplicate payment reference and mints the exact mQQQ shares to my portfolio address — while the netted batch settles on-chain separately.
It's that fast. 
A few seconds later, the agent flags a $9.50 gaming subscription I haven't used in months.
I approve, and this time, the agent does a pre-sweep action: it cancels the subscription first to prevent future leaks, then instantly sweeps the recovered $9.50 into the same investment pipeline.
In under two minutes, we successfully swept $11.65 into an on-chain investment position. We can click the transaction link to verify both mints directly on the blockchain explorer.
Simple, secure, and truly instant—turning the small savings you'd otherwise lose into an on-chain investment that can grow.


