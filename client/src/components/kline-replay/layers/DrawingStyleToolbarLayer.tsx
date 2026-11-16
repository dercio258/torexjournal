import React, { memo, useState, useRef, useEffect } from 'react';
import {
    GripVertical,
    LayoutGrid,
    Pencil,
    Type,
    PaintBucket,
    Settings,
    Lock,
    Unlock,
    Trash2,
    MoreHorizontal,
    Copy,
    Eye,
    EyeOff,
    Crosshair,
    RotateCcw,
    X,
    Plus,
    Sliders,
    MapPin,
    Send,
} from 'lucide-react';
import { DrawnObjectItem } from './RightSidePanelLayer';
import { useLocale } from '../../../context/LocaleContext';

export type DrawingLineStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawingStyleState {
    lineColor: string;
    lineOpacity: number; // 0..100
    lineSize: number; // 1..6
    lineStyle: DrawingLineStyle;
    fillColor: string;
    fillOpacity: number; // 0..100
    textColor: string;
    textSize: number; // 10..36
    extendData: string;
}

export interface OverlayPointCoord {
    dataIndex?: number;
    timestamp?: number;
    value?: number;
}

interface DrawingStyleToolbarLayerProps {
    selectedItem: DrawnObjectItem | null;
    styleState: DrawingStyleState;
    points: OverlayPointCoord[];
    decimals: number;
    onUpdateStyle: (patch: Partial<DrawingStyleState>) => void;
    onUpdateLabel: (id: string, newLabel: string) => void;
    onUpdatePoint: (pointIndex: number, patch: Partial<OverlayPointCoord>) => void;
    onToggleLock: (id: string) => void;
    onToggleVisible: (id: string) => void;
    onDuplicate: (id: string) => void;
    onCenterOnChart: (id: string) => void;
    onDelete: (id: string) => void;
    onResetStyle: (id: string) => void;
    onSendPositionToOrderTicket?: (side: 'BUY' | 'SELL', entry: number, tp: number, sl: number) => void;
}

/** 8x10 TradingView / Traynio Color Palette Grid (exact match to screenshot) */
const COLOR_PALETTE_ROWS: string[][] = [
    // Row 1: Grayscale white -> black
    ['#ffffff', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a', '#000000'],
    // Row 2: Vivid core hues
    ['#ef4444', '#f97316', '#eab308', '#10b981', '#06b6d4', '#0ea5e9', '#2962ff', '#8b5cf6', '#d946ef', '#ec4899'],
    // Row 3: Soft pastel tints
    ['#fecaca', '#fed7aa', '#fef08a', '#a7f3d0', '#a5f3fc', '#bae6fd', '#bfdbfe', '#ddd6fe', '#f5d0fe', '#fbcfe8'],
    // Row 4: Light tones
    ['#fca5a5', '#fdba74', '#fde047', '#6ee7b7', '#67e8f9', '#7dd3fc', '#93c5fd', '#c4b5fd', '#f0abfc', '#f9a8d4'],
    // Row 5: Medium-light tones
    ['#f87171', '#fb923c', '#facc15', '#34d399', '#22d3ee', '#38bdf8', '#60a5fa', '#a78bfa', '#e879f9', '#f472b6'],
    // Row 6: Medium-deep tones
    ['#dc2626', '#ea580c', '#ca8a04', '#059669', '#0891b2', '#0284c7', '#2563eb', '#7c3aed', '#c026d3', '#db2777'],
    // Row 7: Deep institutional tones
    ['#b91c1c', '#c2410c', '#a16207', '#047857', '#0e7490', '#0369a1', '#1d4ed8', '#6d28d9', '#a21caf', '#be185d'],
    // Row 8: Darkest rich tones
    ['#7f1d1d', '#7c2d12', '#713f12', '#064e3b', '#164e63', '#0c4a6e', '#1e3a8a', '#4c1d95', '#701a75', '#831843'],
];

const STYLE_TEMPLATES: Array<{ name: string; nameEn: string; badge: string; patch: Partial<DrawingStyleState> }> = [
    {
        name: 'Azul Institucional (Padrão)',
        nameEn: 'Institutional Blue (Default)',
        badge: '#2962ff',
        patch: { lineColor: '#2962ff', lineOpacity: 100, lineSize: 2, lineStyle: 'solid', fillColor: '#2962ff', fillOpacity: 16 },
    },
    {
        name: 'Liquidez / Ouro Institucional',
        nameEn: 'Liquidity / Institutional Gold',
        badge: '#eab308',
        patch: { lineColor: '#eab308', lineOpacity: 100, lineSize: 2, lineStyle: 'dashed', fillColor: '#eab308', fillOpacity: 18 },
    },
    {
        name: 'Demanda / Suporte Esmeralda',
        nameEn: 'Demand / Emerald Support',
        badge: '#10b981',
        patch: { lineColor: '#10b981', lineOpacity: 100, lineSize: 2, lineStyle: 'solid', fillColor: '#10b981', fillOpacity: 20 },
    },
    {
        name: 'Oferta / Resistência Rubi',
        nameEn: 'Supply / Ruby Resistance',
        badge: '#ef4444',
        patch: { lineColor: '#ef4444', lineOpacity: 100, lineSize: 2, lineStyle: 'solid', fillColor: '#ef4444', fillOpacity: 20 },
    },
    {
        name: 'FVG / Imbalance Violeta',
        nameEn: 'FVG / Violet Imbalance',
        badge: '#8b5cf6',
        patch: { lineColor: '#8b5cf6', lineOpacity: 95, lineSize: 1, lineStyle: 'dotted', fillColor: '#8b5cf6', fillOpacity: 22 },
    },
    {
        name: 'Nível Discreto / Cinza',
        nameEn: 'Subtle Level / Slate',
        badge: '#64748b',
        patch: { lineColor: '#64748b', lineOpacity: 85, lineSize: 1, lineStyle: 'dashed', fillColor: '#64748b', fillOpacity: 12 },
    },
];

const QUICK_SMC_TAGS = ['BOS', 'CHoCH', 'FVG', 'OB', '$$$ Liquidez', 'EQH', 'EQL', 'Zona Chave', 'Alvo TP'];
const QUICK_SMC_TAGS_EN = ['BOS', 'CHoCH', 'FVG', 'OB', '$$$ Liquidity', 'EQH', 'EQL', 'Key Zone', 'TP Target'];
const QUICK_EMOJIS = ['🎯', '🚀', '🔥', '💎', '💰', '🐋', '⚡', '👀', '✅', '❌', '⚠️', '🛑'];
const LINE_SIZES = [1, 2, 3, 4, 5, 6];
const FONT_SIZES = [10, 11, 12, 14, 16, 20, 24, 28, 36];

/** Reusable 8x10 Color Grid + Opacity Slider matching the screenshot */
const ColorPalettePopover: React.FC<{
    color: string;
    opacity: number;
    onChangeColor: (hex: string) => void;
    onChangeOpacity: (opacity: number) => void;
    title?: string;
    isEn?: boolean;
}> = ({ color, opacity, onChangeColor, onChangeOpacity, title, isEn = false }) => {
    const colorInputRef = useRef<HTMLInputElement | null>(null);

    return (
        <div className="w-[248px] p-3 rounded-xl border border-line bg-surface shadow-2xl text-fg select-none">
            {title && (
                <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-2">
                    {title}
                </div>
            )}

            {/* 8x10 Color Swatch Matrix */}
            <div className="space-y-1">
                {COLOR_PALETTE_ROWS.map((row, rIdx) => (
                    <div key={rIdx} className="grid grid-cols-10 gap-1">
                        {row.map((hex) => {
                            const isSelected = color.toLowerCase() === hex.toLowerCase();
                            return (
                                <button
                                    key={hex}
                                    type="button"
                                    onClick={() => onChangeColor(hex)}
                                    className={`w-[19px] h-[19px] rounded-[4px] cursor-pointer transition-transform hover:scale-110 border ${
                                        isSelected
                                            ? 'ring-2 ring-[#2962ff] ring-offset-1 ring-offset-surface border-white'
                                            : 'border-black/15 dark:border-white/10'
                                    }`}
                                    style={{ backgroundColor: hex }}
                                    title={hex}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>

            <div className="my-2.5 border-t border-line" />

            {/* Custom Color (+) Button */}
            <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => colorInputRef.current?.click()}
                        className="w-7 h-7 rounded-md border border-line hover:bg-surface-2 flex items-center justify-center cursor-pointer text-fg-muted hover:text-fg"
                        title={isEn ? 'Choose custom color' : 'Escolher cor personalizada'}
                    >
                        <Plus size={14} />
                    </button>
                    <input
                        ref={colorInputRef}
                        type="color"
                        value={color.startsWith('#') && color.length === 7 ? color : '#2962ff'}
                        onChange={(e) => onChangeColor(e.target.value)}
                        className="sr-only"
                    />
                    <span className="text-[11px] font-mono text-fg-muted uppercase">{color}</span>
                </div>
                <div
                    className="w-6 h-6 rounded-md border border-line shadow-inner"
                    style={{ backgroundColor: color, opacity: opacity / 100 }}
                />
            </div>

            {/* Opacity Slider (Matches screenshot: checkered track + percentage box) */}
            <div>
                <div className="text-[11px] text-fg-muted mb-1.5 font-medium">Opacity</div>
                <div className="flex items-center gap-2">
                    <div className="relative flex-1 h-4 flex items-center">
                        <div
                            className="w-full h-2.5 rounded-full overflow-hidden border border-line"
                            style={{
                                backgroundImage:
                                    'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)',
                                backgroundSize: '8px 8px',
                                backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                            }}
                        >
                            <div
                                className="w-full h-full"
                                style={{
                                    background: `linear-gradient(to right, transparent 0%, ${color} 100%)`,
                                }}
                            />
                        </div>
                        <input
                            type="range"
                            min={5}
                            max={100}
                            value={opacity}
                            onChange={(e) => onChangeOpacity(Number(e.target.value))}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div
                            className="pointer-events-none absolute w-3.5 h-3.5 rounded-full bg-white border-2 border-[#2962ff] shadow-md -translate-x-1/2"
                            style={{ left: `${Math.max(4, Math.min(96, opacity))}%` }}
                        />
                    </div>
                    <div className="px-2 py-0.5 rounded-md border border-line bg-surface-2 text-[11px] font-bold min-w-[46px] text-center">
                        {opacity}%
                    </div>
                </div>
            </div>
        </div>
    );
};

export const DrawingStyleToolbarLayer: React.FC<DrawingStyleToolbarLayerProps> = memo(({
    selectedItem,
    styleState,
    points,
    decimals,
    onUpdateStyle,
    onUpdateLabel,
    onUpdatePoint,
    onToggleLock,
    onToggleVisible,
    onDuplicate,
    onCenterOnChart,
    onDelete,
    onResetStyle,
    onSendPositionToOrderTicket,
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [openPopover, setOpenPopover] = useState<'none' | 'templates' | 'lineColor' | 'fillColor' | 'text' | 'size' | 'style' | 'more'>('none');
    const [settingsModalOpen, setSettingsModalOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState<'style' | 'coords' | 'visibility'>('style');
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    const draggingRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
    const toolbarRef = useRef<HTMLDivElement | null>(null);

    // Close popovers when selection changes
    useEffect(() => {
        setOpenPopover('none');
    }, [selectedItem?.id]);

    // Close popovers when clicking outside toolbar
    useEffect(() => {
        if (openPopover === 'none') return;
        const onMouseDown = (e: MouseEvent) => {
            if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
                setOpenPopover('none');
            }
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [openPopover]);

    // Dragging logic for the floating toolbar
    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!draggingRef.current) return;
            const dx = e.clientX - draggingRef.current.startX;
            const dy = e.clientY - draggingRef.current.startY;
            setPos({
                x: Math.max(8, draggingRef.current.origX + dx),
                y: Math.max(8, draggingRef.current.origY + dy),
            });
        };
        const onMouseUp = () => {
            draggingRef.current = null;
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    if (!selectedItem) return null;

    const isLocked = Boolean(selectedItem.locked);
    const isVisible = selectedItem.visible !== false;
    const isPositionTool = selectedItem.name === 'tvLongPosition' || selectedItem.name === 'tvShortPosition';
    const isEmojiTool = selectedItem.name === 'tvEmojiMarker';

    return (
        <>
            {/* FLOATING DRAGGABLE DRAWING STYLE TOOLBAR (Matches Screenshot) */}
            <div
                ref={toolbarRef}
                style={
                    pos
                        ? { left: pos.x, top: pos.y }
                        : { right: 64, top: 44 }
                }
                className="absolute z-40 flex items-center gap-0.5 px-1.5 py-1 rounded-xl border border-line bg-surface/95 backdrop-blur-md shadow-xl text-fg select-none"
            >
                {/* 1. Drag Handle (6 dots) */}
                <div
                    onMouseDown={(e) => {
                        const rect = toolbarRef.current?.getBoundingClientRect();
                        const parentRect = toolbarRef.current?.parentElement?.getBoundingClientRect();
                        const currentX = pos ? pos.x : (rect && parentRect ? rect.left - parentRect.left : 320);
                        const currentY = pos ? pos.y : (rect && parentRect ? rect.top - parentRect.top : 44);
                        draggingRef.current = {
                            startX: e.clientX,
                            startY: e.clientY,
                            origX: currentX,
                            origY: currentY,
                        };
                    }}
                    className="px-1 py-1.5 cursor-grab active:cursor-grabbing text-fg-muted hover:text-fg"
                    title={isEn ? 'Drag style toolbar' : 'Arrastar barra de estilo'}
                >
                    <GripVertical size={14} />
                </div>

                {/* 2. Quick Templates (4-squares icon) */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setOpenPopover(p => (p === 'templates' ? 'none' : 'templates'))}
                        className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                            openPopover === 'templates' ? 'bg-accent/15 text-accent-fg' : 'hover:bg-surface-2 text-fg-muted hover:text-fg'
                        }`}
                        title={isEn ? 'Quick Style Templates' : 'Templates de Estilo Rápido'}
                    >
                        <LayoutGrid size={15} />
                    </button>
                    {openPopover === 'templates' && (
                        <div className="absolute top-full left-0 mt-2 w-60 p-1.5 rounded-xl border border-line bg-surface shadow-2xl z-50">
                            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                                {isEn ? 'Style Templates' : 'Templates de Estilo'}
                            </div>
                            {STYLE_TEMPLATES.map((tpl) => (
                                <button
                                    key={tpl.name}
                                    type="button"
                                    onClick={() => {
                                        onUpdateStyle(tpl.patch);
                                        setOpenPopover('none');
                                    }}
                                    className="w-full px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2.5 hover:bg-surface-2 cursor-pointer text-left"
                                >
                                    <span className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: tpl.badge }} />
                                    <span className="truncate font-medium">{isEn ? tpl.nameEn : tpl.name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* 3. Line / Border Color Picker (Pencil icon + active color bar) */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setOpenPopover(p => (p === 'lineColor' ? 'none' : 'lineColor'))}
                        className={`px-2 py-1 rounded-lg cursor-pointer flex flex-col items-center justify-center transition-colors ${
                            openPopover === 'lineColor' ? 'bg-surface-2' : 'hover:bg-surface-2'
                        }`}
                        title={isEn ? 'Line / Border Color & Opacity' : 'Cor da Linha / Borda e Opacidade'}
                    >
                        <Pencil size={14} className="text-fg" />
                        <span
                            className="w-4 h-[3px] rounded-full mt-0.5"
                            style={{ backgroundColor: styleState.lineColor }}
                        />
                    </button>
                    {openPopover === 'lineColor' && (
                        <div className="absolute top-full left-0 mt-2 z-50">
                            <ColorPalettePopover
                                title={isEn ? 'Line Color & Opacity' : 'Cor da Linha & Opacidade'}
                                color={styleState.lineColor}
                                opacity={styleState.lineOpacity}
                                onChangeColor={(hex) => onUpdateStyle({ lineColor: hex })}
                                onChangeOpacity={(op) => onUpdateStyle({ lineOpacity: op })}
                                isEn={isEn}
                            />
                        </div>
                    )}
                </div>

                {/* 4. Fill / Background Color Picker (PaintBucket icon + active color bar) */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setOpenPopover(p => (p === 'fillColor' ? 'none' : 'fillColor'))}
                        className={`px-2 py-1 rounded-lg cursor-pointer flex flex-col items-center justify-center transition-colors ${
                            openPopover === 'fillColor' ? 'bg-surface-2' : 'hover:bg-surface-2'
                        }`}
                        title={isEn ? 'Fill / Background Color & Opacity' : 'Cor de Preenchimento / Fundo e Opacidade'}
                    >
                        <PaintBucket size={14} className="text-fg" />
                        <span
                            className="w-4 h-[3px] rounded-full mt-0.5"
                            style={{ backgroundColor: styleState.fillColor }}
                        />
                    </button>
                    {openPopover === 'fillColor' && (
                        <div className="absolute top-full left-0 mt-2 z-50">
                            <ColorPalettePopover
                                title={isEn ? 'Fill Color & Opacity' : 'Cor de Preenchimento & Opacidade'}
                                color={styleState.fillColor}
                                opacity={styleState.fillOpacity}
                                onChangeColor={(hex) => onUpdateStyle({ fillColor: hex })}
                                onChangeOpacity={(op) => onUpdateStyle({ fillOpacity: op })}
                                isEn={isEn}
                            />
                        </div>
                    )}
                </div>

                {/* 5. Text / Font Size / Emoji Picker (T icon + color bar) */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setOpenPopover(p => (p === 'text' ? 'none' : 'text'))}
                        className={`px-2 py-1 rounded-lg cursor-pointer flex flex-col items-center justify-center transition-colors ${
                            openPopover === 'text' ? 'bg-surface-2' : 'hover:bg-surface-2'
                        }`}
                        title={isEn ? 'Text, Font Size & Text Color' : 'Texto, Tamanho da Fonte e Cor do Texto'}
                    >
                        <Type size={14} className="text-fg" />
                        <span
                            className="w-4 h-[3px] rounded-full mt-0.5"
                            style={{ backgroundColor: styleState.textColor }}
                        />
                    </button>
                    {openPopover === 'text' && (
                        <div className="absolute top-full left-0 mt-2 w-[264px] p-3 rounded-xl border border-line bg-surface shadow-2xl z-50 space-y-3">
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                                    {isEmojiTool ? (isEn ? 'Emoji / Marker' : 'Emoji / Marcador') : (isEn ? 'Chart Text / Label' : 'Texto / Rótulo no Gráfico')}
                                </label>
                                <input
                                    type="text"
                                    value={styleState.extendData}
                                    onChange={(e) => onUpdateStyle({ extendData: e.target.value })}
                                    placeholder={isEmojiTool ? '🎯' : (isEn ? 'Enter text (e.g. BOS, OB H4...)' : 'Digite o texto (ex: BOS, OB H4...)')}
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-line bg-surface-2 text-xs text-fg focus:outline-none focus:border-[#2962ff]"
                                />
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                    {(isEmojiTool ? QUICK_EMOJIS : (isEn ? QUICK_SMC_TAGS_EN : QUICK_SMC_TAGS)).map((tag) => (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => onUpdateStyle({ extendData: tag })}
                                            className="px-1.5 py-0.5 rounded bg-surface-2 hover:bg-accent/15 hover:text-accent-fg text-[10px] font-semibold border border-line cursor-pointer"
                                        >
                                            {tag}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                                    {isEn ? `Size (${styleState.textSize}px)` : `Tamanho (${styleState.textSize}px)`}
                                </label>
                                <div className="flex flex-wrap gap-1">
                                    {FONT_SIZES.map((sz) => (
                                        <button
                                            key={sz}
                                            type="button"
                                            onClick={() => onUpdateStyle({ textSize: sz })}
                                            className={`px-2 py-1 rounded text-[11px] font-bold cursor-pointer border ${
                                                styleState.textSize === sz
                                                    ? 'bg-[#2962ff] text-white border-[#2962ff]'
                                                    : 'bg-surface-2 border-line hover:bg-surface'
                                            }`}
                                        >
                                            {sz}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-1">
                                    {isEn ? 'Text Color' : 'Cor do Texto'}
                                </div>
                                <div className="grid grid-cols-10 gap-1">
                                    {COLOR_PALETTE_ROWS[0].concat(COLOR_PALETTE_ROWS[1]).map((hex) => (
                                        <button
                                            key={hex}
                                            type="button"
                                            onClick={() => onUpdateStyle({ textColor: hex })}
                                            className={`w-4 h-4 rounded-xs cursor-pointer border ${
                                                styleState.textColor.toLowerCase() === hex.toLowerCase()
                                                    ? 'ring-2 ring-[#2962ff]'
                                                    : 'border-black/15'
                                            }`}
                                            style={{ backgroundColor: hex }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="h-4 w-px bg-line mx-0.5" />

                {/* 6. Line Thickness (— 2px) */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setOpenPopover(p => (p === 'size' ? 'none' : 'size'))}
                        className={`px-2 py-1.5 rounded-lg cursor-pointer flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                            openPopover === 'size' ? 'bg-surface-2 text-[#2962ff]' : 'hover:bg-surface-2 text-fg'
                        }`}
                        title={isEn ? 'Line Thickness' : 'Espessura da Linha'}
                    >
                        <span
                            className="w-4 rounded-full bg-current inline-block"
                            style={{ height: `${Math.min(5, Math.max(1, styleState.lineSize))}px` }}
                        />
                        <span>{styleState.lineSize}px</span>
                    </button>
                    {openPopover === 'size' && (
                        <div className="absolute top-full left-0 mt-2 w-36 p-1.5 rounded-xl border border-line bg-surface shadow-2xl z-50 space-y-0.5">
                            {LINE_SIZES.map((sz) => (
                                <button
                                    key={sz}
                                    type="button"
                                    onClick={() => {
                                        onUpdateStyle({ lineSize: sz });
                                        setOpenPopover('none');
                                    }}
                                    className={`w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs cursor-pointer ${
                                        styleState.lineSize === sz
                                            ? 'bg-[#2962ff]/12 text-[#2962ff] font-bold'
                                            : 'hover:bg-surface-2 text-fg'
                                    }`}
                                >
                                    <span className="w-16 bg-current rounded-full" style={{ height: `${sz}px` }} />
                                    <span>{sz}px</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* 7. Line Style (Solid / Dashed / Dotted) */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setOpenPopover(p => (p === 'style' ? 'none' : 'style'))}
                        className={`px-2 py-1.5 rounded-lg cursor-pointer flex items-center justify-center transition-colors ${
                            openPopover === 'style' ? 'bg-surface-2 text-[#2962ff]' : 'hover:bg-surface-2 text-fg'
                        }`}
                        title={isEn ? 'Line Style (Solid, Dashed, Dotted)' : 'Estilo da Linha (Sólida, Tracejada, Pontilhada)'}
                    >
                        <svg viewBox="0 0 22 10" className="w-5 h-3 stroke-current fill-none" strokeWidth="2">
                            {styleState.lineStyle === 'solid' && <line x1="1" y1="5" x2="21" y2="5" />}
                            {styleState.lineStyle === 'dashed' && <line x1="1" y1="5" x2="21" y2="5" strokeDasharray="5 3" />}
                            {styleState.lineStyle === 'dotted' && <line x1="1" y1="5" x2="21" y2="5" strokeDasharray="2 2.5" />}
                        </svg>
                    </button>
                    {openPopover === 'style' && (
                        <div className="absolute top-full left-0 mt-2 w-40 p-1.5 rounded-xl border border-line bg-surface shadow-2xl z-50 space-y-0.5">
                            {([
                                { id: 'solid', label: isEn ? 'Solid Line' : 'Linha Sólida', dash: undefined },
                                { id: 'dashed', label: isEn ? 'Dashed' : 'Tracejada', dash: '5 3' },
                                { id: 'dotted', label: isEn ? 'Dotted' : 'Pontilhada', dash: '2 2.5' },
                            ] as const).map((st) => (
                                <button
                                    key={st.id}
                                    type="button"
                                    onClick={() => {
                                        onUpdateStyle({ lineStyle: st.id });
                                        setOpenPopover('none');
                                    }}
                                    className={`w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs cursor-pointer ${
                                        styleState.lineStyle === st.id
                                            ? 'bg-[#2962ff]/12 text-[#2962ff] font-bold'
                                            : 'hover:bg-surface-2 text-fg'
                                    }`}
                                >
                                    <svg viewBox="0 0 28 10" className="w-7 h-3 stroke-current fill-none" strokeWidth="2">
                                        <line x1="1" y1="5" x2="27" y2="5" strokeDasharray={st.dash} />
                                    </svg>
                                    <span>{st.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="h-4 w-px bg-line mx-0.5" />

                {/* 8. Settings Button (Opens Advanced Tool Configuration Modal) */}
                <button
                    type="button"
                    onClick={() => {
                        setOpenPopover('none');
                        setSettingsModalOpen(true);
                    }}
                    className="p-1.5 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg cursor-pointer transition-colors"
                    title={isEn ? 'Advanced Tool Settings (Style, Coordinates & Visibility)' : 'Configurações Avançadas da Ferramenta (Estilo, Coordenadas e Visibilidade)'}
                >
                    <Settings size={15} />
                </button>

                {/* 9. Lock / Unlock Button */}
                <button
                    type="button"
                    onClick={() => onToggleLock(selectedItem.id)}
                    className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                        isLocked
                            ? 'bg-amber-500/15 text-amber-500 font-bold'
                            : 'hover:bg-surface-2 text-fg-muted hover:text-fg'
                    }`}
                    title={isLocked ? (isEn ? 'Unlock Object' : 'Desbloquear Objeto') : (isEn ? 'Lock Object' : 'Bloquear Objeto')}
                >
                    {isLocked ? <Lock size={15} /> : <Unlock size={15} />}
                </button>

                {/* 10. Delete / Remove Button */}
                <button
                    type="button"
                    onClick={() => onDelete(selectedItem.id)}
                    className="p-1.5 rounded-lg hover:bg-neg/15 text-fg-muted hover:text-neg cursor-pointer transition-colors"
                    title={isEn ? 'Delete Object (Delete / Backspace)' : 'Remover Objeto (Delete / Backspace)'}
                >
                    <Trash2 size={15} />
                </button>

                {/* 11. More Actions (•••) */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setOpenPopover(p => (p === 'more' ? 'none' : 'more'))}
                        className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                            openPopover === 'more' ? 'bg-surface-2 text-fg' : 'hover:bg-surface-2 text-fg-muted hover:text-fg'
                        }`}
                        title={isEn ? 'More Actions' : 'Mais Ações'}
                    >
                        <MoreHorizontal size={15} />
                    </button>
                    {openPopover === 'more' && (
                        <div className="absolute top-full right-0 mt-2 w-48 p-1.5 rounded-xl border border-line bg-surface shadow-2xl z-50 space-y-0.5 text-xs">
                            <button
                                type="button"
                                onClick={() => {
                                    onDuplicate(selectedItem.id);
                                    setOpenPopover('none');
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 hover:bg-surface-2 cursor-pointer text-left"
                            >
                                <Copy size={13} />
                                <span>{isEn ? 'Duplicate / Clone' : 'Duplicar / Clonar'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    onCenterOnChart(selectedItem.id);
                                    setOpenPopover('none');
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 hover:bg-surface-2 cursor-pointer text-left"
                            >
                                <Crosshair size={13} />
                                <span>{isEn ? 'Center on Chart' : 'Centralizar no Gráfico'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    onToggleVisible(selectedItem.id);
                                    setOpenPopover('none');
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 hover:bg-surface-2 cursor-pointer text-left"
                            >
                                {isVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                                <span>{isVisible ? (isEn ? 'Hide on Chart' : 'Ocultar no Gráfico') : (isEn ? 'Show on Chart' : 'Mostrar no Gráfico')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    onResetStyle(selectedItem.id);
                                    setOpenPopover('none');
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 hover:bg-surface-2 cursor-pointer text-left text-fg-muted"
                            >
                                <RotateCcw size={13} />
                                <span>{isEn ? 'Reset to Default' : 'Restaurar Padrão'}</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ADVANCED TOOL SETTINGS MODAL (Firme e Completo) */}
            {settingsModalOpen && (
                <div className="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 select-none">
                    <div className="w-full max-w-[460px] rounded-2xl border border-line bg-surface text-fg shadow-2xl overflow-hidden flex flex-col">
                        {/* Modal Header */}
                        <div className="px-5 py-3.5 border-b border-line flex items-center justify-between bg-surface-2/50">
                            <div className="flex items-center gap-2.5">
                                <div
                                    className="w-3.5 h-3.5 rounded-full border border-white/20"
                                    style={{ backgroundColor: styleState.lineColor }}
                                />
                                <div>
                                    <h3 className="text-sm font-bold leading-tight">
                                        {isEn ? `Settings: ${selectedItem.label}` : `Configurações: ${selectedItem.label}`}
                                    </h3>
                                    <p className="text-[11px] text-fg-muted">
                                        {isEn ? 'Customize style, exact price coordinates, and visibility' : 'Personalize estilo, coordenadas exatas de preço e visibilidade'}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSettingsModalOpen(false)}
                                className="p-1.5 rounded-lg hover:bg-surface-2 text-fg-muted hover:text-fg cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Modal Navigation Tabs */}
                        <div className="flex border-b border-line bg-surface px-5 pt-2 gap-4 text-xs font-bold">
                            <button
                                type="button"
                                onClick={() => setSettingsTab('style')}
                                className={`pb-2.5 border-b-2 flex items-center gap-1.5 cursor-pointer transition-colors ${
                                    settingsTab === 'style'
                                        ? 'border-[#2962ff] text-[#2962ff]'
                                        : 'border-transparent text-fg-muted hover:text-fg'
                                }`}
                            >
                                <Sliders size={13} />
                                <span>{isEn ? 'Style & Text' : 'Estilo & Texto'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setSettingsTab('coords')}
                                className={`pb-2.5 border-b-2 flex items-center gap-1.5 cursor-pointer transition-colors ${
                                    settingsTab === 'coords'
                                        ? 'border-[#2962ff] text-[#2962ff]'
                                        : 'border-transparent text-fg-muted hover:text-fg'
                                }`}
                            >
                                <MapPin size={13} />
                                <span>{isEn ? `Coordinates (${points.length})` : `Coordenadas (${points.length})`}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setSettingsTab('visibility')}
                                className={`pb-2.5 border-b-2 flex items-center gap-1.5 cursor-pointer transition-colors ${
                                    settingsTab === 'visibility'
                                        ? 'border-[#2962ff] text-[#2962ff]'
                                        : 'border-transparent text-fg-muted hover:text-fg'
                                }`}
                            >
                                <Eye size={13} />
                                <span>{isEn ? 'Visibility' : 'Visibilidade'}</span>
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-5 max-h-[68vh] overflow-y-auto space-y-4 text-xs">
                            {settingsTab === 'style' && (
                                <>
                                    {/* Layer Custom Name & Content */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[11px] font-semibold text-fg-muted mb-1">
                                                {isEn ? 'Layer Name (Object Tree)' : 'Nome na Camada (Object Tree)'}
                                            </label>
                                            <input
                                                type="text"
                                                value={selectedItem.label}
                                                onChange={(e) => onUpdateLabel(selectedItem.id, e.target.value)}
                                                className="w-full px-3 py-1.5 rounded-lg border border-line bg-surface-2 text-fg focus:outline-none focus:border-[#2962ff]"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-semibold text-fg-muted mb-1">
                                                {isEn ? 'Chart Text / Tag' : 'Texto / Tag no Gráfico'}
                                            </label>
                                            <input
                                                type="text"
                                                value={styleState.extendData}
                                                onChange={(e) => onUpdateStyle({ extendData: e.target.value })}
                                                placeholder={isEn ? 'e.g. BOS, OB H4, Liquidity...' : 'Ex: BOS, OB H4, Liquidez...'}
                                                className="w-full px-3 py-1.5 rounded-lg border border-line bg-surface-2 text-fg focus:outline-none focus:border-[#2962ff]"
                                            />
                                        </div>
                                    </div>

                                    {/* Line Color, Thickness & Style */}
                                    <div className="p-3.5 rounded-xl border border-line bg-surface-2/40 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-fg">{isEn ? 'Line / Stroke' : 'Linha / Contorno'}</span>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="color"
                                                    value={styleState.lineColor.startsWith('#') && styleState.lineColor.length === 7 ? styleState.lineColor : '#2962ff'}
                                                    onChange={(e) => onUpdateStyle({ lineColor: e.target.value })}
                                                    className="w-6 h-6 rounded cursor-pointer border border-line bg-transparent"
                                                />
                                                <span className="font-mono text-[11px] text-fg-muted uppercase">{styleState.lineColor}</span>
                                            </div>
                                        </div>

                                        {/* Quick palette row */}
                                        <div className="grid grid-cols-10 gap-1">
                                            {COLOR_PALETTE_ROWS[1].map((hex) => (
                                                <button
                                                    key={hex}
                                                    type="button"
                                                    onClick={() => onUpdateStyle({ lineColor: hex })}
                                                    className={`h-5 rounded-xs cursor-pointer border ${
                                                        styleState.lineColor.toLowerCase() === hex.toLowerCase()
                                                            ? 'ring-2 ring-[#2962ff]'
                                                            : 'border-black/15'
                                                    }`}
                                                    style={{ backgroundColor: hex }}
                                                />
                                            ))}
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 pt-1">
                                            <div>
                                                <label className="block text-[11px] text-fg-muted mb-1">
                                                    {isEn ? `Thickness (${styleState.lineSize}px)` : `Espessura (${styleState.lineSize}px)`}
                                                </label>
                                                <div className="flex gap-1">
                                                    {LINE_SIZES.map((sz) => (
                                                        <button
                                                            key={sz}
                                                            type="button"
                                                            onClick={() => onUpdateStyle({ lineSize: sz })}
                                                            className={`flex-1 py-1 rounded font-bold cursor-pointer border ${
                                                                styleState.lineSize === sz
                                                                    ? 'bg-[#2962ff] text-white border-[#2962ff]'
                                                                    : 'bg-surface border-line hover:bg-surface-2'
                                                            }`}
                                                        >
                                                            {sz}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[11px] text-fg-muted mb-1">
                                                    {isEn ? 'Line Style' : 'Estilo do Traço'}
                                                </label>
                                                <div className="grid grid-cols-3 gap-1">
                                                    {([
                                                        { id: 'solid', label: isEn ? 'Solid' : 'Sólido' },
                                                        { id: 'dashed', label: isEn ? 'Dashed' : 'Tracejado' },
                                                        { id: 'dotted', label: isEn ? 'Dotted' : 'Pontilhado' },
                                                    ] as const).map((st) => (
                                                        <button
                                                            key={st.id}
                                                            type="button"
                                                            onClick={() => onUpdateStyle({ lineStyle: st.id })}
                                                            className={`py-1 rounded font-semibold cursor-pointer border text-[10px] ${
                                                                styleState.lineStyle === st.id
                                                                    ? 'bg-[#2962ff] text-white border-[#2962ff]'
                                                                    : 'bg-surface border-line hover:bg-surface-2'
                                                            }`}
                                                        >
                                                            {st.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Fill Color & Opacity */}
                                    <div className="p-3.5 rounded-xl border border-line bg-surface-2/40 space-y-2.5">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-fg">{isEn ? 'Fill & Opacity' : 'Preenchimento & Opacidade'}</span>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="color"
                                                    value={styleState.fillColor.startsWith('#') && styleState.fillColor.length === 7 ? styleState.fillColor : '#2962ff'}
                                                    onChange={(e) => onUpdateStyle({ fillColor: e.target.value })}
                                                    className="w-6 h-6 rounded cursor-pointer border border-line bg-transparent"
                                                />
                                                <span className="font-bold text-[11px]">{styleState.fillOpacity}%</span>
                                            </div>
                                        </div>
                                        <input
                                            type="range"
                                            min={0}
                                            max={100}
                                            value={styleState.fillOpacity}
                                            onChange={(e) => onUpdateStyle({ fillOpacity: Number(e.target.value) })}
                                            className="w-full accent-[#2962ff] cursor-pointer"
                                        />
                                    </div>

                                    {/* Text & Font Size */}
                                    <div className="p-3.5 rounded-xl border border-line bg-surface-2/40 space-y-2.5">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-fg">{isEn ? `Font / Icon Size (${styleState.textSize}px)` : `Tamanho da Fonte / Ícone (${styleState.textSize}px)`}</span>
                                            <input
                                                type="color"
                                                value={styleState.textColor.startsWith('#') && styleState.textColor.length === 7 ? styleState.textColor : '#ffffff'}
                                                onChange={(e) => onUpdateStyle({ textColor: e.target.value })}
                                                className="w-6 h-6 rounded cursor-pointer border border-line bg-transparent"
                                            />
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {FONT_SIZES.map((sz) => (
                                                <button
                                                    key={sz}
                                                    type="button"
                                                    onClick={() => onUpdateStyle({ textSize: sz })}
                                                    className={`px-2.5 py-1 rounded font-bold cursor-pointer border ${
                                                        styleState.textSize === sz
                                                            ? 'bg-[#2962ff] text-white border-[#2962ff]'
                                                            : 'bg-surface border-line hover:bg-surface-2'
                                                    }`}
                                                >
                                                    {sz}px
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}

                            {settingsTab === 'coords' && (
                                <div className="space-y-3">
                                    <p className="text-[11px] text-fg-muted">
                                        {isEn
                                            ? 'Fine-tune exact price levels and anchor bar indices on the chart:'
                                            : 'Ajuste os níveis exatos de preço e posição das âncoras da ferramenta no gráfico:'}
                                    </p>

                                    {points.length === 0 ? (
                                        <div className="p-4 rounded-xl border border-line text-center text-fg-muted">
                                            {isEn
                                                ? 'Click on the chart to place anchor points for this tool.'
                                                : 'Clique no gráfico para posicionar os pontos desta ferramenta.'}
                                        </div>
                                    ) : (
                                        points.map((pt, idx) => {
                                            const pointTitle =
                                                isPositionTool && idx === 0
                                                    ? (isEn ? 'Point 1 · Entry Price' : 'Ponto 1 · Preço de Entrada (Entry)')
                                                    : isPositionTool && idx === 1
                                                        ? (isEn ? 'Point 2 · Take Profit (TP)' : 'Ponto 2 · Alvo (Take Profit)')
                                                        : isPositionTool && idx === 2
                                                            ? (isEn ? 'Point 3 · Stop Loss (SL)' : 'Ponto 3 · Stop Loss (SL)')
                                                            : (isEn ? `Point #${idx + 1}` : `Ponto #${idx + 1}`);
                                            return (
                                                <div
                                                    key={idx}
                                                    className="p-3 rounded-xl border border-line bg-surface-2/40 flex items-center justify-between gap-3"
                                                >
                                                    <div>
                                                        <div className="font-bold text-fg">{pointTitle}</div>
                                                        <div className="text-[10px] text-fg-muted">
                                                            {isEn ? `Bar #${pt.dataIndex ?? '—'}` : `Barra #${pt.dataIndex ?? '—'}`}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex flex-col">
                                                            <span className="text-[9px] uppercase text-fg-muted font-bold">
                                                                {isEn ? 'Price' : 'Preço'}
                                                            </span>
                                                            <input
                                                                type="number"
                                                                step={Math.pow(10, -decimals)}
                                                                value={typeof pt.value === 'number' ? Number(pt.value.toFixed(decimals)) : ''}
                                                                onChange={(e) => {
                                                                    const val = parseFloat(e.target.value);
                                                                    if (Number.isFinite(val)) {
                                                                        onUpdatePoint(idx, { value: val });
                                                                    }
                                                                }}
                                                                className="w-32 px-2.5 py-1 rounded-lg border border-line bg-surface font-mono font-bold text-right text-fg focus:outline-none focus:border-[#2962ff]"
                                                            />
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-[9px] uppercase text-fg-muted font-bold">
                                                                {isEn ? 'Bar (Index)' : 'Vela (Índice)'}
                                                            </span>
                                                            <input
                                                                type="number"
                                                                step={1}
                                                                value={typeof pt.dataIndex === 'number' ? pt.dataIndex : ''}
                                                                onChange={(e) => {
                                                                    const dIdx = parseInt(e.target.value, 10);
                                                                    if (Number.isFinite(dIdx) && dIdx >= 0) {
                                                                        onUpdatePoint(idx, { dataIndex: dIdx });
                                                                    }
                                                                }}
                                                                className="w-20 px-2 py-1 rounded-lg border border-line bg-surface font-mono text-right text-fg focus:outline-none focus:border-[#2962ff]"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}

                                    {/* Send Long/Short Position to Order Ticket */}
                                    {isPositionTool && points.length >= 2 && onSendPositionToOrderTicket && (
                                        <div className="pt-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const entry = points[0]?.value ?? 0;
                                                    const tp = points[1]?.value ?? entry;
                                                    const sl =
                                                        points[2]?.value ??
                                                        (selectedItem.name === 'tvLongPosition'
                                                            ? entry - Math.abs(tp - entry) * 0.5
                                                            : entry + Math.abs(tp - entry) * 0.5);
                                                    onSendPositionToOrderTicket(
                                                        selectedItem.name === 'tvLongPosition' ? 'BUY' : 'SELL',
                                                        entry,
                                                        tp,
                                                        sl
                                                    );
                                                    setSettingsModalOpen(false);
                                                }}
                                                className="w-full py-2.5 px-4 rounded-xl bg-[#2962ff] hover:bg-[#1d4ed8] text-white font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md"
                                            >
                                                <Send size={14} />
                                                <span>{isEn ? 'Send Levels (Entry / TP / SL) to Order Ticket' : 'Enviar Níveis (Entrada / TP / SL) para a Boleta de Trade'}</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {settingsTab === 'visibility' && (
                                <div className="space-y-3">
                                    <div className="p-3.5 rounded-xl border border-line bg-surface-2/40 flex items-center justify-between">
                                        <div>
                                            <div className="font-bold">{isEn ? 'Visible on Chart' : 'Visível no Gráfico'}</div>
                                            <div className="text-[11px] text-fg-muted">
                                                {isEn ? 'Show or hide this layer while keeping its saved coordinates' : 'Exibir ou ocultar esta camada mantendo suas coordenadas salvas'}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => onToggleVisible(selectedItem.id)}
                                            className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer flex items-center gap-1.5 ${
                                                isVisible
                                                    ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                                                    : 'bg-surface border border-line text-fg-muted'
                                            }`}
                                        >
                                            {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                                            <span>{isVisible ? (isEn ? 'Visible' : 'Visível') : (isEn ? 'Hidden' : 'Oculto')}</span>
                                        </button>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-line bg-surface-2/40 flex items-center justify-between">
                                        <div>
                                            <div className="font-bold">{isEn ? 'Lock Position' : 'Bloquear Posição (Lock)'}</div>
                                            <div className="text-[11px] text-fg-muted">
                                                {isEn ? 'Prevents accidental movement during replay' : 'Impede que o objeto seja movido acidentalmente durante o replay'}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => onToggleLock(selectedItem.id)}
                                            className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer flex items-center gap-1.5 ${
                                                isLocked
                                                    ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                                                    : 'bg-surface border border-line text-fg-muted'
                                            }`}
                                        >
                                            {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                                            <span>{isLocked ? (isEn ? 'Locked' : 'Bloqueado') : (isEn ? 'Unlocked' : 'Desbloqueado')}</span>
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2.5 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onDuplicate(selectedItem.id);
                                                setSettingsModalOpen(false);
                                            }}
                                            className="py-2 px-3 rounded-xl border border-line hover:bg-surface-2 font-semibold flex items-center justify-center gap-2 cursor-pointer"
                                        >
                                            <Copy size={14} />
                                            <span>{isEn ? 'Duplicate Layer' : 'Duplicar Camada'}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onResetStyle(selectedItem.id)}
                                            className="py-2 px-3 rounded-xl border border-line hover:bg-surface-2 font-semibold flex items-center justify-center gap-2 cursor-pointer text-fg-muted hover:text-fg"
                                        >
                                            <RotateCcw size={14} />
                                            <span>{isEn ? 'Reset to Default' : 'Restaurar Padrão'}</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="px-5 py-3 border-t border-line bg-surface-2/40 flex items-center justify-between">
                            <button
                                type="button"
                                onClick={() => {
                                    onDelete(selectedItem.id);
                                    setSettingsModalOpen(false);
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold text-neg hover:bg-neg/10 flex items-center gap-1.5 cursor-pointer"
                            >
                                <Trash2 size={14} />
                                <span>{isEn ? 'Delete Object' : 'Excluir Objeto'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setSettingsModalOpen(false)}
                                className="px-5 py-1.5 rounded-lg bg-[#2962ff] hover:bg-[#1d4ed8] text-white text-xs font-bold cursor-pointer shadow-sm"
                            >
                                {isEn ? 'Done' : 'Concluído'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
});
