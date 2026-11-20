import { Process, Processor } from '@nestjs/bull';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { TradeEntity } from './trade.entity';
import { PositionEntity } from './position.entity';
import { AccountEntity } from '../account/account.entity';
import { DailyNoteEntity, TradeNoteEntity } from '../dashboard/journal-notes.entity';
import { TechnicalJournal } from '../dashboard/technical-journal.entity';
import { MentalLog } from '../dashboard/mental-log.entity';
import { AlertsService } from '../alerts/alerts.service';
import { AlertEntity, AlertSeverity, AlertType } from '../alerts/alert.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { Mt5Gateway } from './mt5.gateway';
import { getQuantInternalHeaders } from '../common/security/security.config';

interface PyTorchBehaviorPrediction {
    tradeId: string;
    ticket?: string | null;
    anomalyScore: number;
    riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
    probabilities: Record<string, number>;
    activeFlags: string[];
    effectiveSession: string;
    effectiveStrategy: string;
    executionMode: string;
    reasons: string[];
}

interface PyTorchRecommendedAlert {
    patternCode: string;
    alertType: 'PSYCHOLOGY' | 'RISK' | 'DISCIPLINE' | 'COACHING';
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    title: string;
    description: string;
    tradeId?: string | null;
    metadata?: Record<string, any>;
}

interface PyTorchAnalyzeResponse {
    modelVersion: string;
    modelStatus: 'TRAINED_PYTORCH' | 'BOOTSTRAP_PYTORCH';
    batchSummary: {
        totalEvaluated: number;
        flaggedTradesCount: number;
        behaviorHealthScore: number;
        maxAnomalyScore: number;
        dominantPattern?: string | null;
    };
    tradePredictions: PyTorchBehaviorPrediction[];
    recommendedAlerts: PyTorchRecommendedAlert[];
}

const ALERT_DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;

@Processor('behavioral-analysis')
export class BehavioralProcessor {
    private readonly logger = new Logger(BehavioralProcessor.name);

    constructor(
        @InjectRepository(TradeEntity)
        private readonly tradeRepo: Repository<TradeEntity>,
        private readonly alertsService: AlertsService,
        @Optional()
        @InjectRepository(AccountEntity)
        private readonly accountRepo?: Repository<AccountEntity>,
        @Optional()
        @InjectRepository(TradeNoteEntity)
        private readonly tradeNoteRepo?: Repository<TradeNoteEntity>,
        @Optional()
        @InjectRepository(TechnicalJournal)
        private readonly techJournalRepo?: Repository<TechnicalJournal>,
        @Optional()
        @InjectRepository(DailyNoteEntity)
        private readonly dailyNoteRepo?: Repository<DailyNoteEntity>,
        @Optional()
        @InjectRepository(MentalLog)
        private readonly mentalLogRepo?: Repository<MentalLog>,
        @Optional()
        @InjectRepository(AlertEntity)
        private readonly alertRepo?: Repository<AlertEntity>,
        @Optional()
        @InjectRepository(PositionEntity)
        private readonly positionRepo?: Repository<PositionEntity>,
        @Optional()
        private readonly notificationsService?: NotificationsService,
        @Optional()
        private readonly mt5Gateway?: Mt5Gateway,
    ) {}

    private sortTradesChronologically(trades: TradeEntity[]): TradeEntity[] {
        return [...trades].sort((a, b) => {
            const aOpen = a.openTime ? new Date(a.openTime).getTime() : 0;
            const bOpen = b.openTime ? new Date(b.openTime).getTime() : 0;
            if (aOpen !== bOpen) return aOpen - bOpen;
            const aClose = a.closeTime ? new Date(a.closeTime).getTime() : aOpen;
            const bClose = b.closeTime ? new Date(b.closeTime).getTime() : bOpen;
            if (aClose !== bClose) return aClose - bClose;
            return String(a.id).localeCompare(String(b.id));
        });
    }

    @Process('analyze-user-behavior')
    async handleBehaviorAnalysis(job: Job<{ userId: string; accountId: string }>) {
        const { userId, accountId } = job.data;
        this.logger.log(`Starting behavioral ML analysis for user ${userId} (account ${accountId})`);

        try {
            const recentDesc = await this.tradeRepo.find({
                where: { accountId, status: 'CLOSED' },
                order: { openTime: 'DESC' },
                take: 60,
            });

            if (recentDesc.length === 0) {
                return;
            }

            const tradesChron = this.sortTradesChronologically(recentDesc);

            const mlResponse = await this.tryRunPyTorchBehaviorAnalysis(userId, accountId, tradesChron);
            if (mlResponse) {
                await this.persistPyTorchResults(userId, accountId, tradesChron, mlResponse);
                return;
            }

            await this.runDeterministicFallback(userId, accountId);
        } catch (error: any) {
            this.logger.error(`Behavioral analysis failed for user ${userId}: ${error?.message || error}`);
        }
    }

    @Process('analyze-open-position')
    async handleOpenPositionGuardrail(job: Job<{ userId: string; accountId: string; ticket: string }>) {
        const { userId, accountId, ticket } = job.data;
        if (!this.positionRepo || !ticket) {
            return;
        }
        try {
            const openPos = await this.positionRepo.findOne({
                where: { accountId, ticket: String(ticket) },
            });
            if (!openPos) {
                return;
            }

            const recentClosed = await this.tradeRepo.find({
                where: { accountId, status: 'CLOSED' },
                order: { openTime: 'DESC' },
                take: 55,
            });

            const openRefId = `open:${openPos.id || openPos.ticket}`;
            const syntheticOpenTrade = {
                id: openRefId,
                accountId: openPos.accountId,
                ticket: String(openPos.ticket || ticket),
                symbol: openPos.symbol,
                type: openPos.type,
                volume: Number(openPos.volume) || 0,
                openPrice: Number(openPos.openPrice) || 0,
                closePrice: Number(openPos.currentPrice || openPos.openPrice) || 0,
                sl: openPos.sl ?? null,
                tp: openPos.tp ?? null,
                profit: 0,
                commission: 0,
                swap: 0,
                netPnl: 0,
                openTime: openPos.openTime || new Date(),
                closeTime: null,
                magic: 0,
                status: 'OPEN',
            } as unknown as TradeEntity;

            const tradesChron = [
                ...this.sortTradesChronologically(recentClosed),
                syntheticOpenTrade,
            ];

            const mlResponse = await this.tryRunPyTorchBehaviorAnalysis(
                userId,
                accountId,
                tradesChron,
                new Set([openRefId]),
            );
            if (mlResponse) {
                await this.persistPyTorchResults(userId, accountId, tradesChron, mlResponse, String(openPos.ticket || ticket));
            }
        } catch (error: any) {
            this.logger.error(
                `Open-position behavioral guardrail failed for ticket ${ticket}: ${error?.message || error}`,
            );
        }
    }

    private getBehaviorMlBaseUrl(): string {
        const raw =
            process.env.BEHAVIOR_ML_URL ||
            process.env.QUANT_ENGINE_URL ||
            'http://127.0.0.1:8001';
        return raw.trim().replace(/\/$/, '');
    }

    private toDateKey(dt?: Date | string | null): string | null {
        if (!dt) return null;
        const parsed = dt instanceof Date ? dt : new Date(dt);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString().slice(0, 10);
    }

    private async tryRunPyTorchBehaviorAnalysis(
        userId: string,
        accountId: string,
        tradesChron: TradeEntity[],
        explicitTargetIds?: Set<string>,
    ): Promise<PyTorchAnalyzeResponse | null> {
        const unscoredIds = explicitTargetIds && explicitTargetIds.size > 0
            ? explicitTargetIds
            : new Set(
                  tradesChron
                      .filter((t) => !(t.qualityFlags && (t.qualityFlags as any).behavioralMl))
                      .slice(-20)
                      .map((t) => String(t.id)),
              );

        const targetTrades =
            unscoredIds.size > 0
                ? tradesChron.filter((t) => unscoredIds.has(String(t.id)))
                : tradesChron.slice(-5);
        const targetIdSet = new Set(targetTrades.map((t) => String(t.id)));
        const historicalTrades = tradesChron.filter((t) => !targetIdSet.has(String(t.id)));

        const account = this.accountRepo
            ? await this.accountRepo.findOne({ where: { id: accountId } }).catch(() => null)
            : null;

        // Fetch trade notes for enriched strategy & psychology signals
        const noteLookupKeys = Array.from(
            new Set(
                tradesChron.flatMap((t) => [String(t.id), t.ticket ? String(t.ticket) : '']).filter(Boolean),
            ),
        );
        const tradeNoteMap = new Map<string, TradeNoteEntity>();
        if (this.tradeNoteRepo && noteLookupKeys.length > 0) {
            const notes = await this.tradeNoteRepo
                .find({ where: { userId, tradeId: In(noteLookupKeys) } })
                .catch(() => [] as TradeNoteEntity[]);
            for (const note of notes) {
                tradeNoteMap.set(String(note.tradeId), note);
            }
        }

        // Fetch date-scoped journal & mental logs
        const dateKeys = Array.from(
            new Set(tradesChron.map((t) => this.toDateKey(t.openTime)).filter((d): d is string => Boolean(d))),
        );
        const minDate = dateKeys.length > 0 ? dateKeys.sort()[0] : null;
        const journalMap = new Map<string, Record<string, any>>();

        if (minDate && this.mentalLogRepo) {
            const mentalLogs = await this.mentalLogRepo
                .find({ where: { accountId, date: MoreThanOrEqual(minDate) } })
                .catch(() => [] as MentalLog[]);
            for (const m of mentalLogs) {
                const d = String(m.date).slice(0, 10);
                journalMap.set(d, {
                    date: d,
                    sleepQuality: m.sleepQuality,
                    energy: m.energy,
                    focus: m.focus,
                    moodScore: m.mood,
                    stress: m.stress,
                });
            }
        }

        if (minDate && this.techJournalRepo) {
            const techJournals = await this.techJournalRepo
                .find({ where: { accountId, date: MoreThanOrEqual(minDate) } })
                .catch(() => [] as TechnicalJournal[]);
            for (const tj of techJournals) {
                const d = String(tj.date).slice(0, 10);
                const cur = journalMap.get(d) || { date: d };
                journalMap.set(d, {
                    ...cur,
                    strategyUsed: tj.strategyUsed || cur.strategyUsed,
                    emotionalState: tj.emotionalState || cur.emotionalState,
                    rulesBroken: tj.rulesBroken || cur.rulesBroken,
                });
            }
        }

        if (minDate && this.dailyNoteRepo) {
            const dailyNotes = await this.dailyNoteRepo
                .find({ where: { userId, date: MoreThanOrEqual(minDate) } })
                .catch(() => [] as DailyNoteEntity[]);
            for (const dn of dailyNotes) {
                if (dn.accountKey !== accountId && dn.accountKey !== 'all') continue;
                const d = String(dn.date).slice(0, 10);
                const cur = journalMap.get(d) || { date: d };
                const psych = dn.psychCheck || {};
                const toNum = (v: any) => {
                    const n = Number(v);
                    return Number.isFinite(n) ? n : undefined;
                };
                journalMap.set(d, {
                    ...cur,
                    sleepQuality: cur.sleepQuality ?? toNum(psych.sleep),
                    energy: cur.energy ?? toNum(psych.energy),
                    focus: cur.focus ?? toNum(psych.focus),
                    stress: cur.stress ?? toNum(psych.stress),
                    emotionalState: cur.emotionalState || psych.moodState || dn.mood || undefined,
                });
            }
        }

        const serializeTrade = (t: TradeEntity) => {
            const note =
                tradeNoteMap.get(String(t.id)) ||
                (t.ticket ? tradeNoteMap.get(String(t.ticket)) : undefined);
            const psych = note?.psychCheck || {};
            return {
                id: String(t.id),
                ticket: t.ticket ?? undefined,
                symbol: t.symbol || 'UNKNOWN',
                type: t.type || 'BUY',
                volume: Number(t.volume) || 0,
                openPrice: Number(t.openPrice) || 0,
                closePrice: Number(t.closePrice) || 0,
                sl: t.sl !== null && t.sl !== undefined ? Number(t.sl) : undefined,
                tp: t.tp !== null && t.tp !== undefined ? Number(t.tp) : undefined,
                profit: Number(t.profit) || 0,
                commission: Number(t.commission) || 0,
                swap: Number(t.swap) || 0,
                netPnl: t.netPnl !== null && t.netPnl !== undefined ? Number(t.netPnl) : undefined,
                mfe: t.mfe !== null && t.mfe !== undefined ? Number(t.mfe) : undefined,
                mae: t.mae !== null && t.mae !== undefined ? Number(t.mae) : undefined,
                openTime: t.openTime ? new Date(t.openTime).toISOString() : new Date().toISOString(),
                closeTime: t.closeTime ? new Date(t.closeTime).toISOString() : undefined,
                magic: Number(t.magic) || 0,
                comment: t.comment ?? undefined,
                session: t.session ?? undefined,
                setup: note?.setup || t.setup || undefined,
                mood: t.mood ?? undefined,
                rating: note?.rating ?? t.rating ?? undefined,
                tags: Array.isArray(t.tags) ? t.tags : undefined,
                followingPlan: psych.followingPlan ?? undefined,
                entryDriver: psych.entryDriver ?? undefined,
                riskComfort: psych.riskComfort ?? undefined,
                mistakes: note?.mistakes ?? undefined,
            };
        };

        const rules = account?.propFirmRules || {};
        const payload = {
            accountContext: {
                accountId,
                accountType: account?.type || 'live',
                currency: account?.currency || 'USD',
                initialBalance: Number(account?.initialBalance) || 0,
                balance: Number(account?.balance) || 0,
                leverage: Number(account?.leverage) || 1,
                dailyLossLimit: rules.dailyLossLimit ? Number(rules.dailyLossLimit) : undefined,
                maxDrawdown: rules.maxDrawdown ? Number(rules.maxDrawdown) : undefined,
                profitTarget: rules.profitTarget ? Number(rules.profitTarget) : undefined,
            },
            historicalTrades: historicalTrades.map(serializeTrade),
            newTrades: targetTrades.map(serializeTrade),
            journalContext: Array.from(journalMap.values()),
            locale: 'pt',
        };

        const url = `${this.getBehaviorMlBaseUrl()}/api/ml/behavior/analyze-trades`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: getQuantInternalHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) {
                this.logger.warn(`Behavior ML endpoint returned HTTP ${response.status}; using deterministic fallback.`);
                return null;
            }
            return (await response.json()) as PyTorchAnalyzeResponse;
        } catch (err: any) {
            this.logger.warn(`Behavior ML endpoint unavailable (${err?.message || err}); using deterministic fallback.`);
            return null;
        }
    }

    private async persistPyTorchResults(
        userId: string,
        accountId: string,
        tradesChron: TradeEntity[],
        mlResponse: PyTorchAnalyzeResponse,
        openTicket?: string,
    ) {
        const tradeById = new Map(tradesChron.map((t) => [String(t.id), t]));
        const analyzedAt = new Date().toISOString();

        for (const pred of mlResponse.tradePredictions || []) {
            if (String(pred.tradeId).startsWith('open:')) {
                continue;
            }
            const trade = tradeById.get(String(pred.tradeId));
            if (!trade) continue;
            const updatedFlags = {
                ...(trade.qualityFlags && typeof trade.qualityFlags === 'object' ? trade.qualityFlags : {}),
                behavioralMl: {
                    modelVersion: mlResponse.modelVersion,
                    modelStatus: mlResponse.modelStatus,
                    analyzedAt,
                    anomalyScore: pred.anomalyScore,
                    riskLevel: pred.riskLevel,
                    activeFlags: pred.activeFlags,
                    probabilities: pred.probabilities,
                    effectiveStrategy: pred.effectiveStrategy,
                    effectiveSession: pred.effectiveSession,
                    executionMode: pred.executionMode,
                    reasons: pred.reasons,
                },
            };
            await this.tradeRepo.update(
                { id: trade.id },
                { qualityFlags: updatedFlags },
            );
        }

        const recentAlerts = await this.fetchRecentUnresolvedAlerts(userId);
        for (const alert of mlResponse.recommendedAlerts || []) {
            if (this.hasRecentPatternAlert(recentAlerts, accountId, alert.patternCode)) {
                continue;
            }
            const rawTradeId = alert.tradeId ? String(alert.tradeId) : '';
            const isOpenRef = rawTradeId.startsWith('open:');
            const persistedTradeId = rawTradeId && !isOpenRef ? rawTradeId : undefined;
            const created = await this.alertsService.create(userId, {
                type: (AlertType[alert.alertType] || AlertType.COACHING) as AlertType,
                severity: (AlertSeverity[alert.severity] || AlertSeverity.WARNING) as AlertSeverity,
                title: alert.title,
                description: alert.description,
                tradeId: persistedTradeId,
                metadata: {
                    ...(alert.metadata || {}),
                    ...(isOpenRef ? { openPositionRef: rawTradeId, openTicket: openTicket || null, livePreCloseGuardrail: true } : {}),
                    accountId,
                    patternCode: alert.patternCode,
                    source: 'pytorch-behavior-ml',
                    modelVersion: mlResponse.modelVersion,
                },
            });
            if (created) {
                recentAlerts.push(created as AlertEntity);
                if (alert.severity === 'CRITICAL') {
                    this.mt5Gateway?.broadcastBehaviorAlert(
                        {
                            accountId,
                            patternCode: alert.patternCode,
                            severity: alert.severity,
                            title: alert.title,
                            description: alert.description,
                            tradeId: persistedTradeId || null,
                            openTicket: isOpenRef ? openTicket || null : null,
                            timestamp: new Date().toISOString(),
                        },
                        userId,
                    );
                    await this.notificationsService
                        ?.create(userId, {
                            title: alert.title,
                            message: alert.description,
                            type: NotificationType.RISK_ALERT,
                            actionUrl: persistedTradeId ? `/trades/${persistedTradeId}` : '/trades',
                            actionLabel: 'Ver Operação',
                        })
                        .catch((err) =>
                            this.logger.warn(
                                `Failed to dispatch critical ML notification for user ${userId}: ${err?.message || err}`,
                            ),
                        );
                }
            }
        }
    }

    private async fetchRecentUnresolvedAlerts(userId: string): Promise<AlertEntity[]> {
        if (!this.alertRepo) return [];
        const cutoff = new Date(Date.now() - ALERT_DEDUP_WINDOW_MS);
        return this.alertRepo
            .find({
                where: {
                    userId,
                    resolved: false,
                    createdAt: MoreThanOrEqual(cutoff),
                },
            })
            .catch(() => [] as AlertEntity[]);
    }

    private hasRecentPatternAlert(
        recentAlerts: AlertEntity[],
        accountId: string,
        patternCode: string,
    ): boolean {
        return recentAlerts.some(
            (a) =>
                a?.metadata?.accountId === accountId &&
                a?.metadata?.patternCode === patternCode,
        );
    }

    private async runDeterministicFallback(userId: string, accountId: string) {
        const recentAlerts = await this.fetchRecentUnresolvedAlerts(userId);
        await this.checkTilt(userId, accountId, recentAlerts);
        await this.checkOverconfidence(userId, accountId, recentAlerts);
    }

    private async checkTilt(userId: string, accountId: string, recentAlerts: AlertEntity[]) {
        if (this.hasRecentPatternAlert(recentAlerts, accountId, 'tilt_risk_escalation')) {
            return;
        }
        const trades = await this.tradeRepo.find({
            where: { accountId, status: 'CLOSED' },
            order: { closeTime: 'DESC' },
            take: 20,
        });

        if (trades.length < 5) return;

        const lastTrade = trades[0];
        const previousTrades = trades.slice(1, 11);
        const avgVolume =
            previousTrades.reduce((sum, t) => sum + Number(t.volume), 0) / previousTrades.length;
        const recentLosses = previousTrades.filter((t) => Number(t.profit) < 0).length;

        if (recentLosses >= 3 && avgVolume > 0 && Number(lastTrade.volume) > avgVolume * 1.8) {
            await this.alertsService.create(userId, {
                type: AlertType.PSYCHOLOGY,
                severity: AlertSeverity.CRITICAL,
                title: 'Alerta de Tilt Detectado! 🔥',
                description: `Detectamos um aumento súbito no tamanho da posição (${lastTrade.volume} lotes) após uma sequência de perdas. Isso é um sinal clássico de "Tilt". Recomendamos parar imediatamente.`,
                tradeId: lastTrade.id,
                metadata: {
                    accountId,
                    patternCode: 'tilt_risk_escalation',
                    source: 'deterministic-fallback',
                    lastVolume: lastTrade.volume,
                    avgVolume: avgVolume.toFixed(2),
                    window: 10,
                },
            });
        }
    }

    private async checkOverconfidence(userId: string, accountId: string, recentAlerts: AlertEntity[]) {
        if (this.hasRecentPatternAlert(recentAlerts, accountId, 'overconfidence_euphoria')) {
            return;
        }
        const trades = await this.tradeRepo.find({
            where: { accountId, status: 'CLOSED' },
            order: { closeTime: 'DESC' },
            take: 15,
        });

        if (trades.length < 10) return;

        const streak: TradeEntity[] = [];
        for (const t of trades.slice(1)) {
            if (Number(t.profit) > 0) streak.push(t);
            else break;
        }

        if (streak.length >= 4) {
            const lastTrade = trades[0];
            const avgStreakVolume =
                streak.reduce((sum, t) => sum + Number(t.volume), 0) / streak.length;

            if (avgStreakVolume > 0 && Number(lastTrade.volume) > avgStreakVolume * 1.5) {
                await this.alertsService.create(userId, {
                    type: AlertType.PSYCHOLOGY,
                    severity: AlertSeverity.WARNING,
                    title: 'Alerta de Excesso de Confiança 🚀',
                    description: `Após sua sequência de ${streak.length} vitórias, você aumentou significativamente o risco. Cuidado para não abandonar seu plano trading devido à euforia.`,
                    tradeId: lastTrade.id,
                    metadata: {
                        accountId,
                        patternCode: 'overconfidence_euphoria',
                        source: 'deterministic-fallback',
                        streakCount: streak.length,
                        lastVolume: lastTrade.volume,
                        avgStreakVolume: avgStreakVolume.toFixed(2),
                    },
                });
            }
        }
    }
}
