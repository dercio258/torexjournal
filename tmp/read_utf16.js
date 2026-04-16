const fs = require('fs');
const content = fs.readFileSync('e:\\TRADING COSSA\\backend-nest\\arquivos\\ReportHistory-314790799 (1).html', { encoding: 'utf16le' });
console.log(content.substring(0, 5000));
