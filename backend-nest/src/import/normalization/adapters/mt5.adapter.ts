import { ITradeAdapter } from '../trade-adapter.interface';
import { NormalizedTradeDto } from '../normalized-trade.dto';

export class Mt5Adapter implements ITradeAdapter {

    normalize(rawData: any): NormalizedTradeDto | null {
        if (!rawData || !rawData.ticket) return null;

        const openTime = this.safeDate(rawData.openTime || rawData.open_time);
        if (!openTime) return null; // A valid trade must have an open time

        const closeTime = this.safeDate(rawData.closeTime || rawData.close_time);

        return {
            ticket: rawData.ticket.toString(),
            contractId: rawData.ticket.toString(),
            symbol: rawData.symbol || 'Unknown',
            type: rawData.type || 'Buy',
            volume: parseFloat(rawData.volume) || 0,
            openPrice: parseFloat(rawData.openPrice || rawData.open_price) || 0,
            closePrice: parseFloat(rawData.closePrice || rawData.close_price) || 0,
            profit: parseFloat(rawData.profit) || 0,
            commission: parseFloat(rawData.commission) || 0,
            swap: parseFloat(rawData.swap) || 0,
            sl: parseFloat(rawData.sl || rawData.stop_loss) || 0,
            tp: parseFloat(rawData.tp || rawData.take_profit) || 0,
            openTime: openTime,
            closeTime: closeTime,
            status: closeTime ? 'CLOSED' : 'OPEN',
            magic: rawData.magic || 0,
            comment: rawData.comment || '',
            session: this.calculateSession(openTime),
            raw: rawData
        };
    }

    private safeDate(dateInput: any): Date | null {
        if (!dateInput) return null;
        // Handle numeric timestamps (seconds from MQL5)
        const timestamp = typeof dateInput === 'number' && dateInput < 10000000000 ? dateInput * 1000 : dateInput;
        const date = new Date(timestamp);
        return isNaN(date.getTime()) ? null : date;
    }

    private calculateSession(date: Date): string {
        const hour = date.getUTCHours();
        const sessions = [];
        if (hour >= 22 || hour < 7) sessions.push('Sydney');
        if (hour >= 0 && hour < 9) sessions.push('Tokyo');
        if (hour >= 8 && hour < 17) sessions.push('London');
        if (hour >= 13 && hour < 22) sessions.push('New York');

        return sessions.join(' / ') || 'Off-Session';
    }
}
