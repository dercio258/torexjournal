import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join, isAbsolute } from 'path';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import * as redisStore from 'cache-manager-redis-store';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';

import { Mt5Module } from './mt5/mt5.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PaymentModule } from './payment/payment.module';
import { AccountModule } from './account/account.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { NetworkModule } from './network/network.module';
import { TradingViewModule } from './tradingview/tradingview.module';
import { FinnhubModule } from './finnhub/finnhub.module';
import { MarketDataModule } from './market-data/market-data.module';
import { DerivModule } from './deriv/deriv.module';
import { AiModule } from './ai/ai.module';

import { AlertsModule } from './alerts/alerts.module';
import { ClickHouseModule } from './clickhouse/clickhouse.module';

@Module({
  imports: [
    ClickHouseModule,
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),

    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    // Cache Module (Global)
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        store: redisStore as unknown as any,
        host: configService.get('REDIS_HOST'),
        port: configService.get('REDIS_PORT'),
        password: configService.get('REDIS_PASSWORD'),
        ttl: 600000, // 10 minutes default (in ms for cache-manager v5+)
      }),
      inject: [ConfigService],
    }),
    // Rate Limiting (Global)
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [{
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute limit
      }],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', '127.0.0.1'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USER', 'postgres'),
        password: configService.get<string>('DB_PASS', 'postgres'),
        database: configService.get<string>('DB_NAME', 'trading_cossa'),
        autoLoadEntities: true,
        synchronize: true,
        logging: false,
      }),
      inject: [ConfigService],
    }),
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const customPath = configService.get<string>('FRONTEND_BUILD_PATH');
        const rootPath = customPath 
          ? (isAbsolute(customPath) ? customPath : join(process.cwd(), customPath))
          : join(__dirname, '..', '..', 'client', 'dist');
        
        const uploadsPath = join(__dirname, '..', 'uploads');
        
        return [
          {
            rootPath,
            exclude: ['/api/(.*)'],
          },
          {
            rootPath: uploadsPath,
            serveRoot: '/uploads',
            serveStaticOptions: {
              decorateReply: false,
            } as any
          }
        ];
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
    FinnhubModule,
    AuthModule,
    UsersModule,
    PaymentModule,
    AccountModule,
    DashboardModule,
    NotificationsModule,
    AdminModule,
    NetworkModule,
    TradingViewModule,
    MarketDataModule,
    DerivModule,
    AiModule,
    AlertsModule,
  ],

  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule { }
