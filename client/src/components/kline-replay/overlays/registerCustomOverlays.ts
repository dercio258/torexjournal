import { registerOverlay, KLineData, utils, LineType } from 'klinecharts';

let customOverlaysRegistered = false;
let chartDataGetter: (() => KLineData[]) | null = null;

export function setOverlayChartDataGetter(getter: (() => KLineData[]) | null) {
    chartDataGetter = getter;
}

function formatCompactVolume(vol: number): string {
    if (!Number.isFinite(vol) || vol <= 0) return '0';
    if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(2)} B`;
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)} M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(2)} K`;
    return vol.toFixed(0);
}

function formatDurationMs(ms: number): string {
    const abs = Math.abs(ms);
    const totalMinutes = Math.round(abs / 60000);
    if (totalMinutes <= 0) return '0m';
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const mins = totalMinutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 && days === 0) parts.push(`${mins}m`);
    return parts.join(' ') || '0m';
}

function formatAxisDate(ts?: number): string {
    if (!ts || !Number.isFinite(ts)) return '';
    const d = new Date(ts);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayName = days[d.getDay()];
    const dayNum = String(d.getDate()).padStart(2, '0');
    const mon = months[d.getMonth()];
    const yr = String(d.getFullYear()).slice(-2);
    const hr = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dayName} ${dayNum} ${mon} '${yr}  ${hr}:${min}`;
}

function rotateCoordinate(point: { x: number; y: number }, center: { x: number; y: number }, angle: number) {
    const x = (point.x - center.x) * Math.cos(angle) - (point.y - center.y) * Math.sin(angle) + center.x;
    const y = (point.x - center.x) * Math.sin(angle) + (point.y - center.y) * Math.cos(angle) + center.y;
    return { x, y };
}

function getRayLine(coordinates: Array<{ x: number; y: number }>, bounding: { width: number; height: number }) {
    if (coordinates.length > 1) {
        let point: { x: number; y: number };
        if (coordinates[0].x === coordinates[1].x && coordinates[0].y !== coordinates[1].y) {
            if (coordinates[0].y < coordinates[1].y) {
                point = { x: coordinates[0].x, y: bounding.height };
            } else {
                point = { x: coordinates[0].x, y: 0 };
            }
        } else if (coordinates[0].x > coordinates[1].x) {
            point = {
                x: 0,
                y: utils.getLinearYFromCoordinates(coordinates[0], coordinates[1], { x: 0, y: coordinates[0].y }),
            };
        } else {
            point = {
                x: bounding.width,
                y: utils.getLinearYFromCoordinates(coordinates[0], coordinates[1], { x: bounding.width, y: coordinates[0].y }),
            };
        }
        return { coordinates: [coordinates[0], point] };
    }
    return [];
}

function getDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
    const dx = Math.abs(p1.x - p2.x);
    const dy = Math.abs(p1.y - p2.y);
    return Math.sqrt(dx * dx + dy * dy);
}

/** Extract user-customized style properties from overlay.styles with sensible fallbacks */
function resolveOverlayStyles(overlay: any, defaults: {
    lineColor?: string;
    lineSize?: number;
    fillColor?: string;
    textColor?: string;
    textSize?: number;
}) {
    const s = overlay?.styles || {};
    const lineColor = s.line?.color || s.polygon?.borderColor || s.rect?.borderColor || s.circle?.borderColor || defaults.lineColor || '#2962ff';
    const lineSize = typeof s.line?.size === 'number' ? s.line.size : (typeof s.polygon?.borderSize === 'number' ? s.polygon.borderSize : (defaults.lineSize ?? 2));
    const lineStyle = s.line?.style || s.polygon?.borderStyle || LineType.Solid;
    const dashedValue = Array.isArray(s.line?.dashedValue) ? s.line.dashedValue : [4, 4];
    const fillColor = s.polygon?.color || s.rect?.color || s.circle?.color || defaults.fillColor || 'rgba(41, 98, 255, 0.16)';
    const textColor = s.text?.color || defaults.textColor || '#ffffff';
    const textSize = typeof s.text?.size === 'number' ? s.text.size : (defaults.textSize ?? 11);
    const textBg = s.text?.backgroundColor || lineColor;

    return {
        lineColor,
        lineSize,
        lineStyle,
        dashedValue,
        fillColor,
        textColor,
        textSize,
        textBg,
    };
}

/**
 * Registers all TradingView / Traynio custom overlays and Pro geometric/Fibonacci/Wave overlays in klinecharts.
 * Every overlay respects `overlay.styles` so the Floating Style Toolbar and Settings Modal can customize
 * color, opacity, line thickness, line style (solid/dashed/dotted), fill color, text size, and labels in real time.
 */
export function ensureCustomOverlays() {
    if (customOverlaysRegistered) return;
    customOverlaysRegistered = true;

    try {
        // 1. Arrow
        registerOverlay({
            name: 'arrow',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                if (coordinates.length > 1) {
                    const st = resolveOverlayStyles(overlay, { lineColor: '#2962ff', lineSize: 2 });
                    const flag = coordinates[1].x > coordinates[0].x ? 0 : 1;
                    const kb = utils.getLinearSlopeIntercept(coordinates[0], coordinates[1]);
                    let offsetAngle: number;
                    if (kb) {
                        offsetAngle = Math.atan(kb[0]) + Math.PI * flag;
                    } else {
                        offsetAngle = coordinates[1].y > coordinates[0].y ? Math.PI / 2 : (Math.PI / 2) * 3;
                    }
                    const r1 = rotateCoordinate({ x: coordinates[1].x - 9, y: coordinates[1].y + 4.5 }, coordinates[1], offsetAngle);
                    const r2 = rotateCoordinate({ x: coordinates[1].x - 9, y: coordinates[1].y - 4.5 }, coordinates[1], offsetAngle);
                    return [
                        {
                            type: 'line',
                            attrs: { coordinates },
                            styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                        },
                        {
                            type: 'line',
                            ignoreEvent: true,
                            attrs: { coordinates: [r1, coordinates[1], r2] },
                            styles: { color: st.lineColor, size: st.lineSize },
                        },
                    ];
                }
                return [];
            },
        });

        // 2. Circle
        registerOverlay({
            name: 'circle',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                if (coordinates.length > 1) {
                    const st = resolveOverlayStyles(overlay, {
                        lineColor: '#2962ff',
                        lineSize: 2,
                        fillColor: 'rgba(41, 98, 255, 0.16)',
                    });
                    const radius = getDistance(coordinates[0], coordinates[1]);
                    return {
                        type: 'circle',
                        attrs: { ...coordinates[0], r: radius },
                        styles: {
                            style: 'stroke_fill',
                            color: st.fillColor,
                            borderColor: st.lineColor,
                            borderSize: st.lineSize,
                            borderStyle: st.lineStyle,
                            borderDashedValue: st.dashedValue,
                        },
                    };
                }
                return [];
            },
        });

        // 3. Rectangle (Zona / Order Block)
        registerOverlay({
            name: 'rect',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                if (coordinates.length > 1) {
                    const st = resolveOverlayStyles(overlay, {
                        lineColor: '#2962ff',
                        lineSize: 2,
                        fillColor: 'rgba(41, 98, 255, 0.16)',
                    });
                    const figs: any[] = [
                        {
                            type: 'polygon',
                            attrs: {
                                coordinates: [
                                    coordinates[0],
                                    { x: coordinates[1].x, y: coordinates[0].y },
                                    coordinates[1],
                                    { x: coordinates[0].x, y: coordinates[1].y },
                                ],
                            },
                            styles: {
                                style: 'stroke_fill',
                                color: st.fillColor,
                                borderColor: st.lineColor,
                                borderSize: st.lineSize,
                                borderStyle: st.lineStyle,
                                borderDashedValue: st.dashedValue,
                            },
                        },
                    ];
                    const customText = typeof overlay.extendData === 'string' ? overlay.extendData.trim() : '';
                    if (customText) {
                        const midX = (coordinates[0].x + coordinates[1].x) / 2;
                        const midY = (coordinates[0].y + coordinates[1].y) / 2;
                        figs.push({
                            type: 'text',
                            ignoreEvent: true,
                            attrs: { x: midX, y: midY, text: customText, align: 'center', baseline: 'middle' },
                            styles: {
                                color: st.textColor,
                                size: st.textSize,
                                weight: 'bold',
                                backgroundColor: 'transparent',
                            },
                        });
                    }
                    return figs;
                }
                return [];
            },
        });

        // 4. Parallelogram
        registerOverlay({
            name: 'parallelogram',
            totalStep: 4,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                const st = resolveOverlayStyles(overlay, {
                    lineColor: '#2962ff',
                    lineSize: 2,
                    fillColor: 'rgba(41, 98, 255, 0.16)',
                });
                if (coordinates.length === 2) {
                    return [
                        {
                            type: 'line',
                            ignoreEvent: true,
                            attrs: { coordinates },
                            styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                        },
                    ];
                }
                if (coordinates.length === 3) {
                    const p4 = { x: coordinates[0].x + (coordinates[2].x - coordinates[1].x), y: coordinates[2].y };
                    return [
                        {
                            type: 'polygon',
                            attrs: { coordinates: [coordinates[0], coordinates[1], coordinates[2], p4] },
                            styles: {
                                style: 'stroke_fill',
                                color: st.fillColor,
                                borderColor: st.lineColor,
                                borderSize: st.lineSize,
                                borderStyle: st.lineStyle,
                                borderDashedValue: st.dashedValue,
                            },
                        },
                    ];
                }
                return [];
            },
        });

        // 5. Triangle
        registerOverlay({
            name: 'triangle',
            totalStep: 4,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                const st = resolveOverlayStyles(overlay, {
                    lineColor: '#2962ff',
                    lineSize: 2,
                    fillColor: 'rgba(41, 98, 255, 0.16)',
                });
                return [
                    {
                        type: 'polygon',
                        attrs: { coordinates },
                        styles: {
                            style: 'stroke_fill',
                            color: st.fillColor,
                            borderColor: st.lineColor,
                            borderSize: st.lineSize,
                            borderStyle: st.lineStyle,
                            borderDashedValue: st.dashedValue,
                        },
                    },
                ];
            },
        });

        // 6. Fibonacci Circle (Multi-ring colorful concentric Fib circles like Traynio screenshot)
        registerOverlay({
            name: 'fibonacciCircle',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                if (coordinates.length > 1) {
                    const st = resolveOverlayStyles(overlay, {
                        lineColor: '#2962ff',
                        lineSize: 1.5,
                        fillColor: 'rgba(41, 98, 255, 0.08)',
                        textColor: '#2962ff',
                        textSize: 10,
                    });
                    const radius = getDistance(coordinates[0], coordinates[1]);
                    const levels = [
                        { pct: 0.236, color: '#ef4444', fill: 'rgba(239, 68, 68, 0.06)' },
                        { pct: 0.382, color: '#f59e0b', fill: 'rgba(245, 158, 11, 0.06)' },
                        { pct: 0.5, color: '#10b981', fill: 'rgba(16, 185, 129, 0.06)' },
                        { pct: 0.618, color: '#06b6d4', fill: 'rgba(6, 182, 212, 0.06)' },
                        { pct: 0.786, color: '#3b82f6', fill: 'rgba(59, 130, 246, 0.06)' },
                        { pct: 1.0, color: st.lineColor, fill: st.fillColor },
                        { pct: 1.618, color: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.06)' },
                        { pct: 2.618, color: '#ec4899', fill: 'rgba(236, 72, 153, 0.05)' },
                    ];
                    const hasCustomColor = Boolean(overlay?.styles?.line?.color);
                    const figures: any[] = [];
                    // Render from largest to smallest so inner rings sit cleanly inside outer rings
                    [...levels].reverse().forEach((lv) => {
                        const r = radius * lv.pct;
                        const ringColor = hasCustomColor ? st.lineColor : lv.color;
                        const ringFill = hasCustomColor ? st.fillColor : lv.fill;
                        figures.push({
                            type: 'circle',
                            attrs: { ...coordinates[0], r },
                            styles: {
                                style: 'stroke_fill',
                                color: ringFill,
                                borderColor: ringColor,
                                borderSize: st.lineSize,
                                borderStyle: st.lineStyle,
                                borderDashedValue: st.dashedValue,
                            },
                        });
                        figures.push({
                            type: 'text',
                            ignoreEvent: true,
                            attrs: {
                                x: coordinates[0].x,
                                y: coordinates[0].y + r - 3,
                                text: `${lv.pct}`,
                                align: 'center',
                                baseline: 'bottom',
                            },
                            styles: {
                                color: ringColor,
                                size: st.textSize,
                                weight: 'bold',
                                backgroundColor: 'transparent',
                            },
                        });
                    });
                    return figures;
                }
                return [];
            },
        });

        // 7. Fibonacci Segment
        registerOverlay({
            name: 'fibonacciSegment',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay, precision }) => {
                const lines: any[] = [];
                const texts: any[] = [];
                const st = resolveOverlayStyles(overlay, { lineColor: '#2962ff', lineSize: 1.5, textColor: '#2962ff', textSize: 11 });
                if (coordinates.length > 1) {
                    const textX = coordinates[1].x > coordinates[0].x ? coordinates[0].x : coordinates[1].x;
                    const percents = [1, 0.786, 0.618, 0.5, 0.382, 0.236, 0];
                    const yDif = coordinates[0].y - coordinates[1].y;
                    const points = overlay.points;
                    const v0 = points[0]?.value ?? 0;
                    const v1 = points[1]?.value ?? 0;
                    const valueDif = v0 - v1;
                    percents.forEach((p) => {
                        const y = coordinates[1].y + yDif * p;
                        const price = (v1 + valueDif * p).toFixed(precision.price);
                        lines.push({ coordinates: [{ x: coordinates[0].x, y }, { x: coordinates[1].x, y }] });
                        texts.push({
                            x: textX,
                            y,
                            text: `${price} (${(p * 100).toFixed(1)}%)`,
                            baseline: 'bottom',
                        });
                    });
                }
                return [
                    {
                        type: 'line',
                        attrs: lines,
                        styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                    },
                    {
                        type: 'text',
                        ignoreEvent: true,
                        attrs: texts,
                        styles: { color: st.lineColor, size: st.textSize, backgroundColor: 'transparent' },
                    },
                ];
            },
        });

        // 8. Fibonacci Spiral
        registerOverlay({
            name: 'fibonacciSpiral',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, bounding, overlay }) => {
                if (coordinates.length > 1) {
                    const st = resolveOverlayStyles(overlay, { lineColor: '#2962ff', lineSize: 1.5 });
                    const startRadius = getDistance(coordinates[0], coordinates[1]) / Math.sqrt(24);
                    const flag = coordinates[1].x > coordinates[0].x ? 0 : 1;
                    const kb = utils.getLinearSlopeIntercept(coordinates[0], coordinates[1]);
                    let offsetAngle: number;
                    if (kb) {
                        offsetAngle = Math.atan(kb[0]) + Math.PI * flag;
                    } else {
                        offsetAngle = coordinates[1].y > coordinates[0].y ? Math.PI / 2 : (Math.PI / 2) * 3;
                    }
                    const rotatePoint1 = rotateCoordinate(
                        { x: coordinates[0].x - startRadius, y: coordinates[0].y },
                        coordinates[0],
                        offsetAngle
                    );
                    const rotatePoint2 = rotateCoordinate(
                        { x: coordinates[0].x - startRadius, y: coordinates[0].y - startRadius },
                        coordinates[0],
                        offsetAngle
                    );
                    const arcs: any[] = [
                        {
                            ...rotatePoint1,
                            r: startRadius,
                            startAngle: offsetAngle,
                            endAngle: offsetAngle + Math.PI / 2,
                        },
                        {
                            ...rotatePoint2,
                            r: startRadius * 2,
                            startAngle: offsetAngle + Math.PI / 2,
                            endAngle: offsetAngle + Math.PI,
                        },
                    ];
                    let x = coordinates[0].x - startRadius;
                    let y = coordinates[0].y - startRadius;
                    for (let i = 2; i < 9; i++) {
                        const r = arcs[i - 2].r + arcs[i - 1].r;
                        let startAngle = 0;
                        switch (i % 4) {
                            case 0:
                                startAngle = offsetAngle;
                                x -= arcs[i - 2].r;
                                break;
                            case 1:
                                startAngle = offsetAngle + Math.PI / 2;
                                y -= arcs[i - 2].r;
                                break;
                            case 2:
                                startAngle = offsetAngle + Math.PI;
                                x += arcs[i - 2].r;
                                break;
                            case 3:
                                startAngle = offsetAngle + (Math.PI / 2) * 3;
                                y += arcs[i - 2].r;
                                break;
                        }
                        const endAngle = startAngle + Math.PI / 2;
                        const rotatePoint = rotateCoordinate({ x, y }, coordinates[0], offsetAngle);
                        arcs.push({ ...rotatePoint, r, startAngle, endAngle });
                    }
                    return [
                        {
                            type: 'arc',
                            attrs: arcs,
                            styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                        },
                        {
                            type: 'line',
                            attrs: getRayLine(coordinates, bounding),
                            styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                        },
                    ];
                }
                return [];
            },
        });

        // 9. Fibonacci Speed Resistance Fan
        registerOverlay({
            name: 'fibonacciSpeedResistanceFan',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, bounding, overlay }) => {
                const st = resolveOverlayStyles(overlay, { lineColor: '#2962ff', lineSize: 1.5, textSize: 10 });
                const lines1: any[] = [];
                let lines2: any[] = [];
                const texts: any[] = [];
                if (coordinates.length > 1) {
                    const textOffsetX = coordinates[1].x > coordinates[0].x ? -38 : 4;
                    const textOffsetY = coordinates[1].y > coordinates[0].y ? -2 : 20;
                    const xDif = coordinates[1].x - coordinates[0].x;
                    const yDif = coordinates[1].y - coordinates[0].y;
                    [1, 0.75, 0.618, 0.5, 0.382, 0.25, 0].forEach((p) => {
                        const x = coordinates[1].x - xDif * p;
                        const y = coordinates[1].y - yDif * p;
                        lines1.push({ coordinates: [{ x, y: coordinates[0].y }, { x, y: coordinates[1].y }] });
                        lines1.push({ coordinates: [{ x: coordinates[0].x, y }, { x: coordinates[1].x, y }] });
                        lines2 = lines2.concat(getRayLine([coordinates[0], { x, y: coordinates[1].y }], bounding));
                        lines2 = lines2.concat(getRayLine([coordinates[0], { x: coordinates[1].x, y }], bounding));
                        texts.unshift({ x: coordinates[0].x + textOffsetX, y: y + 10, text: `${p.toFixed(3)}` });
                        texts.unshift({ x: x - 18, y: coordinates[0].y + textOffsetY, text: `${p.toFixed(3)}` });
                    });
                }
                return [
                    {
                        type: 'line',
                        attrs: lines1,
                        styles: { color: st.lineColor, size: st.lineSize, style: LineType.Dashed, dashedValue: [3, 3] },
                    },
                    {
                        type: 'line',
                        attrs: lines2,
                        styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                    },
                    {
                        type: 'text',
                        ignoreEvent: true,
                        attrs: texts,
                        styles: { color: st.lineColor, size: st.textSize, backgroundColor: 'transparent' },
                    },
                ];
            },
        });

        // 10. Gann Box
        registerOverlay({
            name: 'gannBox',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                if (coordinates.length > 1) {
                    const st = resolveOverlayStyles(overlay, {
                        lineColor: '#2962ff',
                        lineSize: 1.5,
                        fillColor: 'rgba(41, 98, 255, 0.14)',
                    });
                    const quarterYDis = (coordinates[1].y - coordinates[0].y) / 4;
                    const xDis = coordinates[1].x - coordinates[0].x;
                    const dashedLines = [
                        { coordinates: [coordinates[0], { x: coordinates[1].x, y: coordinates[1].y - quarterYDis }] },
                        { coordinates: [coordinates[0], { x: coordinates[1].x, y: coordinates[1].y - quarterYDis * 2 }] },
                        { coordinates: [{ x: coordinates[0].x, y: coordinates[1].y }, { x: coordinates[1].x, y: coordinates[0].y + quarterYDis }] },
                        { coordinates: [{ x: coordinates[0].x, y: coordinates[1].y }, { x: coordinates[1].x, y: coordinates[0].y + quarterYDis * 2 }] },
                        { coordinates: [{ ...coordinates[0] }, { x: coordinates[0].x + xDis * 0.236, y: coordinates[1].y }] },
                        { coordinates: [{ ...coordinates[0] }, { x: coordinates[0].x + xDis * 0.5, y: coordinates[1].y }] },
                        { coordinates: [{ x: coordinates[0].x, y: coordinates[1].y }, { x: coordinates[0].x + xDis * 0.236, y: coordinates[0].y }] },
                        { coordinates: [{ x: coordinates[0].x, y: coordinates[1].y }, { x: coordinates[0].x + xDis * 0.5, y: coordinates[0].y }] },
                    ];
                    const solidLines = [
                        { coordinates: [coordinates[0], coordinates[1]] },
                        { coordinates: [{ x: coordinates[0].x, y: coordinates[1].y }, { x: coordinates[1].x, y: coordinates[0].y }] },
                    ];
                    return [
                        {
                            type: 'line',
                            attrs: [
                                { coordinates: [coordinates[0], { x: coordinates[1].x, y: coordinates[0].y }] },
                                { coordinates: [{ x: coordinates[1].x, y: coordinates[0].y }, coordinates[1]] },
                                { coordinates: [coordinates[1], { x: coordinates[0].x, y: coordinates[1].y }] },
                                { coordinates: [{ x: coordinates[0].x, y: coordinates[1].y }, coordinates[0]] },
                            ],
                            styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                        },
                        {
                            type: 'polygon',
                            ignoreEvent: true,
                            attrs: {
                                coordinates: [
                                    coordinates[0],
                                    { x: coordinates[1].x, y: coordinates[0].y },
                                    coordinates[1],
                                    { x: coordinates[0].x, y: coordinates[1].y },
                                ],
                            },
                            styles: { style: 'fill', color: st.fillColor },
                        },
                        {
                            type: 'line',
                            attrs: dashedLines,
                            styles: { color: st.lineColor, size: Math.max(1, st.lineSize - 0.5), style: LineType.Dashed, dashedValue: [3, 3] },
                        },
                        {
                            type: 'line',
                            attrs: solidLines,
                            styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                        },
                    ];
                }
                return [];
            },
        });

        // 11. Elliott / Wave Overlays (threeWaves, fiveWaves, eightWaves, anyWaves)
        const waveConfigs = [
            { name: 'threeWaves', totalStep: 5, labels: ['(0)', '(1)', '(2)', '(3)'] },
            { name: 'fiveWaves', totalStep: 7, labels: ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)'] },
            { name: 'eightWaves', totalStep: 10, labels: ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)', '(A)', '(B)', '(C)'] },
            { name: 'anyWaves', totalStep: Number.MAX_SAFE_INTEGER, labels: [] as string[] },
        ];
        waveConfigs.forEach((wc) => {
            registerOverlay({
                name: wc.name,
                totalStep: wc.totalStep,
                needDefaultPointFigure: true,
                needDefaultXAxisFigure: true,
                needDefaultYAxisFigure: true,
                createPointFigures: ({ coordinates, overlay }) => {
                    const st = resolveOverlayStyles(overlay, { lineColor: '#2962ff', lineSize: 2, textColor: '#2962ff', textSize: 12 });
                    const texts = coordinates.map((c, i) => ({
                        ...c,
                        text: wc.labels[i] || `(${i})`,
                        baseline: 'bottom',
                    }));
                    return [
                        {
                            type: 'line',
                            attrs: { coordinates },
                            styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                        },
                        {
                            type: 'text',
                            ignoreEvent: true,
                            attrs: texts,
                            styles: { color: st.lineColor, size: st.textSize, weight: 'bold', backgroundColor: 'transparent' },
                        },
                    ];
                },
            });
        });

        // 12. ABCD Harmonic Pattern
        registerOverlay({
            name: 'abcd',
            totalStep: 5,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                const st = resolveOverlayStyles(overlay, { lineColor: '#2962ff', lineSize: 2, textColor: '#2962ff', textSize: 12 });
                let acLine: any[] = [];
                let bdLine: any[] = [];
                const tags = ['A', 'B', 'C', 'D'];
                const texts = coordinates.map((c, i) => ({
                    ...c,
                    baseline: 'bottom',
                    text: `(${tags[i]})`,
                }));
                if (coordinates.length > 2) {
                    acLine = [coordinates[0], coordinates[2]];
                    if (coordinates.length > 3) {
                        bdLine = [coordinates[1], coordinates[3]];
                    }
                }
                return [
                    {
                        type: 'line',
                        attrs: { coordinates },
                        styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                    },
                    {
                        type: 'line',
                        attrs: [{ coordinates: acLine }, { coordinates: bdLine }],
                        styles: { color: st.lineColor, size: Math.max(1, st.lineSize - 0.5), style: LineType.Dashed, dashedValue: [4, 4] },
                    },
                    {
                        type: 'text',
                        ignoreEvent: true,
                        attrs: texts,
                        styles: { color: st.lineColor, size: st.textSize, weight: 'bold', backgroundColor: 'transparent' },
                    },
                ];
            },
        });

        // 13. XABCD Harmonic Pattern
        registerOverlay({
            name: 'xabcd',
            totalStep: 6,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                const st = resolveOverlayStyles(overlay, {
                    lineColor: '#2962ff',
                    lineSize: 2,
                    fillColor: 'rgba(41, 98, 255, 0.16)',
                    textColor: '#2962ff',
                    textSize: 12,
                });
                const dashedLines: any[] = [];
                const polygons: any[] = [];
                const tags = ['X', 'A', 'B', 'C', 'D'];
                const texts = coordinates.map((c, i) => ({
                    ...c,
                    baseline: 'bottom',
                    text: `(${tags[i]})`,
                }));
                if (coordinates.length > 2) {
                    dashedLines.push({ coordinates: [coordinates[0], coordinates[2]] });
                    polygons.push({ coordinates: [coordinates[0], coordinates[1], coordinates[2]] });
                    if (coordinates.length > 3) {
                        dashedLines.push({ coordinates: [coordinates[1], coordinates[3]] });
                        if (coordinates.length > 4) {
                            dashedLines.push({ coordinates: [coordinates[2], coordinates[4]] });
                            polygons.push({ coordinates: [coordinates[2], coordinates[3], coordinates[4]] });
                        }
                    }
                }
                return [
                    {
                        type: 'line',
                        attrs: { coordinates },
                        styles: { color: st.lineColor, size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                    },
                    {
                        type: 'line',
                        attrs: dashedLines,
                        styles: { color: st.lineColor, size: Math.max(1, st.lineSize - 0.5), style: LineType.Dashed, dashedValue: [4, 4] },
                    },
                    {
                        type: 'polygon',
                        ignoreEvent: true,
                        attrs: polygons,
                        styles: { style: 'fill', color: st.fillColor },
                    },
                    {
                        type: 'text',
                        ignoreEvent: true,
                        attrs: texts,
                        styles: { color: st.lineColor, size: st.textSize, weight: 'bold', backgroundColor: 'transparent' },
                    },
                ];
            },
        });

        // 14. Long Position R:R Box
        registerOverlay({
            name: 'tvLongPosition',
            totalStep: 4,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                if (coordinates.length < 2) return [];
                const st = resolveOverlayStyles(overlay, {
                    lineColor: '#10b981',
                    lineSize: 1.5,
                    fillColor: 'rgba(16, 185, 129, 0.22)',
                    textColor: '#ffffff',
                    textSize: 11,
                });
                const p1 = coordinates[0];
                const p2 = coordinates[1];
                const p3 = coordinates[2] || {
                    x: p2.x,
                    y: p1.y + Math.abs(p1.y - p2.y) * 0.5,
                };
                const left = Math.min(p1.x, p2.x);
                const width = Math.max(Math.abs(p2.x - p1.x), 90);
                const entryY = p1.y;
                const tpY = Math.min(p2.y, entryY - 12);
                const slY = Math.max(p3.y, entryY + 12);

                const v1 = overlay.points[0]?.value ?? 0;
                const v2 = overlay.points[1]?.value ?? v1;
                const v3 = overlay.points[2]?.value ?? v1 - Math.abs(v2 - v1) * 0.5;
                const risk = Math.max(Math.abs(v1 - v3), 0.00001);
                const reward = Math.abs(v2 - v1);
                const rr = (reward / risk).toFixed(2);
                const customNote = typeof overlay.extendData === 'string' && overlay.extendData.trim() ? ` · ${overlay.extendData.trim()}` : '';

                return [
                    {
                        type: 'rect',
                        attrs: { x: left, y: tpY, width, height: Math.max(entryY - tpY, 2) },
                        styles: {
                            style: 'stroke_fill',
                            color: overlay?.styles?.polygon?.color || 'rgba(16, 185, 129, 0.22)',
                            borderColor: st.lineColor,
                            borderSize: st.lineSize,
                        },
                    },
                    {
                        type: 'rect',
                        attrs: { x: left, y: entryY, width, height: Math.max(slY - entryY, 2) },
                        styles: {
                            style: 'stroke_fill',
                            color: 'rgba(239, 68, 68, 0.22)',
                            borderColor: '#ef4444',
                            borderSize: st.lineSize,
                        },
                    },
                    {
                        type: 'line',
                        attrs: { coordinates: [{ x: left, y: entryY }, { x: left + width, y: entryY }] },
                        styles: { color: '#ffffff', size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                    },
                    {
                        type: 'text',
                        ignoreEvent: true,
                        attrs: {
                            x: left + 6,
                            y: tpY + 14,
                            text: `LONG  R:R 1:${rr}${customNote}`,
                        },
                        styles: {
                            color: st.textColor,
                            backgroundColor: st.lineColor,
                            size: st.textSize,
                            weight: 'bold',
                            paddingLeft: 6,
                            paddingRight: 6,
                            paddingTop: 3,
                            paddingBottom: 3,
                            borderRadius: 3,
                        },
                    },
                ];
            },
        });

        // 15. Short Position R:R Box
        registerOverlay({
            name: 'tvShortPosition',
            totalStep: 4,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                if (coordinates.length < 2) return [];
                const st = resolveOverlayStyles(overlay, {
                    lineColor: '#ef4444',
                    lineSize: 1.5,
                    fillColor: 'rgba(239, 68, 68, 0.22)',
                    textColor: '#ffffff',
                    textSize: 11,
                });
                const p1 = coordinates[0];
                const p2 = coordinates[1];
                const p3 = coordinates[2] || {
                    x: p2.x,
                    y: p1.y - Math.abs(p2.y - p1.y) * 0.5,
                };
                const left = Math.min(p1.x, p2.x);
                const width = Math.max(Math.abs(p2.x - p1.x), 90);
                const entryY = p1.y;
                const tpY = Math.max(p2.y, entryY + 12);
                const slY = Math.min(p3.y, entryY - 12);

                const v1 = overlay.points[0]?.value ?? 0;
                const v2 = overlay.points[1]?.value ?? v1;
                const v3 = overlay.points[2]?.value ?? v1 + Math.abs(v1 - v2) * 0.5;
                const risk = Math.max(Math.abs(v3 - v1), 0.00001);
                const reward = Math.abs(v1 - v2);
                const rr = (reward / risk).toFixed(2);
                const customNote = typeof overlay.extendData === 'string' && overlay.extendData.trim() ? ` · ${overlay.extendData.trim()}` : '';

                return [
                    {
                        type: 'rect',
                        attrs: { x: left, y: slY, width, height: Math.max(entryY - slY, 2) },
                        styles: {
                            style: 'stroke_fill',
                            color: overlay?.styles?.polygon?.color || 'rgba(239, 68, 68, 0.22)',
                            borderColor: st.lineColor,
                            borderSize: st.lineSize,
                        },
                    },
                    {
                        type: 'rect',
                        attrs: { x: left, y: entryY, width, height: Math.max(tpY - entryY, 2) },
                        styles: {
                            style: 'stroke_fill',
                            color: 'rgba(16, 185, 129, 0.22)',
                            borderColor: '#10b981',
                            borderSize: st.lineSize,
                        },
                    },
                    {
                        type: 'line',
                        attrs: { coordinates: [{ x: left, y: entryY }, { x: left + width, y: entryY }] },
                        styles: { color: '#ffffff', size: st.lineSize, style: st.lineStyle, dashedValue: st.dashedValue },
                    },
                    {
                        type: 'text',
                        ignoreEvent: true,
                        attrs: {
                            x: left + 6,
                            y: entryY + 16,
                            text: `SHORT  R:R 1:${rr}${customNote}`,
                        },
                        styles: {
                            color: st.textColor,
                            backgroundColor: st.lineColor,
                            size: st.textSize,
                            weight: 'bold',
                            paddingLeft: 6,
                            paddingRight: 6,
                            paddingTop: 3,
                            paddingBottom: 3,
                            borderRadius: 3,
                        },
                    },
                ];
            },
        });

        // 16. 1-point Institutional Text / Note / SMC Badge
        registerOverlay({
            name: 'tvTextAnnotation',
            totalStep: 2,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: false,
            needDefaultYAxisFigure: false,
            createPointFigures: ({ coordinates, overlay }) => {
                if (coordinates.length === 0) return [];
                const st = resolveOverlayStyles(overlay, {
                    lineColor: '#2563eb',
                    lineSize: 1.5,
                    fillColor: '#2563eb',
                    textColor: '#ffffff',
                    textSize: 11,
                });
                const p = coordinates[0];
                const rawText = typeof overlay.extendData === 'string' && overlay.extendData.trim().length > 0
                    ? overlay.extendData.trim()
                    : 'BOS / Nota';
                const badgeBg = overlay?.styles?.polygon?.color || st.lineColor;

                return [
                    {
                        type: 'line',
                        attrs: {
                            coordinates: [
                                { x: p.x, y: p.y },
                                { x: p.x, y: p.y - 16 },
                            ],
                        },
                        styles: {
                            color: st.lineColor,
                            size: st.lineSize,
                            style: st.lineStyle,
                            dashedValue: st.dashedValue,
                        },
                    },
                    {
                        type: 'circle',
                        attrs: { x: p.x, y: p.y, r: 3.5 },
                        styles: {
                            style: 'fill',
                            color: st.lineColor,
                        },
                    },
                    {
                        type: 'text',
                        attrs: {
                            x: p.x,
                            y: p.y - 18,
                            text: rawText,
                            align: 'center',
                            baseline: 'bottom',
                        },
                        styles: {
                            color: st.textColor,
                            backgroundColor: badgeBg,
                            borderColor: st.lineColor,
                            borderSize: 1,
                            size: st.textSize,
                            weight: 'bold',
                            paddingLeft: 7,
                            paddingRight: 7,
                            paddingTop: 4,
                            paddingBottom: 4,
                            borderRadius: 4,
                        },
                    },
                ];
            },
        });

        // 17. 2-point Callout Box with Pointer Line & Price Tag
        registerOverlay({
            name: 'tvPriceCallout',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: false,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay }) => {
                if (coordinates.length === 0) return [];
                const st = resolveOverlayStyles(overlay, {
                    lineColor: '#0284c7',
                    lineSize: 1.5,
                    fillColor: '#0284c7',
                    textColor: '#ffffff',
                    textSize: 11,
                });
                const p1 = coordinates[0];
                const p2 = coordinates[1] || { x: p1.x + 55, y: p1.y - 35 };
                const priceVal = overlay.points[0]?.value;
                const priceText = typeof priceVal === 'number'
                    ? priceVal.toFixed(priceVal < 10 ? 5 : 2)
                    : '';
                const label = typeof overlay.extendData === 'string' && overlay.extendData.trim().length > 0
                    ? overlay.extendData.trim()
                    : 'Zona Chave';
                const badgeBg = overlay?.styles?.polygon?.color || st.lineColor;

                return [
                    {
                        type: 'line',
                        attrs: { coordinates: [p1, p2] },
                        styles: {
                            color: st.lineColor,
                            size: st.lineSize,
                            style: st.lineStyle,
                            dashedValue: st.dashedValue,
                        },
                    },
                    {
                        type: 'circle',
                        attrs: { x: p1.x, y: p1.y, r: 4 },
                        styles: {
                            style: 'fill',
                            color: st.lineColor,
                        },
                    },
                    {
                        type: 'text',
                        attrs: {
                            x: p2.x,
                            y: p2.y,
                            text: priceText ? `${label} (${priceText})` : label,
                            align: 'left',
                            baseline: 'middle',
                        },
                        styles: {
                            color: st.textColor,
                            backgroundColor: badgeBg,
                            size: st.textSize,
                            weight: 'bold',
                            paddingLeft: 8,
                            paddingRight: 8,
                            paddingTop: 5,
                            paddingBottom: 5,
                            borderRadius: 5,
                        },
                    },
                ];
            },
        });

        // 18. 1-point Emoji / Sticker Marker
        registerOverlay({
            name: 'tvEmojiMarker',
            totalStep: 2,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: false,
            needDefaultYAxisFigure: false,
            createPointFigures: ({ coordinates, overlay }) => {
                if (coordinates.length === 0) return [];
                const p = coordinates[0];
                const emoji = typeof overlay.extendData === 'string' && overlay.extendData.trim().length > 0
                    ? overlay.extendData.trim()
                    : '🎯';
                const emojiSize = typeof overlay?.styles?.text?.size === 'number' ? overlay.styles.text.size : 24;
                const bg = overlay?.styles?.polygon?.color || 'rgba(15, 23, 42, 0.18)';

                return [
                    {
                        type: 'text',
                        attrs: {
                            x: p.x,
                            y: p.y,
                            text: emoji,
                            align: 'center',
                            baseline: 'middle',
                        },
                        styles: {
                            size: emojiSize,
                            color: '#ffffff',
                            backgroundColor: bg,
                            paddingLeft: 4,
                            paddingRight: 4,
                            paddingTop: 3,
                            paddingBottom: 3,
                            borderRadius: 6,
                        },
                    },
                ];
            },
        });

        // 19. 2-point TradingView / Traynio Price & Bars Range Measure Ruler
        registerOverlay({
            name: 'tvMeasureRuler',
            totalStep: 3,
            needDefaultPointFigure: true,
            needDefaultXAxisFigure: true,
            needDefaultYAxisFigure: true,
            createPointFigures: ({ coordinates, overlay, precision }) => {
                if (coordinates.length < 2) return [];
                const p1 = coordinates[0];
                const p2 = coordinates[1];
                const left = Math.min(p1.x, p2.x);
                const top = Math.min(p1.y, p2.y);
                const width = Math.max(Math.abs(p2.x - p1.x), 4);
                const height = Math.max(Math.abs(p2.y - p1.y), 4);
                const midX = left + width / 2;
                const midY = top + height / 2;

                const v1 = overlay.points[0]?.value ?? 0;
                const v2 = overlay.points[1]?.value ?? v1;
                const diff = v2 - v1;
                const pct = v1 !== 0 ? ((diff / v1) * 100).toFixed(2) : '0.00';
                const isUp = diff >= 0;

                const decimals = precision?.price ?? (Math.abs(v1) < 10 ? 5 : 2);
                const pipsMultiplier = Math.pow(10, decimals);
                const pointsInt = Math.round(Math.abs(diff) * pipsMultiplier);
                const sign = isUp ? '+' : '';

                const idx1 = overlay.points[0]?.dataIndex ?? 0;
                const idx2 = overlay.points[1]?.dataIndex ?? idx1;
                const minIdx = Math.min(idx1, idx2);
                const maxIdx = Math.max(idx1, idx2);
                const bars = Math.max(0, maxIdx - minIdx);

                let durationStr = '';
                let volumeSum = 0;
                const dataList = chartDataGetter ? chartDataGetter() : [];
                if (dataList.length > 0) {
                    const startBar = dataList[Math.max(0, Math.min(dataList.length - 1, minIdx))];
                    const endBar = dataList[Math.max(0, Math.min(dataList.length - 1, maxIdx))];
                    if (startBar && endBar) {
                        durationStr = formatDurationMs(endBar.timestamp - startBar.timestamp);
                    }
                    for (let i = Math.max(0, minIdx); i <= Math.min(dataList.length - 1, maxIdx); i++) {
                        volumeSum += dataList[i]?.volume ?? 0;
                    }
                } else {
                    const t1 = overlay.points[0]?.timestamp ?? 0;
                    const t2 = overlay.points[1]?.timestamp ?? t1;
                    if (t1 && t2) durationStr = formatDurationMs(t2 - t1);
                }

                const customLineColor = overlay?.styles?.line?.color;
                const customFillColor = overlay?.styles?.polygon?.color;
                const strokeColor = customLineColor || (isUp ? '#2563eb' : '#ef4444');
                const fillColor = customFillColor || (isUp ? 'rgba(37, 99, 235, 0.16)' : 'rgba(239, 68, 68, 0.16)');
                const badgeBg = customLineColor || (isUp ? '#2563eb' : '#dc2626');
                const lineSize = typeof overlay?.styles?.line?.size === 'number' ? overlay.styles.line.size : 1.5;

                const arrowSize = 6;
                const goingUp = p2.y <= p1.y;
                const vTipY = p2.y;
                const vBaseY = goingUp ? vTipY + arrowSize : vTipY - arrowSize;

                const goingRight = p2.x >= p1.x;
                const hTipX = p2.x;
                const hBaseX = goingRight ? hTipX - arrowSize : hTipX + arrowSize;

                const cardWidth = 148;
                const cardHeight = 56;
                const cardX = Math.max(8, midX - cardWidth / 2);
                const cardY = top > cardHeight + 14 ? top - cardHeight - 8 : top + height + 8;

                const line1 = `${sign}${diff.toFixed(decimals)} (${sign}${pct}%) ${pointsInt}`;
                const line2 = durationStr ? `${bars} bars, ${durationStr}` : `${bars} bars`;
                const line3 = `Vol ${formatCompactVolume(volumeSum)}`;

                return [
                    {
                        type: 'rect',
                        attrs: { x: left, y: top, width, height },
                        styles: {
                            style: 'stroke_fill',
                            color: fillColor,
                            borderColor: strokeColor,
                            borderSize: 1,
                        },
                    },
                    {
                        type: 'line',
                        attrs: {
                            coordinates: [
                                { x: midX, y: p1.y },
                                { x: midX, y: p2.y },
                            ],
                        },
                        styles: {
                            color: strokeColor,
                            size: lineSize,
                        },
                    },
                    {
                        type: 'polygon',
                        attrs: {
                            coordinates: [
                                { x: midX, y: vTipY },
                                { x: midX - 4.5, y: vBaseY },
                                { x: midX + 4.5, y: vBaseY },
                            ],
                        },
                        styles: {
                            style: 'fill',
                            color: strokeColor,
                        },
                    },
                    {
                        type: 'line',
                        attrs: {
                            coordinates: [
                                { x: p1.x, y: midY },
                                { x: p2.x, y: midY },
                            ],
                        },
                        styles: {
                            color: strokeColor,
                            size: lineSize,
                        },
                    },
                    {
                        type: 'polygon',
                        attrs: {
                            coordinates: [
                                { x: hTipX, y: midY },
                                { x: hBaseX, y: midY - 4.5 },
                                { x: hBaseX, y: midY + 4.5 },
                            ],
                        },
                        styles: {
                            style: 'fill',
                            color: strokeColor,
                        },
                    },
                    {
                        type: 'rect',
                        ignoreEvent: true,
                        attrs: {
                            x: cardX,
                            y: cardY,
                            width: cardWidth,
                            height: cardHeight,
                        },
                        styles: {
                            style: 'fill',
                            color: badgeBg,
                            borderRadius: 6,
                        },
                    },
                    {
                        type: 'text',
                        ignoreEvent: true,
                        attrs: {
                            x: cardX + cardWidth / 2,
                            y: cardY + 13,
                            text: line1,
                            align: 'center',
                            baseline: 'middle',
                        },
                        styles: {
                            color: '#ffffff',
                            backgroundColor: 'transparent',
                            size: 11,
                            weight: 'bold',
                        },
                    },
                    {
                        type: 'text',
                        ignoreEvent: true,
                        attrs: {
                            x: cardX + cardWidth / 2,
                            y: cardY + 29,
                            text: line2,
                            align: 'center',
                            baseline: 'middle',
                        },
                        styles: {
                            color: '#ffffff',
                            backgroundColor: 'transparent',
                            size: 11,
                            weight: 'bold',
                        },
                    },
                    {
                        type: 'text',
                        ignoreEvent: true,
                        attrs: {
                            x: cardX + cardWidth / 2,
                            y: cardY + 45,
                            text: line3,
                            align: 'center',
                            baseline: 'middle',
                        },
                        styles: {
                            color: 'rgba(255, 255, 255, 0.92)',
                            backgroundColor: 'transparent',
                            size: 11,
                        },
                    },
                ];
            },
            createYAxisFigures: ({ overlay, coordinates, precision }) => {
                if (coordinates.length < 2) return [];
                const decimals = precision?.price ?? 5;
                const v1 = overlay.points[0]?.value ?? 0;
                const v2 = overlay.points[1]?.value ?? v1;
                const isUp = v2 >= v1;
                const bgColor = overlay?.styles?.line?.color || (isUp ? '#2563eb' : '#dc2626');

                return [
                    {
                        type: 'text',
                        attrs: {
                            x: 0,
                            y: coordinates[0].y,
                            text: v1.toFixed(decimals),
                            align: 'left',
                            baseline: 'middle',
                        },
                        styles: {
                            color: '#ffffff',
                            backgroundColor: bgColor,
                            size: 10,
                            weight: 'bold',
                            paddingLeft: 5,
                            paddingRight: 5,
                            paddingTop: 3,
                            paddingBottom: 3,
                            borderRadius: 2,
                        },
                    },
                    {
                        type: 'text',
                        attrs: {
                            x: 0,
                            y: coordinates[1].y,
                            text: v2.toFixed(decimals),
                            align: 'left',
                            baseline: 'middle',
                        },
                        styles: {
                            color: '#ffffff',
                            backgroundColor: bgColor,
                            size: 10,
                            weight: 'bold',
                            paddingLeft: 5,
                            paddingRight: 5,
                            paddingTop: 3,
                            paddingBottom: 3,
                            borderRadius: 2,
                        },
                    },
                ];
            },
            createXAxisFigures: ({ overlay, coordinates }) => {
                if (coordinates.length < 2) return [];
                const v1 = overlay.points[0]?.value ?? 0;
                const v2 = overlay.points[1]?.value ?? v1;
                const isUp = v2 >= v1;
                const bgColor = overlay?.styles?.line?.color || (isUp ? '#2563eb' : '#dc2626');
                const t1 = formatAxisDate(overlay.points[0]?.timestamp);
                const t2 = formatAxisDate(overlay.points[1]?.timestamp);
                const figures: any[] = [];
                if (t1) {
                    figures.push({
                        type: 'text',
                        attrs: {
                            x: coordinates[0].x,
                            y: 0,
                            text: t1,
                            align: 'center',
                            baseline: 'top',
                        },
                        styles: {
                            color: '#ffffff',
                            backgroundColor: bgColor,
                            size: 10,
                            weight: 'bold',
                            paddingLeft: 6,
                            paddingRight: 6,
                            paddingTop: 3,
                            paddingBottom: 3,
                            borderRadius: 2,
                        },
                    });
                }
                if (t2) {
                    figures.push({
                        type: 'text',
                        attrs: {
                            x: coordinates[1].x,
                            y: 0,
                            text: t2,
                            align: 'center',
                            baseline: 'top',
                        },
                        styles: {
                            color: '#ffffff',
                            backgroundColor: bgColor,
                            size: 10,
                            weight: 'bold',
                            paddingLeft: 6,
                            paddingRight: 6,
                            paddingTop: 3,
                            paddingBottom: 3,
                            borderRadius: 2,
                        },
                    });
                }
                return figures;
            },
        });
    } catch (_) {
        // Ignore if already registered
    }

    // 7. Replay Trade Execution Marker + Path Overlay (Entry & Exit Arrows + Dashed Trade Path)
    try {
        registerOverlay({
            name: 'replayTradeExecution',
            totalStep: 3,
            needDefaultPointFigure: false,
            needDefaultXAxisFigure: false,
            needDefaultYAxisFigure: false,
            createPointFigures: ({ overlay, coordinates, precision }) => {
                if (!coordinates || coordinates.length < 1) return [];
                const meta = (overlay?.extendData || {}) as {
                    side?: 'BUY' | 'SELL';
                    status?: string;
                    entryPrice?: number;
                    exitPrice?: number;
                    exitReason?: string;
                    pnl?: number;
                    rMultiple?: number;
                    decimals?: number;
                };

                const isBuy = (meta.side || 'BUY') === 'BUY';
                const status = meta.status || 'OPEN';
                const isClosed = status === 'WIN' || status === 'LOSS';
                const pnl = Number(meta.pnl ?? 0);
                const rMult = typeof meta.rMultiple === 'number' && Number.isFinite(meta.rMultiple) ? meta.rMultiple : null;
                const dec = meta.decimals ?? precision?.price ?? 2;

                const entryVal = Number(meta.entryPrice ?? overlay.points?.[0]?.value ?? 0);
                const exitVal = Number(meta.exitPrice ?? overlay.points?.[1]?.value ?? entryVal);

                const p1 = coordinates[0];
                const p2 = coordinates.length >= 2 ? coordinates[1] : null;
                const entryColor = isBuy ? '#2563eb' : '#e11d48';
                const resultColor = pnl >= 0 ? '#10b981' : '#ef4444';

                const figures: any[] = [];

                // 1) Dashed execution path between Entry and Exit (or current live bar while OPEN)
                if (p2 && (Math.abs(p2.x - p1.x) > 0.5 || Math.abs(p2.y - p1.y) > 0.5)) {
                    figures.push({
                        type: 'line',
                        ignoreEvent: true,
                        attrs: {
                            coordinates: [
                                { x: p1.x, y: p1.y },
                                { x: p2.x, y: p2.y },
                            ],
                        },
                        styles: {
                            style: LineType.Dashed,
                            color: resultColor,
                            size: isClosed ? 1.8 : 1.35,
                            dashedValue: [5, 4],
                        },
                    });
                }

                // 2) Exact Entry price anchor dot + directional arrow + badge
                figures.push(
                    {
                        type: 'circle',
                        ignoreEvent: true,
                        attrs: { x: p1.x, y: p1.y, r: 4.5 },
                        styles: {
                            style: 'stroke_fill',
                            color: entryColor,
                            borderColor: '#ffffff',
                            borderSize: 1.5,
                        },
                    },
                    {
                        type: 'polygon',
                        ignoreEvent: true,
                        attrs: {
                            coordinates: isBuy
                                ? [
                                      { x: p1.x, y: p1.y + 6 },
                                      { x: p1.x - 5.5, y: p1.y + 14 },
                                      { x: p1.x + 5.5, y: p1.y + 14 },
                                  ]
                                : [
                                      { x: p1.x, y: p1.y - 6 },
                                      { x: p1.x - 5.5, y: p1.y - 14 },
                                      { x: p1.x + 5.5, y: p1.y - 14 },
                                  ],
                        },
                        styles: {
                            style: 'fill',
                            color: entryColor,
                        },
                    },
                    {
                        type: 'text',
                        ignoreEvent: true,
                        attrs: {
                            x: p1.x,
                            y: isBuy ? p1.y + 24 : p1.y - 24,
                            text: `ENTRY ${isBuy ? 'BUY' : 'SELL'} @ ${entryVal.toFixed(dec)}`,
                            align: 'center',
                            baseline: 'middle',
                        },
                        styles: {
                            color: '#ffffff',
                            backgroundColor: entryColor,
                            size: 10,
                            weight: 'bold',
                            paddingLeft: 6,
                            paddingRight: 6,
                            paddingTop: 3,
                            paddingBottom: 3,
                            borderRadius: 4,
                        },
                    }
                );

                // 3) Exact Exit price anchor dot + directional arrow + PnL/R badge when trade is closed
                if (isClosed && p2) {
                    const reasonTag = meta.exitReason ? ` ${meta.exitReason}` : '';
                    const pnlSign = pnl >= 0 ? '+' : '-';
                    const pnlText = `${pnlSign}$${Math.abs(pnl).toFixed(2)}`;
                    const rText =
                        rMult !== null && Math.abs(rMult) > 0
                            ? ` (${rMult >= 0 ? '+' : ''}${rMult.toFixed(2)}R)`
                            : '';

                    figures.push(
                        {
                            type: 'circle',
                            ignoreEvent: true,
                            attrs: { x: p2.x, y: p2.y, r: 4.5 },
                            styles: {
                                style: 'stroke_fill',
                                color: resultColor,
                                borderColor: '#ffffff',
                                borderSize: 1.5,
                            },
                        },
                        {
                            type: 'polygon',
                            ignoreEvent: true,
                            attrs: {
                                coordinates: isBuy
                                    ? [
                                          { x: p2.x, y: p2.y - 6 },
                                          { x: p2.x - 5.5, y: p2.y - 14 },
                                          { x: p2.x + 5.5, y: p2.y - 14 },
                                      ]
                                    : [
                                          { x: p2.x, y: p2.y + 6 },
                                          { x: p2.x - 5.5, y: p2.y + 14 },
                                          { x: p2.x + 5.5, y: p2.y + 14 },
                                      ],
                            },
                            styles: {
                                style: 'fill',
                                color: resultColor,
                            },
                        },
                        {
                            type: 'text',
                            ignoreEvent: true,
                            attrs: {
                                x: p2.x,
                                y: isBuy ? p2.y - 24 : p2.y + 24,
                                text: `EXIT${reasonTag} @ ${exitVal.toFixed(dec)} · ${pnlText}${rText}`,
                                align: 'center',
                                baseline: 'middle',
                            },
                            styles: {
                                color: '#ffffff',
                                backgroundColor: resultColor,
                                size: 10,
                                weight: 'bold',
                                paddingLeft: 6,
                                paddingRight: 6,
                                paddingTop: 3,
                                paddingBottom: 3,
                                borderRadius: 4,
                            },
                        }
                    );
                }

                return figures;
            },
        });
    } catch (_) {
        // Ignore if already registered
    }

    // 8. Interactive Draggable Order Preview Line (Entry / SL / TP before execution)
    try {
        registerOverlay({
            name: 'replayOrderPreviewLine',
            totalStep: 2,
            needDefaultPointFigure: false,
            needDefaultXAxisFigure: false,
            needDefaultYAxisFigure: false,
            createPointFigures: ({ overlay, coordinates, bounding, precision }) => {
                if (!coordinates || coordinates.length === 0) return [];
                const y = coordinates[0].y;
                const meta = (overlay?.extendData || {}) as {
                    role?: 'ENTRY' | 'SL' | 'TP';
                    label?: string;
                    sublabel?: string;
                    color?: string;
                    decimals?: number;
                    price?: number;
                };
                const roleColor =
                    meta.color ||
                    (meta.role === 'SL'
                        ? '#ef4444'
                        : meta.role === 'TP'
                          ? '#10b981'
                          : '#0ea5e9');
                const dec = meta.decimals ?? precision?.price ?? 2;
                const val = Number(overlay?.points?.[0]?.value ?? meta.price ?? 0);
                const priceText = Number.isFinite(val) && val > 0 ? val.toFixed(dec) : '';
                const labelText = [meta.label || meta.role || 'PREVIEW', priceText, meta.sublabel]
                    .filter(Boolean)
                    .join(' · ');

                return [
                    {
                        type: 'line',
                        attrs: {
                            coordinates: [
                                { x: 0, y },
                                { x: bounding.width, y },
                            ],
                        },
                        styles: {
                            style: LineType.Dashed,
                            color: roleColor,
                            size: 1.6,
                            dashedValue: [6, 4],
                        },
                    },
                    {
                        type: 'text',
                        attrs: {
                            x: Math.max(80, bounding.width - 14),
                            y,
                            text: `⇅ ${labelText}`,
                            align: 'right',
                            baseline: 'middle',
                        },
                        styles: {
                            color: '#ffffff',
                            backgroundColor: roleColor,
                            size: 10,
                            weight: 'bold',
                            paddingLeft: 8,
                            paddingRight: 8,
                            paddingTop: 3.5,
                            paddingBottom: 3.5,
                            borderRadius: 4,
                        },
                    },
                ];
            },
            createYAxisFigures: ({ overlay, coordinates, precision }) => {
                if (!coordinates || coordinates.length === 0) return [];
                const meta = (overlay?.extendData || {}) as {
                    role?: 'ENTRY' | 'SL' | 'TP';
                    color?: string;
                    decimals?: number;
                    price?: number;
                };
                const roleColor =
                    meta.color ||
                    (meta.role === 'SL'
                        ? '#ef4444'
                        : meta.role === 'TP'
                          ? '#10b981'
                          : '#0ea5e9');
                const dec = meta.decimals ?? precision?.price ?? 2;
                const val = Number(overlay?.points?.[0]?.value ?? meta.price ?? 0);
                if (!Number.isFinite(val) || val <= 0) return [];

                return [
                    {
                        type: 'text',
                        attrs: {
                            x: 0,
                            y: coordinates[0].y,
                            text: val.toFixed(dec),
                            align: 'left',
                            baseline: 'middle',
                        },
                        styles: {
                            color: '#ffffff',
                            backgroundColor: roleColor,
                            size: 10,
                            weight: 'bold',
                            paddingLeft: 5,
                            paddingRight: 5,
                            paddingTop: 3,
                            paddingBottom: 3,
                            borderRadius: 3,
                        },
                    },
                ];
            },
        });
    } catch (_) {
        // Ignore if already registered
    }
}
