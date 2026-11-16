import { useCallback, useEffect, useState } from 'react';
import api from '../../../api';
import { Card } from '../../../components/ui/Card';

interface RejectedReplyItem {
    feedbackId: string;
    messageId: string;
    createdAtIso: string;
    locale: string;
    reasonCode: string | null;
    correctionNote: string | null;
    question: string | null;
    reply: string;
    intent: string | null;
    provider: string | null;
    domainCategory: string | null;
    semanticMemoryId: string | null;
    implicitScore: number;
}

interface ImplicitSignalSummary {
    signal: string;
    count: number;
    weight: number;
}

const SIGNAL_LABELS: Record<string, string> = {
    REPHRASE: 'Reformulou',
    SUGGESTION_CLICK: 'Clicou sugestão',
    ACTION_CLICK: 'Abriu link',
    COPY: 'Copiou',
    CONTINUATION: 'Continuou',
};

const REASON_LABELS: Record<string, string> = {
    INACCURATE: 'Incorreta',
    WRONG_INTENT: 'Percebeu mal',
    GENERIC: 'Genérica',
    INCOMPLETE: 'Incompleta',
    UNSAFE: 'Insegura',
    OTHER: 'Outro',
};

/**
 * Review queue of replies users voted 👎: the admin reads the question, the reply and the
 * user's note, then quarantines the shared memory behind it or dismisses the item.
 */
export const AiRejectedRepliesCard = () => {
    const [items, setItems] = useState<RejectedReplyItem[]>([]);
    const [signals, setSignals] = useState<ImplicitSignalSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get<{ items: RejectedReplyItem[]; implicitSignals: ImplicitSignalSummary[] }>(
                '/admin/ai/rejected-replies',
                { params: { limit: 50 } },
            );
            setItems(res.data?.items || []);
            setSignals(res.data?.implicitSignals || []);
        } catch {
            setError('Não foi possível carregar as respostas rejeitadas.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const review = async (item: RejectedReplyItem, action: 'QUARANTINE_MEMORY' | 'DISMISS') => {
        setBusyId(item.feedbackId);
        try {
            await api.post(`/admin/ai/rejected-replies/${item.feedbackId}/review`, { action });
            setItems((prev) => prev.filter((i) => i.feedbackId !== item.feedbackId));
        } catch {
            setError('A revisão falhou. Tenta de novo.');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Card className="p-6 border-line bg-surface/50 overflow-hidden space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-bold text-fg">Respostas rejeitadas por rever ({items.length})</h3>
                <button
                    type="button"
                    onClick={() => void load()}
                    className="text-[11px] text-fg-subtle hover:text-fg cursor-pointer"
                >
                    Atualizar
                </button>
            </div>

            {signals.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {signals.map((s) => (
                        <span
                            key={s.signal}
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono ${
                                s.weight < 0
                                    ? 'border-rose-500/30 text-rose-400 bg-rose-500/10'
                                    : 'border-line text-fg-muted bg-surface'
                            }`}
                            title="Sinais implícitos nos últimos 30 dias"
                        >
                            {SIGNAL_LABELS[s.signal] || s.signal}: {s.count}
                        </span>
                    ))}
                </div>
            )}

            {error && <p className="text-xs text-rose-400">{error}</p>}

            {loading ? (
                <div className="h-20 rounded-lg bg-surface-2 animate-pulse" />
            ) : items.length === 0 ? (
                <p className="py-4 text-center text-xs text-fg-subtle">
                    Nenhuma resposta rejeitada por rever.
                </p>
            ) : (
                <ul className="divide-y divide-line max-h-[520px] overflow-y-auto">
                    {items.map((item) => {
                        const expanded = expandedId === item.feedbackId;
                        return (
                            <li key={item.feedbackId} className="py-3 space-y-2">
                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                    <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-semibold">
                                        {REASON_LABELS[item.reasonCode || 'OTHER'] || item.reasonCode}
                                    </span>
                                    <span className="font-mono text-fg-subtle">{item.intent || '—'}</span>
                                    <span className="font-mono text-fg-subtle">{item.provider || '—'}</span>
                                    <span className="text-fg-subtle">
                                        {new Date(item.createdAtIso).toLocaleString('pt-PT')}
                                    </span>
                                    {item.implicitScore !== 0 && (
                                        <span className="font-mono text-fg-subtle">
                                            sinais {item.implicitScore > 0 ? '+' : ''}
                                            {item.implicitScore.toFixed(1)}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-fg">
                                    <span className="text-fg-subtle">Pergunta: </span>
                                    {item.question || '—'}
                                </p>
                                {item.correctionNote && (
                                    <p className="text-xs text-amber-400">
                                        <span className="text-fg-subtle">Nota do utilizador: </span>
                                        {item.correctionNote}
                                    </p>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setExpandedId(expanded ? null : item.feedbackId)}
                                    className={`block w-full text-left text-xs text-fg-muted whitespace-pre-wrap cursor-pointer ${
                                        expanded ? '' : 'line-clamp-2'
                                    }`}
                                    title={expanded ? 'Recolher' : 'Ver resposta completa'}
                                >
                                    {item.reply}
                                </button>
                                <div className="flex items-center gap-1.5">
                                    {item.semanticMemoryId && (
                                        <button
                                            type="button"
                                            disabled={busyId === item.feedbackId}
                                            onClick={() => void review(item, 'QUARANTINE_MEMORY')}
                                            className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 text-[11px] cursor-pointer disabled:opacity-50"
                                        >
                                            Quarentena da memória
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        disabled={busyId === item.feedbackId}
                                        onClick={() => void review(item, 'DISMISS')}
                                        className="px-2 py-1 rounded-lg bg-surface-2 text-fg-subtle hover:text-fg text-[11px] cursor-pointer disabled:opacity-50"
                                    >
                                        Marcar revista
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Card>
    );
};
