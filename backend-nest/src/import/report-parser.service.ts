import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ReportParserService {
    private readonly logger = new Logger(ReportParserService.name);

    parseHtml(content: string): any[] {
        this.logger.log('Parsing HTML Report...');
        const trades = [];

        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let match;
        let headerMap: Record<string, number> = {};
        let headerDetected = false;
        let currentTable = 'POSITIONS'; // default to POSITIONS for MT4 reports which just have one table

        const parseNum = (val: string): number => {
            if (!val) return 0;
            // Handle both dot and comma as decimal separators
            const clean = val.replace(/\s/g, '').replace(',', '.');
            return parseFloat(clean) || 0;
        };

        const parseDate = (dateStr: string) => {
            if (!dateStr || dateStr.trim() === '') return null;
            return new Date(dateStr.replace(/\./g, '-'));
        };

        while ((match = rowRegex.exec(content)) !== null) {
            const rowContent = match[1];
            // Support both td and th tags
            const cellRegex = /<(td|th)([^>]*)>([\s\S]*?)<\/(td|th)>/g;
            const cells = [];
            let cellMatch;

            while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
                const attributes = cellMatch[2];
                // Skip hidden cells (common in MT5 reports with class="hidden")
                if (attributes.includes('class="hidden"') || attributes.includes('display: none')) {
                    continue;
                }

                // Decode common HTML entities and remove tags
                let cellText = cellMatch[3]
                    .replace(/<[^>]+>/g, '')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/\s+/g, ' ')
                    .trim();
                cells.push(cellText);
            }

            if (cells.length < 5) continue;

            const normalizedCells = cells.map(c => 
                c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z/]/g, '')
            );
            
            // Check if this is a header row
            if (normalizedCells.some(c => ['ticket', 'posicao', 'horario', 'time', 'symbol', 'ativo', 'ordem', 'oferta'].includes(c))) {
                
                // Identify which MT5 table we are entering
                const headerStr = normalizedCells.join(' ');
                if (headerStr.includes('ordem') && headerStr.includes('estado')) {
                    currentTable = 'ORDERS';
                } else if (headerStr.includes('oferta') || headerStr.includes('deal') || headerStr.includes('direcao')) {
                    currentTable = 'DEALS';
                } else {
                    currentTable = 'POSITIONS';
                }

                // If we are in the positions table, recalc the header map
                if (currentTable === 'POSITIONS') {
                    headerMap = {};
                    let timeCount = 0;
                    let priceCount = 0;
                    
                    cells.forEach((cell, idx) => {
                        const clean = cell.toLowerCase()
                            .normalize('NFD')
                            .replace(/[\u0300-\u036f]/g, '') // remove accents
                            .replace(/[^a-z/]/g, '');
                        
                        if (clean === 'ticket' || clean === 'posicao' || clean === 'position') headerMap['ticket'] = idx;
                        else if (clean === 'symbol' || clean === 'ativo' || clean === 'item') headerMap['symbol'] = idx;
                        else if (clean === 'type' || clean === 'tipo') headerMap['type'] = idx;
                        else if (clean === 'size' || clean === 'volume') headerMap['volume'] = idx;
                        else if (clean === 'commission' || clean === 'comissao') headerMap['commission'] = idx;
                        else if (clean === 'swap') headerMap['swap'] = idx;
                        else if (clean === 'profit' || clean === 'lucro') headerMap['profit'] = idx;
                        else if (clean === 'sl' || clean === 's/l' || clean === 'stoploss') headerMap['sl'] = idx;
                        else if (clean === 'tp' || clean === 't/p' || clean === 'takeprofit') headerMap['tp'] = idx;
                        else if (clean === 'horario' || clean === 'time' || clean === 'opentime') {
                            if (timeCount === 0) headerMap['opentime'] = idx;
                            else headerMap['closetime'] = idx;
                            timeCount++;
                        }
                        else if (clean === 'preco' || clean === 'price' || clean === 'openprice') {
                            if (priceCount === 0) headerMap['openprice'] = idx;
                            else headerMap['closeprice'] = idx;
                            priceCount++;
                        }
                    });
                    
                    if (Object.keys(headerMap).length > 3) {
                        headerDetected = true;
                        this.logger.log(`Detected HTML POSITIONS headers: ${JSON.stringify(headerMap)}`);
                    }
                }
                
                // Skip the header row itself
                continue;
            }

            // If we are not in the Positions table, ignore the row entirely
            if (currentTable !== 'POSITIONS' || !headerDetected) continue;

            const ticketVal = cells[headerMap['ticket'] ?? 0];
            const ticket = parseInt(ticketVal);
            
            const isPotentialTicket = !isNaN(ticket) && ticket > 0;

            if (isPotentialTicket) {
                // Remove uncommon broker suffixes from symbol (.x, .y, _ecn, m, etc.)
                const rawSymbol = cells[headerMap['symbol'] ?? 4];
                const cleanSymbol = rawSymbol ? rawSymbol.replace(/(\.x|\.y|[_\-]ecn|m|pro)$/i, '') : '';
                
                trades.push({
                    ticket: ticket,
                    open_time: parseDate(cells[headerMap['opentime'] ?? 1]),
                    type: cells[headerMap['type'] ?? 2],
                    volume: parseNum(cells[headerMap['volume'] ?? 3]),
                    symbol: cleanSymbol,
                    open_price: parseNum(cells[headerMap['openprice'] ?? 5]),
                    close_time: parseDate(cells[headerMap['closetime'] ?? 8]),
                    close_price: parseNum(cells[headerMap['closeprice'] ?? 9]),
                    commission: parseNum(cells[headerMap['commission'] ?? 10]),
                    swap: parseNum(cells[headerMap['swap'] ?? 12]),
                    profit: parseNum(cells[headerMap['profit'] ?? 13]),
                    sl: headerMap['sl'] !== undefined ? parseNum(cells[headerMap['sl']]) : 0,
                    tp: headerMap['tp'] !== undefined ? parseNum(cells[headerMap['tp']]) : 0,
                    comment: 'Imported HTML'
                });
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

        // 3. Robust Parsing Logic
        const lines = content.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length === 0) return [];

        // Delimiter detection: check first 5 lines
        const sampleLines = lines.slice(0, 5);
        let commas = 0;
        let semicolons = 0;
        sampleLines.forEach(l => {
            commas += (l.match(/,/g) || []).length;
            semicolons += (l.match(/;/g) || []).length;
        });
        const delimiter = semicolons > commas ? ';' : ',';
        this.logger.log(`Detected CSV delimiter: "${delimiter}"`);

        const trades = [];
        let headerMap: Record<string, number> = {};

        // Helper to parse localized numbers (handles "10,50" and "10.50")
        const parseNum = (val: string): number => {
            if (!val) return 0;
            const clean = val.replace(/\s/g, '').replace(',', '.');
            return parseFloat(clean) || 0;
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].replace(/"/g, '').replace(/\r/g, '');
            const cols = line.split(delimiter).map(c => c.trim());

            // Try to detect header in first 2 lines
            if (i < 2 && (cols.includes('Ticket') || cols.includes('Symbol') || cols.includes('Login'))) {
                cols.forEach((col, idx) => {
                    const normalized = col.toLowerCase().replace(/[^a-z]/g, '');
                    headerMap[normalized] = idx;
                });
                this.logger.log(`Detected CSV header: ${JSON.stringify(headerMap)}`);
                continue;
            }

            if (cols.length < 5) continue; // Minimum columns to be valid

            const ticket = parseInt(cols[headerMap['ticket'] ?? 0]);
            if (isNaN(ticket) || ticket <= 0) continue;

            // Date mapping (heuristic or header-based)
            const openTimeStr = cols[headerMap['opentime'] ?? headerMap['time'] ?? 1];
            const closeTimeStr = cols[headerMap['closetime'] ?? 8];

            const openTime = this.normalizeDate(openTimeStr);
            if (!openTime) {
                if (i > 0) this.logger.warn(`Invalid Open Time at line ${i + 1}: ${openTimeStr}`);
                continue;
            }

            const typeStr = (cols[headerMap['type'] ?? 2] || '').toLowerCase();
            const validTypes = ['buy', 'sell', 'buy limit', 'sell limit', 'buy stop', 'sell stop', 'balance', 'credit', 'correction'];
            if (!validTypes.some(v => typeStr.includes(v))) continue;

            // Remove uncommon broker suffixes from symbol (.x, .y, _ecn, m, etc.)
            const rawSymbol = cols[headerMap['symbol'] ?? headerMap['item'] ?? 4];
            const cleanSymbol = rawSymbol ? rawSymbol.replace(/(\.x|\.y|[_\-]ecn|m|pro)$/i, '') : '';

            const slCol = headerMap['sl'] ?? headerMap['stoploss'] ?? headerMap['s/l'];
            const tpCol = headerMap['tp'] ?? headerMap['takeprofit'] ?? headerMap['t/p'];

            trades.push({
                ticket: ticket,
                open_time: openTime,
                type: typeStr,
                volume: parseNum(cols[headerMap['size'] ?? headerMap['volume'] ?? 3]),
                symbol: cleanSymbol,
                open_price: parseNum(cols[headerMap['price'] ?? headerMap['openprice'] ?? 5]),
                close_time: this.normalizeDate(closeTimeStr),
                close_price: parseNum(cols[headerMap['closeprice'] ?? 9]),
                commission: parseNum(cols[headerMap['commission'] ?? 10]),
                swap: parseNum(cols[headerMap['swap'] ?? 12]),
                profit: parseNum(cols[headerMap['profit'] ?? 13]),
                sl: slCol !== undefined ? parseNum(cols[slCol]) : 0,
                tp: tpCol !== undefined ? parseNum(cols[tpCol]) : 0,
                magic: 0,
                comment: 'Imported via CSV'
            });
        }

        this.logger.log(`Parsed ${trades.length} trades from CSV.`);
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

            const serverTime = this.normalizeDate(cols[0]);
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
                sl: parseFloat(cols[9]) || 0, // stop_loss is column 9
                tp: parseFloat(cols[10]) || 0, // take_profit is column 10
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
