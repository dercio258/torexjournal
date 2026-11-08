#!/usr/bin/env node
/**
 * Script de Diagnóstico e Reconciliação de Operações MT5 (Torex Journal)
 * Uso: node backend-nest/scripts/inspect_raphael_trades.js [email_ou_mt5_login]
 * Padrão: raphaelmanguele.jr@gmail.com (e conta MT5 6371945)
 */

const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const targetArg = (process.argv[2] || 'raphaelmanguele.jr@gmail.com').trim().toLowerCase();

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
    console.log(`\n================================================================================`);
    console.log(`🔍 DIAGNÓSTICO DE OPERAÇÕES MT5 — ALVO: ${targetArg}`);
    console.log(`================================================================================\n`);

    try {
        const userRes = await client.query(
            `SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1`,
            [targetArg]
        );

        let user = userRes.rows[0] || null;
        if (user) {
            console.log(`👤 Usuário: ${user.name || user.username || 'Sem nome'} (${user.email})`);
            console.log(`   ID: ${user.id} | Role/Plano: ${user.role || user.planTier || user.plan_tier || 'N/A'}\n`);
        } else {
            console.log(`⚠️ Usuário "${targetArg}" não encontrado diretamente em 'users'. Buscando contas MT5 correspondentes...\n`);
        }

        const accCols = await getTableColumns(client, 'accounts');
        const userIdCol = accCols.has('user_id') ? 'user_id' : (accCols.has('userId') ? '"userId"' : 'user_id');
        const mt5IdCol = accCols.has('mt5_id') ? 'mt5_id' : (accCols.has('mt5Id') ? '"mt5Id"' : 'mt5_id');

        let accRes;
        if (user) {
            accRes = await client.query(
                `SELECT * FROM accounts WHERE ${userIdCol}::text = $1 OR ${mt5IdCol}::text = '6371945'`,
                [String(user.id)]
            );
        } else {
            accRes = await client.query(
                `SELECT * FROM accounts WHERE ${mt5IdCol}::text = $1 OR ${mt5IdCol}::text = '6371945'`,
                [targetArg]
            );
        }

        console.log(`🏦 Contas encontradas (${accRes.rows.length}):`);
        for (const acc of accRes.rows) {
            const mt5Login = acc.mt5_id || acc.mt5Id || 'N/A';
            const isConn = acc.is_connected ?? acc.isConnected ?? false;
            console.log(
                `   • Conta UUID: ${acc.id} | Nome: "${acc.name}" | MT5 Login: ${mt5Login} | ` +
                `Corretora/Servidor: ${acc.broker || 'N/A'} | Saldo: $${Number(acc.balance || 0).toFixed(2)} | ` +
                `Equity: $${Number(acc.equity || 0).toFixed(2)} | Conectada: ${isConn}`
            );
        }

        const posCols = await getTableColumns(client, 'positions');
        const posAccCol = posCols.has('account_id') ? 'account_id' : (posCols.has('accountId') ? '"accountId"' : 'account_id');

        const tradeCols = await getTableColumns(client, 'trades');
        const tradeAccCol = tradeCols.has('account_id') ? 'account_id' : (tradeCols.has('accountId') ? '"accountId"' : 'account_id');
        const contractCol = tradeCols.has('contractId') ? '"contractId"' : (tradeCols.has('contract_id') ? 'contract_id' : '"contractId"');

        const logCols = await getTableColumns(client, 'import_logs');
        const logAccCol = logCols.has('account_id') ? 'account_id' : (logCols.has('accountId') ? '"accountId"' : 'account_id');

        for (const acc of accRes.rows) {
            const mt5Login = acc.mt5_id || acc.mt5Id || 'Manual';
            const posRes = await client.query(
                `SELECT * FROM positions WHERE ${posAccCol}::text = $1`,
                [String(acc.id)]
            );

            const tradesRes = await client.query(
                `SELECT * FROM trades WHERE ${tradeAccCol}::text = $1`,
                [String(acc.id)]
            );

            // Ordena em memória por data (compatível com qualquer nome de coluna)
            posRes.rows.sort((a, b) => new Date(b.open_time || b.openTime || 0) - new Date(a.open_time || a.openTime || 0));
            tradesRes.rows.sort((a, b) => new Date(b.close_time || b.closeTime || b.open_time || b.openTime || 0) - new Date(a.close_time || a.closeTime || a.open_time || a.openTime || 0));

            if (posRes.rows.length === 0 && tradesRes.rows.length === 0 && mt5Login === 'Manual') {
                continue;
            }

            console.log(`\n--------------------------------------------------------------------------------`);
            console.log(`📊 DETALHAMENTO DA CONTA: ${acc.name} (MT5: ${mt5Login} | UUID: ${acc.id})`);
            console.log(`   Total no Torex agora: ${posRes.rows.length + tradesRes.rows.length} operações (${posRes.rows.length} abertas em 'positions' + ${tradesRes.rows.length} fechadas em 'trades')`);
            console.log(`--------------------------------------------------------------------------------`);

            console.log(`\n🟢 POSIÇÕES EM ABERTO NA TABELA 'positions' (${posRes.rows.length}):`);
            if (posRes.rows.length === 0) {
                console.log(`   (Nenhuma posição aberta registrada para esta conta)`);
            } else {
                posRes.rows.forEach((p, idx) => {
                    const openRaw = p.open_time || p.openTime;
                    const openDt = openRaw ? new Date(openRaw).toISOString().replace('T', ' ').substring(0, 19) : 'N/A';
                    const openPr = p.open_price ?? p.openPrice ?? 0;
                    console.log(
                        `   ${String(idx + 1).padStart(2, '0')}. Ticket MT5 (Position ID): ${String(p.ticket).padEnd(12)} | ` +
                        `${String(p.symbol).padEnd(10)} | ${String(p.type).padEnd(4)} | Vol: ${Number(p.volume || 0).toFixed(2)} | ` +
                        `Open: ${Number(openPr).toFixed(5)} | Profit: $${Number(p.profit || 0).toFixed(2)} | Data: ${openDt}`
                    );
                });
            }

            console.log(`\n🔵 TRADES FECHADOS NA TABELA 'trades' (${tradesRes.rows.length}):`);
            let mismatchedTickets = 0;
            if (tradesRes.rows.length === 0) {
                console.log(`   (Nenhum trade fechado registrado para esta conta)`);
            } else {
                tradesRes.rows.forEach((t, idx) => {
                    const closeRaw = t.close_time || t.closeTime || t.open_time || t.openTime;
                    const closeDt = closeRaw ? new Date(closeRaw).toISOString().replace('T', ' ').substring(0, 19) : 'N/A';
                    const cId = t.contractId || t.contract_id;
                    const isDiff = cId && t.ticket && String(t.ticket) !== String(cId);
                    if (isDiff) mismatchedTickets++;
                    const openPr = t.open_price ?? t.openPrice ?? 0;
                    const closePr = t.close_price ?? t.closePrice ?? 0;
                    console.log(
                        `   ${String(idx + 1).padStart(2, '0')}. Ticket Torex (Deal ID): ${String(t.ticket || 'N/A').padEnd(12)} | ` +
                        `Ticket MT5 (Position ID / contractId): ${String(cId || 'N/A').padEnd(12)} ${isDiff ? '⚠️ [DIFERENTE]' : '✅ [IGUAL]'} | ` +
                        `${String(t.symbol).padEnd(10)} | ${String(t.type).padEnd(4)} | Vol: ${Number(t.volume || 0).toFixed(2)} | ` +
                        `Open: ${Number(openPr).toFixed(5)} -> Close: ${Number(closePr).toFixed(5)} | ` +
                        `Profit: $${Number(t.profit || 0).toFixed(2)} | Fecho: ${closeDt}`
                    );
                });
            }

            if (mismatchedTickets > 0 && (tradeCols.has('contractId') || tradeCols.has('contract_id'))) {
                console.log(`\n🛠️  Alinhando ${mismatchedTickets} trade(s) onde 'ticket' tinha o Deal ID de saída em vez do Position ID do MT5 (${contractCol})...`);
                const fixRes = await client.query(
                    `UPDATE trades
                     SET ticket = ${contractCol}
                     WHERE ${tradeAccCol}::text = $1
                       AND ${contractCol} IS NOT NULL
                       AND ${contractCol} ~ '^[0-9]+$'
                       AND ticket IS DISTINCT FROM ${contractCol}`,
                    [String(acc.id)]
                );
                console.log(`   ✅ ${fixRes.rowCount} trade(s) atualizados para exibir o mesmo Ticket da aba Posições/Histórico do MT5!`);
            }

            // Verifica se alguma posição aberta em 'positions' já foi fechada e está em 'trades'
            const closedIds = new Set();
            for (const t of tradesRes.rows) {
                const cId = t.contractId || t.contract_id;
                if (t.ticket) closedIds.add(String(t.ticket).trim());
                if (cId) closedIds.add(String(cId).trim());
            }
            const stalePositions = posRes.rows.filter(p => closedIds.has(String(p.ticket).trim()));
            if (stalePositions.length > 0) {
                console.log(`\n🧹 Removendo ${stalePositions.length} posição(ões) em 'positions' que já constam como fechadas em 'trades':`);
                for (const sp of stalePositions) {
                    console.log(`   - Removendo posição aberta já encerrada Ticket #${sp.ticket} (${sp.symbol})`);
                    await client.query(`DELETE FROM positions WHERE id = $1`, [sp.id]);
                }
            }

            if (logCols.size > 0) {
                const logsRes = await client.query(
                    `SELECT * FROM import_logs WHERE ${logAccCol}::text = $1 LIMIT 10`,
                    [String(acc.id)]
                );
                logsRes.rows.sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0));
                console.log(`\n📜 ÚLTIMOS LOGS DE IMPORTAÇÃO (${logsRes.rows.length}):`);
                for (const l of logsRes.rows.slice(0, 8)) {
                    const rawDt = l.created_at || l.createdAt;
                    const dt = rawDt ? new Date(rawDt).toISOString().replace('T', ' ').substring(0, 19) : 'N/A';
                    const tCount = l.trades_count ?? l.tradesCount ?? 0;
                    console.log(`   [${dt}] ${l.method} | ${l.status} | Trades: ${tCount} | ${l.details || ''}`);
                }
            }
        }

        console.log(`\n================================================================================\n`);
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error('❌ Erro ao executar diagnóstico:', err);
    process.exit(1);
});
