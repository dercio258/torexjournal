import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { In, Repository } from 'typeorm';
import { TradeEntity } from '../mt5/trade.entity';
import { PositionEntity } from '../mt5/position.entity';
import { AccountEntity } from '../account/account.entity';
import {
    DailyNoteEntity,
    GeneralNoteEntity,
    TradeNoteEntity,
} from '../dashboard/journal-notes.entity';
import { UserEntity } from '../users/user.entity';
import { DashboardService } from '../dashboard/dashboard.service';
import { ScoringService } from '../alerts/scoring.service';
import { AlertsService } from '../alerts/alerts.service';
import { AiActionLink, AiMetricCard } from './ai-chat.entity';

export interface SymbolBreakdownItem {
    symbol: string;
    trades: number;
    wins: number;
    winRate: number;
    netPnl: number;
}

export interface SessionBreakdownItem {
    session: string;
    trades: number;
    wins: number;
    winRate: number;
    netPnl: number;
}

export interface TimeframeWindowSummary {
    trades: number;
    wins: number;
    netPnl: number;
    winRate: number;
    profitFactor: number;
}

export interface SetupBreakdownItem {
    setup: string;
    trades: number;
    netPnl: number;
}

export interface ActiveAlertSummary {
    type: string;
    severity: string;
    title: string;
}

export interface TraderPerformanceSnapshot {
    accountLabel: string;
    currency: string;
    totalTrades: number;
    openPositionsCount: number;
    openFloatingPnl: number;
    wins: number;
    losses: number;
    breakevens: number;
    winRate: number;
    grossPnl: number;
    totalCommissions: number;
    netPnl: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    payoffRatio: number;
    expectancy: number;
    maxWin: number;
    maxLoss: number;
    maxDrawdown: number;
    slDisciplinePct: number | null;
    currentStreak: { type: 'WIN' | 'LOSS' | 'NONE'; count: number };
    maxLossStreak: number;
    maxWinStreak: number;
    today: TimeframeWindowSummary;
    recent7d: TimeframeWindowSummary;
    recent14d: TimeframeWindowSummary;
    recent30d: TimeframeWindowSummary;
    avgMfe: number | null;
    avgMae: number | null;
    bestSymbol: SymbolBreakdownItem | null;
    worstSymbol: SymbolBreakdownItem | null;
    topSymbols: SymbolBreakdownItem[];
    allSymbols: SymbolBreakdownItem[];
    bestSession: SessionBreakdownItem | null;
    worstSession: SessionBreakdownItem | null;
    allSessions: SessionBreakdownItem[];
    topSetups: SetupBreakdownItem[];
    topLessons: { lesson: string; count: number }[];
    torexScore: number | null;
    radarMetrics: {
        consistency: number;
        riskManagement: number;
        discipline: number;
        profitability: number;
        winRate: number;
        profitFactorScore: number;
    } | null;
    healthScore: number | null;
    unresolvedAlertsCount: number;
    activeAlerts: ActiveAlertSummary[];
    dailyLossLimit: number | null;
    dailyLossLimitRemaining: number | null;
    overtradingDays: { date: string; trades: number; netPnl: number }[];
    activeDaysCount: number;
    dailyNotesCount: number;
    journalCoveragePct: number;
    adversePsychSummary: { days: number; netPnl: number } | null;
    tradeNotesCount: number;
    savedPlanRules: string[];
    recentTradesSample: {
        symbol: string;
        side: string;
        netPnl: number;
        closeTime: string | null;
    }[];
}

export interface CoachDeterministicResult {
    intent: string;
    reply: string;
    metrics: AiMetricCard[];
    actions: AiActionLink[];
    suggestions: string[];
}

@Injectable()
export class AiTradeAnalyzerService {
    constructor(
        @InjectRepository(TradeEntity)
        private readonly tradeRepo: Repository<TradeEntity>,
        @InjectRepository(PositionEntity)
        private readonly positionRepo: Repository<PositionEntity>,
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
        @InjectRepository(DailyNoteEntity)
        private readonly dailyNoteRepo: Repository<DailyNoteEntity>,
        @InjectRepository(TradeNoteEntity)
        private readonly tradeNoteRepo: Repository<TradeNoteEntity>,
        @InjectRepository(GeneralNoteEntity)
        private readonly generalNoteRepo: Repository<GeneralNoteEntity>,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
        @Optional()
        @InjectRepository(UserEntity)
        private readonly userRepo?: Repository<UserEntity>,
        @Optional()
        private readonly dashboardService?: DashboardService,
        @Optional()
        private readonly scoringService?: ScoringService,
        @Optional()
        private readonly alertsService?: AlertsService
    ) {}

    private sanitizeUserFreeText(raw: string | null | undefined, maxLen = 140): string {
        return String(raw || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, ' ')
            .replace(/(ignore\s+(all\s+|previous\s+)?instructions?|system\s*prompt|developer\s*mode|<\/?[a-z_]+>)/gi, '[redacted]')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLen);
    }

    private computeTradeNetPnl(t: Pick<TradeEntity, 'profit' | 'commission' | 'swap' | 'fees' | 'netPnl'>): number {
        if (t.netPnl !== null && t.netPnl !== undefined && Number.isFinite(Number(t.netPnl))) {
            return Number(t.netPnl);
        }
        const gross = Number(t.profit) || 0;
        const comm = Number(t.commission) || 0;
        const swap = Number(t.swap) || 0;
        const fees = Math.abs(Number(t.fees) || 0);
        return gross + comm + swap - fees;
    }

    private classifySession(dateInput?: Date | string | null): string {
        if (!dateInput) return 'Outras';
        const d = new Date(dateInput);
        if (Number.isNaN(d.getTime())) return 'Outras';
        const h = d.getUTCHours();
        if (h >= 0 && h < 7) return 'Ásia';
        if (h >= 7 && h < 12) return 'Londres';
        if (h >= 12 && h < 16) return 'Londres + NY';
        if (h >= 16 && h < 21) return 'Nova Iorque';
        return 'Ásia';
    }

    private formatMoney(val: number, signed = true): string {
        const abs = Math.abs(val).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
        if (!signed) return `$${abs}`;
        if (val > 0.004) return `+$${abs}`;
        if (val < -0.004) return `-$${abs}`;
        return '$0.00';
    }

    async buildSnapshot(
        userId: string,
        accountId?: string | null
    ): Promise<TraderPerformanceSnapshot> {
        const allAccounts = await this.accountRepo.find({
            where: { userId, isArchived: false },
            select: ['id', 'name', 'mt5Id', 'currency'],
        });

        let targetAccounts = allAccounts;
        let accountLabel =
            allAccounts.length > 1
                ? `Todas as Contas (${allAccounts.length})`
                : allAccounts[0]?.name || 'Sua Conta';

        if (accountId && accountId !== 'all') {
            const matched = allAccounts.find((a) => a.id === accountId);
            if (matched) {
                targetAccounts = [matched];
                accountLabel = matched.name || `MT5 ${matched.mt5Id || ''}`.trim();
            }
        }

        const accountIds = targetAccounts.map((a) => a.id);
        const currency = targetAccounts[0]?.currency || 'USD';

        if (accountIds.length === 0) {
            return {
                accountLabel: 'Nenhuma conta conectada',
                currency: 'USD',
                totalTrades: 0,
                openPositionsCount: 0,
                openFloatingPnl: 0,
                wins: 0,
                losses: 0,
                breakevens: 0,
                winRate: 0,
                grossPnl: 0,
                totalCommissions: 0,
                netPnl: 0,
                profitFactor: 0,
                avgWin: 0,
                avgLoss: 0,
                payoffRatio: 0,
                expectancy: 0,
                maxWin: 0,
                maxLoss: 0,
                maxDrawdown: 0,
                slDisciplinePct: null,
                currentStreak: { type: 'NONE', count: 0 },
                maxLossStreak: 0,
                maxWinStreak: 0,
                today: { trades: 0, wins: 0, netPnl: 0, winRate: 0, profitFactor: 0 },
                recent7d: { trades: 0, wins: 0, netPnl: 0, winRate: 0, profitFactor: 0 },
                recent14d: { trades: 0, wins: 0, netPnl: 0, winRate: 0, profitFactor: 0 },
                recent30d: { trades: 0, wins: 0, netPnl: 0, winRate: 0, profitFactor: 0 },
                avgMfe: null,
                avgMae: null,
                bestSymbol: null,
                worstSymbol: null,
                topSymbols: [],
                allSymbols: [],
                bestSession: null,
                worstSession: null,
                allSessions: [],
                topSetups: [],
                topLessons: [],
                torexScore: null,
                radarMetrics: null,
                healthScore: null,
                unresolvedAlertsCount: 0,
                activeAlerts: [],
                dailyLossLimit: null,
                dailyLossLimitRemaining: null,
                overtradingDays: [],
                activeDaysCount: 0,
                dailyNotesCount: 0,
                journalCoveragePct: 0,
                adversePsychSummary: null,
                tradeNotesCount: 0,
                savedPlanRules: [],
                recentTradesSample: [],
            };
        }

        // Fast <1ms trade, position & alert fingerprint so snapshot stays cached while invalidating immediately on new closed trades/alerts
        let snapshotCacheKey = '';
        try {
            const fpRows: Array<{ tc: number; max_ts: string | number; pc: number; ac: number }> =
                await this.tradeRepo.query(
                    `SELECT
                        (SELECT COUNT(*)::int FROM trades WHERE account_id = ANY($1) AND status = 'CLOSED') AS tc,
                        (SELECT COALESCE(EXTRACT(EPOCH FROM MAX(close_time))::bigint, 0) FROM trades WHERE account_id = ANY($1) AND status = 'CLOSED') AS max_ts,
                        (SELECT COUNT(*)::int FROM positions WHERE account_id = ANY($1)) AS pc,
                        (SELECT COUNT(*)::int FROM alerts WHERE user_id = $2 AND resolved = false) AS ac`,
                    [accountIds, userId]
                );
            const fp = fpRows?.[0]
                ? `${fpRows[0].tc}_${fpRows[0].max_ts}_${fpRows[0].pc}_${fpRows[0].ac}`
                : '0_0_0_0';
            snapshotCacheKey = `ai:snapshot:v2:${userId}:${accountId || 'all'}:${fp}`;
            const cached = await this.cacheManager.get<TraderPerformanceSnapshot>(snapshotCacheKey);
            if (cached) {
                return cached;
            }
        } catch {
            // Non-blocking fallback if cache/fingerprint check fails
        }

        const [
            tradesDesc,
            openPositions,
            dailyNotes,
            tradeNotesCount,
            generalRules,
            dashboardPerf,
            healthScoreData,
            unresolvedAlerts,
            userRecord,
        ] = await Promise.all([
            this.tradeRepo.find({
                where: { accountId: In(accountIds), status: 'CLOSED' },
                select: [
                    'id',
                    'symbol',
                    'type',
                    'profit',
                    'commission',
                    'swap',
                    'fees',
                    'netPnl',
                    'sl',
                    'tp',
                    'setup',
                    'lesson',
                    'rating',
                    'openTime',
                    'closeTime',
                    'mfe',
                    'mae',
                ],
                order: { closeTime: 'DESC' },
                take: 1500,
            }),
            this.positionRepo.find({
                where: { accountId: In(accountIds) },
                select: ['id', 'profit'],
            }),
            this.dailyNoteRepo
                .find({
                    where: { userId },
                    select: ['id', 'date', 'content', 'mood', 'psychCheck'],
                    take: 365,
                })
                .catch(() => [] as DailyNoteEntity[]),
            this.tradeNoteRepo
                .count({ where: { userId } })
                .catch(() => 0),
            this.generalNoteRepo
                .find({
                    where: { userId, isTemplate: false },
                    select: ['id', 'title', 'category', 'content', 'pinned', 'updatedAt'],
                    order: { pinned: 'DESC', updatedAt: 'DESC' },
                    take: 8,
                })
                .catch(() => [] as GeneralNoteEntity[]),
            this.dashboardService
                ? this.dashboardService
                      .getPerformance(userId, accountId || undefined)
                      .catch(() => null as any)
                : Promise.resolve(null as any),
            this.scoringService
                ? this.scoringService.calculateHealthScore(userId).catch(() => null)
                : Promise.resolve(null),
            this.alertsService
                ? this.alertsService.findAll(userId).catch(() => [])
                : Promise.resolve([]),
            this.userRepo
                ? this.userRepo
                      .findOne({ where: { id: userId }, select: ['id', 'dailyLossLimit'] })
                      .catch(() => null)
                : Promise.resolve(null),
        ]);

        // Ordenação cronológica crescente para cálculo exato de streaks e drawdown
        const chronological = [...tradesDesc].sort((a, b) => {
            const ta = new Date(a.closeTime || a.openTime || 0).getTime();
            const tb = new Date(b.closeTime || b.openTime || 0).getTime();
            return ta - tb;
        });

        let wins = 0;
        let losses = 0;
        let breakevens = 0;
        let grossPnl = 0;
        let totalCommissions = 0;
        let netPnl = 0;
        let grossProfitWins = 0;
        let grossLossAbs = 0;
        let maxWin = 0;
        let maxLoss = 0;
        let tradesWithSl = 0;

        let runningEquity = 0;
        let peakEquity = 0;
        let maxDrawdown = 0;

        let tempWinStreak = 0;
        let tempLossStreak = 0;
        let maxWinStreak = 0;
        let maxLossStreak = 0;

        const mfeList: number[] = [];
        const maeList: number[] = [];

        const symbolMap = new Map<
            string,
            { trades: number; wins: number; netPnl: number }
        >();
        const sessionMap = new Map<
            string,
            { trades: number; wins: number; netPnl: number }
        >();
        const setupMap = new Map<string, { trades: number; netPnl: number }>();
        const lessonMap = new Map<string, number>();
        const dayMap = new Map<string, { trades: number; netPnl: number }>();

        const nowMs = Date.now();
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const cutoffToday = todayStart.getTime();
        const cutoff7d = nowMs - 7 * 24 * 60 * 60 * 1000;
        const cutoff14d = nowMs - 14 * 24 * 60 * 60 * 1000;
        const cutoff30d = nowMs - 30 * 24 * 60 * 60 * 1000;

        const createWindowAcc = () => ({
            trades: 0,
            wins: 0,
            net: 0,
            winSum: 0,
            lossAbs: 0,
        });
        const wToday = createWindowAcc();
        const w7d = createWindowAcc();
        const w14d = createWindowAcc();
        const w30d = createWindowAcc();

        const recordInWindow = (
            acc: ReturnType<typeof createWindowAcc>,
            net: number,
            isWin: boolean,
            isLoss: boolean
        ) => {
            acc.trades += 1;
            acc.net += net;
            if (isWin) {
                acc.wins += 1;
                acc.winSum += net;
            } else if (isLoss) {
                acc.lossAbs += Math.abs(net);
            }
        };

        for (const t of chronological) {
            const gross = Number(t.profit) || 0;
            const comm = Math.abs(Number(t.commission) || 0) + Math.abs(Number(t.fees) || 0);
            const net = this.computeTradeNetPnl(t);

            grossPnl += gross;
            totalCommissions += comm;
            netPnl += net;

            runningEquity += net;
            if (runningEquity > peakEquity) peakEquity = runningEquity;
            const dd = peakEquity - runningEquity;
            if (dd > maxDrawdown) maxDrawdown = dd;

            if (t.sl !== null && t.sl !== undefined && Number(t.sl) > 0) {
                tradesWithSl += 1;
            }

            if (t.mfe !== null && t.mfe !== undefined && Number.isFinite(Number(t.mfe))) {
                mfeList.push(Math.abs(Number(t.mfe)));
            }
            if (t.mae !== null && t.mae !== undefined && Number.isFinite(Number(t.mae))) {
                maeList.push(Math.abs(Number(t.mae)));
            }

            const isWin = net > 0.004;
            const isLoss = net < -0.004;

            if (isWin) {
                wins += 1;
                grossProfitWins += net;
                if (net > maxWin) maxWin = net;
                tempWinStreak += 1;
                tempLossStreak = 0;
                if (tempWinStreak > maxWinStreak) maxWinStreak = tempWinStreak;
            } else if (isLoss) {
                losses += 1;
                grossLossAbs += Math.abs(net);
                if (net < maxLoss) maxLoss = net;
                tempLossStreak += 1;
                tempWinStreak = 0;
                if (tempLossStreak > maxLossStreak) maxLossStreak = tempLossStreak;
            } else {
                breakevens += 1;
            }

            const sym = t.symbol || 'OUTRO';
            const symEntry = symbolMap.get(sym) || { trades: 0, wins: 0, netPnl: 0 };
            symEntry.trades += 1;
            if (isWin) symEntry.wins += 1;
            symEntry.netPnl += net;
            symbolMap.set(sym, symEntry);

            const sess = this.classifySession(t.openTime || t.closeTime);
            const sessEntry = sessionMap.get(sess) || { trades: 0, wins: 0, netPnl: 0 };
            sessEntry.trades += 1;
            if (isWin) sessEntry.wins += 1;
            sessEntry.netPnl += net;
            sessionMap.set(sess, sessEntry);

            const cleanSetup = this.sanitizeUserFreeText(t.setup, 48);
            if (cleanSetup) {
                const sEntry = setupMap.get(cleanSetup) || { trades: 0, netPnl: 0 };
                sEntry.trades += 1;
                sEntry.netPnl += net;
                setupMap.set(cleanSetup, sEntry);
            }

            const cleanLesson = this.sanitizeUserFreeText(t.lesson, 90);
            if (cleanLesson) {
                lessonMap.set(cleanLesson, (lessonMap.get(cleanLesson) || 0) + 1);
            }

            const refDate = t.closeTime || t.openTime;
            if (refDate) {
                const refMs = new Date(refDate).getTime();
                const dateKey = new Date(refDate).toISOString().slice(0, 10);
                const dayEntry = dayMap.get(dateKey) || { trades: 0, netPnl: 0 };
                dayEntry.trades += 1;
                dayEntry.netPnl += net;
                dayMap.set(dateKey, dayEntry);

                if (refMs >= cutoffToday) recordInWindow(wToday, net, isWin, isLoss);
                if (refMs >= cutoff7d) recordInWindow(w7d, net, isWin, isLoss);
                if (refMs >= cutoff14d) recordInWindow(w14d, net, isWin, isLoss);
                if (refMs >= cutoff30d) recordInWindow(w30d, net, isWin, isLoss);
            }
        }

        const finalizeWindow = (
            acc: ReturnType<typeof createWindowAcc>
        ): TimeframeWindowSummary => ({
            trades: acc.trades,
            wins: acc.wins,
            netPnl: Number(acc.net.toFixed(2)),
            winRate:
                acc.trades > 0
                    ? Number(((acc.wins / acc.trades) * 100).toFixed(1))
                    : 0,
            profitFactor:
                acc.lossAbs > 0
                    ? Number((acc.winSum / acc.lossAbs).toFixed(2))
                    : acc.winSum > 0
                    ? 99.99
                    : 0,
        });

        const totalTrades =
            dashboardPerf && Number(dashboardPerf.totalTrades) > chronological.length
                ? Number(dashboardPerf.totalTrades)
                : chronological.length;
        const effectiveNetPnl =
            dashboardPerf &&
            Number(dashboardPerf.totalTrades) > chronological.length &&
            Number.isFinite(Number(dashboardPerf.totalPnL))
                ? Number(dashboardPerf.totalPnL)
                : netPnl;
        const winRate =
            dashboardPerf &&
            Number(dashboardPerf.totalTrades) > chronological.length &&
            Number.isFinite(Number(dashboardPerf.winRate))
                ? Number(dashboardPerf.winRate)
                : chronological.length > 0
                ? Number(((wins / chronological.length) * 100).toFixed(1))
                : 0;
        const profitFactor =
            dashboardPerf &&
            Number(dashboardPerf.totalTrades) > chronological.length &&
            Number.isFinite(Number(dashboardPerf.profitFactor))
                ? Number(dashboardPerf.profitFactor)
                : grossLossAbs > 0
                ? Number((grossProfitWins / grossLossAbs).toFixed(2))
                : grossProfitWins > 0
                ? 99.99
                : 0;
        const avgWin = wins > 0 ? Number((grossProfitWins / wins).toFixed(2)) : 0;
        const avgLoss = losses > 0 ? Number((grossLossAbs / losses).toFixed(2)) : 0;
        const payoffRatio =
            avgLoss > 0 ? Number((avgWin / avgLoss).toFixed(2)) : avgWin > 0 ? 99.99 : 0;
        const expectancy =
            totalTrades > 0 ? Number((effectiveNetPnl / totalTrades).toFixed(2)) : 0;
        const slDisciplinePct =
            chronological.length > 0
                ? Number(((tradesWithSl / chronological.length) * 100).toFixed(1))
                : null;

        const currentStreak: { type: 'WIN' | 'LOSS' | 'NONE'; count: number } =
            tempWinStreak > 0
                ? { type: 'WIN', count: tempWinStreak }
                : tempLossStreak > 0
                ? { type: 'LOSS', count: tempLossStreak }
                : { type: 'NONE', count: 0 };

        const symbolsRanked: SymbolBreakdownItem[] = Array.from(symbolMap.entries())
            .map(([symbol, s]) => ({
                symbol,
                trades: s.trades,
                wins: s.wins,
                winRate: Number(((s.wins / s.trades) * 100).toFixed(1)),
                netPnl: Number(s.netPnl.toFixed(2)),
            }))
            .sort((a, b) => b.netPnl - a.netPnl);

        const bestSymbol = symbolsRanked.length > 0 ? symbolsRanked[0] : null;
        const worstSymbol =
            symbolsRanked.length > 0 && symbolsRanked[symbolsRanked.length - 1].netPnl < 0
                ? symbolsRanked[symbolsRanked.length - 1]
                : null;

        const sessionsRanked: SessionBreakdownItem[] = Array.from(sessionMap.entries())
            .map(([session, s]) => ({
                session,
                trades: s.trades,
                wins: s.wins,
                winRate: Number(((s.wins / s.trades) * 100).toFixed(1)),
                netPnl: Number(s.netPnl.toFixed(2)),
            }))
            .sort((a, b) => b.netPnl - a.netPnl);

        const bestSession = sessionsRanked.length > 0 ? sessionsRanked[0] : null;
        const worstSession =
            sessionsRanked.length > 0 &&
            sessionsRanked[sessionsRanked.length - 1].netPnl < 0
                ? sessionsRanked[sessionsRanked.length - 1]
                : null;

        const topSetups: SetupBreakdownItem[] = (
            Array.isArray(dashboardPerf?.bySetup) && dashboardPerf.bySetup.length > 0
                ? dashboardPerf.bySetup.map((s: any) => ({
                      setup: this.sanitizeUserFreeText(s.setup, 48),
                      trades: Number(s.count || 0),
                      netPnl: Number(Number(s.pnl || 0).toFixed(2)),
                  }))
                : Array.from(setupMap.entries()).map(([setup, s]) => ({
                      setup,
                      trades: s.trades,
                      netPnl: Number(s.netPnl.toFixed(2)),
                  }))
        )
            .filter((s: SetupBreakdownItem) => Boolean(s.setup))
            .sort((a: SetupBreakdownItem, b: SetupBreakdownItem) => b.netPnl - a.netPnl)
            .slice(0, 6);

        const topLessons = Array.from(lessonMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([lesson, count]) => ({ lesson, count }));

        const activeDaysCount = dayMap.size;
        const avgTradesPerDay =
            activeDaysCount > 0 ? chronological.length / activeDaysCount : 0;
        const overtradingThreshold = Math.max(6, Math.ceil(avgTradesPerDay * 1.8));
        const overtradingDays = Array.from(dayMap.entries())
            .filter(
                ([, d]) => d.trades >= overtradingThreshold && d.netPnl < 0
            )
            .map(([date, d]) => ({
                date,
                trades: d.trades,
                netPnl: Number(d.netPnl.toFixed(2)),
            }))
            .sort((a, b) => a.netPnl - b.netPnl)
            .slice(0, 4);

        const notedDatesSet = new Set<string>();
        let adverseDays = 0;
        let adverseNetPnl = 0;

        for (const dn of dailyNotes) {
            const dateKey = String(dn.date).slice(0, 10);
            const hasText =
                (dn.content || '').replace(/<[^>]+>/g, '').trim().length > 0;
            const pc = (dn.psychCheck || {}) as Record<string, any>;
            const hasPsych = Object.values(pc).some((v) => Boolean(v));
            if (hasText || hasPsych) {
                notedDatesSet.add(dateKey);
            }

            const isCompromised =
                ['Exausto', 'Sonolento'].includes(pc.sleep) ||
                ['Esgotado', 'Fadigado'].includes(pc.energy) ||
                ['Distraído', 'Frágil'].includes(pc.focus) ||
                ['Consumo crítico', 'Elevado'].includes(pc.caffeine) ||
                ['Estressado', 'Ansioso', 'Eufórico'].includes(pc.moodState) ||
                pc.stress === 'Excessivo';

            if (isCompromised && dayMap.has(dateKey)) {
                adverseDays += 1;
                adverseNetPnl += dayMap.get(dateKey)!.netPnl;
            }
        }

        let coveredActiveDays = 0;
        for (const dKey of dayMap.keys()) {
            if (notedDatesSet.has(dKey)) coveredActiveDays += 1;
        }
        const journalCoveragePct =
            activeDaysCount > 0
                ? Number(((coveredActiveDays / activeDaysCount) * 100).toFixed(0))
                : 0;
        const adversePsychSummary =
            adverseDays > 0
                ? {
                      days: adverseDays,
                      netPnl: Number(adverseNetPnl.toFixed(2)),
                  }
                : null;

        const openFloatingPnl = openPositions.reduce(
            (sum, p) => sum + (Number(p.profit) || 0),
            0
        );

        const savedPlanRules = generalRules
            .map((g) => {
                const cleanTitle = this.sanitizeUserFreeText(g.title, 80);
                const cleanBody = this.sanitizeUserFreeText(g.content, 140);
                const cat = this.sanitizeUserFreeText(g.category || 'GENERAL', 24) || 'GENERAL';
                return cleanBody
                    ? `${cleanTitle} [${cat}]: ${cleanBody}`
                    : `${cleanTitle} [${cat}]`;
            })
            .filter(Boolean)
            .slice(0, 5);

        const recentTradesSample = tradesDesc.slice(0, 6).map((t) => {
            const upper = String(t.type || '').toUpperCase();
            const side = upper.includes('SELL') || upper.includes('PUT') ? 'SELL' : 'BUY';
            const net = this.computeTradeNetPnl(t);
            return {
                symbol: t.symbol,
                side,
                netPnl: Number(net.toFixed(2)),
                closeTime: t.closeTime ? new Date(t.closeTime).toISOString() : null,
            };
        });

        const dailyLossLimit =
            userRecord?.dailyLossLimit !== null &&
            userRecord?.dailyLossLimit !== undefined &&
            Number(userRecord.dailyLossLimit) > 0
                ? Number(userRecord.dailyLossLimit)
                : null;
        const dailyLossLimitRemaining =
            dailyLossLimit !== null
                ? Number((dailyLossLimit + Math.min(0, wToday.net)).toFixed(2))
                : null;

        const activeAlerts: ActiveAlertSummary[] = (Array.isArray(unresolvedAlerts) ? unresolvedAlerts : [])
            .slice(0, 4)
            .map((a: any) => ({
                type: String(a.type || 'COACHING'),
                severity: String(a.severity || 'INFO'),
                title: this.sanitizeUserFreeText(a.title, 90),
            }))
            .filter((a) => Boolean(a.title));

        const snapshotResult: TraderPerformanceSnapshot = {
            accountLabel,
            currency,
            totalTrades,
            openPositionsCount: openPositions.length,
            openFloatingPnl: Number(openFloatingPnl.toFixed(2)),
            wins,
            losses,
            breakevens,
            winRate,
            grossPnl: Number(grossPnl.toFixed(2)),
            totalCommissions: Number(totalCommissions.toFixed(2)),
            netPnl: Number(effectiveNetPnl.toFixed(2)),
            profitFactor,
            avgWin,
            avgLoss,
            payoffRatio,
            expectancy,
            maxWin: Number(maxWin.toFixed(2)),
            maxLoss: Number(maxLoss.toFixed(2)),
            maxDrawdown: Number(maxDrawdown.toFixed(2)),
            slDisciplinePct,
            currentStreak,
            maxLossStreak,
            maxWinStreak,
            today: finalizeWindow(wToday),
            recent7d: finalizeWindow(w7d),
            recent14d: finalizeWindow(w14d),
            recent30d: finalizeWindow(w30d),
            avgMfe:
                mfeList.length > 0
                    ? Number(
                          (
                              mfeList.reduce((s, v) => s + v, 0) / mfeList.length
                          ).toFixed(2)
                      )
                    : null,
            avgMae:
                maeList.length > 0
                    ? Number(
                          (
                              maeList.reduce((s, v) => s + v, 0) / maeList.length
                          ).toFixed(2)
                      )
                    : null,
            bestSymbol,
            worstSymbol,
            topSymbols: symbolsRanked.slice(0, 5),
            allSymbols: symbolsRanked.slice(0, 30),
            bestSession,
            worstSession,
            allSessions: sessionsRanked,
            topSetups,
            topLessons,
            torexScore:
                dashboardPerf && Number.isFinite(Number(dashboardPerf.torexScore))
                    ? Number(dashboardPerf.torexScore)
                    : null,
            radarMetrics: dashboardPerf?.radarMetrics || null,
            healthScore:
                healthScoreData && Number.isFinite(Number(healthScoreData.score))
                    ? Number(healthScoreData.score)
                    : null,
            unresolvedAlertsCount: Array.isArray(unresolvedAlerts)
                ? unresolvedAlerts.length
                : 0,
            activeAlerts,
            dailyLossLimit,
            dailyLossLimitRemaining,
            overtradingDays,
            activeDaysCount,
            dailyNotesCount: notedDatesSet.size,
            journalCoveragePct,
            adversePsychSummary,
            tradeNotesCount,
            savedPlanRules,
            recentTradesSample,
        };

        if (snapshotCacheKey) {
            try {
                await this.cacheManager.set(snapshotCacheKey, snapshotResult, 120_000);
            } catch {
                // Non-blocking cache write failure
            }
        }

        return snapshotResult;
    }

    private normalizeText(raw: string): string {
        return String(raw || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    composeDeterministicCoachResponse(
        rawQuestion: string,
        userName: string,
        snap: TraderPerformanceSnapshot,
        locale: 'pt' | 'en' = 'pt'
    ): CoachDeterministicResult {
        const isEn = locale === 'en';
        const q = this.normalizeText(rawQuestion);
        const firstName = userName?.split(' ')[0] || 'Trader';

        if (snap.totalTrades === 0 && snap.openPositionsCount === 0) {
            return {
                intent: 'empty_account',
                reply: isEn
                    ? `Hi **${firstName}**! There are no closed or open executions logged in this account yet. Sync your fills via **MT5**, **Deriv API**, or **CSV** in Import Trades to get started.`
                    : `Olá, **${firstName}**! Ainda não há operações registadas nesta conta. Sincronize suas ordens via **MT5**, **Deriv** ou arquivo **CSV** na área de importação para começarmos.`,
                metrics: [],
                actions: [],
                suggestions: isEn
                    ? [
                          'How do I import trades (MT5, Deriv, or CSV)?',
                          'How do I log notes in my Journal?',
                      ]
                    : [
                          'Como importar meus trades (MT5, Deriv ou CSV)?',
                          'Como anotar minhas operações no Diário?',
                      ],
            };
        }

        // 1. POR QUE ESTOU PERDENDO / O QUE ESTOU ERRANDO
        if (
            /(perdendo|errando|erro|prejuizo|drawdown|ruim|negativo|losing|wrong|lose|bleed|leak)/.test(q)
        ) {
            const causes: string[] = [];
            if (snap.worstSymbol) {
                causes.push(
                    isEn
                        ? `**${snap.worstSymbol.symbol}** accounts for the largest drawdown (**${this.formatMoney(snap.worstSymbol.netPnl)}**)`
                        : `o ativo **${snap.worstSymbol.symbol}** concentra o maior recuo (**${this.formatMoney(snap.worstSymbol.netPnl)}**)`
                );
            }
            if (snap.worstSession) {
                causes.push(
                    isEn
                        ? `the **${snap.worstSession.session}** session shows the weakest expectancy (**${this.formatMoney(snap.worstSession.netPnl)}**)`
                        : `a sessão **${snap.worstSession.session}** apresenta a maior fragilidade (**${this.formatMoney(snap.worstSession.netPnl)}**)`
                );
            }
            if (snap.avgLoss > snap.avgWin && snap.losses > 0) {
                causes.push(
                    isEn
                        ? `average loss (**-$${snap.avgLoss.toFixed(2)}**) exceeds average win (**+$${snap.avgWin.toFixed(2)}**)`
                        : `a perda média (**-$${snap.avgLoss.toFixed(2)}**) está acima do ganho médio (**+$${snap.avgWin.toFixed(2)}**)`
                );
            }
            if (snap.overtradingDays.length > 0) {
                causes.push(
                    isEn
                        ? `overtrading occurred across **${snap.overtradingDays.length}** red session(s)`
                        : `houve excesso de operações em **${snap.overtradingDays.length}** pregão(ões) negativos`
                );
            }
            if (snap.adversePsychSummary && causes.length < 2) {
                causes.push(
                    isEn
                        ? `sessions logged under fatigue or low focus generated **${this.formatMoney(snap.adversePsychSummary.netPnl)}**`
                        : `dias operados sob cansaço ou baixo foco geraram **${this.formatMoney(snap.adversePsychSummary.netPnl)}**`
                );
            }

            const mainSentence = isEn
                ? causes.length > 0
                    ? `The primary performance leaks are that ${causes.slice(0, 2).join(' and ')}.`
                    : `Your overall net P&L remains positive at **${this.formatMoney(snap.netPnl)}**, with **${this.formatMoney(snap.maxLoss)}** as the single largest stop-out.`
                : causes.length > 0
                    ? `Os principais pontos de pressão são que ${causes.slice(0, 2).join(' e ')}.`
                    : `O saldo geral segue positivo em **${this.formatMoney(snap.netPnl)}**, tendo **${this.formatMoney(snap.maxLoss)}** como maior stop isolado.`;

            return {
                intent: 'why_losing',
                reply: isEn
                    ? `${mainSentence} Trimming risk exposure in those pockets and enforcing a hard daily loss cap will keep your equity curve cleaner.`
                    : `${mainSentence} Reduzir a exposição nesses cenários e proteger o limite diário de perda manterá sua consistência mais limpa.`,
                metrics: [],
                actions: [],
                suggestions: isEn
                    ? [
                          'Where is my Edge?',
                          'Am I following my plan?',
                          'How can I improve?',
                      ]
                    : [
                          'Qual é o meu Edge?',
                          'Estou seguindo meu plano?',
                          'Como posso melhorar?',
                      ],
            };
        }

        // 2. QUAL É O MEU EDGE / MELHOR ATIVO / MELHOR SESSÃO
        if (/(edge|vantagem|melhor ativo|melhor par|melhor sessao|onde ganho|ponto forte|best pair|best symbol|best session|strength)/.test(q)) {
            const symPart = snap.bestSymbol
                ? isEn
                    ? `on **${snap.bestSymbol.symbol}** (**${this.formatMoney(snap.bestSymbol.netPnl)}** at a **${snap.bestSymbol.winRate}%** win rate)`
                    : `no ativo **${snap.bestSymbol.symbol}** (**${this.formatMoney(snap.bestSymbol.netPnl)}** com **${snap.bestSymbol.winRate}%** de acerto)`
                : isEn
                    ? `at a **${snap.winRate.toFixed(1)}%** win rate`
                    : `na sua taxa de acerto de **${snap.winRate.toFixed(1)}%**`;
            const sessPart = snap.bestSession
                ? isEn
                    ? ` and during the **${snap.bestSession.session}** session (**${this.formatMoney(snap.bestSession.netPnl)}**)`
                    : ` e na sessão **${snap.bestSession.session}** (**${this.formatMoney(snap.bestSession.netPnl)}**)`
                : '';

            return {
                intent: 'where_edge',
                reply: isEn
                    ? `Your highest expectancy is concentrated ${symPart}${sessPart}. Pressing this A+ setup selectively is the cleanest way to scale with controlled risk.`
                    : `O seu melhor desempenho está concentrado ${symPart}${sessPart}. Priorizar esse cenário nas próximas entradas é a forma mais direta de escalar com risco controlado.`,
                metrics: [],
                actions: [],
                suggestions: isEn
                    ? [
                          'Why am I losing?',
                          'Am I following my plan?',
                          'How can I improve?',
                      ]
                    : [
                          'Por que estou perdendo?',
                          'Estou seguindo meu plano?',
                          'Como posso melhorar?',
                      ],
            };
        }

        // 3. ESTOU SEGUINDO MEU PLANO / DISCIPLINA
        if (/(plano|disciplina|regra|consistencia|following my plan|overtrading|plan|discipline|consistency|rules)/.test(q)) {
            const overtradeMsg = isEn
                ? snap.overtradingDays.length === 0
                    ? 'with zero critical overtrading sessions flagged'
                    : `with **${snap.overtradingDays.length}** red overtrading session(s) flagged`
                : snap.overtradingDays.length === 0
                    ? 'sem registo de dias críticos de overtrading'
                    : `com **${snap.overtradingDays.length}** dia(s) de excesso de volume no negativo`;
            const rulesMsg = isEn
                ? snap.savedPlanRules.length > 0
                    ? 'Keep reviewing the objective Playbook rules saved in your Journal daily.'
                    : 'Documenting explicit entry/risk rules in your Journal will sharpen execution tracking.'
                : snap.savedPlanRules.length > 0
                    ? 'Vale manter a revisão diária das regras registadas no seu Playbook.'
                    : 'Registar suas regras objetivas no Diário ajudará a acompanhar sua disciplina com mais precisão.';

            return {
                intent: 'following_plan',
                reply: isEn
                    ? `You have logged **${snap.journalCoveragePct}%** of your active trading days, ${overtradeMsg}. ${rulesMsg}`
                    : `Você documentou **${snap.journalCoveragePct}%** dos dias operados, ${overtradeMsg}. ${rulesMsg}`,
                metrics: [],
                actions: [],
                suggestions: isEn
                    ? [
                          'How can I improve?',
                          'Where is my Edge?',
                          'Why am I losing?',
                      ]
                    : [
                          'Como posso melhorar?',
                          'Qual é o meu Edge?',
                          'Por que estou perdendo?',
                      ],
            };
        }

        // 4. COMO POSSO MELHORAR
        if (/(melhorar|evoluir|dica|recomendac|sugestao|better|proximo passo|improve|next step|optimize)/.test(q)) {
            const focusTip = snap.worstSymbol
                ? isEn
                    ? `cut position sizing on **${snap.worstSymbol.symbol}** (**${this.formatMoney(snap.worstSymbol.netPnl)}**)`
                    : `reduza o lote em **${snap.worstSymbol.symbol}** (**${this.formatMoney(snap.worstSymbol.netPnl)}**)`
                : isEn
                    ? 'keep position sizing standardized across core setups'
                    : 'mantenha o lote padronizado nas entradas principais';
            const edgeTip = snap.bestSession
                ? isEn
                    ? `focus A+ setups inside the **${snap.bestSession.session}** window`
                    : `concentre suas melhores entradas na sessão **${snap.bestSession.session}**`
                : isEn
                    ? 'avoid low-liquidity sessions outside your core window'
                    : 'evite operar fora da sua janela principal';

            return {
                intent: 'how_improve',
                reply: isEn
                    ? `To elevate net expectancy, ${focusTip} and ${edgeTip}. Tagging the technical invalidation reason on every stop in your Journal also tightens execution fast.`
                    : `Para evoluir de forma objetiva, ${focusTip} e ${edgeTip}. Anotar o motivo técnico de cada stop no Diário também acelera o ajuste fino da sua execução.`,
                metrics: [],
                actions: [],
                suggestions: isEn
                    ? [
                          'Where is my Edge?',
                          'Am I following my plan?',
                          'How are my recent trades?',
                      ]
                    : [
                          'Qual é o meu Edge?',
                          'Estou seguindo meu plano?',
                          'Como estão minhas operações?',
                      ],
            };
        }

        // 5. VISÃO GERAL LIMPA E DIRETA
        const pfText = isEn
            ? snap.losses === 0 && snap.wins > 0
                ? 'zero losing trades recorded'
                : `a **${snap.profitFactor.toFixed(2)}** Profit Factor`
            : snap.losses === 0 && snap.wins > 0
                ? 'sem perdas registadas'
                : `Profit Factor de **${snap.profitFactor.toFixed(2)}**`;

        return {
            intent: 'status_overview',
            reply: isEn
                ? `Your current net P&L stands at **${this.formatMoney(snap.netPnl)}**, with a **${snap.winRate.toFixed(1)}%** win rate across **${snap.totalTrades}** trades and ${pfText}.${snap.bestSymbol ? ` Top contributor: **${snap.bestSymbol.symbol}** (**${this.formatMoney(snap.bestSymbol.netPnl)}**).` : ''}`
                : `O seu resultado líquido atual é de **${this.formatMoney(snap.netPnl)}**, com **${snap.winRate.toFixed(1)}%** de taxa de acerto em **${snap.totalTrades}** operações e ${pfText}.${snap.bestSymbol ? ` O principal destaque positivo é **${snap.bestSymbol.symbol}** (**${this.formatMoney(snap.bestSymbol.netPnl)}**).` : ''}`,
            metrics: [],
            actions: [],
            suggestions: isEn
                ? [
                      'Why am I losing?',
                      'Where is my Edge?',
                      'How can I improve?',
                  ]
                : [
                      'Por que estou perdendo?',
                      'Qual é o meu Edge?',
                      'Como posso melhorar?',
                  ],
        };
    }
}
