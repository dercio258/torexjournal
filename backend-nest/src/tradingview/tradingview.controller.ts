import { Controller, Get, Query, Req, UseGuards, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { TradingViewService } from './tradingview.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanPermissionService, PlanTier } from '../payment/plan-permission.service';

const DAY_MS = 86_400_000;

/** Replay history allowance per plan. Enforced on the server, not just displayed. */
export const REPLAY_LIMITS: Record<PlanTier, { maxDays: number; maxBars: number }> = {
    [PlanTier.FREE]: { maxDays: 15, maxBars: 350 },
    [PlanTier.BASIC]: { maxDays: 45, maxBars: 800 },
    [PlanTier.PREMIUM]: { maxDays: 365, maxBars: 2500 },
};

@Controller('tradingview')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.FREE)
export class TradingViewController {
    constructor(
        private readonly tvService: TradingViewService,
        private readonly planPermissionService: PlanPermissionService,
    ) { }

    private async limitsFor(req: any) {
        const userId = req?.user?.id || req?.user?.userId;
        const tier: PlanTier = userId ? await this.planPermissionService.getUserPlan(userId) : PlanTier.FREE;
        const limits = REPLAY_LIMITS[tier] ?? REPLAY_LIMITS[PlanTier.FREE];
        return { tier, ...limits, earliestTs: Date.now() - limits.maxDays * DAY_MS };
    }

    @Get('replay-limits')
    async getReplayLimits(@Req() req: any) {
        const { tier, maxDays, maxBars, earliestTs } = await this.limitsFor(req);
        return {
            tier,
            maxDays,
            maxBars,
            earliestTs,
            // ISO date; the client formats it in the user's locale.
            earliestDate: new Date(earliestTs).toISOString().slice(0, 10),
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
        const { maxBars, earliestTs } = await this.limitsFor(req);
        const requested = parseInt(range, 10) || maxBars;
        const toTs = to ? parseInt(to, 10) : undefined;
        // `from` can only narrow the window, never extend it past the plan.
        const fromTs = from ? Math.max(parseInt(from, 10) || 0, earliestTs) : earliestTs;

        try {
            return await this.tvService.getCandles(symbol, timeframe, {
                range: Math.min(Math.max(50, requested), maxBars),
                toTs,
                earliestTs: fromTs,
            });
        } catch (error) {
            // Explicit outage: the client shows "feed indisponível" instead of fake prices.
            throw new ServiceUnavailableException(`Feed TradingView indisponível: ${error.message}`);
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
