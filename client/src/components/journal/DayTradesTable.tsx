import React from 'react';
import { Download, ExternalLink, FileText, Image as ImageIcon, Plus } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { BehaviorMlBadge } from '../trades/BehaviorMlBadge';
import {
    DailyNotePayload,
    formatCurrencyPlain,
    formatJournalBlockDate,
    formatSignedCurrency,
    formatTimeShort,
    JournalTradeRow,
    stripHtmlPreview,
} from './types';
import { DocumentFormat } from '../../utils/documentExporter';

interface DayTradesTableProps {
    dateLabel?: string;
    trades: JournalTradeRow[];
    dailyNote?: DailyNotePayload | null;
    selectedTradeId?: string | null;
    onSelectTradeForNote: (trade: JournalTradeRow) => void;
    onOpenTradeDetails: (tradeId: string) => void;
    onExportTrades?: (format: DocumentFormat, scope: 'day' | 'all') => void;
}

export const DayTradesTable: React.FC<DayTradesTableProps> = ({
    dateLabel,
    trades,
    dailyNote,
    selectedTradeId,
    onSelectTradeForNote,
    onOpenTradeDetails,
    onExportTrades,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const totalGross = trades.reduce((sum, t) => sum + (Number(t.grossPnl) || 0), 0);
    const totalNet = trades.reduce((sum, t) => sum + (Number(t.netPnl) || 0), 0);
    const totalComm = trades.reduce(
        (sum, t) => sum + Math.abs(Number(t.commission) || 0),
        0
    );

    const hasDailyContext = Boolean(
        dailyNote &&
            (stripHtmlPreview(dailyNote.content).trim() ||
                dailyNote.marketBias ||
                dailyNote.mood ||
                (dailyNote.images && dailyNote.images.length > 0))
    );

    const formatPrice = (val: number) => {
        if (!Number.isFinite(val) || val === 0) return '—';
        if (val >= 100) return val.toFixed(2);
        return val.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
    };

    return (
        <div className="bg-surface border border-line rounded-xl overflow-hidden">
            {/* Barra de Cabeçalho da Tabela + Exportação com Espalhamento Diário */}
            <div className="bg-canvas-subtle border-b border-line-subtle px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-fg">
                        {isEn ? 'Session Executions' : 'Operações do Dia'}
                        {dateLabel ? ` · ${formatJournalBlockDate(dateLabel)}` : ''}
                    </span>
                    {hasDailyContext && (
                        <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-accent/10 text-accent-fg border border-accent/25"
                            title={
                                isEn
                                    ? 'Executions without their own note automatically inherit this session log, mindset, and macro bias in details and exports.'
                                    : 'Operações sem anotação própria herdam automaticamente o diário, sentimento e viés macro deste dia nos detalhes e exportações.'
                            }
                        >
                            <FileText className="w-3 h-3" />
                            {isEn ? 'Daily log applied to untagged executions' : 'Diário do dia aplicado às operações sem nota'}
                        </span>
                    )}
                </div>

                {onExportTrades && (
                    <div className="flex flex-wrap items-center gap-1 text-[10px]">
                        <span className="text-fg-subtle font-medium mr-1 inline-flex items-center gap-1">
                            <Download className="w-3 h-3" />
                            {isEn ? 'Export (w/ Daily Log):' : 'Exportar (c/ Diário):'}
                        </span>
                        {(
                            [
                                { fmt: 'csv', label: 'CSV' },
                                { fmt: 'excel', label: 'Excel' },
                                { fmt: 'html', label: 'HTML' },
                                { fmt: 'pdf', label: 'PDF' },
                            ] as { fmt: DocumentFormat; label: string }[]
                        ).map(({ fmt, label }) => (
                            <button
                                key={fmt}
                                type="button"
                                onClick={() =>
                                    onExportTrades(fmt, trades.length > 0 ? 'day' : 'all')
                                }
                                className="px-2 py-1 rounded-md font-semibold bg-surface hover:bg-surface-2 text-fg-muted hover:text-fg border border-line-subtle transition-colors cursor-pointer"
                                title={
                                    isEn
                                        ? `Export ${trades.length > 0 ? 'session executions' : 'filtered history'} as ${label} applying daily logs to untagged trades`
                                        : `Exportar ${trades.length > 0 ? 'operações do dia' : 'histórico filtrado'} em ${label} espalhando anotações diárias nas operações sem nota`
                                }
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-canvas-subtle border-b border-line-subtle text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                            <th className="py-2.5 px-3 whitespace-nowrap">STATUS</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">OPEN TIME</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">SYMBOL</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">SIDE</th>
                            <th className="py-2.5 px-3 whitespace-nowrap text-right">AVG BUY</th>
                            <th className="py-2.5 px-3 whitespace-nowrap text-right">AVG SELL</th>
                            <th className="py-2.5 px-3 whitespace-nowrap text-right">SIZE</th>
                            <th className="py-2.5 px-3 whitespace-nowrap text-right">MFE / MAE</th>
                            <th className="py-2.5 px-3 whitespace-nowrap text-right">PNL GROSS $</th>
                            <th className="py-2.5 px-3 whitespace-nowrap text-right">PNL GROSS %</th>
                            <th className="py-2.5 px-3 whitespace-nowrap text-right">COMMISSION</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">CLOSE TIME</th>
                            <th className="py-2.5 px-3 text-right whitespace-nowrap">
                                <span className="inline-flex items-center justify-end" title={isEn ? 'Annotate / Inspect' : 'Anotar / Inspecionar'}>
                                    <Plus className="w-3.5 h-3.5" />
                                </span>
                            </th>
                        </tr>
                    </thead>

                    <tbody className="divide-y divide-line-subtle text-xs">
                        {trades.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={13}
                                    className="py-9 px-4 text-center text-xs text-fg-subtle"
                                >
                                    No trades found
                                    {dateLabel
                                        ? ` (${formatJournalBlockDate(dateLabel)})`
                                        : ''}
                                </td>
                            </tr>
                        ) : (
                            trades.map((trade) => {
                                const isSelected = selectedTradeId === trade.id;
                                const isWin = trade.netPnl > 0.004;
                                const isLoss = trade.netPnl < -0.004;
                                const hasNote = Boolean(
                                    trade.tradeNote?.content?.replace(/<[^>]+>/g, '').trim()
                                );
                                const shotCount =
                                    trade.tradeNote?.screenshots &&
                                    trade.tradeNote.screenshots.length > 0
                                        ? trade.tradeNote.screenshots.length
                                        : trade.tradeNote?.screenshotUrl
                                        ? 1
                                        : 0;
                                const hasShot = shotCount > 0;

                                return (
                                    <tr
                                        key={trade.id}
                                        onClick={() => onSelectTradeForNote(trade)}
                                        className={`transition-colors cursor-pointer ${
                                            isSelected
                                                ? 'bg-data-1/10'
                                                : 'hover:bg-surface-2'
                                        }`}
                                    >
                                        <td className="py-2.5 px-3 whitespace-nowrap">
                                            {trade.status === 'OPEN' ? (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-data-1/15 text-data-1">
                                                    OPEN
                                                </span>
                                            ) : isWin ? (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-accent/15 text-accent">
                                                    WIN
                                                </span>
                                            ) : isLoss ? (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-danger/15 text-danger">
                                                    LOSS
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-surface-2 text-fg-muted">
                                                    BE
                                                </span>
                                            )}
                                        </td>

                                        <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-fg-muted tabular-nums">
                                            {formatTimeShort(trade.openTime)}
                                        </td>

                                        <td className="py-2.5 px-3 whitespace-nowrap">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="font-semibold text-fg">
                                                    {trade.symbol}
                                                </span>
                                                <BehaviorMlBadge
                                                    ml={trade.behavioralMl}
                                                    feedback={trade.behavioralFeedback}
                                                    isEn={isEn}
                                                    compact
                                                    hideWhenClean
                                                />
                                                {hasNote && (
                                                    <span title={isEn ? 'Has Trade Note' : 'Possui Trade Note'} className="inline-flex">
                                                        <FileText className="w-3 h-3 text-data-1" />
                                                    </span>
                                                )}
                                                {hasShot && (
                                                    <span
                                                        title={isEn ? `${shotCount} attached image(s)` : `${shotCount} imagem(ns) anexada(s)`}
                                                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent-fg border border-accent/30"
                                                    >
                                                        <ImageIcon className="w-3 h-3" />
                                                        <span>{shotCount}</span>
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        <td className="py-2.5 px-3 whitespace-nowrap">
                                            <span
                                                className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                                    trade.side === 'BUY'
                                                        ? 'bg-accent/15 text-accent'
                                                        : 'bg-danger/15 text-danger'
                                                }`}
                                            >
                                                {trade.side}
                                            </span>
                                        </td>

                                        <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-fg-muted">
                                            {formatPrice(trade.avgBuy)}
                                        </td>

                                        <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-fg-muted">
                                            {formatPrice(trade.avgSell)}
                                        </td>

                                        <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-fg">
                                            {trade.volume.toFixed(2)}
                                        </td>

                                        <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono text-[11px] tabular-nums">
                                            {trade.mfe !== null || trade.mae !== null ? (
                                                <span>
                                                    <span className="text-accent">
                                                        {trade.mfe !== null
                                                            ? `+$${trade.mfe.toFixed(0)}`
                                                            : '—'}
                                                    </span>
                                                    <span className="text-fg-subtle mx-1">/</span>
                                                    <span className="text-danger">
                                                        {trade.mae !== null
                                                            ? `-$${trade.mae.toFixed(0)}`
                                                            : '—'}
                                                    </span>
                                                </span>
                                            ) : (
                                                <span className="text-fg-subtle">—</span>
                                            )}
                                        </td>

                                        <td
                                            className={`py-2.5 px-3 whitespace-nowrap text-right font-mono font-semibold tabular-nums ${
                                                trade.grossPnl > 0.004
                                                    ? 'text-accent'
                                                    : trade.grossPnl < -0.004
                                                    ? 'text-danger'
                                                    : 'text-fg-muted'
                                            }`}
                                        >
                                            {formatSignedCurrency(trade.grossPnl)}
                                        </td>

                                        <td
                                            className={`py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums ${
                                                (trade.pnlPct ?? 0) > 0
                                                    ? 'text-accent'
                                                    : (trade.pnlPct ?? 0) < 0
                                                    ? 'text-danger'
                                                    : 'text-fg-subtle'
                                            }`}
                                        >
                                            {trade.pnlPct !== null && trade.pnlPct !== undefined
                                                ? `${trade.pnlPct > 0 ? '+' : ''}${trade.pnlPct.toFixed(2)}%`
                                                : '—'}
                                        </td>

                                        <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-fg-muted">
                                            {trade.commission > 0
                                                ? formatCurrencyPlain(trade.commission)
                                                : '$0.00'}
                                        </td>

                                        <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-fg-muted tabular-nums">
                                            {formatTimeShort(trade.closeTime)}
                                        </td>

                                        <td
                                            className="py-2.5 px-3 whitespace-nowrap text-right"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="inline-flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => onSelectTradeForNote(trade)}
                                                    className="px-2 py-1 rounded text-[10px] font-medium bg-canvas-subtle hover:bg-surface-3 text-fg-muted hover:text-fg border border-line-subtle transition-colors cursor-pointer"
                                                    title={isEn ? 'Edit Trade Note / MFE & MAE' : 'Editar Trade Note / MFE & MAE'}
                                                >
                                                    {isEn ? 'Note' : 'Nota'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenTradeDetails(trade.id)}
                                                    className="p-1 rounded text-fg-subtle hover:text-fg hover:bg-surface-3 transition-colors cursor-pointer"
                                                    title={isEn ? 'Open execution detail' : 'Abrir tela da operação'}
                                                >
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Rodapé Resumo da Tabela */}
            <div className="bg-canvas-subtle border-t border-line-subtle px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-[11px]">
                <span className="font-semibold uppercase tracking-wider text-fg-muted font-mono tabular-nums">
                    TOTAL TRADES: {trades.length}
                </span>

                {trades.length > 0 && (
                    <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
                        <span className="text-fg-muted">
                            COMM:{' '}
                            <strong className="text-fg">
                                {formatCurrencyPlain(totalComm)}
                            </strong>
                        </span>
                        <span className="text-fg-muted">
                            GROSS:{' '}
                            <strong
                                className={
                                    totalGross >= 0 ? 'text-accent' : 'text-danger'
                                }
                            >
                                {formatSignedCurrency(totalGross)}
                            </strong>
                        </span>
                        <span className="text-fg-muted">
                            NET:{' '}
                            <strong
                                className={
                                    totalNet >= 0 ? 'text-accent' : 'text-danger'
                                }
                            >
                                {formatSignedCurrency(totalNet)}
                            </strong>
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
