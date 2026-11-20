import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In, ILike } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { LeaderboardRankEntity } from './leaderboard-rank.entity';
import { AccountEntity, AccountType } from '../account/account.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { UserEntity } from '../users/user.entity';

export interface LeaderboardFilterDto {
    search?: string;
    tier?: string;
    currency?: string;
    limit?: number;
    page?: number;
}

@Injectable()
export class LeaderboardService implements OnModuleInit {
    private readonly logger = new Logger(LeaderboardService.name);

    constructor(
        @InjectRepository(LeaderboardRankEntity)
        private rankRepo: Repository<LeaderboardRankEntity>,
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
        @InjectRepository(TradeEntity)
        private tradeRepo: Repository<TradeEntity>,
        @InjectRepository(UserEntity)
        private userRepo: Repository<UserEntity>,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {}

    async onModuleInit() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') {
            return;
        }
        try {
            await this.recalculateRanks();
        } catch (err) {
            this.logger.warn(`Failed initial rank recalculation: ${err.message}`);
        }
    }

    public getTierAndRankInfo(
        rankNum: number,
        stats: { tradesCount: number; totalPnL: number; winRate: number; profitFactor: number }
    ): { key: string; label: string } {
        if (stats.tradesCount === 0) return { key: 'BRONZE', label: 'CALIBRANDO' };

        // LEGEND: Requer pelo menos 25.000 operações + Rank #1 + Lucro Positivo + WR >= 55% + PF >= 1.5
        if (
            stats.tradesCount >= 25000 &&
            rankNum === 1 &&
            stats.totalPnL > 0 &&
            stats.winRate >= 55 &&
            stats.profitFactor >= 1.5
        ) {
            return { key: 'LEGEND', label: 'LEGEND 1' };
        }

        // MASTERS: Requer pelo menos 10.000 operações e Rank <= 3
        if (stats.tradesCount >= 10000 && rankNum <= 3 && stats.totalPnL > 0) {
            return { key: 'MASTERS', label: `MASTERS ${rankNum}` };
        }

        // DIAMOND: Requer pelo menos 10.000 operações e Rank <= 10
        if (stats.tradesCount >= 10000 && rankNum <= 10 && stats.totalPnL > 0) {
            return { key: 'DIAMOND', label: `DIAMOND ${Math.ceil((rankNum - 3) / 2)}` };
        }

        // PLATINUM: Requer pelo menos 5.000 operações e PnL >= 0
        if (stats.tradesCount >= 5000 && stats.totalPnL >= 0) {
            return { key: 'PLATINUM', label: `PLATINUM ${Math.min(5, Math.ceil(rankNum / 5))}` };
        }

        // GOLD: Requer pelo menos 2.500 operações
        if (stats.tradesCount >= 2500) {
            return { key: 'GOLD', label: `GOLD ${Math.min(5, Math.ceil(rankNum / 10))}` };
        }

        // SILVER: Requer pelo menos 1.000 operações (Top 100)
        if (stats.tradesCount >= 1000) {
            return { key: 'SILVER', label: `SILVER ${Math.min(5, Math.ceil((rankNum - 50) / 10))}` };
        }

        // BRONZE: Abaixo de 1.000 operações (Abaixo do centésimo lugar: #101+)
        return { key: 'BRONZE', label: 'BRONZE' };
    }

    public getTierByRank(rank: number, tradesCount: number = 1): { key: string; label: string } {
        return this.getTierAndRankInfo(rank, {
            tradesCount,
            totalPnL: 100,
            winRate: 55,
            profitFactor: 1.5,
        });
    }

    public calculateBadges(stats: {
        winRate: number;
        streak: number;
        profitFactor: number;
        riskReward: number;
        tradesCount: number;
        activeDays?: number;
        totalPnL?: number;
    }): string[] {
        const badges: string[] = [];
        if (stats.tradesCount >= 25000) badges.push('Lenda Viva');
        else if (stats.tradesCount >= 10000) badges.push('Grão-Mestre');
        else if (stats.tradesCount >= 1000) badges.push('Top 100 Qualificado');
        else if (stats.tradesCount >= 30) badges.push('Veterano');

        if ((stats.activeDays || 0) >= 5) badges.push('Consistente');
        if (stats.winRate >= 50 && stats.profitFactor >= 1.0 && (stats.totalPnL || 0) > 0) badges.push('Lucrativo');
        if (stats.streak >= 4) badges.push('Sequência de Aço');
        if (stats.profitFactor >= 2.0) badges.push('Mestre de Risco');
        if (stats.riskReward >= 1.5) badges.push('Disciplinado');
        if (stats.winRate >= 60) badges.push('Atirador de Elite');
        if (stats.tradesCount >= 10 && badges.length === 0) badges.push('Ativo');
        return badges;
    }

    public calculateCompositeScore(stats: {
        tradesCount: number;
        activeDays: number;
        platformDays: number;
        winRate: number;
        profitFactor: number;
        riskReward: number;
        streak?: number;
        totalPnL: number;
    }): {
        compositeScore: number;
        scoreBreakdown: {
            vol: number;
            pnl: number;
            pf: number;
            cons: number;
            time?: number;
            wr: number;
            rr: number;
        };
    } {
        // 1. Volume & Progressão até 25.000 operações (25 pts)
        const baseVol = Math.min(stats.tradesCount / 1000, 1.0) * 10;
        const legendVol = Math.min(stats.tradesCount / 25000, 1.0) * 15;
        const volScore = Number((baseVol + legendVol).toFixed(1));

        // 2. Lucro Líquido Real & Rentabilidade (25 pts)
        let pnlScore = 0;
        let pfScore = 0;
        if (stats.totalPnL > 0) {
            pnlScore = Number((Math.min(stats.totalPnL / 500, 1.0) * 15).toFixed(1));
            pfScore = Number((Math.min(stats.profitFactor / 2.0, 1.0) * 10).toFixed(1));
        } else {
            pnlScore = 0;
            pfScore = Number((Math.min(stats.profitFactor / 2.0, 0.5) * 5).toFixed(1));
        }

        // 3. Consistência e Dias Ativos de Pregão (20 pts)
        const activeDaysScore = Number((Math.min(stats.activeDays / 20, 1.0) * 15).toFixed(1));
        const platformDaysScore = Number((Math.min(stats.platformDays / 90, 1.0) * 5).toFixed(1));
        const consScore = Number((activeDaysScore + platformDaysScore).toFixed(1));

        // 4. Taxa de Vitória Sustentada (15 pts)
        const wrScore = Number(((stats.winRate / 100) * 15).toFixed(1));

        // 5. Relação Risco / Retorno (10 pts)
        const rrScore = Number((Math.min(stats.riskReward / 2.0, 1.0) * 10).toFixed(1));

        // 6. Streak bônus (5 pts)
        const streakScore = Number((Math.min((stats.streak || 0) / 5, 1.0) * 5).toFixed(1));

        const compositeScore = Number(
            Math.min(
                100,
                Math.max(0, volScore + pnlScore + pfScore + consScore + wrScore + rrScore + streakScore)
            ).toFixed(1)
        );

        return {
            compositeScore,
            scoreBreakdown: {
                vol: volScore,
                pnl: pnlScore,
                pf: pfScore,
                cons: consScore,
                time: consScore,
                wr: wrScore,
                rr: rrScore,
            },
        };
    }

    private async getCacheVersion(): Promise<number> {
        try {
            const ver = await this.cacheManager.get<number>('leaderboard:cache_version');
            return typeof ver === 'number' && ver > 0 ? ver : 1;
        } catch {
            return 1;
        }
    }

    private async bumpCacheVersion(): Promise<void> {
        try {
            const current = await this.getCacheVersion();
            await this.cacheManager.set('leaderboard:cache_version', current + 1, 86_400_000);
        } catch { }
    }

    /**
     * Retorna a lista ranqueada de traders para o Leaderboard
     */
    async getLeaderboard(filters: LeaderboardFilterDto = {}, currentUserId?: string) {
        // Se a tabela de ranking estiver vazia, recalcula primeiro
        const count = await this.rankRepo.count();
        if (count === 0) {
            await this.recalculateRanks();
        }

        const version = await this.getCacheVersion();
        const cacheKey = `leaderboard:v${version}:list:${JSON.stringify(filters)}:${currentUserId || 'guest'}`;
        try {
            const cached = await this.cacheManager.get(cacheKey);
            if (cached) return cached;
        } catch (e) {}

        const query = this.rankRepo.createQueryBuilder('r');

        if (filters.search) {
            query.andWhere(
                '(LOWER(r.name) LIKE LOWER(:search) OR LOWER(r.username) LIKE LOWER(:search))',
                { search: `%${filters.search}%` }
            );
        }

        if (filters.tier && filters.tier !== 'ALL') {
            query.andWhere('r.tier = :tier', { tier: filters.tier });
        }

        if (filters.currency && filters.currency !== 'ALL') {
            query.andWhere('r.currency = :currency', { currency: filters.currency });
        }

        query.orderBy('r.rank', 'ASC');

        const limit = filters.limit ? Math.min(filters.limit, 100) : 50;
        query.take(limit);

        const ranks = await query.getMany();

        // Mapear se cada trader é o usuário autenticado atual
        const result = ranks.map((rankItem) => ({
            ...rankItem,
            isCurrentUser: Boolean(currentUserId && rankItem.userId === currentUserId),
        }));

        try {
            await this.cacheManager.set(cacheKey, result, 60000); // 1 min cache
        } catch (e) {}

        return result;
    }

    private async getUserMonthlyChallengeStatus(userId: string) {
        const now = new Date();
        const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        const [connectedAccountsCount, refRows] = await Promise.all([
            this.accountRepo
                .count({ where: { userId, isArchived: false } })
                .catch(() => 0),
            this.userRepo.manager
                .query(
                    `SELECT COUNT(*)::int AS cnt FROM "referrals" WHERE "referrer_user_id" = $1 AND "status" IN ('VERIFIED', 'PAID')`,
                    [userId],
                )
                .catch(() => [{ cnt: 0 }]),
        ]);
        const verifiedReferrals = Number(refRows?.[0]?.cnt || 0);
        const hasConnectedBroker = Number(connectedAccountsCount || 0) >= 1;
        return {
            monthKey,
            hasConnectedBroker,
            connectedAccountsCount: Number(connectedAccountsCount || 0),
            verifiedReferrals,
            requiredAccounts: 1,
            requiredReferrals: 1,
            eligible: hasConnectedBroker && verifiedReferrals >= 1,
        };
    }

    /**
     * Retorna o perfil de ranking do usuário autenticado
     */
    async getMyRank(userId: string) {
        const [rank, challengeStatus] = await Promise.all([
            this.rankRepo.findOne({ where: { userId } }),
            this.getUserMonthlyChallengeStatus(userId),
        ]);
        if (!rank) {
            const autoRecalcCooldownKey = 'leaderboard:auto_recalc_cooldown';
            let onCooldown = false;
            try {
                onCooldown = Boolean(await this.cacheManager.get(autoRecalcCooldownKey));
            } catch { }

            if (!onCooldown) {
                try {
                    await this.cacheManager.set(autoRecalcCooldownKey, 1, 5 * 60 * 1000);
                } catch { }
                // Executa em segundo plano sem travar a resposta HTTP do usuário
                this.recalculateRanks().catch((err) =>
                    this.logger.warn(`Background leaderboard recalculation failed: ${err?.message || err}`),
                );
            }

            // Calcula instantaneamente (< 5ms via SQL agregado) apenas os dados do usuário atual
            const preview = await this.computeSingleUserPreviewRank(userId);
            return { ...preview, challengeStatus };
        }

        return {
            ...rank,
            isCurrentUser: true,
            qualified: (rank.tradesCount || 0) > 0,
            challengeStatus,
        };
    }

    private async computeSingleUserPreviewRank(userId: string) {
        const [user, accounts] = await Promise.all([
            this.userRepo.findOne({
                where: { id: userId },
                select: ['id', 'username', 'name', 'email', 'avatarUrl', 'createdAt'],
            }),
            this.accountRepo.find({
                where: { userId, type: Not(AccountType.DEMO), isArchived: false },
                select: ['id', 'currency'],
            }),
        ]);

        const accountIds = accounts.map((a) => a.id);
        let tradesCount = 0;
        let activeDays = 0;
        let wins = 0;
        let losses = 0;
        let grossProfit = 0;
        let grossLoss = 0;
        let totalPnL = 0;
        let maxStreak = 0;

        const fxSql = `CASE UPPER(COALESCE(a.currency, 'USD')) WHEN 'USC' THEN 0.01 WHEN 'CENT' THEN 0.01 WHEN 'MZN' THEN (1.0 / 65.0) WHEN 'EUR' THEN 1.08 WHEN 'GBP' THEN 1.27 ELSE 1.0 END`;
        const pnlExprSql = `(COALESCE(t."netPnl", t.profit + COALESCE(t.commission, 0) + COALESCE(t.swap, 0), 0) * (${fxSql}))`;

        if (accountIds.length > 0) {
            const [aggRows, streakRows] = await Promise.all([
                this.tradeRepo.query(
                    `
                    SELECT
                        COUNT(*)::int AS "tradesCount",
                        COUNT(DISTINCT DATE(t.close_time AT TIME ZONE 'UTC'))::int AS "activeDays",
                        COUNT(*) FILTER (WHERE ${pnlExprSql} > 0)::int AS "wins",
                        COUNT(*) FILTER (WHERE ${pnlExprSql} < 0)::int AS "losses",
                        COALESCE(SUM(${pnlExprSql}) FILTER (WHERE ${pnlExprSql} > 0), 0)::float AS "grossProfit",
                        COALESCE(SUM(ABS(${pnlExprSql})) FILTER (WHERE ${pnlExprSql} < 0), 0)::float AS "grossLoss",
                        COALESCE(SUM(${pnlExprSql}), 0)::float AS "totalPnL"
                    FROM trades t
                    INNER JOIN accounts a ON a.id::text = t.account_id
                    WHERE t.account_id = ANY($1)
                      AND t.status = 'CLOSED'
                    `,
                    [accountIds],
                ),
                this.tradeRepo.query(
                    `
                    WITH nonzero AS (
                        SELECT
                            (COALESCE(t."netPnl", t.profit + COALESCE(t.commission, 0) + COALESCE(t.swap, 0), 0) > 0) AS is_win,
                            ROW_NUMBER() OVER (ORDER BY t.close_time ASC, t.id ASC) AS rn_all,
                            ROW_NUMBER() OVER (PARTITION BY (COALESCE(t."netPnl", t.profit + COALESCE(t.commission, 0) + COALESCE(t.swap, 0), 0) > 0) ORDER BY t.close_time ASC, t.id ASC) AS rn_part
                        FROM trades t
                        WHERE t.account_id = ANY($1)
                          AND t.status = 'CLOSED'
                          AND COALESCE(t."netPnl", t.profit + COALESCE(t.commission, 0) + COALESCE(t.swap, 0), 0) <> 0
                    ),
                    streaks AS (
                        SELECT COUNT(*)::int AS len
                        FROM nonzero
                        WHERE is_win = true
                        GROUP BY (rn_all - rn_part)
                    )
                    SELECT COALESCE(MAX(len), 0)::int AS "maxStreak" FROM streaks
                    `,
                    [accountIds],
                ),
            ]);

            const agg = aggRows?.[0];
            if (agg) {
                tradesCount = Number(agg.tradesCount || 0);
                activeDays = Number(agg.activeDays || 0);
                wins = Number(agg.wins || 0);
                losses = Number(agg.losses || 0);
                grossProfit = Number(agg.grossProfit || 0);
                grossLoss = Number(agg.grossLoss || 0);
                totalPnL = Number(agg.totalPnL || 0);
            }
            maxStreak = Number(streakRows?.[0]?.maxStreak || 0);
        }

        const now = new Date();
        const userCreatedAt = user?.createdAt ? new Date(user.createdAt) : now;
        const platformDays = Math.max(
            1,
            Math.floor((now.getTime() - userCreatedAt.getTime()) / (1000 * 60 * 60 * 24)),
        );
        const effectiveTotal = wins + losses || 1;
        const winRate = tradesCount > 0 ? Number(((wins / effectiveTotal) * 100).toFixed(1)) : 0;
        const profitFactor =
            tradesCount > 0
                ? grossLoss === 0
                    ? Number((grossProfit > 0 ? 3.0 : 1.0).toFixed(2))
                    : Number((grossProfit / grossLoss).toFixed(2))
                : 0;
        const avgWin = wins > 0 ? grossProfit / wins : 0;
        const avgLoss = losses > 0 ? grossLoss / losses : 1;
        const riskReward = tradesCount > 0 ? Number((avgLoss === 0 ? 1 : avgWin / avgLoss).toFixed(2)) : 0;

        const { compositeScore, scoreBreakdown } = this.calculateCompositeScore({
            tradesCount,
            activeDays,
            platformDays,
            winRate,
            profitFactor,
            riskReward,
            streak: maxStreak,
            totalPnL: Number(totalPnL.toFixed(2)),
        });

        const badges = this.calculateBadges({
            winRate,
            streak: maxStreak,
            profitFactor,
            riskReward,
            tradesCount,
            activeDays,
            totalPnL: Number(totalPnL.toFixed(2)),
        });

        const uniqueCurrencies = new Set(accounts.map((a) => String(a.currency || 'USD').toUpperCase()));
        return {
            userId,
            rank: 999,
            name: user?.name || user?.username || 'Trader',
            username: user?.username || `trader_${userId.slice(0, 5)}`,
            avatarUrl: user?.avatarUrl || null,
            currency: uniqueCurrencies.size > 1 ? 'USD' : (accounts[0]?.currency || 'USD'),
            tier: 'BRONZE',
            tierLevel: tradesCount > 0 ? 'BRONZE' : 'CALIBRANDO',
            winRate,
            tradesCount,
            streak: maxStreak,
            profitFactor,
            riskReward,
            totalPnL: Number(totalPnL.toFixed(2)),
            compositeScore: tradesCount > 0 ? compositeScore : 0,
            scoreBreakdown:
                tradesCount > 0
                    ? scoreBreakdown
                    : { vol: 0, time: 0, cons: 0, wr: 0, pf: 0, rr: 0 },
            badges,
            isCurrentUser: true,
            qualified: tradesCount > 0,
        };
    }

    /**
     * Recalcula o ranking avaliando todos os usuários reais, contas NÃO-DEMO e trades reais
     * via SQL agregado nativo (GROUP BY + Window Function) sem loops N+1 em memória.
     */
    async recalculateRanks() {
        this.logger.log('Recalculating Leaderboard Rankings via SQL aggregation...');

        // 1. Limpar benchmarks artificiais anteriores
        try {
            await this.rankRepo.delete({ isBenchmark: true });
        } catch (e) {}

        // 2. Buscar apenas colunas necessárias dos usuários e contas NÃO-DEMO em paralelo
        const [allUsers, realAccounts] = await Promise.all([
            this.userRepo.find({
                where: [{ isBlocked: false }, { isBlocked: null as any }],
                select: ['id', 'username', 'name', 'email', 'avatarUrl', 'createdAt'],
            }),
            this.accountRepo.find({
                where: {
                    type: Not(AccountType.DEMO),
                    isArchived: false,
                },
                select: ['id', 'userId', 'currency'],
            }),
        ]);

        const userAccountsMap = new Map<string, AccountEntity[]>();
        const allValidAccountIds: string[] = [];
        for (const acc of realAccounts) {
            if (!acc.userId) continue;
            const list = userAccountsMap.get(acc.userId) || [];
            list.push(acc);
            userAccountsMap.set(acc.userId, list);
            allValidAccountIds.push(acc.id);
        }

        // 3. Agregar todas as métricas e sequências (maxStreak) direto no PostgreSQL em 2 queries únicas!
        const metricsByUserId = new Map<
            string,
            {
                tradesCount: number;
                activeDays: number;
                wins: number;
                losses: number;
                grossProfit: number;
                grossLoss: number;
                totalPnL: number;
            }
        >();
        const streakByUserId = new Map<string, number>();

        if (allValidAccountIds.length > 0) {
            const fxSql = `CASE UPPER(COALESCE(a.currency, 'USD')) WHEN 'USC' THEN 0.01 WHEN 'CENT' THEN 0.01 WHEN 'MZN' THEN (1.0 / 65.0) WHEN 'EUR' THEN 1.08 WHEN 'GBP' THEN 1.27 ELSE 1.0 END`;
            const pnlExprSql = `(COALESCE(t."netPnl", t.profit + COALESCE(t.commission, 0) + COALESCE(t.swap, 0), 0) * (${fxSql}))`;
            const [aggRows, streakRows] = await Promise.all([
                this.tradeRepo.query(
                    `
                    SELECT
                        a.user_id AS "userId",
                        COUNT(*)::int AS "tradesCount",
                        COUNT(DISTINCT DATE(t.close_time AT TIME ZONE 'UTC'))::int AS "activeDays",
                        COUNT(*) FILTER (WHERE ${pnlExprSql} > 0)::int AS "wins",
                        COUNT(*) FILTER (WHERE ${pnlExprSql} < 0)::int AS "losses",
                        COALESCE(SUM(${pnlExprSql}) FILTER (WHERE ${pnlExprSql} > 0), 0)::float AS "grossProfit",
                        COALESCE(SUM(ABS(${pnlExprSql})) FILTER (WHERE ${pnlExprSql} < 0), 0)::float AS "grossLoss",
                        COALESCE(SUM(${pnlExprSql}), 0)::float AS "totalPnL"
                    FROM trades t
                    INNER JOIN accounts a ON a.id::text = t.account_id
                    WHERE t.account_id = ANY($1)
                      AND t.status = 'CLOSED'
                    GROUP BY a.user_id
                    `,
                    [allValidAccountIds],
                ),
                this.tradeRepo.query(
                    `
                    WITH nonzero AS (
                        SELECT
                            a.user_id AS "userId",
                            (COALESCE(t."netPnl", t.profit + COALESCE(t.commission, 0) + COALESCE(t.swap, 0), 0) > 0) AS is_win,
                            ROW_NUMBER() OVER (PARTITION BY a.user_id ORDER BY t.close_time ASC, t.id ASC) AS rn_all,
                            ROW_NUMBER() OVER (PARTITION BY a.user_id, (COALESCE(t."netPnl", t.profit + COALESCE(t.commission, 0) + COALESCE(t.swap, 0), 0) > 0) ORDER BY t.close_time ASC, t.id ASC) AS rn_part
                        FROM trades t
                        INNER JOIN accounts a ON a.id::text = t.account_id
                        WHERE t.account_id = ANY($1)
                          AND t.status = 'CLOSED'
                          AND COALESCE(t."netPnl", t.profit + COALESCE(t.commission, 0) + COALESCE(t.swap, 0), 0) <> 0
                    ),
                    streaks AS (
                        SELECT "userId", COUNT(*)::int AS len
                        FROM nonzero
                        WHERE is_win = true
                        GROUP BY "userId", (rn_all - rn_part)
                    )
                    SELECT "userId", MAX(len)::int AS "maxStreak"
                    FROM streaks
                    GROUP BY "userId"
                    `,
                    [allValidAccountIds],
                ),
            ]);

            for (const row of aggRows || []) {
                if (!row.userId) continue;
                metricsByUserId.set(row.userId, {
                    tradesCount: Number(row.tradesCount || 0),
                    activeDays: Number(row.activeDays || 0),
                    wins: Number(row.wins || 0),
                    losses: Number(row.losses || 0),
                    grossProfit: Number(row.grossProfit || 0),
                    grossLoss: Number(row.grossLoss || 0),
                    totalPnL: Number(row.totalPnL || 0),
                });
            }

            for (const row of streakRows || []) {
                if (!row.userId) continue;
                streakByUserId.set(row.userId, Number(row.maxStreak || 0));
            }
        }

        const realUsersData: Partial<LeaderboardRankEntity>[] = [];
        const now = new Date();
        const usedUsernames = new Set<string>();

        // 4. Calcular scores compostos em memória (O(U), sem queries por usuário)
        for (const user of allUsers) {
            let baseName = '';
            if (user.username && !user.username.includes(' ') && user.username.length <= 15) {
                baseName = user.username.toLowerCase().replace(/[^a-z0-9_]/g, '');
            } else if (user.name) {
                baseName = user.name.trim().split(' ')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
            } else if (user.email) {
                baseName = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
            } else {
                baseName = 'trader';
            }
            if (!baseName) baseName = 'trader';

            let uniqueName = baseName;
            let counter = 2;
            while (usedUsernames.has(uniqueName)) {
                uniqueName = `${baseName}${counter}`;
                counter++;
            }
            usedUsernames.add(uniqueName);
            user.username = uniqueName;

            const accounts = userAccountsMap.get(user.id) || [];
            const agg = metricsByUserId.get(user.id);
            const tradesCount = agg?.tradesCount || 0;
            const activeDays = agg?.activeDays || 0;
            const wins = agg?.wins || 0;
            const losses = agg?.losses || 0;
            const grossProfit = agg?.grossProfit || 0;
            const grossLoss = agg?.grossLoss || 0;
            const totalPnL = agg?.totalPnL || 0;
            const maxStreak = streakByUserId.get(user.id) || 0;

            const userCreatedAt = user.createdAt ? new Date(user.createdAt) : now;
            const platformDays = Math.max(1, Math.floor((now.getTime() - userCreatedAt.getTime()) / (1000 * 60 * 60 * 24)));

            const effectiveTotal = wins + losses || 1;
            const winRate = tradesCount > 0 ? Number(((wins / effectiveTotal) * 100).toFixed(1)) : 0;
            const profitFactor = tradesCount > 0
                ? (grossLoss === 0 ? Number((grossProfit > 0 ? 3.0 : 1.0).toFixed(2)) : Number((grossProfit / grossLoss).toFixed(2)))
                : 0;

            const avgWin = wins > 0 ? grossProfit / wins : 0;
            const avgLoss = losses > 0 ? grossLoss / losses : 1;
            const riskReward = tradesCount > 0 ? Number((avgLoss === 0 ? 1 : avgWin / avgLoss).toFixed(2)) : 0;

            const { compositeScore, scoreBreakdown } = this.calculateCompositeScore({
                tradesCount,
                activeDays,
                platformDays,
                winRate,
                profitFactor,
                riskReward,
                streak: maxStreak,
                totalPnL: Number(totalPnL.toFixed(2)),
            });

            const badges = this.calculateBadges({
                winRate,
                streak: maxStreak,
                profitFactor,
                riskReward,
                tradesCount,
                activeDays,
                totalPnL: Number(totalPnL.toFixed(2)),
            });

            const userCurrencies = new Set(accounts.map((a) => String(a.currency || 'USD').toUpperCase()));
            const primaryCurrency = userCurrencies.size > 1 ? 'USD' : (accounts[0]?.currency || 'USD');

            realUsersData.push({
                userId: user.id,
                username: user.username,
                name: user.name || user.username || 'Trader',
                avatarUrl: user.avatarUrl || null,
                currency: primaryCurrency,
                winRate,
                tradesCount,
                streak: maxStreak,
                profitFactor,
                riskReward,
                totalPnL: Number(totalPnL.toFixed(2)),
                compositeScore: tradesCount > 0 ? compositeScore : 0,
                scoreBreakdown: tradesCount > 0 ? scoreBreakdown : { vol: 0, pnl: 0, pf: 0, cons: 0, time: 0, wr: 0, rr: 0 },
                badges,
                isBenchmark: false,
            });
        }

        // 5. Particionar traders em patamares de qualificação operacional (Echelons)
        // Patamar 1 (Elite Global): >= 25.000 operações & PnL > 0 (Top #1 a #3)
        // Patamar 2 (Veteranos / Alta Frequência): >= 10.000 a 24.999 operações & PnL > 0 (Top #4 a #10)
        // Patamar 3 (Consistentes): >= 5.000 a 9.999 operações (Top #11 a #50)
        // Patamar 4 (Intermediários): >= 1.000 a 4.999 operações (Top #51 a #100)
        // Patamar 5 (Abaixo do centésimo lugar): > 0 e < 1.000 operações (#101+)
        // Patamar 6 (Calibrando): 0 operações (#999)

        const gElite = realUsersData.filter((t) => (t.tradesCount || 0) >= 25000 && (t.totalPnL || 0) > 0);
        const gTop10 = realUsersData.filter(
            (t) => (t.tradesCount || 0) >= 10000 && (t.tradesCount || 0) < 25000 && (t.totalPnL || 0) > 0
        );
        const gTop50 = realUsersData.filter((t) => (t.tradesCount || 0) >= 5000 && (t.tradesCount || 0) < 10000);
        const gTop100 = realUsersData.filter((t) => (t.tradesCount || 0) >= 1000 && (t.tradesCount || 0) < 5000);
        const gBelow100 = realUsersData.filter((t) => (t.tradesCount || 0) > 0 && (t.tradesCount || 0) < 1000);
        const gCalibrating = realUsersData.filter((t) => (t.tradesCount || 0) === 0);

        const sortGroup = (arr: Partial<LeaderboardRankEntity>[]) => {
            arr.sort((a, b) => {
                if ((b.compositeScore || 0) !== (a.compositeScore || 0)) {
                    return (b.compositeScore || 0) - (a.compositeScore || 0);
                }
                if ((b.totalPnL || 0) !== (a.totalPnL || 0)) {
                    return (b.totalPnL || 0) - (a.totalPnL || 0);
                }
                if ((b.tradesCount || 0) !== (a.tradesCount || 0)) {
                    return (b.tradesCount || 0) - (a.tradesCount || 0);
                }
                return (b.winRate || 0) - (a.winRate || 0);
            });
        };

        sortGroup(gElite);
        sortGroup(gTop10);
        sortGroup(gTop50);
        sortGroup(gTop100);
        sortGroup(gBelow100);

        // Atribuir os Ranks oficiais por patamar:
        const rankedTraders: Partial<LeaderboardRankEntity>[] = [];

        gElite.forEach((t, idx) => {
            const rank = idx + 1; // 1, 2, 3
            const tierInfo = this.getTierAndRankInfo(rank, {
                tradesCount: t.tradesCount || 0,
                totalPnL: t.totalPnL || 0,
                winRate: t.winRate || 0,
                profitFactor: t.profitFactor || 0,
            });
            t.rank = rank;
            t.tier = tierInfo.key;
            t.tierLevel = tierInfo.label;
            rankedTraders.push(t);
        });

        gTop10.forEach((t, idx) => {
            const rank = 4 + idx; // 4..10
            const tierInfo = this.getTierAndRankInfo(rank, {
                tradesCount: t.tradesCount || 0,
                totalPnL: t.totalPnL || 0,
                winRate: t.winRate || 0,
                profitFactor: t.profitFactor || 0,
            });
            t.rank = rank;
            t.tier = tierInfo.key;
            t.tierLevel = tierInfo.label;
            rankedTraders.push(t);
        });

        gTop50.forEach((t, idx) => {
            const rank = 11 + idx; // 11..50
            const tierInfo = this.getTierAndRankInfo(rank, {
                tradesCount: t.tradesCount || 0,
                totalPnL: t.totalPnL || 0,
                winRate: t.winRate || 0,
                profitFactor: t.profitFactor || 0,
            });
            t.rank = rank;
            t.tier = tierInfo.key;
            t.tierLevel = tierInfo.label;
            rankedTraders.push(t);
        });

        gTop100.forEach((t, idx) => {
            const rank = 51 + idx; // 51..100
            const tierInfo = this.getTierAndRankInfo(rank, {
                tradesCount: t.tradesCount || 0,
                totalPnL: t.totalPnL || 0,
                winRate: t.winRate || 0,
                profitFactor: t.profitFactor || 0,
            });
            t.rank = rank;
            t.tier = tierInfo.key;
            t.tierLevel = tierInfo.label;
            rankedTraders.push(t);
        });

        // Abaixo de 1.000 operações: inicia estritamente em #101
        gBelow100.forEach((t, idx) => {
            const rank = 101 + idx;
            const tierInfo = this.getTierAndRankInfo(rank, {
                tradesCount: t.tradesCount || 0,
                totalPnL: t.totalPnL || 0,
                winRate: t.winRate || 0,
                profitFactor: t.profitFactor || 0,
            });
            t.rank = rank;
            t.tier = tierInfo.key;
            t.tierLevel = tierInfo.label;
            rankedTraders.push(t);
        });

        // Usuários sem operações: rank 999 (CALIBRANDO)
        gCalibrating.forEach((t) => {
            t.rank = 999;
            t.tier = 'BRONZE';
            t.tierLevel = 'CALIBRANDO';
            rankedTraders.push(t);
        });

        // 6. Persistir no banco em lote (sem queries N+1 por usuário)
        const processedUserIds = Array.from(
            new Set(rankedTraders.map((t) => t.userId).filter(Boolean) as string[]),
        );

        const existingRanks = await this.rankRepo.find({
            select: ['id', 'userId'],
        });
        const existingIdByUserId = new Map<string, string>();
        const staleRankIds: string[] = [];
        const processedSet = new Set<string>(processedUserIds);

        for (const r of existingRanks) {
            if (r.userId && processedSet.has(r.userId) && !existingIdByUserId.has(r.userId)) {
                existingIdByUserId.set(r.userId, r.id);
            } else {
                staleRankIds.push(r.id);
            }
        }

        if (staleRankIds.length > 0) {
            await this.rankRepo.delete(staleRankIds);
        }

        const entitiesToSave = rankedTraders.map((trader) => {
            const existingId = trader.userId ? existingIdByUserId.get(trader.userId) : undefined;
            return this.rankRepo.create(existingId ? { id: existingId, ...trader } : trader);
        });

        if (entitiesToSave.length > 0) {
            await this.rankRepo.save(entitiesToSave, { chunk: 200 });
        }

        // Invalidar apenas o namespace de cache do Leaderboard (sem limpar sessões/OTPs globais no Redis)
        await this.bumpCacheVersion();

        this.logger.log(`Ranking recalculated for ${realUsersData.length} real traders.`);
    }
}
