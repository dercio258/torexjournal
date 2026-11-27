import React from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import {
    DAILY_PSYCH_DIMENSIONS,
    DailyJournalBlock,
    formatCurrencyPlain,
    formatJournalBlockDate,
    formatSignedCurrency,
    parseJournalImages,
    stripHtmlPreview,
} from './types';

interface DailyBlockCardProps {
    block: DailyJournalBlock;
    isSelected: boolean;
    onSelect: (dateKey: string) => void;
}

export const DailyBlockCard: React.FC<DailyBlockCardProps> = ({
    block,
    isSelected,
    onSelect,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { metrics, note } = block;
    const hasTrades = metrics.totalTrades > 0;
    const notePreview = stripHtmlPreview(note?.content, 60);
    const parsedImages = parseJournalImages(note?.images);
    const totalImages =
        (parsedImages.before ? 1 : 0) +
        (parsedImages.after ? 1 : 0) +
        parsedImages.extras.length;

    const psychBadges = DAILY_PSYCH_DIMENSIONS.flatMap((dim) => {
        const val = note?.psychCheck?.[dim.key];
        if (!val) return [];
        const opt = dim.options.find((o) => o.value === val);
        const dimLabel = isEn ? dim.shortLabelEn || dim.shortLabel : dim.shortLabel;
        const optLabel = isEn ? opt?.labelEn || opt?.value : opt?.value;
        return opt ? [{ emoji: opt.emoji, label: `${dimLabel}: ${optLabel}` }] : [];
    });

    const hasNote =
        Boolean(notePreview) ||
        (note?.images?.length ?? 0) > 0 ||
        psychBadges.length > 0;

    const netColor = !hasTrades
        ? 'text-fg-subtle'
        : metrics.netPnl > 0.004
        ? 'text-accent'
        : metrics.netPnl < -0.004
        ? 'text-danger'
        : 'text-fg-muted';

    const mfeDisplay =
        metrics.avgMfe !== null ? `+$${metrics.avgMfe.toFixed(2)}` : '—';
    const maeDisplay =
        metrics.avgMae !== null ? `-$${metrics.avgMae.toFixed(2)}` : '—';

    return (
        <button
            type="button"
            onClick={() => onSelect(block.date)}
            className={`w-full min-w-0 overflow-hidden text-left rounded-xl p-2.5 transition-all cursor-pointer border ${
                isSelected
                    ? 'bg-surface border-data-1 ring-1 ring-data-1/35 shadow-sm'
                    : 'bg-surface hover:bg-surface-2 border-line hover:border-line-strong'
            }`}
        >
            {/* Bloco Superior: Data + P&L Líquido */}
            <div className="bg-canvas-subtle border border-line-subtle rounded-lg px-2.5 py-2 mb-2 min-w-0 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-w-0">
                    <span className="text-xs font-semibold text-fg tracking-tight truncate min-w-0">
                        {formatJournalBlockDate(block.date)}
                    </span>
                    <div className="flex flex-wrap items-center gap-1 shrink-0 max-w-full">
                        {psychBadges.length > 0 ? (
                            <span
                                className="inline-flex flex-wrap items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-surface-2 border border-line-subtle max-w-full"
                                title={psychBadges.map((b) => b.label).join(' · ')}
                            >
                                {psychBadges.map((b, i) => (
                                    <span key={i} className="leading-none">
                                        {b.emoji}
                                    </span>
                                ))}
                            </span>
                        ) : note?.mood ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-fg-muted border border-line-subtle truncate max-w-[110px]">
                                {note.mood}
                            </span>
                        ) : null}
                        {totalImages > 0 && (
                            <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent-fg border border-accent/35 shrink-0"
                                title={isEn ? `${totalImages} attached image(s)` : `${totalImages} imagem(ns) anexada(s)`}
                            >
                                <ImageIcon className="w-3 h-3" />
                                <span>{totalImages}</span>
                            </span>
                        )}
                        {hasNote && (
                            <span
                                className="inline-flex items-center justify-center w-4 h-4 rounded bg-data-1/15 text-data-1 shrink-0"
                                title={isEn ? 'Has daily session note' : 'Contém nota diária'}
                            >
                                <FileText className="w-2.5 h-2.5" />
                            </span>
                        )}
                    </div>
                </div>

                <div
                    className={`mt-1 text-xs font-mono font-semibold tabular-nums truncate ${netColor}`}
                >
                    {hasTrades ? formatSignedCurrency(metrics.netPnl) : '—'}
                </div>

                {notePreview && (
                    <p className="mt-1 text-[11px] text-fg-subtle line-clamp-2 break-words">
                        {notePreview}
                    </p>
                )}

                {(parsedImages.before || parsedImages.after) && (
                    <div className="mt-2 pt-2 border-t border-line-subtle flex items-center justify-center gap-2">
                        {parsedImages.before && (
                            <div className="relative flex-1 max-w-[130px] h-16 rounded-md overflow-hidden border border-data-1/40 bg-canvas flex items-center justify-center">
                                <img
                                    src={parsedImages.before}
                                    alt={isEn ? 'BEFORE' : 'ANTES'}
                                    className="max-h-full max-w-full object-contain mx-auto"
                                />
                                <span className="absolute bottom-1 left-1 px-1 py-0.2 rounded text-[8px] font-bold uppercase bg-canvas/85 text-fg border border-data-1/40">
                                    {isEn ? 'BEFORE' : 'ANTES'}
                                </span>
                            </div>
                        )}
                        {parsedImages.after && (
                            <div className="relative flex-1 max-w-[130px] h-16 rounded-md overflow-hidden border border-accent/40 bg-canvas flex items-center justify-center">
                                <img
                                    src={parsedImages.after}
                                    alt={isEn ? 'AFTER' : 'DEPOIS'}
                                    className="max-h-full max-w-full object-contain mx-auto"
                                />
                                <span className="absolute bottom-1 left-1 px-1 py-0.2 rounded text-[8px] font-bold uppercase bg-canvas/85 text-accent-fg border border-accent/40">
                                    {isEn ? 'AFTER' : 'DEPOIS'}
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Grid Inferior 2 Colunas: Métricas Diárias */}
            <div className="grid grid-cols-2 gap-1.5 min-w-0">
                {/* Coluna Esquerda: Commissions, Trades, MFE */}
                <div className="min-w-0 overflow-hidden bg-canvas-subtle border border-line-subtle rounded-lg px-2 py-2 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-1.5 min-w-0" title="Commissions">
                        <span className="text-fg-muted truncate min-w-0">Commissions</span>
                        <span className="font-mono tabular-nums text-fg font-medium shrink-0 whitespace-nowrap">
                            {hasTrades && metrics.totalCommissions > 0
                                ? formatCurrencyPlain(metrics.totalCommissions)
                                : '—'}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-1.5 min-w-0">
                        <span className="text-fg-muted truncate min-w-0">Trades</span>
                        <span className="font-mono tabular-nums text-fg font-medium shrink-0 whitespace-nowrap">
                            {hasTrades ? metrics.totalTrades : '—'}
                        </span>
                    </div>
                    <div
                        className="flex items-center justify-between gap-1.5 min-w-0"
                        title={
                            metrics.maxMfe !== null
                                ? (isEn
                                    ? `Avg MFE: +$${metrics.avgMfe?.toFixed(2)} | Max: +$${metrics.maxMfe.toFixed(2)}`
                                    : `MFE Médio: +$${metrics.avgMfe?.toFixed(2)} | Máx: +$${metrics.maxMfe.toFixed(2)}`)
                                : 'Maximum Favorable Excursion'
                        }
                    >
                        <span className="text-fg-muted truncate min-w-0">MFE</span>
                        <span
                            className={`font-mono tabular-nums font-medium shrink-0 whitespace-nowrap ${
                                metrics.avgMfe !== null ? 'text-accent' : 'text-fg-subtle'
                            }`}
                        >
                            {mfeDisplay}
                        </span>
                    </div>
                </div>

                {/* Coluna Direita: MAE, Win %, P/F */}
                <div className="min-w-0 overflow-hidden bg-canvas-subtle border border-line-subtle rounded-lg px-2 py-2 space-y-1.5 text-[11px]">
                    <div
                        className="flex items-center justify-between gap-1.5 min-w-0"
                        title={
                            metrics.maxMae !== null
                                ? (isEn
                                    ? `Avg MAE: -$${metrics.avgMae?.toFixed(2)} | Max: -$${metrics.maxMae.toFixed(2)}`
                                    : `MAE Médio: -$${metrics.avgMae?.toFixed(2)} | Máx: -$${metrics.maxMae.toFixed(2)}`)
                                : 'Maximum Adverse Excursion'
                        }
                    >
                        <span className="text-fg-muted truncate min-w-0">MAE</span>
                        <span
                            className={`font-mono tabular-nums font-medium shrink-0 whitespace-nowrap ${
                                metrics.avgMae !== null ? 'text-danger' : 'text-fg-subtle'
                            }`}
                        >
                            {maeDisplay}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-1.5 min-w-0">
                        <span className="text-fg-muted truncate min-w-0">Win %</span>
                        <span className="font-mono tabular-nums text-fg font-medium shrink-0 whitespace-nowrap">
                            {metrics.winRate !== null ? `${metrics.winRate.toFixed(1)}%` : '—'}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-1.5 min-w-0">
                        <span className="text-fg-muted truncate min-w-0">P/F</span>
                        <span className="font-mono tabular-nums text-fg font-medium shrink-0 whitespace-nowrap">
                            {metrics.profitFactor !== null
                                ? metrics.profitFactor >= 99
                                    ? '∞'
                                    : metrics.profitFactor.toFixed(2)
                                : '—'}
                        </span>
                    </div>
                </div>
            </div>
        </button>
    );
};
