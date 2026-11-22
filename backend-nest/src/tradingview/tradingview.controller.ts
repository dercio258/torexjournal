import { Controller, Get, Post, Body, Query, Req, UseGuards, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { TradingViewService } from './tradingview.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanPermissionService, PlanTier } from '../payment/plan-permission.service';

const DAY_MS = 86_400_000;

/** Replay history allowance per plan. Enforced on the server, not just displayed. */
export const REPLAY_LIMITS: Record<PlanTier, { maxDays: number; maxBars: number }> = {
    [PlanTier.FREE]: { maxDays: 15, maxBars: 350 },
    [PlanTier.BASIC]: { maxDays: 45, maxBars: 800 },
    [PlanTier.PRO]: { maxDays: 365, maxBars: 2500 },
    [PlanTier.PREMIUM]: { maxDays: 365, maxBars: 2500 },
};

@Controller('tradingview')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.PRO)
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
            isPaid: tier !== PlanTier.FREE,
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
        const { tier, maxBars, earliestTs } = await this.limitsFor(req);
        const requested = parseInt(range, 10) || maxBars;
        const toTs = to ? parseInt(to, 10) : undefined;
        const parsedFromParam = from ? parseInt(from, 10) : undefined;

        if (tier === PlanTier.FREE && toTs !== undefined && toTs < earliestTs) {
            return [];
        }

        const fromTs =
            tier === PlanTier.FREE
                ? Math.max(earliestTs, parsedFromParam && parsedFromParam > 0 ? parsedFromParam : earliestTs)
                : parsedFromParam && parsedFromParam > 0
                  ? Math.max(0, parsedFromParam - 45 * DAY_MS)
                  : toTs && toTs < earliestTs
                    ? undefined
                    : earliestTs;

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

    /**
     * Paginated 500-candle historical batch endpoint for Replay & Backtesting sessions.
     * Supports cursor-based backward loading (`cursorTo`) and date-window bounding (`from`, `to`).
     */
    @Get('candles/batch')
    async getCandlesBatch(
        @Req() req: any,
        @Query('symbol') symbol: string,
        @Query('timeframe') timeframe: string = '15m',
        @Query('chunkSize') chunkSize?: string,
        @Query('chunkIndex') chunkIndex?: string,
        @Query('cursorTo') cursorTo?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        const { tier, maxBars, earliestTs } = await this.limitsFor(req);
        const parsedChunkSize = Math.min(parseInt(chunkSize || '500', 10) || 500, maxBars);
        const parsedChunkIndex = parseInt(chunkIndex || '0', 10) || 0;
        const parsedCursorTo = cursorTo ? parseInt(cursorTo, 10) : undefined;
        const parsedTo = to ? parseInt(to, 10) : undefined;
        const parsedFromParam = from ? parseInt(from, 10) : undefined;

        if (
            tier === PlanTier.FREE &&
            ((parsedTo !== undefined && parsedTo < earliestTs) ||
                (parsedCursorTo !== undefined && parsedCursorTo < earliestTs))
        ) {
            return { candles: [], hasMore: false, nextCursorTo: null, limitApplied: 'FREE_MAX_DAYS' };
        }

        // Preserve at least 45 days of pre-session lookback context before `from` on paid plans; FREE enforces strict earliestTs floor
        const lookbackSafeFrom =
            tier === PlanTier.FREE
                ? Math.max(earliestTs, parsedFromParam && parsedFromParam > 0 ? parsedFromParam : earliestTs)
                : parsedFromParam && parsedFromParam > 0
                  ? Math.max(0, parsedFromParam - 45 * DAY_MS)
                  : undefined;
        const effectiveEarliestTs =
            tier === PlanTier.FREE
                ? earliestTs
                : lookbackSafeFrom !== undefined ||
                    (parsedCursorTo && parsedCursorTo < earliestTs) ||
                    (parsedTo && parsedTo < earliestTs)
                  ? lookbackSafeFrom
                  : earliestTs;

        try {
            return await this.tvService.getCandlesBatch(symbol, timeframe, {
                chunkSize: parsedChunkSize,
                chunkIndex: parsedChunkIndex,
                cursorTo: parsedCursorTo,
                fromTs: lookbackSafeFrom ?? effectiveEarliestTs,
                toTs: parsedTo,
                earliestTs: effectiveEarliestTs,
            });
        } catch (error) {
            throw new ServiceUnavailableException(`Falha ao carregar lote de velas TradingView: ${error.message}`);
        }
    }

    /**
     * Pre-warms server cache for multiple symbol/window batches during an MT5/Deriv Sync session creation.
     */
    @Post('candles/prefetch')
    async prefetchBatches(
        @Req() req: any,
        @Body() body: {
            items: Array<{
                symbol: string;
                timeframe?: string;
                toTs?: number;
                fromTs?: number;
                chunkSize?: number;
            }>;
        },
    ) {
        const { earliestTs } = await this.limitsFor(req);
        const items = Array.isArray(body?.items) ? body.items.slice(0, 8) : [];
        const results: Array<{ symbol: string; timeframe: string; bars: number; ok: boolean }> = [];

        for (const item of items) {
            const tf = item.timeframe || '15m';
            try {
                const batch = await this.tvService.getCandlesBatch(item.symbol, tf, {
                    chunkSize: item.chunkSize || 500,
                    cursorTo: item.toTs,
                    toTs: item.toTs,
                    fromTs: item.fromTs,
                    earliestTs,
                });
                results.push({
                    symbol: item.symbol,
                    timeframe: tf,
                    bars: batch.candles.length,
                    ok: true,
                });
            } catch (_) {
                results.push({
                    symbol: item.symbol,
                    timeframe: tf,
                    bars: 0,
                    ok: false,
                });
            }
        }

        return { prefetched: results.filter(r => r.ok).length, results };
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
