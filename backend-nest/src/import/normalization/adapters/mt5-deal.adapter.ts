import { ITradeAdapter } from '../trade-adapter.interface';
import { NormalizedTradeDto } from '../normalized-trade.dto';

export class Mt5DealAdapter implements ITradeAdapter {
    normalize(rawData: any): NormalizedTradeDto | null {
        if (!rawData || (!rawData.ticket && !rawData.contractId && !rawData.positionId)) {
            return null;
        }

        const ticket = (rawData.ticket || rawData.positionId || rawData.contractId).toString();
        const contractId = (rawData.contractId || rawData.positionId || ticket).toString();

        const openTime = this.safeDate(rawData.openTime || rawData.open_time);
        const closeTime = this.safeDate(rawData.closeTime || rawData.close_time);
        const effectiveOpenTime = openTime || closeTime;

        if (!effectiveOpenTime) {
            return null;
        }

        const hasExactOpenAndClose = Boolean(openTime && (rawData.status === 'OPEN' || closeTime));
        const profit = Number(rawData.profit) || 0;
        const commission = Number(rawData.commission) || 0;
        const swap = Number(rawData.swap) || 0;
        const netPnl = rawData.netPnl !== undefined
            ? Number(rawData.netPnl)
            : profit + commission + swap;

        const slVal = rawData.sl !== undefined && rawData.sl !== null && Number(rawData.sl) > 0
            ? Number(rawData.sl)
            : undefined;
        const tpVal = rawData.tp !== undefined && rawData.tp !== null && Number(rawData.tp) > 0
            ? Number(rawData.tp)
            : undefined;

        return {
            ticket,
            contractId,
            symbol: rawData.symbol || 'Unknown',
            type: (rawData.type || 'BUY').toString().toUpperCase().includes('SELL') ? 'SELL' : 'BUY',
            volume: Number(rawData.volume) || 0,
            openPrice: Number(rawData.openPrice ?? rawData.open_price) || 0,
            closePrice: Number(rawData.closePrice ?? rawData.close_price) || 0,
            profit,
            commission,
            swap,
            netPnl,
            sl: slVal,
            tp: tpVal,
            openTime: effectiveOpenTime,
            closeTime: closeTime || undefined,
            status: rawData.status || (closeTime ? 'CLOSED' : 'OPEN'),
            magic: Number(rawData.magic) || 0,
            comment: rawData.comment || '',
            session: this.calculateSession(effectiveOpenTime),
            dataQuality: rawData.dataQuality || (hasExactOpenAndClose ? 'ok' : 'partial'),
            raw: rawData,
        };
    }

    private safeDate(dateInput: any): Date | null {
        if (!dateInput) return null;
        const timestamp = typeof dateInput === 'number' && dateInput < 10000000000 ? dateInput * 1000 : dateInput;
        const date = new Date(timestamp);
        return isNaN(date.getTime()) ? null : date;
    }

    private calculateSession(date: Date): string {
        const hour = date.getUTCHours();
        const sessions: string[] = [];
        if (hour >= 22 || hour < 7) sessions.push('Sydney');
        if (hour >= 0 && hour < 9) sessions.push('Tokyo');
        if (hour >= 8 && hour < 17) sessions.push('London');
        if (hour >= 13 && hour < 22) sessions.push('New York');

        return sessions.join(' / ') || 'Off-Session';
    }
}
