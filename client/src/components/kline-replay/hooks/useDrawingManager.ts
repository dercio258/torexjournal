import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart, OverlayMode } from 'klinecharts';
import { DrawnObjectItem } from '../layers/RightSidePanelLayer';
import { DrawingStyleState, OverlayPointCoord } from '../layers/DrawingStyleToolbarLayer';
import { DrawingToolsWorkspaceState } from '../../../services/backtestSessionSnapshot';
import {
    buildOverlayStylesPayload,
    DEFAULT_DRAWING_STYLE,
    resolveOverlayPointsAgainstCandles,
} from './drawingOverlayUtils';

export interface UseDrawingManagerParams {
    chartRef: React.MutableRefObject<Chart | null>;
    isRestoringSnapshotRef: React.MutableRefObject<boolean>;
    isHydratingCanvasRef: React.MutableRefObject<boolean>;
    initialDrawnItems: DrawnObjectItem[];
    initialDrawingStylesById: Record<string, DrawingStyleState>;
    initialOverlayGeometries: Record<string, OverlayPointCoord[]>;
    initialMagnetMode: boolean;
    initialDrawingsLocked: boolean;
    initialDrawingsVisible: boolean;
    isEn: boolean;
    onCancelCutCandle: () => void;
}

export function useDrawingManager({
    chartRef,
    isRestoringSnapshotRef,
    isHydratingCanvasRef,
    initialDrawnItems,
    initialDrawingStylesById,
    initialOverlayGeometries,
    initialMagnetMode,
    initialDrawingsLocked,
    initialDrawingsVisible,
    isEn,
    onCancelCutCandle,
}: UseDrawingManagerParams) {
    const drawnOverlayIdsRef = useRef<string[]>([]);
    const pendingOverlayIdRef = useRef<string | null>(null);
    const [drawnItems, setDrawnItems] = useState<DrawnObjectItem[]>(initialDrawnItems);
    const overlayGeometriesRef = useRef<Record<string, OverlayPointCoord[]>>(initialOverlayGeometries);
    const [zoomAreaMode, setZoomAreaMode] = useState<boolean>(false);
    const zoomAreaModeRef = useRef<boolean>(false);
    const [zoomBox, setZoomBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
    const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
    const [drawingStylesById, setDrawingStylesById] =
        useState<Record<string, DrawingStyleState>>(initialDrawingStylesById);
    const [pointsTick, setPointsTick] = useState<number>(0);
    const [magnetMode, setMagnetMode] = useState<boolean>(initialMagnetMode);
    const [drawingsLocked, setDrawingsLocked] = useState<boolean>(initialDrawingsLocked);
    const [drawingsVisible, setDrawingsVisible] = useState<boolean>(initialDrawingsVisible);

    useEffect(() => {
        zoomAreaModeRef.current = zoomAreaMode;
    }, [zoomAreaMode]);

    const captureCurrentOverlayGeometries = useCallback((): Record<string, OverlayPointCoord[]> => {
        const chart = chartRef.current;
        const map: Record<string, OverlayPointCoord[]> = { ...overlayGeometriesRef.current };
        if (!chart) return map;
        drawnOverlayIdsRef.current.forEach((id) => {
            const ov = chart.getOverlayById(id) as any;
            if (ov && Array.isArray(ov.points)) {
                map[id] = ov.points.map((pt: any) => ({
                    timestamp: pt.timestamp,
                    dataIndex: pt.dataIndex,
                    value: pt.value,
                }));
            }
        });
        overlayGeometriesRef.current = map;
        return map;
    }, [chartRef]);

    const mountOverlayWithHandlers = useCallback(
        (
            chart: Chart,
            opts: {
                preferredId?: string;
                name: string;
                points?: OverlayPointCoord[];
                extendData?: any;
                mode: OverlayMode;
                lock: boolean;
                visible: boolean;
                styleState: DrawingStyleState;
            }
        ): string | null => {
            const candles = chart.getDataList() || [];
            const resolvedPoints =
                Array.isArray(opts.points) && opts.points.length > 0
                    ? resolveOverlayPointsAgainstCandles(opts.points, candles)
                    : undefined;

            const createdId = chart.createOverlay({
                ...(opts.preferredId ? { id: opts.preferredId } : {}),
                name: opts.name,
                ...(resolvedPoints ? { points: resolvedPoints } : {}),
                extendData: opts.extendData,
                mode: opts.mode,
                lock: opts.lock,
                visible: opts.visible,
                styles: buildOverlayStylesPayload(opts.styleState) as any,
                onDrawing: (event: any) => {
                    const ov = event?.overlay;
                    if (ov && pendingOverlayIdRef.current === ov.id && ov.currentStep !== 1) {
                        pendingOverlayIdRef.current = null;
                    }
                    return false;
                },
                onDrawEnd: (event: any) => {
                    const ov = event?.overlay;
                    if (ov && pendingOverlayIdRef.current === ov.id) {
                        pendingOverlayIdRef.current = null;
                    }
                    setPointsTick((t) => t + 1);
                    return false;
                },
                onPressedMoveEnd: (event: any) => {
                    const ovId = event?.overlay?.id;
                    if (ovId) setSelectedDrawingId(ovId);
                    setPointsTick((t) => t + 1);
                    return false;
                },
                onSelected: (event: any) => {
                    const ovId = event?.overlay?.id;
                    if (ovId) setSelectedDrawingId(ovId);
                    setPointsTick((t) => t + 1);
                    return false;
                },
                onDeselected: (event: any) => {
                    const ovId = event?.overlay?.id;
                    if (ovId) setSelectedDrawingId((prev) => (prev === ovId ? null : prev));
                    return false;
                },
                onRemoved: (event: any) => {
                    if (isRestoringSnapshotRef.current || isHydratingCanvasRef.current) {
                        return false;
                    }
                    const remId = event?.overlay?.id;
                    if (remId) {
                        if (pendingOverlayIdRef.current === remId) pendingOverlayIdRef.current = null;
                        drawnOverlayIdsRef.current = drawnOverlayIdsRef.current.filter((x) => x !== remId);
                        delete overlayGeometriesRef.current[remId];
                        setDrawnItems((prev) => prev.filter((item) => item.id !== remId));
                        setDrawingStylesById((prev) => {
                            if (!(remId in prev)) return prev;
                            const next = { ...prev };
                            delete next[remId];
                            return next;
                        });
                        setSelectedDrawingId((prev) => (prev === remId ? null : prev));
                    }
                    return false;
                },
            } as any);

            return typeof createdId === 'string' ? createdId : null;
        },
        [isRestoringSnapshotRef, isHydratingCanvasRef]
    );

    const reanchorMountedOverlays = useCallback((chart: Chart | null) => {
        if (!chart || drawnOverlayIdsRef.current.length === 0) return;
        const candles = chart.getDataList() || [];
        if (candles.length === 0) return;

        drawnOverlayIdsRef.current.forEach((id) => {
            const savedPts = overlayGeometriesRef.current[id];
            const ov = chart.getOverlayById(id) as any;
            const basePts: OverlayPointCoord[] =
                Array.isArray(savedPts) && savedPts.length > 0
                    ? savedPts
                    : Array.isArray(ov?.points)
                      ? ov.points
                      : [];
            if (basePts.length > 0) {
                const resolved = resolveOverlayPointsAgainstCandles(basePts, candles);
                chart.overrideOverlay({ id, points: resolved } as any);
                overlayGeometriesRef.current[id] = resolved;
            }
        });
    }, []);

    const handleSelectDrawingTool = useCallback(
        (overlayName: string, extendData?: string, label?: string, replacePending?: boolean) => {
            const chart = chartRef.current;
            if (!chart) return;

            setZoomAreaMode(false);
            setZoomBox(null);

            if (replacePending && pendingOverlayIdRef.current) {
                const candidateId = pendingOverlayIdRef.current;
                const ov = chart.getOverlayById(candidateId) as any;
                const isStillUnclicked =
                    ov && typeof ov.isDrawing === 'function' && ov.isDrawing() && ov.currentStep === 1;
                if (isStillUnclicked) {
                    try {
                        chart.removeOverlay(candidateId);
                    } catch (_) {}
                    drawnOverlayIdsRef.current = drawnOverlayIdsRef.current.filter((id) => id !== candidateId);
                    setDrawnItems((prev) => prev.filter((item) => item.id !== candidateId));
                }
                pendingOverlayIdRef.current = null;
            }

            const initialStyle: DrawingStyleState = {
                ...DEFAULT_DRAWING_STYLE,
                lineColor:
                    overlayName === 'tvShortPosition'
                        ? '#ef4444'
                        : overlayName === 'tvLongPosition'
                          ? '#10b981'
                          : '#2962ff',
                fillColor:
                    overlayName === 'tvShortPosition'
                        ? '#ef4444'
                        : overlayName === 'tvLongPosition'
                          ? '#10b981'
                          : '#2962ff',
                textSize: overlayName === 'tvEmojiMarker' ? 24 : 12,
                extendData: extendData || '',
            };

            const id = mountOverlayWithHandlers(chart, {
                name: overlayName,
                extendData,
                mode: magnetMode ? OverlayMode.WeakMagnet : OverlayMode.Normal,
                lock: drawingsLocked,
                visible: drawingsVisible,
                styleState: initialStyle,
            });
            if (id) {
                pendingOverlayIdRef.current = id;
                drawnOverlayIdsRef.current.push(id);
                setSelectedDrawingId(id);
                setDrawingStylesById((prev) => ({ ...prev, [id]: initialStyle }));
                setDrawnItems((prev) => [
                    ...prev,
                    {
                        id,
                        name: overlayName,
                        label: label || overlayName,
                        visible: drawingsVisible,
                        locked: drawingsLocked,
                        color: initialStyle.lineColor,
                        extendData: initialStyle.extendData,
                    },
                ]);
            }
        },
        [chartRef, magnetMode, drawingsLocked, drawingsVisible, mountOverlayWithHandlers]
    );

    const handleCancelPendingTool = useCallback(() => {
        setZoomAreaMode(false);
        setZoomBox(null);
        onCancelCutCandle();
        const chart = chartRef.current;
        if (chart && pendingOverlayIdRef.current) {
            const candidateId = pendingOverlayIdRef.current;
            const ov = chart.getOverlayById(candidateId) as any;
            const isStillUnclicked =
                ov && typeof ov.isDrawing === 'function' && ov.isDrawing() && ov.currentStep === 1;
            if (isStillUnclicked) {
                try {
                    chart.removeOverlay(candidateId);
                } catch (_) {}
                drawnOverlayIdsRef.current = drawnOverlayIdsRef.current.filter((id) => id !== candidateId);
                setDrawnItems((prev) => prev.filter((item) => item.id !== candidateId));
            }
            pendingOverlayIdRef.current = null;
        }
    }, [chartRef, onCancelCutCandle]);

    const handleUndoDrawing = useCallback(() => {
        const chart = chartRef.current;
        if (!chart || drawnOverlayIdsRef.current.length === 0) return;
        const lastId = drawnOverlayIdsRef.current.pop();
        if (lastId) {
            if (pendingOverlayIdRef.current === lastId) pendingOverlayIdRef.current = null;
            try {
                chart.removeOverlay(lastId);
            } catch (_) {}
            setDrawnItems((prev) => prev.filter((item) => item.id !== lastId));
            setSelectedDrawingId((prev) => (prev === lastId ? null : prev));
        }
    }, [chartRef]);

    const handleRemoveDrawingById = useCallback(
        (id: string) => {
            const chart = chartRef.current;
            if (!chart) return;
            if (pendingOverlayIdRef.current === id) pendingOverlayIdRef.current = null;
            try {
                chart.removeOverlay(id);
            } catch (_) {}
            drawnOverlayIdsRef.current = drawnOverlayIdsRef.current.filter((x) => x !== id);
            setDrawnItems((prev) => prev.filter((item) => item.id !== id));
            setSelectedDrawingId((prev) => (prev === id ? null : prev));
        },
        [chartRef]
    );

    const handleSelectDrawingById = useCallback(
        (id: string) => {
            const chart = chartRef.current;
            if (!chart) return;
            setSelectedDrawingId(id);
            setPointsTick((t) => t + 1);
            const ov = chart.getOverlayById(id) as any;
            if (!ov) return;
            setDrawnItems((prev) => prev.map((item) => (item.id === id ? { ...item, visible: true } : item)));
            chart.overrideOverlay({
                id,
                visible: true,
            });
            const firstPt = Array.isArray(ov.points) ? ov.points[0] : null;
            if (firstPt && typeof firstPt.timestamp === 'number') {
                chart.scrollToTimestamp(firstPt.timestamp, 220);
            } else if (firstPt && typeof firstPt.dataIndex === 'number') {
                chart.scrollToDataIndex(firstPt.dataIndex, 220);
            }
        },
        [chartRef]
    );

    const handleUpdateSelectedStyle = useCallback(
        (patch: Partial<DrawingStyleState>) => {
            const chart = chartRef.current;
            const id = selectedDrawingId;
            if (!chart || !id) return;

            setDrawingStylesById((prev) => {
                const current = prev[id] || DEFAULT_DRAWING_STYLE;
                const next: DrawingStyleState = { ...current, ...patch };
                const stylesPayload = buildOverlayStylesPayload(next);
                chart.overrideOverlay({
                    id,
                    extendData: next.extendData,
                    styles: stylesPayload as any,
                });
                setDrawnItems((items) =>
                    items.map((it) =>
                        it.id === id ? { ...it, color: next.lineColor, extendData: next.extendData } : it
                    )
                );
                return { ...prev, [id]: next };
            });
        },
        [chartRef, selectedDrawingId]
    );

    const handleUpdateDrawingLabel = useCallback((id: string, newLabel: string) => {
        setDrawnItems((prev) => prev.map((item) => (item.id === id ? { ...item, label: newLabel } : item)));
    }, []);

    const handleUpdateSelectedPoint = useCallback(
        (pointIndex: number, patch: Partial<OverlayPointCoord>) => {
            const chart = chartRef.current;
            const id = selectedDrawingId;
            if (!chart || !id) return;
            const ov = chart.getOverlayById(id) as any;
            if (!ov || !Array.isArray(ov.points)) return;

            const dataList = chart.getDataList() || [];
            const nextPoints = ov.points.map((pt: any, idx: number) => {
                if (idx !== pointIndex) return { ...pt };
                const updated = { ...pt, ...patch };
                if (typeof patch.dataIndex === 'number' && dataList[patch.dataIndex]) {
                    updated.timestamp = dataList[patch.dataIndex].timestamp;
                }
                return updated;
            });
            chart.overrideOverlay({ id, points: nextPoints });
            setPointsTick((t) => t + 1);
        },
        [chartRef, selectedDrawingId]
    );

    const handleDuplicateDrawing = useCallback(
        (id: string) => {
            const chart = chartRef.current;
            if (!chart) return;
            const ov = chart.getOverlayById(id) as any;
            const sourceItem = drawnItems.find((it) => it.id === id);
            if (!ov || !sourceItem) return;

            const sourceStyle = drawingStylesById[id] || DEFAULT_DRAWING_STYLE;
            const dataList = chart.getDataList() || [];
            const clonedPoints = Array.isArray(ov.points)
                ? ov.points.map((pt: any) => {
                      const nextIdx = typeof pt.dataIndex === 'number' ? pt.dataIndex + 2 : pt.dataIndex;
                      const nextTs =
                          typeof nextIdx === 'number' && dataList[nextIdx]
                              ? dataList[nextIdx].timestamp
                              : pt.timestamp;
                      return {
                          ...pt,
                          timestamp: nextTs,
                          dataIndex: nextIdx,
                          value: typeof pt.value === 'number' ? pt.value * 1.0004 : pt.value,
                      };
                  })
                : [];

            const newId = mountOverlayWithHandlers(chart, {
                name: sourceItem.name,
                points: clonedPoints,
                extendData: sourceStyle.extendData,
                mode: magnetMode ? OverlayMode.WeakMagnet : OverlayMode.Normal,
                lock: false,
                visible: true,
                styleState: sourceStyle,
            });

            if (newId) {
                drawnOverlayIdsRef.current.push(newId);
                overlayGeometriesRef.current[newId] = clonedPoints;
                setDrawingStylesById((prev) => ({ ...prev, [newId]: { ...sourceStyle } }));
                setDrawnItems((prev) => [
                    ...prev,
                    {
                        id: newId,
                        name: sourceItem.name,
                        label: `${sourceItem.label} (${isEn ? 'Copy' : 'Cópia'})`,
                        visible: true,
                        locked: false,
                        color: sourceStyle.lineColor,
                        extendData: sourceStyle.extendData,
                    },
                ]);
                setSelectedDrawingId(newId);
                setPointsTick((t) => t + 1);
            }
        },
        [chartRef, drawnItems, drawingStylesById, magnetMode, mountOverlayWithHandlers, isEn]
    );

    const handleResetDrawingStyle = useCallback(
        (id: string) => {
            const chart = chartRef.current;
            if (!chart) return;
            const item = drawnItems.find((it) => it.id === id);
            const resetStyle: DrawingStyleState = {
                ...DEFAULT_DRAWING_STYLE,
                lineColor:
                    item?.name === 'tvShortPosition'
                        ? '#ef4444'
                        : item?.name === 'tvLongPosition'
                          ? '#10b981'
                          : '#2962ff',
                fillColor:
                    item?.name === 'tvShortPosition'
                        ? '#ef4444'
                        : item?.name === 'tvLongPosition'
                          ? '#10b981'
                          : '#2962ff',
                textSize: item?.name === 'tvEmojiMarker' ? 24 : 12,
                extendData: drawingStylesById[id]?.extendData || '',
            };
            setDrawingStylesById((prev) => ({ ...prev, [id]: resetStyle }));
            chart.overrideOverlay({
                id,
                styles: buildOverlayStylesPayload(resetStyle) as any,
            });
            setDrawnItems((prev) => prev.map((it) => (it.id === id ? { ...it, color: resetStyle.lineColor } : it)));
        },
        [chartRef, drawnItems, drawingStylesById]
    );

    const handleToggleDrawingVisibleById = useCallback(
        (id: string) => {
            const chart = chartRef.current;
            if (!chart) return;
            setDrawnItems((prev) =>
                prev.map((item) => {
                    if (item.id !== id) return item;
                    const nextVis = item.visible === false ? true : false;
                    chart.overrideOverlay({ id, visible: nextVis });
                    return { ...item, visible: nextVis };
                })
            );
        },
        [chartRef]
    );

    const handleToggleDrawingLockById = useCallback(
        (id: string) => {
            const chart = chartRef.current;
            if (!chart) return;
            setDrawnItems((prev) =>
                prev.map((item) => {
                    if (item.id !== id) return item;
                    const nextLock = !item.locked;
                    chart.overrideOverlay({ id, lock: nextLock });
                    return { ...item, locked: nextLock };
                })
            );
        },
        [chartRef]
    );

    const handleClearDrawings = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        pendingOverlayIdRef.current = null;
        drawnOverlayIdsRef.current.forEach((id) => {
            try {
                chart.removeOverlay(id);
            } catch (_) {}
        });
        drawnOverlayIdsRef.current = [];
        setDrawnItems([]);
        setSelectedDrawingId(null);
    }, [chartRef]);

    const handleZoomIn = useCallback(() => {
        setZoomBox(null);
        setZoomAreaMode((prev) => !prev);
    }, []);

    const handleToggleMagnet = useCallback(() => {
        setMagnetMode((prev) => {
            const next = !prev;
            drawnOverlayIdsRef.current.forEach((id) => {
                chartRef.current?.overrideOverlay({ id, mode: next ? OverlayMode.WeakMagnet : OverlayMode.Normal });
            });
            return next;
        });
    }, [chartRef]);

    const handleToggleLock = useCallback(() => {
        setDrawingsLocked((prev) => {
            const next = !prev;
            drawnOverlayIdsRef.current.forEach((id) => {
                chartRef.current?.overrideOverlay({ id, lock: next });
            });
            setDrawnItems((items) => items.map((it) => ({ ...it, locked: next })));
            return next;
        });
    }, [chartRef]);

    const handleToggleVisible = useCallback(() => {
        setDrawingsVisible((prev) => {
            const next = !prev;
            drawnOverlayIdsRef.current.forEach((id) => {
                chartRef.current?.overrideOverlay({ id, visible: next });
            });
            setDrawnItems((items) => items.map((it) => ({ ...it, visible: next })));
            return next;
        });
    }, [chartRef]);

    const placeHorizontalLineAtPrice = useCallback(
        (price: number, ts: number, decimals: number) => {
            const chart = chartRef.current;
            if (!chart || !Number.isFinite(price)) return;
            const rounded = Number(price.toFixed(decimals));
            const pts: OverlayPointCoord[] = [{ timestamp: ts, value: rounded }];
            const styleState: DrawingStyleState = { ...DEFAULT_DRAWING_STYLE };
            const newId = mountOverlayWithHandlers(chart, {
                name: 'horizontalStraightLine',
                points: pts,
                mode: magnetMode ? OverlayMode.WeakMagnet : OverlayMode.Normal,
                lock: drawingsLocked,
                visible: drawingsVisible,
                styleState,
            });
            if (newId) {
                drawnOverlayIdsRef.current.push(newId);
                overlayGeometriesRef.current[newId] = pts;
                setDrawingStylesById((prev) => ({ ...prev, [newId]: styleState }));
                setDrawnItems((prev) => [
                    ...prev,
                    {
                        id: newId,
                        name: 'horizontalStraightLine',
                        label: `Linha Horizontal (${rounded})`,
                        visible: drawingsVisible,
                        locked: drawingsLocked,
                        color: styleState.lineColor,
                    },
                ]);
                setPointsTick((t) => t + 1);
            }
        },
        [chartRef, mountOverlayWithHandlers, magnetMode, drawingsLocked, drawingsVisible]
    );

    const selectedDrawnItem = useMemo(
        () => (selectedDrawingId ? drawnItems.find((it) => it.id === selectedDrawingId) || null : null),
        [selectedDrawingId, drawnItems]
    );

    const selectedStyleState = useMemo<DrawingStyleState>(
        () => (selectedDrawingId && drawingStylesById[selectedDrawingId]) || DEFAULT_DRAWING_STYLE,
        [selectedDrawingId, drawingStylesById]
    );

    const selectedOverlayPoints = useMemo<OverlayPointCoord[]>(() => {
        if (!selectedDrawingId || !chartRef.current) return [];
        const ov = chartRef.current.getOverlayById(selectedDrawingId) as any;
        if (!ov || !Array.isArray(ov.points)) return [];
        return ov.points.map((pt: any) => ({
            dataIndex: pt.dataIndex,
            timestamp: pt.timestamp,
            value: pt.value,
        }));
    }, [chartRef, selectedDrawingId, pointsTick]);

    const currentDrawingToolsState = useMemo<DrawingToolsWorkspaceState>(
        () => ({
            magnetMode,
            drawingsLocked,
            drawingsVisible,
        }),
        [magnetMode, drawingsLocked, drawingsVisible]
    );

    return {
        drawnOverlayIdsRef,
        pendingOverlayIdRef,
        drawnItems,
        setDrawnItems,
        overlayGeometriesRef,
        selectedDrawingId,
        setSelectedDrawingId,
        drawingStylesById,
        setDrawingStylesById,
        pointsTick,
        setPointsTick,
        magnetMode,
        setMagnetMode,
        drawingsLocked,
        setDrawingsLocked,
        drawingsVisible,
        setDrawingsVisible,
        zoomAreaMode,
        setZoomAreaMode,
        zoomAreaModeRef,
        zoomBox,
        setZoomBox,
        captureCurrentOverlayGeometries,
        mountOverlayWithHandlers,
        reanchorMountedOverlays,
        placeHorizontalLineAtPrice,
        handleSelectDrawingTool,
        handleCancelPendingTool,
        handleUndoDrawing,
        handleRemoveDrawingById,
        handleSelectDrawingById,
        handleUpdateSelectedStyle,
        handleUpdateDrawingLabel,
        handleUpdateSelectedPoint,
        handleDuplicateDrawing,
        handleResetDrawingStyle,
        handleToggleDrawingVisibleById,
        handleToggleDrawingLockById,
        handleClearDrawings,
        handleZoomIn,
        handleToggleMagnet,
        handleToggleLock,
        handleToggleVisible,
        selectedDrawnItem,
        selectedStyleState,
        selectedOverlayPoints,
        currentDrawingToolsState,
    };
}
