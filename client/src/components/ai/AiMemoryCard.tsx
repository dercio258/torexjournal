import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import api from '../../api';
import { Card } from '../ui/Card';

type ProfileConsent = 'PENDING' | 'GRANTED' | 'DENIED';

interface AiProfileFact {
    type: 'NAME' | 'EXPERIENCE' | 'STYLE' | 'MARKETS' | 'GOAL';
    value: string;
    label: string;
    updatedAt: string;
}

interface AiProfileResponse {
    consent: ProfileConsent;
    updatedAt: string | null;
    facts: AiProfileFact[];
}

/**
 * What Torex AI remembers about the user: visible, editable and deletable.
 * Facts are only kept with consent and never shared with other users.
 */
export const AiMemoryCard = ({ isEn }: { isEn: boolean }) => {
    const queryClient = useQueryClient();
    const locale = isEn ? 'en' : 'pt';
    const queryKey = ['ai', 'profile', locale];
    const [confirmDelete, setConfirmDelete] = useState(false);

    const { data, isLoading, isError } = useQuery<AiProfileResponse>({
        queryKey,
        queryFn: async () => (await api.get('/ai/profile', { params: { locale } })).data,
        staleTime: 60_000,
    });

    const setData = (next: AiProfileResponse) => queryClient.setQueryData(queryKey, next);

    const consent = useMutation({
        mutationFn: async (granted: boolean) =>
            (await api.patch('/ai/profile/consent', { granted }, { params: { locale } })).data as AiProfileResponse,
        onSuccess: setData,
    });

    const removeFact = useMutation({
        mutationFn: async (type: AiProfileFact['type']) =>
            (await api.delete(`/ai/profile/facts/${type}`, { params: { locale } })).data as AiProfileResponse,
        onSuccess: setData,
    });

    const deleteAll = useMutation({
        mutationFn: async () => (await api.delete('/ai/profile')).data,
        onSuccess: () => {
            setConfirmDelete(false);
            setData({ consent: 'PENDING', updatedAt: null, facts: [] });
        },
    });

    const granted = data?.consent === 'GRANTED';
    const busy = consent.isPending || removeFact.isPending || deleteAll.isPending;

    return (
        <Card className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-line-subtle">
                <h2 className="text-xs font-bold text-fg uppercase tracking-wider flex items-center gap-2">
                    <Brain className="w-4 h-4 text-accent-fg" />
                    <span>{isEn ? 'AI Memory' : 'Memória da IA'}</span>
                </h2>
                {data && (
                    <span
                        className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${
                            granted
                                ? 'bg-accent/10 text-accent-fg border-accent/25'
                                : 'bg-canvas-subtle text-fg-muted border-line-subtle'
                        }`}
                    >
                        {granted ? (isEn ? 'On' : 'Ativa') : isEn ? 'Off' : 'Desligada'}
                    </span>
                )}
            </div>

            <p className="text-[11px] text-fg-muted leading-relaxed">
                {isEn
                    ? 'What Torex AI remembers about you to adapt its answers (name, experience, style, markets, goal). Only you can see it; it is never shared and your age is never stored.'
                    : 'O que o Torex AI lembra sobre ti para adaptar as respostas (nome, experiência, estilo, mercados, objetivo). Só tu vês; nunca é partilhado e a idade nunca é guardada.'}
            </p>

            {isLoading && <div className="h-16 rounded-lg bg-canvas-subtle animate-pulse" />}

            {isError && (
                <div className="p-3 rounded-lg bg-danger/10 text-danger-fg border border-danger/25 text-xs">
                    {isEn ? 'Could not load your AI memory.' : 'Não foi possível carregar a memória da IA.'}
                </div>
            )}

            {data && (
                <>
                    <label className="flex items-center justify-between gap-3 p-3 rounded-lg bg-canvas-subtle border border-line-subtle cursor-pointer">
                        <span className="text-xs text-fg">
                            {isEn ? 'Remember what I tell the AI about me' : 'Lembrar o que digo à IA sobre mim'}
                        </span>
                        <input
                            type="checkbox"
                            className="w-4 h-4 accent-[rgb(var(--ds-accent))]"
                            checked={granted}
                            disabled={busy}
                            onChange={(e) => consent.mutate(e.target.checked)}
                        />
                    </label>

                    {data.facts.length > 0 ? (
                        <ul className="space-y-1.5">
                            {data.facts.map((fact) => (
                                <li
                                    key={fact.type}
                                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-line-subtle bg-surface"
                                >
                                    <span className="text-xs text-fg truncate">{fact.label}</span>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => removeFact.mutate(fact.type)}
                                        className="p-1 rounded text-fg-subtle hover:text-danger-fg hover:bg-danger/10 disabled:opacity-50"
                                        aria-label={isEn ? `Forget ${fact.label}` : `Esquecer ${fact.label}`}
                                        title={isEn ? 'Forget' : 'Esquecer'}
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="p-3 rounded-lg bg-canvas-subtle text-fg-muted border border-line-subtle text-xs leading-relaxed">
                            {granted
                                ? isEn
                                    ? 'Nothing saved yet. Tell the AI your name, style or markets and it will remember.'
                                    : 'Ainda nada guardado. Diz à IA o teu nome, estilo ou mercados e ela vai lembrar-se.'
                                : isEn
                                  ? 'Memory is off: the AI forgets what you tell it about yourself after each conversation.'
                                  : 'A memória está desligada: a IA esquece o que lhe contas sobre ti no fim de cada conversa.'}
                        </div>
                    )}

                    {(data.facts.length > 0 || data.consent !== 'PENDING') &&
                        (confirmDelete ? (
                            <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-danger/10 border border-danger/25">
                                <span className="text-xs text-danger-fg">
                                    {isEn ? 'Delete everything the AI remembers?' : 'Apagar tudo o que a IA lembra?'}
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setConfirmDelete(false)}
                                        className="px-2.5 py-1 text-[11px] rounded border border-line-subtle text-fg-muted hover:text-fg"
                                    >
                                        {isEn ? 'Cancel' : 'Cancelar'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => deleteAll.mutate()}
                                        className="px-2.5 py-1 text-[11px] font-semibold rounded bg-danger text-white hover:opacity-90 disabled:opacity-50"
                                    >
                                        {isEn ? 'Delete' : 'Apagar'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setConfirmDelete(true)}
                                className="flex items-center gap-1.5 text-[11px] text-fg-subtle hover:text-danger-fg"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                {isEn ? 'Delete my AI memory' : 'Apagar a minha memória da IA'}
                            </button>
                        ))}
                </>
            )}
        </Card>
    );
};
