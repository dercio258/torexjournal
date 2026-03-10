import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class OandaService {
    private readonly logger = new Logger(OandaService.name);
    private readonly apiKey: string;
    private readonly baseUrl = 'https://api-fxtrade.oanda.com/v3'; // Live URL. Use 'https://api-fxpractice.oanda.com/v3' for Demo if needed.

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) {
        this.apiKey = this.configService.get<string>('Oanda_API_key');
        if (!this.apiKey) {
            this.logger.warn('Oanda_API_key is not set in environment variables.');
        }
    }

    /**
     * Map MT5 symbol (e.g., 'EURUSD') to OANDA symbol (e.g., 'EUR_USD').
     */
    private mapSymbolToOanda(symbol: string): string {
        // Strip any suffix (e.g. 'm', 'pro', etc.) - simplistic approach: take first 6 chars if they are uppercase letters
        let cleanSymbol = symbol;

        // If > 6 chars, try to extract the first 6 chars if they look like a pair
        if (symbol.length > 6) {
            const match = symbol.match(/^([A-Z]{6})/);
            if (match) {
                cleanSymbol = match[1];
            }
        }

        // Standard 6-char pair
        if (cleanSymbol.length === 6 && /^[A-Z]+$/.test(cleanSymbol)) {
            return `${cleanSymbol.substring(0, 3)}_${cleanSymbol.substring(3)}`;
        }

        // Handle explicit cases or return as is if formatted correctly
        if (cleanSymbol.includes('_')) return cleanSymbol;

        // Fallback for XAUUSD -> XAU_USD
        if (cleanSymbol === 'XAUUSD') return 'XAU_USD';

        return cleanSymbol;
    }

    async getCandles(symbol: string, from: Date, to: Date, granularity: string = 'M1') {
        const oandaSymbol = this.mapSymbolToOanda(symbol);
        const url = `${this.baseUrl}/instruments/${oandaSymbol}/candles`;

        try {
            const response = await lastValueFrom(
                this.httpService.get(url, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    params: {
                        from: from.toISOString(),
                        to: to.toISOString(),
                        granularity: granularity,
                        price: 'M', // Midpoint candles
                    },
                }),
            );

            return response.data.candles.map(c => ({
                time: c.time,
                volume: c.volume,
                open: Number(c.mid.o),
                high: Number(c.mid.h),
                low: Number(c.mid.l),
                close: Number(c.mid.c),
            }));

        } catch (error) {
            const axiosError = error as AxiosError;
            this.logger.error(`Failed to fetch candles from OANDA for ${oandaSymbol}: ${axiosError.message}`, axiosError.response?.data);

            if (axiosError.response?.status === 401) {
                // Return 502 Bad Gateway so the frontend doesn't confuse this with a JWT 401 and log the user out
                throw new HttpException('OANDA API Unauthorized. Check API Key.', HttpStatus.BAD_GATEWAY);
            }
            if (axiosError.response?.status === 400) {
                throw new HttpException(`OANDA API Bad Request: ${JSON.stringify(axiosError.response.data)}`, HttpStatus.BAD_REQUEST);
            }

            throw new HttpException('Failed to fetch market data', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
