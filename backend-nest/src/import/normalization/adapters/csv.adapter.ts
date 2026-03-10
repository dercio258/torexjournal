import { ITradeAdapter } from '../trade-adapter.interface';
import { NormalizedTradeDto } from '../normalized-trade.dto';

export class CsvAdapter implements ITradeAdapter {

    normalize(rawData: any): NormalizedTradeDto | null {
        if (!rawData || (!rawData.ticket && !rawData.order)) return null;

        const ticket = (rawData.ticket || rawData.order || rawData.id || `csv_${Date.now()}_${Math.random()}`).toString();
        const openTime = this.safeDate(rawData.openTime || rawData.open_time || rawData.time);

        if (!openTime) return null;

        const closeTime = this.safeDate(rawData.closeTime || rawData.close_time);

        return {
            ticket: ticket,
            symbol: rawData.symbol || 'Unknown',
            type: rawData.type || 'Buy',
            volume: parseFloat(rawData.volume || rawData.size) || 0,
            openPrice: parseFloat(rawData.openPrice || rawData.open_price || rawData.price) || 0,
            closePrice: parseFloat(rawData.closePrice || rawData.close_price) || 0,
            profit: parseFloat(rawData.profit) || 0,
            commission: parseFloat(rawData.commission) || 0,
            swap: parseFloat(rawData.swap) || 0,
            openTime: openTime,
            closeTime: closeTime,
            status: closeTime ? 'CLOSED' : 'OPEN',
            comment: rawData.comment || 'Imported via CSV/HTML',
            session: this.calculateSession(openTime),
            raw: rawData
        };
    }

    private safeDate(dateInput: any): Date | null {
        if (!dateInput) return null;
        let date = new Date(dateInput);
        if (isNaN(date.getTime()) && typeof dateInput === 'string') {
            // Attempt to fix common CSV format 'YYYY.MM.DD HH:mm:ss'
            const dotted = dateInput.replace(/\./g, '-');
            date = new Date(dotted);
        }
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
