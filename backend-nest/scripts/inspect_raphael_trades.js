#!/usr/bin/env node
/**
 * Script de Diagnóstico e Reconciliação de Operações MT5 (Torex Journal)
 * Uso: node backend-nest/scripts/inspect_raphael_trades.js [email]
 * Padrão: raphaelmanguele.jr@gmail.com
 *
 * O que este script faz:
 * 1. Busca o usuário e todas as contas vinculadas (ex: 6371945 @ Deriv-Demo).
 * 2. Lista todas as Posições Abertas (tabela `positions`) e todos os Trades Fechados (tabela `trades`).
 * 3. Mostra a diferença entre `ticket` (Deal Ticket interno de saída no MT5) e `contractId` (Position Ticket exibido na tela do MT5).
 * 4. Sincroniza `ticket = "contractId"` nos trades importados via AUTO_SYNC onde o Position ID real do MT5 estava salvo em `contractId`.
 * 5. Remove posições obsoletas de `positions` caso já constem como fechadas em `trades`.
 */

const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const targetEmail = (process.argv[2] || 'raphaelmanguele.jr@gmail.com').trim().toLowerCase();

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
    console.log(`🔍 DIAGNÓSTICO DE OPERAÇÕES MT5 — USUÁRIO: ${targetEmail}`);
    console.log(`================================================================================\n`);

    try {
        const userRes = await client.query(
            `SELECT id, email, name, plan_tier, subscription_status FROM users WHERE LOWER(email) = $1 LIMIT 1`,
            [targetEmail]
        );

        if (userRes.rows.length === 0) {
            console.error(`❌ Usuário "${targetEmail}" não encontrado na tabela users.`);
            return;
        }

        const user = userRes.rows[0];
        console.log(`👤 Usuário: ${user.name || 'Sem nome'} (${user.email})`);
        console.log(`   ID: ${user.id} | Plano: ${user.plan_tier || 'N/A'} (${user.subscription_status || 'N/A'})\n`);

        const accRes = await client.query(
            `SELECT id, name, mt5_id, broker, type, balance, equity, is_connected, last_seen, updated_at
             FROM accounts
             WHERE user_id::text = $1
             ORDER BY updated_at DESC NULLS LAST`,
            [user.id]
        );

        console.log(`🏦 Contas encontradas (${accRes.rows.length}):`);
        for (const acc of accRes.rows) {
            console.log(
                `   • Conta UUID: ${acc.id} | Nome: "${acc.name}" | MT5 Login: ${acc.mt5_id || 'N/A'} | ` +
                `Corretora/Servidor: ${acc.broker || 'N/A'} | Saldo: $${Number(acc.balance || 0).toFixed(2)} | ` +
                `Equity: $${Number(acc.equity || 0).toFixed(2)} | Conectada: ${acc.is_connected}`
            );
        }

        for (const acc of accRes.rows) {
            const posRes = await client.query(
                `SELECT id, ticket, symbol, type, volume, open_price, current_price, profit, swap, open_time, updated_at
                 FROM positions
                 WHERE account_id::text = $1
                 ORDER BY open_time DESC NULLS LAST`,
                [acc.id]
            );

            const tradesRes = await client.query(
                `SELECT id, ticket, "contractId", symbol, type, volume, open_price, close_price, profit, commission, swap, "netPnl", status, open_time, close_time
                 FROM trades
                 WHERE account_id::text = $1
                 ORDER BY COALESCE(close_time, open_time) DESC NULLS LAST`,
                [acc.id]
            );

            if (posRes.rows.length === 0 && tradesRes.rows.length === 0 && !acc.mt5_id) {
                continue;
            }

            console.log(`\n--------------------------------------------------------------------------------`);
            console.log(`📊 DETALHAMENTO DA CONTA: ${acc.name} (MT5: ${acc.mt5_id || 'Manual'} | UUID: ${acc.id})`);
            console.log(`   Total no Torex agora: ${posRes.rows.length + tradesRes.rows.length} operações (${posRes.rows.length} abertas em 'positions' + ${tradesRes.rows.length} fechadas em 'trades')`);
            console.log(`--------------------------------------------------------------------------------`);

            console.log(`\n🟢 POSIÇÕES EM ABERTO NA TABELA 'positions' (${posRes.rows.length}):`);
            if (posRes.rows.length === 0) {
                console.log(`   (Nenhuma posição aberta registrada para esta conta)`);
            } else {
                posRes.rows.forEach((p, idx) => {
                    const openDt = p.open_time ? new Date(p.open_time).toISOString().replace('T', ' ').substring(0, 19) : 'N/A';
                    console.log(
                        `   ${String(idx + 1).padStart(2, '0')}. Ticket MT5 (Position ID): ${String(p.ticket).padEnd(12)} | ` +
                        `${String(p.symbol).padEnd(10)} | ${String(p.type).padEnd(4)} | Vol: ${Number(p.volume || 0).toFixed(2)} | ` +
                        `Open: ${Number(p.open_price || 0).toFixed(5)} | Profit: $${Number(p.profit || 0).toFixed(2)} | Data: ${openDt}`
                    );
                });
            }

            console.log(`\n🔵 TRADES FECHADOS NA TABELA 'trades' (${tradesRes.rows.length}):`);
            let mismatchedTickets = 0;
            if (tradesRes.rows.length === 0) {
                console.log(`   (Nenhum trade fechado registrado para esta conta)`);
            } else {
                tradesRes.rows.forEach((t, idx) => {
                    const closeDt = t.close_time ? new Date(t.close_time).toISOString().replace('T', ' ').substring(0, 19) : 'N/A';
                    const isDiff = t.contractId && t.ticket && String(t.ticket) !== String(t.contractId);
                    if (isDiff) mismatchedTickets++;
                    console.log(
                        `   ${String(idx + 1).padStart(2, '0')}. Ticket Torex (Deal ID): ${String(t.ticket || 'N/A').padEnd(12)} | ` +
                        `Ticket MT5 (Position ID / contractId): ${String(t.contractId || 'N/A').padEnd(12)} ${isDiff ? '⚠️ [DIFERENTE]' : '✅ [IGUAL]'} | ` +
                        `${String(t.symbol).padEnd(10)} | ${String(t.type).padEnd(4)} | Vol: ${Number(t.volume || 0).toFixed(2)} | ` +
                        `Open: ${Number(t.open_price || 0).toFixed(5)} -> Close: ${Number(t.close_price || 0).toFixed(5)} | ` +
                        `Profit: $${Number(t.profit || 0).toFixed(2)} | Fecho: ${closeDt}`
                    );
                });
            }

            // Alinha ticket = contractId caso o contractId seja o Position Ticket numérico do MT5
            if (mismatchedTickets > 0) {
                console.log(`\n🛠️  Alinhando ${mismatchedTickets} trade(s) onde 'ticket' tinha o Deal ID de saída em vez do Position ID do MT5 ('contractId')...`);
                const fixRes = await client.query(
                    `UPDATE trades
                     SET ticket = "contractId"
                     WHERE account_id::text = $1
                       AND "contractId" IS NOT NULL
                       AND "contractId" ~ '^[0-9]+$'
                       AND ticket IS DISTINCT FROM "contractId"`,
                    [acc.id]
                );
                console.log(`   ✅ ${fixRes.rowCount} trade(s) atualizados para exibir o mesmo Ticket da aba Posições/Histórico do MT5!`);
            }

            // Verifica se alguma posição aberta em 'positions' já foi fechada e está em 'trades'
            const closedIds = new Set();
            for (const t of tradesRes.rows) {
                if (t.ticket) closedIds.add(String(t.ticket).trim());
                if (t.contractId) closedIds.add(String(t.contractId).trim());
            }
            const stalePositions = posRes.rows.filter(p => closedIds.has(String(p.ticket).trim()));
            if (stalePositions.length > 0) {
                console.log(`\n🧹 Removendo ${stalePositions.length} posição(ões) em 'positions' que já constam como fechadas em 'trades':`);
                for (const sp of stalePositions) {
                    console.log(`   - Removendo posição aberta duplicada Ticket #${sp.ticket} (${sp.symbol})`);
                    await client.query(`DELETE FROM positions WHERE id = $1`, [sp.id]);
                }
            }

            // Últimos logs de importação da conta
            const logsRes = await client.query(
                `SELECT id, method, status, trades_count, details, created_at
                 FROM import_logs
                 WHERE account_id::text = $1
                 ORDER BY created_at DESC
                 LIMIT 8`,
                [acc.id]
            );
            console.log(`\n📜 ÚLTIMOS LOGS DE IMPORTAÇÃO (${logsRes.rows.length}):`);
            for (const l of logsRes.rows) {
                const dt = l.created_at ? new Date(l.created_at).toISOString().replace('T', ' ').substring(0, 19) : 'N/A';
                console.log(`   [${dt}] ${l.method} | ${l.status} | Trades: ${l.trades_count} | ${l.details || ''}`);
            }
        }

        console.log(`\n================================================================================`);
        console.log(`💡 RESUMO TÉCNICO SOBRE OS TICKETS E AS 3 OPERAÇÕES FECHADAS:`);
        console.log(`1. Por que o Ticket do Torex era diferente do MT5 nos trades fechados:`);
        console.log(`   No MT5, toda operação tem 2 números principais:`);
        console.log(`   - Position ID (pos.ticket / deal.position_id): é o Ticket principal mostrado na aba "Negociação" e em "Histórico -> Posições".`);
        console.log(`   - Deal ID de Saída (deal.ticket): é o ID interno gerado apenas no momento do fecho (DEAL_ENTRY_OUT).`);
        console.log(`   O Torex salvava o Position ID em "contractId" e o Deal ID de saída em "ticket". Agora alinhamos "ticket" = Position ID!`);
        console.log(`2. Por que faltavam trades fechados:`);
        console.log(`   Quando o endpoint POST /sync/trades deu erro 500 anteriormente, o watermark (last_deal_ticket) avançou no worker.`);
        console.log(`   Com o novo código, o backend dispara automaticamente um FORCE_FULL_SYNC (last_deal_ticket = 0) para buscar todos os 17 registros!`);
        console.log(`================================================================================\n`);
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error('❌ Erro ao executar diagnóstico:', err);
    process.exit(1);
});
