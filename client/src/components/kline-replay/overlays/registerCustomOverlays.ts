import { registerOverlay, PolygonType } from 'klinecharts';
import '@klinecharts/pro';

let customOverlaysRegistered = false;

export function ensureCustomOverlays() {
    if (customOverlaysRegistered) return;
    customOverlaysRegistered = true;

    // Long Position Risk:Reward Box
    registerOverlay({
        name: 'tvLongPosition',
        totalStep: 3,
        needDefaultPointFigure: true,
        needDefaultXAxisFigure: true,
        needDefaultYAxisFigure: true,
        createPointFigures: ({ coordinates, overlay }) => {
            if (coordinates.length < 2) return [];
            const p1 = coordinates[0];
            const p2 = coordinates[1];
            const left = Math.min(p1.x, p2.x);
            const right = Math.max(p1.x, p2.x);
            const width = Math.max(right - left, 60);
            const entryY = p1.y;
            const tpY = Math.min(p2.y, entryY - 25);
            const profitHeight = Math.abs(entryY - tpY);
            const slHeight = profitHeight * 0.5;
            const slY = entryY + slHeight;

            const pts = overlay.points;
            let rrText = 'Long R:R 1:2.0';
            if (pts[0]?.value && pts[1]?.value) {
                const diff = Math.abs(pts[1].value - pts[0].value);
                rrText = `LONG • Alvo: +${diff.toFixed(2)} (2.0R)`;
            }

            return [
                {
                    type: 'polygon',
                    attrs: {
                        coordinates: [
                            { x: left, y: tpY },
                            { x: left + width, y: tpY },
                            { x: left + width, y: entryY },
                            { x: left, y: entryY },
                        ],
                    },
                    styles: {
                        style: PolygonType.StrokeFill,
                        color: 'rgba(38, 166, 154, 0.22)',
                        borderColor: '#26a69a',
                        borderSize: 1,
                    },
                },
                {
                    type: 'polygon',
                    attrs: {
                        coordinates: [
                            { x: left, y: entryY },
                            { x: left + width, y: entryY },
                            { x: left + width, y: slY },
                            { x: left, y: slY },
                        ],
                    },
                    styles: {
                        style: PolygonType.StrokeFill,
                        color: 'rgba(239, 83, 80, 0.22)',
                        borderColor: '#ef5350',
                        borderSize: 1,
                    },
                },
                {
                    type: 'text',
                    attrs: {
                        x: left + 6,
                        y: tpY + 14,
                        text: rrText,
                    },
                    styles: {
                        color: '#ffffff',
                        backgroundColor: '#26a69a',
                        size: 11,
                        paddingLeft: 6,
                        paddingRight: 6,
                        paddingTop: 3,
                        paddingBottom: 3,
                        borderRadius: 4,
                    },
                },
            ];
        },
    });

    // Short Position Risk:Reward Box
    registerOverlay({
        name: 'tvShortPosition',
        totalStep: 3,
        needDefaultPointFigure: true,
        needDefaultXAxisFigure: true,
        needDefaultYAxisFigure: true,
        createPointFigures: ({ coordinates, overlay }) => {
            if (coordinates.length < 2) return [];
            const p1 = coordinates[0];
            const p2 = coordinates[1];
            const left = Math.min(p1.x, p2.x);
            const right = Math.max(p1.x, p2.x);
            const width = Math.max(right - left, 60);
            const entryY = p1.y;
            const tpY = Math.max(p2.y, entryY + 25);
            const profitHeight = Math.abs(tpY - entryY);
            const slHeight = profitHeight * 0.5;
            const slY = entryY - slHeight;

            const pts = overlay.points;
            let rrText = 'Short R:R 1:2.0';
            if (pts[0]?.value && pts[1]?.value) {
                const diff = Math.abs(pts[0].value - pts[1].value);
                rrText = `SHORT • Alvo: +${diff.toFixed(2)} (2.0R)`;
            }

            return [
                {
                    type: 'polygon',
                    attrs: {
                        coordinates: [
                            { x: left, y: slY },
                            { x: left + width, y: slY },
                            { x: left + width, y: entryY },
                            { x: left, y: entryY },
                        ],
                    },
                    styles: {
                        style: PolygonType.StrokeFill,
                        color: 'rgba(239, 83, 80, 0.22)',
                        borderColor: '#ef5350',
                        borderSize: 1,
                    },
                },
                {
                    type: 'polygon',
                    attrs: {
                        coordinates: [
                            { x: left, y: entryY },
                            { x: left + width, y: entryY },
                            { x: left + width, y: tpY },
                            { x: left, y: tpY },
                        ],
                    },
                    styles: {
                        style: PolygonType.StrokeFill,
                        color: 'rgba(38, 166, 154, 0.22)',
                        borderColor: '#26a69a',
                        borderSize: 1,
                    },
                },
                {
                    type: 'text',
                    attrs: {
                        x: left + 6,
                        y: tpY - 18,
                        text: rrText,
                    },
                    styles: {
                        color: '#ffffff',
                        backgroundColor: '#ef5350',
                        size: 11,
                        paddingLeft: 6,
                        paddingRight: 6,
                        paddingTop: 3,
                        paddingBottom: 3,
                        borderRadius: 4,
                    },
                },
            ];
        },
    });
}
