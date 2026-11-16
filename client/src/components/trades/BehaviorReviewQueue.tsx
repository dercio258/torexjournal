import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react';
import api from '../../api';
import { formatBehaviorPatternLabel } from './BehaviorMlBadge';

interface ReviewQueueItem {
    id: string;
    accountName: string | null;
    ticket: string | null;
    symbol: string;
    type: string;
    closeTime: string | null;
    netPnl: number | null;
    behavioralMl: {
        riskLevel: string | null;
        anomalyScore: number;
        activeFlags: string[];
        reasons: string[];
    };
}

interface ReviewQueueResponse {
    items: ReviewQueueItem[];
    pendingCount: number;
    reviewedCount: number;
}

interface BehaviorReviewQueueProps {
    accountId?: string | null;
    isEn?: boolean;
}

const RISK_CLASS: Record<string, string> = {
    CRITICAL: 'bg-danger/15 text-danger-fg border-danger/30',
    HIGH: 'bg-danger/10 text-danger-fg border-danger/20',
    MODERATE: 'bg-warning/10 text-warning border-warning/20',
};

/**
 * Review queue for behavior-model alerts that have no trader verdict yet.
 * Each verdict becomes a human label (weight 5) in the next retraining run.
 */
export const BehaviorReviewQueue: React.FC<BehaviorReviewQueueProps> = ({ accountId, isEn = false }) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [expanded, setExpanded] = useState(false);
    const scopedAccount = accountId && accountId !== 'all' ? accountId : 'all';
    const queryKey = ['trades', 'behavior-review-queue', scopedAccount];

    const { data } = useQuery<ReviewQueueResponse>({
        queryKey,
        queryFn: async () => {
            const res = await api.get('/mt5/behavior-review-queue', {
                params: { accountId: scopedAccount, limit: 30 },
            });
            return res.data;
        },
        staleTime: 60_000,
    });

    const feedback = useMutation({
        mutationFn: async (args: { item: ReviewQueueItem; verdict: 'CONFIRM' | 'FALSE_POSITIVE' }) => {
            await api.post(`/mt5/trades/${args.item.id}/behavior-feedback`, {
                verdict: args.verdict,
                correctedFlags: args.verdict === 'CONFIRM' ? args.item.behavioralMl.activeFlags : [],
            });
        },
        onSuccess: (_res, args) => {
            // Drop the reviewed trade right away, then resync counts and the trades table
            queryClient.setQueryData<ReviewQueueResponse>(queryKey, (prev) =>
                prev
                    ? {
                          items: prev.items.filter((i) => i.id !== args.item.id),
                          pendingCount: Math.max(0, prev.pendingCount - 1),
                          reviewedCount: prev.reviewedCount + 1,
                      }
                    : prev
            );
            void queryClient.invalidateQueries({ queryKey: ['trades'] });
        },
    });

    if (!data || data.pendingCount === 0) return null;

    const pendingId = feedback.isPending ? feedback.variables?.item.id : null;

    return (
        <div className="rounded-xl border border-line bg-surface">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left cursor-pointer"
            >
                <div className="min-w-0">
                    <div className="text-xs font-semibold text-fg">
                        {isEn
                            ? `${data.pendingCount} behavior alert${data.pendingCount === 1 ? '' : 's'} to review`
                            : `${data.pendingCount} ${data.pendingCount === 1 ? 'alerta' : 'alertas'} de comportamento por rever`}
                    </div>
                    <div className="text-[11px] text-fg-muted">
                        {isEn
                            ? 'Each answer teaches the model about your real trading. Reviewed so far: '
                            : 'Cada resposta ensina o modelo sobre o teu trading real. Revistos até agora: '}
                        <span className="tabular-nums font-medium text-fg">{data.reviewedCount}</span>
                    </div>
                </div>
                {expanded ? <ChevronUp size={14} className="text-fg-muted shrink-0" /> : <ChevronDown size={14} className="text-fg-muted shrink-0" />}
            </button>

            {expanded && (
                <ul className="border-t border-line-subtle divide-y divide-line-subtle">
                    {data.items.map((item) => {
                        const risk = String(item.behavioralMl.riskLevel || '').toUpperCase();
                        const pnl = Number(item.netPnl) || 0;
                        const busy = pendingId === item.id;
                        return (
                            <li key={item.id} className="px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                                <div className="min-w-0 flex-1 basis-64">
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                        <span className="font-semibold text-fg">{item.symbol}</span>
                                        <span className="text-fg-muted">{item.type}</span>
                                        <span className={`font-mono tabular-nums ${pnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                            {pnl >= 0 ? '+' : ''}
                                            {pnl.toFixed(2)}
                                        </span>
                                        {item.closeTime && (
                                            <span className="text-fg-subtle">
                                                {new Date(item.closeTime).toLocaleString(isEn ? 'en-US' : 'pt-PT', {
                                                    dateStyle: 'short',
                                                    timeStyle: 'short',
                                                })}
                                            </span>
                                        )}
                                        {RISK_CLASS[risk] && (
                                            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${RISK_CLASS[risk]}`}>
                                                {risk}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {item.behavioralMl.activeFlags.map((flag) => (
                                            <span
                                                key={flag}
                                                className="px-1.5 py-0.5 rounded bg-surface-2 border border-line-subtle text-[10px] font-medium text-fg"
                                            >
                                                {formatBehaviorPatternLabel(flag, isEn)}
                                            </span>
                                        ))}
                                    </div>
                                    {item.behavioralMl.reasons[0] && (
                                        <div className="mt-1 text-[11px] text-fg-muted line-clamp-2">{item.behavioralMl.reasons[0]}</div>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        type="button"
                                        disabled={feedback.isPending}
                                        onClick={() => feedback.mutate({ item, verdict: 'CONFIRM' })}
                                        className="h-7 px-2.5 rounded-md text-[11px] font-semibold border bg-surface hover:bg-surface-2 text-fg border-line flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                    >
                                        <ThumbsUp size={11} />
                                        <span>{isEn ? 'Confirm' : 'Confirmar'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        disabled={feedback.isPending}
                                        onClick={() => feedback.mutate({ item, verdict: 'FALSE_POSITIVE' })}
                                        className="h-7 px-2.5 rounded-md text-[11px] font-semibold border bg-surface hover:bg-surface-2 text-fg-muted hover:text-fg border-line flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                    >
                                        <ThumbsDown size={11} />
                                        <span>{isEn ? 'False positive' : 'Falso positivo'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => navigate(`/trades/${item.id}`)}
                                        className="h-7 w-7 rounded-md border border-line bg-surface hover:bg-surface-2 text-fg-muted hover:text-fg flex items-center justify-center cursor-pointer"
                                        title={isEn ? 'Open trade' : 'Abrir trade'}
                                    >
                                        <ExternalLink size={11} />
                                    </button>
                                    {busy && <span className="text-[10px] text-fg-subtle">…</span>}
                                </div>
                            </li>
                        );
                    })}
                    {data.pendingCount > data.items.length && (
                        <li className="px-3 py-2 text-[11px] text-fg-subtle">
                            {isEn
                                ? `Showing the ${data.items.length} most recent. More appear as you review.`
                                : `A mostrar os ${data.items.length} mais recentes. Aparecem mais à medida que revês.`}
                        </li>
                    )}
                </ul>
            )}
            {feedback.isError && (
                <div className="px-3 pb-2 text-[11px] text-danger-fg">
                    {isEn ? 'Could not save the answer. Try again.' : 'Não foi possível guardar a resposta. Tenta de novo.'}
                </div>
            )}
        </div>
    );
};
