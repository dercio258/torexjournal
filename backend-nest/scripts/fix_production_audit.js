/**
 * Script de Correcao Completa da Auditoria Tecnica (PostgreSQL)
 * Corrige em producao os itens identificados em docs/AUDITORIA_MT5_SYNC_2026-11-08.md:
 *  - A7: Remove ordens pendentes importadas por engano (buy limit / ticket='2026')
 *  - A7: Normaliza 100% de trades.type para 'BUY' | 'SELL' (corrige 97% dos trades que apareciam como SELL na UI)
 *  - A7: Corrige close_time invalido no futuro (ano 4179) para open_time com dataQuality='partial'
 *  - C3: Gera app_token seguro para as contas com app_token NULL
 *  - C2: Corrige import_logs onde userId divergia do dono real da conta
 *  - A4: Corrige initial_balance = 0 nas contas com saldo/trades
 *  - C2/M3: Cria indice unico uq_accounts_user_mt5_server e idx_import_logs_user_account
 *
 * Uso na VPS Linux:
 *   node backend-nest/scripts/fix_production_audit.js
 */

const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function runAuditFixes() {
    console.log('================================================================================');
    console.log(' CORRECAO COMPLETA DA AUDITORIA DE PRODUCAO (POSTGRESQL)');
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
    console.log(`[OK] Conectado ao PostgreSQL: ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}\n`);

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
        console.log(`[1/7] Ordens pendentes/invalidas removidas de trades: ${delPending.rowCount}`, delPending.rows);

        // 2. A7: Normalizar todos os trades.type para 'BUY' ou 'SELL'
        const normTypes = await pg.query(
            `UPDATE trades
             SET type = CASE
                 WHEN LOWER(TRIM(type)) LIKE '%sell%' OR LOWER(TRIM(type)) LIKE '%put%' THEN 'SELL'
                 ELSE 'BUY'
             END
             WHERE type NOT IN ('BUY', 'SELL')`
        );
        console.log(`[2/7] Trades com coluna 'type' padronizada para 'BUY' | 'SELL': ${normTypes.rowCount} linhas atualizadas.`);

        // 3. A7: Corrigir close_time invalido no futuro (ex: 4179-05-01)
        const fixFutureClose = await pg.query(
            `UPDATE trades
             SET close_time = open_time,
                 "dataQuality" = 'partial'
             WHERE close_time > NOW() + INTERVAL '2 days'
             RETURNING id, ticket, symbol, open_time, close_time`
        );
        console.log(`[3/7] Trades com close_time no futuro corrigidos: ${fixFutureClose.rowCount}`, fixFutureClose.rows);

        // 4. C3: Preencher app_token nas contas onde esta NULL ou vazio
        const nullTokenAccs = await pg.query(
            `SELECT id, name, mt5_id FROM accounts WHERE app_token IS NULL OR TRIM(app_token) = ''`
        );
        for (const acc of nullTokenAccs.rows) {
            const newToken = crypto.randomUUID().replace(/-/g, '').toUpperCase();
            await pg.query(`UPDATE accounts SET app_token = $1 WHERE id = $2`, [newToken, acc.id]);
        }
        console.log(`[4/7] Contas com app_token NULL protegidas com novo token: ${nullTokenAccs.rowCount}`);

        // 5. C2: Alinhar userId residual em import_logs com o dono real da conta (accounts.user_id)
        const fixImportLogsOwner = await pg.query(
            `UPDATE import_logs i
             SET "userId" = a.user_id::uuid
             FROM accounts a
             WHERE a.id::text = i.account_id::text
               AND i."userId"::text <> a.user_id::text
             RETURNING i.id, i.account_id, i."userId"`
        );
        console.log(`[5/7] Registros de import_logs realinhados ao dono real da conta: ${fixImportLogsOwner.rowCount}`, fixImportLogsOwner.rows);

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
        console.log(`[6/7] Contas com initial_balance recalculado: ${fixInitialBal.rowCount + fixZeroTradeInitialBal.rowCount}`);

        await pg.query('COMMIT');
        console.log('[OK] Transacao de saneamento concluida com sucesso!\n');

        // 7. C2 & M3: Criar indices no PostgreSQL
        const indexStatements = [
            `CREATE INDEX IF NOT EXISTS idx_trades_account_close_time ON trades (account_id, close_time)`,
            `CREATE INDEX IF NOT EXISTS idx_trades_account_status ON trades (account_id, status)`,
            `CREATE INDEX IF NOT EXISTS idx_trades_import_log_id ON trades (import_log_id)`,
            `CREATE INDEX IF NOT EXISTS idx_positions_account_id ON positions (account_id)`,
            `CREATE INDEX IF NOT EXISTS idx_accounts_user_mt5_id ON accounts (user_id, mt5_id)`,
            `CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_user_mt5_server ON accounts (user_id, mt5_id, LOWER(broker)) WHERE mt5_id IS NOT NULL AND mt5_id <> ''`,
            `CREATE INDEX IF NOT EXISTS idx_import_logs_user_account ON import_logs ("userId", account_id, "createdAt" DESC)`
        ];

        for (const sql of indexStatements) {
            await pg.query(sql);
            console.log(`[7/7 OK] ${sql}`);
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
    }
}

runAuditFixes();
