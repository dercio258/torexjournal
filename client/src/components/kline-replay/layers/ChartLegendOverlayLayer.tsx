import { useState, forwardRef, useImperativeHandle, memo } from 'react';
import { KLineData } from 'klinecharts';
import { Scissors, X } from 'lucide-react';

export interface ChartLegendOverlayRef {
    updateLegend: (bar: KLineData | null, y: number | null, price: number | null) => void;
}

interface ChartLegendOverlayLayerProps {
    ticker: string;
    periodText: string;
    decimals: number;
    initialBar: KLineData | null;
    cutCandleMode: boolean;
    onCancelCutCandle: () => void;
    onQuickLimitOrderAtPrice: (priceStr: string) => void;
}

export const ChartLegendOverlayLayer = memo(
    forwardRef<ChartLegendOverlayRef, ChartLegendOverlayLayerProps>(({
        ticker,
        periodText,
        decimals,
        initialBar,
        cutCandleMode,
        onCancelCutCandle,
        onQuickLimitOrderAtPrice,
    }, ref) => {
        const [bar, setBar] = useState<KLineData | null>(initialBar);
        const [crosshairY, setCrosshairY] = useState<number | null>(null);
        const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);

        useImperativeHandle(ref, () => ({
            updateLegend: (nextBar, nextY, nextPrice) => {
                if (nextBar) setBar(nextBar);
                setCrosshairY(nextY);
                setCrosshairPrice(nextPrice);
            },
        }), []);

        const activeBar = bar || initialBar;
        const pctChange = activeBar && activeBar.open
            ? (((activeBar.close - activeBar.open) / activeBar.open) * 100).toFixed(2)
            : '0.00';
        const isBull = activeBar ? activeBar.close >= activeBar.open : true;
        const colorCls = isBull ? 'text-accent-fg' : 'text-danger-fg';

        return (
            <>
                {/* Cut-Candle Mode Banner */}
                {cutCandleMode && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-4 py-1.5 rounded-full bg-accent text-accent-on text-xs font-bold shadow-lg flex items-center gap-2">
                        <Scissors size={14} />
                        <span>Clique em qualquer vela do gráfico para cortar o Replay naquele ponto</span>
                        <button onClick={onCancelCutCandle} className="ml-1 opacity-80 hover:opacity-100 cursor-pointer">
                            <X size={13} />
                        </button>
                    </div>
                )}

                {/* Top-Left Symbol & OHLC Legend */}
                <div className="absolute left-3 top-2.5 z-10 pointer-events-none space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={`font-bold text-sm ${'text-fg'}`}>
                            {ticker.slice(0, 3)} / {ticker.slice(3) || 'USD'} · {periodText.replace('m', '')} · Torex
                        </span>
                        <span className="w-2 h-2 rounded-full bg-data-pos inline-block" />
                        {activeBar && (
                            <div className="flex items-center gap-2 font-mono text-[11px]">
                                <span>
                                    <span className="opacity-50">O</span>
                                    <span className={colorCls}>{activeBar.open.toFixed(decimals)}</span>
                                </span>
                                <span>
                                    <span className="opacity-50">H</span>
                                    <span className={colorCls}>{activeBar.high.toFixed(decimals)}</span>
                                </span>
                                <span>
                                    <span className="opacity-50">L</span>
                                    <span className={colorCls}>{activeBar.low.toFixed(decimals)}</span>
                                </span>
                                <span>
                                    <span className="opacity-50">C</span>
                                    <span className={colorCls}>
                                        {activeBar.close.toFixed(decimals)} ({Number(pctChange) >= 0 ? '+' : ''}{pctChange}%)
                                    </span>
                                </span>
                            </div>
                        )}
                    </div>
                    <div className="text-[11px] opacity-70 font-mono">
                        Volume <span className="font-semibold text-danger-fg">{activeBar?.volume || 0}</span>
                    </div>
                </div>

                {/* Right-Axis Crosshair (+) Quick Limit Order Button */}
                {crosshairY !== null && crosshairPrice !== null && (
                    <button
                        onClick={() => onQuickLimitOrderAtPrice(crosshairPrice.toFixed(decimals))}
                        style={{ transform: `translate3d(0, ${Math.max(20, Math.min(520, crosshairY - 11))}px, 0)` }}
                        className="absolute right-16 top-0 z-20 w-5 h-5 rounded-full bg-fg text-canvas flex items-center justify-center text-xs font-bold shadow cursor-pointer hover:bg-accent-hover transition-colors will-change-transform"
                        title={`Criar Ordem Limit em ${crosshairPrice.toFixed(decimals)}`}
                    >
                        +
                    </button>
                )}

                {/* Bottom-Left TV Badge */}
                <div className={`absolute left-3 bottom-8 z-10 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shadow-md pointer-events-none ${
                    'bg-surface text-fg border border-line'
                }`}>
                    TV
                </div>
            </>
        );
    })
);
