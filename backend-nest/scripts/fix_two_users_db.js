/**
 * Script de Auditoria/Recalculo de NetPnL e Limpeza de Orfaos (PostgreSQL + ClickHouse)
 *
 * Uso na VPS Linux:
 *   node backend-nest/scripts/fix_two_users_db.js
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { Client } = require('pg');
const { createClient } = require('@clickhouse/client');

async function runFix() {
    const dbUser = process.env.DB_USER || process.env.DB_USERNAME;
    const dbPass = process.env.DB_PASS || process.env.DB_PASSWORD;
    const dbName = process.env.DB_NAME || process.env.DB_DATABASE;
    if (!dbUser || !dbPass || !dbName) {
        console.error('❌ Variáveis DB_USER, DB_PASS e DB_NAME são obrigatórias.');
        process.exit(1);
    }

    console.log('================================================================================');
    console.log(' SANEAMENTO GENERICO DE NETPNL E ORFAOS (POSTGRESQL + CLICKHOUSE)');
    console.log(' Timestamp:', new Date().toISOString());
    console.log('================================================================================\n');

    const pgConfig = {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: dbUser,
        password: dbPass,
        database: dbName,
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
        console.warn(`[AVISO] Falha ao conectar ao ClickHouse (${chHost}): ${err.message}\n`);
        ch = null;
    }

    try {
        await pg.query('BEGIN');

        // Recalcular coluna "netPnl" em todos os trades onde netPnl estava 0 mas profit/commission/swap != 0
        const fixNetPnl = await pg.query(
            `UPDATE trades
             SET "netPnl" = COALESCE(profit, 0) + COALESCE(commission, 0) + COALESCE(swap, 0)
             WHERE COALESCE("netPnl", 0) = 0
               AND (COALESCE(profit, 0) != 0 OR COALESCE(commission, 0) != 0 OR COALESCE(swap, 0) != 0)`
        );
        console.log(`[1/2] Trades com coluna "netPnl" recalculada no PostgreSQL: ${fixNetPnl.rowCount} registros atualizados.`);

        await pg.query('COMMIT');
        console.log('[OK] Transacao PostgreSQL confirmada com sucesso!\n');

        // Limpar trades orfaos no ClickHouse (contas que nao existem mais no PostgreSQL)
        if (ch) {
            const validAccountsRes = await pg.query(`SELECT id::text AS id FROM accounts`);
            const validAccountIds = validAccountsRes.rows.map(r => r.id);

            if (validAccountIds.length > 0) {
                console.log(`[2/2] Sincronizando ClickHouse: mantendo apenas as ${validAccountIds.length} contas validas do PostgreSQL...`);
                await ch.command({
                    query: `ALTER TABLE trades DELETE WHERE accountId NOT IN ({validAccountIds:Array(String)})`,
                    query_params: { validAccountIds }
                });
                try {
                    await ch.command({ query: `OPTIMIZE TABLE trades FINAL` });
                } catch (optErr) {
                    console.warn(`[AVISO] OPTIMIZE TABLE trades FINAL: ${optErr.message}`);
                }
                console.log('[OK] Limpeza de trades orfaos e deduplicacao FINAL solicitada no ClickHouse!\n');
            }
        }
    } catch (err) {
        await pg.query('ROLLBACK').catch(() => {});
        console.error('\n[ERRO CRITICO NA CORRECAO]:', err);
    } finally {
        await pg.end();
        if (ch) await ch.close();
    }
}

runFix();
