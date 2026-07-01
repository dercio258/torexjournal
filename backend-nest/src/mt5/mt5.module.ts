import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { BullModule } from '@nestjs/bull';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Mt5Controller } from './mt5.controller';
import { Mt5Service } from './mt5.service';
import { Mt5Processor } from './mt5.processor';
import { TradeImportProcessor } from './trade-import.processor';
import { BehavioralProcessor } from './behavioral.processor';
import { AccountEntity } from '../account/account.entity';
import { PositionEntity } from './position.entity';
import { TradeEntity } from './trade.entity';

import { Mt5Gateway } from './mt5.gateway';

import { Mt5TcpServer } from '../mt5-tcp.server';

import { Mt5RedisSubscriber } from './mt5-redis-subscriber.service';
import { TradeHistoryEntity } from './trade-history.entity';
import { CloudInstanceEntity } from './cloud-instance.entity';
import { Mt5InstanceService } from './mt5-instance.service';
import { ImportController } from '../import/import.controller';

import { ReportParserService } from '../import/report-parser.service';
import { ImportLog } from './import-log.entity';
import { AiModule } from '../ai/ai.module';
import { NormalizationModule } from '../import/normalization/normalization.module';
import { AlertsModule } from '../alerts/alerts.module';
import { PaymentModule } from '../payment/payment.module';
import { EmailModule } from '../email/email.module';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([AccountEntity, PositionEntity, TradeEntity, TradeHistoryEntity, CloudInstanceEntity, ImportLog]),
        NotificationsModule,
        AiModule,
        NormalizationModule,
        AlertsModule,
        PaymentModule,
        EmailModule,
        DashboardModule,
        BullModule.registerQueue({
            name: 'mt5-data',
        }),
        BullModule.registerQueue({
            name: 'behavioral-analysis',
        }),
        BullModule.registerQueue({
            name: 'trade-import',
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
    providers: [Mt5Service, Mt5Gateway, Mt5Processor, TradeImportProcessor, BehavioralProcessor, Mt5TcpServer, Mt5RedisSubscriber, Mt5InstanceService, ReportParserService],
    exports: [Mt5Service, Mt5InstanceService]
})
export class Mt5Module { }
