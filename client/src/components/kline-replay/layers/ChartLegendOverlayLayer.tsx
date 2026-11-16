import { useState, forwardRef, useImperativeHandle, memo } from 'react';
import { KLineData } from 'klinecharts';
import { Scissors, Settings, X } from 'lucide-react';
import { AVAILABLE_INDICATORS } from '../types';
import { useLocale } from '../../../context/LocaleContext';

export interface ChartLegendOverlayRef {
    updateLegend: (bar: KLineData | null, y: number | null, price: number | null) => void;
}

interface ChartLegendOverlayLayerProps {
    ticker: string;
    periodText: string;
    decimals: number;
    timezone?: string;
    initialBar: KLineData | null;
    cutCandleMode: boolean;
    activeIndicators?: string[];
    indicatorParamsByCode?: Record<string, string>;
    onUpdateIndicatorParams?: (code: string, paramStr: string) => void;
    onRemoveIndicator?: (code: string) => void;
    onCancelCutCandle: () => void;
    onQuickLimitOrderAtPrice: (priceStr: string) => void;
}

export const ChartLegendOverlayLayer = memo(
    forwardRef<ChartLegendOverlayRef, ChartLegendOverlayLayerProps>(({
        ticker,
        periodText,
        decimals,
        timezone = 'local',
        initialBar,
        cutCandleMode,
        activeIndicators = [],
        indicatorParamsByCode = {},
        onUpdateIndicatorParams,
        onRemoveIndicator,
        onCancelCutCandle,
        onQuickLimitOrderAtPrice,
    }, ref) => {
        const { locale } = useLocale();
        const isEn = locale === 'en';
        const [bar, setBar] = useState<KLineData | null>(initialBar);
        const [crosshairY, setCrosshairY] = useState<number | null>(null);
        const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);
        const [editingCode, setEditingCode] = useState<string | null>(null);
        const [draftParam, setDraftParam] = useState<string>('');

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

        let barTimeLabel = '';
        if (activeBar?.timestamp) {
            const dateLocale = isEn ? 'en-US' : 'pt-BR';
            try {
                barTimeLabel = new Date(activeBar.timestamp).toLocaleString(dateLocale, {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    ...(timezone && timezone !== 'local' ? { timeZone: timezone } : {}),
                });
            } catch (_) {
                barTimeLabel = new Date(activeBar.timestamp).toLocaleString(dateLocale, {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                });
            }
        }

        return (
            <>
                {/* Cut-Candle Mode Banner */}
                {cutCandleMode && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-4 py-1.5 rounded-full bg-accent text-accent-on text-xs font-bold shadow-lg flex items-center gap-2">
                        <Scissors size={14} />
                        <span>
                            {isEn
                                ? 'Click any candle on the chart to slice Replay to that bar'
                                : 'Clique em qualquer vela do gráfico para cortar o Replay naquele ponto'}
                        </span>
                        <button onClick={onCancelCutCandle} className="ml-1 opacity-80 hover:opacity-100 cursor-pointer">
                            <X size={13} />
                        </button>
                    </div>
                )}

                {/* Top-Left Symbol, Live Timestamp & OHLC Legend */}
                <div className="absolute left-3 top-2 z-10 pointer-events-none space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-[13px] text-fg tracking-tight">
                            {ticker.slice(0, 3)} / {ticker.slice(3) || 'USD'} · {periodText}
                        </span>
                        <span className="w-1.5 h-1.5 rounded-full bg-data-pos inline-block" />
                        {barTimeLabel && (
                            <span className="px-1.5 py-0.5 rounded bg-surface/80 border border-line-subtle font-mono text-[10px] text-fg-muted">
                                {barTimeLabel}
                            </span>
                        )}
                        {activeBar && (
                            <div className="flex items-center gap-2 font-mono text-[11px]">
                                <span>
                                    <span className="opacity-50 mr-0.5">O</span>
                                    <span className={colorCls}>{activeBar.open.toFixed(decimals)}</span>
                                </span>
                                <span>
                                    <span className="opacity-50 mr-0.5">H</span>
                                    <span className={colorCls}>{activeBar.high.toFixed(decimals)}</span>
                                </span>
                                <span>
                                    <span className="opacity-50 mr-0.5">L</span>
                                    <span className={colorCls}>{activeBar.low.toFixed(decimals)}</span>
                                </span>
                                <span>
                                    <span className="opacity-50 mr-0.5">C</span>
                                    <span className={colorCls}>
                                        {activeBar.close.toFixed(decimals)} ({Number(pctChange) >= 0 ? '+' : ''}{pctChange}%)
                                    </span>
                                </span>
                            </div>
                        )}
                    </div>
                    <div className="text-[10px] opacity-65 font-mono">
                        Vol <span className="font-semibold text-fg">{activeBar?.volume || 0}</span>
                    </div>

                    {activeIndicators.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 pt-0.5 pointer-events-auto">
                            {activeIndicators.map((code) => {
                                const def = AVAILABLE_INDICATORS.find((i) => i.code === code);
                                const curParams =
                                    indicatorParamsByCode[code] ?? (def?.defaultParams || []).join(', ');
                                const hasParams = Boolean(def?.defaultParams && def.defaultParams.length > 0);
                                const isEditing = editingCode === code;

                                return (
                                    <div key={code} className="relative flex items-center">
                                        <div className="group flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface/85 border border-line text-[10px] font-mono text-fg shadow-2xs backdrop-blur-xs">
                                            <span className="font-bold text-accent-fg">{code}</span>
                                            {curParams && <span className="text-fg-muted">({curParams})</span>}
                                            {hasParams && onUpdateIndicatorParams && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (isEditing) {
                                                            setEditingCode(null);
                                                        } else {
                                                            setEditingCode(code);
                                                            setDraftParam(curParams);
                                                        }
                                                    }}
                                                    title={isEn ? `Configure ${code} periods` : `Configurar períodos de ${code}`}
                                                    className="opacity-55 hover:opacity-100 hover:text-accent-fg cursor-pointer ml-0.5"
                                                >
                                                    <Settings size={10} />
                                                </button>
                                            )}
                                            {onRemoveIndicator && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (isEditing) setEditingCode(null);
                                                        onRemoveIndicator(code);
                                                    }}
                                                    title={isEn ? `Remove ${code}` : `Remover ${code}`}
                                                    className="opacity-55 hover:opacity-100 hover:text-danger-fg cursor-pointer"
                                                >
                                                    <X size={10} />
                                                </button>
                                            )}
                                        </div>

                                        {isEditing && onUpdateIndicatorParams && (
                                            <div className="absolute left-0 top-full mt-1 z-50 flex items-center gap-1 p-1.5 rounded-lg border border-line bg-surface shadow-xl">
                                                <input
                                                    type="text"
                                                    autoFocus
                                                    value={draftParam}
                                                    onChange={(e) => setDraftParam(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            onUpdateIndicatorParams(code, draftParam);
                                                            setEditingCode(null);
                                                        } else if (e.key === 'Escape') {
                                                            setEditingCode(null);
                                                        }
                                                    }}
                                                    placeholder={isEn ? 'e.g. 9, 21, 200' : 'Ex: 9, 21, 200'}
                                                    className="w-28 px-2 py-1 rounded border border-line bg-surface-2 text-[11px] font-mono text-fg focus:outline-none focus:border-accent"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        onUpdateIndicatorParams(code, draftParam);
                                                        setEditingCode(null);
                                                    }}
                                                    className="px-2 py-1 rounded bg-accent text-accent-on text-[10px] font-bold cursor-pointer"
                                                >
                                                    OK
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Right-Axis Crosshair (+) Quick Limit Order Button */}
                {crosshairY !== null && crosshairPrice !== null && (
                    <button
                        onClick={() => onQuickLimitOrderAtPrice(crosshairPrice.toFixed(decimals))}
                        style={{ transform: `translate3d(0, ${Math.max(20, Math.min(520, crosshairY - 11))}px, 0)` }}
                        className="absolute right-16 top-0 z-20 w-5 h-5 rounded-full bg-fg text-canvas flex items-center justify-center text-xs font-bold shadow cursor-pointer hover:bg-accent-hover transition-colors will-change-transform"
                        title={
                            isEn
                                ? `Place Limit Order at ${crosshairPrice.toFixed(decimals)}`
                                : `Criar Ordem Limit em ${crosshairPrice.toFixed(decimals)}`
                        }
                    >
                        +
                    </button>
                )}
            </>
        );
    })
);
