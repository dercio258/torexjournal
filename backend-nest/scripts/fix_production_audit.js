/**
 * Script de Correcao Completa da Auditoria Tecnica (PostgreSQL + ClickHouse)
 * Corrige em producao todos os itens de dados identificados em docs/AUDITORIA_MT5_SYNC_2026-11-08.md:
 *  - A7: Remove ordens pendentes importadas por engano (buy limit / ticket='2026')
 *  - A7: Normaliza 100% de trades.type para 'BUY' | 'SELL' (corrige 97% dos trades que apareciam como SELL na UI)
 *  - A7: Corrige close_time invalido no futuro (ano 4179) para open_time com dataQuality='partial'
 *  - C3: Gera app_token seguro para as contas com app_token NULL
 *  - C2: Corrige import_logs onde userId divergia do dono real da conta
 *  - A4: Corrige initial_balance = 0 nas contas com saldo/trades
 *  - C2/M3: Cria indice unico uq_accounts_user_mt5_server e idx_import_logs_user_account
 *  - A5: Faz backfill completo dos 228+ trades faltantes e atualizados do PostgreSQL para o ClickHouse (TOREXJ)
 *
 * Uso na VPS Linux:
 *   node backend-nest/scripts/fix_production_audit.js
 */

const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { createClient } = require('@clickhouse/client');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function formatClickHouseDate(d) {
    if (!d) return null;
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
}

async function runAuditFixes() {
    console.log('================================================================================');
    console.log(' CORRECAO COMPLETA DA AUDITORIA DE PRODUCAO (POSTGRESQL + CLICKHOUSE)');
    console.log(' Timestamp:', new Date().toISOString());
    console.log('================================================================================\n');

    const pgConfig = {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASS || process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || process.env.DB_DATABASE || 'trading_cossa',
    };

    const pg = new Client(pgConfig);
    await pg.connect();
    console.log(`[OK] Conectado ao PostgreSQL: ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`);

    let ch = null;
    const chHost = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const chUser = process.env.CLICKHOUSE_USER || 'default';
    const chPassword = process.env.CLICKHOUSE_PASSWORD || '';
    const chDatabase = process.env.CLICKHOUSE_DATABASE || process.env.CLICKHOUSE_DB || 'default';

    try {
        ch = createClient({
            url: chHost,
            username: chUser,
            password: chPassword,
            database: chDatabase,
        });
        await ch.query({ query: 'SELECT 1', format: 'JSONEachRow' });
        console.log(`[OK] Conectado ao ClickHouse: ${chHost} (db=${chDatabase})\n`);
    } catch (err) {
        console.warn(`[AVISO] ClickHouse indisponivel (${chHost}): ${err.message}\n`);
        ch = null;
    }

    try {
        await pg.query('BEGIN');

        // 1. A7: Remover ordens pendentes (buy limit / sell limit / stop) e tickets invalidos ('2026')
        const delPending = await pg.query(
            `DELETE FROM trades
             WHERE LOWER(type) LIKE '%limit%'
                OR LOWER(type) LIKE '%stop%'
                OR ticket = '2026'
             RETURNING id, account_id, ticket, symbol, type`
        );
        console.log(`[1/8] Ordens pendentes/invalidas removidas de trades: ${delPending.rowCount}`, delPending.rows);

        // 2. A7: Normalizar todos os trades.type para 'BUY' ou 'SELL'
        const normTypes = await pg.query(
            `UPDATE trades
             SET type = CASE
                 WHEN LOWER(TRIM(type)) LIKE '%sell%' OR LOWER(TRIM(type)) LIKE '%put%' THEN 'SELL'
                 ELSE 'BUY'
             END
             WHERE type NOT IN ('BUY', 'SELL')`
        );
        console.log(`[2/8] Trades com coluna 'type' padronizada para 'BUY' | 'SELL': ${normTypes.rowCount} linhas atualizadas.`);

        // 3. A7: Corrigir close_time invalido no futuro (ex: 4179-05-01)
        const fixFutureClose = await pg.query(
            `UPDATE trades
             SET close_time = open_time,
                 "dataQuality" = 'partial'
             WHERE close_time > NOW() + INTERVAL '2 days'
             RETURNING id, ticket, symbol, open_time, close_time`
        );
        console.log(`[3/8] Trades com close_time no futuro corrigidos: ${fixFutureClose.rowCount}`, fixFutureClose.rows);

        // 4. C3: Preencher app_token nas contas onde esta NULL ou vazio
        const nullTokenAccs = await pg.query(
            `SELECT id, name, mt5_id FROM accounts WHERE app_token IS NULL OR TRIM(app_token) = ''`
        );
        for (const acc of nullTokenAccs.rows) {
            const newToken = crypto.randomUUID().replace(/-/g, '').toUpperCase();
            await pg.query(`UPDATE accounts SET app_token = $1 WHERE id = $2`, [newToken, acc.id]);
        }
        console.log(`[4/8] Contas com app_token NULL protegidas com novo token: ${nullTokenAccs.rowCount}`);

        // 5. C2: Alinhar userId residual em import_logs com o dono real da conta (accounts.user_id)
        const fixImportLogsOwner = await pg.query(
            `UPDATE import_logs i
             SET "userId" = a.user_id::uuid
             FROM accounts a
             WHERE a.id::text = i.account_id::text
               AND i."userId"::text <> a.user_id::text
             RETURNING i.id, i.account_id, i."userId"`
        );
        console.log(`[5/8] Registros de import_logs realinhados ao dono real da conta: ${fixImportLogsOwner.rowCount}`, fixImportLogsOwner.rows);

        // 6. A4: Ajustar initial_balance onde initial_balance = 0 e ha saldo positivo (ex: GoatFunded 419096791)
        const fixInitialBal = await pg.query(
            `WITH pnl_summary AS (
                SELECT
                    account_id::text AS acc_id,
                    COALESCE(SUM(COALESCE(profit, 0) + COALESCE(commission, 0) + COALESCE(swap, 0)), 0) AS closed_pnl
                FROM trades
                WHERE status = 'CLOSED'
                GROUP BY account_id::text
             )
             UPDATE accounts a
             SET initial_balance = GREATEST(0, ROUND((COALESCE(a.balance, 0) - COALESCE(p.closed_pnl, 0))::numeric, 2))
             FROM pnl_summary p
             WHERE a.id::text = p.acc_id
               AND COALESCE(a.initial_balance, 0) = 0
               AND COALESCE(a.balance, 0) > 0
             RETURNING a.id, a.name, a.initial_balance, a.balance`
        );
        const fixZeroTradeInitialBal = await pg.query(
            `UPDATE accounts
             SET initial_balance = balance
             WHERE COALESCE(initial_balance, 0) = 0
               AND COALESCE(balance, 0) > 0
             RETURNING id, name, initial_balance, balance`
        );
        console.log(`[6/8] Contas com initial_balance recalculado: ${fixInitialBal.rowCount + fixZeroTradeInitialBal.rowCount}`);

        await pg.query('COMMIT');
        console.log('[OK] Transacao PostgreSQL concluida com sucesso!\n');

        // 7. C2, M3 & Schema Hardening: Alargar precisao numerica para sinteticos/cripto e criar indices no PostgreSQL
        const schemaStatements = [
            `ALTER TABLE trades DROP CONSTRAINT IF EXISTS "UQ_9fa6efcc9af8e74e1abcb1a6e91"`,
            `ALTER TABLE trades ALTER COLUMN open_price TYPE numeric(18,5)`,
            `ALTER TABLE trades ALTER COLUMN close_price TYPE numeric(18,5)`,
            `ALTER TABLE trades ALTER COLUMN sl TYPE numeric(18,5)`,
            `ALTER TABLE trades ALTER COLUMN tp TYPE numeric(18,5)`,
            `ALTER TABLE trades ALTER COLUMN volume TYPE numeric(18,2)`,
            `ALTER TABLE trades ALTER COLUMN profit TYPE numeric(18,2)`,
            `ALTER TABLE trades ALTER COLUMN commission TYPE numeric(18,2)`,
            `ALTER TABLE trades ALTER COLUMN swap TYPE numeric(18,2)`,
            `ALTER TABLE trades ALTER COLUMN "netPnl" TYPE numeric(20,2)`,
            `ALTER TABLE trades ALTER COLUMN net_pnl TYPE numeric(18,2)`,
            `ALTER TABLE positions ALTER COLUMN open_price TYPE numeric(18,5)`,
            `ALTER TABLE positions ALTER COLUMN current_price TYPE numeric(18,5)`,
            `ALTER TABLE positions ALTER COLUMN sl TYPE numeric(18,5)`,
            `ALTER TABLE positions ALTER COLUMN tp TYPE numeric(18,5)`,
            `ALTER TABLE positions ALTER COLUMN volume TYPE numeric(18,2)`,
            `ALTER TABLE positions ALTER COLUMN profit TYPE numeric(18,2)`
        ];

        for (const sql of schemaStatements) {
            try {
                await pg.query(sql);
            } catch (e) {
                console.warn(`[AVISO SCHEMA] ${sql} -> ${e.message}`);
            }
        }

        const indexStatements = [
            `CREATE INDEX IF NOT EXISTS idx_trades_account_close_time ON trades (account_id, close_time)`,
            `CREATE INDEX IF NOT EXISTS idx_trades_account_status ON trades (account_id, status)`,
            `CREATE INDEX IF NOT EXISTS idx_trades_import_log_id ON trades (import_log_id)`,
            `CREATE INDEX IF NOT EXISTS idx_positions_account_id ON positions (account_id)`,
            `CREATE INDEX IF NOT EXISTS idx_accounts_user_mt5_id ON accounts (user_id, mt5_id)`,
            `CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_user_mt5_server ON accounts (user_id, mt5_id, LOWER(broker)) WHERE mt5_id IS NOT NULL AND mt5_id <> ''`,
            `CREATE UNIQUE INDEX IF NOT EXISTS uq_trades_account_contract ON trades (account_id, "contractId") WHERE "contractId" IS NOT NULL`,
            `CREATE INDEX IF NOT EXISTS idx_import_logs_user_account ON import_logs ("userId", account_id, "createdAt" DESC)`
        ];

        for (const sql of indexStatements) {
            await pg.query(sql);
            console.log(`[7/8 OK] ${sql}`);
        }

        // 8. A5: Backfill e sincronizacao completa PostgreSQL -> ClickHouse (TOREXJ.trades)
        if (ch) {
            if (delPending.rows.length > 0) {
                const delIds = delPending.rows.map(r => String(r.id));
                await ch.command({
                    query: `ALTER TABLE trades DELETE WHERE id IN ({delIds:Array(String)})`,
                    query_params: { delIds }
                }).catch(() => {});
            }

            const allPgTrades = await pg.query(`SELECT * FROM trades`);
            const nowStr = formatClickHouseDate(new Date());
            const chRows = allPgTrades.rows.map(t => ({
                id: String(t.id),
                accountId: String(t.account_id || ''),
                ticket: String(t.ticket || t.contractId || t.id || ''),
                contractId: t.contractId ? String(t.contractId) : null,
                symbol: String(t.symbol || ''),
                type: String(t.type || 'BUY'),
                volume: Number(t.volume || 0),
                openPrice: Number(t.open_price || 0),
                closePrice: Number(t.close_price || 0),
                profit: Number(t.profit || 0),
                sl: t.sl !== null && t.sl !== undefined ? Number(t.sl) : null,
                tp: t.tp !== null && t.tp !== undefined ? Number(t.tp) : null,
                commission: Number(t.commission || 0),
                swap: Number(t.swap || 0),
                openTime: formatClickHouseDate(t.open_time) || nowStr,
                closeTime: formatClickHouseDate(t.close_time),
                status: String(t.status || 'CLOSED'),
                magic: t.magic !== null && t.magic !== undefined ? Number(t.magic) : null,
                comment: t.comment ? String(t.comment) : null,
                session: t.session ? String(t.session) : null,
                mood: t.mood ? String(t.mood) : null,
                rating: t.rating !== null && t.rating !== undefined ? Number(t.rating) : null,
                setup: t.setup ? String(t.setup) : null,
                lesson: t.lesson ? String(t.lesson) : null,
                tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
                dataQuality: String(t.dataQuality || 'OK'),
                importLogId: t.import_log_id !== null && t.import_log_id !== undefined ? Number(t.import_log_id) : null,
                updatedAt: nowStr,
            }));

            const batchSize = 500;
            for (let i = 0; i < chRows.length; i += batchSize) {
                await ch.insert({
                    table: 'trades',
                    values: chRows.slice(i, i + batchSize),
                    format: 'JSONEachRow',
                });
            }
            await ch.command({ query: 'OPTIMIZE TABLE trades FINAL' }).catch(() => {});
            const chCountRes = await ch.query({ query: 'SELECT count() AS total FROM trades FINAL', format: 'JSONEachRow' });
            const chCountData = await chCountRes.json();
            console.log(`\n[8/8 OK] Backfill ClickHouse concluido! Total PG: ${chRows.length} | Total ClickHouse FINAL: ${chCountData[0]?.total}`);
        }

        // Verificacao final de distribuicao de tipos de trades
        const typeDist = await pg.query(`SELECT type, status, COUNT(*) AS total FROM trades GROUP BY type, status ORDER BY total DESC`);
        console.log('\nDistribuicao atualizada de trades (type / status):');
        console.table(typeDist.rows);

    } catch (err) {
        await pg.query('ROLLBACK').catch(() => {});
        console.error('\n[ERRO NA CORRECAO DA AUDITORIA]:', err);
    } finally {
        await pg.end();
        if (ch) await ch.close();
    }
}

runAuditFixes();
