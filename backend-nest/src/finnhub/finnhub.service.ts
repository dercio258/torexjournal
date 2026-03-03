import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EconomicEvent } from './economic-event.entity';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

@Injectable()
export class FinnhubService {
    private readonly logger = new Logger(FinnhubService.name);
    private readonly apiKey: string;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        @InjectRepository(EconomicEvent)
        private readonly eventRepo: Repository<EconomicEvent>
    ) {
        this.apiKey = this.configService.get<string>('FINNHUB_TOKEN');
    }

    async getEconomicCalendar() {
        if (!this.apiKey) {
            this.logger.warn('FINNHUB_TOKEN not configured');
            return [];
        }

        // 1. Define Range (Today to +7 days)
        const today = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(today.getDate() + 7);

        const from = today.toISOString().split('T')[0];
        const to = nextWeek.toISOString().split('T')[0];

        // 2. Check Cache
        // Simple cache policy: if we have events for this range created recently (e.g. within 6 hours), return them.
        // Or simpler: just try to fetch from DB first.
        // To ensure freshness, we can check the count or 'createdAt' of the latest entry.

        const cachedEvents = await this.eventRepo.createQueryBuilder('event')
            .where('event.time >= :from', { from: today.toISOString() }) // filter by time
            .orderBy('event.time', 'ASC')
            .getMany();

        // Check if cache is stale?
        // Let's assume if we have data for 'today', we might still want to refresh if it's old.
        // For simplicity: Refresh if no data found OR explicitly requested (not implemented yet).
        // A better approach: Run a cron job to refresh. 
        // HERE: If cache is empty or very small, fetch.

        if (cachedEvents.length > 0) {
            const latestUpdate = cachedEvents[0].createdAt; // Approximate
            const ageDetails = (new Date().getTime() - new Date(latestUpdate).getTime()) / 1000 / 60; // minutes

            // If data is younger than 6 hours, return it
            if (ageDetails < 360) {
                return cachedEvents.map(e => this.mapEntityToDto(e));
            }
        }

        return this.fetchFromApi(from, to);
    }

    private async fetchFromApi(from: string, to: string) {
        try {
            const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${this.apiKey}`;
            this.logger.log(`Fetching Economic Calendar from ${from} to ${to}`);

            const { data } = await firstValueFrom(this.httpService.get(url));

            // Finnhub returns { economicCalendar: [...] } OR just [...] depending on endpoint version/wrapper.
            // Documentation says: { "economicCalendar": [ ... ] }

            const events = data.economicCalendar || data;

            if (!Array.isArray(events)) {
                this.logger.error('Invalid format from Finnhub', data);
                return [];
            }

            const entities: EconomicEvent[] = [];

            for (const item of events) {
                // Generate ID
                const uniqueString = `${item.time}-${item.country}-${item.event}`;
                const externalId = crypto.createHash('md5').update(uniqueString).digest('hex');

                const event = new EconomicEvent();
                event.externalId = externalId;
                event.time = item.time;
                event.currency = item.country; // Finnhub 'country' often corresponds to currency (US -> USD, EU -> EUR roughly, handled in frontend)
                event.event = item.event;
                event.impact = item.impact;
                event.actual = item.actual?.toString() || '';
                event.forecast = item.forecast?.toString() || '';
                event.previous = item.prev?.toString() || '';

                entities.push(event);
            }

            // Save/Upsert
            // TypeORM's save handles upsert if we match by ID, but we have externalId.
            // We'll use upsert.
            await this.eventRepo.upsert(entities, ['externalId']);

            // Return freshly saved data
            return entities.map(e => this.mapEntityToDto(e));

        } catch (e) {
            this.logger.error(`Failed to fetch from Finnhub: ${e.message}`);
            // Fallback to whatever is in DB
            return (await this.eventRepo.find({ order: { time: 'ASC' } })).map(e => this.mapEntityToDto(e));
        }
    }

    private mapEntityToDto(e: EconomicEvent) {
        return {
            id: e.externalId,
            time: e.time,
            currency: this.mapCountryToCurrency(e.currency), // Helper
            event: e.event,
            impact: e.impact,
            actual: e.actual,
            forecast: e.forecast,
            previous: e.previous
        };
    }

    private mapCountryToCurrency(country: string): string {
        const map = {
            'US': 'USD',
            'EU': 'EUR',
            'GB': 'GBP',
            'JP': 'JPY',
            'CA': 'CAD',
            'AU': 'AUD',
            'NZ': 'NZD',
            'CH': 'CHF',
            'CN': 'CNY'
        };
        return map[country] || country;
    }
}
