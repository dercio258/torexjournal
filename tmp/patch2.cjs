const fs = require('fs');
const path = require('path');

const filesToPatch = [
    'src/pages/Journal.tsx',
    'src/pages/TradeDetails.tsx',
];

for (const file of filesToPatch) {
    const filePath = path.join(__dirname, '..', 'client', file);
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Fix single quotes around ${id} back to backticks
        content = content.replace(/'\/dashboard\/trades\/\$\{id\}'/g, "`/dashboard/trades/${id}`");
        content = content.replace(/'\/dashboard\/trades\/\$\{tradeId\}'/g, "`/dashboard/trades/${tradeId}`");
        
        // Also fix the technical-journal endpoint which is under dashboard controller
        content = content.replace(/api\.get\(\/technical-journal/g, "api.get('/dashboard/technical-journal");
        content = content.replace(/api\.get\(`\/technical-journal/g, "api.get(`/dashboard/technical-journal");
        content = content.replace(/api\.post\(`\/technical-journal/g, "api.post(`/dashboard/technical-journal");
        content = content.replace(/api\.post\('\/technical-journal/g, "api.post('/dashboard/technical-journal");

        fs.writeFileSync(filePath, content);
        console.log(`Patched ${file}`);
    } catch(e) {
        console.log(`Skipped ${file}`);
    }
}
console.log('Done.');
