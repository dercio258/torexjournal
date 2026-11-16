import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import { SEMANTIC_INTENT_ANCHORS } from './ai-semantic-intent-router.service';
import { TRADING_GLOSSARY } from './ai-trading-glossary';

/**
 * Phase 10 — language-independent concepts and the verified glossary.
 */
describe('Phase 10 — concept glossary', () => {
    const kb = new AiKnowledgeBaseService();

    it.each([
        ['o que é scalping', 'scalping'],
        ["what's scalping?", 'scalping'],
        ['oi, sou o Dercio, tenho 22 anos, quero saber o que é scalping', 'scalping'],
        ['scalping, o que é?', 'scalping'],
        ['scalping?', 'scalping'],
        ['o que e scalpin', 'scalping'],
        ['explica-me o que é um order block', 'order_block'],
        ['O que significa FOMO?', 'fomo'],
        ['what is a stop loss', 'stop_loss'],
        ['o que é backtesting?', 'backtesting'],
        ['o que é profit factor', 'profit_factor'],
        ['what does risk of ruin mean', 'risk_of_ruin'],
        ['como funciona o swing trading', 'swing_trading'],
        ['o que é alavancagem', 'leverage'],
    ])('"%s" → %s', (question, key) => {
        expect(kb.matchTradingConcept(question, 'pt')?.conceptKey).toBe(key);
    });

    it.each([
        ['qual é o meu drawdown?'],
        ['what is my drawdown'],
        ['estou fazendo overtrading?'],
        ['como funciona o backtest'],
        ['como funciona o suporte'],
        ['como importar meus trades?'],
        ['por que estou perdendo?'],
        ['qual é o meu edge?'],
    ])('does not treat "%s" as a definition', (question) => {
        expect(kb.matchTradingConcept(question, 'pt')).toBeNull();
    });

    it('serves the same concept in the language of the question', () => {
        const pt = kb.matchTradingConcept('o que é scalping', 'pt');
        const en = kb.matchTradingConcept("what's scalping?", 'en');
        expect(pt?.conceptKey).toBe(en?.conceptKey);
        expect(pt?.answer).toContain('estilo de trading');
        expect(en?.answer).toContain('trading style');
    });

    it('flags typo matches as fuzzy', () => {
        expect(kb.matchTradingConcept('o que e scalpin', 'pt')?.fuzzy).toBe(true);
        expect(kb.matchTradingConcept('o que e scalping', 'pt')?.fuzzy).toBe(false);
    });

    it('has a PT and EN definition for every concept, with unique keys', () => {
        const keys = new Set<string>();
        for (const c of TRADING_GLOSSARY) {
            expect(keys.has(c.key)).toBe(false);
            keys.add(c.key);
            expect(c.answer.length).toBeGreaterThan(80);
            expect(c.answerEn.length).toBeGreaterThan(80);
            expect(c.aliases.length).toBeGreaterThan(0);
        }
        expect(TRADING_GLOSSARY.length).toBeGreaterThanOrEqual(30);
    });

    it('creates PT and EN semantic anchors for each glossary concept', () => {
        for (const c of TRADING_GLOSSARY) {
            const anchors = SEMANTIC_INTENT_ANCHORS.filter((a) => a.metadata?.conceptKey === c.key);
            expect(anchors.map((a) => a.locale).sort()).toEqual(['en', 'pt']);
        }
        const keys = SEMANTIC_INTENT_ANCHORS.map((a) => a.anchorKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('feeds the glossary into the platform RAG documents in both languages', () => {
        const docs = kb.getPlatformDocumentsForRag().filter((d) => d.sourceId.startsWith('concept:scalping'));
        expect(docs.map((d) => d.locale).sort()).toEqual(['en', 'pt']);
    });
});
