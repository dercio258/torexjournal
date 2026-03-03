import { Module } from '@nestjs/common';
import { TradingViewService } from './tradingview.service';
import { TradingViewController } from './tradingview.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
    imports: [HttpModule],
    controllers: [TradingViewController],
    providers: [TradingViewService],
    exports: [TradingViewService],
})
export class TradingViewModule { }
