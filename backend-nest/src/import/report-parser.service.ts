import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ReportParserService {
    private readonly logger = new Logger(ReportParserService.name);

    parseHtml(content: string): any[] {
        this.logger.log('Parsing HTML Report...');
        const trades = [];

        // Basic parser for Standard MT4/MT5 HTML Reports
        // Usually contains a table with headers: Ticket, Open Time, Type, Size, Item, Price, S / L, T / P, Close Time, Price, Commission, Taxes, Swap, Profit

        // Find the table rows
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let match;

        while ((match = rowRegex.exec(content)) !== null) {
            const rowContent = match[1];

            const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
            const cells = [];
            let cellMatch;
            while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
                // Strip tags
                let cellText = cellMatch[1].replace(/<[^>]+>/g, '').trim();
                cells.push(cellText);
            }

            if (cells.length >= 13) {
                const ticket = parseInt(cells[0]);
                if (!isNaN(ticket)) {
                    const parseDate = (dateStr: string) => {
                        if (!dateStr) return new Date();
                        return new Date(dateStr.replace(/\./g, '-'));
                    };

                    trades.push({
                        ticket: ticket,
                        open_time: parseDate(cells[1]),
                        type: cells[2],
                        volume: parseFloat(cells[3]),
                        symbol: cells[4],
                        open_price: parseFloat(cells[5]),
                        close_time: parseDate(cells[8]),
                        close_price: parseFloat(cells[9]),
                        commission: parseFloat(cells[10]),
                        swap: parseFloat(cells[12]),
                        profit: parseFloat(cells[13]),
                        comment: 'Imported HTML'
                    });
                }
            }
        }

        return trades;
    }

    private isValidDate(dateStr: string): boolean {
        const d = new Date(dateStr);
        return !isNaN(d.getTime());
    }

    private normalizeDate(dateStr: string): Date | null {
        if (!dateStr || dateStr.trim() === '') return null;
        let cleanStr = dateStr.replace(/\./g, '-');
        const d = new Date(cleanStr);
        return isNaN(d.getTime()) ? null : d;
    }

    parseCsv(content: string): any[] {
        this.logger.log('Parsing CSV Report...');

        // 1. Detect Journal Log (tradinglog format)
        if (content.includes('ticket_id,message,event_type')) {
            return this.parseJournalLog(content);
        }

        // 2. Detect History Format (standard CSV export)
        if (content.includes('ticket,opening_time_utc,closing_time_utc')) {
            return this.parseHistoryCsv(content);
        }

        // 3. Fallback: Generic MT4/MT5 CSV Report
        const trades = [];
        const lines = content.split('\n');

        for (const line of lines) {
            // Remove quotes and carriage returns
            const cleanLine = line.replace(/"/g, '').replace(/\r/g, '').trim();
            if (!cleanLine) continue;

            const cols = cleanLine.split(/[;,]/).map(c => c.trim());

            // Skip lines that don't look like data rows
            if (cols.length < 10) continue;

            const ticket = parseInt(cols[0]);

            if (!isNaN(ticket) && ticket > 0) {
                const openTime = this.normalizeDate(cols[1]);

                if (!openTime) {
                    this.logger.warn(`Skipping row due to invalid Open Time: ${line}`);
                    continue;
                }

                const closeTime = this.normalizeDate(cols[8]);

                const typeStr = cols[2].toLowerCase();
                const validTypes = ['buy', 'sell', 'buy limit', 'sell limit', 'buy stop', 'sell stop', 'balance', 'credit', 'correction'];

                if (!validTypes.includes(typeStr)) {
                    this.logger.warn(`Skipping row due to unknown Type: ${cols[2]}`);
                    continue;
                }

                trades.push({
                    ticket: ticket,
                    open_time: openTime,
                    type: typeStr,
                    volume: parseFloat(cols[3]) || 0,
                    symbol: cols[4],
                    open_price: parseFloat(cols[5]) || 0,
                    close_time: closeTime, // Can be null for open trades
                    close_price: parseFloat(cols[9]) || 0,
                    commission: parseFloat(cols[10]) || 0,
                    swap: parseFloat(cols[12]) || 0,
                    profit: parseFloat(cols[13]) || 0,
                    magic: 0,
                    comment: 'Imported via CSV'
                });
            }
        }

        this.logger.log(`Parsed ${trades.length} valid trades from CSV.`);
        return trades;
    }

    private parseJournalLog(content: string): any[] {
        this.logger.log('Detected Journal Log format. Parsing...');
        const lines = content.split('\n');
        const tradeMap = new Map<number, any>();

        const msgRegex = /success (open|close) (buy|sell) ([0-9.]+) lots ([A-Za-z0-9_]+) at ([0-9.]+)/i;

        for (const line of lines) {
            const cols = line.split(',');
            if (cols.length < 5) continue;

            const ticketId = parseInt(cols[3]);
            if (isNaN(ticketId)) continue;

            const serverTime = this.normalizeDate(cols[1]);
            const message = cols[4];

            if (!message) continue;

            const match = msgRegex.exec(message);
            if (match) {
                const action = match[1].toLowerCase();
                const type = match[2].toLowerCase();
                const volume = parseFloat(match[3]);
                const symbol = match[4];
                const price = parseFloat(match[5]);

                if (!tradeMap.has(ticketId)) {
                    tradeMap.set(ticketId, {
                        ticket: ticketId,
                        symbol: symbol,
                        type: type, // defaults to last seen type
                        volume: volume,
                        comment: 'Imported via Journal Log',
                        profit: 0,
                        commission: 0,
                        swap: 0,
                        magic: 0
                    });
                }

                const trade = tradeMap.get(ticketId);

                if (action === 'open') {
                    trade.open_time = serverTime;
                    trade.open_price = price;
                    trade.type = type;
                } else if (action === 'close') {
                    trade.close_time = serverTime;
                    trade.close_price = price;
                }
            }
        }

        const allTrades = Array.from(tradeMap.values());
        this.logger.log(`Parsed ${allTrades.length} unique tickets from Journal Log.`);

        return allTrades.filter(t => t.open_time);
    }

    private parseHistoryCsv(content: string): any[] {
        this.logger.log('Detected History CSV format. Parsing...');
        const lines = content.split('\n');
        const trades = [];

        // Skip header
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cols = line.split(',');
            if (cols.length < 10) continue;

            // ticket,opening_time_utc,closing_time_utc,type,lots,original_position_size,symbol,opening_price,closing_price,stop_loss,take_profit,commission_usd,swap_usd,profit_usd...

            const ticket = parseInt(cols[0]);
            if (isNaN(ticket)) continue;

            // Dates are in ISO format: 2026-02-17T10:19:47.767000
            const openTime = new Date(cols[1]);
            const closeTime = cols[2] ? new Date(cols[2]) : null;

            trades.push({
                ticket: ticket,
                open_time: openTime,
                close_time: closeTime,
                type: cols[3].toLowerCase(),
                volume: parseFloat(cols[4]),
                symbol: cols[6],
                open_price: parseFloat(cols[7]),
                close_price: parseFloat(cols[8]),
                commission: parseFloat(cols[11]) || 0, // commission_usd
                swap: parseFloat(cols[12]) || 0, // swap_usd
                profit: parseFloat(cols[13]) || 0, // profit_usd
                comment: 'Imported via History CSV',
                magic: 0
            });
        }

        this.logger.log(`Parsed ${trades.length} trades from History CSV.`);
        return trades;
    }
}
