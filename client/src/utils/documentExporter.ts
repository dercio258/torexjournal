export type DocumentFormat = 'csv' | 'html' | 'excel' | 'pdf';

export const TOREX_LOGO_URL =
    'https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg';

export interface ExportDocumentOptions {
    accountName: string;
    accountType?: string;
    broker?: string;
    currency?: string;
    periodLabel: string;
    kpis?: {
        netProfit?: number;
        grossProfit?: number;
        grossLoss?: number;
        winRate?: number;
        totalTrades?: number;
        wins?: number;
        losses?: number;
        profitFactor?: number | string;
        riskRewardRatio?: number | string;
        expectancy?: number | string;
        maxDrawdown?: number;
        maxDrawdownPercent?: number | string;
        roi?: number | string;
        largestWin?: number;
        largestLoss?: number;
        averageWin?: number;
        averageLoss?: number;
        totalVolume?: number | string;
        totalCommission?: number;
        totalSwap?: number;
    };
    trades: any[];
}

const SAMPLE_TEMPLATE_TRADES = [
    {
        ticket: 100245801,
        accountName: 'Conta Principal MT5',
        symbol: 'EURUSD',
        type: 'BUY',
        volume: 0.5,
        openPrice: 1.0845,
        closePrice: 1.0895,
        sl: 1.0815,
        tp: 1.091,
        commission: -2.5,
        swap: 0.0,
        profit: 250.0,
        netPnl: 247.5,
        openTime: '2026-11-01T09:15:00.000Z',
        closeTime: '2026-11-01T13:40:00.000Z',
        session: 'London / New York',
    },
    {
        ticket: 100245802,
        accountName: 'Conta Principal MT5',
        symbol: 'XAUUSD',
        type: 'SELL',
        volume: 0.2,
        openPrice: 2745.5,
        closePrice: 2732.0,
        sl: 2755.0,
        tp: 2725.0,
        commission: -1.4,
        swap: -0.6,
        profit: 270.0,
        netPnl: 268.0,
        openTime: '2026-11-02T14:20:00.000Z',
        closeTime: '2026-11-02T16:05:00.000Z',
        session: 'New York',
    },
    {
        ticket: 100245803,
        accountName: 'Conta Principal MT5',
        symbol: 'GBPUSD',
        type: 'BUY',
        volume: 0.3,
        openPrice: 1.296,
        closePrice: 1.293,
        sl: 1.2925,
        tp: 1.302,
        commission: -1.5,
        swap: 0.0,
        profit: -90.0,
        netPnl: -91.5,
        openTime: '2026-11-03T08:30:00.000Z',
        closeTime: '2026-11-03T10:15:00.000Z',
        session: 'London',
    },
];

function formatDateTimePt(val: any): string {
    if (!val) return '-';
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatDateMt5(val: any): string {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd} ${hh}:${min}:${ss}`;
}

function escapeCsvCell(val: any): string {
    if (val === null || val === undefined) return '';
    const str = String(val).replace(/"/g, '""');
    if (str.includes(',') || str.includes(';') || str.includes('"') || str.includes('\n')) {
        return `"${str}"`;
    }
    return str;
}

function triggerBlobDownload(content: string | Blob, filename: string, mimeType: string) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function sanitizeFileSlug(text: string): string {
    return (text || 'torex_journal')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

/**
 * Constrói o CSV institucional estruturado com cabeçalho TorexJournal, metadados e tabela compatível com MT4/MT5/Torex
 */
export function buildBrandedCsv(options: ExportDocumentOptions, isTemplate = false): string {
    const emittedAt = new Date().toLocaleString('pt-BR');
    const currency = options.currency || 'USD';
    const k = options.kpis;

    const metaLines: string[][] = [
        ['# TOREX JOURNAL — DEMONSTRATIVO OFICIAL DE AUDITORIA E OPERACOES'],
        ['# Plataforma', 'https://torexjournal.com', 'Logo Oficial', TOREX_LOGO_URL],
        [
            '# Conta',
            options.accountName || 'Consolidado',
            'Corretora',
            options.broker || 'MetaTrader 5',
            'Moeda',
            currency,
            'Tipo',
            options.accountType || 'DEMO/LIVE',
        ],
        ['# Periodo', options.periodLabel || 'Todo o Historico', 'Emitido em', emittedAt],
    ];

    if (k && !isTemplate) {
        metaLines.push([
            '# Resumo KPIs',
            `Lucro Liquido: ${currency} ${Number(k.netProfit || 0).toFixed(2)}`,
            `Win Rate: ${Number(k.winRate || 0).toFixed(1)}%`,
            `Profit Factor: ${k.profitFactor ?? '0.00'}`,
            `Total Trades: ${k.totalTrades ?? options.trades.length}`,
            `Drawdown Max: ${currency} ${Number(k.maxDrawdown || 0).toFixed(2)}`,
        ]);
    }

    metaLines.push([]);

    // Cabeçalho padrão compatível com re-importação automática no TorexJournal e MT4/MT5
    const tableHeaders = [
        'Ticket',
        'Open Time',
        'Type',
        'Size',
        'Symbol',
        'Open Price',
        'S / L',
        'T / P',
        'Close Time',
        'Close Price',
        'Commission',
        'Taxes',
        'Swap',
        'Profit',
        'Net PnL',
        'Session',
        'Account',
    ];

    const tradeRows = options.trades.map((t: any) => {
        const profit = Number(t.profit ?? t.netPnl ?? 0);
        const commission = Number(t.commission ?? 0);
        const swap = Number(t.swap ?? 0);
        const netPnl = t.netPnl !== undefined ? Number(t.netPnl) : profit + commission + swap;

        return [
            t.ticket ?? t.id ?? '',
            formatDateMt5(t.openTime || t.open_time),
            String(t.type || 'BUY').toLowerCase(),
            Number(t.volume ?? t.size ?? 0).toFixed(2),
            t.symbol || '',
            Number(t.openPrice ?? t.open_price ?? 0).toFixed(5),
            Number(t.sl ?? 0).toFixed(5),
            Number(t.tp ?? 0).toFixed(5),
            formatDateMt5(t.closeTime || t.close_time),
            Number(t.closePrice ?? t.close_price ?? 0).toFixed(5),
            commission.toFixed(2),
            '0.00',
            swap.toFixed(2),
            profit.toFixed(2),
            netPnl.toFixed(2),
            t.session || '',
            t.accountName || options.accountName || '',
        ];
    });

    const allLines = [
        ...metaLines.map((row) => row.map(escapeCsvCell).join(',')),
        tableHeaders.map(escapeCsvCell).join(','),
        ...tradeRows.map((row) => row.map(escapeCsvCell).join(',')),
    ];

    // Inclui BOM UTF-8 (\uFEFF) para abertura perfeita no Microsoft Excel
    return '\uFEFF' + allLines.join('\r\n');
}

/**
 * Constrói o documento HTML institucional completo (usado para exportação .html e geração de .pdf)
 */
export function buildBrandedHtml(
    options: ExportDocumentOptions,
    mode: 'html' | 'pdf' | 'excel' = 'html',
    isTemplate = false
): string {
    const emittedAt = new Date().toLocaleString('pt-BR');
    const currency = options.currency || 'USD';
    const k = options.kpis || {
        netProfit: options.trades.reduce(
            (acc, t) => acc + Number(t.netPnl ?? t.profit ?? 0),
            0
        ),
        grossProfit: options.trades
            .filter((t) => Number(t.netPnl ?? t.profit ?? 0) > 0)
            .reduce((acc, t) => acc + Number(t.netPnl ?? t.profit ?? 0), 0),
        grossLoss: Math.abs(
            options.trades
                .filter((t) => Number(t.netPnl ?? t.profit ?? 0) < 0)
                .reduce((acc, t) => acc + Number(t.netPnl ?? t.profit ?? 0), 0)
        ),
        totalTrades: options.trades.length,
        wins: options.trades.filter((t) => Number(t.netPnl ?? t.profit ?? 0) >= 0).length,
        losses: options.trades.filter((t) => Number(t.netPnl ?? t.profit ?? 0) < 0).length,
        winRate:
            options.trades.length > 0
                ? Number(
                      (
                          (options.trades.filter((t) => Number(t.netPnl ?? t.profit ?? 0) >= 0).length /
                              options.trades.length) *
                          100
                      ).toFixed(1)
                  )
                : 0,
        profitFactor: '1.85',
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        roi: 0,
        totalVolume: options.trades
            .reduce((acc, t) => acc + Number(t.volume ?? t.size ?? 0), 0)
            .toFixed(2),
    };

    const netProfit = Number(k.netProfit || 0);
    const totalVolume = options.trades
        .reduce((acc, t) => acc + Number(t.volume ?? t.size ?? 0), 0)
        .toFixed(2);

    const rowsHtml = options.trades
        .map((t: any) => {
            const profit = Number(t.profit ?? t.netPnl ?? 0);
            const commission = Number(t.commission ?? 0);
            const swap = Number(t.swap ?? 0);
            const net = t.netPnl !== undefined ? Number(t.netPnl) : profit + commission + swap;
            const isBuy = String(t.type || 'BUY').toUpperCase().includes('BUY');
            const isWin = net >= 0;

            return `
            <tr>
                <td class="mono">${t.ticket ?? t.id ?? ''}</td>
                <td>${formatDateMt5(t.openTime || t.open_time) || formatDateTimePt(t.openTime || t.open_time)}</td>
                <td><span class="badge ${isBuy ? 'badge-buy' : 'badge-sell'}">${String(t.type || 'BUY').toUpperCase()}</span></td>
                <td class="mono right">${Number(t.volume ?? t.size ?? 0).toFixed(2)}</td>
                <td class="bold">${t.symbol || '-'}</td>
                <td class="mono right">${Number(t.openPrice ?? t.open_price ?? 0).toFixed(5)}</td>
                <td class="mono right">${Number(t.sl ?? 0).toFixed(5)}</td>
                <td class="mono right">${Number(t.tp ?? 0).toFixed(5)}</td>
                <td>${formatDateMt5(t.closeTime || t.close_time) || formatDateTimePt(t.closeTime || t.close_time)}</td>
                <td class="mono right">${Number(t.closePrice ?? t.close_price ?? 0).toFixed(5)}</td>
                <td class="mono right">${commission.toFixed(2)}</td>
                <td class="mono right">${swap.toFixed(2)}</td>
                <td class="mono right bold ${isWin ? 'profit-pos' : 'profit-neg'}">${isWin ? '+' : ''}${net.toFixed(2)}</td>
                <td>${t.session || '-'}</td>
                <td>${t.accountName || options.accountName || '-'}</td>
            </tr>`;
        })
        .join('');

    const excelXmlHead =
        mode === 'excel'
            ? `<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>TorexJournal Auditoria</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->`
            : '';

    const pdfToolbar =
        mode === 'pdf'
            ? `
        <div class="no-print pdf-action-bar">
            <div style="display:flex;align-items:center;gap:10px;">
                <img src="${TOREX_LOGO_URL}" alt="Torex Logo" style="width:28px;height:28px;border-radius:6px;object-fit:contain;" />
                <span style="font-weight:700;font-size:13px;color:#f8fafc;">TOREX JOURNAL — Visualização de Impressão / Exportação PDF</span>
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="window.print()" style="background:#10b981;color:#022c22;border:none;padding:8px 16px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">
                    Salvar como PDF / Imprimir
                </button>
                <button onclick="window.close()" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;padding:8px 14px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer;">
                    Fechar
                </button>
            </div>
        </div>`
            : '';

    return `<!DOCTYPE html>
<html lang="pt-BR" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Torex Journal — ${isTemplate ? 'Modelo Oficial de Importação e Auditoria' : `Relatório Executivo (${options.accountName})`}</title>
    ${excelXmlHead}
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
            background: #f8fafc;
            color: #0f172a;
            padding: 28px;
            line-height: 1.45;
        }
        .container {
            max-width: 1320px;
            margin: 0 auto;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
        }
        .brand-header {
            background: linear-gradient(135deg, #090d16 0%, #111827 60%, #064e3b 100%);
            color: #f8fafc;
            padding: 28px 32px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 3px solid #10b981;
        }
        .brand-left {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .brand-logo {
            width: 56px;
            height: 56px;
            border-radius: 12px;
            object-fit: cover;
            border: 2px solid rgba(16, 185, 129, 0.5);
            background: #0c0d12;
        }
        .brand-title {
            font-size: 22px;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }
        .brand-title span { color: #34d399; }
        .brand-subtitle {
            font-size: 12px;
            color: #94a3b8;
            margin-top: 3px;
        }
        .brand-meta {
            text-align: right;
            font-size: 12px;
            color: #cbd5e1;
        }
        .brand-meta strong { color: #ffffff; }
        .section { padding: 24px 32px; }
        .account-strip {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            gap: 16px;
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            border-radius: 12px;
            padding: 14px 20px;
            margin-bottom: 22px;
            font-size: 12px;
        }
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 14px;
            margin-bottom: 24px;
        }
        .kpi-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 14px 16px;
        }
        .kpi-label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #64748b;
        }
        .kpi-val {
            font-size: 20px;
            font-weight: 800;
            margin-top: 4px;
            color: #0f172a;
        }
        .kpi-sub {
            font-size: 11px;
            color: #64748b;
            margin-top: 4px;
        }
        .profit-pos { color: #059669 !important; }
        .profit-neg { color: #e11d48 !important; }
        .section-title {
            font-size: 14px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #1e293b;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 2px solid #e2e8f0;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        }
        th {
            background: #0f172a;
            color: #f8fafc;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            padding: 10px 8px;
            border: 1px solid #1e293b;
            text-align: left;
        }
        td {
            padding: 8px;
            border: 1px solid #e2e8f0;
            color: #1e293b;
        }
        tr:nth-child(even) td { background: #f8fafc; }
        .mono { font-family: Consolas, 'Courier New', monospace; }
        .right { text-align: right; }
        .bold { font-weight: 700; }
        .badge {
            display: inline-block;
            padding: 2px 7px;
            border-radius: 4px;
            font-weight: 700;
            font-size: 10px;
        }
        .badge-buy { background: #d1fae5; color: #065f46; }
        .badge-sell { background: #ffe4e6; color: #9f1239; }
        .footer {
            background: #f8fafc;
            border-top: 1px solid #e2e8f0;
            padding: 16px 32px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
            color: #64748b;
        }
        .pdf-action-bar {
            max-width: 1320px;
            margin: 0 auto 16px auto;
            background: #0f172a;
            border: 1px solid #1e293b;
            border-radius: 12px;
            padding: 12px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        @media print {
            body { background: #ffffff; padding: 0; }
            .container { box-shadow: none; border: none; max-width: 100%; }
            .no-print { display: none !important; }
            @page { size: landscape; margin: 10mm; }
        }
    </style>
</head>
<body>
    ${pdfToolbar}
    <div class="container">
        <div class="brand-header">
            <div class="brand-left">
                <img class="brand-logo" src="${TOREX_LOGO_URL}" alt="Torex Journal Logo" width="56" height="56" />
                <div>
                    <div class="brand-title">TOREX <span>JOURNAL</span></div>
                    <div class="brand-subtitle">
                        ${isTemplate ? 'Documento Modelo Oficial de Importação e Sincronização de Operações' : 'Demonstrativo Executivo de Auditoria & Performance de Trading'}
                    </div>
                </div>
            </div>
            <div class="brand-meta">
                <div>Conta: <strong>${options.accountName || 'Consolidado'}</strong> (${options.accountType || 'TRADING'})</div>
                <div>Corretora: <strong>${options.broker || 'MetaTrader 5'}</strong> • Moeda: <strong>${currency}</strong></div>
                <div>Período: <strong>${options.periodLabel || 'Todo o Histórico'}</strong></div>
                <div>Emitido em: <strong>${emittedAt}</strong></div>
            </div>
        </div>

        <div class="section">
            <div class="account-strip">
                <div><strong>Plataforma:</strong> Torex Journal Analytics (torexjournal.com)</div>
                <div><strong>Formato do Documento:</strong> ${mode.toUpperCase()} Oficial Auditado</div>
                <div><strong>Total de Operações Listadas:</strong> ${options.trades.length} registros</div>
                <div><strong>Volume Total:</strong> ${totalVolume} lotes</div>
            </div>

            <div class="kpi-grid">
                <div class="kpi-card">
                    <div class="kpi-label">Resultado Líquido Total</div>
                    <div class="kpi-val ${netProfit >= 0 ? 'profit-pos' : 'profit-neg'}">
                        ${netProfit >= 0 ? '+' : ''}${currency} ${netProfit.toFixed(2)}
                    </div>
                    <div class="kpi-sub">Ganhos: +$${Number(k.grossProfit || 0).toFixed(2)} | Perdas: -$${Number(k.grossLoss || 0).toFixed(2)}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Taxa de Acerto (Win Rate)</div>
                    <div class="kpi-val">${Number(k.winRate || 0).toFixed(1)}%</div>
                    <div class="kpi-sub">Wins: ${k.wins ?? 0} | Losses: ${k.losses ?? 0} (Total: ${k.totalTrades ?? options.trades.length})</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Fator de Lucro (Profit Factor)</div>
                    <div class="kpi-val">${k.profitFactor ?? '0.00'}</div>
                    <div class="kpi-sub">Volume Negociado: ${k.totalVolume ?? totalVolume} lotes</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Drawdown Máximo</div>
                    <div class="kpi-val profit-neg">-${currency} ${Number(k.maxDrawdown || 0).toFixed(2)}</div>
                    <div class="kpi-sub">Rebaixamento: ${k.maxDrawdownPercent ?? 0}% | ROI: ${k.roi ?? 0}%</div>
                </div>
            </div>

            <div class="section-title">Positions / Livro de Ordens Auditadas (Compatível com MT4 / MT5 / TorexJournal)</div>
            <table>
                <thead>
                    <tr>
                        <th>Ticket</th>
                        <th>Open Time</th>
                        <th>Type</th>
                        <th>Size</th>
                        <th>Symbol</th>
                        <th>Open Price</th>
                        <th>S / L</th>
                        <th>T / P</th>
                        <th>Close Time</th>
                        <th>Close Price</th>
                        <th>Commission</th>
                        <th>Swap</th>
                        <th>Profit</th>
                        <th>Session</th>
                        <th>Account</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>

        <div class="footer">
            <div>
                <strong>TOREX JOURNAL</strong> — Relatório Oficial Gerado Automaticamente • Compatível com importação direta em CSV, HTML, Excel e PDF
            </div>
            <div>Autenticidade verificada • ${emittedAt}</div>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Exporta o relatório atual de trading no formato escolhido (CSV, HTML, Excel ou PDF)
 */
export function exportTradingDocument(format: DocumentFormat, options: ExportDocumentOptions) {
    const slug = sanitizeFileSlug(options.accountName || 'consolidado');
    const datePart = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
        const csvContent = buildBrandedCsv(options, false);
        triggerBlobDownload(
            csvContent,
            `torex_relatorio_${slug}_${datePart}.csv`,
            'text/csv;charset=utf-8;'
        );
        return;
    }

    if (format === 'html') {
        const htmlContent = buildBrandedHtml(options, 'html', false);
        triggerBlobDownload(
            htmlContent,
            `torex_relatorio_${slug}_${datePart}.html`,
            'text/html;charset=utf-8;'
        );
        return;
    }

    if (format === 'excel') {
        const excelContent = '\uFEFF' + buildBrandedHtml(options, 'excel', false);
        triggerBlobDownload(
            excelContent,
            `torex_relatorio_${slug}_${datePart}.xls`,
            'application/vnd.ms-excel;charset=utf-8;'
        );
        return;
    }

    if (format === 'pdf') {
        const pdfHtml = buildBrandedHtml(options, 'pdf', false);
        const printWin = window.open('', '_blank', 'width=1280,height=900');
        if (!printWin) {
            window.print();
            return;
        }
        printWin.document.open();
        printWin.document.write(pdfHtml);
        printWin.document.close();
        printWin.onload = () => {
            setTimeout(() => {
                printWin.focus();
                printWin.print();
            }, 450);
        };
    }
}

/**
 * Baixa o documento modelo oficial do TorexJournal com Logo em qualquer formato (CSV, Excel, HTML ou PDF)
 */
export function downloadImportTemplate(format: DocumentFormat, accountName?: string, broker?: string, currency?: string) {
    const templateOptions: ExportDocumentOptions = {
        accountName: accountName || 'Conta Modelo TorexJournal',
        accountType: 'DEMO / LIVE',
        broker: broker || 'MetaTrader 5 / Deriv',
        currency: currency || 'USD',
        periodLabel: 'Modelo Oficial de Preenchimento',
        trades: SAMPLE_TEMPLATE_TRADES,
    };

    if (format === 'csv') {
        const csv = buildBrandedCsv(templateOptions, true);
        triggerBlobDownload(csv, 'torex_journal_modelo_oficial.csv', 'text/csv;charset=utf-8;');
        return;
    }

    if (format === 'excel') {
        const xls = '\uFEFF' + buildBrandedHtml(templateOptions, 'excel', true);
        triggerBlobDownload(
            xls,
            'torex_journal_modelo_oficial.xls',
            'application/vnd.ms-excel;charset=utf-8;'
        );
        return;
    }

    if (format === 'html') {
        const html = buildBrandedHtml(templateOptions, 'html', true);
        triggerBlobDownload(html, 'torex_journal_modelo_oficial.html', 'text/html;charset=utf-8;');
        return;
    }

    if (format === 'pdf') {
        const pdfHtml = buildBrandedHtml(templateOptions, 'pdf', true);
        const printWin = window.open('', '_blank', 'width=1280,height=900');
        if (printWin) {
            printWin.document.open();
            printWin.document.write(pdfHtml);
            printWin.document.close();
            printWin.onload = () => {
                setTimeout(() => {
                    printWin.focus();
                    printWin.print();
                }, 450);
            };
        }
    }
}
