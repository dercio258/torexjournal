/**
 * Script de Ativacao do Maior Plano (PRO / PREMIUM - ANUAL) em Producao
 * Usuario alvo padrao: raphaelmanguele.jr@gmail.com
 *
 * Uso na VPS Linux:
 *   node backend-nest/scripts/activate_max_plan.js [email_opcional]
 */

const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TARGET_EMAIL = (process.argv[2] || 'raphaelmanguele.jr@gmail.com').trim().toLowerCase();

async function activateMaxPlan() {
    console.log('================================================================================');
    console.log(` ATIVACAO DO MAIOR PLANO (PRO / PREMIUM) PARA: ${TARGET_EMAIL}`);
    console.log(' Timestamp:', new Date().toISOString());
    console.log('================================================================================\n');

    const pgConfig = {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASS || process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || process.env.DB_DATABASE || 'trading_cossa',
    };

    const pg = new Client(pgConfig);
    await pg.connect();
    console.log(`[OK] Conectado ao PostgreSQL: ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}\n`);

    try {
        await pg.query('BEGIN');

        // 1. Localizar o usuario pelo e-mail
        const userRes = await pg.query(
            `SELECT id, name, email, whatsapp FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
            [TARGET_EMAIL]
        );

        if (userRes.rowCount === 0) {
            throw new Error(`Usuario com email '${TARGET_EMAIL}' nao encontrado na tabela users.`);
        }

        const user = userRes.rows[0];
        console.log(`[1/4] Usuario encontrado:`, user);

        // 2. Localizar o maior plano (PRO ou PREMIUM) em subscription_plan_configs
        let planRes = await pg.query(
            `SELECT * FROM subscription_plan_configs
             WHERE UPPER(TRIM(tier)) IN ('PRO', 'PREMIUM')
             ORDER BY "monthlyPrice" DESC NULLS LAST
             LIMIT 1`
        );

        let planConfig;
        if (planRes.rowCount === 0) {
            const newPlanId = crypto.randomUUID();
            const insertPlan = await pg.query(
                `INSERT INTO subscription_plan_configs
                    (id, tier, description, features, "monthlyPrice", "annualDiscountPercent", "trialEnabled", "trialDays", "trialPrice", "isActive", "createdAt", "updatedAt")
                 VALUES ($1, 'PRO', 'Para traders profissionais', $2, 1997, 20, false, 0, 0, true, NOW(), NOW())
                 RETURNING *`,
                [newPlanId, JSON.stringify(['Tudo do Básico', 'Análises Avançadas', 'Sem Limites', 'Suporte VIP'])]
            );
            planConfig = insertPlan.rows[0];
            console.log(`[2/4] Plano PRO criado automaticamente:`, { id: planConfig.id, tier: planConfig.tier });
        } else {
            planConfig = planRes.rows[0];
            if (!planConfig.isActive) {
                await pg.query(`UPDATE subscription_plan_configs SET "isActive" = true WHERE id = $1`, [planConfig.id]);
            }
            console.log(`[2/4] Maior plano localizado:`, {
                id: planConfig.id,
                tier: planConfig.tier,
                monthlyPrice: planConfig.monthlyPrice,
            });
        }

        // 3. Desativar assinaturas anteriores pendentes/ativas para evitar duplicidade e ativar a nova assinatura PRO ANUAL (1 ano)
        await pg.query(
            `UPDATE subscriptions
             SET status = 'EXPIRED', "updatedAt" = NOW()
             WHERE "userId" = $1 AND status IN ('ACTIVE', 'APPROVAL_PENDING', 'APPROVED')`,
            [user.id]
        );

        const newSubId = crypto.randomUUID();
        const reference = `ADMIN_PRO_${Date.now()}`;
        const insertSub = await pg.query(
            `INSERT INTO subscriptions
                (id, "userId", "planConfigId", "paymentReference", status, cycle, "currentPeriodEnd", "followUpSent", "paymentMethod", "createdAt", "updatedAt")
             VALUES
                ($1, $2, $3, $4, 'ACTIVE', 'YEARLY', NOW() + INTERVAL '1 year', false, 'admin_manual', NOW(), NOW())
             RETURNING id, "userId", "planConfigId", "paymentReference", status, cycle, "currentPeriodEnd"`,
            [newSubId, user.id, planConfig.id, reference]
        );

        const activeSub = insertSub.rows[0];
        console.log(`[3/4] Assinatura PRO/PREMIUM (YEARLY) ativada com sucesso:`, activeSub);

        // 4. Criar notificacao no painel para o usuario (se a tabela notifications existir)
        try {
            await pg.query(
                `INSERT INTO notifications (id, "userId", title, message, read, "createdAt")
                 VALUES ($1, $2, $3, $4, false, NOW())`,
                [
                    crypto.randomUUID(),
                    user.id,
                    'Plano PRO Ativado! 🎉',
                    `Sua assinatura do maior plano (${planConfig.tier} - Anual) foi ativada com sucesso até ${new Date(activeSub.currentPeriodEnd).toLocaleDateString('pt-BR')}.`,
                ]
            );
            console.log(`[4/4] Notificacao enviada para o painel do usuario.`);
        } catch (notifErr) {
            console.log(`[4/4] Aviso: tabela notifications ignorada (${notifErr.message}).`);
        }

        await pg.query('COMMIT');
        console.log('\n================================================================================');
        console.log(` SUCESSO! ${user.email} (${user.id}) ESTA COM O PLANO ${planConfig.tier} (PREMIUM) ATIVO!`);
        console.log('================================================================================');
    } catch (err) {
        await pg.query('ROLLBACK').catch(() => {});
        console.error('\n[ERRO AO ATIVAR PLANO]:', err.message);
        process.exitCode = 1;
    } finally {
        await pg.end();
    }
}

activateMaxPlan();
