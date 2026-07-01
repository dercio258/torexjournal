import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
    const redis = new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
    });

    console.log('Connecting to Redis...');
    const userId = '12e2028e-221b-48e7-8be7-a2c1cab4e51b';
    
    // Find all keys with the user id
    const keys = await redis.keys(`*${userId}*`);
    console.log(`Found ${keys.length} keys in Redis matching the user ID:`, keys);

    if (keys.length > 0) {
        await redis.del(...keys);
        console.log('Successfully deleted all matching cache keys.');
    } else {
        console.log('No cache keys found.');
    }

    // Also manually delete common keys without prefix just in case
    const manualKeys = [
        `{cossa_trading}user_plan_tier:${userId}`,
        `{cossa_trading}user_subscription_status:${userId}`,
        `user_plan_tier:${userId}`,
        `user_subscription_status:${userId}`
    ];
    for (const key of manualKeys) {
        const deleted = await redis.del(key);
        if (deleted) {
            console.log(`Manually deleted key: ${key}`);
        }
    }

    await redis.quit();
    console.log('Done.');
}

run().catch(console.error);
