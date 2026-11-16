import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { init, dispose, Chart, KLineData } from 'klinecharts';
import { SymbolInfo, Period } from '@klinecharts/pro';
import { CustomKLineDatafeed } from '../../../services/klineDatafeed';
import { TIMEFRAMES, findTimeframeByText } from '../types';
import { ChartLayoutMode } from '../layers/TopToolbarLayer';
import { DrawnObjectItem, RightDrawerMode } from '../layers/RightSidePanelLayer';
import { DrawingStyleState, OverlayPointCoord } from '../layers/DrawingStyleToolbarLayer';
import {
    buildOverlayStylesPayload,
    DEFAULT_DRAWING_STYLE,
    resolveOverlayPointsAgainstCandles,
} from './drawingOverlayUtils';

export interface UseMultiPaneChartsParams {
    chartRef: React.MutableRefObject<Chart | null>;
    datafeedRef: React.MutableRefObject<CustomKLineDatafeed | null>;
    currentSymbol: SymbolInfo;
    currentPeriod: Period;
    latestBar: KLineData | null;
    syncEnabled: boolean;
    chartTheme: string;
    candleStyle: any;
    applyChartTheme: (chart: Chart, theme?: string) => void;
    bindPrecisionYAxisEvents: (el: HTMLElement, chart: Chart) => () => void;
    captureCurrentOverlayGeometries: () => Record<string, OverlayPointCoord[]>;
    drawnItems: DrawnObjectItem[];
    drawingStylesById: Record<string, DrawingStyleState>;
    pointsTick: number;
    drawingsVisible: boolean;
    focusWorkspaceMode: boolean;
    rightDrawer: RightDrawerMode;
    initialLayoutMode: ChartLayoutMode;
    initialSecondaryPeriodText?: string;
    initialAuxPeriodTexts?: string[];
    onSelectPrimaryPeriod: (per: Period) => void;
}

export function useMultiPaneCharts({
    chartRef,
    datafeedRef,
    currentSymbol,
    currentPeriod,
    latestBar,
    syncEnabled,
    chartTheme,
    candleStyle,
    applyChartTheme,
    bindPrecisionYAxisEvents,
    captureCurrentOverlayGeometries,
    drawnItems,
    drawingStylesById,
    pointsTick,
    drawingsVisible,
    focusWorkspaceMode,
    rightDrawer,
    initialLayoutMode,
    initialSecondaryPeriodText,
    initialAuxPeriodTexts,
    onSelectPrimaryPeriod,
}: UseMultiPaneChartsParams) {
    const auxChartDivRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);
    const auxChartRefs = useRef<(Chart | null)[]>([null, null, null]);
    const auxCleanupsRef = useRef<(null | (() => void))[]>([null, null, null]);
    const auxOrderOverlayIdsRef = useRef<[string[], string[], string[]]>([[], [], []]);
    const auxMirroredOverlayIdsRef = useRef<[string[], string[], string[]]>([[], [], []]);

    const [layoutMode, setLayoutMode] = useState<ChartLayoutMode>(initialLayoutMode);
    const [focusedPaneIndex, setFocusedPaneIndex] = useState<number>(0);

    const [secondaryPeriod, setSecondaryPeriod] = useState<Period>(() => {
        if (initialSecondaryPeriodText) {
            const found = findTimeframeByText(initialSecondaryPeriodText);
            if (found) return found;
        }
        return TIMEFRAMES.find((t) => t.text === '1h') || TIMEFRAMES[0];
    });

    const [extraAuxPeriods, setExtraAuxPeriods] = useState<[Period, Period]>(() => {
        const auxArr = initialAuxPeriodTexts || [];
        const p2 = auxArr[1] ? findTimeframeByText(auxArr[1]) : undefined;
        const p3 = auxArr[2] ? findTimeframeByText(auxArr[2]) : undefined;
        return [
            p2 || TIMEFRAMES.find((t) => t.text === '4h') || TIMEFRAMES[0],
            p3 || TIMEFRAMES.find((t) => t.text === '5m') || TIMEFRAMES[0],
        ];
    });

    const auxPaneCount = useMemo<number>(() => {
        if (layoutMode === '1x1') return 0;
        if (layoutMode === '1x2' || layoutMode === '2x1') return 1;
        if (layoutMode === '1+2' || layoutMode === '3x1') return 2;
        return 3;
    }, [layoutMode]);

    const auxPeriods = useMemo<[Period, Period, Period]>(
        () => [secondaryPeriod, extraAuxPeriods[0], extraAuxPeriods[1]],
        [secondaryPeriod, extraAuxPeriods]
    );
    const panePeriods = useMemo<Period[]>(() => [currentPeriod, ...auxPeriods], [currentPeriod, auxPeriods]);

    const gridLayoutClass = useMemo(() => {
        if (layoutMode === '1x2') return 'grid grid-cols-2 grid-rows-1 gap-px bg-line';
        if (layoutMode === '2x1') return 'grid grid-cols-1 grid-rows-2 gap-px bg-line';
        if (layoutMode === '1+2') return 'grid grid-cols-[1.28fr_1fr] grid-rows-2 gap-px bg-line';
        if (layoutMode === '3x1') return 'grid grid-cols-3 grid-rows-1 gap-px bg-line';
        if (layoutMode === '2x2') return 'grid grid-cols-2 grid-rows-2 gap-px bg-line';
        return 'grid grid-cols-1 grid-rows-1';
    }, [layoutMode]);

    useEffect(() => {
        const totalPanes = 1 + auxPaneCount;
        if (focusedPaneIndex >= totalPanes) {
            setFocusedPaneIndex(0);
        }
    }, [auxPaneCount, focusedPaneIndex]);

    const syncAllAuxCharts = useCallback(
        async (sym: SymbolInfo, cutoffTs: number | null) => {
            const df = datafeedRef.current;
            if (!df || auxPaneCount <= 0) return;

            await Promise.all(
                Array.from({ length: auxPaneCount }).map(async (_, auxIdx) => {
                    const auxChart = auxChartRefs.current[auxIdx];
                    if (!auxChart) return;
                    const panePeriod = auxPeriods[auxIdx] || TIMEFRAMES[0];
                    auxChart.setPriceVolumePrecision(sym.pricePrecision ?? 2, sym.volumePrecision ?? 0);
                    const bars = await df.getHistorySlicedAtTimestamp(
                        sym,
                        panePeriod,
                        syncEnabled ? cutoffTs : null
                    );
                    if (auxChartRefs.current[auxIdx] === auxChart) {
                        auxChart.applyNewData(bars, bars.length > 0);
                    }
                })
            );
        },
        [datafeedRef, auxPaneCount, auxPeriods, syncEnabled]
    );

    const handleSelectSecondaryPeriod = useCallback((per: Period) => {
        setSecondaryPeriod(per);
    }, []);

    const handleSelectPanePeriod = useCallback(
        (paneIndex: number, per: Period) => {
            if (paneIndex <= 0) {
                onSelectPrimaryPeriod(per);
                return;
            }
            if (paneIndex === 1) {
                setSecondaryPeriod(per);
                return;
            }
            setExtraAuxPeriods((prev) => {
                const next: [Period, Period] = [prev[0], prev[1]];
                if (paneIndex === 2) next[0] = per;
                else if (paneIndex === 3) next[1] = per;
                return next;
            });
        },
        [onSelectPrimaryPeriod]
    );

    // Initialize / Dispose Auxiliary Charts across all 6 Multi-Pane Layouts
    useEffect(() => {
        for (let i = 0; i < 3; i++) {
            if (i < auxPaneCount) {
                const auxEl = auxChartDivRefs.current[i];
                if (auxEl && !auxChartRefs.current[i]) {
                    const auxChart = init(auxEl);
                    if (auxChart) {
                        auxChartRefs.current[i] = auxChart;
                        applyChartTheme(auxChart, chartTheme);
                        const ro = new ResizeObserver(() => {
                            requestAnimationFrame(() => auxChart.resize());
                        });
                        ro.observe(auxEl);
                        const unbindAuxYAxis = bindPrecisionYAxisEvents(auxEl, auxChart);
                        auxCleanupsRef.current[i] = () => {
                            unbindAuxYAxis();
                            ro.disconnect();
                            dispose(auxEl);
                            auxChartRefs.current[i] = null;
                        };
                    }
                }
            } else if (auxCleanupsRef.current[i]) {
                auxCleanupsRef.current[i]?.();
                auxCleanupsRef.current[i] = null;
            }
        }

        requestAnimationFrame(() => {
            chartRef.current?.resize();
            auxChartRefs.current.forEach((c) => c?.resize());
        });

        const cutoffTs = datafeedRef.current?.getReplayTimestamp() || latestBar?.timestamp || null;
        if (auxPaneCount > 0) {
            void syncAllAuxCharts(currentSymbol, cutoffTs);
        }
    }, [auxPaneCount, layoutMode]);

    // Dispose any active auxiliary charts on component unmount
    useEffect(() => {
        return () => {
            for (let i = 0; i < 3; i++) {
                auxCleanupsRef.current[i]?.();
                auxCleanupsRef.current[i] = null;
            }
        };
    }, []);

    // Update Auxiliary Charts when symbol, pane timeframes, sync toggle, or replay timestamp changes
    useEffect(() => {
        if (auxPaneCount > 0) {
            const cutoffTs = datafeedRef.current?.getReplayTimestamp() || latestBar?.timestamp || null;
            void syncAllAuxCharts(currentSymbol, cutoffTs);
        }
    }, [auxPaneCount, currentSymbol, auxPeriods, latestBar?.timestamp, syncEnabled, syncAllAuxCharts, datafeedRef]);

    useEffect(() => {
        [chartRef.current, ...auxChartRefs.current].forEach((c) => {
            if (c) applyChartTheme(c, chartTheme);
        });
    }, [chartTheme, candleStyle, applyChartTheme, chartRef]);

    // Resize all charts smoothly when Focus Workspace Mode or drawer toggles
    useEffect(() => {
        const timer = setTimeout(() => {
            requestAnimationFrame(() => {
                chartRef.current?.resize();
                auxChartRefs.current.forEach((c) => c?.resize());
            });
        }, 30);
        return () => clearTimeout(timer);
    }, [focusWorkspaceMode, rightDrawer, chartRef]);

    // Mirror HTF/LTF Drawings across all active Auxiliary Multi-Layout Panes when Sync is enabled
    useEffect(() => {
        const geoms = captureCurrentOverlayGeometries();
        for (let i = 0; i < 3; i++) {
            const auxChart = auxChartRefs.current[i];
            const prevIds = auxMirroredOverlayIdsRef.current[i];
            if (auxChart && prevIds.length > 0) {
                prevIds.forEach((id) => {
                    try {
                        auxChart.removeOverlay(id);
                    } catch (_) {}
                });
            }
            auxMirroredOverlayIdsRef.current[i] = [];

            if (!auxChart || i >= auxPaneCount || !syncEnabled || !drawingsVisible) continue;
            const auxCandles = auxChart.getDataList() || [];
            if (auxCandles.length === 0) continue;

            const nextIds: string[] = [];
            drawnItems.forEach((item) => {
                if (item.visible === false) return;
                const rawPts = geoms[item.id];
                if (!Array.isArray(rawPts) || rawPts.length === 0) return;
                const styleState = drawingStylesById[item.id] || DEFAULT_DRAWING_STYLE;
                const resolvedPts = resolveOverlayPointsAgainstCandles(rawPts, auxCandles);
                const created = auxChart.createOverlay({
                    name: item.name,
                    points: resolvedPts as any,
                    extendData: styleState.extendData ?? item.extendData,
                    lock: true,
                    styles: buildOverlayStylesPayload(styleState) as any,
                });
                if (typeof created === 'string') {
                    nextIds.push(created);
                }
            });
            auxMirroredOverlayIdsRef.current[i] = nextIds;
        }
    }, [
        auxPaneCount,
        syncEnabled,
        drawingsVisible,
        drawnItems,
        drawingStylesById,
        pointsTick,
        auxPeriods,
        captureCurrentOverlayGeometries,
    ]);

    return {
        layoutMode,
        setLayoutMode,
        focusedPaneIndex,
        setFocusedPaneIndex,
        secondaryPeriod,
        setSecondaryPeriod,
        extraAuxPeriods,
        setExtraAuxPeriods,
        auxPaneCount,
        auxPeriods,
        panePeriods,
        gridLayoutClass,
        auxChartDivRefs,
        auxChartRefs,
        auxOrderOverlayIdsRef,
        syncAllAuxCharts,
        handleSelectSecondaryPeriod,
        handleSelectPanePeriod,
    };
}
