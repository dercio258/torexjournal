import { CandleType, KLineData, LineType } from 'klinecharts';
import { ChartCandleStyleId } from '../types';
import { DrawingStyleState, OverlayPointCoord } from '../layers/DrawingStyleToolbarLayer';

export function hexToRgba(hex: string, opacityPct: number): string {
    const clean = hex.replace('#', '').trim();
    const alpha = Math.max(0, Math.min(1, opacityPct / 100));
    if (clean.length === 6) {
        const r = parseInt(clean.slice(0, 2), 16);
        const g = parseInt(clean.slice(2, 4), 16);
        const b = parseInt(clean.slice(4, 6), 16);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
    }
    return hex;
}

export const DEFAULT_DRAWING_STYLE: DrawingStyleState = {
    lineColor: '#2962ff',
    lineOpacity: 100,
    lineSize: 2,
    lineStyle: 'solid',
    fillColor: '#2962ff',
    fillOpacity: 16,
    textColor: '#ffffff',
    textSize: 12,
    extendData: '',
};

export function buildOverlayStylesPayload(st: DrawingStyleState) {
    const lineRgba = hexToRgba(st.lineColor, st.lineOpacity);
    const fillRgba = hexToRgba(st.fillColor, st.fillOpacity);
    const kLineType = st.lineStyle === 'solid' ? LineType.Solid : LineType.Dashed;
    const dashedValue = st.lineStyle === 'dotted' ? [2, 3] : st.lineStyle === 'dashed' ? [6, 4] : [2, 2];

    return {
        point: {
            color: st.lineColor,
            activeColor: st.lineColor,
        },
        line: {
            color: lineRgba,
            size: st.lineSize,
            style: kLineType,
            dashedValue,
        },
        polygon: {
            color: fillRgba,
            borderColor: lineRgba,
            borderSize: st.lineSize,
            borderStyle: kLineType,
            borderDashedValue: dashedValue,
        },
        rect: {
            color: fillRgba,
            borderColor: lineRgba,
            borderSize: st.lineSize,
            borderStyle: kLineType,
            borderDashedValue: dashedValue,
        },
        circle: {
            color: fillRgba,
            borderColor: lineRgba,
            borderSize: st.lineSize,
            borderStyle: kLineType,
            borderDashedValue: dashedValue,
        },
        arc: {
            color: lineRgba,
            size: st.lineSize,
            style: kLineType,
            dashedValue,
        },
        text: {
            color: st.textColor,
            size: st.textSize,
            backgroundColor: lineRgba,
            borderColor: lineRgba,
        },
    };
}

export function resolveNativeCandleType(styleId: ChartCandleStyleId): CandleType {
    if (styleId === 'bars') return CandleType.Ohlc;
    if (styleId === 'hollow_candles') return CandleType.CandleStroke;
    if (styleId === 'lines' || styleId === 'area') return CandleType.Area;
    return CandleType.CandleSolid;
}

/**
 * Resolves saved overlay anchor coordinates (`timestamp` + `value`) onto the chart's
 * currently loaded `candles` array, supporting exact matches, multi-timeframe snapping,
 * and future bar projections beyond the current replay cutoff.
 */
export function resolveOverlayPointsAgainstCandles(
    points: OverlayPointCoord[],
    candles: KLineData[]
): OverlayPointCoord[] {
    if (!Array.isArray(points) || points.length === 0) return [];
    if (!Array.isArray(candles) || candles.length === 0) {
        return points.map((pt) => ({ ...pt }));
    }

    const barIntervalMs =
        candles.length >= 2
            ? Math.max(1000, candles[candles.length - 1].timestamp - candles[candles.length - 2].timestamp)
            : 60_000;
    const firstTs = candles[0].timestamp;
    const lastTs = candles[candles.length - 1].timestamp;

    return points.map((pt) => {
        if (typeof pt.timestamp === 'number' && Number.isFinite(pt.timestamp)) {
            if (pt.timestamp > lastTs) {
                const futureBars = Math.max(1, Math.round((pt.timestamp - lastTs) / barIntervalMs));
                return {
                    ...pt,
                    timestamp: pt.timestamp,
                    dataIndex: candles.length - 1 + futureBars,
                    value: pt.value,
                };
            }
            if (pt.timestamp < firstTs) {
                const pastBars = Math.max(1, Math.round((firstTs - pt.timestamp) / barIntervalMs));
                return {
                    ...pt,
                    timestamp: pt.timestamp,
                    dataIndex: -pastBars,
                    value: pt.value,
                };
            }

            let lo = 0;
            let hi = candles.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const midTs = candles[mid].timestamp;
                if (midTs === pt.timestamp) {
                    lo = mid;
                    hi = mid;
                    break;
                }
                if (midTs < pt.timestamp) lo = mid + 1;
                else hi = mid - 1;
            }
            const candA = Math.max(0, Math.min(candles.length - 1, lo));
            const candB = Math.max(0, Math.min(candles.length - 1, hi));
            const bestIdx =
                Math.abs(candles[candA].timestamp - pt.timestamp) <=
                Math.abs(candles[candB].timestamp - pt.timestamp)
                    ? candA
                    : candB;

            return {
                ...pt,
                timestamp: pt.timestamp,
                dataIndex: bestIdx,
                value: pt.value,
            };
        }

        if (typeof pt.dataIndex === 'number' && candles[pt.dataIndex]) {
            return {
                ...pt,
                timestamp: candles[pt.dataIndex].timestamp,
                dataIndex: pt.dataIndex,
                value: pt.value,
            };
        }

        return { ...pt };
    });
}
