import { Period } from '@klinecharts/pro';

export interface ReplayOrder {
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT' | 'STOP';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    lots: number;
    riskAmount: number;
    rrRatio: number;
    /** CANCELLED = pending order cancelled before filling; CLOSED = legacy manual/cancelled. */
    status: 'PENDING' | 'OPEN' | 'WIN' | 'LOSS' | 'CANCELLED' | 'CLOSED';
    exitPrice?: number;
    exitReason?: 'SL' | 'TP' | 'MANUAL';
    /** Net of commission. */
    pnl: number;
    rMultiple?: number;
    /** Price units added to the bid to get the ask. */
    spread?: number;
    /** Account currency, charged once per trade. */
    commission?: number;
    /** Bar timestamp at placement; the order is evaluated from the NEXT bar. */
    openedAt: number;
    /** Exact bar timestamp when a PENDING order filled into OPEN (equals openedAt for MARKET). */
    filledAt?: number;
    closedAt?: number;
    /** True when imported from a real broker execution (/trades/:id or MT5/Deriv sync). */
    isImportedTrade?: boolean;
    historicalExitPrice?: number;
    historicalClosedAt?: number;
    historicalPnl?: number;
    historicalExitReason?: 'SL' | 'TP' | 'MANUAL';
    /** User intent, replayed by the engine (undone on rewind past it). */
    manualCloseAt?: number;
    manualClosePrice?: number;
    cancelledAt?: number;
    /** Original stop-loss at entry so Break-Even / trailing SL preserves 1R distance. */
    initialStopLoss?: number;
    /** Replay bar timestamp when SL was moved (e.g. Break-Even or chart drag). */
    slModifiedAt?: number;
    /** Present when created from a partial close (e.g. 50%) of an open position. */
    parentOrderId?: string;
    isPartialClose?: boolean;
    /** Rich journal & guided execution review fields per ReplayOrder. */
    journalContent?: string;
    journalImages?: string[];
    setup?: string | null;
    rating?: number;
    mfe?: number | null;
    mae?: number | null;
    psychCheck?: {
        feeling?: string | null;
        followingPlan?: string | null;
        entryDriver?: string | null;
        riskComfort?: string | null;
    };
}

export const TIMEFRAMES: Period[] = [
    { multiplier: 1, timespan: 'minute', text: '1m' },
    { multiplier: 5, timespan: 'minute', text: '5m' },
    { multiplier: 15, timespan: 'minute', text: '15m' },
    { multiplier: 30, timespan: 'minute', text: '30m' },
    { multiplier: 1, timespan: 'hour', text: '1h' },
    { multiplier: 4, timespan: 'hour', text: '4h' },
    { multiplier: 1, timespan: 'day', text: 'D' },
    { multiplier: 1, timespan: 'week', text: 'W' },
];

export function findTimeframeByText(rawText?: string | null): Period | undefined {
    if (!rawText) return undefined;
    const clean = rawText.trim().toUpperCase();
    const aliasMap: Record<string, string> = {
        '1': '1m',
        '1M': '1m',
        'M1': '1m',
        '5': '5m',
        '5M': '5m',
        'M5': '5m',
        '15': '15m',
        '15M': '15m',
        'M15': '15m',
        '30': '30m',
        '30M': '30m',
        'M30': '30m',
        '60': '1h',
        '1H': '1h',
        'H1': '1h',
        '240': '4h',
        '4H': '4h',
        'H4': '4h',
        'D': 'D',
        '1D': 'D',
        'D1': 'D',
        'W': 'W',
        '1W': 'W',
        'W1': 'W',
    };
    const canonical = aliasMap[clean] || rawText.trim();
    return TIMEFRAMES.find((t) => t.text.toLowerCase() === canonical.toLowerCase());
}

export interface ReplayTimezoneOption {
    id: string;
    label: string;
    labelEn?: string;
    shortLabel: string;
}

export const REPLAY_TIMEZONES: ReplayTimezoneOption[] = [
    { id: 'local', label: 'Horário Local (Sistema)', labelEn: 'Local Time (System)', shortLabel: 'Local' },
    { id: 'UTC', label: 'UTC (Tempo Universal)', labelEn: 'UTC (Universal Time)', shortLabel: 'UTC' },
    { id: 'America/New_York', label: 'New York (EST/EDT)', labelEn: 'New York (EST/EDT)', shortLabel: 'NY' },
    { id: 'Europe/London', label: 'London (GMT/BST)', labelEn: 'London (GMT/BST)', shortLabel: 'LON' },
    { id: 'Africa/Maputo', label: 'Maputo / Lisboa (CAT)', labelEn: 'Maputo / Lisbon (CAT)', shortLabel: 'CAT' },
    { id: 'Asia/Tokyo', label: 'Tokyo (JST)', labelEn: 'Tokyo (JST)', shortLabel: 'TYO' },
];

export type ChartCandleStyleId =
    | 'bars'
    | 'candles'
    | 'hollow_candles'
    | 'hlc_bars'
    | 'lines'
    | 'lines_with_marks'
    | 'step_line'
    | 'area'
    | 'hlc_area'
    | 'baseline'
    | 'columns'
    | 'high_low'
    | 'heikin_ashi';

export interface ChartCandleStyleOption {
    id: ChartCandleStyleId;
    label: string;
    labelEn?: string;
    shortLabel: string;
    description: string;
    descriptionEn?: string;
    group: 'bars_candles' | 'lines_areas' | 'columns_ranges';
}

export const CANDLE_STYLE_OPTIONS: ChartCandleStyleOption[] = [
    {
        id: 'bars',
        label: 'Bars (Barras OHLC)',
        labelEn: 'OHLC Bars',
        shortLabel: 'Bars',
        description: 'Barras tradicionais de Abertura, Máxima, Mínima e Fechamento',
        descriptionEn: 'Traditional Open, High, Low, Close price bars',
        group: 'bars_candles',
    },
    {
        id: 'candles',
        label: 'Candles (Velas Sólidas)',
        labelEn: 'Candles',
        shortLabel: 'Candles',
        description: 'Velas japonesas clássicas preenchidas',
        descriptionEn: 'Classic filled Japanese candlesticks',
        group: 'bars_candles',
    },
    {
        id: 'hollow_candles',
        label: 'Hollow Candles (Velas Vazadas)',
        labelEn: 'Hollow Candles',
        shortLabel: 'Hollow',
        description: 'Velas com corpo vazado em barras de alta',
        descriptionEn: 'Candlesticks with hollow bodies on bullish bars',
        group: 'bars_candles',
    },
    {
        id: 'hlc_bars',
        label: 'HLC Bars (Barras HLC)',
        labelEn: 'HLC Bars',
        shortLabel: 'HLC Bars',
        description: 'Barras de Máxima, Mínima e Fechamento (sem traço de abertura)',
        descriptionEn: 'High, Low, and Close bars (no open tick)',
        group: 'bars_candles',
    },
    {
        id: 'heikin_ashi',
        label: 'Heikin Ashi',
        labelEn: 'Heikin Ashi',
        shortLabel: 'Heikin Ashi',
        description: 'Velas Heikin Ashi suavizadas por média de preço para filtrar ruído',
        descriptionEn: 'Smoothed average-price candles to filter market noise',
        group: 'bars_candles',
    },
    {
        id: 'lines',
        label: 'Line (Linha)',
        labelEn: 'Line',
        shortLabel: 'Line',
        description: 'Linha contínua conectando os preços de fechamento',
        descriptionEn: 'Continuous line connecting closing prices',
        group: 'lines_areas',
    },
    {
        id: 'lines_with_marks',
        label: 'Line with Markers (Linha com Marcadores)',
        labelEn: 'Line with Markers',
        shortLabel: 'Line Marks',
        description: 'Linha de fechamento com nós circulares em cada período',
        descriptionEn: 'Closing price line with circular markers at each bar',
        group: 'lines_areas',
    },
    {
        id: 'step_line',
        label: 'Step Line (Linha em Degraus)',
        labelEn: 'Step Line',
        shortLabel: 'Step Line',
        description: 'Linha em degraus horizontais e verticais sem interpolação diagonal',
        descriptionEn: 'Stepped horizontal and vertical line without diagonal interpolation',
        group: 'lines_areas',
    },
    {
        id: 'area',
        label: 'Area (Área)',
        labelEn: 'Area',
        shortLabel: 'Area',
        description: 'Linha de fechamento com preenchimento em gradiente suave',
        descriptionEn: 'Closing price line with smooth gradient area fill',
        group: 'lines_areas',
    },
    {
        id: 'hlc_area',
        label: 'HLC Area (Área HLC)',
        labelEn: 'HLC Area',
        shortLabel: 'HLC Area',
        description: 'Faixa sombreada entre Máxima e Mínima com linha central de Fechamento',
        descriptionEn: 'Shaded range between High and Low with a central Close line',
        group: 'lines_areas',
    },
    {
        id: 'baseline',
        label: 'Baseline (Linha de Base)',
        labelEn: 'Baseline',
        shortLabel: 'Baseline',
        description: 'Área dinâmica verde acima do nível base e vermelha abaixo',
        descriptionEn: 'Dynamic green area above baseline and red below',
        group: 'lines_areas',
    },
    {
        id: 'columns',
        label: 'Columns (Colunas)',
        labelEn: 'Columns',
        shortLabel: 'Columns',
        description: 'Colunas verticais de preço coloridas por variação de alta/baixa',
        descriptionEn: 'Vertical price columns colored by bullish/bearish move',
        group: 'columns_ranges',
    },
    {
        id: 'high_low',
        label: 'High-Low (Máxima-Mínima)',
        labelEn: 'High-Low',
        shortLabel: 'High-Low',
        description: 'Barras flutuantes destacando a amplitude entre Máxima e Mínima',
        descriptionEn: 'Floating range bars highlighting the High-Low spread',
        group: 'columns_ranges',
    },
];

export interface SessionScreenshotItem {
    id: string;
    dataUrl: string;
    symbol: string;
    timeframe: string;
    candleStyle: ChartCandleStyleId;
    caption: string;
    createdAt: number;
    replayTimestamp?: number | null;
}

export type IndicatorCategory = 'trend' | 'channels' | 'oscillators' | 'volume';

export interface IndicatorDefinition {
    code: string;
    name: string;
    nameEn?: string;
    pane: 'main' | 'sub';
    category: IndicatorCategory;
    description: string;
    descriptionEn?: string;
    defaultParams?: number[];
}

export const AVAILABLE_INDICATORS: IndicatorDefinition[] = [
    {
        code: 'WEEK_52_HL',
        name: '52 Week High/Low',
        pane: 'main',
        category: 'channels',
        description: 'Máxima e mínima de 52 semanas (252 períodos)',
        descriptionEn: '52-week high and low range (252 periods)',
        defaultParams: [252],
    },
    {
        code: 'AC',
        name: 'Accelerator Oscillator',
        pane: 'sub',
        category: 'oscillators',
        description: 'Oscilador de aceleração de Bill Williams (AO - SMA 5)',
        descriptionEn: 'Bill Williams Accelerator Oscillator (AO - 5 SMA)',
        defaultParams: [5, 34, 5],
    },
    {
        code: 'AD',
        name: 'Accumulation/Distribution',
        pane: 'sub',
        category: 'volume',
        description: 'Linha cumulativa de Acumulação/Distribuição ponderada pelo volume',
        descriptionEn: 'Volume-weighted cumulative Accumulation/Distribution line',
        defaultParams: [1],
    },
    {
        code: 'ASI',
        name: 'Accumulative Swing Index',
        pane: 'sub',
        category: 'oscillators',
        description: 'Índice de Swing Acumulado de Welles Wilder',
        descriptionEn: 'Welles Wilder Accumulative Swing Index',
        defaultParams: [10],
    },
    {
        code: 'ADR_LINE',
        name: 'Advance/Decline',
        pane: 'sub',
        category: 'oscillators',
        description: 'Linha e razão de avanço/declínio de barras compradoras vs. vendedoras',
        descriptionEn: 'Advance/decline line and ratio of bullish vs. bearish bars',
        defaultParams: [14],
    },
    {
        code: 'ALMA',
        name: 'Arnaud Legoux Moving Average',
        pane: 'main',
        category: 'trend',
        description: 'Média móvel Gaussiana com redução de lag (Período 9, Offset 0.85, Sigma 6)',
        descriptionEn: 'Lag-reduced Gaussian moving average (Period 9, Offset 0.85, Sigma 6)',
        defaultParams: [9, 0.85, 6],
    },
    {
        code: 'AROON',
        name: 'Aroon',
        pane: 'sub',
        category: 'trend',
        description: 'Aroon Up e Aroon Down para identificar início e força de tendências',
        descriptionEn: 'Aroon Up and Aroon Down to identify trend onset and strength',
        defaultParams: [14],
    },
    {
        code: 'ADX',
        name: 'Average Directional Index',
        pane: 'sub',
        category: 'trend',
        description: 'Mede a intensidade pura da tendência (Wilder ADX)',
        descriptionEn: 'Measures pure trend intensity (Wilder ADX)',
        defaultParams: [14],
    },
    {
        code: 'AVP',
        name: 'Average Price',
        pane: 'main',
        category: 'channels',
        description: 'Preço médio contínuo no gráfico principal',
        descriptionEn: 'Continuous average price line on the main chart',
    },
    {
        code: 'ATR',
        name: 'Average True Range',
        pane: 'sub',
        category: 'volume',
        description: 'Amplitude média verdadeira para volatilidade e Stop Loss',
        descriptionEn: 'Average True Range for volatility measurement and Stop Loss sizing',
        defaultParams: [14],
    },
    {
        code: 'AO',
        name: 'Awesome Oscillator',
        pane: 'sub',
        category: 'oscillators',
        description: 'Momentum de mercado comparando SMA 5 e SMA 34 do ponto médio (HL/2)',
        descriptionEn: 'Market momentum comparing 5 SMA and 34 SMA of the midpoint (HL/2)',
        defaultParams: [5, 34],
    },
    {
        code: 'BOP',
        name: 'Balance of Power',
        pane: 'sub',
        category: 'oscillators',
        description: 'Força relativa entre compradores e vendedores ((Close - Open) / (High - Low))',
        descriptionEn: 'Relative buying vs. selling pressure ((Close - Open) / (High - Low))',
        defaultParams: [14],
    },
    {
        code: 'BOLL',
        name: 'Bollinger Bands',
        pane: 'main',
        category: 'channels',
        description: 'Bandas de volatilidade em desvios padrão sobre a média móvel',
        descriptionEn: 'Standard-deviation volatility bands plotted around a moving average',
        defaultParams: [20, 2],
    },
    {
        code: 'BB_PERCENT_B',
        name: 'Bollinger Bands %B',
        pane: 'sub',
        category: 'oscillators',
        description: 'Posição relativa do preço dentro das Bandas de Bollinger (0 a 1)',
        descriptionEn: 'Relative price position within Bollinger Bands (0 to 1)',
        defaultParams: [20, 2],
    },
    {
        code: 'BB_WIDTH',
        name: 'Bollinger Bands Width',
        pane: 'sub',
        category: 'volume',
        description: 'Largura percentual das Bandas de Bollinger (Squeeze / Expansão)',
        descriptionEn: 'Percentage width of Bollinger Bands (Squeeze / Expansion)',
        defaultParams: [20, 2],
    },
    {
        code: 'CMF',
        name: 'Chaikin Money Flow',
        pane: 'sub',
        category: 'volume',
        description: 'Fluxo de dinheiro de Chaikin ponderado por volume em N períodos',
        descriptionEn: 'Volume-weighted Chaikin Money Flow over N periods',
        defaultParams: [20],
    },
    {
        code: 'CHAIKIN_OSC',
        name: 'Chaikin Oscillator',
        pane: 'sub',
        category: 'volume',
        description: 'Diferença entre EMAs rápida (3) e lenta (10) da linha A/D',
        descriptionEn: 'Spread between fast (3) and slow (10) EMAs of the A/D line',
        defaultParams: [3, 10],
    },
    {
        code: 'CHAIKIN_VOL',
        name: 'Chaikin Volatility',
        pane: 'sub',
        category: 'volume',
        description: 'Taxa de variação da média exponencial da amplitude High-Low',
        descriptionEn: 'Rate of change of the exponential moving average of High-Low range',
        defaultParams: [10, 10],
    },
    {
        code: 'CHANDE_KROLL',
        name: 'Chande Kroll Stop',
        pane: 'main',
        category: 'channels',
        description: 'Trailing stop dinâmico para compras e vendas baseado em ATR (10, 1, 9)',
        descriptionEn: 'ATR-based dynamic trailing stop for long and short positions (10, 1, 9)',
        defaultParams: [10, 1, 9],
    },
    {
        code: 'CMO',
        name: 'Chande Momentum Oscillator',
        pane: 'sub',
        category: 'oscillators',
        description: 'Oscilador de momentum puro entre -100 e +100',
        descriptionEn: 'Pure momentum oscillator bounded between -100 and +100',
        defaultParams: [14],
    },
    {
        code: 'CHOP_ZONE',
        name: 'Chop Zone',
        pane: 'sub',
        category: 'oscillators',
        description: 'Identifica zonas laterais vs. inclinação direcional da tendência',
        descriptionEn: 'Identifies choppy consolidation zones vs. directional trend slope',
        defaultParams: [30],
    },
    {
        code: 'CHOPPINESS',
        name: 'Choppiness Index',
        pane: 'sub',
        category: 'oscillators',
        description: 'Determina se o mercado está consolidado (>61.8) ou em tendência (<38.2)',
        descriptionEn: 'Determines whether the market is range-bound (>61.8) or trending (<38.2)',
        defaultParams: [14],
    },
    {
        code: 'CCI',
        name: 'Commodity Channel Index',
        pane: 'sub',
        category: 'oscillators',
        description: 'Desvio estatístico do preço típico em relação à sua média',
        descriptionEn: 'Statistical deviation of typical price from its moving average',
        defaultParams: [20],
    },
    {
        code: 'CONNORS_RSI',
        name: 'Connors RSI',
        pane: 'sub',
        category: 'oscillators',
        description: 'Oscilador composto por RSI(3), RSI de Streak(2) e PercentRank(100)',
        descriptionEn: 'Composite oscillator combining RSI(3), Streak RSI(2), and PercentRank(100)',
        defaultParams: [3, 2, 100],
    },
    {
        code: 'COPPOCK',
        name: 'Coppock Curve',
        pane: 'sub',
        category: 'oscillators',
        description: 'Curva de momentum de longo prazo suavizada por WMA(10) de ROC(14)+ROC(11)',
        descriptionEn: 'Long-term momentum curve smoothed by WMA(10) of ROC(14)+ROC(11)',
        defaultParams: [10, 14, 11],
    },
    {
        code: 'CORR_LOG',
        name: 'Correlation - Log',
        pane: 'sub',
        category: 'oscillators',
        description: 'Inclinação e correlação logarítmica dos retornos em N períodos',
        descriptionEn: 'Slope and logarithmic correlation of returns over N periods',
        defaultParams: [20],
    },
    {
        code: 'CORR_COEFF',
        name: 'Correlation Coefficient',
        pane: 'sub',
        category: 'oscillators',
        description: 'Coeficiente de correlação de Pearson (-1 a +1) da tendência linear',
        descriptionEn: 'Pearson correlation coefficient (-1 to +1) of linear trend fit',
        defaultParams: [20],
    },
    {
        code: 'DPO',
        name: 'Detrended Price Oscillator',
        pane: 'sub',
        category: 'oscillators',
        description: 'Remove a tendência para isolar ciclos de curto prazo do preço',
        descriptionEn: 'Removes trend bias to isolate short-term price cycles',
        defaultParams: [21],
    },
    {
        code: 'DMI',
        name: 'Directional Movement',
        pane: 'sub',
        category: 'trend',
        description: 'Sistema Direcional +DI, -DI, ADX e ADXR',
        descriptionEn: 'Directional Movement system (+DI, -DI, ADX, and ADXR)',
        defaultParams: [14, 6],
    },
    {
        code: 'DONCHIAN',
        name: 'Donchian Channels',
        pane: 'main',
        category: 'channels',
        description: 'Canal de rompimento e liquidez com topo, fundo e linha central de 50%',
        descriptionEn: 'Breakout and liquidity channel with upper/lower bounds and 50% midline',
        defaultParams: [20],
    },
    {
        code: 'DEMA',
        name: 'Double EMA',
        pane: 'main',
        category: 'trend',
        description: 'Média Móvel Exponencial Dupla para resposta rápida sem atraso',
        descriptionEn: 'Double Exponential Moving Average for fast, low-lag trend tracking',
        defaultParams: [20, 50],
    },
    {
        code: 'EMV',
        name: 'Ease Of Movement',
        pane: 'sub',
        category: 'volume',
        description: 'Relaciona a velocidade de deslocamento do preço com o volume',
        descriptionEn: 'Relates price displacement velocity to traded volume',
        defaultParams: [14, 9],
    },
    {
        code: 'EFI',
        name: "Elder's Force Index",
        pane: 'sub',
        category: 'volume',
        description: 'Índice de Força de Alexander Elder combinando direção, extensão e volume',
        descriptionEn: "Alexander Elder's Force Index combining direction, range, and volume",
        defaultParams: [13],
    },
    {
        code: 'EMA_CROSS',
        name: 'EMA Cross',
        pane: 'main',
        category: 'trend',
        description: 'Par de médias exponenciais para cruzamento rápido/lento (9, 21)',
        descriptionEn: 'Fast/slow Exponential Moving Average crossover pair (9, 21)',
        defaultParams: [9, 21],
    },
    {
        code: 'ENVELOPES',
        name: 'Envelopes',
        pane: 'main',
        category: 'channels',
        description: 'Bandas percentuais superiores e inferiores ao redor da média móvel',
        descriptionEn: 'Upper and lower percentage bands around a moving average',
        defaultParams: [20, 0.5],
    },
    {
        code: 'FISHER',
        name: 'Fisher Transform',
        pane: 'sub',
        category: 'oscillators',
        description: 'Transformada Gaussiana de Ehlers para pontos extremos de reversão',
        descriptionEn: 'Ehlers Gaussian transform highlighting extreme reversal points',
        defaultParams: [9],
    },
    {
        code: 'GMMA',
        name: 'Guppy Multiple Moving Average',
        pane: 'main',
        category: 'trend',
        description: 'Feixe de 6 EMAs curtas e longas para rastrear traders vs. institucionais',
        descriptionEn: 'Ribbon of 6 short and long EMAs tracking retail vs. institutional flow',
        defaultParams: [3, 8, 15, 30, 45, 60],
    },
    {
        code: 'HIST_VOL',
        name: 'Historical Volatility',
        pane: 'sub',
        category: 'volume',
        description: 'Volatilidade histórica anualizada dos retornos logarítmicos',
        descriptionEn: 'Annualized historical volatility of logarithmic returns',
        defaultParams: [20],
    },
    {
        code: 'HMA',
        name: 'Hull Moving Average',
        pane: 'main',
        category: 'trend',
        description: 'Média Móvel de Alan Hull ultra-suave e com lag quase zero',
        descriptionEn: 'Ultra-smooth Alan Hull Moving Average with minimal lag',
        defaultParams: [16, 55],
    },
    {
        code: 'ICHIMOKU',
        name: 'Ichimoku Cloud',
        pane: 'main',
        category: 'trend',
        description: 'Tenkan-sen (9), Kijun-sen (26), Senkou Span A e Senkou Span B (52)',
        descriptionEn: 'Tenkan-sen (9), Kijun-sen (26), Senkou Span A, and Senkou Span B (52)',
        defaultParams: [9, 26, 52],
    },
    {
        code: 'KELTNER',
        name: 'Keltner Channels',
        pane: 'main',
        category: 'channels',
        description: 'Canais de volatilidade baseados em EMA 20 e ATR 10',
        descriptionEn: 'Volatility envelopes built on 20 EMA and 10 ATR',
        defaultParams: [20, 10, 2],
    },
    {
        code: 'KLINGER',
        name: 'Klinger Oscillator',
        pane: 'sub',
        category: 'volume',
        description: 'Oscilador de fluxo de volume de longo prazo com linha de sinal (34, 55, 13)',
        descriptionEn: 'Long-term volume flow oscillator with signal line (34, 55, 13)',
        defaultParams: [34, 55, 13],
    },
    {
        code: 'KST',
        name: 'Know Sure Thing',
        pane: 'sub',
        category: 'oscillators',
        description: 'Oscilador de momentum de Martin Pring baseado em 4 ciclos de ROC',
        descriptionEn: 'Martin Pring momentum oscillator built across 4 ROC timeframes',
        defaultParams: [10, 15, 20, 30],
    },
    {
        code: 'LSMA',
        name: 'Least Squares Moving Average',
        pane: 'main',
        category: 'trend',
        description: 'Média móvel por regressão linear de mínimos quadrados',
        descriptionEn: 'Least-squares linear regression moving average',
        defaultParams: [25],
    },
    {
        code: 'LINREG_CURVE',
        name: 'Linear Regression Curve',
        pane: 'main',
        category: 'trend',
        description: 'Curva de regressão linear contínua projetada sobre o preço',
        descriptionEn: 'Continuous linear regression curve projected across price',
        defaultParams: [14],
    },
    {
        code: 'LINREG_SLOPE',
        name: 'Linear Regression Slope',
        pane: 'sub',
        category: 'oscillators',
        description: 'Inclinação matemática da reta de regressão linear em N períodos',
        descriptionEn: 'Mathematical slope of the N-period linear regression line',
        defaultParams: [14],
    },
    {
        code: 'MA_CROSS',
        name: 'MA Cross',
        pane: 'main',
        category: 'trend',
        description: 'Cruzamento de duas Médias Móveis Simples (Rápida e Lenta)',
        descriptionEn: 'Crossover of two Simple Moving Averages (Fast and Slow)',
        defaultParams: [9, 21],
    },
    {
        code: 'MA_EMA_CROSS',
        name: 'MA with EMA Cross',
        pane: 'main',
        category: 'trend',
        description: 'Comparação e cruzamento entre SMA e EMA de mesmo período',
        descriptionEn: 'Comparison and crossover between equal-period SMA and EMA',
        defaultParams: [20, 20],
    },
    {
        code: 'MACD',
        name: 'MACD',
        pane: 'sub',
        category: 'oscillators',
        description: 'Moving Average Convergence/Divergence (12, 26, 9)',
        descriptionEn: 'Moving Average Convergence/Divergence (12, 26, 9)',
        defaultParams: [12, 26, 9],
    },
    {
        code: 'MAJORITY_RULE',
        name: 'Majority Rule',
        pane: 'sub',
        category: 'oscillators',
        description: 'Percentual de velas de alta nos últimos N períodos (0 a 100%)',
        descriptionEn: 'Percentage of bullish candles over the last N periods (0–100%)',
        defaultParams: [14],
    },
    {
        code: 'MASS_INDEX',
        name: 'Mass Index',
        pane: 'sub',
        category: 'volume',
        description: 'Identifica reversões por alargamento da amplitude High-Low (Donald Dorsey)',
        descriptionEn: 'Detects reversals from High-Low range expansion (Donald Dorsey)',
        defaultParams: [9, 25],
    },
    {
        code: 'MCGINLEY',
        name: 'McGinley Dynamic',
        pane: 'main',
        category: 'trend',
        description: 'Indicador dinâmico que se auto-ajusta à velocidade do mercado',
        descriptionEn: 'Self-adjusting dynamic moving average tracking market speed',
        defaultParams: [14],
    },
    {
        code: 'MEDIAN_PRICE',
        name: 'Median Price',
        pane: 'main',
        category: 'channels',
        description: 'Ponto médio (High + Low) / 2 com linha suavizada EMA',
        descriptionEn: 'Midpoint (High + Low) / 2 smoothed by an EMA line',
        defaultParams: [14],
    },
    {
        code: 'MTM',
        name: 'Momentum',
        pane: 'sub',
        category: 'oscillators',
        description: 'Diferença absoluta de preço entre a barra atual e N períodos atrás',
        descriptionEn: 'Absolute price delta between current bar and N periods ago',
        defaultParams: [12, 6],
    },
    {
        code: 'MFI',
        name: 'Money Flow Index',
        pane: 'sub',
        category: 'volume',
        description: 'RSI ponderado pelo volume institucional (0 a 100)',
        descriptionEn: 'Volume-weighted RSI measuring institutional flow (0–100)',
        defaultParams: [14],
    },
    {
        code: 'MA',
        name: 'Moving Average',
        pane: 'main',
        category: 'trend',
        description: 'Média Móvel Simples clássica (SMA)',
        descriptionEn: 'Classic Simple Moving Average (SMA)',
        defaultParams: [20, 50, 200],
    },
    {
        code: 'KAMA',
        name: 'Moving Average Adaptive',
        pane: 'main',
        category: 'trend',
        description: 'Média Móvel Adaptativa de Kaufman (KAMA — 10, 2, 30)',
        descriptionEn: "Kaufman's Adaptive Moving Average (KAMA — 10, 2, 30)",
        defaultParams: [10, 2, 30],
    },
    {
        code: 'MA_CHANNEL',
        name: 'Moving Average Channel',
        pane: 'main',
        category: 'channels',
        description: 'Canal formado pelas médias móveis das máximas e das mínimas',
        descriptionEn: 'Envelope channel formed by moving averages of highs and lows',
        defaultParams: [20],
    },
    {
        code: 'MA_DOUBLE',
        name: 'Moving Average Double',
        pane: 'main',
        category: 'trend',
        description: 'Duas Médias Móveis Simples configuráveis no gráfico principal',
        descriptionEn: 'Dual configurable Simple Moving Averages on the main chart',
        defaultParams: [10, 21],
    },
    {
        code: 'EMA',
        name: 'Moving Average Exponential',
        pane: 'main',
        category: 'trend',
        description: 'Média Móvel Exponencial com maior peso nos preços recentes',
        descriptionEn: 'Exponential Moving Average weighting recent price action higher',
        defaultParams: [9, 21, 50],
    },
    {
        code: 'MA_HAMMING',
        name: 'Moving Average Hamming',
        pane: 'main',
        category: 'trend',
        description: 'Média móvel ponderada por janela trigonométrica de Hamming',
        descriptionEn: 'Moving average weighted by a trigonometric Hamming window',
        defaultParams: [14],
    },
    {
        code: 'MA_MULTIPLE',
        name: 'Moving Average Multiple',
        pane: 'main',
        category: 'trend',
        description: 'Conjunto de 6 médias móveis simultâneas (10, 20, 30, 50, 100, 200)',
        descriptionEn: 'Ribbon of 6 simultaneous moving averages (10, 20, 30, 50, 100, 200)',
        defaultParams: [10, 20, 30, 50, 100, 200],
    },
    {
        code: 'MA_TRIPLE',
        name: 'Moving Average Triple',
        pane: 'main',
        category: 'trend',
        description: 'Três médias móveis simples para alinhamento de tendência (9, 21, 55)',
        descriptionEn: 'Three Simple Moving Averages for trend alignment (9, 21, 55)',
        defaultParams: [9, 21, 55],
    },
    {
        code: 'WMA',
        name: 'Moving Average Weighted',
        pane: 'main',
        category: 'trend',
        description: 'Média Móvel Ponderada linearmente (WMA)',
        descriptionEn: 'Linearly Weighted Moving Average (WMA)',
        defaultParams: [20, 50],
    },
    {
        code: 'NET_VOLUME',
        name: 'Net Volume',
        pane: 'sub',
        category: 'volume',
        description: 'Delta líquido de volume positivo (barras de alta) vs. negativo (baixa)',
        descriptionEn: 'Net volume delta separating bullish (up) vs. bearish (down) bars',
        defaultParams: [14],
    },
    {
        code: 'OBV',
        name: 'On Balance Volume',
        pane: 'sub',
        category: 'volume',
        description: 'Fluxo acumulado de volume de Joe Granville',
        descriptionEn: 'Joe Granville cumulative On Balance Volume flow',
        defaultParams: [30],
    },
    {
        code: 'SAR',
        name: 'Parabolic SAR',
        pane: 'main',
        category: 'trend',
        description: 'Stop and Reverse parabólico para trailing stop e tendência',
        descriptionEn: 'Parabolic Stop and Reverse for trend tracking and trailing stops',
        defaultParams: [2, 2, 20],
    },
    {
        code: 'PIVOT_STANDARD',
        name: 'Pivot Points Standard',
        pane: 'main',
        category: 'channels',
        description: 'Níveis clássicos de Pivot (P), Resistência (R1) e Suporte (S1)',
        descriptionEn: 'Classic Pivot Point (P), Resistance (R1), and Support (S1) levels',
        defaultParams: [15],
    },
    {
        code: 'PRICE_CHANNEL',
        name: 'Price Channel',
        pane: 'main',
        category: 'channels',
        description: 'Canal superior e inferior das máximas e mínimas de N barras',
        descriptionEn: 'Upper and lower channel of highs and lows over N bars',
        defaultParams: [20],
    },
    {
        code: 'PPO',
        name: 'Price Oscillator',
        pane: 'sub',
        category: 'oscillators',
        description: 'Percentage Price Oscillator (PPO) com linha de sinal',
        descriptionEn: 'Percentage Price Oscillator (PPO) with signal line',
        defaultParams: [12, 26, 9],
    },
    {
        code: 'PVT',
        name: 'Price Volume Trend',
        pane: 'sub',
        category: 'volume',
        description: 'Tendência acumulada de preço e volume percentual',
        descriptionEn: 'Cumulative percentage price-volume trend line',
    },
    {
        code: 'RCI',
        name: 'Rank Correlation Index',
        pane: 'sub',
        category: 'oscillators',
        description: 'Correlação de postos de Spearman entre preço e tempo (-100 a +100)',
        descriptionEn: 'Spearman rank correlation between price and time (-100 to +100)',
        defaultParams: [9, 26],
    },
    {
        code: 'ROC',
        name: 'Rate Of Change',
        pane: 'sub',
        category: 'oscillators',
        description: 'Taxa de variação percentual do preço em N períodos',
        descriptionEn: 'Percentage price rate of change over N periods',
        defaultParams: [12, 6],
    },
    {
        code: 'RATIO',
        name: 'Ratio',
        pane: 'sub',
        category: 'oscillators',
        description: 'Razão entre o preço de fechamento e sua média móvel',
        descriptionEn: 'Ratio between closing price and its moving average',
        defaultParams: [20],
    },
    {
        code: 'RSI',
        name: 'Relative Strength Index',
        pane: 'sub',
        category: 'oscillators',
        description: 'Índice de Força Relativa de Welles Wilder (14)',
        descriptionEn: 'Welles Wilder Relative Strength Index (14)',
        defaultParams: [14],
    },
    {
        code: 'RVI_VIGOR',
        name: 'Relative Vigor Index',
        pane: 'sub',
        category: 'oscillators',
        description: 'Compara o fechamento em relação à abertura com a amplitude total da barra',
        descriptionEn: 'Compares close-to-open conviction against full bar range',
        defaultParams: [10],
    },
    {
        code: 'RVI_VOL',
        name: 'Relative Volatility Index',
        pane: 'sub',
        category: 'volume',
        description: 'RSI calculado sobre o desvio padrão para medir direção da volatilidade',
        descriptionEn: 'RSI computed over standard deviation to gauge volatility direction',
        defaultParams: [14],
    },
    {
        code: 'SMI_ERGODIC',
        name: 'SMI Ergodic Indicator/Oscillator',
        pane: 'sub',
        category: 'oscillators',
        description: 'Indicador e histograma Ergodic SMI com suavização dupla EMA',
        descriptionEn: 'Double-EMA smoothed Ergodic SMI line and histogram',
        defaultParams: [5, 20, 5],
    },
    {
        code: 'SMMA',
        name: 'Smoothed Moving Average',
        pane: 'main',
        category: 'trend',
        description: 'Média Móvel Suavizada (Wilder SMMA / RMA)',
        descriptionEn: 'Smoothed Moving Average (Wilder SMMA / RMA)',
        defaultParams: [14, 50],
    },
    {
        code: 'SPREAD',
        name: 'Spread',
        pane: 'sub',
        category: 'volume',
        description: 'Amplitude intrabarra (High - Low) comparada à sua média',
        descriptionEn: 'Intrabar range (High - Low) relative to its moving average',
        defaultParams: [14],
    },
    {
        code: 'STDDEV',
        name: 'Standard Deviation',
        pane: 'sub',
        category: 'volume',
        description: 'Desvio padrão estatístico dos preços de fechamento',
        descriptionEn: 'Statistical standard deviation of closing prices',
        defaultParams: [20],
    },
    {
        code: 'STDERR',
        name: 'Standard Error',
        pane: 'sub',
        category: 'volume',
        description: 'Erro padrão da regressão linear em N períodos',
        descriptionEn: 'Standard error of linear regression over N periods',
        defaultParams: [20],
    },
    {
        code: 'STDERR_BANDS',
        name: 'Standard Error Bands',
        pane: 'main',
        category: 'channels',
        description: 'Bandas de Erro Padrão de Jon Andersen ao redor da regressão linear',
        descriptionEn: 'Jon Andersen Standard Error Bands plotted around linear regression',
        defaultParams: [21, 2],
    },
    {
        code: 'KDJ',
        name: 'Stochastic',
        pane: 'sub',
        category: 'oscillators',
        description: 'Oscilador Estocástico %K, %D e %J (9, 3, 3)',
        descriptionEn: 'Stochastic %K, %D, and %J Oscillator (9, 3, 3)',
        defaultParams: [9, 3, 3],
    },
    {
        code: 'STOCH_RSI',
        name: 'Stochastic RSI',
        pane: 'sub',
        category: 'oscillators',
        description: 'Estocástico aplicado aos valores do RSI (14, 14, 3, 3)',
        descriptionEn: 'Stochastic oscillator applied to RSI values (14, 14, 3, 3)',
        defaultParams: [14, 14, 3, 3],
    },
    {
        code: 'SUPERTREND',
        name: 'SuperTrend',
        pane: 'main',
        category: 'trend',
        description: 'Rastreador dinâmico de tendência e trailing stop baseado em ATR',
        descriptionEn: 'ATR-based dynamic trend follower and trailing stop overlay',
        defaultParams: [10, 3],
    },
    {
        code: 'TRADING_SESSIONS',
        name: 'Trading Sessions',
        pane: 'main',
        category: 'channels',
        description: 'Máximas e mínimas automáticas das sessões Asiática, Londres e Nova Iorque',
        descriptionEn: 'Automatic Asia, London, and New York session highs and lows',
        defaultParams: [8, 13, 21],
    },
    {
        code: 'TRADING_SESSIONS_BG',
        name: 'Trading Sessions Background',
        pane: 'sub',
        category: 'volume',
        description: 'Identificador visual de sessão ativa (1=Ásia, 2=Londres, 3=NY Overlap)',
        descriptionEn: 'Active trading session detector (1=Asia, 2=London, 3=NY Overlap)',
        defaultParams: [8, 13, 21],
    },
    {
        code: 'TSI_TREND',
        name: 'Trend Strength Index',
        pane: 'sub',
        category: 'trend',
        description: 'Força da tendência normalizada pelo ATR na janela de N barras',
        descriptionEn: 'ATR-normalized trend strength over an N-bar lookback window',
        defaultParams: [14],
    },
    {
        code: 'TEMA',
        name: 'Triple EMA',
        pane: 'main',
        category: 'trend',
        description: 'Média Móvel Exponencial Tripla (TEMA) de Patrick Mulloy',
        descriptionEn: 'Patrick Mulloy Triple Exponential Moving Average (TEMA)',
        defaultParams: [20],
    },
    {
        code: 'TRIX',
        name: 'TRIX',
        pane: 'sub',
        category: 'oscillators',
        description: 'Taxa de variação percentual de uma média exponencial tripla',
        descriptionEn: 'Percentage rate of change of a triple-smoothed EMA',
        defaultParams: [12, 9],
    },
    {
        code: 'TSI',
        name: 'True Strength Index',
        pane: 'sub',
        category: 'oscillators',
        description: 'Oscilador de força verdadeira com suavização dupla (25, 13, 7)',
        descriptionEn: 'Double-smoothed True Strength momentum oscillator (25, 13, 7)',
        defaultParams: [25, 13, 7],
    },
    {
        code: 'TYPICAL_PRICE',
        name: 'Typical Price',
        pane: 'main',
        category: 'channels',
        description: 'Preço Típico (High + Low + Close) / 3 com média suavizada',
        descriptionEn: 'Typical Price (High + Low + Close) / 3 with smoothed average',
        defaultParams: [14],
    },
    {
        code: 'ULTIMATE_OSC',
        name: 'Ultimate Oscillator',
        pane: 'sub',
        category: 'oscillators',
        description: 'Oscilador de Larry Williams combinando 3 janelas temporais (7, 14, 28)',
        descriptionEn: 'Larry Williams oscillator combining 3 lookback windows (7, 14, 28)',
        defaultParams: [7, 14, 28],
    },
    {
        code: 'VOL_C2C',
        name: 'Volatility Close-to-Close',
        pane: 'sub',
        category: 'volume',
        description: 'Volatilidade anualizada baseada na variação fechamento a fechamento',
        descriptionEn: 'Annualized volatility calculated from close-to-close returns',
        defaultParams: [20],
    },
    {
        code: 'VOL_INDEX',
        name: 'Volatility Index',
        pane: 'sub',
        category: 'volume',
        description: 'Índice sintético de volatilidade percentual implícita/realizada',
        descriptionEn: 'Synthetic implied/realized percentage volatility index',
        defaultParams: [14],
    },
    {
        code: 'VOL_OHLC',
        name: 'Volatility O-H-L-C',
        pane: 'sub',
        category: 'volume',
        description: 'Estimador de volatilidade Garman-Klass usando Open, High, Low e Close',
        descriptionEn: 'Garman-Klass volatility estimator using Open, High, Low, and Close',
        defaultParams: [20],
    },
    {
        code: 'VOL_ZERO_TREND',
        name: 'Volatility Zero Trend Close-to-Close',
        pane: 'sub',
        category: 'volume',
        description: 'Volatilidade Close-to-Close assumindo tendência zero (drift = 0)',
        descriptionEn: 'Close-to-Close volatility estimator assuming zero drift',
        defaultParams: [20],
    },
    {
        code: 'VOL',
        name: 'Volume',
        pane: 'sub',
        category: 'volume',
        description: 'Volume financeiro/contratos negociados com médias móveis (5, 10, 20)',
        descriptionEn: 'Traded tick/contract volume with moving averages (5, 10, 20)',
        defaultParams: [5, 10, 20],
    },
    {
        code: 'VOL_OSC',
        name: 'Volume Oscillator',
        pane: 'sub',
        category: 'volume',
        description: 'Diferença percentual entre duas EMAs de volume (5, 10)',
        descriptionEn: 'Percentage spread between fast and slow volume EMAs (5, 10)',
        defaultParams: [5, 10],
    },
    {
        code: 'VPFR',
        name: 'Volume Profile Fixed Range',
        pane: 'main',
        category: 'volume',
        description: 'Níveis de POC, VAH (+1σ) e VAL (-1σ) ponderados por volume em janela fixa',
        descriptionEn: 'Volume-weighted POC, VAH (+1σ), and VAL (-1σ) across a fixed range',
        defaultParams: [50],
    },
    {
        code: 'VPVR',
        name: 'Volume Profile Visible Range',
        pane: 'main',
        category: 'volume',
        description: 'POC, VAH e VAL dinâmicos do perfil de volume visível (100 barras)',
        descriptionEn: 'Dynamic visible-range Volume Profile POC, VAH, and VAL (100 bars)',
        defaultParams: [100],
    },
    {
        code: 'VORTEX',
        name: 'Vortex Indicator',
        pane: 'sub',
        category: 'trend',
        description: 'Linhas VI+ e VI- para detectar início e reversão de tendências (14)',
        descriptionEn: 'VI+ and VI- lines detecting trend initiation and reversals (14)',
        defaultParams: [14],
    },
    {
        code: 'VWAP',
        name: 'VWAP',
        pane: 'main',
        category: 'channels',
        description: 'Volume Weighted Average Price institucional com bandas de desvio padrão',
        descriptionEn: 'Institutional Volume Weighted Average Price with std-dev bands',
        defaultParams: [20, 1.5],
    },
    {
        code: 'VWMA',
        name: 'VWMA',
        pane: 'main',
        category: 'volume',
        description: 'Volume Weighted Moving Average (Média Móvel Ponderada por Volume)',
        descriptionEn: 'Volume Weighted Moving Average',
        defaultParams: [20, 50],
    },
    {
        code: 'WR',
        name: 'Williams %R',
        pane: 'sub',
        category: 'oscillators',
        description: 'Oscilador de momento de Larry Williams (0 a -100)',
        descriptionEn: 'Larry Williams %R overbought/oversold momentum oscillator (0 to -100)',
        defaultParams: [14],
    },
    {
        code: 'ALLIGATOR',
        name: 'Williams Alligator',
        pane: 'main',
        category: 'trend',
        description: 'Mandíbula (13), Dentes (8) e Lábios (5) de Bill Williams',
        descriptionEn: 'Bill Williams Alligator Jaw (13), Teeth (8), and Lips (5)',
        defaultParams: [13, 8, 5],
    },
    {
        code: 'FRACTAL',
        name: 'Williams Fractal',
        pane: 'main',
        category: 'channels',
        description: 'Níveis de topo e fundo fractais de Bill Williams para liquidez e rompimento',
        descriptionEn: 'Bill Williams fractal swing highs/lows for liquidity and breakouts',
        defaultParams: [2],
    },
    {
        code: 'ZIGZAG',
        name: 'Zig Zag',
        pane: 'main',
        category: 'trend',
        description: 'Rastreia pivots significativos de Swing High e Swing Low filtrando ruído',
        descriptionEn: 'Tracks significant Swing High/Low pivots while filtering noise',
        defaultParams: [5, 10],
    },
    {
        code: 'TV_SESSION_KILLZONES',
        name: 'Killzones de Sessão (Ásia / Londres / NY)',
        nameEn: 'Session Killzones (Asia / London / NY)',
        pane: 'main',
        category: 'channels',
        description: 'Sombreamento institucional automático das sessões de Ásia, Londres, Overlap LDN·NY e Nova Iorque em gráficos intraday',
        descriptionEn: 'Automatic institutional shading for Asia, London, LDN·NY Overlap, and New York sessions on intraday charts',
        defaultParams: [],
    },
];
