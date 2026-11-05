import { Injectable, Logger } from '@nestjs/common';
import * as zlib from 'zlib';

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

    private normalizeDate(dateStr: any): Date | null {
        if (dateStr === undefined || dateStr === null) return null;
        if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;

        // Numeric timestamp (seconds or milliseconds)
        if (typeof dateStr === 'number' || /^\d{10,13}$/.test(dateStr.toString().trim())) {
            const num = Number(dateStr);
            const timestamp = num > 1e11 ? num : num * 1000;
            const d = new Date(timestamp);
            return isNaN(d.getTime()) ? null : d;
        }

        const trimmed = dateStr.toString().trim().replace(/"/g, '');
        if (!trimmed) return null;

        // 1. Direct standard parse (handles ISO timestamps with or without ms, e.g. 2026-02-02T08:15:00.000)
        const directDate = new Date(trimmed);
        if (!isNaN(directDate.getTime())) {
            const yr = directDate.getFullYear();
            if (yr >= 1990 && yr <= 2100) return directDate;
        }

        // 2. Split date and time
        const [datePart, ...restTime] = trimmed.split(/[ T]/);
        const timePart = restTime.join(' ');

        // 3. Match YYYY.MM.DD, YYYY-MM-DD, YYYY/MM/DD
        const ymdMatch = datePart.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
        if (ymdMatch) {
            const year = parseInt(ymdMatch[1], 10);
            const month = parseInt(ymdMatch[2], 10) - 1;
            const day = parseInt(ymdMatch[3], 10);
            
            let hours = 0, minutes = 0, seconds = 0;
            if (timePart) {
                const timeMatch = timePart.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
                if (timeMatch) {
                    hours = parseInt(timeMatch[1], 10);
                    minutes = parseInt(timeMatch[2], 10);
                    seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
                }
            }
            const d = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
            if (!isNaN(d.getTime())) return d;
        }

        // 4. Match DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY
        const dmyMatch = datePart.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
        if (dmyMatch) {
            const day = parseInt(dmyMatch[1], 10);
            const month = parseInt(dmyMatch[2], 10) - 1;
            const year = parseInt(dmyMatch[3], 10);
            
            let hours = 0, minutes = 0, seconds = 0;
            if (timePart) {
                const timeMatch = timePart.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
                if (timeMatch) {
                    hours = parseInt(timeMatch[1], 10);
                    minutes = parseInt(timeMatch[2], 10);
                    seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
                }
            }
            const d = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
            if (!isNaN(d.getTime())) return d;
        }

        return null;
    }

    parseCsv(content: string): any[] {
        this.logger.log('Parsing CSV Report...');
        const cleanContent = (content || '').replace(/^\uFEFF/, '');

        // 1. Detect Journal Log (tradinglog format)
        if (cleanContent.includes('ticket_id,message,event_type') || cleanContent.includes('ticket_id;message;event_type')) {
            return this.parseJournalLog(cleanContent);
        }

        // 2. Detect History Format (standard CSV export)
        if (cleanContent.includes('ticket,opening_time_utc') || cleanContent.includes('ticket;opening_time_utc')) {
            return this.parseHistoryCsv(cleanContent);
        }

        // 3. Robust Parsing Logic (ignores # metadata lines from TorexJournal Branded CSV)
        const lines = cleanContent
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#') && !l.startsWith('"#'));
        if (lines.length === 0) return [];

        // Delimiter detection: check first 5 non-comment lines
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

            // Detect header row (English or Portuguese)
            if (
                i < 25 &&
                cols.some(c => {
                    const norm = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
                    return ['ticket', 'symbol', 'simbolo', 'ativo', 'login', 'opentime', 'dataabertura'].includes(norm);
                })
            ) {
                cols.forEach((col, idx) => {
                    const normalized = col
                        .toLowerCase()
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z]/g, '');
                    headerMap[normalized] = idx;
                });
                this.logger.log(`Detected CSV header: ${JSON.stringify(headerMap)}`);
                continue;
            }

            if (cols.length < 5) continue; // Minimum columns to be valid

            const ticketIdx = headerMap['ticket'] ?? 0;
            const ticket = parseInt(cols[ticketIdx]);
            if (isNaN(ticket) || ticket <= 0) continue;

            // Date mapping (heuristic or header-based, English + Portuguese)
            const openTimeIdx =
                headerMap['opentime'] ??
                headerMap['dataabertura'] ??
                headerMap['abertura'] ??
                headerMap['time'] ??
                1;
            const closeTimeIdx =
                headerMap['closetime'] ??
                headerMap['datafechamento'] ??
                headerMap['fechamento'] ??
                8;

            const openTimeStr = cols[openTimeIdx];
            const closeTimeStr = cols[closeTimeIdx];

            const openTime = this.normalizeDate(openTimeStr);
            if (!openTime) {
                if (i > 0) this.logger.warn(`Invalid Open Time at line ${i + 1}: ${openTimeStr}`);
                continue;
            }

            const typeIdx = headerMap['type'] ?? headerMap['tipo'] ?? 2;
            const typeStr = (cols[typeIdx] || '').toLowerCase();
            const validTypes = ['buy', 'sell', 'buy limit', 'sell limit', 'buy stop', 'sell stop', 'balance', 'credit', 'correction'];
            if (!validTypes.some(v => typeStr.includes(v))) continue;

            // Remove uncommon broker suffixes from symbol (.x, .y, _ecn, m, etc.)
            const symbolIdx = headerMap['symbol'] ?? headerMap['simbolo'] ?? headerMap['ativo'] ?? headerMap['item'] ?? 4;
            const rawSymbol = cols[symbolIdx];
            const cleanSymbol = rawSymbol ? rawSymbol.replace(/(\.x|\.y|[_\-]ecn|m|pro)$/i, '') : '';

            const slCol = headerMap['sl'] ?? headerMap['stoploss'] ?? headerMap['s/l'];
            const tpCol = headerMap['tp'] ?? headerMap['takeprofit'] ?? headerMap['t/p'];

            const closePriceIdx = headerMap['closeprice'] ?? headerMap['precofechamento'] ?? 9;
            const profitIdx =
                headerMap['profit'] ??
                headerMap['lucroliquido'] ??
                headerMap['netpnl'] ??
                headerMap['resultado'] ??
                13;

            const parsedClosePrice = parseNum(cols[closePriceIdx]);
            const parsedProfit = parseNum(cols[profitIdx]);
            const parsedCloseTime = this.normalizeDate(closeTimeStr);
            const isClosed = !!parsedCloseTime || parsedClosePrice > 0 || parsedProfit !== 0;
            const finalCloseTime = parsedCloseTime || (isClosed && openTime ? new Date(openTime.getTime() + 5 * 60 * 1000) : null);

            const volIdx = headerMap['size'] ?? headerMap['volume'] ?? headerMap['lote'] ?? 3;
            const openPriceIdx = headerMap['price'] ?? headerMap['openprice'] ?? headerMap['precoabertura'] ?? 5;
            const commIdx = headerMap['commission'] ?? headerMap['comissao'] ?? 10;

            trades.push({
                ticket: ticket,
                open_time: openTime,
                close_time: finalCloseTime,
                status: isClosed ? 'CLOSED' : 'OPEN',
                type: typeStr,
                volume: parseNum(cols[volIdx]),
                symbol: cleanSymbol,
                open_price: parseNum(cols[openPriceIdx]),
                close_price: parsedClosePrice,
                commission: parseNum(cols[commIdx]),
                swap: parseNum(cols[headerMap['swap'] ?? 12]),
                profit: parsedProfit,
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
        const cleanContent = content.replace(/^\uFEFF/, '');
        const lines = cleanContent.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return [];

        // Delimiter detection (, vs ;)
        const sampleLines = lines.slice(0, 5);
        let commas = 0;
        let semicolons = 0;
        sampleLines.forEach(l => {
            commas += (l.match(/,/g) || []).length;
            semicolons += (l.match(/;/g) || []).length;
        });
        const delimiter = semicolons > commas ? ';' : ',';

        const headerLine = lines[0].toLowerCase();
        const headers = headerLine.split(delimiter).map(h => h.trim().replace(/"/g, ''));
        const headerMap: Record<string, number> = {};
        headers.forEach((h, idx) => {
            headerMap[h] = idx;
        });

        const trades = [];
        const validTypes = ['buy', 'sell', 'buy limit', 'sell limit', 'buy stop', 'sell stop', 'balance', 'credit', 'correction'];

        const parseNum = (val: any): number => {
            if (val === undefined || val === null) return 0;
            if (typeof val === 'number') return isNaN(val) ? 0 : val;
            let clean = val.toString().trim().replace(/\s/g, '');
            if (!clean) return 0;
            if (clean.includes('.') && clean.includes(',')) {
                if (clean.indexOf('.') < clean.indexOf(',')) {
                    clean = clean.replace(/\./g, '').replace(',', '.');
                } else {
                    clean = clean.replace(/,/g, '');
                }
            } else if (clean.includes(',')) {
                clean = clean.replace(',', '.');
            }
            const parsed = parseFloat(clean);
            return isNaN(parsed) ? 0 : parsed;
        };

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const cols = line.split(delimiter).map(c => c.trim().replace(/"/g, ''));
            if (cols.length < 5) continue;

            const rawTicket = cols[0];
            const ticket = parseInt(rawTicket);
            if (!rawTicket) continue;

            const openTime = this.normalizeDate(cols[1]);
            if (!openTime) continue;

            let closeTime: Date | null = null;
            let type = 'buy';
            let volume = 0;
            let symbol = '';
            let openPrice = 0;
            let closePrice = 0;
            let sl = 0;
            let tp = 0;
            let commission = 0;
            let swap = 0;
            let profit = 0;

            const col2Lower = (cols[2] || '').toLowerCase();
            const isCol2Type = validTypes.some(t => col2Lower.includes(t));

            if (isCol2Type) {
                // Row has: ticket (0), open_time (1), type (2), lots (3), orig_size (4), symbol (5), open_price (6), close_price (7), sl (8), tp (9), commission (10), swap (11), profit (12)
                type = col2Lower;
                volume = parseNum(cols[3]);
                symbol = cols[5] || '';
                openPrice = parseNum(cols[6]);
                closePrice = parseNum(cols[7]);
                sl = parseNum(cols[8]);
                tp = parseNum(cols[9]);
                commission = parseNum(cols[10]);
                swap = parseNum(cols[11]);
                profit = parseNum(cols[12]);

                // Check remaining columns for closing time if present
                for (let c = 13; c < cols.length; c++) {
                    const candidateDate = this.normalizeDate(cols[c]);
                    if (candidateDate) {
                        closeTime = candidateDate;
                        break;
                    }
                }
                if (!closeTime && openTime) {
                    closeTime = new Date(openTime.getTime() + 5 * 60 * 1000);
                }
            } else {
                // Standard row with closing_time_utc at col 2:
                closeTime = cols[2] ? this.normalizeDate(cols[2]) : null;
                if (!closeTime && openTime) {
                    closeTime = new Date(openTime.getTime() + 5 * 60 * 1000);
                }
                type = (cols[3] || 'buy').toLowerCase();
                volume = parseNum(cols[4]);
                symbol = cols[6] || cols[5] || '';
                openPrice = parseNum(cols[7]);
                closePrice = parseNum(cols[8]);
                sl = parseNum(cols[9]);
                tp = parseNum(cols[10]);
                commission = parseNum(cols[11]);
                swap = parseNum(cols[12]);
                profit = parseNum(cols[13]);
            }

            const cleanSymbol = symbol ? symbol.replace(/(\.x|\.y|[_\-]ecn|m|pro)$/i, '') : '';

            trades.push({
                ticket: !isNaN(ticket) && ticket > 0 ? ticket : rawTicket,
                contractId: rawTicket,
                open_time: openTime,
                close_time: closeTime,
                status: 'CLOSED', // History reports only contain closed trades
                type: type,
                volume: volume,
                symbol: cleanSymbol || symbol,
                open_price: openPrice,
                close_price: closePrice,
                sl: sl,
                tp: tp,
                commission: commission,
                swap: swap,
                profit: profit,
                comment: 'Imported via History CSV',
                magic: 0
            });
        }

        this.logger.log(`Parsed ${trades.length} trades from History CSV.`);
        return trades;
    }

    /**
     * Suporte multi-formato para planilhas Excel (.xls HTML, XML Spreadsheet 2003 e .xlsx OpenXML ZIP)
     */
    parseExcel(buffer: Buffer, textContent: string): any[] {
        this.logger.log('Parsing Excel (.xls / .xlsx / .xml) Report...');

        // 1. Se for HTML-Excel (.xls exportado pelo TorexJournal ou MT4/MT5)
        if (textContent.includes('<table') || textContent.includes('<tr')) {
            const htmlTrades = this.parseHtml(textContent);
            if (htmlTrades.length > 0) return htmlTrades;
        }

        // 2. Se for XML Spreadsheet 2003 (<Row><Cell><Data>...</Data></Cell></Row>)
        if (textContent.includes('<Row') && textContent.includes('<Cell')) {
            const csvLines: string[] = [];
            const rowRegex = /<Row[^>]*>([\s\S]*?)<\/Row>/gi;
            let rMatch;
            while ((rMatch = rowRegex.exec(textContent)) !== null) {
                const cellRegex = /<Data[^>]*>([\s\S]*?)<\/Data>/gi;
                const cells: string[] = [];
                let cMatch;
                while ((cMatch = cellRegex.exec(rMatch[1])) !== null) {
                    cells.push(cMatch[1].replace(/<[^>]+>/g, '').trim());
                }
                if (cells.length > 0) {
                    csvLines.push(cells.join(','));
                }
            }
            if (csvLines.length > 0) {
                const xmlTrades = this.parseCsv(csvLines.join('\n'));
                if (xmlTrades.length > 0) return xmlTrades;
            }
        }

        // 3. Se for arquivo .xlsx nativo (ZIP com assinatura PK\x03\x04)
        if (buffer && buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
            try {
                const xlsxCsv = this.extractXlsxAsCsv(buffer);
                if (xlsxCsv) {
                    const xlsxTrades = this.parseCsv(xlsxCsv);
                    if (xlsxTrades.length > 0) return xlsxTrades;
                }
            } catch (e) {
                this.logger.warn(`Fallback na descompactação XLSX: ${e.message}`);
            }
        }

        // 4. Fallback CSV / TSV
        return this.parseCsv(textContent.replace(/\t/g, ','));
    }

    private extractXlsxAsCsv(zipBuffer: Buffer): string {
        const entries = new Map<string, string>();
        let offset = 0;

        while (offset + 30 <= zipBuffer.length) {
            const sig = zipBuffer.readUInt32LE(offset);
            if (sig !== 0x04034b50) break;

            const compression = zipBuffer.readUInt16LE(offset + 8);
            const compressedSize = zipBuffer.readUInt32LE(offset + 18);
            const fileNameLen = zipBuffer.readUInt16LE(offset + 26);
            const extraLen = zipBuffer.readUInt16LE(offset + 28);

            const fileName = zipBuffer.toString('utf8', offset + 30, offset + 30 + fileNameLen);
            const dataStart = offset + 30 + fileNameLen + extraLen;
            const dataEnd = dataStart + compressedSize;
            if (dataEnd > zipBuffer.length) break;

            if (
                fileName === 'xl/sharedStrings.xml' ||
                fileName.startsWith('xl/worksheets/sheet')
            ) {
                const slice = zipBuffer.subarray(dataStart, dataEnd);
                const rawXml =
                    compression === 0
                        ? slice.toString('utf8')
                        : zlib.inflateRawSync(slice).toString('utf8');
                entries.set(fileName, rawXml);
            }

            offset = dataEnd;
        }

        const sharedStrings: string[] = [];
        const ssXml = entries.get('xl/sharedStrings.xml') || '';
        if (ssXml) {
            const siRegex = /<si[^>]*>([\s\S]*?)<\/si>/gi;
            let siMatch;
            while ((siMatch = siRegex.exec(ssXml)) !== null) {
                const tMatches = siMatch[1].match(/<t[^>]*>([\s\S]*?)<\/t>/gi) || [];
                const text = tMatches
                    .map(t => t.replace(/<[^>]+>/g, ''))
                    .join('');
                sharedStrings.push(text);
            }
        }

        const sheetXml =
            entries.get('xl/worksheets/sheet1.xml') ||
            Array.from(entries.entries()).find(([k]) => k.startsWith('xl/worksheets/sheet'))?.[1] ||
            '';
        if (!sheetXml) return '';

        const csvRows: string[] = [];
        const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/gi;
        let rMatch;
        while ((rMatch = rowRegex.exec(sheetXml)) !== null) {
            const cellRegex = /<c([^>]*)>([\s\S]*?)<\/c>/gi;
            const rowCells: string[] = [];
            let cMatch;
            while ((cMatch = cellRegex.exec(rMatch[1])) !== null) {
                const attrs = cMatch[1];
                const body = cMatch[2];
                const isShared = /t="s"/i.test(attrs);
                const isInline = /t="inlineStr"/i.test(attrs);
                let val = '';
                if (isInline) {
                    const tM = body.match(/<t[^>]*>([\s\S]*?)<\/t>/i);
                    val = tM ? tM[1] : '';
                } else {
                    const vM = body.match(/<v[^>]*>([\s\S]*?)<\/v>/i);
                    const rawVal = vM ? vM[1].trim() : '';
                    if (isShared) {
                        const idx = parseInt(rawVal, 10);
                        val = !isNaN(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : rawVal;
                    } else {
                        val = rawVal;
                    }
                }
                rowCells.push(val.replace(/,/g, '.').trim());
            }
            if (rowCells.length > 0) {
                csvRows.push(rowCells.join(','));
            }
        }

        return csvRows.join('\n');
    }

    /**
     * Suporte para relatórios de operações em PDF (.pdf)
     */
    parsePdf(buffer: Buffer, textContent: string): any[] {
        this.logger.log('Parsing PDF Report...');
        const extractedChunks: string[] = [textContent || ''];

        if (buffer) {
            const rawLatin = buffer.toString('latin1');
            const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
            let sMatch;
            while ((sMatch = streamRegex.exec(rawLatin)) !== null) {
                try {
                    const subBuf = Buffer.from(sMatch[1], 'latin1');
                    const inflated = zlib.inflateSync(subBuf).toString('utf8');
                    extractedChunks.push(inflated);
                } catch {
                    // Stream não comprimido com FlateDecode ou binário de imagem
                }
            }
        }

        const fullText = extractedChunks.join('\n');
        // Extrai strings literais de operadores PDF (...) Tj / TJ
        const pdfTextTokens: string[] = [];
        const tokenRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
        let tMatch;
        while ((tMatch = tokenRegex.exec(fullText)) !== null) {
            const cleaned = tMatch[1]
                .replace(/\\([()\\])/g, '$1')
                .replace(/\s+/g, ' ')
                .trim();
            if (cleaned) pdfTextTokens.push(cleaned);
        }

        const combinedLines = [
            ...fullText.split(/\r?\n/),
            pdfTextTokens.join(' '),
        ];

        const trades = [];
        const rowPattern =
            /(\d{5,12})\s+(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s+(buy|sell)\s+([0-9.,]+)\s+([A-Za-z0-9._-]+)\s+([0-9.,]+)(?:\s+[0-9.,]+\s+[0-9.,]+)?\s+(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s+([0-9.,]+).*?([+-]?[0-9]+[.,][0-9]{2})/gi;

        for (const chunk of combinedLines) {
            let m;
            while ((m = rowPattern.exec(chunk)) !== null) {
                const ticket = parseInt(m[1], 10);
                const openTime = this.normalizeDate(m[2]);
                const type = m[3].toLowerCase();
                const volume = parseFloat(m[4].replace(',', '.')) || 0.01;
                const symbol = m[5].replace(/(\.x|\.y|[_\-]ecn|m|pro)$/i, '');
                const openPrice = parseFloat(m[6].replace(',', '.')) || 0;
                const closeTime = this.normalizeDate(m[7]);
                const closePrice = parseFloat(m[8].replace(',', '.')) || 0;
                const profit = parseFloat(m[9].replace(',', '.')) || 0;

                if (ticket > 0 && openTime) {
                    trades.push({
                        ticket,
                        open_time: openTime,
                        close_time: closeTime || new Date(openTime.getTime() + 60000),
                        status: 'CLOSED',
                        type,
                        volume,
                        symbol,
                        open_price: openPrice,
                        close_price: closePrice,
                        commission: 0,
                        swap: 0,
                        profit,
                        sl: 0,
                        tp: 0,
                        magic: 0,
                        comment: 'Imported via PDF',
                    });
                }
            }
        }

        if (trades.length > 0) {
            this.logger.log(`Parsed ${trades.length} trades from PDF report.`);
            return trades;
        }

        return this.parseCsv(fullText);
    }
}
