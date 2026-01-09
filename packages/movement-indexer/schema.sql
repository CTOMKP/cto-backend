-- Movement trade and metrics tables for Sentio
-- These tables are queried by the backend TradeHistoryService.

create table if not exists movement_trades (
  tx_hash text,
  event_index integer,
  block_time timestamp,
  maker_address text,
  token_in text,
  token_out text,
  amount_in numeric,
  amount_out numeric,
  price numeric,
  total_value numeric,
  chain text,
  primary key (tx_hash, event_index)
);

create table if not exists movement_transfers (
  tx_hash text,
  event_index integer,
  block_time timestamp,
  token_address text,
  from_address text,
  to_address text,
  amount numeric,
  chain text,
  primary key (tx_hash, event_index)
);

create table if not exists movement_mints (
  tx_hash text,
  event_index integer,
  block_time timestamp,
  token_address text,
  minter_address text,
  amount numeric,
  chain text,
  primary key (tx_hash, event_index)
);
