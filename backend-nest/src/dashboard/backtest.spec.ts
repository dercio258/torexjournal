import { ForbiddenException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

const ACCOUNT_UUID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user-abc-123';

import { ForbiddenException as NestForbiddenException } from '@nestjs/common';

function createDashboardServiceWithMocks(withNormalizedRepos = false) {
    const accountRepo = {
        findOne: jest.fn(),
        find: jest.fn().mockResolvedValue([]),
    };
    const makeQb = () => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
    });
    const backtestRepo = {
        findOne: jest.fn(),
        find: jest.fn().mockResolvedValue([]),
        createQueryBuilder: jest.fn().mockImplementation(makeQb),
        save: jest.fn(),
        create: jest.fn((payload) => payload),
        remove: jest.fn(),
    };
    const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
    };
    const strategyRepo = withNormalizedRepos
        ? {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              save: jest.fn().mockImplementation(async (row) => row),
              delete: jest.fn().mockResolvedValue({ affected: 1 }),
          }
        : undefined;
    const sessionBlobRepo = withNormalizedRepos
        ? {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              save: jest.fn().mockImplementation(async (row) => row),
              delete: jest.fn().mockResolvedValue({ affected: 1 }),
          }
        : undefined;
    const hypothesisRepo = withNormalizedRepos
        ? {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              save: jest.fn().mockImplementation(async (row) => row),
              delete: jest.fn().mockResolvedValue({ affected: 1 }),
          }
        : undefined;

    const service = new DashboardService(
        {} as any,
        {} as any,
        accountRepo as any,
        {} as any,
        {} as any,
        backtestRepo as any,
        {} as any,
        {} as any,
        cacheManager as any,
        {} as any,
        strategyRepo as any,
        sessionBlobRepo as any,
        hypothesisRepo as any,
    );

    return {
        service,
        accountRepo,
        backtestRepo,
        cacheManager,
        strategyRepo,
        sessionBlobRepo,
        hypothesisRepo,
    };
}

describe('DashboardService — Backtest & Replay API', () => {
    it('enforces strict account isolation on getBacktestHistory when accountId is provided', async () => {
        const { service, accountRepo, backtestRepo } = createDashboardServiceWithMocks();
        accountRepo.findOne.mockResolvedValueOnce({ id: ACCOUNT_UUID });
        backtestRepo.find.mockResolvedValueOnce([]);

        await service.getBacktestHistory(USER_ID, ACCOUNT_UUID, false);

        expect(accountRepo.findOne).toHaveBeenCalledWith({
            where: { id: ACCOUNT_UUID, userId: USER_ID },
            select: ['id'],
        });
        expect(backtestRepo.find).toHaveBeenCalledTimes(1);
        const findArg = backtestRepo.find.mock.calls[0][0];
        // Must be a single strict object where-clause scoped to accountId, NOT an array with an OR fallback
        expect(Array.isArray(findArg.where)).toBe(false);
        expect(findArg.where.userId).toBe(USER_ID);
        expect(findArg.where.accountId).toBe(ACCOUNT_UUID);

        // Unauthorized / missing account must throw ForbiddenException
        accountRepo.findOne.mockResolvedValueOnce(null);
        await expect(service.getBacktestHistory(USER_ID, ACCOUNT_UUID, false)).rejects.toThrow(
            ForbiddenException,
        );
    });

    it('strips heavy canvas & screenshot blobs when slim=true while preserving orders and results', async () => {
        const { service, cacheManager } = createDashboardServiceWithMocks();
        const heavyRow = {
            id: 'sess-1',
            userId: USER_ID,
            mode: 'REPLAY_SESSION',
            name: 'London Gold',
            config: {
                revision: 4,
                orders: [{ id: 'ord-1', pnl: 150, status: 'WIN' }],
                drawings: [{ id: 'd1', toolName: 'trendLine', points: [] }],
                drawnItems: [{ id: 'd1' }],
                drawingStylesById: { d1: { lineColor: '#fff' } },
                overlayGeometries: { d1: [{ timestamp: 1700000000000, value: 2000 }] },
                sessionScreenshots: [{ id: 's1', dataUrl: 'data:image/png;base64,AAA' }],
                journalNotes: 'Keep this note',
            },
            results: { netPnl: 150, winRate: 100 },
        };
        cacheManager.get.mockResolvedValueOnce([heavyRow]);

        const slimRows = await service.getBacktestHistory(USER_ID, undefined, true);
        expect(slimRows).toHaveLength(1);
        expect(slimRows[0].config._slimHistory).toBe(true);
        expect(slimRows[0].config.orders).toEqual(heavyRow.config.orders);
        expect(slimRows[0].results).toEqual(heavyRow.results);
        expect(slimRows[0].config.journalNotes).toBe('Keep this note');
        expect(slimRows[0].config.drawings).toBeUndefined();
        expect(slimRows[0].config.drawnItems).toBeUndefined();
        expect(slimRows[0].config.drawingStylesById).toBeUndefined();
        expect(slimRows[0].config.overlayGeometries).toBeUndefined();
        expect(slimRows[0].config.sessionScreenshots).toBeUndefined();

        // Original cached record must not be mutated in place
        expect(heavyRow.config.drawings).toHaveLength(1);
    });

    it('returns unchanged=true when knownRevision matches cached Redis revision', async () => {
        const { service, cacheManager, backtestRepo } = createDashboardServiceWithMocks();
        const cachedSession = {
            id: '22222222-2222-4222-8222-222222222222',
            userId: USER_ID,
            mode: 'REPLAY_SESSION',
            config: { revision: 7, orders: [{ id: 'o1' }] },
        };
        cacheManager.get.mockResolvedValueOnce(cachedSession);

        const unchangedRes: any = await service.getReplaySessionById(USER_ID, cachedSession.id, 7);
        expect(unchangedRes.unchanged).toBe(true);
        expect(unchangedRes.revision).toBe(7);
        expect(unchangedRes.cacheLayer).toBe('REDIS');
        expect(backtestRepo.findOne).not.toHaveBeenCalled();

        cacheManager.get.mockResolvedValueOnce(cachedSession);
        const fullRes: any = await service.getReplaySessionById(USER_ID, cachedSession.id, 6);
        expect(fullRes.unchanged).toBeUndefined();
        expect(fullRes.config.orders).toEqual([{ id: 'o1' }]);
    });

    it('rejects stale out-of-order syncReplaySessionState writes when incoming revision < existing revision', async () => {
        const { service, accountRepo, backtestRepo } = createDashboardServiceWithMocks();
        accountRepo.findOne.mockResolvedValueOnce({ id: ACCOUNT_UUID });
        const existingSession = {
            id: '33333333-3333-4333-8333-333333333333',
            userId: USER_ID,
            mode: 'REPLAY_SESSION',
            config: { revision: 9 },
        };
        backtestRepo.findOne.mockResolvedValueOnce(existingSession);

        const res: any = await service.syncReplaySessionState(USER_ID, {
            sessionId: existingSession.id,
            accountId: ACCOUNT_UUID,
            revision: 5,
            orders: [],
        });

        expect(res.staleIgnored).toBe(true);
        expect(res.currentRevision).toBe(9);
        expect(backtestRepo.save).not.toHaveBeenCalled();
    });
});


describe('DashboardService Normalized Backtest Tables (Phase 3)', () => {
    it('syncReplaySessionState splits heavy canvas blobs into sessionBlobRepo and keeps _blobSplit marker in backtestRepo', async () => {
        const {
            service,
            accountRepo,
            backtestRepo,
            sessionBlobRepo,
            cacheManager,
        } = createDashboardServiceWithMocks(true);

        const userId = '11111111-1111-4111-8111-111111111111';
        const sessionId = '22222222-2222-4222-8222-222222222222';
        const accountId = '33333333-3333-4333-8333-333333333333';

        accountRepo.findOne.mockResolvedValue({ id: accountId, userId });
        backtestRepo.findOne.mockResolvedValue(null);
        backtestRepo.save.mockImplementation(async (entity: any) => ({
            ...entity,
            id: entity.id || sessionId,
        }));

        const heavyDrawings = [{ id: 'draw-1', name: 'trendLine' }];
        const heavyDrawnItems = [{ id: 'item-1', label: 'OB H1' }];
        const heavyStyles = { 'draw-1': { color: '#00ffaa' } };
        const heavyGeometries = { 'draw-1': [{ timestamp: 1700000000000, value: 2650 }] };
        const heavyShots = [
            {
                id: 'shot-1',
                dataUrl: '/uploads/backtest-screenshots/u1/shot1.png',
                timestamp: 1700000000000,
            },
        ];
        const heavyJournalImgs = ['/uploads/backtest-screenshots/u1/j1.png'];

        const result: any = await service.syncReplaySessionState(userId, {
            sessionId,
            accountId,
            name: 'SMC Gold Session',
            revision: 7,
            symbol: 'XAUUSD',
            timeframe: '5m',
            orders: [{ id: 'ord-1', status: 'WIN', pnl: 320 }],
            drawings: heavyDrawings,
            drawnItems: heavyDrawnItems,
            drawingStylesById: heavyStyles,
            overlayGeometries: heavyGeometries,
            sessionScreenshots: heavyShots,
            journalImages: heavyJournalImgs,
            quantMetrics: { sharpeRatio: 2.1 },
        });

        expect(backtestRepo.save).toHaveBeenCalledTimes(1);
        const savedMetaArg = backtestRepo.save.mock.calls[0][0];
        expect(savedMetaArg.config._blobSplit).toBe(true);
        expect(savedMetaArg.config.drawings).toBeUndefined();
        expect(savedMetaArg.config.drawnItems).toBeUndefined();
        expect(savedMetaArg.config.drawingStylesById).toBeUndefined();
        expect(savedMetaArg.config.overlayGeometries).toBeUndefined();
        expect(savedMetaArg.config.sessionScreenshots).toBeUndefined();
        expect(savedMetaArg.config.journalImages).toBeUndefined();

        expect(sessionBlobRepo!.save).toHaveBeenCalledTimes(1);
        const savedBlobArg = sessionBlobRepo!.save.mock.calls[0][0];
        expect(savedBlobArg.sessionId).toBe(sessionId);
        expect(savedBlobArg.userId).toBe(userId);
        expect(savedBlobArg.revision).toBe(7);
        expect(savedBlobArg.drawings).toEqual(heavyDrawings);
        expect(savedBlobArg.drawnItems).toEqual(heavyDrawnItems);
        expect(savedBlobArg.drawingStylesById).toEqual(heavyStyles);
        expect(savedBlobArg.overlayGeometries).toEqual(heavyGeometries);
        expect(savedBlobArg.sessionScreenshots).toEqual(heavyShots);
        expect(savedBlobArg.journalImages).toEqual(heavyJournalImgs);
        expect(savedBlobArg.quantMetrics).toEqual({ sharpeRatio: 2.1 });

        expect(result.config._blobSplit).toBeUndefined();
        expect(result.config.drawings).toEqual(heavyDrawings);
        expect(result.config.sessionScreenshots).toEqual(heavyShots);
        expect(result.syncedRevision).toBe(7);
        expect(cacheManager.set).toHaveBeenCalled();
    });

    it('getReplaySessionById rehydrates split blobs on DB fallback and skips blob query when knownRevision matches', async () => {
        const {
            service,
            backtestRepo,
            sessionBlobRepo,
        } = createDashboardServiceWithMocks(true);

        const userId = '11111111-1111-4111-8111-111111111111';
        const sessionId = '22222222-2222-4222-8222-222222222222';

        backtestRepo.findOne.mockResolvedValue({
            id: sessionId,
            userId,
            mode: 'REPLAY_SESSION',
            symbol: 'XAUUSD',
            config: {
                revision: 5,
                _blobSplit: true,
                orders: [{ id: 'ord-meta' }],
            },
            results: { netPnl: 400 },
        });

        // Conditional fetch match => short-circuit without querying blob repo
        const unchangedRes: any = await service.getReplaySessionById(userId, sessionId, 5);
        expect(unchangedRes.unchanged).toBe(true);
        expect(unchangedRes.revision).toBe(5);
        expect(sessionBlobRepo!.findOne).not.toHaveBeenCalled();

        // Full fetch => rehydrates heavy canvas arrays & quantMetrics from sessionBlobRepo
        sessionBlobRepo!.findOne.mockResolvedValue({
            sessionId,
            userId,
            revision: 6,
            orders: [{ id: 'ord-blob', status: 'WIN' }],
            drawings: [{ id: 'd-blob' }],
            drawnItems: [{ id: 'item-blob' }],
            drawingStylesById: { 'd-blob': { size: 2 } },
            overlayGeometries: { 'd-blob': [{ value: 2600 }] },
            sessionScreenshots: ['/uploads/backtest-screenshots/u1/shot-blob.png'],
            journalImages: ['/uploads/backtest-screenshots/u1/j-blob.png'],
            quantMetrics: { sortinoRatio: 2.8 },
        });

        const hydrated: any = await service.getReplaySessionById(userId, sessionId, 2);
        expect(sessionBlobRepo!.findOne).toHaveBeenCalledTimes(1);
        expect(hydrated.cacheLayer).toBe('POSTGRES');
        expect(hydrated.config._blobSplit).toBeUndefined();
        expect(hydrated.config.orders).toEqual([{ id: 'ord-blob', status: 'WIN' }]);
        expect(hydrated.config.drawings).toEqual([{ id: 'd-blob' }]);
        expect(hydrated.config.drawnItems).toEqual([{ id: 'item-blob' }]);
        expect(hydrated.config.drawingStylesById).toEqual({ 'd-blob': { size: 2 } });
        expect(hydrated.config.sessionScreenshots).toEqual(['/uploads/backtest-screenshots/u1/shot-blob.png']);
        expect(hydrated.results.quantMetrics).toEqual({ sortinoRatio: 2.8 });
    });

    it('syncBacktestStrategy and getBacktestStrategies dual-write to strategyRepo and lazy-backfill legacy rows', async () => {
        const {
            service,
            backtestRepo,
            strategyRepo,
        } = createDashboardServiceWithMocks(true);

        const userId = '11111111-1111-4111-8111-111111111111';
        const strategyId = '44444444-4444-4444-8444-444444444444';

        backtestRepo.findOne.mockResolvedValue(null);
        backtestRepo.save.mockImplementation(async (entity: any) => ({
            ...entity,
            id: entity.id || strategyId,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-02T00:00:00Z'),
        }));

        const synced = await service.syncBacktestStrategy(userId, {
            id: 'strat-custom-1',
            name: 'ICT Killzone NY',
            primarySymbol: 'NAS100',
            symbols: ['NAS100', 'US30'],
            riskPerTrade: 0.75,
            defaultTimeframe: '15m',
            rrTarget: 3,
        });

        expect(backtestRepo.save).toHaveBeenCalledTimes(1);
        expect(strategyRepo!.save).toHaveBeenCalledTimes(1);
        expect(strategyRepo!.save.mock.calls[0][0].clientStrategyId).toBe('strat-custom-1');
        expect(strategyRepo!.save.mock.calls[0][0].primarySymbol).toBe('NAS100');
        expect(synced.name).toBe('ICT Killzone NY');

        // Lazy backfill: when strategyRepo is empty, reads legacy backtestRepo and backfills strategyRepo
        strategyRepo!.find.mockResolvedValueOnce([]);
        backtestRepo.find.mockResolvedValueOnce([
            {
                id: strategyId,
                userId,
                mode: 'STRATEGY_DEFINITION',
                name: 'Legacy SMC',
                symbol: 'EURUSD',
                config: {
                    clientStrategyId: 'legacy-smc',
                    tradingMethod: 'SMC',
                    startingCapital: 50000,
                    riskPerTrade: 1,
                },
                notes: 'Legacy note',
                createdAt: new Date('2026-01-01T00:00:00Z'),
                updatedAt: new Date('2026-01-02T00:00:00Z'),
            },
        ]);

        const listed = await service.getBacktestStrategies(userId);
        expect(listed).toHaveLength(1);
        expect(listed[0].id).toBe('legacy-smc');
        expect(strategyRepo!.save).toHaveBeenCalledTimes(2);
    });

    it('saveBacktestHypothesis, getBacktestHypotheses and deleteBacktestHypothesisById enforce account ownership and dual-write', async () => {
        const {
            service,
            accountRepo,
            backtestRepo,
            hypothesisRepo,
        } = createDashboardServiceWithMocks(true);

        const userId = '11111111-1111-4111-8111-111111111111';
        const accountId = '33333333-3333-4333-8333-333333333333';
        const foreignAccountId = '99999999-9999-4999-8999-999999999999';
        const hypothesisId = '55555555-5555-4555-8555-555555555555';

        // Strict account ownership guard
        accountRepo.findOne.mockResolvedValueOnce(null);
        await expect(
            service.saveBacktestHypothesis(userId, {
                accountId: foreignAccountId,
                name: 'Unauthorized test',
            })
        ).rejects.toThrow(NestForbiddenException);
        expect(hypothesisRepo!.save).not.toHaveBeenCalled();

        // Valid save dual-writes to backtest_sessions + backtest_hypotheses
        accountRepo.findOne.mockResolvedValue({ id: accountId, userId });
        backtestRepo.findOne.mockResolvedValue(null);
        backtestRepo.save.mockImplementation(async (entity: any) => ({
            ...entity,
            id: entity.id || hypothesisId,
        }));

        const saved = await service.saveBacktestHypothesis(userId, {
            id: hypothesisId,
            accountId,
            name: 'Remove Asian Session',
            mode: 'ACCOUNT_HISTORY',
            symbol: 'XAUUSD',
            config: { excludeHours: [0, 1, 2] },
            results: { simulatedNetProfit: 1250 },
        });
        expect(saved.id).toBe(hypothesisId);
        expect(hypothesisRepo!.save).toHaveBeenCalledTimes(1);
        expect(hypothesisRepo!.save.mock.calls[0][0].accountId).toBe(accountId);

        // Listing from normalized hypothesisRepo shapes into BacktestSession payload
        hypothesisRepo!.find.mockResolvedValueOnce([
            {
                id: hypothesisId,
                userId,
                accountId,
                name: 'Remove Asian Session',
                mode: 'ACCOUNT_HISTORY',
                strategy: 'Hipótese sobre o histórico',
                symbol: 'XAUUSD',
                config: { excludeHours: [0, 1, 2] },
                results: { simulatedNetProfit: 1250 },
                notes: '',
            },
        ]);
        const list = await service.getBacktestHypotheses(userId, accountId);
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(hypothesisId);
        expect(list[0].results.simulatedNetProfit).toBe(1250);

        // Delete removes from both repos
        hypothesisRepo!.findOne.mockResolvedValueOnce({ id: hypothesisId, accountId });
        backtestRepo.findOne.mockResolvedValueOnce({ id: hypothesisId, userId, accountId, mode: 'ACCOUNT_HISTORY' });
        const delRes = await service.deleteBacktestHypothesisById(userId, hypothesisId);
        expect(delRes).toEqual({ ok: true, deleted: true, id: hypothesisId });
        expect(hypothesisRepo!.delete).toHaveBeenCalledWith({ id: hypothesisId, userId });
        expect(backtestRepo.remove).toHaveBeenCalledTimes(1);
    });
});
