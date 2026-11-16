import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JournalService } from './journal.service';
import { SessionService } from './session.service';
import { TradeEntity } from '../mt5/trade.entity';
import { PositionEntity } from '../mt5/position.entity';
import { AccountEntity } from '../account/account.entity';

import { TechnicalJournal } from './technical-journal.entity';
import { MentalLog } from './mental-log.entity';
import { BacktestSession } from './backtest-session.entity';
import {
    BacktestStrategyEntity,
    BacktestSessionBlobEntity,
    BacktestHypothesisEntity,
} from './backtest-normalized.entity';
import {
    DailyNoteEntity,
    TradeNoteEntity,
    GeneralNoteEntity,
} from './journal-notes.entity';

import { UserEntity } from '../users/user.entity';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WeeklyReportService } from './weekly-report.service';
import { RiskManagementService } from './risk-management.service';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            TradeEntity,
            PositionEntity,
            AccountEntity,
            MentalLog,
            TechnicalJournal,
            BacktestSession,
            BacktestStrategyEntity,
            BacktestSessionBlobEntity,
            BacktestHypothesisEntity,
            DailyNoteEntity,
            TradeNoteEntity,
            GeneralNoteEntity,
            UserEntity,
        ]),
        EmailModule,
        NotificationsModule,
        PaymentModule,
    ],
    controllers: [DashboardController],
    providers: [
        DashboardService,
        JournalService,
        SessionService,
        WeeklyReportService,
        RiskManagementService,
    ],
    exports: [DashboardService, JournalService, SessionService],
})
export class DashboardModule {}
