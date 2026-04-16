const fs = require('fs');
const content = fs.readFileSync('e:/TRADING COSSA/backend-nest/arquivos/ReportHistory-314790799 (1).html', 'utf16le'); 

const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
let match;
let count = 0;

while ((match = rowRegex.exec(content)) !== null) {
    const rowContent = match[1];
    const cellRegex = /<(td|th)([^>]*)>([\s\S]*?)<\/(td|th)>/g;
    const cells = [];
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const attributes = cellMatch[2];
        if (attributes.includes('class="hidden"') || attributes.includes('display: none')) continue;

        let cellText = cellMatch[3]
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .trim();
        cells.push(cellText);
    }
    
    // Any row with length > 5 and string-heavy is probably a header
    if (cells.length > 5 && isNaN(parseFloat(cells[0])) && isNaN(parseFloat(cells[1]))) {
        console.log(`Potential Header ${count++}:`, cells.join(' | '));
    }
}
