import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SessionService } from './session.service';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';

import { TechnicalJournal } from './technical-journal.entity';
import { MentalLog } from './mental-log.entity';

import { UserEntity } from '../users/user.entity';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WeeklyReportService } from './weekly-report.service';
import { RiskManagementService } from './risk-management.service';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([TradeEntity, AccountEntity, MentalLog, TechnicalJournal, UserEntity]),
        EmailModule,
        NotificationsModule,
        PaymentModule
    ],
    controllers: [DashboardController],
    providers: [DashboardService, SessionService, WeeklyReportService, RiskManagementService],
    exports: [DashboardService, SessionService]
})
export class DashboardModule { }
