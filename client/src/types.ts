export interface Trade {
    ticket: number;
    symbol: string;
    type: string;
    contract_type?: string;
    volume: number;
    open_price: number;
    close_price: number;
    open_time: string;
    close_time: string;
    sell_time?: number; // legacy format support
    profit: number;
    commission: number;
    swap: number;
    magic: number;
    comment: string;
    shortcode?: string;
    session?: string;
    mood?: string;
    rating?: number;
    setup?: string;
    lesson?: string;
    tags?: string[];
}

export interface DashboardStats {
    totalPnL: number;
    winRate: number;
    totalTrades: number;
    totalWins: number;
    totalLosses: number;
    profitFactor: number;
    radarMetrics: {
        consistency: number;
        riskManagement: number;
        discipline: number;
        profitability: number;
        winRate: number;
    };
    dailyPnL: Array<{ date: string, pnl: number }>;
    accountHealth?: {
        balance: number;
        equity: number;
        margin: number;
        marginFree: number;
        marginLevel: number;
        leverage: number;
    };
    byMood?: Array<{ mood: string; count: number; pnl: number }>;
    bySetup?: Array<{ setup: string; count: number; pnl: number }>;
}
