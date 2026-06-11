import { Controller, Get, Query, UseGuards, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { OandaService } from './oanda.service';
import { MarketDataParserService } from './market-data-parser.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';

@Controller('market-data')
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class MarketDataController {
    constructor(
        private readonly oandaService: OandaService,
        private readonly marketDataParser: MarketDataParserService
    ) { }

    @Get('candles')
    async getCandles(
        @Query('symbol') symbol: string,
        @Query('from') from: string,
        @Query('to') to: string,
        @Query('granularity') granularity: string = 'M5',
    ) {
        const fromDate = new Date(from);
        const toDate = new Date(to);

        // Add a buffer to 'from' and 'to' if needed, or rely on frontend to pass correct range.
        // For trade replay, we might want some context before and after.

        return this.oandaService.getCandles(symbol, fromDate, toDate, granularity);
    }

    @Post('upload-mt5')
    @UseInterceptors(FileInterceptor('file'))
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
