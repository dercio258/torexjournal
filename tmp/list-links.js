
const { DataSource } = require('typeorm');

async function checkLinks() {
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
        const waLinks = await dataSource.query('SELECT user_id, whatsapp_number, is_active FROM whatsapp_links WHERE is_active = true');
        console.log('ACTIVE_LINKS_START');
        console.log(JSON.stringify(waLinks, null, 2));
        console.log('ACTIVE_LINKS_END');
    } catch (err) {
        console.error('ERROR:', err.message);
    } finally {
        await dataSource.destroy();
        process.exit(0);
    }
}

checkLinks();
