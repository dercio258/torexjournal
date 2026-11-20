const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

// Carregar variáveis de ambiente
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

async function listUsers() {
    const searchTerm = process.argv[2] ? process.argv[2].trim() : null;

    const dbUser = process.env.DB_USER;
    const dbPass = process.env.DB_PASS;
    const dbName = process.env.DB_NAME;
    if (!dbUser || !dbPass || !dbName) {
        console.error('❌ Variáveis DB_USER, DB_PASS e DB_NAME são obrigatórias no ambiente.');
        process.exit(1);
    }

    const client = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: dbUser,
        password: dbPass,
        database: dbName,
    });

    try {
        await client.connect();

        let query = `
            SELECT 
                u.id,
                u.email,
                u.name,
                u.username,
                u."createdAt",
                s.status as "subStatus",
                spc.tier as "subTier",
                s."currentPeriodEnd" as "subExpiry"
            FROM users u
            LEFT JOIN LATERAL (
                SELECT status, "planConfigId", "currentPeriodEnd"
                FROM subscriptions
                WHERE "userId" = u.id
                ORDER BY "createdAt" DESC
                LIMIT 1
            ) s ON true
            LEFT JOIN subscription_plan_configs spc ON s."planConfigId" = spc.id
        `;

        const params = [];

        if (searchTerm) {
            query += ` WHERE u.email ILIKE $1 OR u.name ILIKE $1 OR u.username ILIKE $1`;
            params.push(`%${searchTerm}%`);
        }

        query += ` ORDER BY u."createdAt" DESC`;

        const res = await client.query(query, params);

        console.log('\n======================================================');
        if (searchTerm) {
            console.log(`🔍 RESULTADOS DA BUSCA POR: "${searchTerm}" (${res.rows.length} encontrados)`);
        } else {
            console.log(`📋 LISTA DE TODOS OS USUÁRIOS NO BANCO (${res.rows.length} total)`);
        }
        console.log('======================================================\n');

        if (res.rows.length === 0) {
            console.log('Nenhum usuário encontrado.');
        } else {
            console.table(
                res.rows.map((user) => ({
                    ID: user.id.substring(0, 8) + '...',
                    Email: user.email || 'N/A',
                    Nome: user.name || 'N/A',
                    Username: user.username || 'N/A',
                    'Plano Atual': user.subTier || 'NENHUM',
                    'Status Sub': user.subStatus || 'INATIVO',
                    'Expira Em': user.subExpiry ? new Date(user.subExpiry).toLocaleDateString() : 'N/A',
                    'Cadastrado Em': user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'
                }))
            );
            
            console.log('\n💡 Dica: Para copiar o email exato e ativar o plano de 30 dias:');
            console.log('   node activate-plan-30days.js <email-copiado> PREMIUM\n');
        }

    } catch (error) {
        console.error('❌ Erro ao listar usuários:', error);
    } finally {
        await client.end();
    }
}

listUsers();
