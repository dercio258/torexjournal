/**
 * Semantic-memory reuse parameters. The defaults are the hand-set production values;
 * the AI lab (quant-engine app/ai_lab) tunes them on a labelled pair set and publishes
 * them to `ai_tuning_params` only when they beat the defaults at ≥98% precision.
 * Keys use snake_case to match the Python dataclass exactly.
 */
export interface MemoryScoringParams {
    w_vec: number;
    w_lex: number;
    lexical_gate: number;
    lexical_only_weight: number;
    threshold_global: number;
    threshold_private: number;
    threshold_intent_pattern: number;
}

export const DEFAULT_MEMORY_SCORING: MemoryScoringParams = {
    w_vec: 0.65,
    w_lex: 0.2,
    lexical_gate: 0.82,
    lexical_only_weight: 0.82,
    threshold_global: 0.88,
    threshold_private: 0.9,
    threshold_intent_pattern: 0.84,
};

export const SCORING_REFRESH_MS = 30 * 60 * 1000;

/** Allowed range per parameter: a bad publish can never make reuse reckless. */
const BOUNDS: Record<keyof MemoryScoringParams, [number, number]> = {
    w_vec: [0.3, 0.9],
    w_lex: [0.0, 0.5],
    lexical_gate: [0.7, 0.98],
    lexical_only_weight: [0.6, 0.98],
    threshold_global: [0.75, 0.98],
    threshold_private: [0.75, 0.99],
    threshold_intent_pattern: [0.7, 0.98],
};

export function sanitizeMemoryScoring(raw: unknown): MemoryScoringParams {
    const out: MemoryScoringParams = { ...DEFAULT_MEMORY_SCORING };
    if (!raw || typeof raw !== 'object') return out;
    for (const key of Object.keys(BOUNDS) as Array<keyof MemoryScoringParams>) {
        const value = Number((raw as Record<string, unknown>)[key]);
        const [lo, hi] = BOUNDS[key];
        if (Number.isFinite(value) && value >= lo && value <= hi) out[key] = value;
    }
    // Trust must keep a non-negative share of the blend.
    if (out.w_vec + out.w_lex > 0.95) {
        out.w_vec = DEFAULT_MEMORY_SCORING.w_vec;
        out.w_lex = DEFAULT_MEMORY_SCORING.w_lex;
    }
    if (out.threshold_private < out.threshold_global) out.threshold_private = out.threshold_global;
    return out;
}
