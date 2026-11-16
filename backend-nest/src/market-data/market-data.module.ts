import { Module } from '@nestjs/common';
import { MarketDataController } from './market-data.controller';
import { MarketDataParserService } from './market-data-parser.service';
import { PaymentModule } from '../payment/payment.module';
import { TradingViewModule } from '../tradingview/tradingview.module';

@Module({
    imports: [
        TradingViewModule,
        PaymentModule,
    ],
    controllers: [MarketDataController],
    providers: [MarketDataParserService],
    exports: [MarketDataParserService],
})
export class MarketDataModule { }
