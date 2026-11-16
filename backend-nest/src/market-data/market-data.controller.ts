import { Controller, Get, Query, UseGuards, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { MarketDataParserService } from './market-data-parser.service';
import { TradingViewService } from '../tradingview/tradingview.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

const LEGACY_GRANULARITY_MAP: Record<string, string> = {
    M1: '1m',
    M5: '5m',
    M15: '15m',
    M30: '30m',
    H1: '1h',
    H2: '2h',
    H4: '4h',
    D: '1D',
    D1: '1D',
    W: '1W',
    M: '1M',
};

function parseOptionalTimestamp(value?: string): number | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
        const num = Number(trimmed);
        return Number.isFinite(num) && num > 0 ? (num < 1e12 ? num * 1000 : num) : undefined;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

@Controller('market-data')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class MarketDataController {
    constructor(
        private readonly tradingViewService: TradingViewService,
        private readonly marketDataParser: MarketDataParserService
    ) { }

    @Get('candles')
    async getCandles(
        @Query('symbol') symbol: string,
        @Query('from') from: string,
        @Query('to') to: string,
        @Query('granularity') granularity: string = 'M5',
    ) {
        const normalizedKey = (granularity || 'M5').trim().toUpperCase();
        const tf = LEGACY_GRANULARITY_MAP[normalizedKey] || granularity || '5m';
        const fromTs = parseOptionalTimestamp(from);
        const toTs = parseOptionalTimestamp(to);

        const batch = await this.tradingViewService.getCandlesBatch(symbol || 'XAUUSD', tf, {
            fromTs,
            toTs,
            chunkSize: 500,
        });

        return batch.candles.map((c) => ({
            timestamp: c.timestamp,
            time: new Date(c.timestamp).toISOString(),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
        }));
    }

    @Post('upload-mt5')
    @UseInterceptors(new FastifyFileInterceptor('file'))
    async uploadMt5Csv(@UploadedFile() file: any) {
        if (!file) throw new BadRequestException('No file uploaded');
        
        try {
            // Buffer to UTF-16LE if needed, but standard UTF-8/ISO might work for MT5
            // Let's try to detect format or just use toString()
            const content = file.buffer.toString('utf-8');
            return this.marketDataParser.parseMt5Csv(content);
        } catch (e) {
            throw new BadRequestException(`Failed to parse MT5 CSV: ${e.message}`);
        }
    }
}
