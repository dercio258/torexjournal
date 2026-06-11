import { Module } from '@nestjs/common';
import { TradingViewService } from './tradingview.service';
import { TradingViewController } from './tradingview.controller';
import { HttpModule } from '@nestjs/axios';
import { PaymentModule } from '../payment/payment.module';

@Module({
    imports: [HttpModule, PaymentModule],
    controllers: [TradingViewController],
    providers: [TradingViewService],
    exports: [TradingViewService],
})
export class TradingViewModule { }
