import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import * as path from 'path';

// Prioritize backend-nest/.env and fallback to cwd
config({ path: path.resolve(__dirname, '../.env') });
config({ path: path.resolve(process.cwd(), '.env') });
config({ path: path.resolve(process.cwd(), 'backend-nest/.env') });

export const AppDataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres',
    database: process.env.DB_NAME || 'trading_cossa',
    synchronize: false,
    logging: false,
    extra: {
        max: Number(process.env.DB_POOL_MAX || 25),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    },
    entities: [__dirname + '/**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    subscribers: [],
});
