-- CREATE DATABASE IF NOT EXISTS TOREXJ;
-- USE TOREXJ;

CREATE TABLE IF NOT EXISTS trades (
    id String,
    accountId String,
    ticket String,
    contractId Nullable(String),
    symbol String,
    type String,
    volume Decimal(18, 5),
    openPrice Decimal(18, 5),
    closePrice Decimal(18, 5),
    profit Decimal(18, 2),
    sl Nullable(Decimal(18, 5)),
    tp Nullable(Decimal(18, 5)),
    commission Decimal(18, 2),
    swap Decimal(18, 2),
    openTime DateTime,
    closeTime Nullable(DateTime),
    status String,
    magic Nullable(UInt32),
    comment Nullable(String),
    session Nullable(String),
    mood Nullable(String),
    rating Nullable(UInt8),
    setup Nullable(String),
    lesson Nullable(String),
    tags Array(String),
    dataQuality String,
    importLogId Nullable(UInt32),
    updatedAt DateTime
) ENGINE = ReplacingMergeTree(updatedAt)
ORDER BY (accountId, ticket, id);

CREATE TABLE IF NOT EXISTS market_ticks (
    timestamp DateTime64(3),
    symbol String,
    bid Decimal(18, 5),
    ask Decimal(18, 5),
    last Decimal(18, 5),
    volume Decimal(18, 5),
    mt5Id String
) ENGINE = MergeTree()
ORDER BY (symbol, timestamp);
