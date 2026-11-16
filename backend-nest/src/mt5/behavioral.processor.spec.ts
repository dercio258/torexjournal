import { BehavioralProcessor } from './behavioral.processor';
import { BehaviorRetrainScheduler } from './behavior-retrain.scheduler';
import { AlertSeverity, AlertType } from '../alerts/alert.entity';
import { NotificationType } from '../notifications/notification.entity';
import { Mt5Service } from './mt5.service';
import { Mt5Gateway } from './mt5.gateway';
import { DashboardService } from '../dashboard/dashboard.service';

describe('BehavioralProcessor (PyTorch Behavior ML + Fallback)', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    function buildTrades(count = 6) {
        const baseMs = Date.UTC(2026, 9, 1, 9, 0, 0);
        return Array.from({ length: count }).map((_, i) => ({
            id: `trade-${i}`,
            ticket: `t-${i}`,
            accountId: 'acc-1',
            symbol: 'XAUUSD',
            type: 'BUY',
            volume: i === count - 1 ? 0.6 : 0.2,
            openPrice: 2650,
            closePrice: 2645,
            sl: i === count - 1 ? null : 2640,
            tp: 2670,
            profit: i >= count - 4 && i < count - 1 ? -120 : 80,
            commission: 0,
            swap: 0,
            netPnl: i >= count - 4 && i < count - 1 ? -120 : 80,
            openTime: new Date(baseMs + i * 3600_000),
            closeTime: new Date(baseMs + i * 3600_000 + 600_000),
            status: 'CLOSED',
            magic: 0,
            session: 'London',
            qualityFlags: i === count - 1 ? { existingFlag: true } : { behavioralMl: { anomalyScore: 15 } },
        }));
    }

    function createMocks() {
        const tradeRepo = {
            find: jest.fn(),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        const alertsService = {
            create: jest.fn().mockImplementation(async (userId, data) => ({
                id: 'alert-new',
                userId,
                ...data,
                resolved: false,
                createdAt: new Date(),
            })),
        };
        const accountRepo = {
            findOne: jest.fn().mockResolvedValue({
                id: 'acc-1',
                type: 'challenge',
                currency: 'USD',
                initialBalance: 10000,
                balance: 9600,
                leverage: 100,
                propFirmRules: { dailyLossLimit: 400, maxDrawdown: 800 },
            }),
        };
        const tradeNoteRepo = { find: jest.fn().mockResolvedValue([]) };
        const techJournalRepo = { find: jest.fn().mockResolvedValue([]) };
        const dailyNoteRepo = { find: jest.fn().mockResolvedValue([]) };
        const mentalLogRepo = { find: jest.fn().mockResolvedValue([]) };
        const alertRepo = { find: jest.fn().mockResolvedValue([]) };

        const processor = new BehavioralProcessor(
            tradeRepo as any,
            alertsService as any,
            accountRepo as any,
            tradeNoteRepo as any,
            techJournalRepo as any,
            dailyNoteRepo as any,
            mentalLogRepo as any,
            alertRepo as any,
        );

        return {
            processor,
            tradeRepo,
            alertsService,
            alertRepo,
        };
    }

    it('calls PyTorch Behavior ML endpoint, updates qualityFlags, and creates deduplicated alerts', async () => {
        const { processor, tradeRepo, alertsService } = createMocks();
        const trades = buildTrades(6);
        tradeRepo.find.mockResolvedValue([...trades].reverse());

        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                modelVersion: 'torex-behavior-pytorch-v1.0.0',
                modelStatus: 'TRAINED_PYTORCH',
                batchSummary: {
                    totalEvaluated: 1,
                    flaggedTradesCount: 1,
                    behaviorHealthScore: 28.5,
                    maxAnomalyScore: 86.2,
                    dominantPattern: 'revenge_trading',
                },
                tradePredictions: [
                    {
                        tradeId: 'trade-5',
                        ticket: 't-5',
                        anomalyScore: 86.2,
                        riskLevel: 'CRITICAL',
                        probabilities: { revenge_trading: 0.88, tilt_risk_escalation: 0.79 },
                        activeFlags: ['revenge_trading', 'tilt_risk_escalation'],
                        effectiveSession: 'London',
                        effectiveStrategy: '<UNTAGGED>',
                        executionMode: 'MANUAL',
                        reasons: ['Reentrada rápida após perdas com lote 3.0x da mediana.'],
                    },
                ],
                recommendedAlerts: [
                    {
                        patternCode: 'revenge_trading',
                        alertType: 'PSYCHOLOGY',
                        severity: 'CRITICAL',
                        title: 'Alerta ML PyTorch: Revenge Trading',
                        description: 'Padrão detetado nos trades importados.',
                        tradeId: 'trade-5',
                        metadata: { confidence: 0.88, anomalyScore: 86.2 },
                    },
                ],
            }),
        });
        global.fetch = fetchMock as any;

        await processor.handleBehaviorAnalysis({ data: { userId: 'user-1', accountId: 'acc-1' } } as any);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/ml/behavior/analyze-trades');
        const sentPayload = JSON.parse(init.body);
        expect(sentPayload.historicalTrades).toHaveLength(5);
        expect(sentPayload.newTrades).toHaveLength(1);
        expect(sentPayload.newTrades[0].id).toBe('trade-5');
        expect(sentPayload.accountContext.dailyLossLimit).toBe(400);

        expect(tradeRepo.update).toHaveBeenCalledWith(
            { id: 'trade-5' },
            expect.objectContaining({
                qualityFlags: expect.objectContaining({
                    existingFlag: true,
                    behavioralMl: expect.objectContaining({
                        anomalyScore: 86.2,
                        riskLevel: 'CRITICAL',
                    }),
                }),
            }),
        );

        expect(alertsService.create).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({
                type: AlertType.PSYCHOLOGY,
                severity: AlertSeverity.CRITICAL,
                tradeId: 'trade-5',
                metadata: expect.objectContaining({
                    accountId: 'acc-1',
                    patternCode: 'revenge_trading',
                    source: 'pytorch-behavior-ml',
                }),
            }),
        );
    });

    it('skips creating duplicate unresolved alerts for the same account and pattern within 6 hours', async () => {
        const { processor, tradeRepo, alertsService, alertRepo } = createMocks();
        const trades = buildTrades(6);
        tradeRepo.find.mockResolvedValue([...trades].reverse());
        alertRepo.find.mockResolvedValue([
            {
                id: 'existing-alert',
                resolved: false,
                metadata: { accountId: 'acc-1', patternCode: 'revenge_trading' },
            },
        ]);

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                modelVersion: 'torex-behavior-pytorch-v1.0.0',
                modelStatus: 'TRAINED_PYTORCH',
                batchSummary: {
                    totalEvaluated: 1,
                    flaggedTradesCount: 1,
                    behaviorHealthScore: 30,
                    maxAnomalyScore: 82,
                },
                tradePredictions: [
                    {
                        tradeId: 'trade-5',
                        anomalyScore: 82,
                        riskLevel: 'HIGH',
                        probabilities: { revenge_trading: 0.82 },
                        activeFlags: ['revenge_trading'],
                        effectiveSession: 'London',
                        effectiveStrategy: '<UNTAGGED>',
                        executionMode: 'MANUAL',
                        reasons: ['Reentrada rápida.'],
                    },
                ],
                recommendedAlerts: [
                    {
                        patternCode: 'revenge_trading',
                        alertType: 'PSYCHOLOGY',
                        severity: 'CRITICAL',
                        title: 'Alerta ML PyTorch: Revenge Trading',
                        description: 'Duplicado',
                        tradeId: 'trade-5',
                    },
                ],
            }),
        }) as any;

        await processor.handleBehaviorAnalysis({ data: { userId: 'user-1', accountId: 'acc-1' } } as any);

        expect(tradeRepo.update).toHaveBeenCalledTimes(1);
        expect(alertsService.create).not.toHaveBeenCalled();
    });

    it('falls back cleanly to deterministic tilt check when Python service is unreachable', async () => {
        const { processor, tradeRepo, alertsService } = createMocks();
        const tradesDesc = buildTrades(6).reverse();
        tradeRepo.find.mockResolvedValue(tradesDesc);

        global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

        await expect(
            processor.handleBehaviorAnalysis({ data: { userId: 'user-1', accountId: 'acc-1' } } as any),
        ).resolves.toBeUndefined();

        expect(alertsService.create).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({
                type: AlertType.PSYCHOLOGY,
                severity: AlertSeverity.CRITICAL,
                metadata: expect.objectContaining({
                    accountId: 'acc-1',
                    patternCode: 'tilt_risk_escalation',
                    source: 'deterministic-fallback',
                }),
            }),
        );
    });

    it('persists Human-in-the-Loop feedback via Mt5Service and resolves linked alerts on FALSE_POSITIVE', async () => {
        const accountRepo = {
            find: jest.fn().mockResolvedValue([{ id: 'acc-1', userId: 'user-1' }]),
        };
        const tradeEntity: any = {
            id: '11111111-1111-4111-8111-111111111111',
            accountId: 'acc-1',
            ticket: 't-99',
            qualityFlags: { behavioralMl: { anomalyScore: 81.2, activeFlags: ['revenge_trading'] } },
        };
        const tradeRepo = {
            findOne: jest.fn().mockResolvedValue(tradeEntity),
            save: jest.fn().mockImplementation(async (t) => t),
        };
        const updateAlertMock = jest.fn().mockResolvedValue({ affected: 1 });
        const dataSource = {
            getRepository: jest.fn().mockReturnValue({ update: updateAlertMock }),
        };

        const service = new Mt5Service(
            accountRepo as any,
            {} as any,
            tradeRepo as any,
            {} as any,
            {} as any,
            {} as any,
            dataSource as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );

        const res = await service.submitBehaviorFeedback(
            '11111111-1111-4111-8111-111111111111',
            { verdict: 'FALSE_POSITIVE', correctedFlags: [], note: 'News spike planned in journal' },
            'user-1',
        );

        expect(res.success).toBe(true);
        expect(res.behavioralFeedback.verdict).toBe('FALSE_POSITIVE');
        expect(tradeRepo.save).toHaveBeenCalledTimes(1);
        expect(updateAlertMock).toHaveBeenCalledWith(
            { userId: 'user-1', tradeId: tradeEntity.id, resolved: false },
            { resolved: true },
        );
    });

    it('evaluates live open positions pre-close and pushes WS + multi-channel RISK_ALERT on CRITICAL findings', async () => {
        const closedTrades = buildTrades(4);
        const tradeRepo = {
            find: jest.fn().mockResolvedValue([...closedTrades].reverse()),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        const positionRepo = {
            findOne: jest.fn().mockResolvedValue({
                id: 'pos-live-1',
                accountId: 'acc-1',
                ticket: '998877',
                symbol: 'XAUUSD',
                type: 'BUY',
                volume: 1.5,
                openPrice: 2660,
                currentPrice: 2658,
                sl: null,
                tp: 2690,
                profit: -25,
                openTime: new Date(Date.UTC(2026, 9, 1, 14, 0, 0)),
            }),
        };
        const alertsService = {
            create: jest.fn().mockImplementation(async (userId, data) => ({
                id: 'alert-live-crit',
                userId,
                ...data,
                resolved: false,
                createdAt: new Date(),
            })),
        };
        const accountRepo = {
            findOne: jest.fn().mockResolvedValue({
                id: 'acc-1',
                type: 'challenge',
                currency: 'USD',
                initialBalance: 10000,
                balance: 9500,
                leverage: 100,
                propFirmRules: { dailyLossLimit: 400 },
            }),
        };
        const alertRepo = { find: jest.fn().mockResolvedValue([]) };
        const notificationsService = {
            create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
        };
        const mt5Gateway = {
            broadcastBehaviorAlert: jest.fn(),
        };

        const processor = new BehavioralProcessor(
            tradeRepo as any,
            alertsService as any,
            accountRepo as any,
            { find: jest.fn().mockResolvedValue([]) } as any,
            { find: jest.fn().mockResolvedValue([]) } as any,
            { find: jest.fn().mockResolvedValue([]) } as any,
            { find: jest.fn().mockResolvedValue([]) } as any,
            alertRepo as any,
            positionRepo as any,
            notificationsService as any,
            mt5Gateway as any,
        );

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                modelVersion: 'torex-behavior-hybrid-v2.0.0',
                modelStatus: 'TRAINED_PYTORCH',
                batchSummary: {
                    totalEvaluated: 1,
                    flaggedTradesCount: 1,
                    behaviorHealthScore: 22.0,
                    maxAnomalyScore: 91.5,
                    dominantPattern: 'tilt_risk_escalation',
                },
                tradePredictions: [
                    {
                        tradeId: 'open:pos-live-1',
                        ticket: '998877',
                        anomalyScore: 91.5,
                        riskLevel: 'CRITICAL',
                        probabilities: { tilt_risk_escalation: 0.91 },
                        activeFlags: ['tilt_risk_escalation'],
                        effectiveSession: 'London',
                        effectiveStrategy: '<UNTAGGED>',
                        executionMode: 'MANUAL',
                        reasons: ['Posição aberta com lote 7.5x sem SL após sequência de perdas.'],
                    },
                ],
                recommendedAlerts: [
                    {
                        patternCode: 'tilt_risk_escalation',
                        alertType: 'RISK',
                        severity: 'CRITICAL',
                        title: 'Risco Crítico em Posição Aberta',
                        description: 'Tilt detetado antes do fecho da posição #998877.',
                        tradeId: 'open:pos-live-1',
                        metadata: { confidence: 0.91 },
                    },
                ],
            }),
        }) as any;

        await processor.handleOpenPositionGuardrail({
            data: { userId: 'user-1', accountId: 'acc-1', ticket: '998877' },
        } as any);

        // Open position must not be written into closed `trades` table
        expect(tradeRepo.update).not.toHaveBeenCalled();
        expect(alertsService.create).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({
                severity: AlertSeverity.CRITICAL,
                tradeId: undefined,
                metadata: expect.objectContaining({
                    livePreCloseGuardrail: true,
                    openTicket: '998877',
                }),
            }),
        );
        expect(mt5Gateway.broadcastBehaviorAlert).toHaveBeenCalledWith(
            expect.objectContaining({
                accountId: 'acc-1',
                patternCode: 'tilt_risk_escalation',
                severity: 'CRITICAL',
                openTicket: '998877',
            }),
            'user-1',
        );
        expect(notificationsService.create).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({
                type: NotificationType.RISK_ALERT,
                actionUrl: '/trades',
            }),
        );
    });

    it('skips scheduled weekly retrain when no new human feedback arrived since last training', async () => {
        const dataSource = {
            query: jest.fn().mockResolvedValue([
                { cnt: 1, latest_fb: '2026-11-15T10:00:00.000Z' },
            ]),
        };
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                status: 'ok',
                trainingMetrics: {
                    trainedAtUtc: '2026-11-15T14:53:16.000Z',
                },
            }),
        }) as any;

        const scheduler = new BehaviorRetrainScheduler(dataSource as any);
        const res = await scheduler.runScheduledRetrainCheck(false);

        expect(res.triggered).toBe(false);
        expect(res.reason).toBe('no_new_feedback_since_last_train');
        expect(res.feedbackCount).toBe(1);
    });

    it('aggregates behavior analytics across real trades and respects FALSE_POSITIVE exclusions', async () => {
        const accountRepo = {
            find: jest.fn().mockResolvedValue([{ id: 'acc-1', name: 'Live', type: 'live' }]),
        };
        const tradeRepo = {
            find: jest.fn().mockResolvedValue([
                {
                    id: 'tr-1',
                    qualityFlags: {
                        behavioralMl: {
                            anomalyScore: 90,
                            riskLevel: 'CRITICAL',
                            activeFlags: ['revenge_trading', 'tilt_risk_escalation'],
                        },
                        behavioralFeedback: { verdict: 'CONFIRM' },
                    },
                },
                {
                    id: 'tr-2',
                    qualityFlags: {
                        behavioralMl: {
                            anomalyScore: 78,
                            riskLevel: 'HIGH',
                            activeFlags: ['revenge_trading'],
                        },
                        behavioralFeedback: { verdict: 'FALSE_POSITIVE' },
                    },
                },
                {
                    id: 'tr-3',
                    qualityFlags: {
                        behavioralMl: {
                            anomalyScore: 12,
                            riskLevel: 'LOW',
                            activeFlags: [],
                        },
                    },
                },
            ]),
        };

        global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as any;

        const service = new Mt5Service(
            accountRepo as any,
            {} as any,
            tradeRepo as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );

        const res = await service.getBehaviorAnalytics('user-1', 'all');

        expect(res.status).toBe('ok');
        expect(res.engineStatus).toEqual({ status: 'offline' });
        expect(res.summary).toEqual({
            totalTrades: 3,
            scoredTrades: 3,
            flaggedTrades: 1,
            avgAnomalyScore: 60,
            confirmCount: 1,
            falsePositiveCount: 1,
            riskBreakdown: { LOW: 1, MODERATE: 0, HIGH: 1, CRITICAL: 1 },
            patternCounts: { revenge_trading: 1, tilt_risk_escalation: 1 },
        });
    });

    it('broadcasts live WebSocket behavior alerts strictly scoped to mt5_user room', () => {
        const gateway = new Mt5Gateway({} as any);
        const emitMock = jest.fn();
        const toMock = jest.fn().mockReturnValue({ emit: emitMock });
        (gateway as any).server = { to: toMock };

        const payload = { patternCode: 'revenge_trading', severity: 'CRITICAL' };
        gateway.broadcastBehaviorAlert(payload);
        expect(toMock).not.toHaveBeenCalled();

        gateway.broadcastBehaviorAlert(payload, 'u-77');
        expect(toMock).toHaveBeenCalledWith('mt5_user:u-77');
        expect(emitMock).toHaveBeenCalledWith('mt5_behavior_alert', payload);
    });

    it('applies mlFilter JSONB predicates and excludes open positions in DashboardService.getTradesPaginated', async () => {
        const tradeQueryMock = jest
            .fn()
            .mockResolvedValueOnce([{ sym: 'XAUUSD' }])
            .mockResolvedValueOnce([{ cnt: 1, net_sum: -50 }])
            .mockResolvedValueOnce([
                {
                    id: 'tr-1',
                    accountId: 'acc-1',
                    ticket: '101',
                    symbol: 'XAUUSD',
                    profit: -50,
                    qualityFlags: { behavioralMl: { riskLevel: 'CRITICAL', anomalyScore: 88 } },
                },
            ])
            .mockResolvedValueOnce([{ sym: 'XAUUSD' }])
            .mockResolvedValueOnce([{ cnt: 1, net_sum: 25 }])
            .mockResolvedValueOnce([
                {
                    id: 'tr-2',
                    accountId: 'acc-1',
                    ticket: '102',
                    symbol: 'XAUUSD',
                    profit: 25,
                    qualityFlags: { behavioralMl: { riskLevel: 'LOW', anomalyScore: 10, activeFlags: [] } },
                },
            ]);

        const positionRepo = {
            find: jest.fn().mockResolvedValue([
                {
                    id: 'open-1',
                    accountId: 'acc-1',
                    ticket: '999',
                    symbol: 'XAUUSD',
                    type: 'BUY',
                    volume: 0.1,
                    openPrice: 2650,
                    currentPrice: 2652,
                    profit: 20,
                    openTime: new Date('2026-11-15T10:00:00Z'),
                },
            ]),
        };

        const dashboard = new DashboardService(
            { query: tradeQueryMock } as any,
            positionRepo as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );

        jest.spyOn(dashboard, 'validateUserAccount').mockResolvedValue({
            isConsolidated: false,
            accounts: [{ id: 'acc-1', name: 'Conta 1', broker: 'MT5' } as any],
            accountIds: ['acc-1'],
            targetAccount: null as any,
        });
        jest.spyOn(dashboard as any, 'enrichTradesWithJournalContext').mockImplementation(async (_u, _a, rows) => rows as any);

        const highCritRes = await dashboard.getTradesPaginated('user-1', {
            accountId: 'acc-1',
            mlFilter: 'HIGH_CRITICAL',
            page: 1,
            limit: 15,
        });

        expect(highCritRes.items).toHaveLength(1);
        expect(highCritRes.items[0].isOpenPosition).toBe(false);
        expect(highCritRes.items[0].id).toBe('tr-1');

        const highCritDataSql = String(tradeQueryMock.mock.calls[2][0]);
        expect(highCritDataSql).toContain(`(t."qualityFlags"->'behavioralMl'->>'riskLevel') IN ('HIGH', 'CRITICAL')`);
        expect(highCritDataSql).toContain(`<> 'FALSE_POSITIVE'`);
        expect(highCritDataSql).toContain(`t."qualityFlags"`);

        await dashboard.getTradesPaginated('user-1', {
            accountId: 'acc-1',
            mlFilter: 'CLEAN',
            page: 1,
            limit: 15,
        });

        const cleanDataSql = String(tradeQueryMock.mock.calls[5][0]);
        expect(cleanDataSql).toContain(`'FALSE_POSITIVE'`);
        expect(cleanDataSql).toContain(`'LOW'`);
    });
});
