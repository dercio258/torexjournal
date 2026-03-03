import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { OandaService } from './oanda.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // Assuming you have auth

@Controller('market-data')
export class MarketDataController {
    constructor(private readonly oandaService: OandaService) { }

    @UseGuards(JwtAuthGuard)
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
}
