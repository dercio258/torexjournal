import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { ClickHouseClient } from '@clickhouse/client';
import { CLICKHOUSE_CLIENT } from './clickhouse.constants';

@Injectable()
export class ClickHouseService implements OnModuleInit {
    private readonly logger = new Logger(ClickHouseService.name);

    constructor(
        @Inject(CLICKHOUSE_CLIENT) private readonly client: ClickHouseClient
    ) {}

    async onModuleInit() {
        try {
            this.logger.log('Initializing ClickHouse tables...');
            
            // Trades table using ReplacingMergeTree to handle upserts natively based on ticket/id
            await this.client.command({
                query: `
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
                `
            });

            // Market Ticks table using MergeTree ordered by symbol and time
            await this.client.command({
                query: `
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
                `
            });

            this.logger.log('ClickHouse tables initialized successfully.');
        } catch (e) {
            this.logger.error('Failed to initialize ClickHouse tables: ' + e.message);
        }
    }

    async saveTrade(trade: any) {
        try {
            await this.client.insert({
                table: 'trades',
                values: [this.mapTrade(trade)],
                format: 'JSONEachRow'
            });
        } catch (e) {
            this.logger.error(`Failed to save trade ${trade?.ticket} to ClickHouse: ${e.message}`);
        }
    }

    async saveTrades(trades: any[]) {
        if (!trades || trades.length === 0) return;
        try {
            const mapped = trades.map(t => this.mapTrade(t));
            await this.client.insert({
                table: 'trades',
                values: mapped,
                format: 'JSONEachRow'
            });
        } catch (e) {
            this.logger.error(`Failed to save ${trades.length} trades to ClickHouse: ${e.message}`);
        }
    }

    async saveTick(tick: any) {
        try {
            const formattedTime = new Date(tick.timestamp).toISOString().replace('T', ' ').replace('Z', '');
            await this.client.insert({
                table: 'market_ticks',
                values: [{
                    timestamp: formattedTime,
                    symbol: tick.symbol,
                    bid: Number(tick.bid),
                    ask: Number(tick.ask),
                    last: Number(tick.last || 0),
                    volume: Number(tick.volume || 0),
                    mt5Id: String(tick.mt5Id || '')
                }],
                format: 'JSONEachRow'
            });
        } catch (e) {
            this.logger.error(`Failed to save tick for ${tick?.symbol} to ClickHouse: ${e.message}`);
        }
    }

    async query(queryStr: string, params?: Record<string, any>) {
        try {
            const resultSet = await this.client.query({
                query: queryStr,
                query_params: params,
                format: 'JSONEachRow'
            });
            return await resultSet.json<any>();
        } catch (e) {
            this.logger.error(`ClickHouse query failed: ${queryStr}. Error: ${e.message}`);
            throw e;
        }
    }

    private mapTrade(t: any) {
        return {
            id: String(t.id),
            accountId: String(t.accountId || t.account?.id || ''),
            ticket: String(t.ticket),
            contractId: t.contractId ? String(t.contractId) : null,
            symbol: String(t.symbol),
            type: String(t.type),
            volume: Number(t.volume || 0),
            openPrice: Number(t.openPrice || 0),
            closePrice: Number(t.closePrice || 0),
            profit: Number(t.profit || 0),
            sl: t.sl !== null && t.sl !== undefined ? Number(t.sl) : null,
            tp: t.tp !== null && t.tp !== undefined ? Number(t.tp) : null,
            commission: Number(t.commission || 0),
            swap: Number(t.swap || 0),
            openTime: new Date(t.openTime).toISOString().replace('T', ' ').replace('Z', ''),
            closeTime: t.closeTime ? new Date(t.closeTime).toISOString().replace('T', ' ').replace('Z', '') : null,
            status: String(t.status || 'CLOSED'),
            magic: t.magic !== null && t.magic !== undefined ? Number(t.magic) : null,
            comment: t.comment ? String(t.comment) : null,
            session: t.session ? String(t.session) : null,
            mood: t.mood ? String(t.mood) : null,
            rating: t.rating !== null && t.rating !== undefined ? Number(t.rating) : null,
            setup: t.setup ? String(t.setup) : null,
            lesson: t.lesson ? String(t.lesson) : null,
            tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
            dataQuality: String(t.dataQuality || 'UNKNOWN'),
            importLogId: t.importLogId !== null && t.importLogId !== undefined ? Number(t.importLogId) : null,
            updatedAt: new Date(t.updatedAt || new Date()).toISOString().replace('T', ' ').replace('Z', '')
        };
    }
}
