import React, { memo, useState, useRef, useEffect } from 'react';
import {
    Crosshair,
    TrendingUp,
    Percent,
    Activity,
    Target,
    Brush,
    Type,
    Smile,
    Ruler,
    ZoomIn,
    Magnet,
    Lock,
    Eye,
    EyeOff,
    Trash2,
    Star,
} from 'lucide-react';

export interface DrawingToolOption {
    id: string;
    label: string;
    section?: string;
    shortcut?: string;
    extendData?: string;
    iconType:
        | 'trendline'
        | 'ray'
        | 'infoline'
        | 'extended'
        | 'angle'
        | 'hline'
        | 'hray'
        | 'vline'
        | 'crossline'
        | 'channel'
        | 'fib_retrace'
        | 'fib_ext'
        | 'fib_circle'
        | 'fib_spiral'
        | 'fib_arc'
        | 'fib_fan'
        | 'gann'
        | 'xabcd'
        | 'abcd'
        | 'elliott5'
        | 'elliott3'
        | 'headshoulders'
        | 'triangle'
        | 'long_pos'
        | 'short_pos'
        | 'rect'
        | 'circle'
        | 'parallelogram'
        | 'text_badge'
        | 'callout'
        | 'emoji'
        | 'ruler'
        | 'priceline';
}

const TOOL_GROUPS: Record<string, DrawingToolOption[]> = {
    lines: [
        { id: 'straightLine', label: 'Trendline (Linha de Tendência)', section: 'LINES', shortcut: '⌥ T', iconType: 'trendline' },
        { id: 'rayLine', label: 'Ray (Raio Direcional)', shortcut: '⌥ R', iconType: 'ray' },
        { id: 'segment', label: 'Info line (Segmento / Distância)', iconType: 'infoline' },
        { id: 'straightLine', label: 'Extended line (Linha Estendida)', iconType: 'extended' },
        { id: 'rayLine', label: 'Trend angle (Ângulo de Tendência)', iconType: 'angle' },
        { id: 'horizontalStraightLine', label: 'Horizontal line (Linha Horizontal)', shortcut: '⌥ H', iconType: 'hline' },
        { id: 'horizontalRayLine', label: 'Horizontal ray (Raio Horizontal)', shortcut: '⌥ J', iconType: 'hray' },
        { id: 'verticalStraightLine', label: 'Vertical line (Linha Vertical)', shortcut: '⌥ V', iconType: 'vline' },
        { id: 'priceChannelLine', label: 'Crossline (Linha Cruzada)', shortcut: '⌥ C', iconType: 'crossline' },
        { id: 'parallelStraightLine', label: 'Parallel channel (Canal Paralelo)', section: 'CHANNELS', iconType: 'channel' },
    ],
    fib: [
        { id: 'fibonacciLine', label: 'Fib retracement (Retração Fib)', section: 'FIBONACCI', shortcut: '⌥ F', iconType: 'fib_retrace' },
        { id: 'fibonacciSegment', label: 'Trend-based Fib extension', iconType: 'fib_ext' },
        { id: 'fibonacciCircle', label: 'Fib circles (Círculos Fib)', iconType: 'fib_circle' },
        { id: 'fibonacciSpiral', label: 'Fib spiral (Espiral Fib)', iconType: 'fib_spiral' },
        { id: 'fibonacciSpeedResistanceFan', label: 'Fib speed resistance fan', iconType: 'fib_fan' },
        { id: 'gannBox', label: 'Gann box (Caixa de Gann)', section: 'GANN', iconType: 'gann' },
    ],
    patterns: [
        { id: 'xabcd', label: 'XABCD Pattern (Harmônico)', section: 'PATTERNS', iconType: 'xabcd' },
        { id: 'abcd', label: 'ABCD Pattern', iconType: 'abcd' },
        { id: 'threeWaves', label: 'Three Drives / 3 Ondas', iconType: 'elliott3' },
        { id: 'fiveWaves', label: 'Elliott Impulse Wave (12345)', section: 'ELLIOTT WAVES', iconType: 'elliott5' },
        { id: 'eightWaves', label: 'Elliott 8 Waves (1-5 + ABC)', iconType: 'elliott5' },
        { id: 'anyWaves', label: 'Ondas Livres (Multi-Pivot)', iconType: 'elliott3' },
    ],
    position: [
        { id: 'tvLongPosition', label: 'Long Position (Compra R:R)', section: 'PROJECTION R:R', shortcut: '⌥ L', iconType: 'long_pos' },
        { id: 'tvShortPosition', label: 'Short Position (Venda R:R)', shortcut: '⌥ S', iconType: 'short_pos' },
    ],
    shapes: [
        { id: 'rect', label: 'Rectangle (Zona / Order Block)', section: 'SHAPES & ZONES', iconType: 'rect' },
        { id: 'circle', label: 'Circle (Círculo de Liquidez)', iconType: 'circle' },
        { id: 'parallelogram', label: 'Parallelogram (Canal Inclinado)', iconType: 'parallelogram' },
        { id: 'triangle', label: 'Triangle (Triângulo)', iconType: 'triangle' },
    ],
    text: [
        { id: 'tvTextAnnotation', label: 'BOS (Break of Structure)', section: 'SMC & TEXTO', extendData: 'BOS', iconType: 'text_badge' },
        { id: 'tvTextAnnotation', label: 'CHoCH (Change of Character)', extendData: 'CHoCH', iconType: 'text_badge' },
        { id: 'tvTextAnnotation', label: 'FVG (Fair Value Gap)', extendData: 'FVG', iconType: 'text_badge' },
        { id: 'tvTextAnnotation', label: 'Order Block (OB Institucional)', extendData: 'OB', iconType: 'text_badge' },
        { id: 'tvTextAnnotation', label: 'Liquidez ($$$ Sweep)', extendData: '$$$ Liquidez', iconType: 'text_badge' },
        { id: 'tvPriceCallout', label: 'Callout c/ Preço (Caixa + Seta)', section: 'CALLOUTS', extendData: 'Zona Chave', iconType: 'callout' },
    ],
    emoji: [
        { id: 'tvEmojiMarker', label: '🎯 Alvo / Entrada Sniper', section: 'MARCADORES', extendData: '🎯', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '🚀 Rompimento / Impulso Forte', extendData: '🚀', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '🔥 Zona Quente / Alta Volatilidade', extendData: '🔥', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '💎 Setup A+ Institucional', extendData: '💎', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '💰 Liquidez / Take Profit', extendData: '💰', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '⚠️ Atenção / Notícia / Trap', extendData: '⚠️', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '✅ Trade Vencedor / Confirmado', extendData: '✅', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '❌ Stop / Invalidação', extendData: '❌', iconType: 'emoji' },
    ],
    ruler: [
        { id: 'tvMeasureRuler', label: 'Measure Ruler (Preço, % e Velas)', section: 'MEDIÇÃO', shortcut: '⇧ M', iconType: 'ruler' },
        { id: 'priceLine', label: 'Price Line (Linha de Preço Exato)', iconType: 'priceline' },
    ],
};

const QUICK_EMOJIS = ['🎯', '🚀', '🔥', '💎', '💰', '🐋', '⚡', '👀', '✅', '❌', '⚠️', '🛑', '📈', '📉', '⭐', '❤️'];

/** Geometric SVG Icon matching TradingView / Traynio tool menus */
const ToolSvgIcon: React.FC<{ type: DrawingToolOption['iconType']; emoji?: string }> = ({ type, emoji }) => {
    if (type === 'emoji' && emoji) {
        return <span className="w-5 h-5 flex items-center justify-center text-sm leading-none">{emoji}</span>;
    }

    return (
        <svg viewBox="0 0 20 20" className="w-4 h-4 shrink-0 stroke-current fill-none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {type === 'trendline' && (
                <>
                    <line x1="4" y1="16" x2="16" y2="4" />
                    <circle cx="4" cy="16" r="1.8" className="fill-current" />
                    <circle cx="16" cy="4" r="1.8" className="fill-current" />
                </>
            )}
            {type === 'ray' && (
                <>
                    <line x1="4" y1="16" x2="17" y2="3" />
                    <circle cx="4" cy="16" r="1.8" className="fill-current" />
                </>
            )}
            {type === 'infoline' && (
                <>
                    <line x1="4" y1="16" x2="16" y2="4" />
                    <circle cx="4" cy="16" r="1.6" className="fill-current" />
                    <circle cx="16" cy="4" r="1.6" className="fill-current" />
                    <rect x="9" y="10" width="7" height="5" rx="1" strokeWidth="1.2" />
                </>
            )}
            {type === 'extended' && (
                <>
                    <line x1="2" y1="18" x2="18" y2="2" />
                    <circle cx="7" cy="13" r="1.6" className="fill-current" />
                    <circle cx="13" cy="7" r="1.6" className="fill-current" />
                </>
            )}
            {type === 'angle' && (
                <>
                    <line x1="4" y1="15" x2="15" y2="4" />
                    <line x1="4" y1="15" x2="16" y2="15" strokeDasharray="2 2" />
                    <path d="M10 15 A6 6 0 0 0 8.5 10.5" />
                    <circle cx="4" cy="15" r="1.6" className="fill-current" />
                </>
            )}
            {type === 'hline' && (
                <>
                    <line x1="2" y1="10" x2="18" y2="10" />
                    <circle cx="10" cy="10" r="1.8" className="fill-current" />
                </>
            )}
            {type === 'hray' && (
                <>
                    <line x1="4" y1="10" x2="18" y2="10" />
                    <circle cx="4" cy="10" r="1.8" className="fill-current" />
                </>
            )}
            {type === 'vline' && (
                <>
                    <line x1="10" y1="2" x2="10" y2="18" />
                    <circle cx="10" cy="10" r="1.8" className="fill-current" />
                </>
            )}
            {type === 'crossline' && (
                <>
                    <line x1="2" y1="10" x2="18" y2="10" />
                    <line x1="10" y1="2" x2="10" y2="18" />
                    <circle cx="10" cy="10" r="1.8" className="fill-current" />
                </>
            )}
            {type === 'channel' && (
                <>
                    <line x1="3" y1="14" x2="14" y2="3" />
                    <line x1="6" y1="17" x2="17" y2="6" />
                    <circle cx="3" cy="14" r="1.5" className="fill-current" />
                    <circle cx="14" cy="3" r="1.5" className="fill-current" />
                    <circle cx="6" cy="17" r="1.5" className="fill-current" />
                </>
            )}
            {type === 'fib_retrace' && (
                <>
                    <line x1="3" y1="4" x2="17" y2="4" />
                    <line x1="3" y1="8" x2="17" y2="8" strokeDasharray="2 2" />
                    <line x1="3" y1="12" x2="17" y2="12" strokeDasharray="2 2" />
                    <line x1="3" y1="16" x2="17" y2="16" />
                    <circle cx="4" cy="16" r="1.5" className="fill-current" />
                    <circle cx="16" cy="4" r="1.5" className="fill-current" />
                </>
            )}
            {type === 'fib_ext' && (
                <>
                    <polyline points="3,15 8,6 12,12 17,3" />
                    <line x1="8" y1="6" x2="17" y2="6" strokeDasharray="2 2" />
                    <line x1="12" y1="12" x2="17" y2="12" strokeDasharray="2 2" />
                </>
            )}
            {type === 'fib_circle' && (
                <>
                    <circle cx="10" cy="10" r="7" />
                    <circle cx="10" cy="10" r="4" strokeDasharray="2 2" />
                    <circle cx="10" cy="10" r="1.4" className="fill-current" />
                </>
            )}
            {type === 'fib_spiral' && (
                <path d="M10 10 C10 8, 12 8, 12 10 C12 13, 7 13, 7 9 C7 4, 15 4, 15 11 C15 16, 5 16, 4 10" />
            )}
            {type === 'fib_arc' && (
                <>
                    <line x1="4" y1="16" x2="16" y2="4" />
                    <path d="M6 16 A6 6 0 0 1 16 6" />
                    <path d="M9 16 A9 9 0 0 1 16 9" strokeDasharray="2 2" />
                </>
            )}
            {type === 'fib_fan' && (
                <>
                    <line x1="3" y1="17" x2="17" y2="3" />
                    <line x1="3" y1="17" x2="17" y2="8" />
                    <line x1="3" y1="17" x2="17" y2="13" />
                    <circle cx="3" cy="17" r="1.6" className="fill-current" />
                </>
            )}
            {type === 'gann' && (
                <>
                    <rect x="3" y="3" width="14" height="14" rx="1" />
                    <line x1="3" y1="17" x2="17" y2="3" />
                    <line x1="3" y1="3" x2="17" y2="17" strokeDasharray="2 2" />
                </>
            )}
            {(type === 'xabcd' || type === 'abcd') && (
                <>
                    <polyline points="2,15 6,5 10,12 14,4 18,14" />
                    <line x1="2" y1="15" x2="10" y2="12" strokeDasharray="2 2" />
                    <line x1="6" y1="5" x2="14" y2="4" strokeDasharray="2 2" />
                </>
            )}
            {(type === 'elliott5' || type === 'elliott3' || type === 'headshoulders') && (
                <>
                    <polyline points="2,16 6,9 9,13 13,4 16,9 18,3" />
                    <circle cx="6" cy="9" r="1.3" className="fill-current" />
                    <circle cx="13" cy="4" r="1.3" className="fill-current" />
                </>
            )}
            {type === 'long_pos' && (
                <>
                    <rect x="3" y="3" width="14" height="7" className="fill-emerald-500/20 stroke-emerald-500" />
                    <rect x="3" y="10" width="14" height="7" className="fill-rose-500/20 stroke-rose-500" />
                    <line x1="2" y1="10" x2="18" y2="10" strokeWidth="2" />
                </>
            )}
            {type === 'short_pos' && (
                <>
                    <rect x="3" y="3" width="14" height="7" className="fill-rose-500/20 stroke-rose-500" />
                    <rect x="3" y="10" width="14" height="7" className="fill-emerald-500/20 stroke-emerald-500" />
                    <line x1="2" y1="10" x2="18" y2="10" strokeWidth="2" />
                </>
            )}
            {type === 'rect' && (
                <>
                    <rect x="3" y="5" width="14" height="10" rx="1" />
                    <circle cx="3" cy="5" r="1.5" className="fill-current" />
                    <circle cx="17" cy="15" r="1.5" className="fill-current" />
                </>
            )}
            {type === 'circle' && (
                <>
                    <circle cx="10" cy="10" r="6.5" />
                    <circle cx="10" cy="10" r="1.4" className="fill-current" />
                </>
            )}
            {type === 'parallelogram' && (
                <polygon points="6,5 17,5 14,15 3,15" />
            )}
            {type === 'triangle' && (
                <polygon points="10,4 17,16 3,16" />
            )}
            {type === 'text_badge' && (
                <>
                    <rect x="2.5" y="4" width="15" height="9" rx="2" />
                    <line x1="7" y1="7" x2="13" y2="7" />
                    <line x1="10" y1="7" x2="10" y2="11" />
                    <line x1="10" y1="13" x2="10" y2="17" />
                </>
            )}
            {type === 'callout' && (
                <>
                    <path d="M4 4 H16 V11 H9 L5 16 L6 11 H4 Z" />
                </>
            )}
            {type === 'ruler' && (
                <>
                    <rect x="3" y="5" width="14" height="10" rx="1" strokeDasharray="2 2" />
                    <line x1="10" y1="5" x2="10" y2="15" />
                    <line x1="3" y1="10" x2="17" y2="10" />
                </>
            )}
            {type === 'priceline' && (
                <>
                    <line x1="2" y1="10" x2="12" y2="10" strokeDasharray="2 2" />
                    <rect x="12" y="7" width="6" height="6" rx="1" />
                </>
            )}
        </svg>
    );
};

interface LeftDrawingLayerProps {
    cutCandleMode: boolean;
    zoomAreaMode?: boolean;
    magnetMode: boolean;
    drawingsLocked: boolean;
    drawingsVisible: boolean;
    onSelectDrawingTool: (overlayName: string, extendData?: string, label?: string, replacePending?: boolean) => void;
    onCancelPendingTool?: () => void;
    onZoomIn: () => void;
    onToggleMagnet: () => void;
    onToggleLock: () => void;
    onToggleVisible: () => void;
    onClearDrawings: () => void;
}

export const LeftDrawingLayer: React.FC<LeftDrawingLayerProps> = memo(({
    cutCandleMode,
    zoomAreaMode = false,
    magnetMode,
    drawingsLocked,
    drawingsVisible,
    onSelectDrawingTool,
    onCancelPendingTool,
    onZoomIn,
    onToggleMagnet,
    onToggleLock,
    onToggleVisible,
    onClearDrawings,
}) => {
    const [activeToolGroup, setActiveToolGroup] = useState<string | null>(null);
    const [activeCategoryKey, setActiveCategoryKey] = useState<string | null>(null);
    const [favorites, setFavorites] = useState<string[]>(['straightLine', 'horizontalStraightLine', 'fibonacciLine', 'tvLongPosition']);
    const [customText, setCustomText] = useState<string>('BOS');
    const sidebarRef = useRef<HTMLDivElement | null>(null);

    // Close flyout when user clicks outside (e.g. directly on the chart canvas),
    // WITHOUT cancelling the already-activated Option 1 tool!
    useEffect(() => {
        if (!activeToolGroup) return;
        const handleOutsidePointerDown = (e: PointerEvent) => {
            if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
                setActiveToolGroup(null);
            }
        };
        window.addEventListener('pointerdown', handleOutsidePointerDown, true);
        return () => window.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    }, [activeToolGroup]);

    const toggleFavorite = (e: React.MouseEvent, key: string) => {
        e.stopPropagation();
        setFavorites(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
    };

    /**
     * Clicking a tool category button on the left bar:
     * 1. Immediately activates Option 1 of that category on the chart (`replacePending = true` if switching tools).
     * 2. Opens the flyout menu showing all other options in that category.
     * 3. If the user clicks directly on the chart canvas, the outside-click handler closes the menu while Option 1 draws immediately!
     */
    const handleCategoryClick = (groupKey: string) => {
        const list = TOOL_GROUPS[groupKey];
        if (!list || list.length === 0) return;

        const option1 = list[0];
        setActiveCategoryKey(groupKey);
        onSelectDrawingTool(option1.id, option1.extendData, option1.label, true);
        setActiveToolGroup(prev => (prev === groupKey ? null : groupKey));
    };

    const handleOptionClick = (groupKey: string, opt: DrawingToolOption) => {
        setActiveCategoryKey(groupKey);
        onSelectDrawingTool(opt.id, opt.extendData, opt.label, true);
        setActiveToolGroup(null);
    };

    const categories: { key: string; icon: React.ReactNode; title: string }[] = [
        { key: 'lines', icon: <TrendingUp size={17} />, title: 'Linhas & Canais (Opção 1: Trendline)' },
        { key: 'fib', icon: <Percent size={17} />, title: 'Fibonacci & Gann (Opção 1: Fib Retracement)' },
        { key: 'patterns', icon: <Activity size={17} />, title: 'Padrões Harmônicos & Ondas de Elliott' },
        { key: 'position', icon: <Target size={17} />, title: 'Projeção Risco/Retorno (Opção 1: Long Position)' },
        { key: 'shapes', icon: <Brush size={17} />, title: 'Formas & Zonas SMC (Opção 1: Retângulo OB)' },
        { key: 'text', icon: <Type size={17} />, title: 'Texto, BOS, CHoCH, FVG & Callouts' },
        { key: 'emoji', icon: <Smile size={17} />, title: 'Emojis & Stickers no Gráfico (Opção 1: 🎯)' },
        { key: 'ruler', icon: <Ruler size={17} />, title: 'Régua de Medição Preço / % / Velas' },
    ];

    return (
        <div
            ref={sidebarRef}
            className="w-12 border-r flex flex-col items-center py-2.5 gap-1.5 z-30 relative bg-surface border-line"
        >
            {/* Cursor / Crosshair Reset */}
            <button
                onClick={() => {
                    setActiveToolGroup(null);
                    setActiveCategoryKey(null);
                    onCancelPendingTool?.();
                }}
                title="Cursor Cruz (Crosshair)"
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    !activeCategoryKey && !cutCandleMode && !zoomAreaMode
                        ? 'bg-accent/10 text-accent'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                }`}
            >
                <Crosshair size={17} />
            </button>

            {categories.map(({ key, icon, title }) => {
                const isOpen = activeToolGroup === key;
                const isActive = activeCategoryKey === key && !zoomAreaMode;
                return (
                    <button
                        key={key}
                        onClick={() => handleCategoryClick(key)}
                        title={title}
                        className={`p-2 rounded-lg transition-colors cursor-pointer relative group ${
                            isOpen || isActive
                                ? 'bg-accent/15 text-accent font-semibold'
                                : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                        }`}
                    >
                        {icon}
                        <span className="w-1 h-1 rounded-full bg-current opacity-50 absolute bottom-1 right-1" />
                    </button>
                );
            })}

            <div className="w-6 h-px my-1 bg-line" />

            {/* Zoom In Area Selection */}
            <button
                onClick={() => {
                    setActiveToolGroup(null);
                    setActiveCategoryKey(null);
                    onZoomIn();
                }}
                title="Selecionar Área para Aumentar Zoom (Arraste no Gráfico)"
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    zoomAreaMode
                        ? 'bg-accent text-accent-on shadow-xs'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                }`}
            >
                <ZoomIn size={17} />
            </button>

            {/* Magnet Mode */}
            <button
                onClick={onToggleMagnet}
                title="Modo Ímã (Snap OHLC)"
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    magnetMode
                        ? 'bg-accent text-accent-on shadow-xs'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                }`}
            >
                <Magnet size={17} />
            </button>

            {/* Lock Drawings */}
            <button
                onClick={onToggleLock}
                title="Bloquear / Desbloquear Desenhos"
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    drawingsLocked
                        ? 'bg-warn/15 text-warn'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                }`}
            >
                <Lock size={17} />
            </button>

            {/* Show/Hide Drawings */}
            <button
                onClick={onToggleVisible}
                title="Mostrar / Ocultar Desenhos"
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    !drawingsVisible
                        ? 'bg-neg/15 text-neg'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                }`}
            >
                {drawingsVisible ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>

            {/* Trash Clear All */}
            <button
                onClick={onClearDrawings}
                title="Apagar Todos os Desenhos"
                className="p-2 rounded-lg transition-colors cursor-pointer mt-auto text-fg-muted hover:text-neg hover:bg-neg/10"
            >
                <Trash2 size={17} />
            </button>

            {/* Flyout Submenu (Traynio / TradingView Style) */}
            {activeToolGroup && TOOL_GROUPS[activeToolGroup] && (
                <div className="absolute left-12 top-2 w-64 rounded-xl border shadow-2xl py-1.5 z-50 bg-surface border-line text-fg max-h-[82vh] overflow-y-auto">
                    {/* Active Option 1 Banner */}
                    <div className="px-3 py-1 mb-1 flex items-center justify-between bg-accent/10 border-b border-line text-[10px] font-semibold text-accent">
                        <span>✓ Opção 1 ativa (clique no gráfico)</span>
                        <span className="opacity-75">ou escolha abaixo</span>
                    </div>

                    {/* Custom Text Input when 'text' group is open */}
                    {activeToolGroup === 'text' && (
                        <div className="px-3 py-2 border-b border-line space-y-1.5">
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                                Texto Personalizado no Gráfico
                            </label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="text"
                                    value={customText}
                                    onChange={e => setCustomText(e.target.value)}
                                    placeholder="Digite sua nota..."
                                    className="flex-1 px-2 py-1 rounded border border-line bg-surface-2 text-xs text-fg focus:outline-none focus:border-accent"
                                />
                                <button
                                    onClick={() => {
                                        const txt = customText.trim() || 'Nota';
                                        onSelectDrawingTool('tvTextAnnotation', txt, `Texto: ${txt}`, true);
                                        setActiveToolGroup(null);
                                    }}
                                    className="px-2.5 py-1 rounded bg-accent text-accent-on text-xs font-bold cursor-pointer hover:opacity-95"
                                >
                                    Usar
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Quick Emoji Palette Grid when 'emoji' group is open */}
                    {activeToolGroup === 'emoji' && (
                        <div className="px-3 py-2 border-b border-line">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1.5">
                                Escolha Rápida de Emoji
                            </div>
                            <div className="grid grid-cols-8 gap-1">
                                {QUICK_EMOJIS.map(em => (
                                    <button
                                        key={em}
                                        onClick={() => {
                                            onSelectDrawingTool('tvEmojiMarker', em, `Emoji ${em}`, true);
                                            setActiveToolGroup(null);
                                        }}
                                        className="h-7 rounded flex items-center justify-center text-base hover:bg-surface-2 cursor-pointer transition-transform hover:scale-110"
                                        title={`Inserir ${em}`}
                                    >
                                        {em}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tool List with Section Headers, Geometric Icons, Shortcuts & Favorite Star */}
                    {TOOL_GROUPS[activeToolGroup].map((opt, idx) => {
                        const favKey = `${opt.id}:${opt.label}`;
                        const isFav = favorites.includes(opt.id) || favorites.includes(favKey);
                        const isOption1 = idx === 0;

                        return (
                            <React.Fragment key={`${opt.id}_${opt.label}_${idx}`}>
                                {opt.section && (
                                    <div
                                        className={`px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-fg-muted ${
                                            idx > 0 ? 'border-t border-line mt-1' : ''
                                        }`}
                                    >
                                        {opt.section}
                                    </div>
                                )}
                                <div
                                    onClick={() => handleOptionClick(activeToolGroup, opt)}
                                    className={`w-full px-3 py-1.5 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                                        isOption1
                                            ? 'bg-accent/10 text-accent font-semibold hover:bg-accent/15'
                                            : 'text-fg hover:bg-surface-2'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                        <ToolSvgIcon type={opt.iconType} emoji={opt.extendData} />
                                        <span className="truncate">{opt.label}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {opt.shortcut && (
                                            <span className="text-[10px] font-mono text-fg-muted px-1 py-0.5 rounded bg-surface-2">
                                                {opt.shortcut}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={e => toggleFavorite(e, favKey)}
                                            className={`p-0.5 rounded hover:bg-surface-3 ${
                                                isFav ? 'text-amber-400' : 'text-fg-muted/40 hover:text-fg-muted'
                                            }`}
                                            title="Favoritar ferramenta"
                                        >
                                            <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
                                        </button>
                                    </div>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    );
});

LeftDrawingLayer.displayName = 'LeftDrawingLayer';
