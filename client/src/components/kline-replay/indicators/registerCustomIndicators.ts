import { registerIndicator, KLineData } from 'klinecharts';
import { TALibEngine as TA } from './talibEngine';
import { getCurrentLocale } from '../../../context/LocaleContext';

let customIndicatorsRegistered = false;

export function ensureCustomIndicators(): void {
    if (customIndicatorsRegistered) return;
    customIndicatorsRegistered = true;

    // 1. 52 Week High/Low
    registerIndicator({
        name: 'WEEK_52_HL',
        shortName: '52W H/L',
        calcParams: [252],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'high52', title: '52W High: ', type: 'line' },
            { key: 'low52', title: '52W Low: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 252);
            const highs = TA.highest(TA.highs(dataList), p);
            const lows = TA.lowest(TA.lows(dataList), p);
            return dataList.map((_, i) => ({ high52: highs[i], low52: lows[i] }));
        },
    });

    // 2. Accelerator Oscillator (AC = AO - SMA(AO, 5))
    registerIndicator({
        name: 'AC',
        shortName: 'AC',
        calcParams: [5, 34, 5],
        precision: 4,
        shouldOhlc: false,
        figures: [{ key: 'ac', title: 'AC: ', type: 'bar', baseValue: 0 }],
        calc: (dataList: KLineData[], indicator) => {
            const [fast, slow, sig] = indicator.calcParams as number[];
            const hl2 = TA.hl2(dataList);
            const smaFast = TA.sma(hl2, fast || 5);
            const smaSlow = TA.sma(hl2, slow || 34);
            const ao = hl2.map((_, i) =>
                smaFast[i] !== undefined && smaSlow[i] !== undefined ? smaFast[i]! - smaSlow[i]! : 0
            );
            const smaAo = TA.sma(ao, sig || 5);
            return dataList.map((_, i) => ({
                ac: smaAo[i] !== undefined ? ao[i] - smaAo[i]! : undefined,
            }));
        },
    });

    // 3. Accumulation/Distribution (A/D)
    registerIndicator({
        name: 'AD',
        shortName: 'Accum/Dist',
        calcParams: [1],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'ad', title: 'A/D: ', type: 'line' }],
        calc: (dataList: KLineData[]) => {
            let cumAd = 0;
            return dataList.map((d) => {
                const range = d.high - d.low;
                const mfm = range === 0 ? 0 : ((d.close - d.low) - (d.high - d.close)) / range;
                cumAd += mfm * Math.max(1, d.volume || 1);
                return { ad: cumAd };
            });
        },
    });

    // 4. Accumulative Swing Index (ASI)
    registerIndicator({
        name: 'ASI',
        shortName: 'ASI',
        calcParams: [10],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'asi', title: 'ASI: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const limitMove = Math.max(0.0001, Number((indicator.calcParams as number[])[0]) || 10);
            let asi = 0;
            return dataList.map((cur, i) => {
                if (i === 0) return { asi: 0 };
                const prev = dataList[i - 1];
                const a = Math.abs(cur.high - prev.close);
                const b = Math.abs(cur.low - prev.close);
                const c = Math.abs(cur.high - cur.low);
                const d = Math.abs(prev.close - prev.open);
                const k = Math.max(a, b);
                let r = c + 0.25 * d;
                if (a >= b && a >= c) r = a - 0.5 * b + 0.25 * d;
                else if (b >= a && b >= c) r = b - 0.5 * a + 0.25 * d;
                const num =
                    (cur.close - prev.close) +
                    0.5 * (cur.close - cur.open) +
                    0.25 * (prev.close - prev.open);
                const si = r === 0 ? 0 : (50 * (num / r) * k) / limitMove;
                asi += si;
                return { asi };
            });
        },
    });

    // 5. Advance/Decline Line
    registerIndicator({
        name: 'ADR_LINE',
        shortName: 'Adv/Dec',
        calcParams: [14],
        precision: 2,
        shouldOhlc: false,
        figures: [
            { key: 'adLine', title: 'A/D Line: ', type: 'line' },
            { key: 'adRatio', title: 'Ratio: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            let cum = 0;
            const dirs = dataList.map((d) => (d.close > d.open ? 1 : d.close < d.open ? -1 : 0));
            return dataList.map((_, i) => {
                cum += dirs[i];
                let up = 0;
                let dn = 0;
                for (let j = Math.max(0, i - p + 1); j <= i; j++) {
                    if (dirs[j] > 0) up++;
                    else if (dirs[j] < 0) dn++;
                }
                return { adLine: cum, adRatio: up / Math.max(1, dn) };
            });
        },
    });

    // 6. Arnaud Legoux Moving Average (ALMA)
    registerIndicator({
        name: 'ALMA',
        shortName: 'ALMA',
        calcParams: [9, 0.85, 6],
        precision: 4,
        shouldOhlc: true,
        figures: [{ key: 'alma', title: 'ALMA: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [p, offset, sigma] = indicator.calcParams as number[];
            const vals = TA.alma(TA.closes(dataList), p || 9, offset || 0.85, sigma || 6);
            return vals.map((alma) => ({ alma }));
        },
    });

    // 7. Aroon (Up / Down / Osc)
    registerIndicator({
        name: 'AROON',
        shortName: 'Aroon',
        calcParams: [14],
        precision: 2,
        minValue: 0,
        maxValue: 100,
        shouldOhlc: false,
        figures: [
            { key: 'up', title: 'Aroon Up: ', type: 'line' },
            { key: 'down', title: 'Aroon Down: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            return dataList.map((_, i) => {
                if (i < p) return {};
                let hhIdx = i;
                let llIdx = i;
                for (let j = i - p; j <= i; j++) {
                    if (dataList[j].high >= dataList[hhIdx].high) hhIdx = j;
                    if (dataList[j].low <= dataList[llIdx].low) llIdx = j;
                }
                return {
                    up: ((p - (i - hhIdx)) / p) * 100,
                    down: ((p - (i - llIdx)) / p) * 100,
                };
            });
        },
    });

    // 8. Average Directional Index (ADX)
    registerIndicator({
        name: 'ADX',
        shortName: 'ADX',
        calcParams: [14],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'adx', title: 'ADX: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            const atr = TA.atr(dataList, p);
            const plusDM: number[] = [0];
            const minusDM: number[] = [0];
            for (let i = 1; i < dataList.length; i++) {
                const upMove = dataList[i].high - dataList[i - 1].high;
                const dnMove = dataList[i - 1].low - dataList[i].low;
                plusDM.push(upMove > dnMove && upMove > 0 ? upMove : 0);
                minusDM.push(dnMove > upMove && dnMove > 0 ? dnMove : 0);
            }
            const smPlus = TA.rma(plusDM, p);
            const smMinus = TA.rma(minusDM, p);
            const dx = dataList.map((_, i) => {
                const tr = atr[i] || 1;
                const pdi = (100 * smPlus[i]) / tr;
                const mdi = (100 * smMinus[i]) / tr;
                const sum = pdi + mdi;
                return sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum;
            });
            const adx = TA.rma(dx, p);
            return adx.map((v, i) => (i < p ? {} : { adx: v }));
        },
    });

    // 10. Average True Range (ATR)
    registerIndicator({
        name: 'ATR',
        shortName: 'ATR',
        calcParams: [14],
        precision: 5,
        shouldOhlc: false,
        figures: [{ key: 'atr', title: 'ATR: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            const atr = TA.atr(dataList, p);
            return atr.map((v, i) => (i < p - 1 ? {} : { atr: v }));
        },
    });

    // 12. Balance of Power (BOP)
    registerIndicator({
        name: 'BOP',
        shortName: 'BOP',
        calcParams: [14],
        precision: 4,
        shouldOhlc: false,
        figures: [{ key: 'bop', title: 'BOP: ', type: 'bar', baseValue: 0 }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(1, Number((indicator.calcParams as number[])[0]) || 14);
            const raw = dataList.map((d) =>
                d.high === d.low ? 0 : (d.close - d.open) / (d.high - d.low)
            );
            const sm = TA.sma(raw, p);
            return sm.map((bop) => ({ bop }));
        },
    });

    // 14. Bollinger Bands %B
    registerIndicator({
        name: 'BB_PERCENT_B',
        shortName: 'BB %B',
        calcParams: [20, 2],
        precision: 3,
        shouldOhlc: false,
        figures: [{ key: 'pctB', title: '%B: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [p, mult] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const sma = TA.sma(closes, p || 20);
            const std = TA.stdDev(closes, p || 20);
            const m = mult || 2;
            return closes.map((c, i) => {
                if (sma[i] === undefined || std[i] === undefined) return {};
                const up = sma[i]! + m * std[i]!;
                const dn = sma[i]! - m * std[i]!;
                return { pctB: up === dn ? 0.5 : (c - dn) / (up - dn) };
            });
        },
    });

    // 15. Bollinger Bands Width
    registerIndicator({
        name: 'BB_WIDTH',
        shortName: 'BBW',
        calcParams: [20, 2],
        precision: 4,
        shouldOhlc: false,
        figures: [{ key: 'bbw', title: 'BB Width: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [p, mult] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const sma = TA.sma(closes, p || 20);
            const std = TA.stdDev(closes, p || 20);
            const m = mult || 2;
            return closes.map((_, i) => {
                if (!sma[i] || std[i] === undefined) return {};
                return { bbw: ((2 * m * std[i]!) / sma[i]!) * 100 };
            });
        },
    });

    // 16. Chaikin Money Flow (CMF)
    registerIndicator({
        name: 'CMF',
        shortName: 'CMF',
        calcParams: [20],
        precision: 4,
        shouldOhlc: false,
        figures: [{ key: 'cmf', title: 'CMF: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            const mfv = dataList.map((d) => {
                const r = d.high - d.low;
                const mfm = r === 0 ? 0 : ((d.close - d.low) - (d.high - d.close)) / r;
                return mfm * Math.max(1, d.volume || 1);
            });
            const vols = TA.volumes(dataList);
            return dataList.map((_, i) => {
                if (i < p - 1) return {};
                let sumMfv = 0;
                let sumVol = 0;
                for (let j = i - p + 1; j <= i; j++) {
                    sumMfv += mfv[j];
                    sumVol += vols[j];
                }
                return { cmf: sumMfv / Math.max(1, sumVol) };
            });
        },
    });

    // 17. Chaikin Oscillator
    registerIndicator({
        name: 'CHAIKIN_OSC',
        shortName: 'Chaikin Osc',
        calcParams: [3, 10],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'cosc', title: 'Chaikin Osc: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [fast, slow] = indicator.calcParams as number[];
            let cumAd = 0;
            const ad = dataList.map((d) => {
                const r = d.high - d.low;
                const mfm = r === 0 ? 0 : ((d.close - d.low) - (d.high - d.close)) / r;
                cumAd += mfm * Math.max(1, d.volume || 1);
                return cumAd;
            });
            const eFast = TA.ema(ad, fast || 3);
            const eSlow = TA.ema(ad, slow || 10);
            return dataList.map((_, i) => ({ cosc: eFast[i] - eSlow[i] }));
        },
    });

    // 18. Chaikin Volatility
    registerIndicator({
        name: 'CHAIKIN_VOL',
        shortName: 'Chaikin Vol',
        calcParams: [10, 10],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'cvol', title: 'Chaikin Vol %: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [emaLen, rocLen] = indicator.calcParams as number[];
            const hl = dataList.map((d) => d.high - d.low);
            const emaHl = TA.ema(hl, emaLen || 10);
            const r = Math.max(1, rocLen || 10);
            return emaHl.map((v, i) => {
                if (i < r || emaHl[i - r] === 0) return {};
                return { cvol: ((v - emaHl[i - r]) / emaHl[i - r]) * 100 };
            });
        },
    });

    // 19. Chande Kroll Stop
    registerIndicator({
        name: 'CHANDE_KROLL',
        shortName: 'CK Stop',
        calcParams: [10, 1, 9],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'stopLong', title: 'Stop Long: ', type: 'line' },
            { key: 'stopShort', title: 'Stop Short: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p, x, q] = indicator.calcParams as number[];
            const pLen = Math.max(2, p || 10);
            const mult = x || 1;
            const qLen = Math.max(2, q || 9);
            const atr = TA.atr(dataList, pLen);
            const hh = TA.highest(TA.highs(dataList), pLen);
            const ll = TA.lowest(TA.lows(dataList), pLen);
            const firstHighStop = dataList.map((_, i) => (hh[i] ?? dataList[i].high) - mult * atr[i]);
            const firstLowStop = dataList.map((_, i) => (ll[i] ?? dataList[i].low) + mult * atr[i]);
            const stopLong = TA.highest(firstHighStop, qLen);
            const stopShort = TA.lowest(firstLowStop, qLen);
            return dataList.map((_, i) => ({
                stopLong: i < pLen ? undefined : stopLong[i],
                stopShort: i < pLen ? undefined : stopShort[i],
            }));
        },
    });

    // 20. Chande Momentum Oscillator (CMO)
    registerIndicator({
        name: 'CMO',
        shortName: 'CMO',
        calcParams: [14],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'cmo', title: 'CMO: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            return dataList.map((_, i) => {
                if (i < p) return {};
                let sumUp = 0;
                let sumDn = 0;
                for (let j = i - p + 1; j <= i; j++) {
                    const diff = dataList[j].close - dataList[j - 1].close;
                    if (diff > 0) sumUp += diff;
                    else sumDn += -diff;
                }
                const tot = sumUp + sumDn;
                return { cmo: tot === 0 ? 0 : ((sumUp - sumDn) / tot) * 100 };
            });
        },
    });

    // 21. Chop Zone
    registerIndicator({
        name: 'CHOP_ZONE',
        shortName: 'ChopZone',
        calcParams: [30],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'cz', title: 'Chop Zone: ', type: 'bar', baseValue: 0 }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 30);
            const ema34 = TA.ema(TA.closes(dataList), 34);
            return dataList.map((d, i) => {
                if (i < p) return {};
                const hlc = (d.high + d.low + d.close) / 3;
                const denom = Math.max(0.00001, d.high - d.low);
                const angle = Math.atan((ema34[i] - ema34[Math.max(0, i - 1)]) / denom) * (180 / Math.PI);
                return { cz: hlc >= ema34[i] ? Math.abs(angle) : -Math.abs(angle) };
            });
        },
    });

    // 22. Choppiness Index (CHOP)
    registerIndicator({
        name: 'CHOPPINESS',
        shortName: 'CHOP',
        calcParams: [14],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'chop', title: 'CHOP: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            const tr = TA.trueRange(dataList);
            const hh = TA.highest(TA.highs(dataList), p);
            const ll = TA.lowest(TA.lows(dataList), p);
            return dataList.map((_, i) => {
                if (i < p) return {};
                let sumTr = 0;
                for (let j = i - p + 1; j <= i; j++) sumTr += tr[j];
                const range = Math.max(0.00001, (hh[i] ?? 1) - (ll[i] ?? 0));
                const chop = (100 * Math.log10(sumTr / range)) / Math.log10(p);
                return { chop };
            });
        },
    });

    // 24. Connors RSI (CRSI)
    registerIndicator({
        name: 'CONNORS_RSI',
        shortName: 'CRSI',
        calcParams: [3, 2, 100],
        precision: 2,
        minValue: 0,
        maxValue: 100,
        shouldOhlc: false,
        figures: [{ key: 'crsi', title: 'Connors RSI: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [rsiLen, streakLen, rocLen] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const rsiClose = TA.rsi(closes, rsiLen || 3);
            const streaks: number[] = [0];
            for (let i = 1; i < closes.length; i++) {
                if (closes[i] > closes[i - 1]) {
                    streaks.push(streaks[i - 1] >= 0 ? streaks[i - 1] + 1 : 1);
                } else if (closes[i] < closes[i - 1]) {
                    streaks.push(streaks[i - 1] <= 0 ? streaks[i - 1] - 1 : -1);
                } else {
                    streaks.push(0);
                }
            }
            const rsiStreak = TA.rsi(streaks, streakLen || 2);
            const rLen = Math.max(5, rocLen || 100);
            const rocs = closes.map((c, i) => (i === 0 ? 0 : (c - closes[i - 1]) / closes[i - 1]));

            return closes.map((_, i) => {
                if (i < 5) return {};
                const win = Math.min(i, rLen);
                let countLess = 0;
                for (let j = i - win + 1; j <= i; j++) {
                    if (rocs[j] < rocs[i]) countLess++;
                }
                const pctRank = (countLess / win) * 100;
                return { crsi: (rsiClose[i] + rsiStreak[i] + pctRank) / 3 };
            });
        },
    });

    // 25. Coppock Curve
    registerIndicator({
        name: 'COPPOCK',
        shortName: 'Coppock',
        calcParams: [10, 14, 11],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'coppock', title: 'Coppock: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [wmaLen, r1, r2] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const l1 = Math.max(1, r1 || 14);
            const l2 = Math.max(1, r2 || 11);
            const rocSum = closes.map((c, i) => {
                if (i < Math.max(l1, l2)) return 0;
                const roc1 = ((c - closes[i - l1]) / closes[i - l1]) * 100;
                const roc2 = ((c - closes[i - l2]) / closes[i - l2]) * 100;
                return roc1 + roc2;
            });
            const wma = TA.wma(rocSum, wmaLen || 10);
            return wma.map((coppock) => ({ coppock }));
        },
    });

    // 26. Correlation - Log
    registerIndicator({
        name: 'CORR_LOG',
        shortName: 'Corr-Log',
        calcParams: [20],
        precision: 4,
        shouldOhlc: false,
        figures: [{ key: 'corrLog', title: 'Log Return Corr: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(3, Number((indicator.calcParams as number[])[0]) || 20);
            const logs = dataList.map((d, i) =>
                i === 0 ? 0 : Math.log(Math.max(0.00001, d.close / dataList[i - 1].close))
            );
            return logs.map((_, i) => {
                if (i < p) return {};
                const lin = TA.linreg(logs.slice(0, i + 1), p)[i];
                return { corrLog: (lin.slope || 0) * 100 };
            });
        },
    });

    // 27. Correlation Coefficient (Price vs Time/Volume Trend)
    registerIndicator({
        name: 'CORR_COEFF',
        shortName: 'CC',
        calcParams: [20],
        precision: 3,
        minValue: -1,
        maxValue: 1,
        shouldOhlc: false,
        figures: [{ key: 'cc', title: 'Corr Coeff: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(3, Number((indicator.calcParams as number[])[0]) || 20);
            const closes = TA.closes(dataList);
            return closes.map((_, i) => {
                if (i < p - 1) return {};
                let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
                for (let j = 0; j < p; j++) {
                    const x = j;
                    const y = closes[i - p + 1 + j];
                    sumX += x;
                    sumY += y;
                    sumXY += x * y;
                    sumX2 += x * x;
                    sumY2 += y * y;
                }
                const num = p * sumXY - sumX * sumY;
                const den = Math.sqrt((p * sumX2 - sumX * sumX) * Math.max(0, p * sumY2 - sumY * sumY));
                return { cc: den === 0 ? 0 : num / den };
            });
        },
    });

    // 28. Detrended Price Oscillator (DPO)
    registerIndicator({
        name: 'DPO',
        shortName: 'DPO',
        calcParams: [21],
        precision: 4,
        shouldOhlc: false,
        figures: [{ key: 'dpo', title: 'DPO: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 21);
            const closes = TA.closes(dataList);
            const sma = TA.sma(closes, p);
            const shift = Math.floor(p / 2) + 1;
            return closes.map((c, i) => {
                const idx = Math.max(0, i - shift);
                return sma[idx] !== undefined ? { dpo: c - sma[idx]! } : {};
            });
        },
    });

    // 30. Donchian Channels
    registerIndicator({
        name: 'DONCHIAN',
        shortName: 'Donchian',
        calcParams: [20],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'high', title: 'Upper: ', type: 'line' },
            { key: 'mid', title: 'Basis: ', type: 'line' },
            { key: 'low', title: 'Lower: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            const hh = TA.highest(TA.highs(dataList), p);
            const ll = TA.lowest(TA.lows(dataList), p);
            return dataList.map((_, i) =>
                i < p - 1 ? {} : { high: hh[i], mid: ((hh[i] || 0) + (ll[i] || 0)) / 2, low: ll[i] }
            );
        },
    });

    // 31. Double EMA (DEMA = 2*EMA - EMA(EMA))
    registerIndicator({
        name: 'DEMA',
        shortName: 'DEMA',
        calcParams: [20, 50],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'dema1', title: 'DEMA1: ', type: 'line' },
            { key: 'dema2', title: 'DEMA2: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p1, p2] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const calcDema = (len: number) => {
                const e1 = TA.ema(closes, len);
                const e2 = TA.ema(e1, len);
                return e1.map((v, i) => 2 * v - e2[i]);
            };
            const d1 = calcDema(p1 || 20);
            const d2 = calcDema(p2 || 50);
            return dataList.map((_, i) => ({ dema1: d1[i], dema2: d2[i] }));
        },
    });

    // 33. Elder's Force Index (EFI)
    registerIndicator({
        name: 'EFI',
        shortName: 'EFI',
        calcParams: [13],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'efi', title: 'EFI: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(1, Number((indicator.calcParams as number[])[0]) || 13);
            const raw = dataList.map((d, i) =>
                i === 0 ? 0 : (d.close - dataList[i - 1].close) * Math.max(1, d.volume || 1)
            );
            const ema = TA.ema(raw, p);
            return ema.map((efi) => ({ efi }));
        },
    });

    // 34. EMA Cross
    registerIndicator({
        name: 'EMA_CROSS',
        shortName: 'EMA Cross',
        calcParams: [9, 21],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'fast', title: 'EMA Fast: ', type: 'line' },
            { key: 'slow', title: 'EMA Slow: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [f, s] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const fast = TA.ema(closes, f || 9);
            const slow = TA.ema(closes, s || 21);
            return dataList.map((_, i) => ({ fast: fast[i], slow: slow[i] }));
        },
    });

    // 35. Envelopes
    registerIndicator({
        name: 'ENVELOPES',
        shortName: 'Env',
        calcParams: [20, 0.5],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'upper', title: 'Upper: ', type: 'line' },
            { key: 'basis', title: 'Basis: ', type: 'line' },
            { key: 'lower', title: 'Lower: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p, pct] = indicator.calcParams as number[];
            const sma = TA.sma(TA.closes(dataList), p || 20);
            const k = (pct || 0.5) / 100;
            return sma.map((b) =>
                b === undefined ? {} : { upper: b * (1 + k), basis: b, lower: b * (1 - k) }
            );
        },
    });

    // 36. Fisher Transform
    registerIndicator({
        name: 'FISHER',
        shortName: 'Fisher',
        calcParams: [9],
        precision: 3,
        shouldOhlc: false,
        figures: [
            { key: 'fisher', title: 'Fisher: ', type: 'line' },
            { key: 'trigger', title: 'Trigger: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 9);
            const hl2 = TA.hl2(dataList);
            const hh = TA.highest(hl2, p);
            const ll = TA.lowest(hl2, p);
            let val = 0;
            let fish = 0;
            return hl2.map((v, i) => {
                const maxH = hh[i] ?? v;
                const minL = ll[i] ?? v;
                const raw = maxH === minL ? 0 : 2 * ((v - minL) / (maxH - minL) - 0.5);
                val = Math.max(-0.999, Math.min(0.999, 0.33 * raw + 0.67 * val));
                const prevFish = fish;
                fish = 0.5 * Math.log((1 + val) / (1 - val)) + 0.5 * prevFish;
                return { fisher: fish, trigger: prevFish };
            });
        },
    });

    // 37. Guppy Multiple Moving Average (GMMA)
    registerIndicator({
        name: 'GMMA',
        shortName: 'GMMA',
        calcParams: [3, 8, 15, 30, 45, 60],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 's1', title: 'S1: ', type: 'line' },
            { key: 's2', title: 'S2: ', type: 'line' },
            { key: 's3', title: 'S3: ', type: 'line' },
            { key: 'l1', title: 'L1: ', type: 'line' },
            { key: 'l2', title: 'L2: ', type: 'line' },
            { key: 'l3', title: 'L3: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const params = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const [s1, s2, s3, l1, l2, l3] = [
                TA.ema(closes, params[0] || 3),
                TA.ema(closes, params[1] || 8),
                TA.ema(closes, params[2] || 15),
                TA.ema(closes, params[3] || 30),
                TA.ema(closes, params[4] || 45),
                TA.ema(closes, params[5] || 60),
            ];
            return dataList.map((_, i) => ({
                s1: s1[i],
                s2: s2[i],
                s3: s3[i],
                l1: l1[i],
                l2: l2[i],
                l3: l3[i],
            }));
        },
    });

    // 38. Historical Volatility (HV)
    registerIndicator({
        name: 'HIST_VOL',
        shortName: 'HV',
        calcParams: [20],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'hv', title: 'HV: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            const logRets = dataList.map((d, i) =>
                i === 0 ? 0 : Math.log(Math.max(0.00001, d.close / dataList[i - 1].close))
            );
            const std = TA.stdDev(logRets, p);
            return std.map((s) => (s === undefined ? {} : { hv: s * Math.sqrt(252) * 100 }));
        },
    });

    // 39. Hull Moving Average (HMA)
    registerIndicator({
        name: 'HMA',
        shortName: 'HMA',
        calcParams: [16, 55],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'hma1', title: 'HMA1: ', type: 'line' },
            { key: 'hma2', title: 'HMA2: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p1, p2] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const h1 = TA.hma(closes, p1 || 16);
            const h2 = TA.hma(closes, p2 || 55);
            return dataList.map((_, i) => ({ hma1: h1[i], hma2: h2[i] }));
        },
    });

    // 40. Ichimoku Cloud
    registerIndicator({
        name: 'ICHIMOKU',
        shortName: 'Ichimoku',
        calcParams: [9, 26, 52],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'tenkan', title: 'Tenkan: ', type: 'line' },
            { key: 'kijun', title: 'Kijun: ', type: 'line' },
            { key: 'spanA', title: 'Senkou A: ', type: 'line' },
            { key: 'spanB', title: 'Senkou B: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [pT, pK, pB] = indicator.calcParams as number[];
            const highs = TA.highs(dataList);
            const lows = TA.lows(dataList);
            const hhT = TA.highest(highs, pT || 9);
            const llT = TA.lowest(lows, pT || 9);
            const hhK = TA.highest(highs, pK || 26);
            const llK = TA.lowest(lows, pK || 26);
            const hhB = TA.highest(highs, pB || 52);
            const llB = TA.lowest(lows, pB || 52);
            return dataList.map((_, i) => {
                const tenkan = ((hhT[i] || 0) + (llT[i] || 0)) / 2;
                const kijun = ((hhK[i] || 0) + (llK[i] || 0)) / 2;
                const spanA = (tenkan + kijun) / 2;
                const spanB = ((hhB[i] || 0) + (llB[i] || 0)) / 2;
                return { tenkan, kijun, spanA, spanB };
            });
        },
    });

    // 41. Keltner Channels
    registerIndicator({
        name: 'KELTNER',
        shortName: 'KC',
        calcParams: [20, 10, 2],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'up', title: 'KC Upper: ', type: 'line' },
            { key: 'mid', title: 'KC Mid: ', type: 'line' },
            { key: 'dn', title: 'KC Lower: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [emaP, atrP, mult] = indicator.calcParams as number[];
            const ema = TA.ema(TA.closes(dataList), emaP || 20);
            const atr = TA.atr(dataList, atrP || 10);
            const m = mult || 2;
            return dataList.map((_, i) => ({
                up: ema[i] + m * atr[i],
                mid: ema[i],
                dn: ema[i] - m * atr[i],
            }));
        },
    });

    // 42. Klinger Oscillator
    registerIndicator({
        name: 'KLINGER',
        shortName: 'KVO',
        calcParams: [34, 55, 13],
        precision: 2,
        shouldOhlc: false,
        figures: [
            { key: 'kvo', title: 'KVO: ', type: 'line' },
            { key: 'sig', title: 'Signal: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [f, s, sigLen] = indicator.calcParams as number[];
            const hlc = TA.hlc3(dataList);
            const vf = dataList.map((d, i) => {
                const sv = i > 0 && hlc[i] >= hlc[i - 1] ? 1 : -1;
                return Math.max(1, d.volume || 1) * sv;
            });
            const eF = TA.ema(vf, f || 34);
            const eS = TA.ema(vf, s || 55);
            const kvo = eF.map((v, i) => v - eS[i]);
            const sig = TA.ema(kvo, sigLen || 13);
            return dataList.map((_, i) => ({ kvo: kvo[i], sig: sig[i] }));
        },
    });

    // 43. Know Sure Thing (KST)
    registerIndicator({
        name: 'KST',
        shortName: 'KST',
        calcParams: [10, 15, 20, 30],
        precision: 2,
        shouldOhlc: false,
        figures: [
            { key: 'kst', title: 'KST: ', type: 'line' },
            { key: 'sig', title: 'Signal: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [r1, r2, r3, r4] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const roc = (len: number) =>
                closes.map((c, i) => (i < len ? 0 : ((c - closes[i - len]) / closes[i - len]) * 100));
            const rc1 = TA.sma(roc(r1 || 10), 10);
            const rc2 = TA.sma(roc(r2 || 15), 10);
            const rc3 = TA.sma(roc(r3 || 20), 10);
            const rc4 = TA.sma(roc(r4 || 30), 15);
            const kst = closes.map(
                (_, i) => (rc1[i] || 0) * 1 + (rc2[i] || 0) * 2 + (rc3[i] || 0) * 3 + (rc4[i] || 0) * 4
            );
            const sig = TA.sma(kst, 9);
            return dataList.map((_, i) => ({ kst: kst[i], sig: sig[i] }));
        },
    });

    // 44. Least Squares Moving Average (LSMA)
    registerIndicator({
        name: 'LSMA',
        shortName: 'LSMA',
        calcParams: [25],
        precision: 4,
        shouldOhlc: true,
        figures: [{ key: 'lsma', title: 'LSMA: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 25);
            return TA.linreg(TA.closes(dataList), p).map((r) => ({ lsma: r.value }));
        },
    });

    // 45. Linear Regression Curve
    registerIndicator({
        name: 'LINREG_CURVE',
        shortName: 'LinReg',
        calcParams: [14],
        precision: 4,
        shouldOhlc: true,
        figures: [{ key: 'lrc', title: 'LinReg Curve: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            return TA.linreg(TA.closes(dataList), p).map((r) => ({ lrc: r.value }));
        },
    });

    // 46. Linear Regression Slope
    registerIndicator({
        name: 'LINREG_SLOPE',
        shortName: 'LR Slope',
        calcParams: [14],
        precision: 5,
        shouldOhlc: false,
        figures: [{ key: 'slope', title: 'Slope: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            return TA.linreg(TA.closes(dataList), p).map((r) => ({ slope: r.slope }));
        },
    });

    // 47. MA Cross
    registerIndicator({
        name: 'MA_CROSS',
        shortName: 'MA Cross',
        calcParams: [9, 21],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'fast', title: 'MA Fast: ', type: 'line' },
            { key: 'slow', title: 'MA Slow: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [f, s] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const fast = TA.sma(closes, f || 9);
            const slow = TA.sma(closes, s || 21);
            return dataList.map((_, i) => ({ fast: fast[i], slow: slow[i] }));
        },
    });

    // 48. MA with EMA Cross
    registerIndicator({
        name: 'MA_EMA_CROSS',
        shortName: 'MA/EMA Cross',
        calcParams: [20, 20],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'ma', title: 'SMA: ', type: 'line' },
            { key: 'ema', title: 'EMA: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [mP, eP] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const ma = TA.sma(closes, mP || 20);
            const ema = TA.ema(closes, eP || 20);
            return dataList.map((_, i) => ({ ma: ma[i], ema: ema[i] }));
        },
    });

    // 50. Majority Rule
    registerIndicator({
        name: 'MAJORITY_RULE',
        shortName: 'MajRule',
        calcParams: [14],
        precision: 1,
        minValue: 0,
        maxValue: 100,
        shouldOhlc: false,
        figures: [{ key: 'mr', title: 'Majority %: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            return dataList.map((_, i) => {
                if (i < p) return {};
                let up = 0;
                for (let j = i - p + 1; j <= i; j++) {
                    if (dataList[j].close >= dataList[j - 1].close) up++;
                }
                return { mr: (up / p) * 100 };
            });
        },
    });

    // 51. Mass Index
    registerIndicator({
        name: 'MASS_INDEX',
        shortName: 'MassIdx',
        calcParams: [9, 25],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'mi', title: 'Mass Index: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [emaP, sumP] = indicator.calcParams as number[];
            const hl = dataList.map((d) => Math.max(0.00001, d.high - d.low));
            const e1 = TA.ema(hl, emaP || 9);
            const e2 = TA.ema(e1, emaP || 9);
            const ratio = e1.map((v, i) => v / Math.max(0.00001, e2[i]));
            const sp = Math.max(2, sumP || 25);
            return ratio.map((_, i) => {
                if (i < sp - 1) return {};
                let sum = 0;
                for (let j = i - sp + 1; j <= i; j++) sum += ratio[j];
                return { mi: sum };
            });
        },
    });

    // 52. McGinley Dynamic
    registerIndicator({
        name: 'MCGINLEY',
        shortName: 'McGinley',
        calcParams: [14],
        precision: 4,
        shouldOhlc: true,
        figures: [{ key: 'md', title: 'McGinley: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            let md = dataList[0]?.close || 0;
            return dataList.map((d, i) => {
                if (i === 0 || md === 0) {
                    md = d.close;
                } else {
                    const ratio = Math.max(0.2, Math.min(5, d.close / md));
                    md = md + (d.close - md) / (p * Math.pow(ratio, 4));
                }
                return { md };
            });
        },
    });

    // 53. Median Price
    registerIndicator({
        name: 'MEDIAN_PRICE',
        shortName: 'MedPrice',
        calcParams: [14],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'mp', title: 'Median (HL/2): ', type: 'line' },
            { key: 'ema', title: 'EMA: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(1, Number((indicator.calcParams as number[])[0]) || 14);
            const hl2 = TA.hl2(dataList);
            const ema = TA.ema(hl2, p);
            return hl2.map((mp, i) => ({ mp, ema: ema[i] }));
        },
    });

    // 55. Money Flow Index (MFI)
    registerIndicator({
        name: 'MFI',
        shortName: 'MFI',
        calcParams: [14],
        precision: 2,
        minValue: 0,
        maxValue: 100,
        shouldOhlc: false,
        figures: [{ key: 'mfi', title: 'MFI: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const period = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            const tpList = TA.hlc3(dataList);
            return dataList.map((_, i) => {
                if (i < period) return {};
                let posFlow = 0;
                let negFlow = 0;
                for (let j = i - period + 1; j <= i; j++) {
                    const rawFlow = tpList[j] * Math.max(1, dataList[j].volume || 1);
                    if (tpList[j] >= tpList[j - 1]) posFlow += rawFlow;
                    else negFlow += rawFlow;
                }
                const mfi = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
                return { mfi };
            });
        },
    });

    // 57. Moving Average Adaptive (KAMA)
    registerIndicator({
        name: 'KAMA',
        shortName: 'KAMA',
        calcParams: [10, 2, 30],
        precision: 4,
        shouldOhlc: true,
        figures: [{ key: 'kama', title: 'KAMA: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [erLen, fastP, slowP] = indicator.calcParams as number[];
            const p = Math.max(2, erLen || 10);
            const fastSC = 2 / ((fastP || 2) + 1);
            const slowSC = 2 / ((slowP || 30) + 1);
            const closes = TA.closes(dataList);
            let kama = closes[0] || 0;
            return closes.map((c, i) => {
                if (i < p) {
                    kama = c;
                    return { kama };
                }
                const change = Math.abs(c - closes[i - p]);
                let vol = 0;
                for (let j = i - p + 1; j <= i; j++) vol += Math.abs(closes[j] - closes[j - 1]);
                const er = vol === 0 ? 0 : change / vol;
                const sc = Math.pow(er * (fastSC - slowSC) + slowSC, 2);
                kama = kama + sc * (c - kama);
                return { kama };
            });
        },
    });

    // 58. Moving Average Channel
    registerIndicator({
        name: 'MA_CHANNEL',
        shortName: 'MA Chan',
        calcParams: [20],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'upper', title: 'SMA High: ', type: 'line' },
            { key: 'lower', title: 'SMA Low: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            const up = TA.sma(TA.highs(dataList), p);
            const dn = TA.sma(TA.lows(dataList), p);
            return dataList.map((_, i) => ({ upper: up[i], lower: dn[i] }));
        },
    });

    // 59. Moving Average Double
    registerIndicator({
        name: 'MA_DOUBLE',
        shortName: 'MA Double',
        calcParams: [10, 21],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'ma1', title: 'MA1: ', type: 'line' },
            { key: 'ma2', title: 'MA2: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p1, p2] = indicator.calcParams as number[];
            const closes = TA.closes(dataList);
            const m1 = TA.sma(closes, p1 || 10);
            const m2 = TA.sma(closes, p2 || 21);
            return dataList.map((_, i) => ({ ma1: m1[i], ma2: m2[i] }));
        },
    });

    // 61. Moving Average Hamming
    registerIndicator({
        name: 'MA_HAMMING',
        shortName: 'Hamming MA',
        calcParams: [14],
        precision: 4,
        shouldOhlc: true,
        figures: [{ key: 'hma', title: 'Hamming MA: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(3, Number((indicator.calcParams as number[])[0]) || 14);
            const closes = TA.closes(dataList);
            const weights: number[] = [];
            let wSum = 0;
            for (let i = 0; i < p; i++) {
                const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (p - 1));
                weights.push(w);
                wSum += w;
            }
            return closes.map((_, idx) => {
                if (idx < p - 1) return {};
                let acc = 0;
                for (let j = 0; j < p; j++) acc += closes[idx - p + 1 + j] * weights[j];
                return { hma: acc / wSum };
            });
        },
    });

    // 62. Moving Average Multiple
    registerIndicator({
        name: 'MA_MULTIPLE',
        shortName: 'MA Multi',
        calcParams: [10, 20, 30, 50, 100, 200],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'm1', title: 'M1: ', type: 'line' },
            { key: 'm2', title: 'M2: ', type: 'line' },
            { key: 'm3', title: 'M3: ', type: 'line' },
            { key: 'm4', title: 'M4: ', type: 'line' },
            { key: 'm5', title: 'M5: ', type: 'line' },
            { key: 'm6', title: 'M6: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = indicator.calcParams as number[];
            const c = TA.closes(dataList);
            const [m1, m2, m3, m4, m5, m6] = [
                TA.sma(c, p[0] || 10),
                TA.sma(c, p[1] || 20),
                TA.sma(c, p[2] || 30),
                TA.sma(c, p[3] || 50),
                TA.sma(c, p[4] || 100),
                TA.sma(c, p[5] || 200),
            ];
            return dataList.map((_, i) => ({
                m1: m1[i],
                m2: m2[i],
                m3: m3[i],
                m4: m4[i],
                m5: m5[i],
                m6: m6[i],
            }));
        },
    });

    // 63. Moving Average Triple
    registerIndicator({
        name: 'MA_TRIPLE',
        shortName: 'MA Triple',
        calcParams: [9, 21, 55],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'ma1', title: 'MA1: ', type: 'line' },
            { key: 'ma2', title: 'MA2: ', type: 'line' },
            { key: 'ma3', title: 'MA3: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p1, p2, p3] = indicator.calcParams as number[];
            const c = TA.closes(dataList);
            const [m1, m2, m3] = [TA.sma(c, p1 || 9), TA.sma(c, p2 || 21), TA.sma(c, p3 || 55)];
            return dataList.map((_, i) => ({ ma1: m1[i], ma2: m2[i], ma3: m3[i] }));
        },
    });

    // 64. Moving Average Weighted (WMA)
    registerIndicator({
        name: 'WMA',
        shortName: 'WMA',
        calcParams: [20, 50],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'wma1', title: 'WMA1: ', type: 'line' },
            { key: 'wma2', title: 'WMA2: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p1, p2] = indicator.calcParams as number[];
            const c = TA.closes(dataList);
            const w1 = TA.wma(c, p1 || 20);
            const w2 = TA.wma(c, p2 || 50);
            return dataList.map((_, i) => ({ wma1: w1[i], wma2: w2[i] }));
        },
    });

    // 65. Net Volume
    registerIndicator({
        name: 'NET_VOLUME',
        shortName: 'NetVol',
        calcParams: [14],
        precision: 0,
        shouldOhlc: false,
        figures: [{ key: 'nv', title: 'Net Vol: ', type: 'bar', baseValue: 0 }],
        calc: (dataList: KLineData[]) => {
            return dataList.map((d) => {
                const v = Math.max(1, d.volume || 1);
                return { nv: d.close >= d.open ? v : -v };
            });
        },
    });

    // 68. Pivot Points Standard
    registerIndicator({
        name: 'PIVOT_STANDARD',
        shortName: 'Pivots',
        calcParams: [15],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'r1', title: 'R1: ', type: 'line' },
            { key: 'p', title: 'P: ', type: 'line' },
            { key: 's1', title: 'S1: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const lb = Math.max(2, Number((indicator.calcParams as number[])[0]) || 15);
            const hh = TA.highest(TA.highs(dataList), lb);
            const ll = TA.lowest(TA.lows(dataList), lb);
            return dataList.map((d, i) => {
                const h = hh[i] ?? d.high;
                const l = ll[i] ?? d.low;
                const p = (h + l + d.close) / 3;
                return { r1: 2 * p - l, p, s1: 2 * p - h };
            });
        },
    });

    // 69. Price Channel
    registerIndicator({
        name: 'PRICE_CHANNEL',
        shortName: 'PriceChan',
        calcParams: [20],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'upper', title: 'Upper: ', type: 'line' },
            { key: 'lower', title: 'Lower: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            const hh = TA.highest(TA.highs(dataList), p);
            const ll = TA.lowest(TA.lows(dataList), p);
            return dataList.map((_, i) => ({ upper: hh[i], lower: ll[i] }));
        },
    });

    // 70. Price Oscillator (PPO)
    registerIndicator({
        name: 'PPO',
        shortName: 'PPO',
        calcParams: [12, 26, 9],
        precision: 2,
        shouldOhlc: false,
        figures: [
            { key: 'ppo', title: 'PPO %: ', type: 'line' },
            { key: 'sig', title: 'Signal: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [f, s, sigP] = indicator.calcParams as number[];
            const c = TA.closes(dataList);
            const ef = TA.ema(c, f || 12);
            const es = TA.ema(c, s || 26);
            const ppo = ef.map((v, i) => (es[i] === 0 ? 0 : ((v - es[i]) / es[i]) * 100));
            const sig = TA.ema(ppo, sigP || 9);
            return dataList.map((_, i) => ({ ppo: ppo[i], sig: sig[i] }));
        },
    });

    // 72. Rank Correlation Index (RCI)
    registerIndicator({
        name: 'RCI',
        shortName: 'RCI',
        calcParams: [9, 26],
        precision: 2,
        minValue: -100,
        maxValue: 100,
        shouldOhlc: false,
        figures: [
            { key: 'rciShort', title: 'RCI Short: ', type: 'line' },
            { key: 'rciLong', title: 'RCI Long: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p1, p2] = indicator.calcParams as number[];
            const c = TA.closes(dataList);
            const calcRci = (idx: number, len: number) => {
                if (idx < len - 1) return undefined;
                const slice = c.slice(idx - len + 1, idx + 1);
                const sorted = [...slice].sort((a, b) => b - a);
                let dSum = 0;
                for (let j = 0; j < len; j++) {
                    const timeRank = len - j;
                    const priceRank = sorted.indexOf(slice[j]) + 1;
                    const diff = timeRank - priceRank;
                    dSum += diff * diff;
                }
                return (1 - (6 * dSum) / (len * (len * len - 1))) * 100;
            };
            return dataList.map((_, i) => ({
                rciShort: calcRci(i, Math.max(2, p1 || 9)),
                rciLong: calcRci(i, Math.max(2, p2 || 26)),
            }));
        },
    });

    // 74. Ratio (Close / SMA)
    registerIndicator({
        name: 'RATIO',
        shortName: 'Ratio',
        calcParams: [20],
        precision: 4,
        shouldOhlc: false,
        figures: [{ key: 'ratio', title: 'Price/SMA Ratio: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            const c = TA.closes(dataList);
            const sma = TA.sma(c, p);
            return c.map((v, i) => (sma[i] ? { ratio: v / sma[i]! } : {}));
        },
    });

    // 76. Relative Vigor Index (RVI)
    registerIndicator({
        name: 'RVI_VIGOR',
        shortName: 'RVI',
        calcParams: [10],
        precision: 4,
        shouldOhlc: false,
        figures: [
            { key: 'rvi', title: 'RVI: ', type: 'line' },
            { key: 'sig', title: 'Signal: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 10);
            const num = dataList.map((d) => d.close - d.open);
            const den = dataList.map((d) => Math.max(0.00001, d.high - d.low));
            const sNum = TA.sma(num, p);
            const sDen = TA.sma(den, p);
            const rvi = dataList.map((_, i) =>
                sNum[i] !== undefined && sDen[i] ? sNum[i]! / sDen[i]! : 0
            );
            const sig = TA.sma(rvi, 4);
            return dataList.map((_, i) => ({ rvi: rvi[i], sig: sig[i] }));
        },
    });

    // 77. Relative Volatility Index
    registerIndicator({
        name: 'RVI_VOL',
        shortName: 'RVI Vol',
        calcParams: [14],
        precision: 2,
        minValue: 0,
        maxValue: 100,
        shouldOhlc: false,
        figures: [{ key: 'rviv', title: 'RVI Vol: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            const c = TA.closes(dataList);
            const std = TA.stdDev(c, 10).map((v) => v || 0);
            const up = c.map((v, i) => (i > 0 && v >= c[i - 1] ? std[i] : 0));
            const dn = c.map((v, i) => (i > 0 && v < c[i - 1] ? std[i] : 0));
            const uAvg = TA.rma(up, p);
            const dAvg = TA.rma(dn, p);
            return c.map((_, i) => {
                const tot = uAvg[i] + dAvg[i];
                return { rviv: tot === 0 ? 50 : (100 * uAvg[i]) / tot };
            });
        },
    });

    // 78. SMI Ergodic Indicator/Oscillator
    registerIndicator({
        name: 'SMI_ERGODIC',
        shortName: 'SMIIO',
        calcParams: [5, 20, 5],
        precision: 4,
        shouldOhlc: false,
        figures: [
            { key: 'smi', title: 'SMI: ', type: 'line' },
            { key: 'sig', title: 'Signal: ', type: 'line' },
            { key: 'osc', title: 'Osc: ', type: 'bar', baseValue: 0 },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [sP, lP, sigP] = indicator.calcParams as number[];
            const c = TA.closes(dataList);
            const pc = c.map((v, i) => (i === 0 ? 0 : v - c[i - 1]));
            const absPc = pc.map((v) => Math.abs(v));
            const dsPc = TA.ema(TA.ema(pc, lP || 20), sP || 5);
            const dsAbs = TA.ema(TA.ema(absPc, lP || 20), sP || 5);
            const smi = dsPc.map((v, i) => (dsAbs[i] === 0 ? 0 : v / dsAbs[i]));
            const sig = TA.ema(smi, sigP || 5);
            return smi.map((v, i) => ({ smi: v, sig: sig[i], osc: v - sig[i] }));
        },
    });

    // 79. Smoothed Moving Average (SMMA)
    registerIndicator({
        name: 'SMMA',
        shortName: 'SMMA',
        calcParams: [14, 50],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'smma1', title: 'SMMA1: ', type: 'line' },
            { key: 'smma2', title: 'SMMA2: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p1, p2] = indicator.calcParams as number[];
            const c = TA.closes(dataList);
            const s1 = TA.rma(c, p1 || 14);
            const s2 = TA.rma(c, p2 || 50);
            return dataList.map((_, i) => ({ smma1: s1[i], smma2: s2[i] }));
        },
    });

    // 80. Spread (High - Low)
    registerIndicator({
        name: 'SPREAD',
        shortName: 'Spread',
        calcParams: [14],
        precision: 5,
        shouldOhlc: false,
        figures: [
            { key: 'spread', title: 'H-L Spread: ', type: 'bar', baseValue: 0 },
            { key: 'avg', title: 'Avg: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            const sp = dataList.map((d) => d.high - d.low);
            const avg = TA.sma(sp, p);
            return sp.map((v, i) => ({ spread: v, avg: avg[i] }));
        },
    });

    // 81. Standard Deviation
    registerIndicator({
        name: 'STDDEV',
        shortName: 'StdDev',
        calcParams: [20],
        precision: 5,
        shouldOhlc: false,
        figures: [{ key: 'std', title: 'StdDev: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            return TA.stdDev(TA.closes(dataList), p).map((std) => ({ std }));
        },
    });

    // 82. Standard Error
    registerIndicator({
        name: 'STDERR',
        shortName: 'StdErr',
        calcParams: [20],
        precision: 5,
        shouldOhlc: false,
        figures: [{ key: 'se', title: 'StdErr: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(3, Number((indicator.calcParams as number[])[0]) || 20);
            return TA.linreg(TA.closes(dataList), p).map((r) => ({ se: r.stdErr }));
        },
    });

    // 83. Standard Error Bands
    registerIndicator({
        name: 'STDERR_BANDS',
        shortName: 'SE Bands',
        calcParams: [21, 2],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'upper', title: 'SE Upper: ', type: 'line' },
            { key: 'mid', title: 'LinReg: ', type: 'line' },
            { key: 'lower', title: 'SE Lower: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p, mult] = indicator.calcParams as number[];
            const m = mult || 2;
            return TA.linreg(TA.closes(dataList), Math.max(3, p || 21)).map((r) =>
                r.value === undefined || r.stdErr === undefined
                    ? {}
                    : {
                          upper: r.value + m * r.stdErr,
                          mid: r.value,
                          lower: r.value - m * r.stdErr,
                      }
            );
        },
    });

    // 85. Stochastic RSI
    registerIndicator({
        name: 'STOCH_RSI',
        shortName: 'StochRSI',
        calcParams: [14, 14, 3, 3],
        precision: 2,
        minValue: 0,
        maxValue: 100,
        shouldOhlc: false,
        figures: [
            { key: 'k', title: '%K: ', type: 'line' },
            { key: 'd', title: '%D: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [rsiLen, stochLen, sK, sD] = indicator.calcParams as number[];
            const rsi = TA.rsi(TA.closes(dataList), rsiLen || 14);
            const hh = TA.highest(rsi, stochLen || 14);
            const ll = TA.lowest(rsi, stochLen || 14);
            const raw = rsi.map((v, i) => {
                const h = hh[i] ?? 100;
                const l = ll[i] ?? 0;
                return h === l ? 50 : ((v - l) / (h - l)) * 100;
            });
            const k = TA.sma(raw, sK || 3).map((v) => v ?? 50);
            const d = TA.sma(k, sD || 3);
            return dataList.map((_, i) => ({ k: k[i], d: d[i] }));
        },
    });

    // 86. SuperTrend
    registerIndicator({
        name: 'SUPERTREND',
        shortName: 'SuperTrend',
        calcParams: [10, 3],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'up', title: 'Bull Trend: ', type: 'line' },
            { key: 'dn', title: 'Bear Trend: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p, mult] = indicator.calcParams as number[];
            const period = Math.max(2, p || 10);
            const multiplier = mult || 3;
            const atr = TA.atr(dataList, period);
            let finalUpper = 0;
            let finalLower = 0;
            let trend = 1;
            return dataList.map((cur, i) => {
                const hl2 = (cur.high + cur.low) / 2;
                const basicUpper = hl2 + multiplier * atr[i];
                const basicLower = hl2 - multiplier * atr[i];
                if (i === 0) {
                    finalUpper = basicUpper;
                    finalLower = basicLower;
                } else {
                    const prevClose = dataList[i - 1].close;
                    finalUpper =
                        basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
                    finalLower =
                        basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;
                    if (trend === -1 && cur.close > finalUpper) trend = 1;
                    else if (trend === 1 && cur.close < finalLower) trend = -1;
                }
                return trend === 1 ? { up: finalLower } : { dn: finalUpper };
            });
        },
    });

    // 87. Trading Sessions (Asia / London / NY High-Low Equilibriums)
    registerIndicator({
        name: 'TRADING_SESSIONS',
        shortName: 'Sessions',
        calcParams: [8, 13, 21],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'sessionHigh', title: 'Session High: ', type: 'line' },
            { key: 'sessionLow', title: 'Session Low: ', type: 'line' },
        ],
        calc: (dataList: KLineData[]) => {
            let sHigh = -Infinity;
            let sLow = Infinity;
            let curBlock = -1;
            return dataList.map((d) => {
                const hr = new Date(d.timestamp).getUTCHours();
                const block = hr < 8 ? 0 : hr < 13 ? 1 : 2;
                if (block !== curBlock) {
                    curBlock = block;
                    sHigh = d.high;
                    sLow = d.low;
                } else {
                    if (d.high > sHigh) sHigh = d.high;
                    if (d.low < sLow) sLow = d.low;
                }
                return { sessionHigh: sHigh, sessionLow: sLow };
            });
        },
    });

    // 88. Trading Sessions Background (Session Activity Pulse)
    registerIndicator({
        name: 'TRADING_SESSIONS_BG',
        shortName: 'SessPulse',
        calcParams: [8, 13, 21],
        precision: 0,
        shouldOhlc: false,
        figures: [{ key: 'session', title: 'Session (1=Asia, 2=Lon, 3=NY): ', type: 'bar', baseValue: 0 }],
        calc: (dataList: KLineData[]) => {
            return dataList.map((d) => {
                const hr = new Date(d.timestamp).getUTCHours();
                const session = hr >= 13 && hr < 21 ? 3 : hr >= 7 && hr < 16 ? 2 : 1;
                return { session };
            });
        },
    });

    // 89. Trend Strength Index
    registerIndicator({
        name: 'TSI_TREND',
        shortName: 'TrendIdx',
        calcParams: [14],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'tsi', title: 'Trend Strength: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(3, Number((indicator.calcParams as number[])[0]) || 14);
            const c = TA.closes(dataList);
            const atr = TA.atr(dataList, p);
            return c.map((v, i) =>
                i < p ? {} : { tsi: (v - c[i - p]) / Math.max(0.00001, atr[i] * Math.sqrt(p)) }
            );
        },
    });

    // 90. Triple EMA (TEMA = 3*EMA1 - 3*EMA2 + EMA3)
    registerIndicator({
        name: 'TEMA',
        shortName: 'TEMA',
        calcParams: [20],
        precision: 4,
        shouldOhlc: true,
        figures: [{ key: 'tema', title: 'TEMA: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            const e1 = TA.ema(TA.closes(dataList), p);
            const e2 = TA.ema(e1, p);
            const e3 = TA.ema(e2, p);
            return e1.map((v, i) => ({ tema: 3 * v - 3 * e2[i] + e3[i] }));
        },
    });

    // 92. True Strength Index (TSI)
    registerIndicator({
        name: 'TSI',
        shortName: 'TSI',
        calcParams: [25, 13, 7],
        precision: 2,
        shouldOhlc: false,
        figures: [
            { key: 'tsi', title: 'TSI: ', type: 'line' },
            { key: 'sig', title: 'Signal: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [lP, sP, sigP] = indicator.calcParams as number[];
            const c = TA.closes(dataList);
            const m = c.map((v, i) => (i === 0 ? 0 : v - c[i - 1]));
            const absM = m.map((v) => Math.abs(v));
            const dsM = TA.ema(TA.ema(m, lP || 25), sP || 13);
            const dsA = TA.ema(TA.ema(absM, lP || 25), sP || 13);
            const tsi = dsM.map((v, i) => (dsA[i] === 0 ? 0 : 100 * (v / dsA[i])));
            const sig = TA.ema(tsi, sigP || 7);
            return tsi.map((v, i) => ({ tsi: v, sig: sig[i] }));
        },
    });

    // 93. Typical Price (HLC/3)
    registerIndicator({
        name: 'TYPICAL_PRICE',
        shortName: 'TypPrice',
        calcParams: [14],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'tp', title: 'HLC/3: ', type: 'line' },
            { key: 'sma', title: 'SMA: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(1, Number((indicator.calcParams as number[])[0]) || 14);
            const tp = TA.hlc3(dataList);
            const sma = TA.sma(tp, p);
            return tp.map((v, i) => ({ tp: v, sma: sma[i] }));
        },
    });

    // 94. Ultimate Oscillator
    registerIndicator({
        name: 'ULTIMATE_OSC',
        shortName: 'UO',
        calcParams: [7, 14, 28],
        precision: 2,
        minValue: 0,
        maxValue: 100,
        shouldOhlc: false,
        figures: [{ key: 'uo', title: 'UO: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [p1, p2, p3] = indicator.calcParams as number[];
            const bp = dataList.map((d, i) =>
                d.close - Math.min(d.low, i > 0 ? dataList[i - 1].close : d.low)
            );
            const tr = TA.trueRange(dataList);
            const avgRatio = (idx: number, len: number) => {
                let sBp = 0;
                let sTr = 0;
                for (let j = Math.max(0, idx - len + 1); j <= idx; j++) {
                    sBp += bp[j];
                    sTr += tr[j];
                }
                return sTr === 0 ? 0 : sBp / sTr;
            };
            return dataList.map((_, i) => {
                if (i < (p3 || 28)) return {};
                const a1 = avgRatio(i, p1 || 7);
                const a2 = avgRatio(i, p2 || 14);
                const a3 = avgRatio(i, p3 || 28);
                return { uo: (100 * (4 * a1 + 2 * a2 + a3)) / 7 };
            });
        },
    });

    // 95. Volatility Close-to-Close
    registerIndicator({
        name: 'VOL_C2C',
        shortName: 'Vol C2C',
        calcParams: [20],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'vc2c', title: 'Vol C2C %: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            const rets = dataList.map((d, i) =>
                i === 0 ? 0 : Math.log(Math.max(0.00001, d.close / dataList[i - 1].close))
            );
            return TA.stdDev(rets, p).map((s) => (s === undefined ? {} : { vc2c: s * Math.sqrt(252) * 100 }));
        },
    });

    // 96. Volatility Index
    registerIndicator({
        name: 'VOL_INDEX',
        shortName: 'VIX Proxy',
        calcParams: [14],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'vix', title: 'Vol Index: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            const atr = TA.atr(dataList, p);
            return dataList.map((d, i) => ({ vix: (atr[i] / Math.max(0.00001, d.close)) * 100 * Math.sqrt(252) }));
        },
    });

    // 97. Volatility O-H-L-C (Garman-Klass)
    registerIndicator({
        name: 'VOL_OHLC',
        shortName: 'Vol OHLC',
        calcParams: [20],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'vohlc', title: 'Vol OHLC %: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            const gk = dataList.map((d) => {
                const hl = Math.log(Math.max(1, d.high / Math.max(0.00001, d.low)));
                const co = Math.log(Math.max(0.00001, d.close / Math.max(0.00001, d.open)));
                return 0.5 * hl * hl - (2 * Math.LN2 - 1) * co * co;
            });
            const smaGk = TA.sma(gk, p);
            return smaGk.map((v) =>
                v === undefined ? {} : { vohlc: Math.sqrt(Math.max(0, v) * 252) * 100 }
            );
        },
    });

    // 98. Volatility Zero Trend Close-to-Close
    registerIndicator({
        name: 'VOL_ZERO_TREND',
        shortName: 'Vol ZeroT',
        calcParams: [20],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'vzt', title: 'Vol ZeroTrend %: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 20);
            const r2 = dataList.map((d, i) => {
                if (i === 0) return 0;
                const r = Math.log(Math.max(0.00001, d.close / dataList[i - 1].close));
                return r * r;
            });
            const meanR2 = TA.sma(r2, p);
            return meanR2.map((v) => (v === undefined ? {} : { vzt: Math.sqrt(v * 252) * 100 }));
        },
    });

    // 100. Volume Oscillator
    registerIndicator({
        name: 'VOL_OSC',
        shortName: 'Vol Osc',
        calcParams: [5, 10],
        precision: 2,
        shouldOhlc: false,
        figures: [{ key: 'vo', title: 'Vol Osc %: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const [f, s] = indicator.calcParams as number[];
            const v = TA.volumes(dataList);
            const ef = TA.ema(v, f || 5);
            const es = TA.ema(v, s || 10);
            return ef.map((vf, i) => ({ vo: ((vf - es[i]) / Math.max(1, es[i])) * 100 }));
        },
    });

    // 101. Volume Profile Fixed Range (POC / VAH / VAL)
    registerIndicator({
        name: 'VPFR',
        shortName: 'VPFR',
        calcParams: [50],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'vah', title: 'VAH (70%): ', type: 'line' },
            { key: 'poc', title: 'POC: ', type: 'line' },
            { key: 'val', title: 'VAL (70%): ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const lb = Math.max(10, Number((indicator.calcParams as number[])[0]) || 50);
            return dataList.map((_, i) => {
                if (i < lb) return {};
                let sumPV = 0;
                let sumV = 0;
                let sumPV2 = 0;
                for (let j = i - lb + 1; j <= i; j++) {
                    const tp = (dataList[j].high + dataList[j].low + dataList[j].close) / 3;
                    const v = Math.max(1, dataList[j].volume || 1);
                    sumPV += tp * v;
                    sumV += v;
                    sumPV2 += tp * tp * v;
                }
                const poc = sumPV / sumV;
                const std = Math.sqrt(Math.max(0, sumPV2 / sumV - poc * poc));
                return { vah: poc + std, poc, val: poc - std };
            });
        },
    });

    // 102. Volume Profile Visible Range (VPVR POC / VAH / VAL)
    registerIndicator({
        name: 'VPVR',
        shortName: 'VPVR',
        calcParams: [100],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'vah', title: 'VPVR High: ', type: 'line' },
            { key: 'poc', title: 'VPVR POC: ', type: 'line' },
            { key: 'val', title: 'VPVR Low: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const lb = Math.max(20, Number((indicator.calcParams as number[])[0]) || 100);
            return dataList.map((_, i) => {
                const start = Math.max(0, i - lb + 1);
                let sumPV = 0;
                let sumV = 0;
                let sumPV2 = 0;
                for (let j = start; j <= i; j++) {
                    const tp = (dataList[j].high + dataList[j].low + dataList[j].close) / 3;
                    const v = Math.max(1, dataList[j].volume || 1);
                    sumPV += tp * v;
                    sumV += v;
                    sumPV2 += tp * tp * v;
                }
                const poc = sumPV / sumV;
                const std = Math.sqrt(Math.max(0, sumPV2 / sumV - poc * poc));
                return { vah: poc + std, poc, val: poc - std };
            });
        },
    });

    // 103. Vortex Indicator (VI+ / VI-)
    registerIndicator({
        name: 'VORTEX',
        shortName: 'Vortex',
        calcParams: [14],
        precision: 3,
        shouldOhlc: false,
        figures: [
            { key: 'vip', title: 'VI+: ', type: 'line' },
            { key: 'vim', title: 'VI-: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const p = Math.max(2, Number((indicator.calcParams as number[])[0]) || 14);
            const tr = TA.trueRange(dataList);
            return dataList.map((_, i) => {
                if (i < p) return {};
                let sumVp = 0;
                let sumVm = 0;
                let sumTr = 0;
                for (let j = i - p + 1; j <= i; j++) {
                    sumVp += Math.abs(dataList[j].high - dataList[j - 1].low);
                    sumVm += Math.abs(dataList[j].low - dataList[j - 1].high);
                    sumTr += tr[j];
                }
                const denom = Math.max(0.00001, sumTr);
                return { vip: sumVp / denom, vim: sumVm / denom };
            });
        },
    });

    // 104. VWAP Institucional
    registerIndicator({
        name: 'VWAP',
        shortName: 'VWAP',
        calcParams: [20, 1.5],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'vwap', title: 'VWAP: ', type: 'line' },
            { key: 'upper', title: 'Upper (+σ): ', type: 'line' },
            { key: 'lower', title: 'Lower (-σ): ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const mult = Number((indicator.calcParams as number[])[1]) || 1.5;
            let cumPV = 0;
            let cumVol = 0;
            let cumPV2 = 0;
            let currentDay = -1;
            return dataList.map((kLineData) => {
                const day = new Date(kLineData.timestamp).getUTCDate();
                if (day !== currentDay) {
                    currentDay = day;
                    cumPV = 0;
                    cumVol = 0;
                    cumPV2 = 0;
                }
                const tp = (kLineData.high + kLineData.low + kLineData.close) / 3;
                const vol = Math.max(1, kLineData.volume || 1);
                cumPV += tp * vol;
                cumVol += vol;
                cumPV2 += tp * tp * vol;
                const vwap = cumPV / cumVol;
                const stdev = Math.sqrt(Math.max(0, cumPV2 / cumVol - vwap * vwap));
                return { vwap, upper: vwap + stdev * mult, lower: vwap - stdev * mult };
            });
        },
    });

    // 105. VWMA (Volume Weighted Moving Average)
    registerIndicator({
        name: 'VWMA',
        shortName: 'VWMA',
        calcParams: [20, 50],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'vwma1', title: 'VWMA1: ', type: 'line' },
            { key: 'vwma2', title: 'VWMA2: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [p1, p2] = indicator.calcParams as number[];
            const calcVwma = (endIdx: number, len: number): number | undefined => {
                if (endIdx < len - 1) return undefined;
                let sumPV = 0;
                let sumV = 0;
                for (let j = endIdx - len + 1; j <= endIdx; j++) {
                    const v = Math.max(1, dataList[j].volume || 1);
                    sumPV += dataList[j].close * v;
                    sumV += v;
                }
                return sumPV / sumV;
            };
            return dataList.map((_, i) => ({
                vwma1: calcVwma(i, Math.max(2, p1 || 20)),
                vwma2: calcVwma(i, Math.max(2, p2 || 50)),
            }));
        },
    });

    // 107. Williams Alligator (Jaw 13, Teeth 8, Lips 5)
    registerIndicator({
        name: 'ALLIGATOR',
        shortName: 'Alligator',
        calcParams: [13, 8, 5],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'jaw', title: 'Jaw (13): ', type: 'line' },
            { key: 'teeth', title: 'Teeth (8): ', type: 'line' },
            { key: 'lips', title: 'Lips (5): ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const [pJ, pT, pL] = indicator.calcParams as number[];
            const hl2 = TA.hl2(dataList);
            const jaw = TA.rma(hl2, pJ || 13);
            const teeth = TA.rma(hl2, pT || 8);
            const lips = TA.rma(hl2, pL || 5);
            return dataList.map((_, i) => ({ jaw: jaw[i], teeth: teeth[i], lips: lips[i] }));
        },
    });

    // 108. Williams Fractal
    registerIndicator({
        name: 'FRACTAL',
        shortName: 'Fractal',
        calcParams: [2],
        precision: 4,
        shouldOhlc: true,
        figures: [
            { key: 'upFractal', title: 'Fractal High: ', type: 'line' },
            { key: 'dnFractal', title: 'Fractal Low: ', type: 'line' },
        ],
        calc: (dataList: KLineData[], indicator) => {
            const n = Math.max(1, Number((indicator.calcParams as number[])[0]) || 2);
            let lastUp: number | undefined;
            let lastDn: number | undefined;
            return dataList.map((_, i) => {
                if (i >= 2 * n) {
                    const mid = i - n;
                    let isHigh = true;
                    let isLow = true;
                    for (let j = i - 2 * n; j <= i; j++) {
                        if (j !== mid) {
                            if (dataList[j].high >= dataList[mid].high) isHigh = false;
                            if (dataList[j].low <= dataList[mid].low) isLow = false;
                        }
                    }
                    if (isHigh) lastUp = dataList[mid].high;
                    if (isLow) lastDn = dataList[mid].low;
                }
                return { upFractal: lastUp, dnFractal: lastDn };
            });
        },
    });

    // 109. Zig Zag
    registerIndicator({
        name: 'ZIGZAG',
        shortName: 'ZigZag',
        calcParams: [5, 10],
        precision: 4,
        shouldOhlc: true,
        figures: [{ key: 'zz', title: 'ZigZag: ', type: 'line' }],
        calc: (dataList: KLineData[], indicator) => {
            const depth = Math.max(2, Number((indicator.calcParams as number[])[1]) || 10);
            const hh = TA.highest(TA.highs(dataList), depth);
            const ll = TA.lowest(TA.lows(dataList), depth);
            return dataList.map((d, i) => {
                if (d.high >= (hh[i] ?? d.high)) return { zz: d.high };
                if (d.low <= (ll[i] ?? d.low)) return { zz: d.low };
                return { zz: ((hh[i] ?? d.high) + (ll[i] ?? d.low)) / 2 };
            });
        },
    });

    // 110. Custom Chart Style Renderer (HLC Bars, Line w/ Markers, Step Line, HLC Area, Baseline, Columns, High-Low, Heikin Ashi)
    registerIndicator({
        name: 'TV_CANDLE_STYLE_RENDERER',
        shortName: '',
        calcParams: [],
        shouldOhlc: true,
        figures: [],
        calc: (dataList: KLineData[]) => {
            const haOpen: number[] = [];
            const haClose: number[] = [];
            return dataList.map((d, i) => {
                const hc = (d.open + d.high + d.low + d.close) / 4;
                const ho = i === 0 ? (d.open + d.close) / 2 : (haOpen[i - 1] + haClose[i - 1]) / 2;
                const hh = Math.max(d.high, ho, hc);
                const hl = Math.min(d.low, ho, hc);
                haOpen.push(ho);
                haClose.push(hc);
                return { ho, hc, hh, hl };
            });
        },
        draw: ({ ctx, kLineDataList, indicator, visibleRange, bounding, barSpace, xAxis, yAxis }) => {
            const ext = (indicator.extendData || {}) as {
                styleId?: string;
                upColor?: string;
                downColor?: string;
                lineColor?: string;
            };
            const styleId = ext.styleId || '';
            if (!styleId || kLineDataList.length === 0) return true;

            const upColor = ext.upColor || '#10b981';
            const downColor = ext.downColor || '#ef4444';
            const lineColor = ext.lineColor || '#2962ff';

            const from = Math.max(0, visibleRange.from);
            const to = Math.min(kLineDataList.length - 1, visibleRange.to);
            if (from > to) return true;

            ctx.save();
            const halfW = Math.max(1.5, Math.min(18, barSpace.halfGapBar));

            if (styleId === 'hlc_bars') {
                ctx.lineWidth = 1.5;
                for (let i = from; i <= to; i++) {
                    const d = kLineDataList[i];
                    const x = xAxis.convertToPixel(i);
                    const yH = yAxis.convertToPixel(d.high);
                    const yL = yAxis.convertToPixel(d.low);
                    const yC = yAxis.convertToPixel(d.close);
                    ctx.strokeStyle = d.close >= d.open ? upColor : downColor;
                    ctx.beginPath();
                    ctx.moveTo(x, yH);
                    ctx.lineTo(x, yL);
                    ctx.moveTo(x, yC);
                    ctx.lineTo(x + halfW, yC);
                    ctx.stroke();
                }
            } else if (styleId === 'lines_with_marks') {
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 2;
                ctx.beginPath();
                for (let i = from; i <= to; i++) {
                    const x = xAxis.convertToPixel(i);
                    const y = yAxis.convertToPixel(kLineDataList[i].close);
                    if (i === from) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();

                const r = Math.max(2.5, Math.min(4.2, halfW * 0.55));
                for (let i = from; i <= to; i++) {
                    const x = xAxis.convertToPixel(i);
                    const y = yAxis.convertToPixel(kLineDataList[i].close);
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.fillStyle = lineColor;
                    ctx.fill();
                    ctx.lineWidth = 1.2;
                    ctx.strokeStyle = '#ffffff';
                    ctx.stroke();
                }
            } else if (styleId === 'step_line') {
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 2;
                ctx.beginPath();
                for (let i = from; i <= to; i++) {
                    const x = xAxis.convertToPixel(i);
                    const y = yAxis.convertToPixel(kLineDataList[i].close);
                    if (i === from) {
                        ctx.moveTo(x, y);
                    } else {
                        const prevY = yAxis.convertToPixel(kLineDataList[i - 1].close);
                        ctx.lineTo(x, prevY);
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();
            } else if (styleId === 'hlc_area') {
                // Shaded High-Low band
                ctx.beginPath();
                for (let i = from; i <= to; i++) {
                    const x = xAxis.convertToPixel(i);
                    const yH = yAxis.convertToPixel(kLineDataList[i].high);
                    if (i === from) ctx.moveTo(x, yH);
                    else ctx.lineTo(x, yH);
                }
                for (let i = to; i >= from; i--) {
                    const x = xAxis.convertToPixel(i);
                    const yL = yAxis.convertToPixel(kLineDataList[i].low);
                    ctx.lineTo(x, yL);
                }
                ctx.closePath();
                ctx.fillStyle = 'rgba(41, 98, 255, 0.14)';
                ctx.fill();

                // High & Low borders
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(41, 98, 255, 0.45)';
                ctx.beginPath();
                for (let i = from; i <= to; i++) {
                    const x = xAxis.convertToPixel(i);
                    const yH = yAxis.convertToPixel(kLineDataList[i].high);
                    if (i === from) ctx.moveTo(x, yH);
                    else ctx.lineTo(x, yH);
                }
                ctx.stroke();

                ctx.beginPath();
                for (let i = from; i <= to; i++) {
                    const x = xAxis.convertToPixel(i);
                    const yL = yAxis.convertToPixel(kLineDataList[i].low);
                    if (i === from) ctx.moveTo(x, yL);
                    else ctx.lineTo(x, yL);
                }
                ctx.stroke();

                // Center Close line
                ctx.lineWidth = 2;
                ctx.strokeStyle = lineColor;
                ctx.beginPath();
                for (let i = from; i <= to; i++) {
                    const x = xAxis.convertToPixel(i);
                    const yC = yAxis.convertToPixel(kLineDataList[i].close);
                    if (i === from) ctx.moveTo(x, yC);
                    else ctx.lineTo(x, yC);
                }
                ctx.stroke();
            } else if (styleId === 'baseline') {
                let minP = Infinity;
                let maxP = -Infinity;
                for (let i = from; i <= to; i++) {
                    if (kLineDataList[i].high > maxP) maxP = kLineDataList[i].high;
                    if (kLineDataList[i].low < minP) minP = kLineDataList[i].low;
                }
                const basePrice = (maxP + minP) / 2;
                const yBase = yAxis.convertToPixel(basePrice);

                // Dashed baseline
                ctx.save();
                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, yBase);
                ctx.lineTo(bounding.width, yBase);
                ctx.stroke();
                ctx.restore();

                for (let i = from + 1; i <= to; i++) {
                    const x1 = xAxis.convertToPixel(i - 1);
                    const x2 = xAxis.convertToPixel(i);
                    const c1 = kLineDataList[i - 1].close;
                    const c2 = kLineDataList[i].close;
                    const y1 = yAxis.convertToPixel(c1);
                    const y2 = yAxis.convertToPixel(c2);
                    const isAbove = (c1 + c2) / 2 >= basePrice;

                    ctx.beginPath();
                    ctx.moveTo(x1, yBase);
                    ctx.lineTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.lineTo(x2, yBase);
                    ctx.closePath();
                    ctx.fillStyle = isAbove ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 68, 68, 0.16)';
                    ctx.fill();

                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.strokeStyle = isAbove ? upColor : downColor;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            } else if (styleId === 'columns') {
                const yBottom = bounding.height;
                for (let i = from; i <= to; i++) {
                    const d = kLineDataList[i];
                    const prevClose = i > 0 ? kLineDataList[i - 1].close : d.open;
                    const isUp = d.close >= prevClose;
                    const x = xAxis.convertToPixel(i);
                    const yC = yAxis.convertToPixel(d.close);
                    const h = Math.max(2, yBottom - yC);
                    ctx.fillStyle = isUp ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
                    ctx.fillRect(x - halfW, yC, halfW * 2, h);
                    ctx.strokeStyle = isUp ? upColor : downColor;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(x - halfW, yC);
                    ctx.lineTo(x + halfW, yC);
                    ctx.stroke();
                }
            } else if (styleId === 'high_low') {
                for (let i = from; i <= to; i++) {
                    const d = kLineDataList[i];
                    const x = xAxis.convertToPixel(i);
                    const yH = yAxis.convertToPixel(d.high);
                    const yL = yAxis.convertToPixel(d.low);
                    const top = Math.min(yH, yL);
                    const h = Math.max(2, Math.abs(yL - yH));
                    ctx.fillStyle = 'rgba(41, 98, 255, 0.45)';
                    ctx.fillRect(x - halfW, top, halfW * 2, h);
                    ctx.strokeStyle = lineColor;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x - halfW, top, halfW * 2, h);
                }
            } else if (styleId === 'heikin_ashi') {
                const resList = indicator.result || [];
                for (let i = from; i <= to; i++) {
                    const ha = resList[i];
                    if (!ha) continue;
                    const isUp = ha.hc >= ha.ho;
                    const color = isUp ? upColor : downColor;
                    const x = xAxis.convertToPixel(i);
                    const yH = yAxis.convertToPixel(ha.hh);
                    const yL = yAxis.convertToPixel(ha.hl);
                    const yO = yAxis.convertToPixel(ha.ho);
                    const yC = yAxis.convertToPixel(ha.hc);

                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.moveTo(x, yH);
                    ctx.lineTo(x, yL);
                    ctx.stroke();

                    const bodyTop = Math.min(yO, yC);
                    const bodyH = Math.max(1.5, Math.abs(yC - yO));
                    ctx.fillStyle = color;
                    ctx.fillRect(x - halfW, bodyTop, halfW * 2, bodyH);
                }
            }

            ctx.restore();
            return true;
        },
    });

    // 111. Institutional Session Killzones Shading (Asia / London / LDN-NY Overlap / New York)
    registerIndicator({
        name: 'TV_SESSION_KILLZONES',
        shortName: 'Killzones',
        calcParams: [],
        shouldOhlc: false,
        figures: [],
        calc: (dataList: KLineData[]) => dataList.map(() => ({})),
        draw: ({ ctx, kLineDataList, visibleRange, bounding, barSpace, xAxis }) => {
            if (!kLineDataList || kLineDataList.length < 2) return true;

            const from = Math.max(0, visibleRange.from);
            const to = Math.min(kLineDataList.length - 1, visibleRange.to);
            if (from > to) return true;

            // Detect intraday vs daily/weekly bar spacing; skip shading on >= 6H timeframes
            let minDeltaMs = Number.POSITIVE_INFINITY;
            const probeEnd = Math.min(to, from + 25);
            for (let i = Math.max(1, from); i <= probeEnd; i++) {
                const diff = kLineDataList[i].timestamp - kLineDataList[i - 1].timestamp;
                if (diff > 0 && diff < minDeltaMs) {
                    minDeltaMs = diff;
                }
            }
            if (!Number.isFinite(minDeltaMs) || minDeltaMs >= 6 * 3600_000) {
                return true;
            }

            type SessionMeta = {
                id: 'ASIA' | 'LONDON' | 'OVERLAP' | 'NY';
                label: string;
                fill: string;
                border: string;
                text: string;
            };

            const classifyUtcSession = (ts: number): { key: string; meta: SessionMeta } | null => {
                const isEn = getCurrentLocale() === 'en';
                const d = new Date(ts);
                const utcDay = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
                const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
                if (mins >= 0 && mins < 480) {
                    return {
                        key: `${utcDay}:ASIA`,
                        meta: {
                            id: 'ASIA',
                            label: isEn ? 'ASIA' : 'ÁSIA',
                            fill: 'rgba(56, 189, 248, 0.055)',
                            border: 'rgba(56, 189, 248, 0.45)',
                            text: '#38bdf8',
                        },
                    };
                }
                if (mins >= 480 && mins < 780) {
                    return {
                        key: `${utcDay}:LONDON`,
                        meta: {
                            id: 'LONDON',
                            label: isEn ? 'LONDON' : 'LONDRES',
                            fill: 'rgba(245, 158, 11, 0.055)',
                            border: 'rgba(245, 158, 11, 0.48)',
                            text: '#f59e0b',
                        },
                    };
                }
                if (mins >= 780 && mins < 990) {
                    return {
                        key: `${utcDay}:OVERLAP`,
                        meta: {
                            id: 'OVERLAP',
                            label: 'LDN·NY',
                            fill: 'rgba(168, 85, 247, 0.075)',
                            border: 'rgba(168, 85, 247, 0.55)',
                            text: '#a855f7',
                        },
                    };
                }
                if (mins >= 990 && mins < 1260) {
                    return {
                        key: `${utcDay}:NY`,
                        meta: {
                            id: 'NY',
                            label: 'NY',
                            fill: 'rgba(16, 185, 129, 0.055)',
                            border: 'rgba(16, 185, 129, 0.48)',
                            text: '#10b981',
                        },
                    };
                }
                return null;
            };

            const halfStep = Math.max(1, (barSpace.bar || 6) * 0.5);
            ctx.save();
            ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
            ctx.textBaseline = 'top';

            let segStart = -1;
            let activeKey = '';
            let activeMeta: SessionMeta | null = null;

            const flushSegment = (endIdx: number) => {
                if (segStart < 0 || !activeMeta) return;
                const x1 = xAxis.convertToPixel(segStart) - halfStep;
                const x2 = xAxis.convertToPixel(endIdx) + halfStep;
                const left = Math.max(0, Math.min(x1, x2));
                const right = Math.min(bounding.width, Math.max(x1, x2));
                const width = right - left;
                if (width > 1) {
                    ctx.fillStyle = activeMeta.fill;
                    ctx.fillRect(left, 0, width, bounding.height);

                    // Top session ribbon
                    ctx.fillStyle = activeMeta.border;
                    ctx.fillRect(left, 0, width, 2);

                    // Subtle session open vertical divider
                    ctx.strokeStyle = activeMeta.border;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 4]);
                    ctx.beginPath();
                    ctx.moveTo(left + 0.5, 0);
                    ctx.lineTo(left + 0.5, bounding.height);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    if (width >= 36) {
                        ctx.fillStyle = activeMeta.text;
                        ctx.fillText(activeMeta.label, left + 5, 5);
                    }
                }
            };

            for (let i = from; i <= to; i++) {
                const cls = classifyUtcSession(kLineDataList[i].timestamp);
                if (!cls) {
                    if (segStart >= 0) {
                        flushSegment(i - 1);
                        segStart = -1;
                        activeKey = '';
                        activeMeta = null;
                    }
                    continue;
                }
                if (cls.key !== activeKey) {
                    if (segStart >= 0) {
                        flushSegment(i - 1);
                    }
                    segStart = i;
                    activeKey = cls.key;
                    activeMeta = cls.meta;
                }
            }
            if (segStart >= 0) {
                flushSegment(to);
            }

            ctx.restore();
            return true;
        },
    });
}
