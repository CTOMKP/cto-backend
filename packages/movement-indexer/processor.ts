import { AptosModulesProcessor } from "@sentio/sdk/aptos";

// Panora swap module (Bardock testnet)
const PANORA_SWAP_MODULE =
  "0x14068303f88046a78f2445b2075531d04130f14f9d0c2688b1470f80b2a91::swap";

// USDC test token ledger (Bardock testnet)
const USDC_LEDGER =
  "0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7";

const PANORA_ADDRESS = PANORA_SWAP_MODULE.split("::")[0];

// NOTE: Swap event names/fields should be verified against Panora logs.
// This processor captures swaps, transfers, and mints to feed MovementTrades/metrics.
AptosModulesProcessor.bind({
  address: PANORA_ADDRESS,
  moduleName: "swap",
  network: "movement_bardock_testnet",
})
  .onEvent("SwapEvent", async (event, ctx) => {
    const amountIn = Number(
      event?.amount_in ?? event?.amountIn ?? event?.amount_in_u64 ?? 0,
    );
    const amountOut = Number(
      event?.amount_out ?? event?.amountOut ?? event?.amount_out_u64 ?? 0,
    );
    const tokenIn = event?.token_in ?? event?.tokenIn ?? "";
    const tokenOut = event?.token_out ?? event?.tokenOut ?? "";

    const price =
      amountOut > 0 ? amountIn / amountOut : null;
    const totalValue = amountOut * (price ?? 0);

    ctx.store.insert("movement_trades", {
      tx_hash: ctx.transaction?.hash,
      event_index: ctx.eventIndex,
      block_time: ctx.transaction?.timestamp,
      maker_address:
        event?.sender ||
        event?.maker ||
        ctx.transaction?.sender ||
        "",
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in: amountIn,
      amount_out: amountOut,
      price: price ?? 0,
      total_value: totalValue ?? 0,
      chain: "movement",
    });
  })
  .onEvent("MintEvent", async (event, ctx) => {
    ctx.store.insert("movement_mints", {
      tx_hash: ctx.transaction?.hash,
      event_index: ctx.eventIndex,
      block_time: ctx.transaction?.timestamp,
      token_address: event?.token ?? event?.coin_type ?? "",
      minter_address:
        event?.minter || ctx.transaction?.sender || "",
      amount: Number(event?.amount ?? 0),
      chain: "movement",
    });
  })
  .onEvent("TransferEvent", async (event, ctx) => {
    const tokenAddress =
      event?.token ?? event?.coin_type ?? event?.type || "";

    // Only track USDC ledger transfers for metrics
    if (
      tokenAddress &&
      tokenAddress.toLowerCase() !== USDC_LEDGER.toLowerCase()
    ) {
      return;
    }

    ctx.store.insert("movement_transfers", {
      tx_hash: ctx.transaction?.hash,
      event_index: ctx.eventIndex,
      block_time: ctx.transaction?.timestamp,
      token_address: tokenAddress,
      from_address: event?.from || event?.from_address || "",
      to_address: event?.to || event?.to_address || "",
      amount: Number(event?.amount ?? 0),
      chain: "movement",
    });
  });
