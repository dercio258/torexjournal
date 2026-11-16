import {
    ConversationTurn,
    IMPLICIT_SIGNAL_WEIGHTS,
    detectImplicitSignal,
    shouldAskForVote,
    tokenSimilarity,
} from './ai-implicit-feedback';
import { AiFeedbackSignalsService } from './ai-feedback-signals.service';
import { AiPrivacySanitizerService } from './ai-privacy-sanitizer.service';
import { AiSemanticMemoryService } from './ai-semantic-memory.service';

/**
 * Phase 12 — feedback that feeds the memory: implicit signals, vote prompts,
 * immediate quarantine on "inaccurate" and the rejected-replies review queue.
 */
describe('Phase 12 — feedback signals', () => {
    const t0 = new Date('2026-11-16T10:00:00Z');
    const at = (sec: number) => new Date(t0.getTime() + sec * 1000);

    const conversation = (overrides?: Partial<ConversationTurn>): ConversationTurn[] => [
        { id: 'u1', role: 'user', content: 'Por que estou perdendo dinheiro no ouro?', createdAt: at(0) },
        {
            id: 'a1',
            role: 'assistant',
            content: 'Analisei as tuas operações em XAUUSD...',
            intent: 'losses_diagnosis',
            createdAt: at(10),
            suggestions: ['Qual é o meu Edge?', 'Qual é minha melhor sessão?'],
            ...overrides,
        },
    ];

    describe('detectImplicitSignal', () => {
        it('reads a quick, similar question as a rephrase of a missed reply', () => {
            const r = detectImplicitSignal('porque perco dinheiro no ouro?', conversation(), at(40));
            expect(r).toEqual({ signal: 'REPHRASE', weight: IMPLICIT_SIGNAL_WEIGHTS.REPHRASE, targetMessageId: 'a1' });
        });

        it('reads a clicked suggestion as a useful reply', () => {
            const r = detectImplicitSignal('Qual é o meu Edge?', conversation(), at(40));
            expect(r?.signal).toBe('SUGGESTION_CLICK');
            expect(r?.weight).toBeGreaterThan(0);
        });

        it('reads a new topic as a continuation', () => {
            const r = detectImplicitSignal('e no EURUSD, como estou?', conversation(), at(40));
            expect(r?.signal).toBe('CONTINUATION');
        });

        it('does not call it a rephrase after the 90 s window', () => {
            const r = detectImplicitSignal('porque perco dinheiro no ouro?', conversation(), at(200));
            expect(r?.signal).toBe('CONTINUATION');
        });

        it('infers nothing after 10 minutes or after a non-answer', () => {
            expect(detectImplicitSignal('e agora?', conversation(), at(11 * 60))).toBeNull();
            expect(detectImplicitSignal('ok', conversation({ intent: 'support_fallback' }), at(20))).toBeNull();
            expect(detectImplicitSignal('ok', conversation({ intent: 'profile_consent' }), at(20))).toBeNull();
            expect(detectImplicitSignal('olá', [], at(20))).toBeNull();
        });

        it('measures overlap of content words, not stopwords', () => {
            expect(tokenSimilarity('o que é scalping', 'scalping o que é?')).toBe(1);
            expect(tokenSimilarity('qual o meu edge', 'como importar trades')).toBe(0);
        });
    });

    describe('shouldAskForVote', () => {
        it('asks on the 1st analyst reply and every 5th after it', () => {
            const asked = [1, 2, 3, 4, 5, 6, 7, 11].filter(shouldAskForVote);
            expect(asked).toEqual([1, 6, 11]);
            expect(shouldAskForVote(0)).toBe(false);
        });
    });

    describe('AiSemanticMemoryService feedback effects', () => {
        const makeMemory = (row: Record<string, any>) => {
            const updates: any[][] = [];
            const query = jest.fn(async (sql: string, params: any[]) => {
                if (sql.startsWith('SELECT')) return [row];
                updates.push(params);
                return [];
            });
            const svc = Object.create(AiSemanticMemoryService.prototype) as AiSemanticMemoryService;
            (svc as any).dataSource = { query };
            (svc as any).logger = { warn: jest.fn(), log: jest.fn() };
            return { svc, updates };
        };
        const baseRow = {
            id: 'mem-1',
            scope_level: 'GLOBAL_SAFE',
            status: 'ACTIVE',
            trust_score: 0.82,
            positive_count: 4,
            negative_count: 0,
            distinct_positive_users: 3,
            positive_user_hashes: [],
            normalized_question: 'o que e scalping',
            locale: 'pt',
        };

        it('nudges trust down on a rephrase and quarantines below 0.45', async () => {
            const { svc, updates } = makeMemory({ ...baseRow, trust_score: 0.46 });
            const res = await svc.applyImplicitSignal('mem-1', IMPLICIT_SIGNAL_WEIGHTS.REPHRASE);
            expect(res).toEqual({ trustScore: 0.435, quarantined: true });
            expect(updates[0]).toEqual([0.435, 'QUARANTINED', 'mem-1']);
        });

        it('nudges trust up on a copy, within bounds', async () => {
            const { svc } = makeMemory(baseRow);
            const res = await svc.applyImplicitSignal('mem-1', IMPLICIT_SIGNAL_WEIGHTS.COPY);
            expect(res?.trustScore).toBeCloseTo(0.835, 4);
            expect(res?.quarantined).toBe(false);
        });

        it('quarantines at once when a reply is flagged inaccurate, even with good history', async () => {
            const { svc, updates } = makeMemory(baseRow);
            const res = await svc.applyNegativeFeedbackToMemory('mem-1', undefined, 'pt', { forceQuarantine: true });
            expect(res.quarantinedIds).toEqual(['mem-1']);
            expect(updates[0][2]).toBe('QUARANTINED');
        });

        it('keeps a well-rated memory active on a single generic complaint', async () => {
            const { svc, updates } = makeMemory(baseRow);
            const res = await svc.applyNegativeFeedbackToMemory('mem-1', undefined, 'pt');
            expect(res.quarantinedIds).toEqual([]);
            expect(updates[0][2]).toBe('ACTIVE');
        });
    });

    describe('AiFeedbackSignalsService', () => {
        const message = {
            id: '0b8f6a52-6d1f-4c4e-9a9e-1f1f1f1f1f1f',
            sessionId: '1c8f6a52-6d1f-4c4e-9a9e-1f1f1f1f1f1f',
            role: 'assistant',
            intent: 'concept:scalping',
            provider: 'concept_glossary',
            metadata: { semanticMemoryId: 'mem-1', domainCategory: 'TRADING_CONCEPTS' },
        } as any;

        it('stores a hashed user, no text, and nudges the memory once', async () => {
            const query = jest.fn(async () => [{ id: 'evt-1' }]);
            const memory = { applyImplicitSignal: jest.fn(async () => null) };
            const svc = new AiFeedbackSignalsService({ query } as any, new AiPrivacySanitizerService(), memory as any);

            const res = await svc.recordSignal({ userId: 'user-42', message, signal: 'COPY' });

            expect(res.recorded).toBe(true);
            const params = (query.mock.calls[0] as any[])[1] as any[];
            expect(params[2]).not.toContain('user-42');
            expect(params).not.toContain(message.content);
            expect(params[3]).toBe('COPY');
            expect(memory.applyImplicitSignal).toHaveBeenCalledWith('mem-1', IMPLICIT_SIGNAL_WEIGHTS.COPY);
        });

        it('does not nudge the memory twice for a repeated signal', async () => {
            const query = jest.fn(async () => []);
            const memory = { applyImplicitSignal: jest.fn(async () => null) };
            const svc = new AiFeedbackSignalsService({ query } as any, new AiPrivacySanitizerService(), memory as any);

            const res = await svc.recordSignal({ userId: 'user-42', message, signal: 'COPY' });

            expect(res.recorded).toBe(false);
            expect(memory.applyImplicitSignal).not.toHaveBeenCalled();
        });

        it('quarantines the memory behind a rejected reply on review', async () => {
            const query = jest.fn(async (sql: string) =>
                sql.startsWith('SELECT') ? [{ semantic_memory_id: 'mem-1' }] : []
            );
            const memory = { reviewMemoryByAdmin: jest.fn(async () => ({})) };
            const svc = new AiFeedbackSignalsService({ query } as any, new AiPrivacySanitizerService(), memory as any);

            expect(await svc.reviewRejectedReply('fb-1', 'QUARANTINE_MEMORY')).toBe(true);
            expect(memory.reviewMemoryByAdmin).toHaveBeenCalledWith('mem-1', 'QUARANTINE');
            expect(query.mock.calls[1][0]).toContain('reviewed_at = now()');
        });
    });
});
