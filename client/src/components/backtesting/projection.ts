/**
 * Monte Carlo projection of a win-rate / R:R edge. Purely hypothetical: it uses
 * the inputs the user types, not market data, and is labelled as such in the UI.
 */
export interface ProjectionInput {
    capital: number;
    riskPct: number;
    rr: number;
    winRatePct: number;
    trades: number;
    /** fixed = risk from starting capital; compound = risk from current equity. */
    sizing: 'fixed' | 'compound';
    /** Drawdown (% from peak) counted as "ruin". */
    ruinPct: number;
    runs?: number;
    seed?: number;
}

export interface ProjectionResult {
    runs: number;
    expectancyR: number;
    breakevenWinRate: number;
    percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
    medianMaxDdPct: number;
    probLoss: number;
    probRuin: number;
    longestLosingStreakMedian: number;
    histogram: { from: number; to: number; count: number }[];
}

const mulberry32 = (a: number) => () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const quantile = (sorted: number[], q: number) => {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export function runProjection(input: ProjectionInput): ProjectionResult {
    const runs = input.runs ?? 2000;
    const rand = mulberry32(input.seed ?? 42);
    const p = Math.min(1, Math.max(0, input.winRatePct / 100));
    const finals: number[] = [];
    const dds: number[] = [];
    const streaks: number[] = [];
    let ruined = 0;

    for (let r = 0; r < runs; r++) {
        let eq = input.capital;
        let peak = eq;
        let maxDd = 0;
        let streak = 0;
        let worst = 0;
        for (let t = 0; t < input.trades; t++) {
            const base = input.sizing === 'compound' ? eq : input.capital;
            const risk = Math.max(0, base) * (input.riskPct / 100);
            if (rand() < p) {
                eq += risk * input.rr;
                streak = 0;
            } else {
                eq -= risk;
                streak += 1;
                worst = Math.max(worst, streak);
            }
            peak = Math.max(peak, eq);
            maxDd = Math.max(maxDd, peak > 0 ? ((peak - eq) / peak) * 100 : 100);
        }
        finals.push(eq - input.capital);
        dds.push(maxDd);
        streaks.push(worst);
        if (maxDd >= input.ruinPct) ruined++;
    }

    const sorted = [...finals].sort((a, b) => a - b);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const bins = 24;
    const width = (hi - lo) / bins || 1;
    const histogram = Array.from({ length: bins }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
    finals.forEach((v) => {
        histogram[Math.min(bins - 1, Math.floor((v - lo) / width))].count++;
    });

    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
        runs,
        expectancyR: r2(p * input.rr - (1 - p)),
        breakevenWinRate: r2(100 / (1 + input.rr)),
        percentiles: {
            p5: r2(quantile(sorted, 0.05)),
            p25: r2(quantile(sorted, 0.25)),
            p50: r2(quantile(sorted, 0.5)),
            p75: r2(quantile(sorted, 0.75)),
            p95: r2(quantile(sorted, 0.95)),
        },
        medianMaxDdPct: r2(quantile([...dds].sort((a, b) => a - b), 0.5)),
        probLoss: r2((finals.filter((v) => v < 0).length / runs) * 100),
        probRuin: r2((ruined / runs) * 100),
        longestLosingStreakMedian: Math.round(quantile([...streaks].sort((a, b) => a - b), 0.5)),
        histogram,
    };
}
