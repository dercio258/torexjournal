import React, { useState, memo } from 'react';
import {
    Crosshair, TrendingUp, AlignLeft, Pentagon, Brush,
    Type, Smile, Ruler, ZoomIn, Magnet, Lock, Eye, Trash2
} from 'lucide-react';

interface LeftDrawingLayerProps {
    isLight: boolean;
    cutCandleMode: boolean;
    magnetMode: boolean;
    drawingsLocked: boolean;
    drawingsVisible: boolean;
    onSelectDrawingTool: (overlayName: string) => void;
    onZoomIn: () => void;
    onToggleMagnet: () => void;
    onToggleLock: () => void;
    onToggleVisible: () => void;
    onClearDrawings: () => void;
}

export const LeftDrawingLayer: React.FC<LeftDrawingLayerProps> = memo(({
    isLight,
    cutCandleMode,
    magnetMode,
    drawingsLocked,
    drawingsVisible,
    onSelectDrawingTool,
    onZoomIn,
    onToggleMagnet,
    onToggleLock,
    onToggleVisible,
    onClearDrawings,
}) => {
    const [activeToolGroup, setActiveToolGroup] = useState<string | null>(null);

    const handlePick = (toolId: string) => {
        onSelectDrawingTool(toolId);
        setActiveToolGroup(null);
    };

    return (
        <div className={`w-11 shrink-0 flex flex-col items-center py-2 gap-1 border-r z-20 relative ${
            isLight ? 'bg-white border-slate-200 text-slate-700' : 'bg-[#131722] border-slate-800 text-slate-300'
        }`}>
            {/* Crosshair */}
            <button
                onClick={() => setActiveToolGroup(null)}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    activeToolGroup === null && !cutCandleMode
                        ? 'bg-indigo-500/15 text-indigo-600'
                        : isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                }`}
                title="Cursor Cruz (Crosshair)"
            >
                <Crosshair size={16} />
            </button>

            {/* Trendlines */}
            <div className="relative">
                <button
                    onClick={() => setActiveToolGroup(g => (g === 'lines' ? null : 'lines'))}
                    className={`p-2 rounded-lg transition-colors cursor-pointer ${
                        activeToolGroup === 'lines' ? 'bg-indigo-500/15 text-indigo-600' : isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                    }`}
                    title="Linhas de Tendência, Horizontal e Canal"
                >
                    <TrendingUp size={16} />
                </button>
                {activeToolGroup === 'lines' && (
                    <div className={`absolute left-full top-0 ml-1 w-52 rounded-xl border shadow-2xl py-1.5 z-50 text-xs ${
                        isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
                    }`}>
                        {[
                            { id: 'straightLine', label: 'Linha de Tendência' },
                            { id: 'rayLine', label: 'Raio Direcional' },
                            { id: 'horizontalStraightLine', label: 'Linha Horizontal (Suporte/Resist.)' },
                            { id: 'horizontalRayLine', label: 'Raio Horizontal' },
                            { id: 'verticalStraightLine', label: 'Linha Vertical' },
                            { id: 'priceChannelLine', label: 'Canal de Preço Paralelo' },
                        ].map(item => (
                            <button
                                key={item.id}
                                onClick={() => handlePick(item.id)}
                                className={`w-full px-3 py-1.5 text-left cursor-pointer ${
                                    isLight ? 'hover:bg-slate-100 text-slate-700' : 'hover:bg-slate-800 text-slate-200'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Fibonacci & Gann */}
            <div className="relative">
                <button
                    onClick={() => setActiveToolGroup(g => (g === 'fib' ? null : 'fib'))}
                    className={`p-2 rounded-lg transition-colors cursor-pointer ${
                        activeToolGroup === 'fib' ? 'bg-indigo-500/15 text-indigo-600' : isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                    }`}
                    title="Retração de Fibonacci, Extensão, Leque e Gann"
                >
                    <AlignLeft size={16} />
                </button>
                {activeToolGroup === 'fib' && (
                    <div className={`absolute left-full top-0 ml-1 w-56 rounded-xl border shadow-2xl py-1.5 z-50 text-xs ${
                        isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
                    }`}>
                        {[
                            { id: 'fibonacciLine', label: 'Retração de Fibonacci (Completa)' },
                            { id: 'fibonacciSegment', label: 'Segmento de Fibonacci' },
                            { id: 'fibonacciExtension', label: 'Extensão de Fibonacci (3 Pontos)' },
                            { id: 'fibonacciSpeedResistanceFan', label: 'Leque de Fibonacci (Fan)' },
                            { id: 'fibonacciCircle', label: 'Círculos de Fibonacci' },
                            { id: 'fibonacciSpiral', label: 'Espiral de Fibonacci' },
                            { id: 'gannBox', label: 'Caixa de Gann (Gann Box)' },
                        ].map(item => (
                            <button
                                key={item.id}
                                onClick={() => handlePick(item.id)}
                                className={`w-full px-3 py-1.5 text-left cursor-pointer ${
                                    isLight ? 'hover:bg-slate-100 text-slate-700' : 'hover:bg-slate-800 text-slate-200'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Elliott Waves & Harmonics */}
            <div className="relative">
                <button
                    onClick={() => setActiveToolGroup(g => (g === 'patterns' ? null : 'patterns'))}
                    className={`p-2 rounded-lg transition-colors cursor-pointer ${
                        activeToolGroup === 'patterns' ? 'bg-indigo-500/15 text-indigo-600' : isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                    }`}
                    title="Padrões Harmônicos e Ondas de Elliott"
                >
                    <Pentagon size={16} />
                </button>
                {activeToolGroup === 'patterns' && (
                    <div className={`absolute left-full top-0 ml-1 w-56 rounded-xl border shadow-2xl py-1.5 z-50 text-xs ${
                        isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
                    }`}>
                        {[
                            { id: 'abcd', label: 'Padrão Harmônico ABCD' },
                            { id: 'xabcd', label: 'Padrão Harmônico XABCD (Gartley)' },
                            { id: 'threeWaves', label: '3 Ondas de Elliott (A-B-C)' },
                            { id: 'fiveWaves', label: '5 Ondas de Elliott (1-2-3-4-5)' },
                            { id: 'eightWaves', label: '8 Ondas de Elliott Completas' },
                        ].map(item => (
                            <button
                                key={item.id}
                                onClick={() => handlePick(item.id)}
                                className={`w-full px-3 py-1.5 text-left cursor-pointer ${
                                    isLight ? 'hover:bg-slate-100 text-slate-700' : 'hover:bg-slate-800 text-slate-200'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Long / Short Position Tool */}
            <div className="relative">
                <button
                    onClick={() => setActiveToolGroup(g => (g === 'position' ? null : 'position'))}
                    className={`p-2 rounded-lg transition-colors cursor-pointer ${
                        activeToolGroup === 'position' ? 'bg-indigo-500/15 text-indigo-600' : isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                    }`}
                    title="Projeção Posição Comprada (Long) / Vendida (Short)"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="8" rx="1" />
                        <rect x="3" y="12" width="18" height="8" rx="1" />
                    </svg>
                </button>
                {activeToolGroup === 'position' && (
                    <div className={`absolute left-full top-0 ml-1 w-56 rounded-xl border shadow-2xl py-1.5 z-50 text-xs ${
                        isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
                    }`}>
                        <button
                            onClick={() => handlePick('tvLongPosition')}
                            className={`w-full px-3 py-2 text-left flex items-center gap-2 cursor-pointer ${
                                isLight ? 'hover:bg-slate-100 text-emerald-600 font-semibold' : 'hover:bg-slate-800 text-emerald-400 font-semibold'
                            }`}
                        >
                            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
                            Posição Comprada (Long R:R)
                        </button>
                        <button
                            onClick={() => handlePick('tvShortPosition')}
                            className={`w-full px-3 py-2 text-left flex items-center gap-2 cursor-pointer ${
                                isLight ? 'hover:bg-slate-100 text-rose-600 font-semibold' : 'hover:bg-slate-800 text-rose-400 font-semibold'
                            }`}
                        >
                            <span className="w-2.5 h-2.5 rounded-xs bg-rose-500" />
                            Posição Vendida (Short R:R)
                        </button>
                    </div>
                )}
            </div>

            {/* Shapes */}
            <div className="relative">
                <button
                    onClick={() => setActiveToolGroup(g => (g === 'shapes' ? null : 'shapes'))}
                    className={`p-2 rounded-lg transition-colors cursor-pointer ${
                        activeToolGroup === 'shapes' ? 'bg-indigo-500/15 text-indigo-600' : isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                    }`}
                    title="Retângulo (Order Block), Círculo e Triângulo"
                >
                    <Brush size={16} />
                </button>
                {activeToolGroup === 'shapes' && (
                    <div className={`absolute left-full top-0 ml-1 w-52 rounded-xl border shadow-2xl py-1.5 z-50 text-xs ${
                        isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
                    }`}>
                        {[
                            { id: 'rect', label: 'Retângulo (Order Block / FVG)' },
                            { id: 'parallelogram', label: 'Paralelogramo' },
                            { id: 'circle', label: 'Círculo' },
                            { id: 'triangle', label: 'Triângulo' },
                        ].map(item => (
                            <button
                                key={item.id}
                                onClick={() => handlePick(item.id)}
                                className={`w-full px-3 py-1.5 text-left cursor-pointer ${
                                    isLight ? 'hover:bg-slate-100 text-slate-700' : 'hover:bg-slate-800 text-slate-200'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <button
                onClick={() => handlePick('simpleAnnotation')}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'}`}
                title="Texto / Anotação"
            >
                <Type size={16} />
            </button>

            <button
                onClick={() => handlePick('simpleTag')}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'}`}
                title="Marcador de Preço"
            >
                <Smile size={16} />
            </button>

            <button
                onClick={() => handlePick('priceLine')}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'}`}
                title="Régua de Nível de Preço"
            >
                <Ruler size={16} />
            </button>

            <button
                onClick={onZoomIn}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'}`}
                title="Aumentar Zoom"
            >
                <ZoomIn size={16} />
            </button>

            <div className={`w-6 h-px my-1 ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`} />

            <button
                onClick={onToggleMagnet}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    magnetMode ? 'bg-indigo-500/15 text-indigo-600' : isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                }`}
                title="Modo Ímã"
            >
                <Magnet size={16} />
            </button>

            <button
                onClick={onToggleLock}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    drawingsLocked ? 'bg-amber-500/15 text-amber-600' : isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                }`}
                title="Travar Desenhos"
            >
                <Lock size={15} />
            </button>

            <button
                onClick={onToggleVisible}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    !drawingsVisible ? 'bg-rose-500/15 text-rose-500' : isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                }`}
                title="Mostrar / Ocultar Desenhos"
            >
                <Eye size={15} />
            </button>

            <button
                onClick={onClearDrawings}
                className={`p-2 rounded-lg transition-colors cursor-pointer text-rose-500 ${isLight ? 'hover:bg-rose-50' : 'hover:bg-rose-950/30'}`}
                title="Apagar Todos os Desenhos"
            >
                <Trash2 size={15} />
            </button>
        </div>
    );
});
