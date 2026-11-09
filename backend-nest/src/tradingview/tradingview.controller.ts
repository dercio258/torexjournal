import { Controller, Get, Query, Req, UseGuards, InternalServerErrorException } from '@nestjs/common';
import { TradingViewService } from './tradingview.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanPermissionService, PlanTier } from '../payment/plan-permission.service';

@Controller('tradingview')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.FREE)
export class TradingViewController {
    constructor(
        private readonly tvService: TradingViewService,
        private readonly planPermissionService: PlanPermissionService,
    ) { }

    @Get('replay-limits')
    async getReplayLimits(@Req() req: any) {
        const userId = req?.user?.id || req?.user?.userId;
        const tier = userId ? await this.planPermissionService.getUserPlan(userId) : PlanTier.FREE;
        const maxDays = tier === PlanTier.PREMIUM ? 365 : tier === PlanTier.BASIC ? 45 : 15;
        const maxBars = tier === PlanTier.PREMIUM ? 2500 : tier === PlanTier.BASIC ? 800 : 350;
        const earliestDate = new Date(Date.now() - maxDays * 86400000).toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
        });

        return {
            tier,
            maxDays,
            maxBars,
            earliestDate,
            isPaid: tier === PlanTier.PREMIUM || tier === PlanTier.BASIC,
        };
    }

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
        @Req() req: any,
        @Query('symbol') symbol: string,
        @Query('timeframe') timeframe: string,
        @Query('range') range: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        try {
            const userId = req?.user?.id || req?.user?.userId;
            const tier = userId ? await this.planPermissionService.getUserPlan(userId) : PlanTier.FREE;
            const maxAllowedBars = tier === PlanTier.PREMIUM ? 2500 : tier === PlanTier.BASIC ? 800 : 350;

            const requestedRange = parseInt(range, 10) || 350;
            const rangeNum = Math.min(Math.max(50, requestedRange), maxAllowedBars);
            const fromTs = from ? parseInt(from, 10) : undefined;
            const toTs = to ? parseInt(to, 10) : undefined;

            return await this.tvService.getCandles(symbol, timeframe, rangeNum, fromTs, toTs);
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
