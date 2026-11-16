import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { AccountEntity } from './account.entity';
import { AccountTransactionEntity } from './account-transaction.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { UsersModule } from '../users/users.module';
import { ClickHouseModule } from '../clickhouse/clickhouse.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([AccountEntity, AccountTransactionEntity, TradeEntity]),
        UsersModule,
        ClickHouseModule,
        PaymentModule,
    ],
    providers: [AccountService],
    controllers: [AccountController],
    exports: [AccountService],
})
export class AccountModule { }
