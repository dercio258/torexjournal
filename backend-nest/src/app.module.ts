import * as dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '../.env' });
dotenv.config({ path: 'backend-nest/.env' });

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join, isAbsolute } from 'path';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import Redis from 'ioredis';
import Keyv from 'keyv';
import { IoRedisKeyvStore } from './common/cache/ioredis-keyv.store';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { SecurityModule } from './common/security/security.module';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { ObservabilityModule } from './common/observability/observability.module';
import { DatabaseIndexBootstrapService } from './common/database/database-index-bootstrap.service';

import { Mt5Module } from './mt5/mt5.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PaymentModule } from './payment/payment.module';
import { AccountModule } from './account/account.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { MarketDataModule } from './market-data/market-data.module';
import { AiModule } from './ai/ai.module';
import { AlertsModule } from './alerts/alerts.module';
import { ClickHouseModule } from './clickhouse/clickhouse.module';
import { AnalyticsModule } from './analytics/analytics.module';

// Módulos adicionais para o Servidor Principal (desativados quando MT5_DEDICATED_SERVER=true)
import { DerivModule } from './deriv/deriv.module';
import { NetworkModule } from './network/network.module';
import { TradingViewModule } from './tradingview/tradingview.module';
import { EconomicCalendarModule } from './economic-calendar/economic-calendar.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';

const isMt5Dedicated = process.env.MT5_DEDICATED_SERVER === 'true';

const appImports: any[] = [
  SecurityModule,
  ObservabilityModule,
  ClickHouseModule,
  ScheduleModule.forRoot(),
  EventEmitterModule.forRoot(),

  ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: ['.env', '../.env', 'backend-nest/.env'],
  }),
  // Cache Module (Global)
  CacheModule.registerAsync({
    isGlobal: true,
    imports: [ConfigModule],
    useFactory: async (configService: ConfigService) => {
      const host = configService.get<string>('REDIS_HOST') || '127.0.0.1';
      const port = Number(configService.get<number>('REDIS_PORT') || 6379);
      const password = configService.get<string>('REDIS_PASSWORD');
      const redisClient = new Redis({
        host,
        port,
        password: password || undefined,
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
      });
      const keyvStore = new IoRedisKeyvStore(redisClient);
      const keyvInstance = new Keyv({
        store: keyvStore,
        namespace: '',
        useKeyPrefix: false,
      });
      return {
        stores: [keyvInstance],
        ttl: 600000,
      };
    },
    inject: [ConfigService],
  }),
  // Rate Limiting (Global, Redis-backed via RedisThrottlerStorage)
  ThrottlerModule.forRootAsync({
    imports: [ConfigModule, SecurityModule],
    inject: [ConfigService, RedisThrottlerStorage],
    useFactory: (_config: ConfigService, storage: RedisThrottlerStorage) => ({
      throttlers: [
        {
          ttl: 60000, // 1 minute
          limit: 100, // 100 requests per minute limit
        },
      ],
      storage,
    }),
  }),
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    useFactory: (configService: ConfigService) => {
      const isProd = (configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';
      const dbPass = configService.get<string>('DB_PASS');
      if (isProd && (!dbPass || dbPass === 'postgres')) {
        throw new Error('CRITICAL SECURITY ERROR: DB_PASS ausente ou inseguro em produção.');
      }
      return {
        type: 'postgres',
        host: configService.get<string>('DB_HOST', '127.0.0.1'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USER', 'postgres'),
        password: dbPass ?? 'postgres',
        database: configService.get<string>('DB_NAME', 'trading_cossa'),
        autoLoadEntities: true,
        synchronize: !isProd && configService.get<string>('DB_SYNCHRONIZE') === 'true',
        logging: false,
        extra: {
          max: Number(configService.get<number>('DB_POOL_MAX') ?? process.env.DB_POOL_MAX ?? 25),
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        },
      };
    },
    inject: [ConfigService],
  }),
  BullModule.forRootAsync({
    imports: [ConfigModule],
    useFactory: async (configService: ConfigService) => ({
      redis: {
        host: configService.get('REDIS_HOST'),
        port: configService.get('REDIS_PORT'),
        password: configService.get('REDIS_PASSWORD'),
      },
      prefix: configService.get('REDIS_PREFIX', '{cossa_trading}'),
    }),
    inject: [ConfigService],
  }),
  Mt5Module,
  AuthModule,
  UsersModule,
  PaymentModule,
  AccountModule,
  DashboardModule,
  NotificationsModule,
  MarketDataModule,
  AlertsModule,
  AnalyticsModule,
  // Carrega módulos web completos apenas no servidor principal
  ...(isMt5Dedicated
    ? []
    : [
      AdminModule,
      AiModule,
      DerivModule,
      NetworkModule,
      TradingViewModule,
      EconomicCalendarModule,
      LeaderboardModule,
    ]),
];

@Module({
  imports: appImports,
  controllers: [],
  providers: [
    DatabaseIndexBootstrapService,
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule { }
