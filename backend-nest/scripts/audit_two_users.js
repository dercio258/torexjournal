/**
 * Script de Auditoria Profunda (PostgreSQL + ClickHouse)
 * Foco: derciomatsope9@gmail.com e helidiobusiness@gmail.com (+ contas MT5 associadas)
 *
 * Uso no servidor Linux:
 *   cd /var/www/torexjournal.com && git pull origin main && node backend-nest/scripts/audit_two_users.js
 */

const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { createClient } = require('@clickhouse/client');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const TARGET_EMAILS = [
    'derciomatsope9@gmail.com',
    'helidiobusiness@gmail.com',
];

async function runAudit() {
    console.log('================================================================================');
    console.log(' AUDITORIA DE DADOS E METRICAS (POSTGRESQL + CLICKHOUSE)');
    console.log(' Timestamp:', new Date().toISOString());
    console.log('================================================================================\n');

    const pgClient = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASS || 'postgres',
        database: process.env.DB_NAME || 'trading_cossa',
    });

    await pgClient.connect();
    console.log('[OK] Conectado ao PostgreSQL:', `${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'trading_cossa'}`);

    let chClient = null;
    try {
        const chUrl = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
        chClient = createClient({
            url: chUrl,
            username: process.env.CLICKHOUSE_USER || 'default',
            password: process.env.CLICKHOUSE_PASSWORD || '',
            database: process.env.CLICKHOUSE_DATABASE || 'default',
        });
        await chClient.query({ query: 'SELECT 1', format: 'JSONEachRow' });
        console.log('[OK] Conectado ao ClickHouse:', chUrl, `db=${process.env.CLICKHOUSE_DATABASE || 'default'}\n`);
    } catch (chErr) {
        console.warn('[AVISO] Falha ao conectar ao ClickHouse:', chErr.message, '\n');
        chClient = null;
    }

    try {
        // 1. Buscar usuários alvo
        const usersRes = await pgClient.query(
            `SELECT id::text as id, email, username, name, "createdAt", "updatedAt"
             FROM users
             WHERE LOWER(email) = ANY($1::text[])`,
            [TARGET_EMAILS.map(e => e.toLowerCase())]
        );

        console.log('--------------------------------------------------------------------------------');
        console.log(' 1. USUARIOS ENCONTRADOS');
        console.log('--------------------------------------------------------------------------------');
        console.table(usersRes.rows);

        const targetUserIds = usersRes.rows.map(u => String(u.id));

        // 2. Buscar TODAS as contas desses usuários + qualquer conta no banco que tenha mt5_id preenchido
        const accountsRes = await pgClient.query(
            `SELECT a.id::text as id, a.user_id::text as user_id, u.email as owner_email, a.name, a.broker, a.type, a.mt5_id,
                    a.currency, a.initial_balance, a.balance, a.equity, a.margin, a.margin_free,
                    a.is_primary, a.is_archived, a.is_connected, a.last_seen, a."createdAt", a."updatedAt"
             FROM accounts a
             LEFT JOIN users u ON u.id::text = a.user_id::text
             WHERE a.user_id::text = ANY($1::text[])
                OR (a.mt5_id IS NOT NULL AND a.mt5_id != '')
             ORDER BY a."updatedAt" DESC`,
            [targetUserIds]
        );

        console.log('\n--------------------------------------------------------------------------------');
        console.log(' 2. CONTAS DE TRADING (DOS 2 USUARIOS + TODAS AS CONTAS COM MT5_ID NO BANCO)');
        console.log('--------------------------------------------------------------------------------');
        console.table(
            accountsRes.rows.map(a => ({
                id: a.id,
                owner_email: a.owner_email || a.user_id,
                name: a.name,
                broker: a.broker,
                type: a.type,
                mt5_id: a.mt5_id || '(null)',
                initial_bal: Number(a.initial_balance),
                balance: Number(a.balance),
                equity: Number(a.equity),
                primary: a.is_primary,
                archived: a.is_archived,
                connected: a.is_connected,
                last_seen: a.last_seen ? new Date(a.last_seen).toISOString() : null,
            }))
        );

        const auditedAccountIds = accountsRes.rows.map(a => String(a.id));

        // 3. Resumo de Trades no PostgreSQL vs ClickHouse por Conta
        console.log('\n--------------------------------------------------------------------------------');
        console.log(' 3. COMPARATIVO DE TRADES E METRICAS POR CONTA (POSTGRESQL vs CLICKHOUSE)');
        console.log('--------------------------------------------------------------------------------');

        for (const acc of accountsRes.rows) {
            console.log(`\n>>> CONTA: "${acc.name}" | ID: ${acc.id} | MT5_ID: ${acc.mt5_id || 'N/A'} | Corretora: ${acc.broker}`);
            console.log(`    Dono: ${acc.owner_email || acc.user_id} | Saldo DB: $${Number(acc.balance).toFixed(2)} | Equity DB: $${Number(acc.equity).toFixed(2)} | InitialBal: $${Number(acc.initial_balance).toFixed(2)} | Conectada: ${acc.is_connected} | Arquivada: ${acc.is_archived}`);

            // 3.1 Estatísticas no PostgreSQL
            try {
                const pgStats = await pgClient.query(
                    `SELECT
                        COUNT(*) as total_rows,
                        COUNT(*) FILTER (WHERE status = 'CLOSED') as closed_rows,
                        COUNT(*) FILTER (WHERE status = 'OPEN') as open_rows,
                        COUNT(DISTINCT ticket) as distinct_tickets,
                        COUNT(DISTINCT "contractId") as distinct_contracts,
                        COALESCE(SUM(profit) FILTER (WHERE status = 'CLOSED'), 0) as sum_profit,
                        COALESCE(SUM(commission) FILTER (WHERE status = 'CLOSED'), 0) as sum_commission,
                        COALESCE(SUM(swap) FILTER (WHERE status = 'CLOSED'), 0) as sum_swap,
                        COALESCE(SUM(profit + commission + swap) FILTER (WHERE status = 'CLOSED'), 0) as calc_net_pnl,
                        COALESCE(SUM("netPnl") FILTER (WHERE status = 'CLOSED'), 0) as col_net_pnl,
                        COUNT(*) FILTER (WHERE status = 'CLOSED' AND (profit + commission + swap) > 0) as wins_calc,
                        COUNT(*) FILTER (WHERE status = 'CLOSED' AND (profit + commission + swap) < 0) as losses_calc,
                        COUNT(*) FILTER (WHERE status = 'CLOSED' AND (profit + commission + swap) = 0) as zero_pnl_closed,
                        MIN(open_time) as first_trade,
                        MAX(close_time) as last_trade
                     FROM trades
                     WHERE account_id::text = $1`,
                    [String(acc.id)]
                );
                const st = pgStats.rows[0];
                const closedCnt = parseInt(st.closed_rows, 10) || 0;
                const winRatePg = closedCnt > 0 ? ((parseInt(st.wins_calc, 10) / closedCnt) * 100).toFixed(1) : '0.0';

                console.log(`    [PostgreSQL] Total=${st.total_rows} (CLOSED=${st.closed_rows}, OPEN=${st.open_rows}, ZeroPnL_Closed=${st.zero_pnl_closed}) | Tickets Unicos=${st.distinct_tickets} | Contracts Unicos=${st.distinct_contracts}`);
                console.log(`    [PostgreSQL] Profit=$${Number(st.sum_profit).toFixed(2)} | Comm=$${Number(st.sum_commission).toFixed(2)} | Swap=$${Number(st.sum_swap).toFixed(2)} | NetPnL(calc)=$${Number(st.calc_net_pnl).toFixed(2)} | NetPnL(col)=$${Number(st.col_net_pnl).toFixed(2)} | WinRate=${winRatePg}% (${st.wins_calc}W / ${st.losses_calc}L)`);
            } catch (pgErr) {
                console.log(`    [PostgreSQL Stats ERRO] ${pgErr.message}`);
            }

            // 3.2 Estatísticas no ClickHouse (SEM FINAL vs COM FINAL)
            if (chClient) {
                try {
                    const chRawRes = await chClient.query({
                        query: `
                            SELECT
                                count() as total_rows,
                                countIf(status = 'CLOSED') as closed_rows,
                                uniqExact(id) as unique_ids,
                                uniqExact(ticket) as unique_tickets,
                                sumIf(profit, status = 'CLOSED') as sum_profit,
                                sumIf(commission, status = 'CLOSED') as sum_commission,
                                sumIf(swap, status = 'CLOSED') as sum_swap,
                                sumIf(profit + commission + swap, status = 'CLOSED') as calc_net_pnl,
                                countIf(status = 'CLOSED' AND (profit + commission + swap) > 0) as wins,
                                countIf(status = 'CLOSED' AND (profit + commission + swap) < 0) as losses,
                                countIf(status = 'CLOSED' AND (profit + commission + swap) = 0) as zero_pnl
                            FROM trades
                            WHERE accountId = {accId:String}
                        `,
                        query_params: { accId: String(acc.id) },
                        format: 'JSONEachRow',
                    });
                    const chRaw = (await chRawRes.json())[0] || {};

                    const chFinalRes = await chClient.query({
                        query: `
                            SELECT
                                count() as total_rows,
                                countIf(status = 'CLOSED') as closed_rows,
                                uniqExact(id) as unique_ids,
                                uniqExact(ticket) as unique_tickets,
                                sumIf(profit, status = 'CLOSED') as sum_profit,
                                sumIf(commission, status = 'CLOSED') as sum_commission,
                                sumIf(swap, status = 'CLOSED') as sum_swap,
                                sumIf(profit + commission + swap, status = 'CLOSED') as calc_net_pnl,
                                countIf(status = 'CLOSED' AND (profit + commission + swap) > 0) as wins,
                                countIf(status = 'CLOSED' AND (profit + commission + swap) < 0) as losses,
                                countIf(status = 'CLOSED' AND (profit + commission + swap) = 0) as zero_pnl
                            FROM trades FINAL
                            WHERE accountId = {accId:String}
                        `,
                        query_params: { accId: String(acc.id) },
                        format: 'JSONEachRow',
                    });
                    const chFinal = (await chFinalRes.json())[0] || {};

                    console.log(`    [ClickHouse SEM FINAL (usado atualmente no Dashboard!)] Rows=${chRaw.total_rows} (CLOSED=${chRaw.closed_rows}, ZeroPnL=${chRaw.zero_pnl}) | UniqueIDs=${chRaw.unique_ids} | UniqueTickets=${chRaw.unique_tickets} | NetPnL=$${Number(chRaw.calc_net_pnl || 0).toFixed(2)} (Profit=$${Number(chRaw.sum_profit || 0).toFixed(2)}, Comm=$${Number(chRaw.sum_commission || 0).toFixed(2)}, Swap=$${Number(chRaw.sum_swap || 0).toFixed(2)}) | Wins=${chRaw.wins} / Losses=${chRaw.losses}`);
                    console.log(`    [ClickHouse COM FINAL (desduplicado)]                   Rows=${chFinal.total_rows} (CLOSED=${chFinal.closed_rows}, ZeroPnL=${chFinal.zero_pnl}) | UniqueIDs=${chFinal.unique_ids} | UniqueTickets=${chFinal.unique_tickets} | NetPnL=$${Number(chFinal.calc_net_pnl || 0).toFixed(2)} (Profit=$${Number(chFinal.sum_profit || 0).toFixed(2)}, Comm=$${Number(chFinal.sum_commission || 0).toFixed(2)}, Swap=$${Number(chFinal.sum_swap || 0).toFixed(2)}) | Wins=${chFinal.wins} / Losses=${chFinal.losses}`);
                } catch (e) {
                    console.log(`    [ClickHouse ERRO] ${e.message}`);
                }
            }

            // 3.3 Amostra dos últimos 10 trades desta conta no PostgreSQL
            try {
                const sampleTrades = await pgClient.query(
                    `SELECT id::text as id, ticket, "contractId" as contract_id, symbol, type, volume, open_price, close_price,
                            profit, commission, swap, "netPnl" as net_pnl, status, open_time, close_time, comment, import_log_id
                     FROM trades
                     WHERE account_id::text = $1
                     ORDER BY COALESCE(close_time, open_time) DESC
                     LIMIT 10`,
                    [String(acc.id)]
                );
                if (sampleTrades.rows.length > 0) {
                    console.log(`    Ultimos ${sampleTrades.rows.length} trades no PostgreSQL:`);
                    console.table(
                        sampleTrades.rows.map(t => ({
                            ticket: t.ticket,
                            contract_id: t.contract_id,
                            symbol: t.symbol,
                            type: t.type,
                            vol: Number(t.volume),
                            open: Number(t.open_price),
                            close: Number(t.close_price),
                            profit: Number(t.profit),
                            comm: Number(t.commission),
                            swap: Number(t.swap),
                            net_pnl: Number(t.net_pnl),
                            status: t.status,
                            open_time: t.open_time ? new Date(t.open_time).toISOString() : null,
                            close_time: t.close_time ? new Date(t.close_time).toISOString() : null,
                            log_id: t.import_log_id,
                        }))
                    );
                }
            } catch (sampleErr) {
                console.log(`    [Sample Trades ERRO] ${sampleErr.message}`);
            }

            // 3.4 Posições em aberto no PostgreSQL
            try {
                const posRes = await pgClient.query(
                    `SELECT ticket, symbol, type, volume, "openPrice", "currentPrice", profit, "openTime"
                     FROM positions
                     WHERE "accountId"::text = $1`,
                    [String(acc.id)]
                );
                if (posRes.rows.length > 0) {
                    console.log(`    Posicoes Abertas (${posRes.rows.length}):`);
                    console.table(posRes.rows);
                }
            } catch { }
        }

        // 4. Verificar se existem trades órfãos no ClickHouse cujos accountId não batem com PostgreSQL
        if (chClient) {
            console.log('\n--------------------------------------------------------------------------------');
            console.log(' 4. AGRUPAMENTO GERAL POR ACCOUNT_ID NO CLICKHOUSE');
            console.log('--------------------------------------------------------------------------------');
            try {
                const chByAcc = await chClient.query({
                    query: `
                        SELECT
                            accountId,
                            count() as raw_rows,
                            uniqExact(id) as unique_ids,
                            uniqExact(ticket) as unique_tickets,
                            sum(profit + commission + swap) as raw_net_pnl
                        FROM trades
                        GROUP BY accountId
                        ORDER BY raw_rows DESC
                    `,
                    format: 'JSONEachRow',
                });
                console.table(await chByAcc.json());
            } catch (e) {
                console.log('Erro ao agrupar ClickHouse:', e.message);
            }
        }

        // 5. Logs de Importação (import_logs) dos 2 usuários
        console.log('\n--------------------------------------------------------------------------------');
        console.log(' 5. ULTIMOS 30 LOGS DE IMPORTACAO / SINCRONIZACAO (import_logs)');
        console.log('--------------------------------------------------------------------------------');
        try {
            const logsRes = await pgClient.query(
                `SELECT l.id, u.email as user_email, l.account_id::text as account_id, a.name as acc_name, a.mt5_id,
                        l.method, l.status, l."tradesCount", l.details, l."createdAt"
                 FROM import_logs l
                 LEFT JOIN users u ON u.id::text = l."userId"::text
                 LEFT JOIN accounts a ON a.id::text = l.account_id::text
                 WHERE l."userId"::text = ANY($1::text[])
                    OR l.account_id::text = ANY($2::text[])
                    OR l.details LIKE '%408953138%'
                    OR l.details LIKE '%202658742%'
                 ORDER BY l."createdAt" DESC
                 LIMIT 30`,
                [
                    targetUserIds,
                    auditedAccountIds.length > 0 ? auditedAccountIds : ['00000000-0000-0000-0000-000000000000'],
                ]
            );
            console.table(
                logsRes.rows.map(l => ({
                    id: l.id,
                    email: l.user_email,
                    acc_id: l.account_id ? l.account_id.substring(0, 8) + '...' : null,
                    acc_name: l.acc_name,
                    mt5_id: l.mt5_id,
                    method: l.method,
                    status: l.status,
                    trades: l.tradesCount,
                    details: (l.details || '').substring(0, 90),
                    created_at: l.createdAt ? new Date(l.createdAt).toISOString() : null,
                }))
            );
        } catch (logErr) {
            console.log('Erro ao consultar import_logs:', logErr.message);
        }

        // 6. Instâncias Cloud (cloud_instances)
        try {
            const ciRes = await pgClient.query(`SELECT * FROM cloud_instances ORDER BY "updatedAt" DESC LIMIT 20`);
            if (ciRes.rows.length > 0) {
                console.log('\n--------------------------------------------------------------------------------');
                console.log(' 6. INSTANCIAS CLOUD (cloud_instances)');
                console.log('--------------------------------------------------------------------------------');
                console.table(ciRes.rows);
            }
        } catch { }

        console.log('\n================================================================================');
        console.log(' FIM DA AUDITORIA');
        console.log('================================================================================');
    } finally {
        await pgClient.end();
        if (chClient) {
            await chClient.close();
        }
    }
}

runAudit().catch(err => {
    console.error('Erro fatal na auditoria:', err);
    process.exit(1);
});
