import { EconomicCalendarService } from './economic-calendar.service';
import {
    EconomicEvent,
    EconomicEventCategory,
    EconomicEventImpact,
    EconomicEventStatus,
} from './entities/economic-event.entity';

describe('EconomicCalendarService (MT5 Automation Sync & Status)', () => {
    let service: EconomicCalendarService;
    let storedEvents: EconomicEvent[];
    let cacheStore: Map<string, any>;
    let mockEventRepo: any;
    let mockCacheManager: any;

    beforeEach(() => {
        storedEvents = [];
        cacheStore = new Map<string, any>();

        mockEventRepo = {
            create: jest.fn((dto) => ({
                id: dto.id || `evt-${Math.random().toString(36).slice(2, 8)}`,
                status: EconomicEventStatus.SCHEDULED,
                ...dto,
            })),
            find: jest.fn(async () => storedEvents),
            findOne: jest.fn(async () => null),
            count: jest.fn(async (opts?: any) => {
                if (opts?.where?.eventDate) {
                    const now = Date.now();
                    return storedEvents.filter((e) => new Date(e.eventDate).getTime() >= now).length;
                }
                return storedEvents.length;
            }),
            save: jest.fn(async (entities) => {
                const list = Array.isArray(entities) ? entities : [entities];
                for (const item of list) {
                    const idx = storedEvents.findIndex((e) => e.id === item.id);
                    if (idx >= 0) {
                        storedEvents[idx] = item;
                    } else {
                        storedEvents.push(item);
                    }
                }
                return entities;
            }),
        };

        mockCacheManager = {
            get: jest.fn(async (key: string) => cacheStore.get(key)),
            set: jest.fn(async (key: string, val: any) => {
                cacheStore.set(key, val);
            }),
        };

        service = new EconomicCalendarService(
            mockEventRepo,
            {} as any,
            {} as any,
            mockCacheManager,
        );
    });

    it('salva lote MT5 mapeando externalId, categoria, unidade e registrando calendar:sync_status', async () => {
        const eventMs = Date.now() + 3600_000;
        const result = await service.syncMt5CalendarEvents([
            {
                externalId: '840030001',
                title: 'Nonfarm Payrolls',
                currency: 'usd',
                country: 'United States',
                eventDate: eventMs,
                impact: 'HIGH',
                category: 'EMPLOYMENT',
                unit: 'K',
                forecast: '185',
                previous: '175',
                actual: '',
            },
            {
                externalId: '978010002',
                title: 'CPI y/y',
                currency: 'eur',
                country: 'Euro Area',
                eventDate: eventMs + 7200_000,
                impact: 'LOW',
                category: 'INFLATION',
                unit: '%',
                actual: '2.4',
            },
        ]);

        expect(result).toEqual({ synced: 2, created: 2, updated: 0 });
        expect(storedEvents).toHaveLength(2);
        expect(storedEvents[0]).toMatchObject({
            externalId: '840030001',
            currency: 'USD',
            impact: EconomicEventImpact.HIGH,
            category: EconomicEventCategory.EMPLOYMENT,
            unit: 'K',
            status: EconomicEventStatus.SCHEDULED,
            source: 'MT5_CALENDAR',
        });
        expect(storedEvents[1].status).toBe(EconomicEventStatus.COMPLETED);
        expect(storedEvents[1].actual).toBe('2.4');
        expect(mockCacheManager.set).toHaveBeenCalledWith(
            'calendar:cache_version',
            expect.any(String),
            expect.any(Number),
        );

        const status = await service.getSyncStatus();
        expect(status.source).toBe('MT5_CALENDAR');
        expect(status.analyzed).toBe(2);
        expect(status.created).toBe(2);
        expect(status.updated).toBe(0);
        expect(status.totalStored).toBe(2);
        expect(status.upcomingCount).toBe(2);
        expect(status.lastError).toBeNull();
    });

    it('deduplica por externalId em atualizacoes futuras (sem N+1) e promove status para COMPLETED quando actual chega', async () => {
        const ts = new Date('2026-11-15T13:30:00.000Z');
        storedEvents.push({
            id: 'evt-1',
            externalId: '840030001',
            title: 'Nonfarm Payrolls',
            currency: 'USD',
            country: 'United States',
            eventDate: ts,
            impact: EconomicEventImpact.HIGH,
            category: EconomicEventCategory.EMPLOYMENT,
            status: EconomicEventStatus.SCHEDULED,
            actual: null,
            forecast: '180',
            previous: '170',
            unit: 'K',
            description: 'MT5',
            source: 'MT5_CALENDAR',
            createdAt: ts,
            updatedAt: ts,
        });

        const revisedTs = new Date('2026-11-15T13:45:00.000Z').getTime();
        const result = await service.syncMt5CalendarEvents([
            {
                externalId: '840030001',
                title: 'Nonfarm Payrolls Revised',
                currency: 'USD',
                eventDate: revisedTs,
                impact: 'HIGH',
                category: 'EMPLOYMENT',
                actual: '210',
                forecast: '180',
                previous: '170',
            },
            // Item duplicado no mesmo payload não deve duplicar inserção nem contagem
            {
                externalId: '840030001',
                title: 'Nonfarm Payrolls Revised',
                currency: 'USD',
                eventDate: revisedTs,
                impact: 'HIGH',
                category: 'EMPLOYMENT',
                actual: '210',
            },
        ]);

        expect(result).toEqual({ synced: 1, created: 0, updated: 1 });
        expect(storedEvents).toHaveLength(1);
        expect(storedEvents[0].status).toBe(EconomicEventStatus.COMPLETED);
        expect(storedEvents[0].actual).toBe('210');
        expect(storedEvents[0].eventDate.getTime()).toBe(revisedTs);
        expect(mockEventRepo.findOne).not.toHaveBeenCalled();
        expect(mockEventRepo.save).toHaveBeenCalledTimes(1);
    });

    it('faz fallback de deduplicacao por chave composta e faz backfill de externalId', async () => {
        const ts = new Date('2026-11-16T15:00:00.000Z');
        storedEvents.push({
            id: 'evt-legacy',
            externalId: null,
            title: 'CPI m/m',
            currency: 'USD',
            country: 'United States',
            eventDate: ts,
            impact: EconomicEventImpact.HIGH,
            category: EconomicEventCategory.OTHER,
            status: EconomicEventStatus.SCHEDULED,
            actual: null,
            forecast: '0.3',
            previous: '0.2',
            unit: null,
            description: 'Legacy row',
            source: 'MANUAL',
            createdAt: ts,
            updatedAt: ts,
        });

        const result = await service.syncMt5CalendarEvents([
            {
                externalId: '999111',
                title: 'CPI m/m',
                currency: 'USD',
                eventDate: ts.getTime(),
                impact: 'HIGH',
                category: 'INFLATION',
                unit: '%',
                actual: '0.4',
            },
        ]);

        expect(result).toEqual({ synced: 1, created: 0, updated: 1 });
        expect(storedEvents[0].externalId).toBe('999111');
        expect(storedEvents[0].category).toBe(EconomicEventCategory.INFLATION);
        expect(storedEvents[0].unit).toBe('%');
        expect(storedEvents[0].actual).toBe('0.4');
        expect(storedEvents[0].source).toBe('MT5_CALENDAR');
    });

    it('registra execucao vazia sem erros mantendo contadores zerados', async () => {
        const res = await service.syncMt5CalendarEvents([]);
        expect(res).toEqual({ synced: 0, created: 0, updated: 0 });
        const status = await service.getSyncStatus();
        expect(status.analyzed).toBe(0);
        expect(status.lastSyncAt).not.toBeNull();
    });
});
