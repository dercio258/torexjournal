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
    status: 'PENDING' | 'OPEN' | 'WIN' | 'LOSS' | 'CLOSED';
    exitPrice?: number;
    pnl: number;
    openedAt: number;
    closedAt?: number;
}

export const TIMEFRAMES: Period[] = [
    { multiplier: 1, timespan: 'minute', text: '1m' },
    { multiplier: 5, timespan: 'minute', text: '5m' },
    { multiplier: 15, timespan: 'minute', text: '15m' },
    { multiplier: 1, timespan: 'hour', text: '1h' },
    { multiplier: 4, timespan: 'hour', text: '4h' },
    { multiplier: 1, timespan: 'day', text: 'D' },
];

export const AVAILABLE_INDICATORS = [
    { code: 'EMA', name: 'EMA (Média Móvel Exponencial)', pane: 'main' },
    { code: 'MA', name: 'MA (Média Móvel Simples)', pane: 'main' },
    { code: 'BOLL', name: 'BOLL (Bandas de Bollinger)', pane: 'main' },
    { code: 'SAR', name: 'SAR (Stop and Reverse)', pane: 'main' },
    { code: 'RSI', name: 'RSI (Índice de Força Relativa)', pane: 'sub' },
    { code: 'MACD', name: 'MACD (Convergência/Divergência)', pane: 'sub' },
    { code: 'KDJ', name: 'KDJ (Estocástico)', pane: 'sub' },
    { code: 'CCI', name: 'CCI (Commodity Channel Index)', pane: 'sub' },
];
