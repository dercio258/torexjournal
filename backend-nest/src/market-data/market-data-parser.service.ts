import { Injectable, Logger } from '@nestjs/common';

export interface Candle {
    time: number; // Unix timestamp in seconds
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

@Injectable()
export class MarketDataParserService {
    private readonly logger = new Logger(MarketDataParserService.name);

    /**
     * Parse MT5 OHLC CSV content
     * Format: Date Time, Open, High, Low, Close, TickVol, Vol, Spread
     * Example: 2011.01.03 00:00,1418.65000,1418.70000,1416.10000,1416.95000,350,0
     */
    parseMt5Csv(content: string): Candle[] {
        this.logger.log('Parsing MT5 OHLC CSV...');
        const candles: Candle[] = [];
        const lines = content.split('\n');

        for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine) continue;

            // MT5 CSV columns: Time, Open, High, Low, Close, TickVol, Vol, Spread
            const cols = cleanLine.split(',').map(c => c.trim());
            
            // Validate at least 5 columns (Time, O, H, L, C)
            if (cols.length < 5) continue;

            const timeStr = cols[0];
            const open = parseFloat(cols[1]);
            const high = parseFloat(cols[2]);
            const low = parseFloat(cols[3]);
            const close = parseFloat(cols[4]);
            const volume = parseFloat(cols[5]) || 0;

            if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
                this.logger.warn(`Skipping invalid OHLC row: ${cleanLine}`);
                continue;
            }

            const timestamp = this.parseMt5Date(timeStr);
            if (!timestamp) {
                this.logger.warn(`Skipping row with invalid date: ${timeStr}`);
                continue;
            }

            candles.push({
                time: timestamp,
                open,
                high,
                low,
                close,
                volume
            });
        }

        this.logger.log(`Successfully parsed ${candles.length} candles from CSV.`);
        return candles;
    }

    /**
     * Converts MT5 date string (YYYY.MM.DD HH:mm) to Unix Timestamp (seconds)
     */
    private parseMt5Date(dateStr: string): number | null {
        try {
            // MT5 format is usually YYYY.MM.DD HH:mm or YYYY.MM.DD HH:mm:ss
            const cleanDate = dateStr.replace(/\./g, '-');
            const date = new Date(cleanDate);
            
            if (isNaN(date.getTime())) return null;
            
            // Return Unix timestamp in seconds
            return Math.floor(date.getTime() / 1000);
        } catch (e) {
            return null;
        }
    }
}
