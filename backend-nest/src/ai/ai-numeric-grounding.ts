/**
 * Numeric grounding: every material number in the analyst reply must come from the
 * audited data the analyst was given (verified account JSON + deterministic SQL tools).
 *
 * Accepted: the same value after rounding, a ratio shown as a percentage (and back),
 * the complement of a percentage (win rate 80.4% → loss rate 19.6%), and "k"/"mil" shorthands.
 * Ignored: small counts (integers up to 10), years, clock times and generic risk guidance
 * (percentages up to 2%), which are not claims about the account.
 */

export interface NumericGroundingResult {
    checked: number;
    ungrounded: number[];
    grounded: boolean;
}

const NUMBER_RX = /(?<![\w.])([-+−]?\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d+)?|[-+−]?\d+(?:[.,]\d+)?)(\s*(?:%|x\b|k\b|mil\b|USD|\$|R\b))?/gi;

function toNumber(raw: string): number | null {
    let s = raw.replace('−', '-').replace(/\s/g, '');
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    if (hasComma && hasDot) {
        // The last separator is the decimal one: 22,642.60 or 22.642,60
        s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (hasComma) {
        // 22,642 (thousands) vs 246,12 (decimal comma)
        s = /,\d{3}$/.test(s) && !/^\-?0,/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (hasDot && /^\-?\d{1,3}(\.\d{3})+$/.test(s)) {
        s = s.replace(/\./g, ''); // 22.642 as PT thousands
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

interface FoundNumber {
    value: number;
    isPercent: boolean;
}

export function extractNumbers(text: string): FoundNumber[] {
    const out: FoundNumber[] = [];
    const clean = String(text || '')
        // clock times and ranges like 07h, 12:00, 07h–12h
        .replace(/\b\d{1,2}(?::\d{2}|h\d{0,2})\b/gi, ' ')
        // ISO dates
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
    for (const m of clean.matchAll(NUMBER_RX)) {
        let value = toNumber(m[1]);
        if (value === null) continue;
        const suffix = String(m[2] || '').trim().toLowerCase();
        if (suffix === 'k' || suffix === 'mil') value *= 1000;
        out.push({ value, isPercent: suffix === '%' });
    }
    return out;
}

function isMaterial(n: FoundNumber): boolean {
    const abs = Math.abs(n.value);
    if (n.isPercent) return abs > 2; // 0.5%–2% risk guidance is advice, not account data
    if (Number.isInteger(n.value) && abs <= 10) return false; // "3 trades", "2 sessões"
    if (Number.isInteger(n.value) && n.value >= 1990 && n.value <= 2100) return false; // years
    return true;
}

function close(a: number, b: number): boolean {
    const tol = Math.max(0.006 * Math.abs(b), 0.051);
    return Math.abs(Math.abs(a) - Math.abs(b)) <= tol;
}

function matchesTruth(n: FoundNumber, truth: number[]): boolean {
    for (const t of truth) {
        if (close(n.value, t)) return true;
        if (close(n.value, t * 100) || close(n.value, t / 100)) return true; // ratio ↔ percentage
        if (n.isPercent && t > 0 && t < 100 && close(n.value, 100 - t)) return true; // complement
    }
    return false;
}

/**
 * @param reply   analyst text
 * @param sources the exact prompts sent to the analyst (they hold the verified data)
 */
export function checkNumericGrounding(reply: string, sources: string[]): NumericGroundingResult {
    const truth = Array.from(new Set(sources.flatMap((s) => extractNumbers(s).map((n) => n.value))));
    const material = extractNumbers(reply).filter(isMaterial);
    const ungrounded = Array.from(new Set(material.filter((n) => !matchesTruth(n, truth)).map((n) => n.value)));
    const checked = material.length;
    // One stray figure can be a legitimate derived value; two or more, making up 30%+ of
    // the figures, means the analyst is inventing data.
    const grounded = !(ungrounded.length >= 2 && ungrounded.length / Math.max(1, checked) >= 0.3);
    return { checked, ungrounded, grounded };
}
