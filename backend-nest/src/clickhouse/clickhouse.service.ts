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

    async updateTradeMetadata(tradeId: string, metadata: any) {
        try {
            const updates: string[] = [];
            const params: Record<string, any> = { id: tradeId };
            if (metadata.session !== undefined) {
                updates.push('session = {session:Nullable(String)}');
                params.session = metadata.session;
            }
            if (metadata.mood !== undefined) {
                updates.push('mood = {mood:Nullable(String)}');
                params.mood = metadata.mood;
            }
            if (metadata.setup !== undefined) {
                updates.push('setup = {setup:Nullable(String)}');
                params.setup = metadata.setup;
            }
            if (metadata.lesson !== undefined) {
                updates.push('lesson = {lesson:Nullable(String)}');
                params.lesson = metadata.lesson;
            }
            if (metadata.rating !== undefined) {
                updates.push('rating = {rating:Nullable(UInt8)}');
                params.rating = metadata.rating;
            }
            if (updates.length > 0) {
                await this.client.command({
                    query: `ALTER TABLE trades UPDATE ${updates.join(', ')} WHERE id = {id:String}`,
                    query_params: params
                });
            }
        } catch (e) {
            this.logger.warn(`ClickHouse updateTradeMetadata error: ${e.message}`);
        }
    }

    async deleteTradesByImportLogId(logId: number) {
        if (!logId) return;
        try {
            this.logger.log(`Deleting trades in ClickHouse with importLogId = ${logId}`);
            await this.client.command({
                query: `ALTER TABLE trades DELETE WHERE importLogId = {logId:UInt32}`,
                query_params: { logId: Number(logId) }
            });
            this.logger.log(`Successfully requested deletion for importLogId ${logId} in ClickHouse`);
        } catch (e) {
            this.logger.error(`Failed to delete trades for importLogId ${logId} in ClickHouse: ${e.message}`);
        }
    }

    async deleteTradesByIds(ids: string[]) {
        if (!ids || ids.length === 0) return;
        try {
            this.logger.log(`Deleting ${ids.length} trades in ClickHouse by IDs`);
            const chunkSize = 500;
            for (let i = 0; i < ids.length; i += chunkSize) {
                const chunk = ids.slice(i, i + chunkSize);
                await this.client.command({
                    query: `ALTER TABLE trades DELETE WHERE id IN ({ids:Array(String)})`,
                    query_params: { ids: chunk }
                });
            }
        } catch (e) {
            this.logger.error(`Failed to delete trades by IDs in ClickHouse: ${e.message}`);
        }
    }

    async deleteTradesByAccountId(accountId: string) {
        if (!accountId) return;
        try {
            this.logger.log(`Deleting trades in ClickHouse for accountId = ${accountId}`);
            await this.client.command({
                query: `ALTER TABLE trades DELETE WHERE accountId = {accountId:String}`,
                query_params: { accountId: String(accountId) }
            });
        } catch (e) {
            this.logger.error(`Failed to delete trades for accountId ${accountId} in ClickHouse: ${e.message}`);
        }
    }

    async syncAccountTrades(accountIds: string[], validTrades: any[]) {
        if (!accountIds || accountIds.length === 0) return;
        try {
            if (validTrades && validTrades.length > 0) {
                this.logger.log(`Upserting ${validTrades.length} trades into ClickHouse (ReplacingMergeTree) for accounts: ${accountIds.join(', ')}`);
                await this.saveTrades(validTrades);
            }
        } catch (e) {
            this.logger.error(`Failed to sync account trades in ClickHouse: ${e.message}`);
        }
    }

    async purgeOrphanTradesNotInPg(validPgTradeIds: string[]) {
        try {
            const chRes = await this.client.query({
                query: `SELECT id FROM trades`,
                format: 'JSONEachRow'
            });
            const chTrades = await chRes.json<{ id: string }>();
            const validSet = new Set(validPgTradeIds);
            const orphanIds = chTrades.map(t => t.id).filter(id => !validSet.has(id));
            if (orphanIds.length > 0) {
                this.logger.log(`Found ${orphanIds.length} orphan trades in ClickHouse. Purging...`);
                await this.deleteTradesByIds(orphanIds);
                this.logger.log(`Purged ${orphanIds.length} orphan trades from ClickHouse successfully.`);
            }
            return orphanIds.length;
        } catch (e) {
            this.logger.error(`Failed to purge orphan trades from ClickHouse: ${e.message}`);
            return 0;
        }
    }

    async optimizeTradesTable() {
        try {
            await this.client.command({ query: 'OPTIMIZE TABLE trades FINAL' });
        } catch (e) {
            this.logger.warn(`ClickHouse OPTIMIZE warning: ${e.message}`);
        }
    }

    public mapTrade(t: any) {
        const rawTicket = t.ticket || t.contractId || t.contract_id || t.id || '';
        const rawAccountId = t.accountId || t.account_id || t.account?.id || '';
        const rawOpenTime = t.openTime || t.open_time || new Date();
        const rawCloseTime = t.closeTime || t.close_time;
        const rawUpdatedAt = t.updatedAt || t.updated_at || new Date();

        return {
            id: String(t.id),
            accountId: String(rawAccountId),
            ticket: String(rawTicket),
            contractId: t.contractId || t.contract_id ? String(t.contractId || t.contract_id) : null,
            symbol: String(t.symbol || ''),
            type: String(t.type || ''),
            volume: Number(t.volume || 0),
            openPrice: Number(t.openPrice ?? t.open_price ?? 0),
            closePrice: Number(t.closePrice ?? t.close_price ?? 0),
            profit: Number(t.profit || 0),
            sl: t.sl !== null && t.sl !== undefined ? Number(t.sl) : null,
            tp: t.tp !== null && t.tp !== undefined ? Number(t.tp) : null,
            commission: Number(t.commission || 0),
            swap: Number(t.swap || 0),
            openTime: new Date(rawOpenTime).toISOString().replace('T', ' ').replace('Z', '').split('.')[0],
            closeTime: rawCloseTime ? new Date(rawCloseTime).toISOString().replace('T', ' ').replace('Z', '').split('.')[0] : null,
            status: String(t.status || 'CLOSED'),
            magic: t.magic !== null && t.magic !== undefined ? Number(t.magic) : null,
            comment: t.comment ? String(t.comment) : null,
            session: t.session ? String(t.session) : null,
            mood: t.mood ? String(t.mood) : null,
            rating: t.rating !== null && t.rating !== undefined ? Number(t.rating) : null,
            setup: t.setup ? String(t.setup) : null,
            lesson: t.lesson ? String(t.lesson) : null,
            tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
            dataQuality: String(t.dataQuality || t.data_quality || 'UNKNOWN'),
            importLogId: t.importLogId !== null && t.importLogId !== undefined ? Number(t.importLogId || t.import_log_id) : null,
            updatedAt: new Date(rawUpdatedAt).toISOString().replace('T', ' ').replace('Z', '').split('.')[0]
        };
    }
}
