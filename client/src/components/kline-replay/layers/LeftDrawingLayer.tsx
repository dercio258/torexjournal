import React, { memo, useState, useRef, useEffect } from 'react';
import { useLocale } from '../../../context/LocaleContext';
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
    labelEn?: string;
    section?: string;
    sectionEn?: string;
    shortcut?: string;
    extendData?: string;
    extendDataEn?: string;
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
        { id: 'straightLine', label: 'Trendline (Linha de Tendência)', labelEn: 'Trendline', section: 'LINES', sectionEn: 'LINES', shortcut: '⌥ T', iconType: 'trendline' },
        { id: 'rayLine', label: 'Ray (Raio Direcional)', labelEn: 'Ray', shortcut: '⌥ R', iconType: 'ray' },
        { id: 'segment', label: 'Info line (Segmento / Distância)', labelEn: 'Info Line', iconType: 'infoline' },
        { id: 'straightLine', label: 'Extended line (Linha Estendida)', labelEn: 'Extended Line', iconType: 'extended' },
        { id: 'rayLine', label: 'Trend angle (Ângulo de Tendência)', labelEn: 'Trend Angle', iconType: 'angle' },
        { id: 'horizontalStraightLine', label: 'Horizontal line (Linha Horizontal)', labelEn: 'Horizontal Line', shortcut: '⌥ H', iconType: 'hline' },
        { id: 'horizontalRayLine', label: 'Horizontal ray (Raio Horizontal)', labelEn: 'Horizontal Ray', shortcut: '⌥ J', iconType: 'hray' },
        { id: 'verticalStraightLine', label: 'Vertical line (Linha Vertical)', labelEn: 'Vertical Line', shortcut: '⌥ V', iconType: 'vline' },
        { id: 'priceChannelLine', label: 'Crossline (Linha Cruzada)', labelEn: 'Crossline', shortcut: '⌥ C', iconType: 'crossline' },
        { id: 'parallelStraightLine', label: 'Parallel channel (Canal Paralelo)', labelEn: 'Parallel Channel', section: 'CHANNELS', sectionEn: 'CHANNELS', iconType: 'channel' },
    ],
    fib: [
        { id: 'fibonacciLine', label: 'Fib retracement (Retração Fib)', labelEn: 'Fib Retracement', section: 'FIBONACCI', sectionEn: 'FIBONACCI', shortcut: '⌥ F', iconType: 'fib_retrace' },
        { id: 'fibonacciSegment', label: 'Trend-based Fib extension', labelEn: 'Trend-Based Fib Extension', iconType: 'fib_ext' },
        { id: 'fibonacciCircle', label: 'Fib circles (Círculos Fib)', labelEn: 'Fib Circles', iconType: 'fib_circle' },
        { id: 'fibonacciSpiral', label: 'Fib spiral (Espiral Fib)', labelEn: 'Fib Spiral', iconType: 'fib_spiral' },
        { id: 'fibonacciSpeedResistanceFan', label: 'Fib speed resistance fan', labelEn: 'Fib Speed Resistance Fan', iconType: 'fib_fan' },
        { id: 'gannBox', label: 'Gann box (Caixa de Gann)', labelEn: 'Gann Box', section: 'GANN', sectionEn: 'GANN', iconType: 'gann' },
    ],
    patterns: [
        { id: 'xabcd', label: 'XABCD Pattern (Harmônico)', labelEn: 'XABCD Harmonic Pattern', section: 'PATTERNS', sectionEn: 'PATTERNS', iconType: 'xabcd' },
        { id: 'abcd', label: 'ABCD Pattern', labelEn: 'ABCD Pattern', iconType: 'abcd' },
        { id: 'threeWaves', label: 'Three Drives / 3 Ondas', labelEn: 'Three Drives Pattern', iconType: 'elliott3' },
        { id: 'fiveWaves', label: 'Elliott Impulse Wave (12345)', labelEn: 'Elliott Impulse Wave (12345)', section: 'ELLIOTT WAVES', sectionEn: 'ELLIOTT WAVES', iconType: 'elliott5' },
        { id: 'eightWaves', label: 'Elliott 8 Waves (1-5 + ABC)', labelEn: 'Elliott 8 Waves (1-5 + ABC)', iconType: 'elliott5' },
        { id: 'anyWaves', label: 'Ondas Livres (Multi-Pivot)', labelEn: 'Free Waves (Multi-Pivot)', iconType: 'elliott3' },
    ],
    position: [
        { id: 'tvLongPosition', label: 'Long Position (Compra R:R)', labelEn: 'Long Position (R:R)', section: 'PROJECTION R:R', sectionEn: 'R:R PROJECTION', shortcut: '⌥ L', iconType: 'long_pos' },
        { id: 'tvShortPosition', label: 'Short Position (Venda R:R)', labelEn: 'Short Position (R:R)', shortcut: '⌥ S', iconType: 'short_pos' },
    ],
    shapes: [
        { id: 'rect', label: 'Rectangle (Zona / Order Block)', labelEn: 'Rectangle (Zone / Order Block)', section: 'SHAPES & ZONES', sectionEn: 'SHAPES & ZONES', iconType: 'rect' },
        { id: 'circle', label: 'Circle (Círculo de Liquidez)', labelEn: 'Circle (Liquidity Zone)', iconType: 'circle' },
        { id: 'parallelogram', label: 'Parallelogram (Canal Inclinado)', labelEn: 'Parallelogram (Sloped Channel)', iconType: 'parallelogram' },
        { id: 'triangle', label: 'Triangle (Triângulo)', labelEn: 'Triangle', iconType: 'triangle' },
    ],
    text: [
        { id: 'tvTextAnnotation', label: 'BOS (Break of Structure)', labelEn: 'BOS (Break of Structure)', section: 'SMC & TEXTO', sectionEn: 'SMC & TEXT', extendData: 'BOS', extendDataEn: 'BOS', iconType: 'text_badge' },
        { id: 'tvTextAnnotation', label: 'CHoCH (Change of Character)', labelEn: 'CHoCH (Change of Character)', extendData: 'CHoCH', extendDataEn: 'CHoCH', iconType: 'text_badge' },
        { id: 'tvTextAnnotation', label: 'FVG (Fair Value Gap)', labelEn: 'FVG (Fair Value Gap)', extendData: 'FVG', extendDataEn: 'FVG', iconType: 'text_badge' },
        { id: 'tvTextAnnotation', label: 'Order Block (OB Institucional)', labelEn: 'Order Block (Institutional OB)', extendData: 'OB', extendDataEn: 'OB', iconType: 'text_badge' },
        { id: 'tvTextAnnotation', label: 'Liquidez ($$$ Sweep)', labelEn: 'Liquidity ($$$ Sweep)', extendData: '$$$ Liquidez', extendDataEn: '$$$ Liquidity', iconType: 'text_badge' },
        { id: 'tvPriceCallout', label: 'Callout c/ Preço (Caixa + Seta)', labelEn: 'Price Callout (Box + Arrow)', section: 'CALLOUTS', sectionEn: 'CALLOUTS', extendData: 'Zona Chave', extendDataEn: 'Key Zone', iconType: 'callout' },
    ],
    emoji: [
        { id: 'tvEmojiMarker', label: '🎯 Alvo / Entrada Sniper', labelEn: '🎯 Target / Sniper Entry', section: 'MARCADORES', sectionEn: 'MARKERS', extendData: '🎯', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '🚀 Rompimento / Impulso Forte', labelEn: '🚀 Breakout / Strong Impulse', extendData: '🚀', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '🔥 Zona Quente / Alta Volatilidade', labelEn: '🔥 Hot Zone / High Volatility', extendData: '🔥', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '💎 Setup A+ Institucional', labelEn: '💎 Institutional A+ Setup', extendData: '💎', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '💰 Liquidez / Take Profit', labelEn: '💰 Liquidity / Take Profit', extendData: '💰', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '⚠️ Atenção / Notícia / Trap', labelEn: '⚠️ Warning / News / Trap', extendData: '⚠️', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '✅ Trade Vencedor / Confirmado', labelEn: '✅ Winning Trade / Confirmed', extendData: '✅', iconType: 'emoji' },
        { id: 'tvEmojiMarker', label: '❌ Stop / Invalidação', labelEn: '❌ Stop / Invalidation', extendData: '❌', iconType: 'emoji' },
    ],
    ruler: [
        { id: 'tvMeasureRuler', label: 'Measure Ruler (Preço, % e Velas)', labelEn: 'Measure Ruler (Price, % & Bars)', section: 'MEDIÇÃO', sectionEn: 'MEASURE', shortcut: '⇧ M', iconType: 'ruler' },
        { id: 'priceLine', label: 'Price Line (Linha de Preço Exato)', labelEn: 'Price Line (Exact Price Level)', iconType: 'priceline' },
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
    onActivateCutCandle?: () => void;
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
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [activeToolGroup, setActiveToolGroup] = useState<string | null>(null);
    const [activeCategoryKey, setActiveCategoryKey] = useState<string | null>(null);
    const [favorites, setFavorites] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem('torex_fav_drawing_tools_v1');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (_) {}
        return ['straightLine', 'horizontalStraightLine', 'fibonacciLine', 'tvLongPosition', 'rect'];
    });
    const [showFavBar, setShowFavBar] = useState<boolean>(false);
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
        setFavorites(prev => {
            const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
            try {
                localStorage.setItem('torex_fav_drawing_tools_v1', JSON.stringify(next));
            } catch (_) {}
            return next;
        });
    };

    const favoriteToolItems: DrawingToolOption[] = [];
    const seenFavKeys = new Set<string>();
    Object.values(TOOL_GROUPS).forEach(group => {
        group.forEach(opt => {
            const favKey = `${opt.id}:${opt.label}`;
            if ((favorites.includes(favKey) || favorites.includes(opt.id)) && !seenFavKeys.has(favKey)) {
                seenFavKeys.add(favKey);
                favoriteToolItems.push(opt);
            }
        });
    });

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
        onSelectDrawingTool(
            option1.id,
            isEn ? (option1.extendDataEn || option1.extendData) : option1.extendData,
            isEn ? (option1.labelEn || option1.label) : option1.label,
            true
        );
        setActiveToolGroup(prev => (prev === groupKey ? null : groupKey));
    };

    const handleOptionClick = (groupKey: string, opt: DrawingToolOption) => {
        setActiveCategoryKey(groupKey);
        onSelectDrawingTool(
            opt.id,
            isEn ? (opt.extendDataEn || opt.extendData) : opt.extendData,
            isEn ? (opt.labelEn || opt.label) : opt.label,
            true
        );
        setActiveToolGroup(null);
    };

    const categories: { key: string; icon: React.ReactNode; title: string }[] = [
        { key: 'lines', icon: <TrendingUp size={16} />, title: isEn ? 'Lines & Channels (Option 1: Trendline)' : 'Linhas & Canais (Opção 1: Trendline)' },
        { key: 'fib', icon: <Percent size={16} />, title: isEn ? 'Fibonacci & Gann (Option 1: Fib Retracement)' : 'Fibonacci & Gann (Opção 1: Fib Retracement)' },
        { key: 'patterns', icon: <Activity size={16} />, title: isEn ? 'Harmonic Patterns & Elliott Waves' : 'Padrões Harmônicos & Ondas de Elliott' },
        { key: 'position', icon: <Target size={16} />, title: isEn ? 'Risk/Reward Projection (Option 1: Long Position)' : 'Projeção Risco/Retorno (Opção 1: Long Position)' },
        { key: 'shapes', icon: <Brush size={16} />, title: isEn ? 'Shapes & SMC Zones (Option 1: OB Rectangle)' : 'Formas & Zonas SMC (Opção 1: Retângulo OB)' },
        { key: 'text', icon: <Type size={16} />, title: isEn ? 'Text, BOS, CHoCH, FVG & Callouts' : 'Texto, BOS, CHoCH, FVG & Callouts' },
        { key: 'emoji', icon: <Smile size={16} />, title: isEn ? 'Chart Emojis & Stickers (Option 1: 🎯)' : 'Emojis & Stickers no Gráfico (Opção 1: 🎯)' },
        { key: 'ruler', icon: <Ruler size={16} />, title: isEn ? 'Measure Ruler Price / % / Bars' : 'Régua de Medição Preço / % / Velas' },
    ];

    return (
        <div
            ref={sidebarRef}
            className="w-10 border-r flex flex-col items-center py-2 gap-1 z-40 relative bg-surface border-line shrink-0"
        >
            {/* Cursor / Crosshair Reset */}
            <button
                onClick={() => {
                    setActiveToolGroup(null);
                    setActiveCategoryKey(null);
                    onCancelPendingTool?.();
                }}
                title={isEn ? 'Crosshair Cursor' : 'Cursor Cruz (Crosshair)'}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    !activeCategoryKey && !cutCandleMode && !zoomAreaMode
                        ? 'bg-accent/15 text-accent'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                }`}
            >
                <Crosshair size={16} />
            </button>

            {categories.map(({ key, icon, title }) => {
                const isOpen = activeToolGroup === key;
                const isActive = activeCategoryKey === key && !zoomAreaMode;
                return (
                    <button
                        key={key}
                        onClick={() => handleCategoryClick(key)}
                        title={title}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer relative group ${
                            isOpen || isActive
                                ? 'bg-accent/15 text-accent font-semibold'
                                : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                        }`}
                    >
                        {icon}
                        <span className="w-1 h-1 rounded-full bg-current opacity-50 absolute bottom-0.5 right-0.5" />
                    </button>
                );
            })}

            <div className="w-5 h-px my-1 bg-line" />

            {/* Zoom In Area Selection */}
            <button
                onClick={() => {
                    setActiveToolGroup(null);
                    setActiveCategoryKey(null);
                    onZoomIn();
                }}
                title={isEn ? 'Select Zoom Area (Drag on Chart)' : 'Selecionar Área para Aumentar Zoom (Arraste no Gráfico)'}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    zoomAreaMode
                        ? 'bg-accent text-accent-on shadow-xs'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                }`}
            >
                <ZoomIn size={16} />
            </button>

            {/* Magnet Mode */}
            <button
                onClick={onToggleMagnet}
                title={isEn ? 'Magnet Mode (OHLC Snap)' : 'Modo Ímã (Snap OHLC)'}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    magnetMode
                        ? 'bg-accent text-accent-on shadow-xs'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                }`}
            >
                <Magnet size={16} />
            </button>

            {/* Lock Drawings */}
            <button
                onClick={onToggleLock}
                title={isEn ? 'Lock / Unlock Drawings' : 'Bloquear / Desbloquear Desenhos'}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    drawingsLocked
                        ? 'bg-warn/15 text-warn'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                }`}
            >
                <Lock size={16} />
            </button>

            {/* Show/Hide Drawings */}
            <button
                onClick={onToggleVisible}
                title={isEn ? 'Show / Hide Drawings' : 'Mostrar / Ocultar Desenhos'}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    !drawingsVisible
                        ? 'bg-neg/15 text-neg'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                }`}
            >
                {drawingsVisible ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>

            {/* Favorites Floating Bar Toggle */}
            <button
                type="button"
                onClick={() => setShowFavBar(v => !v)}
                title={isEn ? 'Quick Favorites Toolbar (★)' : 'Barra Rápida de Ferramentas Favoritas (★)'}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    showFavBar
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'text-fg-muted hover:text-amber-400 hover:bg-surface-2'
                }`}
            >
                <Star size={15} fill={showFavBar ? 'currentColor' : 'none'} />
            </button>

            {/* Trash Clear All */}
            <button
                onClick={onClearDrawings}
                title={isEn ? 'Delete All Drawings' : 'Apagar Todos os Desenhos'}
                className="p-1.5 rounded-lg transition-colors cursor-pointer mt-auto text-fg-muted hover:text-neg hover:bg-neg/10"
            >
                <Trash2 size={16} />
            </button>

            {/* Floating Quick Favorites Pill inside Workspace */}
            {showFavBar && favoriteToolItems.length > 0 && (
                <div className="absolute left-12 bottom-3 z-40 flex items-center gap-1 px-2 py-1 rounded-xl border border-line bg-surface/95 backdrop-blur-md shadow-xl">
                    <Star size={12} className="text-amber-400 shrink-0 mr-0.5" fill="currentColor" />
                    {favoriteToolItems.slice(0, 8).map((opt, idx) => (
                        <button
                            key={`fav_${opt.id}_${idx}`}
                            type="button"
                            onClick={() =>
                                onSelectDrawingTool(
                                    opt.id,
                                    isEn ? (opt.extendDataEn || opt.extendData) : opt.extendData,
                                    isEn ? (opt.labelEn || opt.label) : opt.label,
                                    true
                                )
                            }
                            title={isEn ? (opt.labelEn || opt.label) : opt.label}
                            className="p-1.5 rounded-lg text-fg-muted hover:text-accent hover:bg-surface-2 transition-colors cursor-pointer"
                        >
                            <ToolSvgIcon type={opt.iconType} emoji={opt.extendData} />
                        </button>
                    ))}
                </div>
            )}

            {/* Flyout Submenu (Traynio / TradingView Style) */}
            {activeToolGroup && TOOL_GROUPS[activeToolGroup] && (
                <div className="absolute left-10 ml-1 top-2 w-64 rounded-xl border shadow-2xl py-1.5 z-[100] bg-surface border-line text-fg max-h-[82vh] overflow-y-auto">
                    {/* Active Option 1 Banner */}
                    <div className="px-3 py-1 mb-1 flex items-center justify-between bg-accent/10 border-b border-line text-[10px] font-semibold text-accent">
                        <span>{isEn ? '✓ Option 1 active (click chart)' : '✓ Opção 1 ativa (clique no gráfico)'}</span>
                        <span className="opacity-75">{isEn ? 'or choose below' : 'ou escolha abaixo'}</span>
                    </div>

                    {/* Custom Text Input when 'text' group is open */}
                    {activeToolGroup === 'text' && (
                        <div className="px-3 py-2 border-b border-line space-y-1.5">
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                                {isEn ? 'Custom Chart Text' : 'Texto Personalizado no Gráfico'}
                            </label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="text"
                                    value={customText}
                                    onChange={e => setCustomText(e.target.value)}
                                    placeholder={isEn ? 'Type your note...' : 'Digite sua nota...'}
                                    className="flex-1 px-2 py-1 rounded border border-line bg-surface-2 text-xs text-fg focus:outline-none focus:border-accent"
                                />
                                <button
                                    onClick={() => {
                                        const txt = customText.trim() || (isEn ? 'Note' : 'Nota');
                                        onSelectDrawingTool('tvTextAnnotation', txt, `${isEn ? 'Text' : 'Texto'}: ${txt}`, true);
                                        setActiveToolGroup(null);
                                    }}
                                    className="px-2.5 py-1 rounded bg-accent text-accent-on text-xs font-bold cursor-pointer hover:opacity-95"
                                >
                                    {isEn ? 'Apply' : 'Usar'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Quick Emoji Palette Grid when 'emoji' group is open */}
                    {activeToolGroup === 'emoji' && (
                        <div className="px-3 py-2 border-b border-line">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1.5">
                                {isEn ? 'Quick Emoji Picker' : 'Escolha Rápida de Emoji'}
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
                                        title={isEn ? `Insert ${em}` : `Inserir ${em}`}
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
                        const displaySection = isEn ? (opt.sectionEn || opt.section) : opt.section;
                        const displayLabel = isEn ? (opt.labelEn || opt.label) : opt.label;

                        return (
                            <React.Fragment key={`${opt.id}_${opt.label}_${idx}`}>
                                {displaySection && (
                                    <div
                                        className={`px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-fg-muted ${
                                            idx > 0 ? 'border-t border-line mt-1' : ''
                                        }`}
                                    >
                                        {displaySection}
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
                                        <span className="truncate">{displayLabel}</span>
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
                                            title={isEn ? 'Favorite tool' : 'Favoritar ferramenta'}
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
