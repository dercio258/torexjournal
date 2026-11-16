import { checkNumericGrounding, extractNumbers } from './ai-numeric-grounding';
import { checkReuse } from './ai-reuse-guard';
import { AiPromptSystemService } from './ai-prompt-system.service';
import { AiReplyCacheService } from './ai-reply-cache.service';

/**
 * Phase 14 — answer precision: numbers grounded in audited data, reuse guard,
 * deterministic replies for thanks and reckless risk, shared reply cache.
 */
describe('Phase 14 — answer precision', () => {
    describe('numeric grounding', () => {
        const data = JSON.stringify({
            totalTradesFechados: 92,
            netPnl: '22642.60 USD',
            winRatePct: '80.4%',
            profitFactor: 12.74,
            expectancy: '246.12 USD',
            maxDrawdown: '1250.40 USD',
        });

        it('parses PT and EN number formats, percentages and shorthands', () => {
            const values = extractNumbers('Lucro de 22,642.60 USD, 22.642,60 €, 80,4% de acerto, 1.5k e 12h00').map((n) => n.value);
            expect(values).toEqual(expect.arrayContaining([22642.6, 80.4, 1500]));
            expect(values).not.toContain(12);
        });

        it('accepts figures taken from the data, rounded or converted', () => {
            const reply =
                'Em 92 trades o lucro líquido foi de +22,642.60 USD (cerca de 22.6k), com win rate de 80% e loss rate de 19.6%. ' +
                'O Profit Factor de 12.7 e a expectativa de 246 USD por trade mostram vantagem; o drawdown máximo foi 1,250 USD.';
            const r = checkNumericGrounding(reply, [data]);
            expect(r.grounded).toBe(true);
            expect(r.ungrounded).toEqual([]);
        });

        it('rejects a reply that invents several figures', () => {
            const reply = 'O seu win rate é de 63.5%, o Profit Factor 2.31 e o lucro de 8,940.10 USD em 92 trades.';
            const r = checkNumericGrounding(reply, [data]);
            expect(r.grounded).toBe(false);
            expect(r.ungrounded).toEqual(expect.arrayContaining([63.5, 2.31, 8940.1]));
        });

        it('ignores small counts, years and risk guidance', () => {
            const reply = 'Faça 2 pausas por dia, arrisque 0.5% a 1% por trade, como em 2026. Win rate: 80.4%.';
            const r = checkNumericGrounding(reply, [data]);
            expect(r.checked).toBe(1);
            expect(r.grounded).toBe(true);
        });

        it('tolerates one stray derived figure', () => {
            const reply = 'Lucro de 22,642.60 USD, win rate 80.4%, Profit Factor 12.74, uma média de 15.3 trades por semana.';
            expect(checkNumericGrounding(reply, [data]).grounded).toBe(true);
        });
    });

    describe('reuse guard', () => {
        it.each([
            ['qual é o meu drawdown', 'o que é drawdown', 'GLOBAL', 'PERSONAL_MISMATCH'],
            ['what is my profit factor', 'what is profit factor', 'GLOBAL', 'PERSONAL_MISMATCH'],
            ['como estou no eurusd', 'como estou no gbpusd', 'PRIVATE', 'SYMBOL_MISMATCH'],
            ['lucro dos últimos 7 dias', 'lucro dos últimos 30 dias', 'PRIVATE', 'PERIOD_MISMATCH'],
            ['como estou no ouro esta semana', 'como estou no ouro este mês', 'PRIVATE', 'PERIOD_MISMATCH'],
        ] as const)('blocks "%s" vs "%s"', (q, stored, scope, reason) => {
            expect(checkReuse(q, stored, scope)).toEqual({ ok: false, reason });
        });

        it('does not apply the personal check to platform how-tos', () => {
            expect(
                checkReuse('como importar trades do mt5', 'como importar os meus trades do mt5', 'GLOBAL', {
                    domainCategory: 'PLATFORM_KNOWLEDGE',
                }).ok
            ).toBe(true);
            expect(
                checkReuse('qual é o meu drawdown', 'o que é drawdown', 'GLOBAL', { domainCategory: 'TRADING_CONCEPTS' }).ok
            ).toBe(false);
        });

        it.each([
            ['explica-me o scalping', 'o que é scalping', 'GLOBAL'],
            ['como importo os meus trades do mt5', 'como importar os meus trades', 'GLOBAL'],
            ['como estou no XAUUSD', 'como estou no ouro', 'PRIVATE'],
            ['quais são as minhas perdas esta semana', 'onde estou a perder esta semana', 'PRIVATE'],
        ] as const)('allows "%s" vs "%s"', (q, stored, scope) => {
            expect(checkReuse(q, stored, scope).ok).toBe(true);
        });
    });

    describe('deterministic replies', () => {
        const ps = new AiPromptSystemService();

        it.each([['Obrigado!'], ['muito obrigado pela ajuda'], ['thanks a lot, that helped']])(
            '"%s" is a courtesy reply, not the greeting menu',
            (text) => {
                const r = ps.inspectAndClassifyInput(text, 500, 'pt');
                expect(r.directReplyKind).toBe('COURTESY');
            }
        );

        it('does not treat a question that starts with thanks as courtesy', () => {
            expect(ps.inspectAndClassifyInput('obrigado, mas qual é o meu edge?', 500, 'pt').directReplyKind).toBeUndefined();
        });

        it.each([
            ['posso apostar tudo no próximo trade?'],
            ['vou dobrar o lote para recuperar a perda'],
            ['should I go all in on gold?'],
        ])('"%s" gets the risk warning', (text) => {
            const r = ps.inspectAndClassifyInput(text, 500, 'pt');
            expect(r.directReplyKind).toBe('RISK_WARNING');
            expect(r.requiresPersonalData).toBe(false);
            expect(r.directReply).toMatch(/risco de ru[ií]na|risk of ruin/i);
        });
    });

    describe('reply cache', () => {
        const entry = (content: string) => ({
            content,
            intent: 'concept:scalping',
            actions: [],
            suggestions: [],
            expiresAt: Date.now() + 60_000,
        });

        it('stores per user and invalidates one user only (in-process fallback)', async () => {
            const cache = new AiReplyCacheService();
            await cache.set('u1', 'u1::pt::all::q', entry('A'));
            await cache.set('u2', 'u2::pt::all::q', entry('B'));
            expect((await cache.get('u1', 'u1::pt::all::q'))?.content).toBe('A');

            await cache.invalidateUser('u1');
            expect(await cache.get('u1', 'u1::pt::all::q')).toBeNull();
            expect((await cache.get('u2', 'u2::pt::all::q'))?.content).toBe('B');
        });

        it('uses the shared cache when available and falls back when it errors', async () => {
            const store = new Map<string, any>();
            const shared = {
                get: jest.fn(async (k: string) => store.get(k)),
                set: jest.fn(async (k: string, v: any) => void store.set(k, v)),
            };
            const cache = new AiReplyCacheService(shared as any);
            await cache.set('u1', 'k', entry('A'));
            expect(shared.set).toHaveBeenCalled();
            expect((await cache.get('u1', 'k'))?.content).toBe('A');

            const broken = new AiReplyCacheService({
                get: jest.fn(async () => {
                    throw new Error('ECONNREFUSED');
                }),
                set: jest.fn(async () => {
                    throw new Error('ECONNREFUSED');
                }),
            } as any);
            await broken.set('u1', 'k', entry('C'));
            expect((await broken.get('u1', 'k'))?.content).toBe('C');
        });

        it('treats an expired entry as a miss', async () => {
            const cache = new AiReplyCacheService();
            await cache.set('u1', 'k', { ...entry('old'), expiresAt: Date.now() - 1 });
            expect(await cache.get('u1', 'k')).toBeNull();
        });
    });
});
