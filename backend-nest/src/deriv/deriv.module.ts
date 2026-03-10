import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DerivAuthEntity } from './entities/deriv-auth.entity';
import { DerivTransactionEntity } from './entities/deriv-transaction.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';
import { DerivService } from './deriv.service';
import { DerivClient } from './deriv.client';
import { DerivController } from './deriv.controller';
import { UsersModule } from '../users/users.module';
import { Mt5Module } from '../mt5/mt5.module';
import { NormalizationModule } from '../import/normalization/normalization.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([DerivAuthEntity, DerivTransactionEntity, TradeEntity, AccountEntity]),
        UsersModule,
        Mt5Module, // Need for saving trades
        NormalizationModule
    ],
    providers: [DerivService, DerivClient],
    controllers: [DerivController],
    exports: [DerivService],
})
export class DerivModule { }
