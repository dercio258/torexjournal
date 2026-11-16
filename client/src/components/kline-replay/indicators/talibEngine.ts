import { KLineData } from 'klinecharts';

/**
 * TA-Lib TypeScript Engine — Vectorized Technical Analysis Primitives
 * Supports all 109 TradingView & Institutional Indicators for KLineCharts
 */
export class TALibEngine {
    static closes(data: KLineData[]): number[] {
        return data.map((d) => d.close);
    }

    static highs(data: KLineData[]): number[] {
        return data.map((d) => d.high);
    }

    static lows(data: KLineData[]): number[] {
        return data.map((d) => d.low);
    }

    static opens(data: KLineData[]): number[] {
        return data.map((d) => d.open);
    }

    static volumes(data: KLineData[]): number[] {
        return data.map((d) => Math.max(1, d.volume || 1));
    }

    static hl2(data: KLineData[]): number[] {
        return data.map((d) => (d.high + d.low) / 2);
    }

    static hlc3(data: KLineData[]): number[] {
        return data.map((d) => (d.high + d.low + d.close) / 3);
    }

    static ohlc4(data: KLineData[]): number[] {
        return data.map((d) => (d.open + d.high + d.low + d.close) / 4);
    }

    static sma(src: number[], period: number): (number | undefined)[] {
        const p = Math.max(1, Math.floor(period));
        const out: (number | undefined)[] = new Array(src.length).fill(undefined);
        let sum = 0;
        for (let i = 0; i < src.length; i++) {
            sum += src[i];
            if (i >= p) sum -= src[i - p];
            if (i >= p - 1) out[i] = sum / p;
        }
        return out;
    }

    static ema(src: number[], period: number): number[] {
        const p = Math.max(1, Math.floor(period));
        const k = 2 / (p + 1);
        const out: number[] = new Array(src.length);
        let prev = src[0] || 0;
        for (let i = 0; i < src.length; i++) {
            const val = Number.isFinite(src[i]) ? src[i] : prev;
            prev = i === 0 ? val : val * k + prev * (1 - k);
            out[i] = prev;
        }
        return out;
    }

    static rma(src: number[], period: number): number[] {
        const p = Math.max(1, Math.floor(period));
        const alpha = 1 / p;
        const out: number[] = new Array(src.length);
        let prev = src[0] || 0;
        for (let i = 0; i < src.length; i++) {
            const val = Number.isFinite(src[i]) ? src[i] : prev;
            prev = i === 0 ? val : alpha * val + (1 - alpha) * prev;
            out[i] = prev;
        }
        return out;
    }

    static wma(src: number[], period: number): (number | undefined)[] {
        const p = Math.max(1, Math.floor(period));
        const weightSum = (p * (p + 1)) / 2;
        const out: (number | undefined)[] = new Array(src.length).fill(undefined);
        for (let i = p - 1; i < src.length; i++) {
            let acc = 0;
            for (let j = 0; j < p; j++) {
                acc += src[i - j] * (p - j);
            }
            out[i] = acc / weightSum;
        }
        return out;
    }

    static hma(src: number[], period: number): (number | undefined)[] {
        const p = Math.max(2, Math.floor(period));
        const half = Math.max(1, Math.floor(p / 2));
        const sqrtP = Math.max(1, Math.floor(Math.sqrt(p)));
        const wmaHalf = this.wma(src, half);
        const wmaFull = this.wma(src, p);
        const diff: number[] = src.map((v, i) => {
            const h = wmaHalf[i];
            const f = wmaFull[i];
            return h !== undefined && f !== undefined ? 2 * h - f : v;
        });
        return this.wma(diff, sqrtP);
    }

    static alma(src: number[], period = 9, offset = 0.85, sigma = 6): (number | undefined)[] {
        const p = Math.max(2, Math.floor(period));
        const m = offset * (p - 1);
        const s = p / sigma;
        const weights: number[] = [];
        let norm = 0;
        for (let i = 0; i < p; i++) {
            const w = Math.exp(-((i - m) * (i - m)) / (2 * s * s));
            weights.push(w);
            norm += w;
        }
        return src.map((_, idx) => {
            if (idx < p - 1) return undefined;
            let sum = 0;
            for (let j = 0; j < p; j++) {
                sum += src[idx - p + 1 + j] * weights[j];
            }
            return sum / norm;
        });
    }

    static trueRange(data: KLineData[]): number[] {
        return data.map((cur, i) => {
            if (i === 0) return cur.high - cur.low;
            const prevClose = data[i - 1].close;
            return Math.max(
                cur.high - cur.low,
                Math.abs(cur.high - prevClose),
                Math.abs(cur.low - prevClose)
            );
        });
    }

    static atr(data: KLineData[], period = 14): number[] {
        return this.rma(this.trueRange(data), period);
    }

    static stdDev(src: number[], period: number): (number | undefined)[] {
        const p = Math.max(2, Math.floor(period));
        const means = this.sma(src, p);
        return src.map((_, i) => {
            const mean = means[i];
            if (mean === undefined || i < p - 1) return undefined;
            let sumSq = 0;
            for (let j = i - p + 1; j <= i; j++) {
                const diff = src[j] - mean;
                sumSq += diff * diff;
            }
            return Math.sqrt(sumSq / p);
        });
    }

    static highest(src: number[], period: number): (number | undefined)[] {
        const p = Math.max(1, Math.floor(period));
        return src.map((_, i) => {
            const start = Math.max(0, i - p + 1);
            let hh = -Infinity;
            for (let j = start; j <= i; j++) {
                if (src[j] > hh) hh = src[j];
            }
            return hh;
        });
    }

    static lowest(src: number[], period: number): (number | undefined)[] {
        const p = Math.max(1, Math.floor(period));
        return src.map((_, i) => {
            const start = Math.max(0, i - p + 1);
            let ll = Infinity;
            for (let j = start; j <= i; j++) {
                if (src[j] < ll) ll = src[j];
            }
            return ll;
        });
    }

    static rsi(src: number[], period = 14): number[] {
        const p = Math.max(2, Math.floor(period));
        const out: number[] = new Array(src.length).fill(50);
        let avgGain = 0;
        let avgLoss = 0;
        for (let i = 1; i < src.length; i++) {
            const diff = src[i] - src[i - 1];
            const gain = Math.max(0, diff);
            const loss = Math.max(0, -diff);
            if (i <= p) {
                avgGain += gain / p;
                avgLoss += loss / p;
            } else {
                avgGain = (avgGain * (p - 1) + gain) / p;
                avgLoss = (avgLoss * (p - 1) + loss) / p;
            }
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
        }
        return out;
    }

    static linreg(src: number[], period: number): { value?: number; slope?: number; stdErr?: number }[] {
        const p = Math.max(2, Math.floor(period));
        const sumX = (p * (p - 1)) / 2;
        const sumX2 = ((p - 1) * p * (2 * p - 1)) / 6;
        const denom = p * sumX2 - sumX * sumX;

        return src.map((_, i) => {
            if (i < p - 1) return {};
            let sumY = 0;
            let sumXY = 0;
            for (let j = 0; j < p; j++) {
                const y = src[i - p + 1 + j];
                sumY += y;
                sumXY += j * y;
            }
            const slope = denom === 0 ? 0 : (p * sumXY - sumX * sumY) / denom;
            const intercept = (sumY - slope * sumX) / p;
            const value = intercept + slope * (p - 1);

            let sse = 0;
            for (let j = 0; j < p; j++) {
                const y = src[i - p + 1 + j];
                const yHat = intercept + slope * j;
                sse += (y - yHat) * (y - yHat);
            }
            const stdErr = p > 2 ? Math.sqrt(sse / (p - 2)) : 0;
            return { value, slope, stdErr };
        });
    }
}
