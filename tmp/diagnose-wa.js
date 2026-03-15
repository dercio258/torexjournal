
const { DataSource } = require('typeorm');
const path = require('path');
const fs = require('fs');

async function diagnose() {
    const dataSource = new DataSource({
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        username: 'cossa_trading_user',
        password: 'C0ssa@2026_db!',
        database: 'cossa_trading',
        synchronize: false,
    });

    try {
        await dataSource.initialize();
        console.log('✅ DB Connected');

        const waLinks = await dataSource.query('SELECT * FROM whatsapp_links WHERE is_active = true');
        console.log('Active WA Links:', JSON.stringify(waLinks, null, 2));

        const credsPath = path.join(process.cwd(), 'wa_auth', 'creds.json');
        if (fs.existsSync(credsPath)) {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
            console.log('Bot Credentials Status:');
            console.log('- Registered:', creds.registered);
            console.log('- Me:', JSON.stringify(creds.me, null, 2));
        } else {
            console.log('❌ No credentials found in wa_auth/creds.json');
        }

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await dataSource.destroy();
    }
}

diagnose();
