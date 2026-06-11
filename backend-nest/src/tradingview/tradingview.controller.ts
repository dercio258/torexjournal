import { Controller, Get, Query, UseGuards, InternalServerErrorException } from '@nestjs/common';
import { TradingViewService } from './tradingview.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

@Controller('tradingview')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.PREMIUM)
export class TradingViewController {
    constructor(private readonly tvService: TradingViewService) { }

    @Get('search')
    async search(@Query('q') query: string, @Query('type') type: string, @Query('exchange') exchange: string) {
        try {
            return await this.tvService.searchSymbols(query, type, exchange);
        } catch (error) {
            throw new InternalServerErrorException(error.message);
        }
    }

    @Get('candles')
    async getCandles(
        @Query('symbol') symbol: string,
        @Query('timeframe') timeframe: string,
        @Query('range') range: string
    ) {
        try {
            const rangeNum = parseInt(range) || 100;
            return await this.tvService.getCandles(symbol, timeframe, rangeNum);
        } catch (error) {
            throw new InternalServerErrorException(error.message);
        }
    }

    @Get('quote')
    async getQuote(@Query('symbol') symbol: string) {
        try {
            return await this.tvService.getQuote(symbol);
        } catch (error) {
            throw new InternalServerErrorException(error.message);
        }
    }
}
