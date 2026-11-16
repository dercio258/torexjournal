import React, { useState, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { SymbolInfo, Period } from '@klinecharts/pro';
import {
    ChevronDown,
    Undo2,
    Redo2,
    Moon,
    Sun,
    Settings,
    Camera,
    RotateCcw,
    Keyboard,
    Maximize2,
    Minimize2,
    History,
    CandlestickChart,
    BarChart2,
    TrendingUp,
    Activity,
    Check,
    X,
    PanelLeftClose,
    PanelLeftOpen,
} from 'lucide-react';
import { DataSourceMode, DEFAULT_SYMBOLS } from '../../../services/klineDatafeed';
import { BatchLoadProgress } from '../../../services/historicalBatchCache';
import { ReplayOrder, TIMEFRAMES, CANDLE_STYLE_OPTIONS, ChartCandleStyleId } from '../types';
import { useLocale } from '../../../context/LocaleContext';

export type ChartLayoutMode = '1x1' | '1x2' | '2x1' | '1+2' | '3x1' | '2x2';

export interface LayoutOptionMeta {
    id: ChartLayoutMode;
    label: string;
    labelEn?: string;
    panes: number;
}

export const LAYOUT_OPTIONS: LayoutOptionMeta[] = [
    { id: '1x1', label: 'Tela Única (1 Gráfico)', labelEn: 'Single Chart (1 Pane)', panes: 1 },
    { id: '1x2', label: '2 Gráficos — Lado a Lado', labelEn: '2 Charts — Split Vertical', panes: 2 },
    { id: '2x1', label: '2 Gráficos — Superior / Inferior', labelEn: '2 Charts — Split Horizontal', panes: 2 },
    { id: '1+2', label: '3 Gráficos — Principal + 2 Auxiliares', labelEn: '3 Charts — Main + 2 Aux', panes: 3 },
    { id: '3x1', label: '3 Gráficos — Colunas Triplas', labelEn: '3 Charts — Triple Columns', panes: 3 },
    { id: '2x2', label: '4 Gráficos — Grade Quádrupla (2×2)', labelEn: '4 Charts — Quad Grid (2×2)', panes: 4 },
];

export const LayoutGridIcon: React.FC<{ mode: ChartLayoutMode; size?: number }> = ({ mode, size = 15 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
    >
        <rect x="2" y="2" width="14" height="14" rx="2" />
        {mode === '1x2' && <line x1="9" y1="2" x2="9" y2="16" />}
        {mode === '2x1' && <line x1="2" y1="9" x2="16" y2="9" />}
        {mode === '1+2' && (
            <>
                <line x1="9.5" y1="2" x2="9.5" y2="16" />
                <line x1="9.5" y1="9" x2="16" y2="9" />
            </>
        )}
        {mode === '3x1' && (
            <>
                <line x1="6.7" y1="2" x2="6.7" y2="16" />
                <line x1="11.3" y1="2" x2="11.3" y2="16" />
            </>
        )}
        {mode === '2x2' && (
            <>
                <line x1="9" y1="2" x2="9" y2="16" />
                <line x1="2" y1="9" x2="16" y2="9" />
            </>
        )}
    </svg>
);

const SIMPLE_CANDLE_LABELS: Record<ChartCandleStyleId, string> = {
    candles: 'Velas',
    hollow_candles: 'Velas Vazadas',
    bars: 'Barras (OHLC)',
    hlc_bars: 'Barras (HLC)',
    heikin_ashi: 'Heikin Ashi',
    lines: 'Linha',
    lines_with_marks: 'Linha com Marcadores',
    step_line: 'Linha em Degraus',
    area: 'Área',
    hlc_area: 'Área HLC',
    baseline: 'Linha de Base',
    columns: 'Colunas',
    high_low: 'Máxima-Mínima',
};

const SIMPLE_CANDLE_LABELS_EN: Record<ChartCandleStyleId, string> = {
    candles: 'Candles',
    hollow_candles: 'Hollow Candles',
    bars: 'Bars (OHLC)',
    hlc_bars: 'HLC Bars',
    heikin_ashi: 'Heikin Ashi',
    lines: 'Line',
    lines_with_marks: 'Line with Markers',
    step_line: 'Step Line',
    area: 'Area',
    hlc_area: 'HLC Area',
    baseline: 'Baseline',
    columns: 'Columns',
    high_low: 'High-Low',
};

interface TopToolbarLayerProps {
    isLight: boolean;
    currentSymbol: SymbolInfo;
    currentPeriod: Period;
    secondaryPeriod: Period;
    focusedPaneIndex?: number;
    focusedPanePeriod?: Period;
    panePeriods?: Period[];
    layoutMode: ChartLayoutMode;
    activeIndicatorsCount: number;
    dataSource?: DataSourceMode;
    selectedCandleStyle?: ChartCandleStyleId;
    focusWorkspaceMode?: boolean;
    onToggleFocusWorkspace?: () => void;
    onSelectSymbol: (sym: SymbolInfo) => void;
    onSelectPeriod: (per: Period) => void;
    onSelectSecondaryPeriod: (per: Period) => void;
    onSelectPanePeriod?: (paneIndex: number, per: Period) => void;
    onChangeLayoutMode: (mode: ChartLayoutMode) => void;
    onCycleCandleStyle: () => void;
    onSelectCandleStyle?: (styleId: ChartCandleStyleId) => void;
    onOpenIndicators: () => void;
    onUndoDrawing: () => void;
    onClearDrawings: () => void;
    onUndoState?: () => void;
    onRedoState?: () => void;
    canUndoState?: boolean;
    canRedoState?: boolean;
    undoCount?: number;
    redoCount?: number;
    syncStatus?: 'idle' | 'saving_local' | 'syncing_cloud' | 'saved' | 'offline_queued' | 'error';
    cacheLayer?: 'IDB' | 'REDIS' | 'POSTGRES';
    revision?: number;
    offlineOutboxCount?: number;
    cutCandleMode?: boolean;
    onActivateCutCandle?: () => void;
    onChangeDataSource?: (mode: DataSourceMode) => void;
    onToggleTheme: () => void;
    onToggleTradeDrawer: () => void;
    onResetSimulation: () => void;
    onScreenshot: () => void;
    isFullscreen?: boolean;
    onToggleFullscreen?: () => void;
    sessionName?: string;
    strategyName?: string;
    sessionPairs?: string[];
    onBackToHub?: () => void;
    batchProgress?: BatchLoadProgress;
    onLoadEarlierBatch?: () => void;
    sessionTrades?: ReplayOrder[];
    activeJumpTradeId?: string | null;
    onJumpToSessionTrade?: (trade: ReplayOrder) => void;
}

export const TopToolbarLayer: React.FC<TopToolbarLayerProps> = memo(({
    isLight,
    currentSymbol,
    currentPeriod,
    secondaryPeriod,
    focusedPaneIndex = 0,
    focusedPanePeriod,
    panePeriods,
    layoutMode,
    activeIndicatorsCount,
    selectedCandleStyle = 'candles',
    focusWorkspaceMode = false,
    onToggleFocusWorkspace,
    onSelectSymbol,
    onSelectPeriod,
    onSelectSecondaryPeriod,
    onSelectPanePeriod,
    onChangeLayoutMode,
    onCycleCandleStyle,
    onSelectCandleStyle,
    onOpenIndicators,
    onUndoDrawing,
    onClearDrawings,
    onUndoState,
    onRedoState,
    canUndoState = false,
    canRedoState = false,
    syncStatus = 'saved',
    cacheLayer = 'IDB',
    revision = 0,
    offlineOutboxCount = 0,
    onToggleTheme,
    onToggleTradeDrawer,
    onResetSimulation,
    onScreenshot,
    isFullscreen = false,
    onToggleFullscreen,
    sessionPairs,
    onBackToHub,
    sessionTrades = [],
    activeJumpTradeId,
    onJumpToSessionTrade,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const candleLabels = isEn ? SIMPLE_CANDLE_LABELS_EN : SIMPLE_CANDLE_LABELS;
    const [openDropdown, setOpenDropdown] = useState<'none' | 'symbol' | 'layout' | 'trades' | 'shortcuts'>('none');
    const [candleModalOpen, setCandleModalOpen] = useState(false);
    const headerRef = useRef<HTMLElement | null>(null);

    const activeStyleOption =
        CANDLE_STYLE_OPTIONS.find(o => o.id === selectedCandleStyle) || CANDLE_STYLE_OPTIONS[1];

    const displayedPeriod = focusedPanePeriod || currentPeriod;
    const activeLayoutMeta = LAYOUT_OPTIONS.find(l => l.id === layoutMode) || LAYOUT_OPTIONS[0];

    useEffect(() => {
        if (openDropdown === 'none' && !candleModalOpen) return;
        const onPointerDown = (e: PointerEvent) => {
            if (openDropdown !== 'none' && headerRef.current && !headerRef.current.contains(e.target as Node)) {
                setOpenDropdown('none');
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpenDropdown('none');
                setCandleModalOpen(false);
            }
        };
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [openDropdown, candleModalOpen]);

    const handleTimeframeClick = (tf: Period) => {
        if (layoutMode !== '1x1' && focusedPaneIndex > 0 && onSelectPanePeriod) {
            onSelectPanePeriod(focusedPaneIndex, tf);
        } else {
            onSelectPeriod(tf);
        }
    };

    return (
        <>
            <header
                ref={headerRef}
                className="relative z-50 h-10 px-2.5 flex items-center justify-between border-b border-line bg-surface text-xs shrink-0"
            >
                {/* Left Group: Logo, Symbol, Timeframes, Candles Modal Trigger, Indicators, Undo/Redo */}
                <div className="flex items-center gap-1 min-w-0">
                    {onBackToHub ? (
                        <button
                            type="button"
                            onClick={onBackToHub}
                            title={isEn ? 'Back to Sessions' : 'Voltar para Sessões'}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
                        >
                            <img
                                src="https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg"
                                alt="Torex Logo"
                                className="w-6 h-6 rounded-md object-contain shrink-0"
                            />
                        </button>
                    ) : (
                        <div className="w-7 h-7 flex items-center justify-center shrink-0">
                            <img
                                src="https://pub-354475384fd04c1e8c075e14e17ed14d.r2.dev/produtos/originals/1790957899791_0521d2dc46a60392_touro_design_1.jpeg"
                                alt="Torex Logo"
                                className="w-6 h-6 rounded-md object-contain shrink-0"
                            />
                        </div>
                    )}

                    <div className="h-4 w-px mx-0.5 bg-line shrink-0" />

                    {/* Symbol Selector */}
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setOpenDropdown(v => (v === 'symbol' ? 'none' : 'symbol'))}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-surface-2 text-fg font-bold tracking-tight transition-colors cursor-pointer"
                            title={isEn ? 'Select Symbol' : 'Selecionar Ativo'}
                        >
                            <span className="text-xs font-extrabold">{currentSymbol.ticker}</span>
                            <ChevronDown size={12} className="opacity-60" />
                        </button>

                        {openDropdown === 'symbol' && (
                            <div className="absolute left-0 top-full mt-1.5 w-60 rounded-xl border border-line bg-surface shadow-2xl z-[130] py-1.5 max-h-80 overflow-y-auto">
                                {[
                                    ...DEFAULT_SYMBOLS.filter(s => sessionPairs?.includes(s.ticker)),
                                    ...DEFAULT_SYMBOLS.filter(s => !sessionPairs?.includes(s.ticker)),
                                ].map(sym => {
                                    const isSessionPair = sessionPairs?.includes(sym.ticker);
                                    const active = currentSymbol.ticker === sym.ticker;
                                    return (
                                        <button
                                            key={sym.ticker}
                                            type="button"
                                            onClick={() => {
                                                setOpenDropdown('none');
                                                onSelectSymbol(sym);
                                            }}
                                            className={`w-full px-3 py-2 text-left flex items-center justify-between text-xs cursor-pointer transition-colors ${
                                                active
                                                    ? 'bg-accent/12 text-accent-fg font-bold'
                                                    : 'hover:bg-surface-2 text-fg'
                                            }`}
                                        >
                                            <div className="min-w-0 pr-2">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-bold">{sym.ticker}</span>
                                                    {isSessionPair && (
                                                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-accent/15 text-accent-fg font-semibold">
                                                            {isEn ? 'Session' : 'Sessão'}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[10px] text-fg-muted truncate">{sym.name}</div>
                                            </div>
                                            {active && <Check size={13} className="text-accent-fg shrink-0" />}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {sessionTrades.length > 0 && onJumpToSessionTrade && (
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setOpenDropdown(v => (v === 'trades' ? 'none' : 'trades'))}
                                title={isEn ? 'Jump to trade in this session' : 'Saltar para operação desta sessão'}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 font-bold text-[11px] cursor-pointer transition-colors"
                            >
                                <History size={12} />
                                <span className="hidden md:inline">Trades ({sessionTrades.length})</span>
                                <ChevronDown size={11} className="opacity-70" />
                            </button>

                            {openDropdown === 'trades' && (
                                <div className="absolute left-0 top-full mt-1.5 w-72 rounded-xl border border-line bg-surface shadow-2xl z-[130] py-1.5 max-h-80 overflow-y-auto">
                                    <div className="px-3 py-1.5 border-b border-line-subtle text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                                        {isEn ? 'Session Executions' : 'Operações da Sessão'}
                                    </div>
                                    {sessionTrades.map((trade, idx) => {
                                        const isSelected = activeJumpTradeId === trade.id;
                                        const dateLabel = new Date(trade.openedAt).toLocaleString(isEn ? 'en-US' : 'pt-BR', {
                                            day: '2-digit',
                                            month: '2-digit',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        });
                                        return (
                                            <button
                                                key={trade.id}
                                                type="button"
                                                onClick={() => {
                                                    setOpenDropdown('none');
                                                    onJumpToSessionTrade(trade);
                                                }}
                                                className={`w-full px-3 py-2 text-left flex items-center justify-between border-b border-line-subtle last:border-b-0 transition-colors cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-accent/15 text-fg font-bold'
                                                        : 'hover:bg-surface-2 text-fg-muted'
                                                }`}
                                            >
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] font-mono opacity-60">#{idx + 1}</span>
                                                        <span className="font-bold text-xs text-fg">{trade.symbol}</span>
                                                        <span
                                                            className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                                                                trade.side === 'BUY'
                                                                    ? 'bg-emerald-500/15 text-emerald-500'
                                                                    : 'bg-rose-500/15 text-rose-500'
                                                            }`}
                                                        >
                                                            {trade.side}
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] text-fg-subtle mt-0.5 font-mono">
                                                        {dateLabel} · @ {trade.entryPrice}
                                                    </div>
                                                </div>
                                                <div
                                                    className={`text-xs font-mono font-bold shrink-0 ml-2 ${
                                                        trade.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'
                                                    }`}
                                                >
                                                    {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="h-4 w-px mx-1 bg-line shrink-0" />

                    {/* Functional Timeframe Pills (targets focused pane in multi-layout mode) */}
                    <div className="flex items-center gap-0.5">
                        {layoutMode !== '1x1' && (
                            <span
                                className="hidden xl:inline-flex items-center px-1.5 py-0.5 mr-0.5 rounded bg-accent/12 text-accent-fg text-[10px] font-bold font-mono"
                                title={isEn ? 'Selected pane for timeframe changes' : 'Painel selecionado para troca de Timeframe'}
                            >
                                P{focusedPaneIndex + 1}
                            </span>
                        )}
                        {TIMEFRAMES.map(tf => {
                            const active = displayedPeriod.text === tf.text;
                            return (
                                <button
                                    key={tf.text}
                                    type="button"
                                    onClick={() => handleTimeframeClick(tf)}
                                    className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                                        active
                                            ? 'bg-accent/15 text-accent-fg font-bold'
                                            : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                                    }`}
                                >
                                    {tf.text}
                                </button>
                            );
                        })}
                    </div>

                    <div className="h-4 w-px mx-1 bg-line shrink-0" />

                    {/* Candles Button -> Opens Clean Simple Modal */}
                    <button
                        type="button"
                        onClick={() => {
                            setOpenDropdown('none');
                            if (onSelectCandleStyle) {
                                setCandleModalOpen(true);
                            } else {
                                onCycleCandleStyle();
                            }
                        }}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg transition-colors cursor-pointer"
                        title={`${isEn ? 'Candle Style' : 'Tipo de Candle'}: ${candleLabels[selectedCandleStyle] || activeStyleOption.label}`}
                    >
                        {activeStyleOption.group === 'bars_candles' ? (
                            <CandlestickChart size={15} className="text-accent-fg" />
                        ) : activeStyleOption.group === 'lines_areas' ? (
                            <TrendingUp size={15} className="text-accent-fg" />
                        ) : (
                            <BarChart2 size={15} className="text-accent-fg" />
                        )}
                        <span className="hidden lg:inline font-semibold text-[11px] text-fg">
                            {candleLabels[selectedCandleStyle] || activeStyleOption.shortLabel}
                        </span>
                    </button>

                    {/* Indicators Button -> Opens Simplified Search + Name Modal */}
                    <button
                        type="button"
                        onClick={() => {
                            setOpenDropdown('none');
                            onOpenIndicators();
                        }}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg font-medium transition-colors cursor-pointer"
                        title={isEn ? 'Technical Indicators' : 'Indicadores Técnicos'}
                    >
                        <span className="italic font-serif font-bold text-sm text-accent-fg">fx</span>
                        <span className="hidden md:inline text-[11px] font-semibold">
                            {isEn ? 'Indicators' : 'Indicadores'}
                        </span>
                        {activeIndicatorsCount > 0 && (
                            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-accent text-accent-on font-bold">
                                {activeIndicatorsCount}
                            </span>
                        )}
                    </button>

                    <div className="h-4 w-px mx-1 bg-line shrink-0" />

                    {/* Undo / Redo */}
                    <button
                        type="button"
                        onClick={onUndoState || onUndoDrawing}
                        disabled={onUndoState ? !canUndoState : false}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                            canUndoState ? 'hover:bg-surface-2 text-fg' : 'text-fg-subtle'
                        }`}
                        title={isEn ? 'Undo (Ctrl+Z)' : 'Desfazer (Ctrl+Z)'}
                    >
                        <Undo2 size={14} />
                    </button>
                    <button
                        type="button"
                        onClick={onRedoState || onClearDrawings}
                        disabled={onRedoState ? !canRedoState : false}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                            canRedoState ? 'hover:bg-surface-2 text-fg' : 'text-fg-subtle'
                        }`}
                        title={isEn ? 'Redo (Ctrl+Y)' : 'Refazer (Ctrl+Y)'}
                    >
                        <Redo2 size={14} />
                    </button>
                </div>

                {/* Right Group: Hybrid Storage Telemetry Pill, Multi-Layout Selector, Focus Mode, Shortcuts, Theme, Settings, Camera, Fullscreen */}
                <div className="flex items-center gap-1 shrink-0">
                    {/* Cloud Sync Status Pill (details on hover tooltip) */}
                    <div
                        className="hidden md:flex items-center gap-1.5 px-2.5 py-0.5 mr-0.5 rounded-lg border border-line bg-surface-2/60 text-[11px] font-medium text-fg-muted"
                        title={
                            offlineOutboxCount > 0 || syncStatus === 'offline_queued'
                                ? isEn
                                    ? `Saved locally · ${Math.max(1, offlineOutboxCount)} update(s) queued for cloud sync`
                                    : `Salvo localmente · ${Math.max(1, offlineOutboxCount)} atualização(ões) na fila de sincronização`
                                : syncStatus === 'saving_local' || syncStatus === 'syncing_cloud'
                                  ? isEn
                                      ? `Saving session state (${cacheLayer} · Rev #${revision})...`
                                      : `A guardar sessão (${cacheLayer} · Rev #${revision})...`
                                  : isEn
                                    ? `Session saved (${cacheLayer} · Rev #${revision})`
                                    : `Sessão guardada (${cacheLayer} · Rev #${revision})`
                        }
                    >
                        <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                                syncStatus === 'saving_local' || syncStatus === 'syncing_cloud'
                                    ? 'bg-amber-400 animate-pulse'
                                    : offlineOutboxCount > 0 || syncStatus === 'offline_queued'
                                      ? 'bg-amber-500'
                                      : syncStatus === 'error'
                                        ? 'bg-rose-500'
                                        : 'bg-emerald-500'
                            }`}
                        />
                        <span className="font-semibold text-fg">
                            {syncStatus === 'saving_local' || syncStatus === 'syncing_cloud'
                                ? isEn
                                    ? 'Saving…'
                                    : 'Salvando…'
                                : offlineOutboxCount > 0 || syncStatus === 'offline_queued'
                                  ? offlineOutboxCount > 0
                                      ? `Offline (${offlineOutboxCount})`
                                      : 'Offline'
                                  : syncStatus === 'error'
                                    ? isEn
                                        ? 'Pending'
                                        : 'Pendente'
                                    : isEn
                                      ? 'Saved'
                                      : 'Salvo'}
                        </span>
                    </div>

                    {/* Multi-Chart Layout Selector (6 Functional Divisions) */}
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setOpenDropdown(v => (v === 'layout' ? 'none' : 'layout'))}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer transition-colors ${
                                layoutMode !== '1x1'
                                    ? 'border-accent/50 bg-accent/10 text-accent-fg font-bold'
                                    : 'border-line text-fg-muted hover:text-fg hover:bg-surface-2'
                            }`}
                            title={`${isEn ? 'Screen Layout' : 'Layout de Tela'}: ${isEn ? (activeLayoutMeta.labelEn || activeLayoutMeta.label) : activeLayoutMeta.label}`}
                        >
                            <LayoutGridIcon mode={layoutMode} size={14} />
                            <span className="hidden sm:inline">{layoutMode}</span>
                            <ChevronDown size={11} className="opacity-60" />
                        </button>

                        {openDropdown === 'layout' && (
                            <div className="absolute right-0 top-full mt-1.5 w-72 rounded-xl border border-line bg-surface p-2 shadow-2xl z-[130] text-fg">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted px-2 py-1">
                                    {isEn ? 'Workspace Split Layout' : 'Divisão da Área de Trabalho'}
                                </div>

                                <div className="space-y-0.5">
                                    {LAYOUT_OPTIONS.map(opt => {
                                        const isSelected = layoutMode === opt.id;
                                        return (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => {
                                                    onChangeLayoutMode(opt.id);
                                                    setOpenDropdown('none');
                                                }}
                                                className={`w-full px-2.5 py-2 rounded-lg text-left flex items-center justify-between text-xs cursor-pointer transition-colors ${
                                                    isSelected
                                                        ? 'bg-accent/15 text-accent-fg font-bold'
                                                        : 'hover:bg-surface-2 text-fg'
                                                }`}
                                            >
                                                <span className="flex items-center gap-2.5">
                                                    <LayoutGridIcon mode={opt.id} size={15} />
                                                    <span>{isEn ? (opt.labelEn || opt.label) : opt.label}</span>
                                                </span>
                                                {isSelected && <Check size={13} className="text-accent-fg shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>

                                {activeLayoutMeta.panes > 1 && (
                                    <div className="border-t border-line mt-2 pt-2 px-1 space-y-1.5">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted px-1">
                                            {isEn ? 'Timeframes per Pane' : 'Timeframes por Painel'}
                                        </div>
                                        {Array.from({ length: activeLayoutMeta.panes }).map((_, pIdx) => {
                                            const pPeriod =
                                                pIdx === 0
                                                    ? currentPeriod
                                                    : panePeriods?.[pIdx] || secondaryPeriod;
                                            return (
                                                <div key={pIdx} className="flex items-center justify-between gap-1.5 px-1">
                                                    <span className="text-[10px] font-mono font-bold text-fg-muted w-8">
                                                        P{pIdx + 1}
                                                    </span>
                                                    <div className="flex items-center gap-0.5 flex-1 justify-end">
                                                        {TIMEFRAMES.map(tf => {
                                                            const tfActive = pPeriod.text === tf.text;
                                                            return (
                                                                <button
                                                                    key={tf.text}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        if (pIdx === 0) {
                                                                            onSelectPeriod(tf);
                                                                        } else if (onSelectPanePeriod) {
                                                                            onSelectPanePeriod(pIdx, tf);
                                                                        } else {
                                                                            onSelectSecondaryPeriod(tf);
                                                                        }
                                                                    }}
                                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                                                                        tfActive
                                                                            ? 'bg-accent text-accent-on'
                                                                            : 'bg-surface-2 text-fg-muted hover:text-fg'
                                                                    }`}
                                                                >
                                                                    {tf.text}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Focus Workspace Mode (Collapse / Expand Sidebars) */}
                    {onToggleFocusWorkspace && (
                        <button
                            type="button"
                            onClick={onToggleFocusWorkspace}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                focusWorkspaceMode
                                    ? 'bg-accent/15 text-accent-fg'
                                    : 'hover:bg-surface-2 text-fg-muted hover:text-fg'
                            }`}
                            title={
                                focusWorkspaceMode
                                    ? isEn
                                        ? 'Show Side Panels'
                                        : 'Mostrar Barras Laterais'
                                    : isEn
                                      ? 'Focus Mode (Hide Sidebars)'
                                      : 'Modo Foco (Ocultar Laterais)'
                            }
                        >
                            {focusWorkspaceMode ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
                        </button>
                    )}

                    {/* Keyboard Shortcuts Popover */}
                    <div className="relative hidden lg:block">
                        <button
                            type="button"
                            onClick={() => setOpenDropdown(v => (v === 'shortcuts' ? 'none' : 'shortcuts'))}
                            className="p-1.5 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg transition-colors cursor-pointer"
                            title={isEn ? 'Keyboard Shortcuts' : 'Atalhos de Teclado'}
                        >
                            <Keyboard size={15} />
                        </button>
                        {openDropdown === 'shortcuts' && (
                            <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-line bg-surface p-3 shadow-2xl z-[130] text-[11px] space-y-1.5 text-fg-muted">
                                <div className="font-bold text-xs text-fg mb-1">
                                    {isEn ? 'Keyboard Shortcuts' : 'Atalhos de Teclado'}
                                </div>
                                <div className="flex justify-between">
                                    <span>{isEn ? 'Play / Pause Replay' : 'Play / Pause Replay'}</span>
                                    <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono text-fg">
                                        {isEn ? 'Space' : 'Espaço'}
                                    </kbd>
                                </div>
                                <div className="flex justify-between">
                                    <span>{isEn ? 'Step +1 Candle' : 'Avançar +1 Vela'}</span>
                                    <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono text-fg">→</kbd>
                                </div>
                                <div className="flex justify-between">
                                    <span>{isEn ? 'Step -1 Candle' : 'Voltar -1 Vela'}</span>
                                    <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono text-fg">←</kbd>
                                </div>
                                <div className="flex justify-between">
                                    <span>{isEn ? 'Slice Chart' : 'Cortar Gráfico'}</span>
                                    <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono text-fg">C</kbd>
                                </div>
                                <div className="flex justify-between">
                                    <span>{isEn ? 'Quick Buy' : 'Compra Rápida'}</span>
                                    <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono text-fg">Alt + B</kbd>
                                </div>
                                <div className="flex justify-between">
                                    <span>{isEn ? 'Quick Sell' : 'Venda Rápida'}</span>
                                    <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono text-fg">Alt + S</kbd>
                                </div>
                                <div className="flex justify-between">
                                    <span>{isEn ? 'Exit Fullscreen / Close' : 'Sair Tela Cheia / Fechar'}</span>
                                    <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono text-fg">Esc</kbd>
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={onResetSimulation}
                        className="p-1.5 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg transition-colors cursor-pointer"
                        title={isEn ? 'Reset Simulation' : 'Reiniciar Simulação'}
                    >
                        <RotateCcw size={14} />
                    </button>

                    <button
                        type="button"
                        onClick={onToggleTheme}
                        className="p-1.5 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg transition-colors cursor-pointer"
                        title={
                            isLight
                                ? isEn
                                    ? 'Dark Theme'
                                    : 'Tema Escuro'
                                : isEn
                                  ? 'Light Theme'
                                  : 'Tema Claro'
                        }
                    >
                        {isLight ? <Moon size={15} /> : <Sun size={15} />}
                    </button>

                    <button
                        type="button"
                        onClick={onToggleTradeDrawer}
                        className="p-1.5 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg transition-colors cursor-pointer"
                        title={isEn ? 'Order Ticket' : 'Boleta de Ordem'}
                    >
                        <Settings size={15} />
                    </button>

                    <button
                        type="button"
                        onClick={onScreenshot}
                        className="p-1.5 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg transition-colors cursor-pointer"
                        title={isEn ? 'Capture Chart' : 'Capturar Gráfico'}
                    >
                        <Camera size={15} />
                    </button>

                    {onToggleFullscreen && (
                        <button
                            type="button"
                            onClick={onToggleFullscreen}
                            className={`flex items-center justify-center p-1.5 rounded-lg transition-colors cursor-pointer ${
                                isFullscreen
                                    ? 'bg-accent text-accent-on font-bold shadow-xs'
                                    : 'hover:bg-surface-2 text-fg-muted hover:text-fg'
                            }`}
                            title={
                                isFullscreen
                                    ? isEn
                                        ? 'Restore Window (Esc)'
                                        : 'Restaurar Janela (Esc)'
                                    : isEn
                                      ? 'Maximize Fullscreen'
                                      : 'Maximizar em Tela Cheia'
                            }
                        >
                            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                        </button>
                    )}
                </div>
            </header>

            {/* SIMPLE CANDLE STYLES MODAL (Portal above entire workspace) */}
            {candleModalOpen &&
                onSelectCandleStyle &&
                typeof document !== 'undefined' &&
                createPortal(
                    <div
                        className="fixed inset-0 z-[10050] bg-black/45 backdrop-blur-xs flex items-center justify-center p-4"
                        onClick={() => setCandleModalOpen(false)}
                    >
                        <div
                            onClick={e => e.stopPropagation()}
                            className="w-full max-w-xs rounded-2xl border border-line bg-surface text-fg shadow-2xl overflow-hidden"
                        >
                            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                                <span className="font-bold text-xs text-fg">
                                    {isEn ? 'Candle Styles' : 'Tipos de Candles'}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setCandleModalOpen(false)}
                                    className="p-1 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg cursor-pointer"
                                >
                                    <X size={15} />
                                </button>
                            </div>
                            <div className="py-1.5 max-h-[70vh] overflow-y-auto">
                                {CANDLE_STYLE_OPTIONS.map(opt => {
                                    const isSelected = selectedCandleStyle === opt.id;
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => {
                                                onSelectCandleStyle(opt.id);
                                                setCandleModalOpen(false);
                                            }}
                                            className={`w-full px-4 py-2 text-left flex items-center justify-between text-xs cursor-pointer transition-colors ${
                                                isSelected
                                                    ? 'bg-accent/15 text-accent-fg font-bold'
                                                    : 'hover:bg-surface-2 text-fg'
                                            }`}
                                        >
                                            <span className="flex items-center gap-2.5">
                                                {opt.group === 'bars_candles' ? (
                                                    <CandlestickChart size={14} className="opacity-80 shrink-0" />
                                                ) : opt.group === 'lines_areas' ? (
                                                    <TrendingUp size={14} className="opacity-80 shrink-0" />
                                                ) : (
                                                    <Activity size={14} className="opacity-80 shrink-0" />
                                                )}
                                                <span>{candleLabels[opt.id] || opt.label}</span>
                                            </span>
                                            {isSelected && <Check size={14} className="text-accent-fg shrink-0" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
});

TopToolbarLayer.displayName = 'TopToolbarLayer';
