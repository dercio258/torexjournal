-- Production cleanup script for PostgreSQL
-- Drop discontinued high-frequency time-series tables and legacy schemas

-- Drop discontinued high-frequency time-series tables (migrated to ClickHouse)
DROP TABLE IF EXISTS market_ticks CASCADE;

-- Drop legacy capitalized tables from Sequelize migrations
DROP TABLE IF EXISTS "Positions" CASCADE;
