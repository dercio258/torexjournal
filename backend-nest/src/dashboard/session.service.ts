import { Injectable } from '@nestjs/common';
import * as ct from 'countries-and-timezones';
import { DateTime } from 'luxon';

export interface SessionResult {
    country_normalized: string;
    country_iso2: string;
    user_timezone_iana: string;
    timezone_confidence: 'high' | 'medium' | 'low';
    local_datetime: string;
    active_sessions: string[];
    is_overlap: boolean;
    sessions: {
        [key: string]: {
            open_in_user_tz: string;
            close_in_user_tz: string;
            is_open: boolean;
        };
    };
    warning?: string;
}

@Injectable()
export class SessionService {

    // Market Sessions in UTC (approximate standard times, handled via offsets internally if needed, but fixed ranges usually easier to map to user TZ)
    // Actually, market hours are usually 8am-5pm LOCAL time of that market.
    // Sydney: Australia/Sydney 08:00 - 17:00
    // Tokyo: Asia/Tokyo 09:00 - 18:00
    // London: Europe/London 08:00 - 17:00
    // New York: America/New_York 08:00 - 17:00

    calculateSession(country: string, datetimeUtc?: string, userRegion?: string): SessionResult {
        const dtUtc = datetimeUtc ? DateTime.fromISO(datetimeUtc, { zone: 'utc' }) : DateTime.utc();

        // 1. Normalize Country
        const countryData = this.normalizeCountry(country);
        if (!countryData) {
            // Fallback or Error
            return this.defaultErrorResult(country, dtUtc);
        }

        // 2. Determine Timezone
        const { timezone, confidence, warning } = this.determineTimezone(countryData, userRegion);

        // 3. Convert to Local
        const localDt = dtUtc.setZone(timezone);

        // 4. Calculate Sessions
        const sessions = this.calculateMarketSessions(dtUtc, timezone);

        // 5. Active Sessions & Overlap
        const activeSessions = Object.entries(sessions)
            .filter(([_, data]: [string, any]) => data.is_open)
            .map(([name, _]) => name);

        const isOverlap = activeSessions.length > 1;

        const result: SessionResult = {
            country_normalized: countryData.name,
            country_iso2: countryData.id,
            user_timezone_iana: timezone,
            timezone_confidence: confidence,
            local_datetime: localDt.toISO(),
            active_sessions: activeSessions,
            is_overlap: isOverlap,
            sessions: sessions
        };

        if (warning) {
            result.warning = warning;
        }

        return result;
    }

    private normalizeCountry(input: string) {
        // Simple normalization
        const cleaned = input.trim().toLowerCase();

        // Direct Id Lookup
        let data = ct.getCountry(input.toUpperCase());
        if (data) return data;

        // Name lookup
        const allCountries = ct.getAllCountries();
        for (const key in allCountries) {
            const c = allCountries[key];
            if (c.name.toLowerCase() === cleaned || c.id.toLowerCase() === cleaned) {
                return c;
            }
        }

        // Common translations mapping (basic list)
        const map: any = {
            'mocambique': 'MZ',
            'brazil': 'BR',
            'brasil': 'BR',
            'united states': 'US',
            'usa': 'US',
            'eua': 'US'
        };

        if (map[cleaned]) {
            return ct.getCountry(map[cleaned]);
        }

        return null;
    }

    private determineTimezone(countryData: any, userRegion?: string): { timezone: string, confidence: 'high' | 'medium' | 'low', warning?: string } {
        const timezones = countryData.timezones || [];

        if (timezones.length === 0) {
            return { timezone: 'UTC', confidence: 'low', warning: 'No timezone found for country, using UTC' };
        }

        if (timezones.length === 1) {
            return { timezone: timezones[0], confidence: 'high' };
        }

        // Multiple timezones
        // a) User Region Match
        if (userRegion) {
            // Heuristic: check if region string is part of timezone name (e.g. "New York" in "America/New_York")
            // This is simplistic but covers many cases.
            // A better approach requires a region-to-timezone map, but `countries-and-timezones` doesn't provide regions fully mapped.
            // We can check `ct.getTimezonesForCountry(countryData.id)` to get details.
            const tzs = ct.getTimezonesForCountry(countryData.id);
            const match = tzs.find(t => t.name.toLowerCase().includes(userRegion.toLowerCase()) || (t.aliasOf && t.aliasOf.toLowerCase().includes(userRegion.toLowerCase())));
            if (match) {
                return { timezone: match.name, confidence: 'high' };
            }
        }

        // b) Capital (manual map or simple heuristic needed? ct doesn't provide "main" flag easily, but usually the first one is representative or we need a list)
        // For simplicity, we default to the first one defined in the library if no better logic, OR we hardcode capitals for major multi-tz countries.
        // Let's rely on standard capital timezones for big countries if possible.
        // Actually, let's try to find a timezone passing through specific key cities if known, otherwise first.

        // ct does not explicitly list "primary".
        // Heuristic: Choose the one with the most overlap with standard working hours? No.

        // Let's return the first one as "primary" fallback with a warning.
        // Or check userRegion against popular cities list?

        // (Simulated logic per request)
        // "Se não houver capital disponível, escolha o fuso mais comum/mais populoso (padrão “primary”)"

        return {
            timezone: timezones[0], // often the most "canonical"
            confidence: 'medium',
            warning: `Multiple timezones found for ${countryData.name}. Using ${timezones[0]} as default. Please provide a region for better accuracy.`
        };
    }

    private calculateMarketSessions(dtUtc: DateTime, userTz: string) {
        // Market definitions
        const markets = [
            { name: 'Sydney', zone: 'Australia/Sydney', open: 8, close: 17 },
            { name: 'Tokyo', zone: 'Asia/Tokyo', open: 9, close: 18 },
            { name: 'London', zone: 'Europe/London', open: 8, close: 17 },
            { name: 'New York', zone: 'America/New_York', open: 8, close: 17 },
        ];

        const sessions: any = {};

        markets.forEach(m => {
            // Need to determine if the market is OPEN right now (dtUtc).
            // Convert dtUtc to Market Zone
            const marketTime = dtUtc.setZone(m.zone);
            const openTime = marketTime.startOf('day').set({ hour: m.open });
            const closeTime = marketTime.startOf('day').set({ hour: m.close });

            const isOpen = marketTime >= openTime && marketTime < closeTime;

            // Format open/close in USER Timezone
            const openInUser = openTime.setZone(userTz).toFormat('HH:mm');
            const closeInUser = closeTime.setZone(userTz).toFormat('HH:mm');

            sessions[m.name] = {
                open_in_user_tz: openInUser,
                close_in_user_tz: closeInUser,
                is_open: isOpen
            };
        });

        return sessions;
    }

    private defaultErrorResult(country: string, dtUtc: DateTime): SessionResult {
        return {
            country_normalized: country,
            country_iso2: 'XX',
            user_timezone_iana: 'UTC',
            timezone_confidence: 'low',
            local_datetime: dtUtc.toISO(),
            active_sessions: [],
            is_overlap: false,
            sessions: {},
            warning: 'Country not found'
        };
    }
}
