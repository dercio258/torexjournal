import { ITradeAdapter } from '../trade-adapter.interface';
import { NormalizedTradeDto } from '../normalized-trade.dto';

export class DerivAdapter implements ITradeAdapter {

    normalize(rawData: any): NormalizedTradeDto | null {
        if (!rawData) return null;

        // Deriv payloads can be from 'proposal_open_contract' or 'transaction' (statement)
        const contractDetails = rawData;
        const contractId = (contractDetails.contract_id || contractDetails.transaction_id)?.toString();

        if (!contractId) return null;

        const symbol = this.extractSymbol(contractDetails);
        const openTime = this.safeDate(contractDetails.purchase_time || contractDetails.transaction_time);

        if (!openTime) return null;

        const closeTime = this.safeDate(contractDetails.sell_time);
        const buyAmount = Math.abs(parseFloat(contractDetails.buy_price || contractDetails.amount || 0));

        let netPnl = 0;
        let totalPayout = parseFloat(contractDetails.payout || contractDetails.sell_price || 0);

        if (contractDetails.profit !== undefined) {
            netPnl = parseFloat(contractDetails.profit);
        } else if (contractDetails.is_sold === 1 || contractDetails.action_type === 'sell') {
            netPnl = totalPayout - buyAmount;
        } else {
            // Estimate floating P&L using current bid
            const currentPrice = parseFloat(contractDetails.bid_price) || 0;
            if (currentPrice > 0 && buyAmount > 0) {
                netPnl = currentPrice - buyAmount;
            }
        }

        const entryPrice = parseFloat(
            contractDetails.entry_spot ||
            contractDetails.entry_tick ||
            contractDetails.barrier ||
            contractDetails.buy_price
        ) || 0;

        const exitPrice = parseFloat(
            contractDetails.exit_spot ||
            contractDetails.exit_tick ||
            contractDetails.sell_spot ||
            contractDetails.sell_price
        ) || 0;

        const isClosed = contractDetails.is_sold === 1 || contractDetails.status?.toUpperCase() === 'CLOSED' || contractDetails.action_type === 'sell';

        // Check for Deriv quality issues (e.g., missing sell date on a closed trade)
        const flags: any = {};
        if (isClosed && !closeTime) flags.missing_close_time = true;

        let quality: 'ok' | 'partial' | 'broken' = 'ok';
        if (Object.keys(flags).length >= 2) quality = 'broken';
        else if (Object.keys(flags).length === 1) quality = 'partial';

        return {
            ticket: contractId, // Use contractId as primary ticket for Deriv
            contractId: contractId,
            symbol: symbol,
            type: (contractDetails.contract_type?.includes('PUT') || contractDetails.shortcode?.includes('PUT')) ? 'Sell' : 'Buy',
            volume: buyAmount, // Treat the stake/buy price as volume for Deriv
            openPrice: entryPrice,
            closePrice: exitPrice,
            profit: netPnl,
            commission: 0, // Deriv bakes commission into the payout usually
            swap: 0,
            openTime: openTime,
            closeTime: closeTime,
            status: isClosed ? 'CLOSED' : 'OPEN',
            comment: contractDetails.longcode || contractDetails.shortcode || '',
            session: this.calculateSession(openTime),
            qualityFlags: flags,
            dataQuality: quality,
            buyTransactionId: contractDetails.transaction_ids?.buy ? `buy_${contractDetails.transaction_ids.buy}` : undefined,
            sellTransactionId: contractDetails.transaction_ids?.sell ? `sell_${contractDetails.transaction_ids.sell}` : undefined,
            raw: rawData
        };
    }

    private extractSymbol(t: any): string {
        if (t.underlying) return t.underlying.toUpperCase();
        if (t.underlying_symbol) return t.underlying_symbol.toUpperCase();

        const shortcode = t.shortcode || '';
        if (shortcode) {
            const prefixes = ['CALL_', 'PUT_', 'MULT_', 'VAN_', 'ONETOUCH_', 'NOTOUCH_', 'RANGE_', 'UPORDOWN_', 'EXPIRYRANGE_', 'EXPIRYMISS_'];
            let cleanCode = shortcode;
            for (const p of prefixes) {
                if (cleanCode.startsWith(p)) {
                    cleanCode = cleanCode.substring(p.length);
                    break;
                }
            }
            if (cleanCode.startsWith('FRX')) cleanCode = cleanCode.substring(3);
            const parts = cleanCode.split('_');
            const symbol = parts[0];
            if (symbol === 'R' && parts.length > 1 && !isNaN(parseInt(parts[1]))) return `R_${parts[1]}`;
            if (symbol) return symbol.toUpperCase();
        }

        if (t.display_name) return t.display_name;

        // Fallback to parsing longcode
        const longcode = t.longcode || '';
        if (longcode) {
            const match = longcode.match(/if (.*?) is/i);
            if (match && match[1]) return match[1].trim();
        }

        return 'Unknown';
    }

    private safeDate(dateInput: any): Date | null {
        if (!dateInput) return null;
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
