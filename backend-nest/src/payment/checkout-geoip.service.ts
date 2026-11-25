import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';
import * as crypto from 'crypto';
import { extractTrustedClientIp } from '../common/security/security.config';

export type CheckoutPaymentMethodKey = 'mpesa' | 'emola' | 'card' | 'payfast' | 'pix' | 'crypto';

export interface CheckoutGeoResolution {
    countryCode: string; // ISO-2 e.g. 'MZ', 'BR', 'ZA', or 'INTL'
    countryName: string;
    source: 'geo-header' | 'geoip-api' | 'dev-override' | 'dev-egress' | 'fallback';
    availableMethods: CheckoutPaymentMethodKey[];
    defaultMethod: CheckoutPaymentMethodKey;
}

const COUNTRY_NAMES: Record<string, string> = {
    MZ: 'Moçambique',
    BR: 'Brasil',
    ZA: 'África do Sul',
    PT: 'Portugal',
    AO: 'Angola',
    US: 'United States',
    GB: 'United Kingdom',
    INTL: 'Internacional',
};

function isValidIso2(code: string): boolean {
    return /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' && code !== 'A1' && code !== 'A2';
}

function isPrivateOrLoopbackIp(ip: string): boolean {
    const clean = ip.replace(/^::ffff:/i, '').trim().toLowerCase();
    if (!clean || clean === '::1' || clean === 'localhost') return true;
    if (clean.startsWith('127.') || clean.startsWith('10.') || clean.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(clean)) return true;
    if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) return true;
    return false;
}

/**
 * Pure GeoIP resolver for adaptive checkout payment methods.
 * Strictly determines country from the checkout HTTP request's GeoIP (NEVER user profile settings).
 */
@Injectable()
export class CheckoutGeoIpService {
    private readonly logger = new Logger(CheckoutGeoIpService.name);
    private readonly memoryCache = new Map<string, { code: string; expiresAt: number }>();

    constructor(
        private readonly configService: ConfigService,
        @Optional() @Inject(CACHE_MANAGER) private readonly cacheManager?: Cache,
    ) {}

    buildMethodsForCountry(countryCode: string): {
        availableMethods: CheckoutPaymentMethodKey[];
        defaultMethod: CheckoutPaymentMethodKey;
    } {
        const cc = (countryCode || 'INTL').trim().toUpperCase();

        if (cc === 'MZ') {
            return {
                availableMethods: ['mpesa', 'emola', 'card', 'crypto'],
                defaultMethod: 'mpesa',
            };
        }
        if (cc === 'BR') {
            return {
                availableMethods: ['pix', 'card', 'crypto'],
                defaultMethod: 'pix',
            };
        }
        if (cc === 'ZA') {
            return {
                availableMethods: ['payfast', 'card', 'crypto'],
                defaultMethod: 'payfast',
            };
        }

        // Universal methods for all other regions
        return {
            availableMethods: ['card', 'crypto'],
            defaultMethod: 'card',
        };
    }

    private formatResolution(
        countryCode: string,
        source: CheckoutGeoResolution['source'],
    ): CheckoutGeoResolution {
        const cc = isValidIso2(countryCode) ? countryCode.toUpperCase() : 'INTL';
        const { availableMethods, defaultMethod } = this.buildMethodsForCountry(cc);
        return {
            countryCode: cc,
            countryName: COUNTRY_NAMES[cc] || cc,
            source,
            availableMethods,
            defaultMethod,
        };
    }

    private async lookupCountryByIp(ip: string | null): Promise<string | null> {
        const targetSegment = ip ? encodeURIComponent(ip) : '';
        // 1. Primary: ipwho.is (supports HTTPS, no key needed)
        try {
            const url = targetSegment ? `https://ipwho.is/${targetSegment}` : 'https://ipwho.is/';
            const res = await axios.get(url, { timeout: 2500 });
            const cc = String(res.data?.country_code || '').trim().toUpperCase();
            if (isValidIso2(cc)) return cc;
        } catch {
            // Try fallback provider
        }

        // 2. Fallback: api.country.is
        try {
            const url = targetSegment
                ? `https://api.country.is/${targetSegment}`
                : 'https://api.country.is/';
            const res = await axios.get(url, { timeout: 2500 });
            const cc = String(res.data?.country || '').trim().toUpperCase();
            if (isValidIso2(cc)) return cc;
        } catch {
            // Try final fallback
        }

        // 3. Final fallback: ipapi.co
        if (targetSegment) {
            try {
                const res = await axios.get(`https://ipapi.co/${targetSegment}/country/`, {
                    timeout: 2500,
                    responseType: 'text',
                });
                const cc = String(res.data || '').trim().toUpperCase();
                if (isValidIso2(cc)) return cc;
            } catch {
                // Ignore network failure
            }
        }

        return null;
    }

    async resolveFromRequest(req: any): Promise<CheckoutGeoResolution> {
        const headers = req?.headers || {};

        // 1. Trusted CDN / Reverse Proxy GeoIP headers (instant, authoritative)
        const headerCountry = String(
            headers['cf-ipcountry'] ||
                headers['x-vercel-ip-country'] ||
                headers['cloudfront-viewer-country'] ||
                headers['x-country-code'] ||
                headers['x-geoip-country'] ||
                '',
        )
            .trim()
            .toUpperCase();

        if (isValidIso2(headerCountry)) {
            return this.formatResolution(headerCountry, 'geo-header');
        }

        const clientIp = extractTrustedClientIp(req);

        // 2. Public IP -> cached GeoIP lookup (24h TTL)
        if (clientIp && !isPrivateOrLoopbackIp(clientIp)) {
            const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex').slice(0, 24);
            const cacheKey = `geoip:checkout:v1:${ipHash}`;

            const mem = this.memoryCache.get(cacheKey);
            if (mem && mem.expiresAt > Date.now()) {
                return this.formatResolution(mem.code, 'geoip-api');
            }

            try {
                const cached = await this.cacheManager?.get?.<string>(cacheKey);
                if (cached && isValidIso2(cached)) {
                    this.memoryCache.set(cacheKey, { code: cached, expiresAt: Date.now() + 60 * 60 * 1000 });
                    return this.formatResolution(cached, 'geoip-api');
                }
            } catch {
                // ignore cache read error
            }

            const detected = await this.lookupCountryByIp(clientIp);
            if (detected) {
                const ttlMs = 24 * 60 * 60 * 1000;
                this.memoryCache.set(cacheKey, { code: detected, expiresAt: Date.now() + ttlMs });
                await this.cacheManager?.set?.(cacheKey, detected, ttlMs).catch?.(() => {});
                return this.formatResolution(detected, 'geoip-api');
            }
        }

        // 3. Loopback / Private LAN (local dev): optional env override or host egress GeoIP
        const devOverride = String(
            this.configService.get<string>('CHECKOUT_DEV_GEOIP_COUNTRY') || '',
        )
            .trim()
            .toUpperCase();
        if (isValidIso2(devOverride)) {
            return this.formatResolution(devOverride, 'dev-override');
        }

        if (this.configService.get<string>('NODE_ENV') !== 'production') {
            const devKey = 'geoip:checkout:dev_egress';
            const mem = this.memoryCache.get(devKey);
            if (mem && mem.expiresAt > Date.now()) {
                return this.formatResolution(mem.code, 'dev-egress');
            }
            const egressCountry = await this.lookupCountryByIp(null);
            if (egressCountry) {
                this.memoryCache.set(devKey, {
                    code: egressCountry,
                    expiresAt: Date.now() + 60 * 60 * 1000,
                });
                return this.formatResolution(egressCountry, 'dev-egress');
            }
        }

        // 4. Safe fallback -> universal methods only (Visa/Mastercard + Crypto)
        return this.formatResolution('INTL', 'fallback');
    }
}
