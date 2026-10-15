const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

// Carregar variáveis de ambiente
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

async function activateThirtyDaysPlan() {
    const targetEmail = process.argv[2];

    if (!targetEmail) {
        console.log('\n======================================================');
        console.log('📌 SCRIPT DE ATIVAÇÃO DE PLANO DE 30 DIAS');
        console.log('======================================================');
        console.log('Uso:');
        console.log('  node activate-plan-30days.js <email-do-usuario> [tier]');
        console.log('\nExemplo:');
        console.log('  node activate-plan-30days.js usuario@gmail.com PREMIUM');
        console.log('======================================================\n');
        process.exit(1);
    }

    const tier = (process.argv[3] || 'PREMIUM').toUpperCase();

    const client = new Client({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'cossa_trading_user',
        password: process.env.DB_PASS || 'C0ssa@2026_db!',
        database: process.env.DB_NAME || 'cossa_trading',
    });

    try {
        console.log('🔌 Conectando ao banco de dados PostgreSQL...');
        await client.connect();
        console.log('✅ Conexão estabelecida com sucesso.');

        // 1. Localizar usuário
        const userRes = await client.query('SELECT id, email, name FROM users WHERE email = $1', [targetEmail]);
        if (userRes.rows.length === 0) {
            console.error(`❌ Usuário com o email "${targetEmail}" não foi encontrado no banco de dados!`);
            return;
        }

        const user = userRes.rows[0];
        console.log(`👤 Usuário localizado: ${user.name || user.email} (ID: ${user.id})`);

        // 2. Localizar ou criar a configuração do plano
        let planRes = await client.query(
            'SELECT id FROM subscription_plan_configs WHERE tier = $1 AND "isActive" = true LIMIT 1',
            [tier]
        );
        let planId;

        if (planRes.rows.length === 0) {
            console.log(`⚠️ Configuração para o plano ${tier} não encontrada. Criando plano ativo...`);
            const newPlanRes = await client.query(
                `INSERT INTO subscription_plan_configs (id, tier, description, features, "monthlyPrice", "annualDiscountPercent", "trialEnabled", "trialDays", "trialPrice", "isActive") 
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                [tier, `${tier} Plan`, JSON.stringify(['all_features']), 20.00, 0, false, 0, 0.00, true]
            );
            planId = newPlanRes.rows[0].id;
            console.log(`✅ Plano criado com ID: ${planId}`);
        } else {
            planId = planRes.rows[0].id;
            console.log(`📋 Plano ${tier} encontrado (ID: ${planId})`);
        }

        // 3. Cancelar assinaturas ativas existentes deste usuário
        const updateRes = await client.query(
            'UPDATE subscriptions SET status = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND status = $3',
            ['CANCELLED', user.id, 'ACTIVE']
        );
        if (updateRes.rowCount > 0) {
            console.log(`🔄 ${updateRes.rowCount} assinatura(s) ativa(s) anterior(es) cancelada(s).`);
        }

        // 4. Calcular período de 30 dias a contar de agora
        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        // 5. Inserir a nova assinatura ativa
        const insertRes = await client.query(
            `INSERT INTO subscriptions (
                id, "userId", "planConfigId", status, cycle, "currentPeriodEnd", 
                "paymentReference", "paymentMethod", "createdAt", "updatedAt"
             ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
             ) RETURNING id`,
            [
                user.id,
                planId,
                'ACTIVE',
                'MONTHLY',
                thirtyDaysFromNow,
                'ADMIN_MANUAL_30_DAYS',
                'ADMIN'
            ]
        );

        const subId = insertRes.rows[0].id;

        console.log('\n=========================================');
        console.log('🎉 PLANO DE 30 DIAS ATIVADO COM SUCESSO!');
        console.log('=========================================');
        console.log(`- Usuário: ${user.email} (${user.id})`);
        console.log(`- Tier: ${tier}`);
        console.log(`- ID da Assinatura: ${subId}`);
        console.log(`- Status: ACTIVE`);
        console.log(`- Ciclo: MONTHLY`);
        console.log(`- Ativado em: ${now.toLocaleString()}`);
        console.log(`- Válido até: ${thirtyDaysFromNow.toLocaleString()} (30 dias)`);
        console.log('=========================================\n');

    } catch (error) {
        console.error('❌ Erro durante a execução do script:', error);
    } finally {
        await client.end();
    }
}

activateThirtyDaysPlan();
