const { DataSource } = require('typeorm');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function fixOrphanedTrades() {
    console.log("Iniciando correção de trades invisíveis na base de dados...");

    const db = new DataSource({
        type: 'postgres',
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432'),
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASS || 'postgres',
        database: process.env.DB_NAME || 'trading_cossa',
    });

    try {
        await db.initialize();
        console.log("Conectado ao banco de dados.");

        const logs = await db.query('SELECT DISTINCT import_log_id FROM trades WHERE account_id IS NULL AND import_log_id IS NOT NULL');
        
        if (logs.length === 0) {
            console.log("✅ Nenhum trade órfão encontrado. Está tudo certinho.");
            process.exit(0);
        }

        console.log(`Encontrados ${logs.length} lotes de importação de trades invisíveis. Corrigindo...`);

        for (const log of logs) {
            // Obter userId do log
            const logData = await db.query('SELECT user_id FROM import_log WHERE id = $1', [log.import_log_id]);
            if (logData.length === 0 || !logData[0].user_id) continue;
            
            const userId = logData[0].user_id;

            // Encontrar ou criar conta para esse usuário
            let userAccounts = await db.query('SELECT id FROM accounts WHERE user_id = $1 LIMIT 1', [userId]);
            let accountId;

            if (userAccounts.length === 0) {
                console.log(`Usuário ${userId} não tem conta. Criando conta MANUAL padrão...`);
                // Precisamos inserir a conta e pegar o ID gerado usando gen_random_uuid() no postgres (TypeORM faz isso automático, mas por SQL bruto usamos isso)
                const res = await db.query(
                    "INSERT INTO accounts (id, user_id, mt5_id, is_connected) VALUES (gen_random_uuid(), $1, $2, false) RETURNING id", 
                    [userId, 'MANUAL_' + userId.substring(0,8)]
                );
                accountId = res[0].id;
            } else {
                accountId = userAccounts[0].id;
            }

            // Atualizar trades deste import log
            const updateRes = await db.query('UPDATE trades SET account_id = $1 WHERE import_log_id = $2 AND account_id IS NULL', [accountId, log.import_log_id]);
            console.log(`🔗 Associou ${updateRes[1] || 'os'} trades do arquivo (log ID: ${log.import_log_id}) para a conta principal do usuário.`);
        }

        console.log("----------------------------------------------------------");
        console.log("✅ Correção finalizada! Os trades devem aparecer no dashboard agora.");
        console.log("----------------------------------------------------------");
        process.exit(0);

    } catch (error) {
        console.error("❌ Erro ao corrigir trades:", error);
        process.exit(1);
    }
}

fixOrphanedTrades();
