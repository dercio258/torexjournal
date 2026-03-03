import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SessionService } from './session.service';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';

import { TechnicalJournal } from './technical-journal.entity';
import { MentalLog } from './mental-log.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([TradeEntity, AccountEntity, MentalLog, TechnicalJournal])
    ],
    controllers: [DashboardController],
    providers: [DashboardService, SessionService],
    exports: [SessionService]
})
export class DashboardModule { }
