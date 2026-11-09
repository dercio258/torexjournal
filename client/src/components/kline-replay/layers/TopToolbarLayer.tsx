import React, { useState, memo } from 'react';
import { SymbolInfo, Period } from '@klinecharts/pro';
import {
    ChevronDown, AlignLeft, Undo2, Redo2, Database,
    Moon, Sun, Settings, Camera, Columns2, Square, RotateCcw, Keyboard
} from 'lucide-react';
import { DataSourceMode, DEFAULT_SYMBOLS } from '../../../services/klineDatafeed';
import { TIMEFRAMES } from '../types';

export type ChartLayoutMode = '1x1' | '1x2';

interface TopToolbarLayerProps {
    isLight: boolean;
    currentSymbol: SymbolInfo;
    currentPeriod: Period;
    secondaryPeriod: Period;
    layoutMode: ChartLayoutMode;
    activeIndicatorsCount: number;
    dataSource: DataSourceMode;
    onSelectSymbol: (sym: SymbolInfo) => void;
    onSelectPeriod: (per: Period) => void;
    onSelectSecondaryPeriod: (per: Period) => void;
    onChangeLayoutMode: (mode: ChartLayoutMode) => void;
    onCycleCandleStyle: () => void;
    onOpenIndicators: () => void;
    onUndoDrawing: () => void;
    onClearDrawings: () => void;
    onChangeDataSource: (mode: DataSourceMode) => void;
    onToggleTheme: () => void;
    onToggleTradeDrawer: () => void;
    onResetSimulation: () => void;
    onScreenshot: () => void;
}

export const TopToolbarLayer: React.FC<TopToolbarLayerProps> = memo(({
    isLight,
    currentSymbol,
    currentPeriod,
    secondaryPeriod,
    layoutMode,
    activeIndicatorsCount,
    dataSource,
    onSelectSymbol,
    onSelectPeriod,
    onSelectSecondaryPeriod,
    onChangeLayoutMode,
    onCycleCandleStyle,
    onOpenIndicators,
    onUndoDrawing,
    onClearDrawings,
    onChangeDataSource,
    onToggleTheme,
    onToggleTradeDrawer,
    onResetSimulation,
    onScreenshot,
}) => {
    const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false);
    const [layoutDropdownOpen, setLayoutDropdownOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    return (
        <div className={`h-12 px-3 flex items-center justify-between border-b text-xs overflow-x-auto no-scrollbar ${
            'bg-surface border-line'
        }`}>
            {/* Left Group */}
            <div className="flex items-center gap-1.5 shrink-0">
                <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-accent-on font-black text-xs shadow-sm mr-1 shrink-0">
                    T
                </div>

                {/* Symbol Dropdown */}
                <div className="relative">
                    <button
                        onClick={() => {
                            setSymbolDropdownOpen(v => !v);
                            setLayoutDropdownOpen(false);
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
                            'hover:bg-surface-2 text-fg'
                        }`}
                    >
                        <span>{currentSymbol.ticker}</span>
                        <ChevronDown size={13} className="opacity-60" />
                    </button>

                    {symbolDropdownOpen && (
                        <div className={`fixed sm:absolute left-3 sm:left-0 top-14 sm:top-full mt-1 w-64 rounded-xl border shadow-2xl z-50 py-1.5 ${
                            'bg-surface border-line'
                        }`}>
                            {DEFAULT_SYMBOLS.map(sym => (
                                <button
                                    key={sym.ticker}
                                    onClick={() => {
                                        setSymbolDropdownOpen(false);
                                        onSelectSymbol(sym);
                                    }}
                                    className={`w-full px-3 py-2 text-left flex items-center justify-between text-xs cursor-pointer ${
                                        currentSymbol.ticker === sym.ticker
                                            ? 'bg-accent/10 text-accent-fg font-bold'
                                            : 'hover:bg-surface-2 text-fg-muted'
                                    }`}
                                >
                                    <div>
                                        <span className="font-bold block">{sym.ticker}</span>
                                        <span className="text-[10px] opacity-60">{sym.name}</span>
                                    </div>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 font-mono">
                                        {sym.exchange}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className={`h-5 w-px mx-1 ${'bg-surface-3'}`} />

                {/* Timeframe Pills */}
                <div className="flex items-center gap-0.5">
                    {TIMEFRAMES.map(tf => {
                        const active = currentPeriod.text === tf.text;
                        return (
                            <button
                                key={tf.text}
                                onClick={() => onSelectPeriod(tf)}
                                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                                    active
                                        ? 'bg-surface-2 text-fg font-bold shadow-2xs'
                                        : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                                }`}
                            >
                                {tf.text}
                            </button>
                        );
                    })}
                </div>

                <div className={`h-5 w-px mx-1 ${'bg-surface-3'}`} />

                {/* Candle Style */}
                <button
                    onClick={onCycleCandleStyle}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        'hover:bg-surface-2 text-fg-muted'
                    }`}
                    title="Alternar Estilo de Vela"
                >
                    <AlignLeft size={15} className="rotate-90" />
                </button>

                {/* fx Indicators */}
                <button
                    onClick={onOpenIndicators}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                        'hover:bg-surface-2 text-fg-muted'
                    }`}
                >
                    <span className="italic font-serif font-bold text-sm">fx</span>
                    <span>Indicators</span>
                    {activeIndicatorsCount > 0 && (
                        <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-accent text-accent-on font-bold">
                            {activeIndicatorsCount}
                        </span>
                    )}
                </button>

                <div className={`h-5 w-px mx-1 ${'bg-surface-3'}`} />

                {/* Undo / Clear */}
                <button
                    onClick={onUndoDrawing}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        'hover:bg-surface-2 text-fg-subtle'
                    }`}
                    title="Desfazer último desenho"
                >
                    <Undo2 size={14} />
                </button>
                <button
                    onClick={onClearDrawings}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        'hover:bg-surface-2 text-fg-subtle'
                    }`}
                    title="Limpar desenhos"
                >
                    <Redo2 size={14} />
                </button>
            </div>

            {/* Right Group */}
            <div className="flex items-center gap-2 shrink-0 ml-2">
                <div className={`hidden md:flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] ${
                    'bg-surface-2 border-line'
                }`}>
                    <Database size={12} className="text-accent-fg" />
                    <select
                        value={dataSource}
                        onChange={e => onChangeDataSource(e.target.value as DataSourceMode)}
                        className="bg-transparent font-semibold focus:outline-none cursor-pointer"
                    >
                        <option value="TRADINGVIEW">Fonte: TradingView</option>
                        <option value="MT5_BACKEND">Fonte: OANDA</option>
                        <option value="BINANCE_LIVE">Fonte: Binance (só cripto, ao vivo)</option>
                        <option value="DEMO">Demo (dados simulados)</option>
                    </select>
                </div>

                {/* Multi-Chart Layout Selector (1x1 vs 1x2 Split-Screen) */}
                <div className="relative">
                    <button
                        onClick={() => {
                            setLayoutDropdownOpen(v => !v);
                            setSymbolDropdownOpen(false);
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                            layoutMode === '1x2'
                                ? 'border-accent bg-accent/10 text-accent-fg font-bold'
                                : 'border-line text-fg-muted hover:bg-surface-2'
                        }`}
                        title="Alternar Layout Multi-Timeframe (1x1 ou 1x2 Split)"
                    >
                        {layoutMode === '1x2' ? <Columns2 size={13} /> : <Square size={13} />}
                        <span>Layout {layoutMode === '1x2' ? `(${currentPeriod.text} + ${secondaryPeriod.text})` : ''}</span>
                        <ChevronDown size={12} className="opacity-60" />
                    </button>

                    {layoutDropdownOpen && (
                        <div className={`fixed sm:absolute right-4 sm:right-0 top-14 sm:top-full mt-1 w-64 rounded-xl border p-2 shadow-2xl z-50 ${
                            'bg-surface border-line text-fg'
                        }`}>
                            <div className="text-[10px] font-bold uppercase tracking-wider opacity-50 px-2 py-1">
                                Modo de Visualização
                            </div>
                            <button
                                onClick={() => {
                                    onChangeLayoutMode('1x1');
                                    setLayoutDropdownOpen(false);
                                }}
                                className={`w-full px-2.5 py-2 rounded-lg text-left flex items-center justify-between text-xs cursor-pointer ${
                                    layoutMode === '1x1'
                                        ? 'bg-accent/10 text-accent-fg font-bold'
                                        : 'hover:bg-surface-2'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Square size={13} /> 1x1 Gráfico Único
                                </span>
                                {layoutMode === '1x1' && <span>✓</span>}
                            </button>

                            <button
                                onClick={() => {
                                    onChangeLayoutMode('1x2');
                                    setLayoutDropdownOpen(false);
                                }}
                                className={`w-full px-2.5 py-2 rounded-lg text-left flex items-center justify-between text-xs cursor-pointer mt-0.5 ${
                                    layoutMode === '1x2'
                                        ? 'bg-accent/10 text-accent-fg font-bold'
                                        : 'hover:bg-surface-2'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Columns2 size={13} /> 1x2 Split Multi-Timeframe
                                </span>
                                {layoutMode === '1x2' && <span>✓</span>}
                            </button>

                            <div className="border-t my-2 border-line" />
                            <div className="text-[10px] font-bold uppercase tracking-wider opacity-50 px-2 py-1">
                                Timeframe do 2º Gráfico (Direita)
                            </div>
                            <div className="flex items-center gap-1 px-1 pt-1">
                                {TIMEFRAMES.map(tf => (
                                    <button
                                        key={tf.text}
                                        onClick={() => {
                                            onSelectSecondaryPeriod(tf);
                                            if (layoutMode !== '1x2') onChangeLayoutMode('1x2');
                                        }}
                                        className={`flex-1 py-1 rounded text-[11px] font-bold cursor-pointer ${
                                            secondaryPeriod.text === tf.text
                                                ? 'bg-accent text-accent-on'
                                                : 'bg-surface-2 text-fg-muted'
                                        }`}
                                    >
                                        {tf.text}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Keyboard Shortcuts Popover */}
                <div className="relative hidden lg:block">
                    <button
                        onClick={() => setShortcutsOpen(v => !v)}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            'hover:bg-surface-2 text-fg-muted'
                        }`}
                        title="Atalhos de Teclado do Replay"
                    >
                        <Keyboard size={15} />
                    </button>
                    {shortcutsOpen && (
                        <div className={`absolute right-0 top-full mt-1 w-64 rounded-xl border p-3 shadow-2xl z-50 text-[11px] space-y-1.5 ${
                            'bg-surface border-line text-fg-muted'
                        }`}>
                            <div className="font-bold text-xs mb-1">Atalhos de Teclado</div>
                            <div className="flex justify-between"><span>Play / Pause Replay</span><kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono">Espaço</kbd></div>
                            <div className="flex justify-between"><span>Avançar +1 Vela</span><kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono">→</kbd></div>
                            <div className="flex justify-between"><span>Voltar -1 Vela</span><kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono">←</kbd></div>
                            <div className="flex justify-between"><span>Compra Rápida (Buy)</span><kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono">Alt + B</kbd></div>
                            <div className="flex justify-between"><span>Venda Rápida (Sell)</span><kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono">Alt + S</kbd></div>
                            <div className="flex justify-between"><span>Fechar Painéis</span><kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono">Esc</kbd></div>
                        </div>
                    )}
                </div>

                {/* Reset Simulation */}
                <button
                    onClick={onResetSimulation}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        'hover:bg-surface-2 text-fg-muted'
                    }`}
                    title="Resetar Simulação e Saldo"
                >
                    <RotateCcw size={14} />
                </button>

                <button
                    onClick={onToggleTheme}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        'hover:bg-surface-2 text-fg-muted'
                    }`}
                    title={isLight ? 'Tema Escuro' : 'Tema Claro'}
                >
                    {isLight ? <Moon size={15} /> : <Sun size={15} />}
                </button>

                <button
                    onClick={onToggleTradeDrawer}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        'hover:bg-surface-2 text-fg-muted'
                    }`}
                    title="Configurações / Boleta"
                >
                    <Settings size={15} />
                </button>

                <button
                    onClick={onScreenshot}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        'hover:bg-surface-2 text-fg-muted'
                    }`}
                    title="Capturar Screenshot"
                >
                    <Camera size={15} />
                </button>
            </div>
        </div>
    );
});
