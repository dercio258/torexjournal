import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between, MoreThanOrEqual } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EconomicEvent, EconomicEventStatus, EconomicEventImpact, EconomicEventCategory } from './entities/economic-event.entity';
import { QueryEventsDto } from './dto/query-events.dto';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';

export interface CalendarSyncStatus {
    lastSyncAt: string | null;
    source: string | null;
    analyzed: number;
    created: number;
    updated: number;
    totalStored: number;
    upcomingCount?: number;
    lastError: string | null;
}

@Injectable()
export class EconomicCalendarService {
    private readonly logger = new Logger(EconomicCalendarService.name);
    private lastSyncStatus: CalendarSyncStatus = {
        lastSyncAt: null,
        source: null,
        analyzed: 0,
        created: 0,
        updated: 0,
        totalStored: 0,
        lastError: null,
    };

    constructor(
        @InjectRepository(EconomicEvent)
        private readonly eventRepo: Repository<EconomicEvent>,
        @InjectRepository(TradeEntity)
        private readonly tradeRepo: Repository<TradeEntity>,
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
        @Inject(CACHE_MANAGER) private readonly cacheManager: any
    ) {}

    // ==========================================
    // PUBLIC & USER QUERIES
    // ==========================================

    private async getCalendarCacheVersion(): Promise<string> {
        try {
            const v = await this.cacheManager.get('calendar:cache_version');
            return v ? String(v) : 'v1';
        } catch {
            return 'v1';
        }
    }

    async getEvents(query: QueryEventsDto, userId?: string, accountId?: string) {
        const page = Math.max(1, query.page || 1);
        const limit = Math.min(500, Math.max(1, query.limit || 200));
        const skip = (page - 1) * limit;

        const cacheVersion = await this.getCalendarCacheVersion();
        const resolvedAcc = accountId || query.accountId || 'all';
        const eventsCacheKey = `calendar:events:${cacheVersion}:${userId || 'anon'}:${resolvedAcc}:${page}:${limit}:${query.from || ''}:${query.to || ''}:${query.currency || ''}:${query.country || ''}:${query.impact || ''}:${query.category || ''}:${query.status || ''}:${query.search || ''}`;
        try {
            const cached = await this.cacheManager.get(eventsCacheKey);
            if (cached) return cached;
        } catch (_) {}

        const qb = this.eventRepo.createQueryBuilder('event');

        let windowFromDate: Date;
        let windowToDate: Date;

        // Date Range
        if (query.from && query.to) {
            const fromDate = new Date(query.from);
            const toDate = new Date(query.to);
            if (query.to.length <= 10) {
                toDate.setHours(23, 59, 59, 999);
            }
            windowFromDate = fromDate;
            windowToDate = toDate;
            qb.andWhere('event.eventDate BETWEEN :from AND :to', {
                from: fromDate.toISOString(),
                to: toDate.toISOString()
            });
        } else if (query.from) {
            windowFromDate = new Date(query.from);
            windowToDate = new Date(windowFromDate.getTime() + 30 * 24 * 60 * 60 * 1000);
            qb.andWhere('event.eventDate >= :from', { from: windowFromDate.toISOString() });
        } else if (query.to) {
            const toDate = new Date(query.to);
            if (query.to.length <= 10) toDate.setHours(23, 59, 59, 999);
            windowToDate = toDate;
            windowFromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
            qb.andWhere('event.eventDate <= :to', { to: toDate.toISOString() });
        } else {
            // Default window: 7 days ago to 14 days ahead
            const pastWeek = new Date();
            pastWeek.setDate(pastWeek.getDate() - 7);
            pastWeek.setHours(0, 0, 0, 0);

            const futureTwoWeeks = new Date();
            futureTwoWeeks.setDate(futureTwoWeeks.getDate() + 14);
            futureTwoWeeks.setHours(23, 59, 59, 999);

            windowFromDate = pastWeek;
            windowToDate = futureTwoWeeks;

            qb.andWhere('event.eventDate BETWEEN :from AND :to', {
                from: pastWeek.toISOString(),
                to: futureTwoWeeks.toISOString()
            });
        }

        // Filters
        if (query.currency) {
            qb.andWhere('event.currency = :currency', { currency: query.currency.trim().toUpperCase() });
        }
        if (query.country) {
            qb.andWhere('LOWER(event.country) LIKE LOWER(:country)', { country: `%${query.country.trim()}%` });
        }
        if (query.impact) {
            qb.andWhere('event.impact = :impact', { impact: query.impact });
        }
        if (query.category) {
            qb.andWhere('event.category = :category', { category: query.category });
        }
        if (query.status) {
            qb.andWhere('event.status = :status', { status: query.status });
        }
        if (query.search) {
            const term = `%${query.search.trim().toLowerCase()}%`;
            qb.andWhere('(LOWER(event.title) LIKE :term OR LOWER(event.currency) LIKE :term OR LOWER(event.country) LIKE :term)', { term });
        }

        // Ordering: Closest date first, then highest impact
        qb.orderBy('event.eventDate', 'ASC');
        qb.addOrderBy(`CASE 
            WHEN event.impact = 'HIGH' THEN 1 
            WHEN event.impact = 'MEDIUM' THEN 2 
            ELSE 3 
        END`, 'ASC');

        qb.skip(skip).take(limit);

        const [[events, total], correlation] = await Promise.all([
            qb.getManyAndCount(),
            this.resolveTradeCorrelation(
                userId,
                accountId || query.accountId,
                windowFromDate.toISOString(),
                windowToDate.toISOString(),
            ),
        ]);
        const totalPages = Math.ceil(total / limit);

        const enrichedData = events.map(evt => {
            const curr = (evt.currency || '').toUpperCase();
            const isRelevant = correlation.relevantCurrencies.includes(curr);
            return {
                id: evt.id,
                title: evt.title,
                country: evt.country,
                currency: curr,
                category: evt.category,
                impact: evt.impact,
                eventDate: evt.eventDate,
                time: evt.eventDate ? evt.eventDate.toISOString().replace('T', ' ').substring(0, 19) : null,
                previous: evt.previous,
                forecast: evt.forecast,
                actual: evt.actual,
                unit: evt.unit,
                status: evt.status,
                description: evt.description,
                source: evt.source,
                isAccountRelevant: isRelevant,
                relevanceReason: isRelevant ? `Moeda ${curr} operada nesta conta` : null
            };
        });

        const payload = {
            data: enrichedData,
            pagination: {
                page,
                limit,
                total,
                totalPages
            },
            accountInfo: correlation.accountInfo,
            dailyAccountTrades: correlation.dailyAccountTrades
        };

        try {
            await this.cacheManager.set(eventsCacheKey, payload, 45000); // 45s cache
        } catch (_) {}

        return payload;
    }

    async getTodayEvents(userId?: string, accountId?: string) {
        const cacheVersion = await this.getCalendarCacheVersion();
        const cacheKey = `calendar:today:${cacheVersion}:${userId || 'anon'}:${accountId || 'all'}`;
        try {
            const cached = await this.cacheManager.get(cacheKey);
            if (cached) return cached;
        } catch (_) {}

        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setUTCHours(23, 59, 59, 999);

        const query: QueryEventsDto = {
            from: startOfDay.toISOString(),
            to: endOfDay.toISOString(),
            limit: 200
        };

        const result = await this.getEvents(query, userId, accountId);

        try {
            await this.cacheManager.set(cacheKey, result, 120000); // 2 min cache
        } catch (_) {}

        return result;
    }

    async getUpcomingEvents(limit = 10) {
        const now = new Date();
        const events = await this.eventRepo.find({
            where: {
                eventDate: MoreThanOrEqual(now),
                status: EconomicEventStatus.SCHEDULED
            },
            order: {
                eventDate: 'ASC'
            },
            take: Math.min(50, limit)
        });

        return {
            data: events,
            total: events.length
        };
    }

    async getEventById(id: string) {
        const event = await this.eventRepo.findOne({ where: { id } });
        if (!event) {
            throw new NotFoundException(`Evento econômico com ID ${id} não encontrado`);
        }
        return event;
    }

    // ==========================================
    // TRADE CORRELATION HELPER
    // ==========================================

    private async resolveTradeCorrelation(
        userId?: string,
        accountId?: string,
        windowFromIso?: string,
        windowToIso?: string,
    ) {
        let accountInfo: any = null;
        const dailyAccountTrades: Record<string, { count: number, pnl: number }> = {};
        const relevantCurrenciesSet = new Set<string>(['USD']); // Default base

        if (!userId) {
            return {
                relevantCurrencies: Array.from(relevantCurrenciesSet),
                accountInfo: null,
                dailyAccountTrades: {}
            };
        }

        try {
            let targetAccounts: AccountEntity[] = [];
            if (accountId && accountId !== 'all') {
                const acc = await this.accountRepo.findOne({
                    where: { id: accountId, userId, isArchived: false },
                    select: ['id', 'name', 'broker', 'type', 'currency'],
                });
                if (acc) targetAccounts = [acc];
            }
            if (targetAccounts.length === 0) {
                targetAccounts = await this.accountRepo.find({
                    where: { userId, isArchived: false },
                    select: ['id', 'name', 'broker', 'type', 'currency'],
                });
            }

            if (targetAccounts.length > 0) {
                const isSingleAccount = targetAccounts.length === 1 && accountId !== 'all';
                const mainAcc = targetAccounts[0];

                targetAccounts.forEach(a => {
                    if (a.currency) relevantCurrenciesSet.add(a.currency.toUpperCase());
                });

                const accountIds = targetAccounts.map(a => a.id);
                const now = new Date();
                const fromIso = windowFromIso || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
                const toIso = windowToIso || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

                const [symbolRows, dailyRows] = await Promise.all([
                    this.tradeRepo.query(
                        `
                        SELECT DISTINCT UPPER(t.symbol) AS symbol
                        FROM trades t
                        WHERE t.account_id = ANY($1)
                          AND t.status = 'CLOSED'
                          AND t.symbol IS NOT NULL
                        LIMIT 40
                        `,
                        [accountIds],
                    ),
                    this.tradeRepo.query(
                        `
                        SELECT
                            TO_CHAR(t.close_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                            COUNT(*)::int AS count,
                            ROUND(COALESCE(SUM(COALESCE(t.profit, 0) + COALESCE(t.commission, 0) + COALESCE(t.swap, 0)), 0)::numeric, 2)::float AS pnl
                        FROM trades t
                        WHERE t.account_id = ANY($1)
                          AND t.status = 'CLOSED'
                          AND t.close_time BETWEEN $2 AND $3
                        GROUP BY 1
                        `,
                        [accountIds, fromIso, toIso],
                    ),
                ]);

                const symbolsSet = new Set<string>();
                const knownCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'XAU', 'BTC', 'ETH'];

                for (const row of symbolRows || []) {
                    if (row?.symbol) {
                        const sym = String(row.symbol).toUpperCase();
                        symbolsSet.add(sym);
                        for (const c of knownCurrencies) {
                            if (sym.includes(c)) {
                                relevantCurrenciesSet.add(c === 'XAU' ? 'USD' : c);
                            }
                        }
                    }
                }

                for (const row of dailyRows || []) {
                    if (row?.day) {
                        dailyAccountTrades[row.day] = {
                            count: Number(row.count || 0),
                            pnl: Number(Number(row.pnl || 0).toFixed(2)),
                        };
                    }
                }

                accountInfo = {
                    id: isSingleAccount ? mainAcc.id : 'all',
                    name: isSingleAccount ? mainAcc.name : 'Todas as Contas (Consolidado)',
                    broker: isSingleAccount ? mainAcc.broker : 'Multi-Corretora',
                    type: isSingleAccount ? mainAcc.type : 'CONSOLIDATED',
                    currency: isSingleAccount ? mainAcc.currency : 'USD',
                    relevantCurrencies: Array.from(relevantCurrenciesSet),
                    tradedSymbols: Array.from(symbolsSet).slice(0, 10)
                };
            }
        } catch (err) {
            this.logger.warn(`Failed to resolve trade correlation: ${err.message}`);
        }

        return {
            relevantCurrencies: Array.from(relevantCurrenciesSet),
            accountInfo,
            dailyAccountTrades
        };
    }

    // ==========================================
    // MT5 AUTOMATED CALENDAR SYNC (MQL5 / PYTHON WORKER)
    // ==========================================

    async syncMt5CalendarEvents(
        eventsPayload: Array<{
            externalId?: string;
            title: string;
            currency: string;
            country?: string;
            eventDate: string | number;
            impact?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
            category?: string;
            actual?: string | null;
            forecast?: string | null;
            previous?: string | null;
            unit?: string | null;
            description?: string | null;
        }>,
        sourceLabel = 'MT5_CALENDAR',
    ) {
        const nowIso = new Date().toISOString();
        if (!Array.isArray(eventsPayload) || eventsPayload.length === 0) {
            this.logger.log(`[CALENDAR-SYNC] Nenhuma nova notícia recebida da fonte ${sourceLabel}.`);
            await this.persistSyncStatus({
                lastSyncAt: nowIso,
                source: sourceLabel,
                analyzed: 0,
                created: 0,
                updated: 0,
                lastError: null,
            });
            return { synced: 0, created: 0, updated: 0 };
        }

        this.logger.log(`[CALENDAR-SYNC] Processando lote de ${eventsPayload.length} notícias recebidas de ${sourceLabel}...`);

        const validCategories = new Set<string>(Object.values(EconomicEventCategory));
        type NormalizedItem = {
            externalId: string | null;
            title: string;
            currency: string;
            country: string | null;
            eventDate: Date;
            impact: EconomicEventImpact;
            category: EconomicEventCategory;
            actual: string | null;
            forecast: string | null;
            previous: string | null;
            unit: string | null;
            description: string;
            compositeKey: string;
        };

        const normalized: NormalizedItem[] = [];
        const extIdsSet = new Set<string>();
        let minDate: Date | null = null;
        let maxDate: Date | null = null;

        for (const item of eventsPayload) {
            if (!item?.title || !String(item.title).trim()) continue;
            const title = String(item.title).trim().slice(0, 255);
            const currency = (item.currency || 'USD').trim().toUpperCase().slice(0, 10);
            const rawDate =
                typeof item.eventDate === 'number'
                    ? new Date(item.eventDate < 1e11 ? item.eventDate * 1000 : item.eventDate)
                    : new Date(item.eventDate);
            if (isNaN(rawDate.getTime())) continue;

            const rawImpact = (item.impact || 'MEDIUM').toString().trim().toUpperCase();
            const impact =
                rawImpact === 'HIGH'
                    ? EconomicEventImpact.HIGH
                    : rawImpact === 'LOW'
                      ? EconomicEventImpact.LOW
                      : EconomicEventImpact.MEDIUM;

            const rawCategory = (item.category || 'OTHER').toString().trim().toUpperCase();
            const category = validCategories.has(rawCategory)
                ? (rawCategory as EconomicEventCategory)
                : EconomicEventCategory.OTHER;

            const externalId =
                item.externalId !== undefined && item.externalId !== null && String(item.externalId).trim() !== ''
                    ? String(item.externalId).trim().slice(0, 64)
                    : null;

            const trimOpt = (v?: string | null, maxLen?: number) => {
                if (v === undefined || v === null) return null;
                const s = String(v).trim();
                if (!s) return null;
                return maxLen ? s.slice(0, maxLen) : s;
            };

            const compositeKey = `${title.toLowerCase()}|${currency}|${rawDate.getTime()}`;

            if (externalId) extIdsSet.add(externalId);
            if (!minDate || rawDate < minDate) minDate = rawDate;
            if (!maxDate || rawDate > maxDate) maxDate = rawDate;

            normalized.push({
                externalId,
                title,
                currency,
                country: trimOpt(item.country, 100),
                eventDate: rawDate,
                impact,
                category,
                actual: trimOpt(item.actual, 50),
                forecast: trimOpt(item.forecast, 50),
                previous: trimOpt(item.previous, 50),
                unit: trimOpt(item.unit, 30),
                description: trimOpt(item.description) || 'Sincronizado via Automação MetaTrader 5',
                compositeKey,
            });
        }

        if (normalized.length === 0) {
            await this.persistSyncStatus({
                lastSyncAt: nowIso,
                source: sourceLabel,
                analyzed: eventsPayload.length,
                created: 0,
                updated: 0,
                lastError: null,
            });
            return { synced: 0, created: 0, updated: 0 };
        }

        try {
            const byExternalId = new Map<string, EconomicEvent>();
            const byCompositeKey = new Map<string, EconomicEvent>();

            const extIds = Array.from(extIdsSet);
            for (let i = 0; i < extIds.length; i += 500) {
                const chunk = extIds.slice(i, i + 500);
                const foundByExt = await this.eventRepo.find({
                    where: { externalId: In(chunk) },
                });
                for (const ev of foundByExt) {
                    if (ev.externalId) byExternalId.set(ev.externalId, ev);
                    const cKey = `${ev.title.trim().toLowerCase()}|${ev.currency.trim().toUpperCase()}|${new Date(ev.eventDate).getTime()}`;
                    byCompositeKey.set(cKey, ev);
                }
            }

            if (minDate && maxDate) {
                const existingInWindow = await this.eventRepo.find({
                    where: { eventDate: Between(minDate, maxDate) },
                });
                for (const ev of existingInWindow) {
                    if (ev.externalId && !byExternalId.has(ev.externalId)) {
                        byExternalId.set(ev.externalId, ev);
                    }
                    const cKey = `${ev.title.trim().toLowerCase()}|${ev.currency.trim().toUpperCase()}|${new Date(ev.eventDate).getTime()}`;
                    if (!byCompositeKey.has(cKey)) {
                        byCompositeKey.set(cKey, ev);
                    }
                }
            }

            const toSaveMap = new Map<string, EconomicEvent>();
            const newlyCreated: EconomicEvent[] = [];
            let createdCount = 0;
            let updatedCount = 0;

            for (const item of normalized) {
                const existing =
                    (item.externalId ? byExternalId.get(item.externalId) : undefined) ||
                    byCompositeKey.get(item.compositeKey);

                const hasActual = item.actual !== null;

                if (existing) {
                    let changed = false;
                    if (item.externalId && existing.externalId !== item.externalId) {
                        existing.externalId = item.externalId;
                        changed = true;
                    }
                    if (existing.eventDate.getTime() !== item.eventDate.getTime()) {
                        existing.eventDate = item.eventDate;
                        changed = true;
                    }
                    if (existing.title !== item.title) {
                        existing.title = item.title;
                        changed = true;
                    }
                    if (hasActual && existing.actual !== item.actual) {
                        existing.actual = item.actual;
                        existing.status = EconomicEventStatus.COMPLETED;
                        changed = true;
                    }
                    if (item.forecast !== null && existing.forecast !== item.forecast) {
                        existing.forecast = item.forecast;
                        changed = true;
                    }
                    if (item.previous !== null && existing.previous !== item.previous) {
                        existing.previous = item.previous;
                        changed = true;
                    }
                    if (item.unit !== null && existing.unit !== item.unit) {
                        existing.unit = item.unit;
                        changed = true;
                    }
                    if (item.category !== EconomicEventCategory.OTHER && existing.category !== item.category) {
                        existing.category = item.category;
                        changed = true;
                    }
                    if (existing.impact !== item.impact) {
                        existing.impact = item.impact;
                        changed = true;
                    }
                    if (item.country !== null && existing.country !== item.country) {
                        existing.country = item.country;
                        changed = true;
                    }

                    if (changed) {
                        existing.source = sourceLabel;
                        if (existing.id) {
                            if (!toSaveMap.has(existing.id)) {
                                updatedCount++;
                            }
                            toSaveMap.set(existing.id, existing);
                        }
                    }

                    if (item.externalId) byExternalId.set(item.externalId, existing);
                    byCompositeKey.set(item.compositeKey, existing);
                } else {
                    const entity = this.eventRepo.create({
                        externalId: item.externalId,
                        title: item.title,
                        currency: item.currency,
                        country: item.country,
                        eventDate: item.eventDate,
                        impact: item.impact,
                        category: item.category,
                        status: hasActual ? EconomicEventStatus.COMPLETED : EconomicEventStatus.SCHEDULED,
                        actual: item.actual,
                        forecast: item.forecast,
                        previous: item.previous,
                        unit: item.unit,
                        description: item.description,
                        source: sourceLabel,
                    });

                    newlyCreated.push(entity);
                    createdCount++;

                    if (item.externalId) byExternalId.set(item.externalId, entity);
                    byCompositeKey.set(item.compositeKey, entity);
                }
            }

            const toSave = [...Array.from(toSaveMap.values()), ...newlyCreated];
            if (toSave.length > 0) {
                await this.eventRepo.save(toSave, { chunk: 100 });
            }

            if (createdCount > 0 || updatedCount > 0) {
                await this.invalidateCalendarCaches();
            }

            await this.persistSyncStatus({
                lastSyncAt: nowIso,
                source: sourceLabel,
                analyzed: normalized.length,
                created: createdCount,
                updated: updatedCount,
                lastError: null,
            });

            this.logger.log(
                `[CALENDAR-SYNC] Fonte ${sourceLabel}: ${createdCount} novas notícias salvas, ${updatedCount} notícias atualizadas (${normalized.length} analisadas).`,
            );

            return {
                synced: createdCount + updatedCount,
                created: createdCount,
                updated: updatedCount,
            };
        } catch (err: any) {
            await this.persistSyncStatus({
                lastSyncAt: nowIso,
                source: sourceLabel,
                analyzed: normalized.length,
                created: 0,
                updated: 0,
                lastError: err?.message || 'Erro ao persistir calendário econômico',
            });
            throw err;
        }
    }

    private async persistSyncStatus(
        partial: Omit<CalendarSyncStatus, 'totalStored'>,
    ): Promise<void> {
        let totalStored = this.lastSyncStatus.totalStored;
        try {
            totalStored = await this.eventRepo.count();
        } catch {}

        const status: CalendarSyncStatus = {
            ...partial,
            totalStored,
        };
        this.lastSyncStatus = status;

        try {
            await this.cacheManager.set('calendar:sync_status', status, 7 * 24 * 60 * 60 * 1000);
        } catch (err: any) {
            this.logger.warn(`Failed to cache calendar sync status: ${err?.message}`);
        }
    }

    async getSyncStatus(): Promise<CalendarSyncStatus> {
        let cached: Partial<CalendarSyncStatus> | null = null;
        try {
            cached = (await this.cacheManager.get('calendar:sync_status')) || null;
        } catch {}

        let totalStored = 0;
        let upcomingCount = 0;
        try {
            [totalStored, upcomingCount] = await Promise.all([
                this.eventRepo.count(),
                this.eventRepo.count({ where: { eventDate: MoreThanOrEqual(new Date()) } }),
            ]);
        } catch {}

        const base = cached && cached.lastSyncAt ? cached : this.lastSyncStatus;
        return {
            lastSyncAt: base.lastSyncAt ?? null,
            source: base.source ?? null,
            analyzed: Number(base.analyzed ?? 0),
            created: Number(base.created ?? 0),
            updated: Number(base.updated ?? 0),
            totalStored,
            upcomingCount,
            lastError: base.lastError ?? null,
        };
    }

    // ==========================================
    // BACKWARD COMPATIBILITY (LEGACY ALIAS)
    // ==========================================

    async getEconomicCalendarLegacy(userId?: string, accountId?: string) {
        const query: QueryEventsDto = { limit: 200 };
        const result = await this.getEvents(query, userId, accountId);
        return {
            events: result.data,
            accountInfo: result.accountInfo,
            dailyAccountTrades: result.dailyAccountTrades
        };
    }

    // ==========================================
    // CACHE INVALIDATION
    // ==========================================

    private async invalidateCalendarCaches() {
        try {
            await this.cacheManager.set('calendar:cache_version', String(Date.now()), 7 * 24 * 60 * 60 * 1000);
        } catch (err) {
            this.logger.warn(`Cache invalidation warning: ${err.message}`);
        }
    }
}
