import { DEFAULT_MEMORY_SCORING, sanitizeMemoryScoring } from './ai-memory-scoring';
import { AiSemanticMemoryService } from './ai-semantic-memory.service';

/**
 * Phase 13 — the backend reads memory-reuse parameters tuned by the AI lab,
 * within safe bounds, and falls back to the defaults on any problem.
 */
describe('Phase 13 — tuned memory scoring params', () => {
    it('accepts in-range values from the lab', () => {
        const p = sanitizeMemoryScoring({ ...DEFAULT_MEMORY_SCORING, threshold_global: 0.91, threshold_private: 0.93, lexical_gate: 0.9 });
        expect(p.threshold_global).toBe(0.91);
        expect(p.threshold_private).toBe(0.93);
        expect(p.lexical_gate).toBe(0.9);
    });

    it('rejects reckless or malformed values', () => {
        expect(sanitizeMemoryScoring({ threshold_global: 0.4 }).threshold_global).toBe(0.88);
        expect(sanitizeMemoryScoring({ w_vec: 0.9, w_lex: 0.5 })).toMatchObject({ w_vec: 0.65, w_lex: 0.2 });
        expect(sanitizeMemoryScoring('garbage')).toEqual(DEFAULT_MEMORY_SCORING);
        expect(sanitizeMemoryScoring(null)).toEqual(DEFAULT_MEMORY_SCORING);
        const p = sanitizeMemoryScoring({ threshold_global: 0.95, threshold_private: 0.9 });
        expect(p.threshold_private).toBe(0.95);
    });

    const makeService = (query: jest.Mock) => {
        const svc = Object.create(AiSemanticMemoryService.prototype) as AiSemanticMemoryService;
        (svc as any).dataSource = { query };
        (svc as any).scoring = { ...DEFAULT_MEMORY_SCORING };
        (svc as any).scoringLoadedAt = 0;
        return svc;
    };

    it('loads published params and keeps defaults when the table is missing', async () => {
        const published = makeService(jest.fn(async () => [{ value: { ...DEFAULT_MEMORY_SCORING, threshold_global: 0.92, threshold_private: 0.94 } }]));
        expect((await published.refreshScoringParams(true)).threshold_global).toBe(0.92);

        const missing = makeService(jest.fn(async () => { throw new Error('relation "ai_tuning_params" does not exist'); }));
        expect(await missing.refreshScoringParams(true)).toEqual(DEFAULT_MEMORY_SCORING);
    });

    it('refreshes at most every 30 minutes', async () => {
        const query = jest.fn(async () => []);
        const svc = makeService(query);
        await svc.refreshScoringParams();
        await svc.refreshScoringParams();
        expect(query).toHaveBeenCalledTimes(1);
    });
});
