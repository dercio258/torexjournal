import {
    detectConsentReply,
    extractProfileFacts,
    formatProfileFact,
} from './ai-profile-extractor';
import { AiUserProfileService } from './ai-user-profile.service';
import { AiPrivacySanitizerService } from './ai-privacy-sanitizer.service';

/**
 * Phase 11 — private profile: personal facts are separated from the question,
 * kept only with consent, and never reach the shared memory.
 */
describe('Phase 11 — private user profile', () => {
    describe('extractProfileFacts', () => {
        it('splits the introduction from the question and drops the age', () => {
            const r = extractProfileFacts('oi, sou o Dercio, tenho 22 anos, quero saber o que é scalping');
            expect(r.facts).toEqual([{ type: 'NAME', value: 'Dercio' }]);
            expect(r.discarded).toEqual(['AGE']);
            expect(r.cleanedText).toBe('quero saber o que é scalping');
            expect(r.isPureIntro).toBe(false);
            expect(r.cleanedText).not.toMatch(/dercio|22/i);
        });

        it('recognises a pure introduction', () => {
            const r = extractProfileFacts('Olá, eu sou o dercio');
            expect(r.facts).toEqual([{ type: 'NAME', value: 'Dercio' }]);
            expect(r.isPureIntro).toBe(true);
            expect(r.cleanedText).toBe('');
            expect(r.greeting).toBe('Olá');
        });

        it.each([
            ['my name is John and what is a stop loss?', 'John', 'what is a stop loss?'],
            ["I'm Maria, I am 30 years old. Why am I losing?", 'Maria', 'Why am I losing?'],
            ['me chamo ana, qual é o meu edge?', 'Ana', 'qual é o meu edge?'],
        ])('"%s" → name %s', (text, name, cleaned) => {
            const r = extractProfileFacts(text);
            expect(r.facts.find((f) => f.type === 'NAME')?.value).toBe(name);
            expect(r.cleanedText).toBe(cleaned);
        });

        it.each([
            ['sou iniciante e opero forex e ouro', { EXPERIENCE: 'BEGINNER', MARKETS: 'FOREX,GOLD' }],
            ['sou scalper, opero há 3 anos', { EXPERIENCE: 'Y3', STYLE: 'SCALPING' }],
            ['tenho 2 anos de experiência em day trade e faço day trading', { EXPERIENCE: 'Y2', STYLE: 'DAY_TRADING' }],
            ["I'm a swing trader, been trading for 6 months", { EXPERIENCE: 'M6', STYLE: 'SWING_TRADING' }],
            ['quero passar no desafio da FTMO', { GOAL: 'PASS_PROP_CHALLENGE' }],
        ])('"%s" → profile facts', (text, expected) => {
            const r = extractProfileFacts(text);
            const got = Object.fromEntries(r.facts.map((f) => [f.type, f.value]));
            expect(got).toEqual(expected);
            expect(r.discarded).toEqual([]);
        });

        it.each([
            ['sou o melhor trader da sala?'],
            ['qual é o meu drawdown?'],
            ['estou a perder muito, porquê?'],
            ['I am losing money on gold'],
            ['sou a favor de stops curtos'],
        ])('does not invent a name in "%s"', (text) => {
            const r = extractProfileFacts(text);
            expect(r.facts.find((f) => f.type === 'NAME')).toBeUndefined();
            expect(r.cleanedText).toBe(text);
        });

        it('treats "tenho 3 anos de experiência" as experience, not age', () => {
            const r = extractProfileFacts('tenho 3 anos de experiência no mercado');
            expect(r.discarded).toEqual([]);
            expect(r.facts).toEqual([{ type: 'EXPERIENCE', value: 'Y3' }]);
        });
    });

    describe('detectConsentReply', () => {
        it.each([
            ['Sim, lembra-te de mim', 'GRANT'],
            ['Yes, remember me', 'GRANT'],
            ['Não guardar', 'DENY'],
            ["Don't remember", 'DENY'],
            ['esquece o meu perfil', 'FORGET'],
            ['forget my profile', 'FORGET'],
            ['sim', null],
            ['qual é o meu edge?', null],
        ])('"%s" → %s', (text, expected) => {
            expect(detectConsentReply(text)).toBe(expected);
        });
    });

    describe('formatProfileFact', () => {
        it('renders codes in the requested language', () => {
            expect(formatProfileFact({ type: 'EXPERIENCE', value: 'Y3' }, 'pt')).toBe('Experiência: 3 anos a operar');
            expect(formatProfileFact({ type: 'MARKETS', value: 'FOREX,GOLD' }, 'en')).toBe('Markets: Forex, gold');
            expect(formatProfileFact({ type: 'STYLE', value: 'SCALPING' }, 'pt')).toBe('Estilo: scalping');
        });
    });

    describe('AiUserProfileService', () => {
        const makeService = () => {
            const rows = new Map<string, { consent: string; facts: any }>();
            const query = jest.fn(async (sql: string, params: any[]) => {
                if (sql.startsWith('SELECT')) {
                    const row = rows.get(params[0]);
                    return row ? [{ user_id: params[0], ...row, updated_at: new Date() }] : [];
                }
                if (sql.includes('INSERT INTO ai_user_profile')) {
                    rows.set(params[0], { consent: params[1], facts: JSON.parse(params[2]) });
                    return [];
                }
                if (sql.startsWith('DELETE')) {
                    rows.delete(params[0]);
                    return [];
                }
                return [];
            });
            return { svc: new AiUserProfileService({ query } as any), rows };
        };

        it('does not store facts before consent', async () => {
            const { svc, rows } = makeService();
            await svc.mergeFacts('u1', [{ type: 'NAME', value: 'Dercio' }]);
            expect(rows.size).toBe(0);
            expect(await svc.getPromptFacts('u1', 'pt')).toEqual([]);
        });

        it('stores pending facts on consent and exposes them to the analyst', async () => {
            const { svc } = makeService();
            await svc.setConsent('u1', true, [
                { type: 'NAME', value: 'Dercio' },
                { type: 'STYLE', value: 'SCALPING' },
            ]);
            expect(await svc.getPromptFacts('u1', 'pt')).toEqual(['Nome: Dercio', 'Estilo: scalping']);
            await svc.mergeFacts('u1', [{ type: 'MARKETS', value: 'FOREX' }]);
            expect(await svc.getPromptFacts('u1', 'en')).toEqual(['Name: Dercio', 'Style: scalping', 'Markets: Forex']);
        });

        it('clears every fact when consent is withdrawn, and deletes on request', async () => {
            const { svc, rows } = makeService();
            await svc.setConsent('u1', true, [{ type: 'NAME', value: 'Dercio' }]);
            await svc.setConsent('u1', false);
            expect(rows.get('u1')?.facts).toEqual({});
            expect(await svc.getPromptFacts('u1', 'pt')).toEqual([]);
            await svc.deleteProfile('u1');
            expect(rows.has('u1')).toBe(false);
        });

        it('removes a single fact', async () => {
            const { svc } = makeService();
            await svc.setConsent('u1', true, [
                { type: 'NAME', value: 'Dercio' },
                { type: 'GOAL', value: 'PASS_PROP_CHALLENGE' },
            ]);
            await svc.removeFact('u1', 'NAME');
            expect(await svc.getPromptFacts('u1', 'pt')).toEqual(['Objetivo: passar um desafio de prop firm']);
        });
    });

    describe('shared-memory guard', () => {
        const sanitizer = new AiPrivacySanitizerService();

        it('blocks self-introductions and ages from the global memory', () => {
            const res = sanitizer.inspectCandidateForGlobalSafe({
                question: 'oi, sou o Dercio, tenho 22 anos, o que é scalping?',
                reply: 'O Scalping é um estilo de trading de muito curto prazo, com ganhos pequenos e repetidos.',
                domainCategory: 'TRADING_CONCEPTS',
                intent: 'concept:scalping',
            });
            expect(res.eligible).toBe(false);
            expect(res.reasons).toEqual(expect.arrayContaining(['DLP_FLAG:SELF_INTRO', 'DLP_FLAG:AGE']));
            expect(res.sanitizedQuestion).not.toMatch(/dercio|22 anos/i);
        });

        it('keeps a clean conceptual question eligible', () => {
            const res = sanitizer.inspectCandidateForGlobalSafe({
                question: 'quero saber o que é scalping',
                reply: 'O Scalping é um estilo de trading de muito curto prazo, com ganhos pequenos e repetidos.',
                domainCategory: 'TRADING_CONCEPTS',
                intent: 'concept:scalping',
            });
            expect(res.eligible).toBe(true);
        });
    });
});
