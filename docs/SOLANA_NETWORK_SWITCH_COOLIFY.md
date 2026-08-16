# Solana Payment Network Switch — Coolify Runbook

This runbook switches CTO Marketplace Solana USDC payments between development testing and real mainnet payments. Both network profiles remain configured; normally only the two network selector variables change.

## Safety rules

- devnet is the operational test network used by this project. Do not use Solana's validator testnet cluster for payment testing.
- Never place a secret or paid RPC credential in a NEXT_PUBLIC_* frontend variable. Browser variables are public.
- Always switch and redeploy the backend before switching the frontend.
- Discard any unsigned or signed payment transaction created before a network change. Request a new quote and create a fresh transaction after both deployments finish.
- Confirm the mainnet treasury address is controlled by CTO Marketplace before accepting real payments.
- Pre-create the treasury's mainnet USDC associated token account when practical so the first payer is not asked to fund its creation.

## Keep both backend profiles configured

Configure these once in the backend Coolify application:

~~~env
SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com
SOLANA_DEVNET_USDC_MINT=6e5qtpMzrLzDM8R6fHQtoF6d2iybHBYdj56tceKZo9sn
SOLANA_DEVNET_ADMIN_WALLET=<CTO_DEVNET_TREASURY_ADDRESS>

SOLANA_MAINNET_RPC_URL=<PRIVATE_BACKEND_MAINNET_RPC_URL>
SOLANA_MAINNET_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
SOLANA_MAINNET_ADMIN_WALLET=<CTO_MAINNET_TREASURY_ADDRESS>

# USDC atomic units; USDC has six decimals. 1000000 = 1 USDC.
SOLANA_LISTING_PAYMENT_AMOUNT=1000000
~~~

Use a reliable paid RPC URL on the backend for production. Profile-specific variables take precedence over legacy SOLANA_RPC_URL, SOLANA_USDC_MINT, SOLANA_ADMIN_WALLET, and ADMIN_WALLET_SOLANA fallbacks.

## Keep both frontend RPC profiles configured

Configure these in the main frontend Coolify application:

~~~env
NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL=https://api.mainnet-beta.solana.com
~~~

A browser-safe provider endpoint can replace the public mainnet URL. Do not expose a private RPC key here. Avoid setting the legacy NEXT_PUBLIC_SOLANA_RPC_URL unless a deliberate common fallback is required.

## Switch to mainnet

1. In the backend Coolify environment, set:

   ~~~env
   SOLANA_NETWORK=mainnet-beta
   ~~~

2. Confirm SOLANA_MAINNET_RPC_URL, SOLANA_MAINNET_USDC_MINT, and SOLANA_MAINNET_ADMIN_WALLET are saved and available at runtime.
3. Redeploy the backend and wait until it is healthy.
4. With an authenticated draft listing, request the listing quote. Confirm the response contains:

   ~~~text
   network: mainnet-beta
   chainId: solana:mainnet
   tokenAddress: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
   ~~~

5. In the frontend Coolify environment, set:

   ~~~env
   NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta
   ~~~

6. Redeploy the frontend. NEXT_PUBLIC_* variables are embedded during the Next.js build, so restarting an old image is insufficient.
7. Use a controlled low-value listing to run the acceptance test below before opening payments broadly.

## Switch back to devnet

1. Set the backend selector:

   ~~~env
   SOLANA_NETWORK=devnet
   ~~~

2. Redeploy the backend and confirm a fresh quote returns network: devnet and chainId: solana:devnet.
3. Set the frontend selector:

   ~~~env
   NEXT_PUBLIC_SOLANA_NETWORK=devnet
   ~~~

4. Redeploy the frontend.
5. Discard transactions produced under mainnet and generate new devnet transactions.

## Payment acceptance test

Run this after every network switch:

1. Sign in with a test account whose Privy profile contains a Solana wallet.
2. Ensure the wallet has SOL for transaction fees and the correct network's USDC token.
3. Create or open a draft listing and request a fresh payment quote.
4. Confirm the displayed network, amount, token mint, and treasury destination match the active backend profile.
5. Create the payment transaction, sign it through the Privy Solana wallet, and let the authenticated backend broadcast it.
6. Confirm the transaction on the correct Solana explorer cluster.
7. Confirm the backend payment record becomes COMPLETED, the transaction hash is stored only once, and the listing moves to PENDING_APPROVAL.
8. Confirm the CTO treasury received the exact USDC amount and that the frontend shows the successful state.
9. Attempting to reuse the transaction hash for another payment must be rejected.

## Rollback triggers

Immediately switch both applications back to devnet or disable the payment entry point if any of these occur:

- the quote reports a different network or mint from the intended profile;
- the treasury destination is incorrect;
- the backend cannot verify the on-chain sender, recipient, mint, or amount;
- Privy selects a non-Solana wallet or signs for the wrong chain;
- a completed payment does not advance the listing to PENDING_APPROVAL.
