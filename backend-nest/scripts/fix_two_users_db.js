/**
 * Script de Correcao e Saneamento de Dados (PostgreSQL + ClickHouse)
 * Foco:
 *  - derciomatsope9@gmail.com (50f4649c-5380-4e2b-b2eb-b62feeb37466)
 *  - helidiobusiness@gmail.com (1f2a5862-e70c-473d-a9c9-756da2d22045)
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

const DERCIO_ID = '50f4649c-5380-4e2b-b2eb-b62feeb37466';
const HELIDIO_ID = '1f2a5862-e70c-473d-a9c9-756da2d22045';

async function runFix() {
    console.log('================================================================================');
    console.log(' SANEAMENTO E CORRECAO DE CONTAS E METRICAS (POSTGRESQL + CLICKHOUSE)');
    console.log(' Timestamp:', new Date().toISOString());
    console.log('================================================================================\n');

    const pgConfig = process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false }
        : {
              host: process.env.DB_HOST || 'localhost',
              port: parseInt(process.env.DB_PORT || '5432', 10),
              user: process.env.DB_USERNAME || 'postgres',
              password: process.env.DB_PASSWORD || 'postgres',
              database: process.env.DB_DATABASE || 'torex_journal',
              ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
          };

    const pg = new Client(pgConfig);
    await pg.connect();
    console.log(`[OK] Conectado ao PostgreSQL: ${pgConfig.host || 'DATABASE_URL'}:${pgConfig.port || ''}/${pgConfig.database || ''}`);

    let ch = null;
    const chHost = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const chUser = process.env.CLICKHOUSE_USER || 'default';
    const chPassword = process.env.CLICKHOUSE_PASSWORD || '';
    const chDatabase = process.env.CLICKHOUSE_DB || 'default';

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

        // 1. Desarquivar a conta real MT5 202658742 de Dercio (Deriv-Demo, 65 trades reais, saldo $4714.23)
        const fixDercioMt5 = await pg.query(
            `UPDATE accounts
             SET is_archived = false,
                 name = 'MT5 202658742 (Deriv)',
                 broker = 'Deriv-Demo',
                 initial_balance = 10000.00,
                 "updatedAt" = NOW()
             WHERE id = '682548a5-fae4-431d-8a6c-5f39e2cff53d'
               AND user_id::text = $1
             RETURNING id, name, broker, mt5_id, is_archived, initial_balance, balance, equity`,
            [DERCIO_ID]
        );
        console.log('[1/6] Conta MT5 202658742 de Dercio desarquivada e restaurada:', fixDercioMt5.rows[0] || 'Nao encontrada');

        // 2. Devolver a conta c1e756c6-5937-4331-85f5-fff85698384a (15 trades de arquivo EURUSDm/USDJPYm do log #53)
        //    de volta para Dercio e remover o vinculo falso 'MT5 202658742427' que havia contaminado a conta de Helidio
        const fixStolenAcc = await pg.query(
            `UPDATE accounts
             SET user_id = $1,
                 name = 'Exness (Importação Arquivo)',
                 broker = 'Exness',
                 mt5_id = NULL,
                 is_archived = false,
                 is_primary = false,
                 "updatedAt" = NOW()
             WHERE id = 'c1e756c6-5937-4331-85f5-fff85698384a'
             RETURNING id, user_id, name, broker, mt5_id, is_archived`,
            [DERCIO_ID]
        );
        console.log('[2/6] Conta c1e756c6... devolvida para Dercio (removida de Helidio e limpa do mt5_id invalido 202658742427):', fixStolenAcc.rows[0] || 'Nao encontrada');

        // 3. Corrigir saldo inicial vs saldo atual da conta Deriv (DOT90604574) de Dercio (+1524.89 PnL sobre $10,000)
        const fixDercioDeriv = await pg.query(
            `UPDATE accounts
             SET initial_balance = 10000.00,
                 balance = 11524.89,
                 equity = 11524.89,
                 is_archived = false,
                 "updatedAt" = NOW()
             WHERE id = '05c147b5-fcf4-412c-867c-8a5025af7a61'
               AND user_id::text = $1
             RETURNING id, name, broker, initial_balance, balance, equity`,
            [DERCIO_ID]
        );
        console.log('[3/6] Conta Deriv (DOT90604574) de Dercio com saldo corrigido ($10,000 -> $11,524.89):', fixDercioDeriv.rows[0] || 'Nao encontrada');

        // 4. Corrigir nome do broker concatenado na conta MT5 419096791 de Helidio ('MetaTrader 5GoatFunded-Server2' -> 'GoatFunded-Server2')
        const fixHelidioGoat = await pg.query(
            `UPDATE accounts
             SET broker = 'GoatFunded-Server2',
                 name = 'MT5 419096791 (GoatFunded)',
                 is_archived = false,
                 "updatedAt" = NOW()
             WHERE id = 'f3351826-66c1-4120-914e-3531ce8ec353'
               AND user_id::text = $1
             RETURNING id, name, broker, mt5_id, balance, equity`,
            [HELIDIO_ID]
        );
        console.log('[4/6] Conta MT5 419096791 de Helidio corrigida:', fixHelidioGoat.rows[0] || 'Nao encontrada');

        // 5. Recalcular coluna "netPnl" em todos os trades onde netPnl estava 0 mas profit/commission/swap != 0
        const fixNetPnl = await pg.query(
            `UPDATE trades
             SET "netPnl" = COALESCE(profit, 0) + COALESCE(commission, 0) + COALESCE(swap, 0)
             WHERE COALESCE("netPnl", 0) = 0
               AND (COALESCE(profit, 0) != 0 OR COALESCE(commission, 0) != 0 OR COALESCE(swap, 0) != 0)`
        );
        console.log(`[5/6] Trades com coluna "netPnl" recalculada no PostgreSQL: ${fixNetPnl.rowCount} registros atualizados.`);

        await pg.query('COMMIT');
        console.log('[OK] Transacao PostgreSQL confirmada com sucesso!\n');

        // 6. Limpar trades orfaos no ClickHouse (contas que nao existem mais no PostgreSQL)
        if (ch) {
            const validAccountsRes = await pg.query(`SELECT id::text AS id FROM accounts`);
            const validAccountIds = validAccountsRes.rows.map(r => r.id);

            if (validAccountIds.length > 0) {
                console.log(`[6/6] Sincronizando ClickHouse: mantendo apenas as ${validAccountIds.length} contas validas do PostgreSQL...`);
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

        // Resumo pos-correcao das contas dos 2 usuarios
        const summaryRes = await pg.query(
            `SELECT
                a.id,
                u.email,
                a.name,
                a.broker,
                a.mt5_id,
                a.is_primary,
                a.is_archived,
                ROUND(COALESCE(a.initial_balance, 0)::numeric, 2) AS initial_balance,
                ROUND(COALESCE(a.balance, 0)::numeric, 2) AS balance,
                ROUND(COALESCE(a.equity, 0)::numeric, 2) AS equity,
                COUNT(t.id) AS total_trades,
                ROUND(COALESCE(SUM(COALESCE(t.profit, 0) + COALESCE(t.commission, 0) + COALESCE(t.swap, 0)), 0)::numeric, 2) AS real_net_pnl
             FROM accounts a
             JOIN users u ON u.id::text = a.user_id::text
             LEFT JOIN trades t ON t.account_id::text = a.id::text AND t.status = 'CLOSED'
             WHERE a.user_id::text IN ($1, $2)
             GROUP BY a.id, u.email
             ORDER BY u.email, a."createdAt" ASC`,
            [DERCIO_ID, HELIDIO_ID]
        );

        console.log('--------------------------------------------------------------------------------');
        console.log(' ESTADO FINAL DAS CONTAS APOS CORRECAO');
        console.log('--------------------------------------------------------------------------------');
        console.table(summaryRes.rows);

    } catch (err) {
        await pg.query('ROLLBACK').catch(() => {});
        console.error('\n[ERRO CRITICO NA CORRECAO]:', err);
    } finally {
        await pg.end();
        if (ch) await ch.close();
    }
}

runFix();
