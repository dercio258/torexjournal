const fs = require('fs');
const path = require('path');

const filesToPatch = [
    'src/hooks/useDashboard.ts',
    'src/pages/Journal.tsx',
    'src/components/dashboard/RecentTrades.tsx',
    'src/components/dashboard/TradeHistory.tsx',
    'src/pages/Reports.tsx',
    'src/pages/TradeDetails.tsx',
    'src/pages/Trades.tsx',
];

for (const file of filesToPatch) {
    const filePath = path.join(__dirname, '..', 'client', file);
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        
        // api.get('/trades') -> api.get('/dashboard/trades')
        content = content.replace(/api\.get\(['"`]\/trades(.*?)['"`]\)/g, "api.get('/dashboard/trades$1')");
        // api.get(`/trades/${id}`) -> api.get(`/dashboard/trades/${id}`)
        content = content.replace(/api\.get\([`'"]\/trades\/(.*?)[`'"]\)/g, "api.get(`/dashboard/trades/$1`)");

        // Cleanup any duplicates
        content = content.replace(/\/dashboard\/dashboard\/trades/g, "/dashboard/trades");

        fs.writeFileSync(filePath, content);
        console.log(`Patched ${file}`);
    } catch(e) {
        console.log(`Skipped ${file}`);
    }
}
console.log('Done.');
