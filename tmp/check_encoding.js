const fs = require('fs');
const buffer = fs.readFileSync('e:\\TRADING COSSA\\backend-nest\\arquivos\\ReportHistory-314790799 (1).html');
// Try to detect UTF-16LE by checking for BOM or null bytes
let content;
if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    content = buffer.toString('utf16le');
    console.log('Detected UTF-16LE');
} else {
    content = buffer.toString('utf8');
    console.log('Detected UTF-8');
}
console.log(content.substring(0, 5000));
