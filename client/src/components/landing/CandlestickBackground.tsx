import React from 'react';

interface RealCandle {
    id: number;
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
    metric?: 'upper-wick' | 'lower-wick' | 'live';
}

// 20 velas institucionais longas e esguias com continuidade real de preço
// Coordenadas SVG: y=0 é topo (preço mais alto), y=360 é base (preço mais baixo)
const REAL_CHART_DATA: RealCandle[] = [
    { id: 1, open: 155, close: 215, high: 140, low: 228, volume: 38 },
    { id: 2, open: 215, close: 260, high: 206, low: 275, volume: 44 },
    { id: 3, open: 260, close: 254, high: 246, low: 278, volume: 32 },
    { id: 4, open: 254, close: 230, high: 224, low: 330, volume: 115, metric: 'lower-wick' },
    { id: 5, open: 230, close: 155, high: 146, low: 238, volume: 90 },
    { id: 6, open: 155, close: 88, high: 80, low: 164, volume: 105 },
    { id: 7, open: 88, close: 125, high: 82, low: 134, volume: 42 },
    { id: 8, open: 125, close: 55, high: 48, low: 132, volume: 120 },
    { id: 9, open: 55, close: 38, high: 10, low: 66, volume: 165, metric: 'upper-wick' },
    { id: 10, open: 38, close: 76, high: 32, low: 84, volume: 55 },
    { id: 11, open: 76, close: 28, high: 20, low: 82, volume: 95 },
    { id: 12, open: 28, close: 65, high: 22, low: 72, volume: 60 },
    { id: 13, open: 65, close: 115, high: 60, low: 125, volume: 75 },
    { id: 14, open: 115, close: 170, high: 108, low: 180, volume: 50 },
    { id: 15, open: 170, close: 148, high: 142, low: 250, volume: 110, metric: 'lower-wick' },
    { id: 16, open: 148, close: 92, high: 86, low: 155, volume: 95 },
    { id: 17, open: 92, close: 42, high: 36, low: 100, volume: 130 },
    { id: 18, open: 42, close: 26, high: 8, low: 52, volume: 155, metric: 'upper-wick' },
    { id: 19, open: 26, close: 54, high: 22, low: 60, volume: 70 },
    { id: 20, open: 54, close: 18, high: 10, low: 36, volume: 145, metric: 'live' }
];

export interface CandlestickHeroBackgroundProps {
    className?: string;
    opacity?: string;
}

export const CandlestickHeroBackground: React.FC<CandlestickHeroBackgroundProps> = ({
    className = "",
    opacity = "opacity-50 sm:opacity-65"
}) => {
    const candleWidth = 20;
    const spacing = 70;
    const startX = 45;

    return (
        <div 
            className={`absolute inset-0 pointer-events-none overflow-hidden select-none bg-canvas z-0 ${className}`}
            aria-hidden="true"
        >
            {/* Máscara suave integrada perfeitamente ao fundo preto obsidiana */}
            <div 
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'radial-gradient(ellipse 95% 85% at 50% 50%, transparent 40%, #08090C 95%)'
                }}
            />
            {/* Fade gradiente sutil no topo e base */}
            <div 
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'linear-gradient(180deg, #08090C 0%, transparent 12%, transparent 88%, #08090C 100%)'
                }}
            />

            <svg 
                className={`w-full h-full ${opacity}`}
                viewBox="0 0 1440 360" 
                preserveAspectRatio="xMidYMid slice"
            >
                {/* 1. Grade de Preços Muito Escura e Integrada */}
                <g opacity="0.40">
                    {/* Linha de Resistência Máxima */}
                    <line x1="0" y1="10" x2="1440" y2="10" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="0.8" strokeDasharray="3 3" />
                    <text x="14" y="8" fill="#4B5563" fontSize="7.5" fontFamily="monospace">154.600</text>
                    <text x="1380" y="8" fill="#4B5563" fontSize="7.5" fontFamily="monospace">154.600</text>

                    {/* Linhas Intermediárias de Cotação */}
                    <line x1="0" y1="85" x2="1440" y2="85" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.8" strokeDasharray="4 4" />
                    <text x="14" y="81" fill="#374151" fontSize="7" fontFamily="monospace">153.800</text>
                    <text x="1380" y="81" fill="#374151" fontSize="7" fontFamily="monospace">153.800</text>

                    <line x1="0" y1="165" x2="1440" y2="165" stroke="rgba(255, 255, 255, 0.06)" strokeWidth="0.8" strokeDasharray="4 4" />
                    <text x="14" y="161" fill="#374151" fontSize="7" fontFamily="monospace">153.000</text>
                    <text x="1380" y="161" fill="#374151" fontSize="7" fontFamily="monospace">153.000</text>

                    <line x1="0" y1="245" x2="1440" y2="245" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.8" strokeDasharray="4 4" />
                    <text x="14" y="241" fill="#374151" fontSize="7" fontFamily="monospace">152.200</text>
                    <text x="1380" y="241" fill="#374151" fontSize="7" fontFamily="monospace">152.200</text>

                    {/* Linha de Suporte de Fundo */}
                    <line x1="0" y1="330" x2="1440" y2="330" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="0.8" strokeDasharray="3 3" />
                    <text x="14" y="326" fill="#4B5563" fontSize="7.5" fontFamily="monospace">151.600</text>
                    <text x="1380" y="326" fill="#4B5563" fontSize="7.5" fontFamily="monospace">151.600</text>
                </g>

                {/* 2. Velas Longas com Largura Reduzida e Pavios Finos de 1px */}
                {REAL_CHART_DATA.map((c, i) => {
                    const x = startX + i * spacing;
                    const isBullish = c.close <= c.open;
                    const bodyTop = Math.min(c.open, c.close);
                    const bodyHeight = Math.max(Math.abs(c.open - c.close), 8);

                    // Paleta rica e viva perfeitamente calibrada
                    const fillColor = isBullish 
                        ? 'rgba(16, 185, 129, 0.22)' 
                        : 'rgba(244, 63, 94, 0.18)';
                    const strokeColor = isBullish 
                        ? 'rgba(52, 211, 153, 0.55)' 
                        : 'rgba(251, 113, 133, 0.48)';
                    const wickColor = isBullish 
                        ? 'rgba(52, 211, 153, 0.75)' 
                        : 'rgba(251, 113, 133, 0.68)';

                    return (
                        <g key={c.id}>
                            {/* Pavio Fino e Reto de 1px */}
                            <line
                                x1={x}
                                y1={c.high}
                                x2={x}
                                y2={c.low}
                                stroke={wickColor}
                                strokeWidth="1.2"
                                strokeLinecap="square"
                            />

                            {/* Corpo Longo e Esguio (20px de largura com grande alcance vertical) */}
                            <rect
                                x={x - candleWidth / 2}
                                y={bodyTop}
                                width={candleWidth}
                                height={bodyHeight}
                                rx="1.5"
                                fill={fillColor}
                                stroke={strokeColor}
                                strokeWidth="1.2"
                            />

                            {/* Barra de Volume na Base */}
                            <rect
                                x={x - (candleWidth / 2 - 2)}
                                y={360 - c.volume * 0.36}
                                width={candleWidth - 4}
                                height={c.volume * 0.36}
                                rx="1"
                                fill={fillColor}
                                opacity="0.30"
                            />

                            {/* PONTO: SINCRONIZADO NO PAVIO SUPERIOR (Taxa de Acerto 68.5%) */}
                            {c.metric === 'upper-wick' && (
                                <g>
                                    <circle cx={x} cy={c.high} r="2.5" fill="#34D399" opacity="0.9" />
                                    <line x1={x} y1={c.high} x2={x} y2={c.high - 8} stroke="rgba(52, 211, 153, 0.6)" strokeWidth="0.8" />
                                    <rect 
                                        x={x - 85} 
                                        y={c.high - 22} 
                                        width="170" 
                                        height="16" 
                                        rx="2" 
                                        fill="#08090C" 
                                        stroke="rgba(16, 185, 129, 0.45)" 
                                        strokeWidth="0.8" 
                                    />
                                    <text 
                                        x={x} 
                                        y={c.high - 11} 
                                        textAnchor="middle" 
                                        fill="#34D399" 
                                        fontSize="8" 
                                        fontFamily="monospace" 
                                        fontWeight="600"
                                        letterSpacing="0.04em"
                                    >
                                        PAVIO SUPERIOR • WIN RATE 68.5%
                                    </text>
                                </g>
                            )}

                            {/* PONTO: SINCRONIZADO NO PAVIO INFERIOR (Profit Factor 2.42) */}
                            {c.metric === 'lower-wick' && (
                                <g>
                                    <circle cx={x} cy={c.low} r="2.5" fill="#34D399" opacity="0.9" />
                                    <line x1={x} y1={c.low} x2={x} y2={c.low + 8} stroke="rgba(52, 211, 153, 0.6)" strokeWidth="0.8" />
                                    <rect 
                                        x={x - 85} 
                                        y={c.low + 8} 
                                        width="170" 
                                        height="16" 
                                        rx="2" 
                                        fill="#08090C" 
                                        stroke="rgba(16, 185, 129, 0.45)" 
                                        strokeWidth="0.8" 
                                    />
                                    <text 
                                        x={x} 
                                        y={c.low + 19} 
                                        textAnchor="middle" 
                                        fill="#34D399" 
                                        fontSize="8" 
                                        fontFamily="monospace" 
                                        fontWeight="600"
                                        letterSpacing="0.04em"
                                    >
                                        PAVIO INFERIOR • PROFIT FACTOR 2.42
                                    </text>
                                </g>
                            )}

                            {/* Cotação ao Vivo Discreta na Última Vela */}
                            {c.metric === 'live' && (
                                <g opacity="0.85">
                                    <line 
                                        x1={x} 
                                        y1={c.close} 
                                        x2="1440" 
                                        y2={c.close} 
                                        stroke="rgba(16, 185, 129, 0.6)" 
                                        strokeWidth="1" 
                                        strokeDasharray="3 3" 
                                    />
                                    <rect x="1380" y={c.close - 7} width="50" height="14" rx="2" fill="#0D1F17" stroke="rgba(16, 185, 129, 0.5)" strokeWidth="0.8" />
                                    <text x="1405" y={c.close + 3} textAnchor="middle" fill="#34D399" fontSize="7.5" fontFamily="monospace" fontWeight="bold">
                                        154.20
                                    </text>
                                </g>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};