#!/usr/bin/env node
/**
 * Script de Auditoria Detalhada de Lucro (Profit vs NetPnL) e Fuso Horário (Datas/Horas)
 * Alvo padrão: helidiobusiness@gmail.com / Conta MT5 #419096791 (GoatFunded-Server2)
 * Uso: node backend-nest/scripts/inspect_helidio_trades.js [email_ou_mt5_id]
 */

const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const targetEmail = (process.argv[2] || 'helidiobusiness@gmail.com').trim().toLowerCase();
const targetMt5Id = (process.argv[3] || '419096791').trim();

async function getTableColumns(client, tableName) {
    const res = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [tableName]
    );
    return new Set(res.rows.map(r => r.column_name));
}

async function main() {
    const client = new Client({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USERNAME || process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
        database: process.env.DB_DATABASE || process.env.DB_NAME || 'cossa_trading',
    });

    await client.connect();
    console.log(`\n========================================================================================`);
    console.log(`🔍 AUDITORIA DE LUCROS E FUSO HORÁRIO — ${targetEmail} (MT5 #${targetMt5Id})`);
    console.log(`========================================================================================\n`);

    try {
        const userRes = await client.query(
            `SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1`,
            [targetEmail]
        );
        const user = userRes.rows[0] || null;

        if (user) {
            console.log(`👤 Usuário: ${user.name || user.username || 'Sem nome'} (${user.email})`);
            console.log(`   ID: ${user.id}\n`);
        } else {
            console.log(`⚠️ Usuário "${targetEmail}" não encontrado pelo e-mail exato; buscando diretamente pela conta MT5 #${targetMt5Id}...\n`);
        }

        const accCols = await getTableColumns(client, 'accounts');
        const userIdCol = accCols.has('user_id') ? 'user_id' : (accCols.has('userId') ? '"userId"' : 'user_id');
        const mt5IdCol = accCols.has('mt5_id') ? 'mt5_id' : (accCols.has('mt5Id') ? '"mt5Id"' : 'mt5_id');

        let accRes;
        if (user) {
            accRes = await client.query(
                `SELECT * FROM accounts WHERE ${userIdCol}::text = $1 OR ${mt5IdCol}::text = $2`,
                [String(user.id), targetMt5Id]
            );
        } else {
            accRes = await client.query(
                `SELECT * FROM accounts WHERE ${mt5IdCol}::text = $1`,
                [targetMt5Id]
            );
        }

        console.log(`🏦 Contas encontradas (${accRes.rows.length}):`);
        for (const acc of accRes.rows) {
            const mt5Login = acc.mt5_id || acc.mt5Id || 'N/A';
            console.log(
                `   • Conta UUID: ${acc.id} | Nome: "${acc.name}" | MT5 Login: ${mt5Login} | ` +
                `Servidor: ${acc.broker || 'N/A'} | Saldo: $${Number(acc.balance || 0).toFixed(2)} | ` +
                `Equity: $${Number(acc.equity || 0).toFixed(2)} | InitialBalance: $${Number(acc.initial_balance ?? acc.initialBalance ?? 0).toFixed(2)}`
            );
        }

        const posCols = await getTableColumns(client, 'positions');
        const posAccCol = posCols.has('account_id') ? 'account_id' : (posCols.has('accountId') ? '"accountId"' : 'account_id');

        const tradeCols = await getTableColumns(client, 'trades');
        const tradeAccCol = tradeCols.has('account_id') ? 'account_id' : (tradeCols.has('accountId') ? '"accountId"' : 'account_id');

        const logCols = await getTableColumns(client, 'import_logs');
        const logAccCol = logCols.has('account_id') ? 'account_id' : (logCols.has('accountId') ? '"accountId"' : 'account_id');

        // Ordena para que a conta alvo (419096791) apareça POR ÚLTIMO no terminal (sem rolar para fora da tela)
        // e limita a listagem de outras contas secundárias com centenas de trades a apenas um resumo.
        const sortedAccounts = [...accRes.rows].sort((a, b) => {
            const aIsTarget = String(a.mt5_id || a.mt5Id || '') === targetMt5Id ? 1 : 0;
            const bIsTarget = String(b.mt5_id || b.mt5Id || '') === targetMt5Id ? 1 : 0;
            return aIsTarget - bIsTarget;
        });

        for (const acc of sortedAccounts) {
            const mt5Login = String(acc.mt5_id || acc.mt5Id || 'Manual');
            const isTargetAccount = mt5Login === targetMt5Id || sortedAccounts.length === 1;
            const posRes = await client.query(
                `SELECT * FROM positions WHERE ${posAccCol}::text = $1`,
                [String(acc.id)]
            );
            const tradesRes = await client.query(
                `SELECT * FROM trades WHERE ${tradeAccCol}::text = $1`,
                [String(acc.id)]
            );

            tradesRes.rows.sort((a, b) => new Date(b.close_time || b.closeTime || b.open_time || b.openTime || 0) - new Date(a.close_time || a.closeTime || a.open_time || a.openTime || 0));

            console.log(`\n========================================================================================`);
            console.log(`📊 CONTA: ${acc.name} (MT5 #${mt5Login} | Servidor: ${acc.broker || 'N/A'} | UUID: ${acc.id})`);
            console.log(`   Saldo: $${Number(acc.balance || 0).toFixed(2)} | Equity: $${Number(acc.equity || 0).toFixed(2)} | Posições Abertas: ${posRes.rows.length} | Trades Fechados: ${tradesRes.rows.length}`);
            console.log(`========================================================================================`);

            if (!isTargetAccount && tradesRes.rows.length > 10) {
                console.log(`   ℹ️ Conta secundária com ${tradesRes.rows.length} trades (ocultando lista individual para focar na conta #${targetMt5Id}).`);
                continue;
            }

            if (posRes.rows.length > 0) {
                console.log(`\n🟢 POSIÇÕES ABERTAS (${posRes.rows.length}):`);
                posRes.rows.forEach((p, idx) => {
                    const openRaw = p.open_time || p.openTime;
                    console.log(
                        `   ${idx + 1}. Ticket: ${p.ticket} | ${p.symbol} | ${p.type} | Vol: ${p.volume} | ` +
                        `OpenPrice: ${p.open_price ?? p.openPrice} | Profit: $${Number(p.profit || 0).toFixed(2)} | ` +
                        `Swap: $${Number(p.swap || 0).toFixed(2)} | OpenTime (DB ISO): ${openRaw ? new Date(openRaw).toISOString() : 'N/A'}`
                    );
                });
            }

            console.log(`\n🔵 TRADES FECHADOS DETALHADOS (${tradesRes.rows.length}):`);
            if (tradesRes.rows.length === 0) {
                console.log(`   (Nenhum trade fechado nesta conta)`);
            } else {
                let sumGross = 0;
                let sumComm = 0;
                let sumSwap = 0;
                let sumNet = 0;

                tradesRes.rows.forEach((t, idx) => {
                    const cId = t.contractId || t.contract_id || 'N/A';
                    const openPr = Number(t.open_price ?? t.openPrice ?? 0);
                    const closePr = Number(t.close_price ?? t.closePrice ?? 0);
                    const grossProfit = Number(t.profit || 0);
                    const comm = Number(t.commission || 0);
                    const swap = Number(t.swap || 0);
                    const dbNetPnl = Number(t.netPnl ?? t.net_pnl ?? (grossProfit + comm + swap));
                    const uiCalculatedPnl = grossProfit + comm + swap;

                    sumGross += grossProfit;
                    sumComm += comm;
                    sumSwap += swap;
                    sumNet += uiCalculatedPnl;

                    const openRaw = t.open_time || t.openTime;
                    const closeRaw = t.close_time || t.closeTime;
                    const openIso = openRaw ? new Date(openRaw).toISOString() : 'N/A';
                    const closeIso = closeRaw ? new Date(closeRaw).toISOString() : 'N/A';
                    const openPtUtc = openRaw ? new Date(openRaw).toLocaleString('pt-BR', { timeZone: 'UTC' }) : 'N/A';
                    const closePtUtc = closeRaw ? new Date(closeRaw).toLocaleString('pt-BR', { timeZone: 'UTC' }) : 'N/A';

                    console.log(`\n   #${String(idx + 1).padStart(2, '0')} [ID: ${t.id}]`);
                    console.log(`      • Ticket (Torex) : ${t.ticket} | Position ID (contractId): ${cId}`);
                    console.log(`      • Ativo / Tipo   : ${t.symbol} | ${t.type} | Volume: ${Number(t.volume || 0).toFixed(2)} | Status: ${t.status}`);
                    console.log(`      • Preços         : Entrada = ${openPr} -> Saída = ${closePr} (SL: ${t.sl ?? 'N/A'}, TP: ${t.tp ?? 'N/A'})`);
                    console.log(`      • 💰 LUCROS      :`);
                    console.log(`          - Profit Bruto (coluna profit no MT5) : $${grossProfit.toFixed(2)}`);
                    console.log(`          - Comissão (commission)               : $${comm.toFixed(2)}`);
                    console.log(`          - Swap (swap)                         : $${swap.toFixed(2)}`);
                    console.log(`          - Net PnL salvo no DB ("netPnl")      : $${dbNetPnl.toFixed(2)}`);
                    console.log(`          - PnL exibido na Tabela (Profit+C+S)  : $${uiCalculatedPnl.toFixed(2)}`);
                    console.log(`      • 🕒 DATAS / HORÁRIOS (Fuso Horário)      :`);
                    console.log(`          - open_time  (DB UTC / Exibido)       : ${openIso}  ->  ${openPtUtc}`);
                    console.log(`          - close_time (DB UTC / Exibido)       : ${closeIso}  ->  ${closePtUtc}`);
                    console.log(`          - Qualidade / Origem                  : dataQuality=${t.dataQuality || t.data_quality || 'N/A'} | importLogId=${t.import_log_id || t.importLogId || 'N/A'} | comment="${t.comment || ''}"`);
                });

                console.log(`\n   📈 TOTAIS ACUMULADOS DOS ${tradesRes.rows.length} TRADES:`);
                console.log(`      • Soma Profit Bruto : $${sumGross.toFixed(2)}`);
                console.log(`      • Soma Comissões    : $${sumComm.toFixed(2)}`);
                console.log(`      • Soma Swap         : $${sumSwap.toFixed(2)}`);
                console.log(`      • Soma PnL Líquido  : $${sumNet.toFixed(2)}`);

                // Corrige automaticamente initial_balance da conta se estiver divergente do (balance - sumNet)
                const currentBal = Number(acc.balance || 0);
                const currentInit = Number(acc.initial_balance ?? acc.initialBalance ?? 0);
                const expectedInit = Number((currentBal - sumNet).toFixed(2));
                if (currentBal > 0 && expectedInit > 0 && Math.abs(currentInit - expectedInit) > 1) {
                    const initCol = accCols.has('initial_balance') ? 'initial_balance' : '"initialBalance"';
                    await client.query(
                        `UPDATE accounts SET ${initCol} = $1 WHERE id = $2`,
                        [expectedInit, acc.id]
                    );
                    console.log(`      ✅ Saldo Inicial (InitialBalance) corrigido automaticamente de $${currentInit.toFixed(2)} para $${expectedInit.toFixed(2)}!`);
                }
            }

            if (logCols.size > 0) {
                const logsRes = await client.query(
                    `SELECT * FROM import_logs WHERE ${logAccCol}::text = $1`,
                    [String(acc.id)]
                );
                logsRes.rows.sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0));
                console.log(`\n📜 LOGS DE IMPORTAÇÃO DA CONTA (${logsRes.rows.length}):`);
                for (const l of logsRes.rows.slice(0, 10)) {
                    const rawDt = l.created_at || l.createdAt;
                    const dt = rawDt ? new Date(rawDt).toISOString().replace('T', ' ').substring(0, 19) : 'N/A';
                    const tCount = l.trades_count ?? l.tradesCount ?? 0;
                    console.log(`   [${dt}] ID=${l.id} | ${l.method} | ${l.status} | Trades: ${tCount} | ${l.details || ''}`);
                }
            }
        }

        console.log(`\n========================================================================================\n`);
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error('❌ Erro ao executar auditoria:', err);
    process.exit(1);
});
