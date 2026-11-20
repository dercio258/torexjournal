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
import { BehaviorRetrainScheduler } from './behavior-retrain.scheduler';
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
import { TradingViewModule } from '../tradingview/tradingview.module';
import { EconomicCalendarModule } from '../economic-calendar/economic-calendar.module';
import { Mt5WorkerController } from './worker/mt5-worker.controller';
import { Mt5WorkerService } from './worker/mt5-worker.service';
import { Mt5ClusterBalancerService } from './worker/mt5-cluster-balancer.service';
import { WorkerAuthGuard } from './worker/worker-auth.guard';
import { UserEntity } from '../users/user.entity';
import { NotificationEntity } from '../notifications/notification.entity';
import { SessionEntity } from '../auth/session.entity';
import { getJwtSecret } from '../common/security/security.config';
import { DailyNoteEntity, TradeNoteEntity } from '../dashboard/journal-notes.entity';
import { TechnicalJournal } from '../dashboard/technical-journal.entity';
import { MentalLog } from '../dashboard/mental-log.entity';
import { AlertEntity } from '../alerts/alert.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            AccountEntity,
            PositionEntity,
            TradeEntity,
            TradeHistoryEntity,
            CloudInstanceEntity,
            ImportLog,
            UserEntity,
            SessionEntity,
            DailyNoteEntity,
            TradeNoteEntity,
            TechnicalJournal,
            MentalLog,
            AlertEntity,
            NotificationEntity,
        ]),
        NotificationsModule,
        NormalizationModule,
        AlertsModule,
        PaymentModule,
        EmailModule,
        DashboardModule,
        ...(process.env.MT5_DEDICATED_SERVER === 'true'
            ? []
            : [AiModule, TradingViewModule, EconomicCalendarModule]),
        BullModule.registerQueue({
            name: 'mt5-data',
            defaultJobOptions: { removeOnComplete: 200, removeOnFail: 200 },
        }),
        BullModule.registerQueue({
            name: 'behavioral-analysis',
            defaultJobOptions: { removeOnComplete: 200, removeOnFail: 200 },
        }),
        BullModule.registerQueue({
            name: 'trade-import',
            defaultJobOptions: { removeOnComplete: 200, removeOnFail: 200 },
        }),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => ({
                secret: getJwtSecret(configService),
                signOptions: { expiresIn: '1d' },
            }),
        }),
    ],
    controllers: [Mt5Controller, ImportController, Mt5WorkerController],
    providers: [
        Mt5Service,
        Mt5Gateway,
        Mt5Processor,
        TradeImportProcessor,
        BehavioralProcessor,
        BehaviorRetrainScheduler,
        Mt5TcpServer,
        Mt5RedisSubscriber,
        Mt5InstanceService,
        ReportParserService,
        Mt5WorkerService,
        Mt5ClusterBalancerService,
        WorkerAuthGuard,
    ],
    exports: [
        Mt5Service,
        Mt5InstanceService,
        Mt5WorkerService,
        Mt5ClusterBalancerService,
        BehaviorRetrainScheduler,
    ],
})
export class Mt5Module {}
