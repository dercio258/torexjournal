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

export interface ResolveOverlayOptions {
    /** Canonical timeframe duration (ms) used as fallback/extrapolation step. */
    stepMs?: number;
    /**
     * When true, returns coordinates safe for passing directly into `klinecharts`
     * `createOverlay`/`overrideOverlay` (works around `binarySearchNearest` clamping
     * points inside `[lastTs, lastTs + stepMs)` to `length - 2` and out-of-range
     * timestamps to the chart edges).
     */
    forChartMount?: boolean;
}

/**
 * Estimates the canonical candle spacing in milliseconds using the median positive
 * delta across recent bars so weekend/session gaps do not inflate projection math.
 */
export function estimateBarIntervalMs(
    candles: KLineData[],
    fallbackStepMs: number = 60_000
): number {
    const safeFallback = Math.max(1_000, Number.isFinite(fallbackStepMs) ? fallbackStepMs : 60_000);
    if (!Array.isArray(candles) || candles.length < 2) {
        return safeFallback;
    }

    const deltas: number[] = [];
    const startIdx = Math.max(1, candles.length - 40);
    for (let i = startIdx; i < candles.length; i++) {
        const diff = candles[i].timestamp - candles[i - 1].timestamp;
        if (Number.isFinite(diff) && diff > 0) {
            deltas.push(diff);
        }
    }
    if (deltas.length === 0) {
        return safeFallback;
    }

    deltas.sort((a, b) => a - b);
    const mid = deltas[Math.floor(deltas.length / 2)];
    return Math.max(1_000, mid);
}

/**
 * Reconstructs a finite timestamp for a chart overlay point whose `timestamp` may have
 * been omitted for out-of-range `dataIndex` positioning.
 */
export function reconstructPointTimestamp(
    pt: OverlayPointCoord,
    candles: KLineData[],
    fallbackStepMs: number = 60_000
): number | undefined {
    if (typeof pt.timestamp === 'number' && Number.isFinite(pt.timestamp)) {
        return pt.timestamp;
    }
    if (!Array.isArray(candles) || candles.length === 0) {
        return undefined;
    }
    if (typeof pt.dataIndex !== 'number' || !Number.isFinite(pt.dataIndex)) {
        return undefined;
    }
    const idx = Math.round(pt.dataIndex);
    if (idx >= 0 && idx < candles.length) {
        return candles[idx].timestamp;
    }
    const intervalMs = estimateBarIntervalMs(candles, fallbackStepMs);
    if (idx < 0) {
        return candles[0].timestamp + idx * intervalMs;
    }
    const lastIdx = candles.length - 1;
    return candles[lastIdx].timestamp + (idx - lastIdx) * intervalMs;
}

/**
 * Reconciles live chart overlay points back into canonical timestamped coordinates,
 * preserving sub-bar timestamps (e.g. LTF anchor inside a coarse HTF forming bar)
 * when the anchor stayed on the same chart bar.
 */
export function reconcileCapturedOverlayPoints(
    livePoints: OverlayPointCoord[],
    existingCanonical: OverlayPointCoord[] | undefined,
    candles: KLineData[],
    stepMs?: number
): OverlayPointCoord[] {
    if (!Array.isArray(livePoints) || livePoints.length === 0) return [];
    const intervalMs = estimateBarIntervalMs(candles, stepMs ?? 60_000);
    const existingResolvedForChart =
        Array.isArray(existingCanonical) && existingCanonical.length === livePoints.length && candles.length > 0
            ? resolveOverlayPointsAgainstCandles(existingCanonical, candles, {
                  stepMs: intervalMs,
                  forChartMount: true,
              })
            : null;

    return livePoints.map((pt, idx) => {
        const canonicalCandidate = existingCanonical?.[idx];
        const expectedMount = existingResolvedForChart?.[idx];
        const matchesMountedBar =
            Boolean(
                canonicalCandidate &&
                    typeof canonicalCandidate.timestamp === 'number' &&
                    Number.isFinite(canonicalCandidate.timestamp) &&
                    expectedMount
            ) &&
            pt.dataIndex === expectedMount?.dataIndex &&
            (pt.timestamp === expectedMount?.timestamp ||
                (pt.timestamp == null && expectedMount?.timestamp == null));

        const resolvedTs = matchesMountedBar
            ? canonicalCandidate!.timestamp
            : reconstructPointTimestamp(pt, candles, intervalMs);

        return {
            timestamp: resolvedTs,
            dataIndex: pt.dataIndex,
            value: pt.value,
        };
    });
}

/**
 * Resolves saved overlay anchor coordinates (`timestamp` + `value`) onto the chart's
 * currently loaded `candles` array, supporting exact matches, multi-timeframe snapping,
 * and future bar projections beyond the current replay cutoff.
 */
export function resolveOverlayPointsAgainstCandles(
    points: OverlayPointCoord[],
    candles: KLineData[],
    options?: ResolveOverlayOptions
): OverlayPointCoord[] {
    if (!Array.isArray(points) || points.length === 0) return [];
    if (!Array.isArray(candles) || candles.length === 0) {
        return points.map((pt) => ({ ...pt }));
    }

    const barIntervalMs = estimateBarIntervalMs(candles, options?.stepMs ?? 60_000);
    const forChartMount = Boolean(options?.forChartMount);
    const firstTs = candles[0].timestamp;
    const lastTs = candles[candles.length - 1].timestamp;
    const lastIdx = candles.length - 1;

    return points.map((pt) => {
        if (typeof pt.timestamp === 'number' && Number.isFinite(pt.timestamp)) {
            // Inside the latest visible bar [lastTs, lastTs + barIntervalMs): e.g. 10:15 on a 1h bar at 10:00.
            // klinecharts' binarySearchNearest returns length - 2 when timestamp > lastTs, so mount with lastTs.
            if (pt.timestamp >= lastTs && pt.timestamp < lastTs + barIntervalMs) {
                return {
                    ...pt,
                    timestamp: forChartMount ? lastTs : pt.timestamp,
                    dataIndex: lastIdx,
                    value: pt.value,
                };
            }
            if (pt.timestamp >= lastTs + barIntervalMs) {
                const futureBars = Math.max(1, Math.round((pt.timestamp - lastTs) / barIntervalMs));
                return {
                    ...pt,
                    timestamp: forChartMount ? undefined : pt.timestamp,
                    dataIndex: lastIdx + futureBars,
                    value: pt.value,
                };
            }
            if (pt.timestamp < firstTs) {
                const pastBars = Math.max(1, Math.round((firstTs - pt.timestamp) / barIntervalMs));
                return {
                    ...pt,
                    timestamp: forChartMount ? undefined : pt.timestamp,
                    dataIndex: -pastBars,
                    value: pt.value,
                };
            }

            let lo = 0;
            let hi = lastIdx;
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
            const candA = Math.max(0, Math.min(lastIdx, lo));
            const candB = Math.max(0, Math.min(lastIdx, hi));
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

        if (typeof pt.dataIndex === 'number' && Number.isFinite(pt.dataIndex)) {
            if (candles[pt.dataIndex]) {
                return {
                    ...pt,
                    timestamp: candles[pt.dataIndex].timestamp,
                    dataIndex: pt.dataIndex,
                    value: pt.value,
                };
            }
            if (forChartMount) {
                return {
                    ...pt,
                    timestamp: undefined,
                    dataIndex: pt.dataIndex,
                    value: pt.value,
                };
            }
        }

        return { ...pt };
    });
}
