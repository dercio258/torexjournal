import { NormalizedTradeDto } from './normalized-trade.dto';

export interface ITradeAdapter {
    /**
     * Normalizes a single broker-specific trade payload into a standard NormalizedTradeDto.
     * @param rawData The raw trade data from MT5, Deriv, CSV, etc.
     */
    normalize(rawData: any): NormalizedTradeDto | null;

    /**
     * Optional method to pre-process a batch of raw trades before mapping.
     */
    preprocessBatch?(rawDataArray: any[]): any[];
}
