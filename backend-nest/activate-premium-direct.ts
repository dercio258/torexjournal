import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
    const client = new Client({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'cossa_trading_user',
        password: process.env.DB_PASS || 'C0ssa@2026_db!',
        database: process.env.DB_NAME || 'cossa_trading',
    });

    console.log('Connecting to database directly...');
    await client.connect();
    console.log('Connected successfully.');

    const email = 'derciomatsope9@gmail.com';

    // 1. Find User ID
    const userRes = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
        console.error(`User with email ${email} not found!`);
        await client.end();
        return;
    }
    const userId = userRes.rows[0].id;
    console.log(`Found user: ${email} (ID: ${userId})`);

    // 2. Find or Create PREMIUM Plan Config
    let planRes = await client.query('SELECT id FROM subscription_plan_configs WHERE tier = $1 AND "isActive" = true LIMIT 1', ['PREMIUM']);
    let planId: string;

    if (planRes.rows.length === 0) {
        console.log('PREMIUM plan configuration not found. Creating one...');
        const newPlanRes = await client.query(
            `INSERT INTO subscription_plan_configs (id, tier, description, features, "monthlyPrice", "annualDiscountPercent", "trialEnabled", "trialDays", "trialPrice", "isActive") 
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            ['PREMIUM', 'Premium Plan Config', JSON.stringify(['all_features']), 20.00, 0, false, 0, 0.00, true]
        );
        planId = newPlanRes.rows[0].id;
        console.log(`Created PREMIUM plan configuration with ID: ${planId}`);
    } else {
        planId = planRes.rows[0].id;
        console.log(`Using existing PREMIUM plan configuration with ID: ${planId}`);
    }

    // 3. Deactivate any existing subscriptions
    await client.query('UPDATE subscriptions SET status = $1 WHERE "userId" = $2', ['CANCELLED', userId]);
    console.log('Cancelled any existing active subscriptions.');

    // 4. Create new ACTIVE subscription
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    const insertSubRes = await client.query(
        `INSERT INTO subscriptions (id, "userId", "planConfigId", status, cycle, "currentPeriodEnd", "paymentReference", "paymentMethod", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id`,
        [userId, planId, 'ACTIVE', 'YEARLY', oneYearFromNow, 'ADMIN_ACTIVATION_PREMIUM', 'ADMIN']
    );

    console.log(`Successfully activated PREMIUM plan for ${email} (Subscription ID: ${insertSubRes.rows[0].id})!`);
    console.log(`Expiry Date: ${oneYearFromNow.toISOString()}`);

    await client.end();
}

run().catch(async (err) => {
    console.error('Error executing script:', err);
});
