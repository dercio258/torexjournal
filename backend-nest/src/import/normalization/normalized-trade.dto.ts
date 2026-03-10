export class NormalizedTradeDto {
    ticket: string;
    contractId?: string; // Deriv contract_id or MT5 ticket
    buyTransactionId?: string;
    sellTransactionId?: string;
    symbol: string;
    type: string; // E.g., 'Buy', 'Sell', etc.
    volume: number;
    openPrice: number;
    closePrice: number;
    profit: number;
    commission?: number;
    swap?: number;
    grossResult?: number;
    netPnl?: number;
    currency?: string;
    openTime: Date;
    closeTime?: Date;
    status: string; // 'OPEN' or 'CLOSED'
    magic?: number;
    comment?: string;
    session?: string;

    // Additional generic fields for quality tracing
    qualityFlags?: any;
    dataQuality?: 'ok' | 'partial' | 'broken';
    syntheticTxid?: boolean;

    // Optional broker specific original data for debugging
    raw?: any;
}
