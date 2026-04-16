const { DataSource } = require('typeorm');
const dotenv = require('dotenv');
const path = require('path');

// Carrega as variáveis de ambiente (.env) da raiz do backend-nest
dotenv.config({ path: path.join(__dirname, '../.env') });

async function syncDatabase() {
    console.log("Iniciando sincronização da base de dados na VPS...");

    const db = new DataSource({
        type: 'postgres',
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432'),
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASS || 'postgres',
        database: process.env.DB_NAME || 'trading_cossa',
        synchronize: true, // Força a atualização da estrutura (cria tabelas/colunas que faltam)
        logging: true,
        // Usa as entidades compiladas na pasta dist porque na VPS teremos JavaScript
        entities: [path.join(__dirname, '../dist/**/*.entity.js')],
    });

    try {
        await db.initialize();
        console.log("----------------------------------------------------------");
        console.log("✅ Banco de dados estruturado e sincronizado com sucesso!");
        console.log("A estrutura da base foi atualizada para corresponder ao código atual.");
        console.log("Problemas de upload de arquivos .html e trades não aparecendo devem estar resolvidos.");
        console.log("----------------------------------------------------------");
        process.exit(0);
    } catch (error) {
        console.error("❌ Erro ao sincronizar o banco de dados:", error);
        process.exit(1);
    }
}

syncDatabase();
