import { ReplayOrder } from '../types';
import { getCurrentLocale } from '../../../context/LocaleContext';

export interface QuantAnalyticsReport {
    closedTrades: number;
    winRatePct: number;
    payoffRatio: number;
    profitFactor: number;
    expectancyUsd: number;
    expectancyR: number;
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    sqn: number;
    sqnLabel: string;
    kellyFullPct: number;
    kellyHalfPct: number;
    riskOfRuinPct: number;
    zScoreStreaks: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    consistencyScore: number;
    equityCurve: number[];
    smartRecommendation: string;
}

/**
 * Motor Matemático Quantitativo & Estatístico Institucional
 * Calcula Sharpe, Sortino, Calmar, Critério de Kelly, Risco de Ruína, SQN (Van Tharp) e Z-Score
 */
export class QuantMathEngine {
    static mean(values: number[]): number {
        if (values.length === 0) return 0;
        let sum = 0;
        for (let i = 0; i < values.length; i++) sum += values[i];
        return sum / values.length;
    }

    static stdDev(values: number[], sample = true): number {
        const n = values.length;
        if (n < 2) return 0;
        const m = this.mean(values);
        let sumSq = 0;
        for (let i = 0; i < n; i++) {
            const d = values[i] - m;
            sumSq += d * d;
        }
        return Math.sqrt(sumSq / (sample ? n - 1 : n));
    }

    static downsideDeviation(values: number[], target = 0): number {
        const n = values.length;
        if (n < 2) return 0;
        let sumSq = 0;
        for (let i = 0; i < n; i++) {
            const diff = Math.min(0, values[i] - target);
            sumSq += diff * diff;
        }
        return Math.sqrt(sumSq / n);
    }

    static analyzeSession(
        orders: ReplayOrder[],
        initialBalance = 100000,
        isEn = getCurrentLocale() === 'en'
    ): QuantAnalyticsReport {
        const closed = [...orders]
            .filter((o) => o.status === 'WIN' || o.status === 'LOSS')
            .sort((a, b) => (a.closedAt || a.openedAt) - (b.closedAt || b.openedAt));

        const n = closed.length;
        const equityCurve: number[] = [initialBalance];

        if (n === 0) {
            return {
                closedTrades: 0,
                winRatePct: 0,
                payoffRatio: 0,
                profitFactor: 0,
                expectancyUsd: 0,
                expectancyR: 0,
                sharpeRatio: 0,
                sortinoRatio: 0,
                calmarRatio: 0,
                sqn: 0,
                sqnLabel: isEn ? 'Awaiting Trades' : 'Aguardando Trades',
                kellyFullPct: 0,
                kellyHalfPct: 0,
                riskOfRuinPct: 0,
                zScoreStreaks: 0,
                maxConsecutiveWins: 0,
                maxConsecutiveLosses: 0,
                consistencyScore: 0,
                equityCurve,
                smartRecommendation: isEn
                    ? 'Execute at least 3 trades in Replay to unlock quantitative diagnostics (Sharpe, SQN, Kelly, and Risk of Ruin).'
                    : 'Execute pelo menos 3 operações no Replay para desbloquear o diagnóstico quantitativo (Sharpe, SQN, Kelly e Risco de Ruína).',
            };
        }

        const pnls: number[] = [];
        const pctReturns: number[] = [];
        const rMultiples: number[] = [];

        let runningBalance = initialBalance;
        let peakBalance = initialBalance;
        let maxDrawdownPct = 0;

        let wins = 0;
        let losses = 0;
        let grossWin = 0;
        let grossLoss = 0;

        let curWinStreak = 0;
        let curLossStreak = 0;
        let maxWinStreak = 0;
        let maxLossStreak = 0;
        let runsCount = 1;

        for (let i = 0; i < n; i++) {
            const ord = closed[i];
            const prevBal = Math.max(1, runningBalance);
            const pnl = Number(ord.pnl || 0);
            const retPct = (pnl / prevBal) * 100;
            const rMult =
                ord.rMultiple !== undefined
                    ? ord.rMultiple
                    : ord.riskAmount > 0
                      ? pnl / ord.riskAmount
                      : retPct;

            pnls.push(pnl);
            pctReturns.push(retPct);
            rMultiples.push(rMult);

            runningBalance += pnl;
            equityCurve.push(Number(runningBalance.toFixed(2)));

            if (runningBalance > peakBalance) peakBalance = runningBalance;
            const ddPct = peakBalance > 0 ? ((peakBalance - runningBalance) / peakBalance) * 100 : 0;
            if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

            if (pnl >= 0) {
                wins++;
                grossWin += pnl;
                curWinStreak++;
                curLossStreak = 0;
                if (curWinStreak > maxWinStreak) maxWinStreak = curWinStreak;
            } else {
                losses++;
                grossLoss += Math.abs(pnl);
                curLossStreak++;
                curWinStreak = 0;
                if (curLossStreak > maxLossStreak) maxLossStreak = curLossStreak;
            }

            if (i > 0) {
                const prevWin = closed[i - 1].pnl >= 0;
                const curWin = pnl >= 0;
                if (prevWin !== curWin) runsCount++;
            }
        }

        const winRate = wins / n;
        const lossRate = 1 - winRate;
        const avgWin = wins > 0 ? grossWin / wins : 0;
        const avgLoss = losses > 0 ? grossLoss / losses : 0;
        const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 3 : 0;
        const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9.99 : 0;

        const expectancyUsd = this.mean(pnls);
        const expectancyR = this.mean(rMultiples);

        // Sharpe & Sortino
        const meanRet = this.mean(pctReturns);
        const stdRet = this.stdDev(pctReturns);
        const downRet = this.downsideDeviation(pctReturns, 0);
        const annualFactor = Math.sqrt(Math.min(252, Math.max(n, 1)));

        const sharpeRatio = stdRet > 1e-6 ? (meanRet / stdRet) * annualFactor : 0;
        const sortinoRatio = downRet > 1e-6 ? (meanRet / downRet) * annualFactor : sharpeRatio;

        const totalReturnPct = ((runningBalance - initialBalance) / Math.max(1, initialBalance)) * 100;
        const calmarRatio = maxDrawdownPct > 0.05 ? totalReturnPct / maxDrawdownPct : totalReturnPct > 0 ? 5 : 0;

        // Van Tharp SQN (System Quality Number)
        const stdR = this.stdDev(rMultiples);
        const sqn = stdR > 1e-6 && n >= 2 ? (expectancyR / stdR) * Math.sqrt(Math.min(100, n)) : 0;
        let sqnLabel = isEn ? 'Forming' : 'Em Formação';
        if (n >= 3) {
            if (sqn >= 3.0) sqnLabel = isEn ? 'Institutional Grade (Holy Grail)' : 'Grau Institucional ( Santo Graal )';
            else if (sqn >= 2.5) sqnLabel = isEn ? 'Excellent' : 'Excelente';
            else if (sqn >= 2.0) sqnLabel = isEn ? 'Good / Consistent' : 'Bom / Consistente';
            else if (sqn >= 1.5) sqnLabel = isEn ? 'Average / Tradable' : 'Médio / Operável';
            else sqnLabel = isEn ? 'Fragile / Tune R:R' : 'Frágil / Ajustar R:R';
        }

        // Kelly Criterion: f* = W - (1 - W) / Payoff
        const rawKelly = payoffRatio > 0 ? winRate - lossRate / payoffRatio : 0;
        const kellyFullPct = Math.max(0, Math.min(25, rawKelly * 100));
        const kellyHalfPct = kellyFullPct / 2;

        // Risk of Ruin (%)
        const edge = winRate * Math.min(3, payoffRatio) - lossRate;
        let riskOfRuinPct = 0;
        if (edge <= 0) {
            riskOfRuinPct = Math.min(99.9, 65 + Math.abs(edge) * 30);
        } else {
            const capitalUnits = 20; // 5% risk units
            const ratio = Math.max(0.01, (1 - edge) / (1 + edge));
            riskOfRuinPct = Math.min(99.9, Math.max(0.01, Math.pow(ratio, capitalUnits) * 100));
        }

        // Z-Score of streaks
        let zScoreStreaks = 0;
        if (wins > 0 && losses > 0 && n > 3) {
            const x = 2 * wins * losses;
            const num = n * (runsCount - 0.5) - x;
            const den = Math.sqrt((x * (x - n)) / Math.max(1, n - 1));
            zScoreStreaks = den > 0 ? num / den : 0;
        }

        // Institutional Consistency Score (0 - 100)
        const pfScore = Math.min(35, profitFactor * 14);
        const wrScore = Math.min(25, winRate * 40);
        const ddPenalty = Math.min(30, maxDrawdownPct * 1.5);
        const sqnBonus = Math.max(0, Math.min(40, sqn * 12));
        const consistencyScore = Math.round(Math.max(5, Math.min(99, pfScore + wrScore + sqnBonus - ddPenalty)));

        // Smart Recommendation
        let smartRecommendation = '';
        if (profitFactor >= 1.8 && winRate >= 0.5) {
            smartRecommendation = isEn
                ? `High-expectancy setup (${expectancyR.toFixed(2)}R/trade). Half-Kelly suggests an optimal ${kellyHalfPct.toFixed(2)}% risk per execution.`
                : `Setup com expectativa positiva forte (${expectancyR.toFixed(2)}R/trade). Half-Kelly sugere risco ótimo de ${kellyHalfPct.toFixed(2)}% por operação.`;
        } else if (winRate < 0.4 && payoffRatio >= 2.2) {
            smartRecommendation = isEn
                ? `Trend-following profile (${payoffRatio.toFixed(2)}:1 payoff). Protect discipline through losing streaks of up to ${maxLossStreak} consecutive stops.`
                : `Estratégia seguidora de tendência (Payoff ${payoffRatio.toFixed(2)}:1). Proteja o emocional contra sequências de até ${maxLossStreak} stops consecutivos.`;
        } else if (winRate >= 0.55 && payoffRatio < 1.0) {
            smartRecommendation = isEn
                ? `High win rate (${(winRate * 100).toFixed(1)}%), but compressed payoff (${payoffRatio.toFixed(2)}:1). Avoid scaling out winners prematurely to raise SQN.`
                : `Taxa de acerto alta (${(winRate * 100).toFixed(1)}%), mas Payoff baixo (${payoffRatio.toFixed(2)}:1). Evite cortar ganhos cedo demais para elevar o SQN.`;
        } else {
            smartRecommendation = isEn
                ? `Current expectancy at ${expectancyR.toFixed(2)}R. Target ≥1:2 R:R aligned with higher-timeframe structure to compress Risk of Ruin (${riskOfRuinPct.toFixed(1)}%).`
                : `Expectativa atual em ${expectancyR.toFixed(2)}R. Busque entradas com R:R mínimo de 1:2 a favor da estrutura principal para reduzir o Risco de Ruína (${riskOfRuinPct.toFixed(1)}%).`;
        }

        return {
            closedTrades: n,
            winRatePct: Number((winRate * 100).toFixed(1)),
            payoffRatio: Number(payoffRatio.toFixed(2)),
            profitFactor: Number(profitFactor.toFixed(2)),
            expectancyUsd: Number(expectancyUsd.toFixed(2)),
            expectancyR: Number(expectancyR.toFixed(2)),
            sharpeRatio: Number(sharpeRatio.toFixed(2)),
            sortinoRatio: Number(sortinoRatio.toFixed(2)),
            calmarRatio: Number(calmarRatio.toFixed(2)),
            sqn: Number(sqn.toFixed(2)),
            sqnLabel,
            kellyFullPct: Number(kellyFullPct.toFixed(2)),
            kellyHalfPct: Number(kellyHalfPct.toFixed(2)),
            riskOfRuinPct: Number(riskOfRuinPct.toFixed(2)),
            zScoreStreaks: Number(zScoreStreaks.toFixed(2)),
            maxConsecutiveWins: maxWinStreak,
            maxConsecutiveLosses: maxLossStreak,
            consistencyScore,
            equityCurve,
            smartRecommendation,
        };
    }
}
