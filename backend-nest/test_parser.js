const fs = require('fs');
const { ReportParserService } = require('./dist/src/import/report-parser.service.js');

const service = new ReportParserService();
// We stub the logger just in case
service.logger = {
    log: console.log,
    warn: console.warn,
    error: console.error
};

const content = fs.readFileSync('e:/TRADING COSSA/backend-nest/arquivos/ReportHistory-314790799 (1).html', 'utf16le');

const trades = service.parseHtml(content);

console.log(`Parsed ${trades.length} trades.`);

let zeroDataTrades = 0;

trades.forEach(t => {
    if (t.open_price === 0 || t.close_price === 0) {
        zeroDataTrades++;
        // console.log("Found trade with missing prices:", t.ticket);
    }
});

console.log(`Found ${zeroDataTrades} trades with zero data (Deals/Orders mistakenly imported).`);
console.log("Sample of imported trades:", JSON.stringify(trades.slice(0, 3), null, 2));

