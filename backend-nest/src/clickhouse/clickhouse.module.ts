import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@clickhouse/client';
import { ClickHouseService } from './clickhouse.service';
import { CLICKHOUSE_CLIENT } from './clickhouse.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CLICKHOUSE_CLIENT,
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('CLICKHOUSE_HOST') || 'http://localhost:8123';
        const username = configService.get<string>('CLICKHOUSE_USER') || 'default';
        const password = configService.get<string>('CLICKHOUSE_PASSWORD') || '';
        const database = configService.get<string>('CLICKHOUSE_DATABASE') || 'default';

        return createClient({
          host,
          username,
          password,
          database,
        });
      },
      inject: [ConfigService],
    },
    ClickHouseService,
  ],
  exports: [CLICKHOUSE_CLIENT, ClickHouseService],
})
export class ClickHouseModule {}
