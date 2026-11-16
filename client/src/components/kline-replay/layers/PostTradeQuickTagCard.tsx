import React, { useEffect, useState } from 'react';
import { Star, Tag, Check, X } from 'lucide-react';
import type { ReplayOrder } from '../../../schemas/backtestContracts';
import type { OrderQuickTagPatch } from '../orderPreviewMath';
import { useLocale } from '../../../context/LocaleContext';

const DEFAULT_SETUPS = ['OB + FVG', 'Breakout', 'Sweep Liquidez', 'Pullback EMA'];
const FEELING_OPTIONS = ['Calmo', 'Ansioso'] as const;
const YES_NO_OPTIONS = ['Sim', 'Não'] as const;
const DRIVER_OPTIONS = ['Estratégia', 'Impulso'] as const;

function normalizePsychChoice<T extends string>(
    value: string | null | undefined,
    allowed: readonly T[]
): T | undefined {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : undefined;
}

interface PostTradeQuickTagCardProps {
    trade: ReplayOrder | null;
    availableSetups?: string[];
    onSaveTag: (orderId: string, patch: OrderQuickTagPatch) => void;
    onDismiss: () => void;
}

export const PostTradeQuickTagCard: React.FC<PostTradeQuickTagCardProps> = ({
    trade,
    availableSetups = [],
    onSaveTag,
    onDismiss,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';

    const [rating, setRating] = useState<number | null>(trade?.rating ?? null);
    const [setup, setSetup] = useState<string>(trade?.setup ?? '');
    const [feeling, setFeeling] = useState<'Calmo' | 'Ansioso' | undefined>(() =>
        normalizePsychChoice(trade?.psychCheck?.feeling, FEELING_OPTIONS)
    );
    const [followingPlan, setFollowingPlan] = useState<'Sim' | 'Não' | undefined>(() =>
        normalizePsychChoice(trade?.psychCheck?.followingPlan, YES_NO_OPTIONS)
    );
    const [entryDriver, setEntryDriver] = useState<'Estratégia' | 'Impulso' | undefined>(() =>
        normalizePsychChoice(trade?.psychCheck?.entryDriver, DRIVER_OPTIONS)
    );
    const [riskComfort, setRiskComfort] = useState<'Sim' | 'Não' | undefined>(() =>
        normalizePsychChoice(trade?.psychCheck?.riskComfort, YES_NO_OPTIONS)
    );
    const [journalContent, setJournalContent] = useState<string>(trade?.journalContent ?? '');

    useEffect(() => {
        if (!trade) return;
        setRating(trade.rating ?? null);
        setSetup(trade.setup ?? '');
        setFeeling(normalizePsychChoice(trade.psychCheck?.feeling, FEELING_OPTIONS));
        setFollowingPlan(normalizePsychChoice(trade.psychCheck?.followingPlan, YES_NO_OPTIONS));
        setEntryDriver(normalizePsychChoice(trade.psychCheck?.entryDriver, DRIVER_OPTIONS));
        setRiskComfort(normalizePsychChoice(trade.psychCheck?.riskComfort, YES_NO_OPTIONS));
        setJournalContent(trade.journalContent ?? '');
    }, [trade?.id]);

    if (!trade) return null;

    const mergedSetups = Array.from(new Set([...DEFAULT_SETUPS, ...availableSetups.filter(Boolean)])).slice(0, 8);
    const isWin = trade.pnl >= 0;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSaveTag(trade.id, {
            rating,
            setup,
            journalContent,
            psychCheck: {
                feeling,
                followingPlan,
                entryDriver,
                riskComfort,
            },
        });
    };

    return (
        <div
            role="dialog"
            aria-label={isEn ? 'Post-trade quick tagging' : 'Tagging rápido pós-trade'}
            className="fixed bottom-14 right-4 z-[95] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface/95 backdrop-blur-md shadow-2xl p-3.5 text-fg animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
            <form onSubmit={handleSubmit} className="space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2 border-b border-line pb-2">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                            <Tag size={11} className="text-accent-fg shrink-0" />
                            <span>{isEn ? 'Post-Trade Tagging' : 'Tagging Rápido Pós-Trade'}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs font-bold">
                            <span className="font-mono text-fg">{trade.symbol}</span>
                            <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    trade.side === 'BUY'
                                        ? 'bg-emerald-500/15 text-emerald-500'
                                        : 'bg-rose-500/15 text-rose-500'
                                }`}
                            >
                                {trade.side}
                            </span>
                            <span className={`font-mono ${isWin ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {isWin ? '+' : ''}${trade.pnl.toFixed(2)}
                                {trade.rMultiple !== undefined ? ` (${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple}R)` : ''}
                            </span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onDismiss}
                        title={isEn ? 'Close' : 'Fechar'}
                        className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 cursor-pointer transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Star Rating */}
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-fg-muted">
                        {isEn ? 'Execution Quality' : 'Qualidade da Execução'}
                    </span>
                    <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => {
                            const active = (rating ?? 0) >= star;
                            return (
                                <button
                                    key={star}
                                    type="button"
                                    onClick={() => setRating(rating === star ? null : star)}
                                    className="p-0.5 rounded cursor-pointer transition-transform hover:scale-110"
                                    title={`${star}★`}
                                >
                                    <Star
                                        size={15}
                                        className={
                                            active
                                                ? 'fill-amber-400 text-amber-400'
                                                : 'text-fg-muted/40 hover:text-amber-400/70'
                                        }
                                    />
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Setup chips + custom input */}
                <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-fg-muted">Setup</div>
                    <div className="flex flex-wrap gap-1">
                        {mergedSetups.map((preset) => {
                            const isSelected = setup.trim().toLowerCase() === preset.toLowerCase();
                            return (
                                <button
                                    key={preset}
                                    type="button"
                                    onClick={() => setSetup(isSelected ? '' : preset)}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border cursor-pointer transition-colors ${
                                        isSelected
                                            ? 'bg-accent/20 border-accent text-accent-fg'
                                            : 'bg-surface-2 border-line text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    {preset}
                                </button>
                            );
                        })}
                    </div>
                    <input
                        type="text"
                        value={setup}
                        onChange={(e) => setSetup(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder={isEn ? 'Custom setup (e.g. Asian Sweep + MSS)...' : 'Setup customizado...'}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-surface-2 border border-line text-xs text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent"
                    />
                </div>

                {/* Canonical Mental / Psych Check toggles */}
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    <div className="p-1.5 rounded-lg bg-surface-2 border border-line flex items-center justify-between gap-1">
                        <span className="text-fg-muted font-semibold">{isEn ? 'Plan?' : 'Plano?'}</span>
                        <div className="flex gap-1">
                            {(['Sim', 'Não'] as const).map((opt) => (
                                <button
                                    key={opt}
                                    type="button"
                                    onClick={() => setFollowingPlan(followingPlan === opt ? undefined : opt)}
                                    className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                                        followingPlan === opt
                                            ? opt === 'Sim'
                                                ? 'bg-emerald-500 text-white'
                                                : 'bg-rose-500 text-white'
                                            : 'bg-surface-3 text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    {opt}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="p-1.5 rounded-lg bg-surface-2 border border-line flex items-center justify-between gap-1">
                        <span className="text-fg-muted font-semibold">{isEn ? 'State?' : 'Estado?'}</span>
                        <div className="flex gap-1">
                            {(['Calmo', 'Ansioso'] as const).map((opt) => (
                                <button
                                    key={opt}
                                    type="button"
                                    onClick={() => setFeeling(feeling === opt ? undefined : opt)}
                                    className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                                        feeling === opt
                                            ? opt === 'Calmo'
                                                ? 'bg-emerald-500 text-white'
                                                : 'bg-amber-500 text-white'
                                            : 'bg-surface-3 text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    {opt}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="p-1.5 rounded-lg bg-surface-2 border border-line flex items-center justify-between gap-1">
                        <span className="text-fg-muted font-semibold">{isEn ? 'Trigger?' : 'Gatilho?'}</span>
                        <div className="flex gap-1">
                            {(['Estratégia', 'Impulso'] as const).map((opt) => (
                                <button
                                    key={opt}
                                    type="button"
                                    onClick={() => setEntryDriver(entryDriver === opt ? undefined : opt)}
                                    className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                                        entryDriver === opt
                                            ? opt === 'Estratégia'
                                                ? 'bg-emerald-500 text-white'
                                                : 'bg-rose-500 text-white'
                                            : 'bg-surface-3 text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    {opt === 'Estratégia' ? 'Estrat.' : 'Impulso'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="p-1.5 rounded-lg bg-surface-2 border border-line flex items-center justify-between gap-1">
                        <span className="text-fg-muted font-semibold">{isEn ? 'Risk OK?' : 'Risco?'}</span>
                        <div className="flex gap-1">
                            {(['Sim', 'Não'] as const).map((opt) => (
                                <button
                                    key={opt}
                                    type="button"
                                    onClick={() => setRiskComfort(riskComfort === opt ? undefined : opt)}
                                    className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                                        riskComfort === opt
                                            ? opt === 'Sim'
                                                ? 'bg-emerald-500 text-white'
                                                : 'bg-rose-500 text-white'
                                            : 'bg-surface-3 text-fg-muted hover:text-fg'
                                    }`}
                                >
                                    {opt}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Note */}
                <input
                    type="text"
                    value={journalContent}
                    onChange={(e) => setJournalContent(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder={isEn ? '1-line lesson / note...' : 'Nota rápida ou lição do trade...'}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-surface-2 border border-line text-xs text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent"
                />

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-fg-muted cursor-pointer transition-colors"
                    >
                        {isEn ? 'Skip' : 'Pular'}
                    </button>
                    <button
                        type="submit"
                        className="px-3.5 py-1.5 rounded-lg bg-accent hover:opacity-90 text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer shadow-sm transition-opacity"
                    >
                        <Check size={13} />
                        <span>{isEn ? 'Save Tag' : 'Salvar Tag'}</span>
                    </button>
                </div>
            </form>
        </div>
    );
};
