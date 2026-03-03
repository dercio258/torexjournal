import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Mt5Controller } from './mt5.controller';
import { Mt5Service } from './mt5.service';
import { Mt5Processor } from './mt5.processor';
import { AccountEntity } from '../account/account.entity';
import { PositionEntity } from './position.entity';
import { TradeEntity } from './trade.entity';

import { Mt5Gateway } from './mt5.gateway';

import { Mt5TcpServer } from '../mt5-tcp.server';

import { Mt5RedisSubscriber } from './mt5-redis-subscriber.service';
import { TradeHistoryEntity } from './trade-history.entity';
import { MarketTickEntity } from './market-tick.entity';
import { CloudInstanceEntity } from './cloud-instance.entity';
import { Mt5InstanceService } from './mt5-instance.service';
import { ImportController } from '../import/import.controller';

import { ReportParserService } from '../import/report-parser.service';
import { ImportLog } from './import-log.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([AccountEntity, PositionEntity, TradeEntity, TradeHistoryEntity, MarketTickEntity, CloudInstanceEntity, ImportLog]),
        BullModule.registerQueue({
            name: 'mt5-data',
        }),
        BullModule.registerQueue({
            name: 'email-queue',
        }),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get<string>('JWT_SECRET'),
                signOptions: { expiresIn: '1d' },
            }),
        }),
    ],
    controllers: [Mt5Controller, ImportController],
    providers: [Mt5Service, Mt5Gateway, Mt5Processor, Mt5TcpServer, Mt5RedisSubscriber, Mt5InstanceService, ReportParserService],
    exports: [Mt5Service, Mt5InstanceService]
})
export class Mt5Module { }
