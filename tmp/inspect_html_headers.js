const fs = require('fs');
const content = fs.readFileSync('e:/TRADING COSSA/backend-nest/arquivos/ReportHistory-314790799 (1).html', 'utf16le'); // Assuming utf16le given previous outputs

const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
let match;

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

    if (cells.length < 5) continue;

    // Check if it's a header
    const normalizedCells = cells.map(c => 
        c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z/]/g, '')
    );
    
    if (normalizedCells.some(c => ['ticket', 'posicao', 'position', 'deal', 'order'].includes(c))) {
        console.log('HEADER FOUND:', cells.join(' | '));
    }
}
