import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config(); // Load .env file

config(); // Load .env file

export const AppDataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres',
    database: process.env.DB_NAME || 'trading_cossa',
    synchronize: false,
    logging: false,
    entities: [__dirname + '/**/*.entity{.ts,.js}'],
    migrations: ['src/migrations/*.ts'],
    subscribers: [],
});
