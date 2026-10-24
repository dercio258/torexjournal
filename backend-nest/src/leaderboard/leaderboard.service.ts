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

    /**
     * Retorna a lista ranqueada de traders para o Leaderboard
     */
    async getLeaderboard(filters: LeaderboardFilterDto = {}, currentUserId?: string) {
        // Se a tabela de ranking estiver vazia, recalcula primeiro
        const count = await this.rankRepo.count();
        if (count === 0) {
            await this.recalculateRanks();
        }

        const cacheKey = `leaderboard:list:${JSON.stringify(filters)}:${currentUserId || 'guest'}`;
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

    /**
     * Retorna o perfil de ranking do usuário autenticado
     */
    async getMyRank(userId: string) {
        let rank = await this.rankRepo.findOne({ where: { userId } });
        if (!rank) {
            await this.recalculateRanks();
            rank = await this.rankRepo.findOne({ where: { userId } });
        }

        if (!rank) {
            const user = await this.userRepo.findOne({ where: { id: userId } });
            return {
                userId,
                rank: 999,
                name: user?.name || user?.username || 'Trader',
                username: user?.username || `trader_${userId.slice(0, 5)}`,
                avatarUrl: user?.avatarUrl || null,
                currency: 'USD',
                tier: 'BRONZE',
                tierLevel: 'CALIBRANDO',
                winRate: 0,
                tradesCount: 0,
                streak: 0,
                profitFactor: 0,
                riskReward: 0,
                totalPnL: 0,
                compositeScore: 0,
                scoreBreakdown: { vol: 0, time: 0, cons: 0, wr: 0, pf: 0, rr: 0 },
                badges: [],
                isCurrentUser: true,
                qualified: false,
            };
        }

        return {
            ...rank,
            isCurrentUser: true,
            qualified: (rank.tradesCount || 0) > 0,
        };
    }

    /**
     * Recalcula o ranking avaliando todos os usuários reais, contas NÃO-DEMO e trades reais
     * Focado em número de operações, consistência, tempo na plataforma e eficiência
     */
    async recalculateRanks() {
        this.logger.log('Recalculating Leaderboard Rankings for all real users...');

        // 1. Limpar benchmarks artificiais anteriores para garantir pureza dos dados reais
        try {
            await this.rankRepo.delete({ isBenchmark: true });
        } catch (e) {}

        // 2. Buscar todos os usuários cadastrados e ativos
        const allUsers = await this.userRepo.find({
            where: [
                { isBlocked: false },
                { isBlocked: null as any },
            ],
        });

        // 3. Buscar todas as contas ativas NÃO-DEMO
        const realAccounts = await this.accountRepo.find({
            where: {
                type: Not(AccountType.DEMO),
                isArchived: false,
            },
        });

        const userAccountsMap = new Map<string, AccountEntity[]>();
        for (const acc of realAccounts) {
            if (!acc.userId) continue;
            const list = userAccountsMap.get(acc.userId) || [];
            list.push(acc);
            userAccountsMap.set(acc.userId, list);
        }

        const realUsersData: Partial<LeaderboardRankEntity>[] = [];
        const now = new Date();
        const usedUsernames = new Set<string>();

        // 4. Calcular métricas para cada usuário cadastrado
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

            let uniqueName = baseName;
            let counter = 2;
            while (usedUsernames.has(uniqueName)) {
                uniqueName = `${baseName}${counter}`;
                counter++;
            }
            usedUsernames.add(uniqueName);
            user.username = uniqueName;

            const accounts = userAccountsMap.get(user.id) || [];
            const accountIds = accounts.map((a) => a.id);
            let trades: TradeEntity[] = [];

            if (accountIds.length > 0) {
                trades = await this.tradeRepo.find({
                    where: {
                        accountId: In(accountIds),
                        status: 'CLOSED',
                    },
                    order: { closeTime: 'ASC' },
                });
            }

            const activeDaysSet = new Set<string>();
            let wins = 0;
            let losses = 0;
            let grossProfit = 0;
            let grossLoss = 0;
            let currentStreak = 0;
            let maxStreak = 0;
            let totalPnL = 0;

            for (const t of trades) {
                if (t.closeTime) {
                    const dayKey = new Date(t.closeTime).toISOString().slice(0, 10);
                    activeDaysSet.add(dayKey);
                }
                const profit = Number(t.profit || t.netPnl || 0);
                totalPnL += profit;
                if (profit > 0) {
                    wins++;
                    grossProfit += profit;
                    currentStreak++;
                    if (currentStreak > maxStreak) maxStreak = currentStreak;
                } else if (profit < 0) {
                    losses++;
                    grossLoss += Math.abs(profit);
                    currentStreak = 0;
                }
            }

            const tradesCount = trades.length;
            const activeDays = activeDaysSet.size;
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

            const primaryCurrency = accounts[0]?.currency || 'USD';

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

        // 6. Persistir no banco
        const processedUserIds = new Set<string>();

        for (const trader of rankedTraders) {
            if (trader.userId) processedUserIds.add(trader.userId);

            const existing = await this.rankRepo.findOne({
                where: { userId: trader.userId },
            });

            if (existing) {
                await this.rankRepo.update(existing.id, trader);
            } else {
                await this.rankRepo.save(this.rankRepo.create(trader));
            }
        }

        // Remover quaisquer registros obsoletos que não correspondam aos usuários atuais
        const allRanks = await this.rankRepo.find();
        for (const r of allRanks) {
            if (r.userId && !processedUserIds.has(r.userId)) {
                await this.rankRepo.delete(r.id);
            } else if (!r.userId) {
                await this.rankRepo.delete(r.id);
            }
        }

        // Limpar cache
        try {
            const store = (this.cacheManager as any)?.store;
            if (typeof store?.reset === 'function') {
                await store.reset();
            } else if (typeof (this.cacheManager as any)?.reset === 'function') {
                await (this.cacheManager as any).reset();
            }
        } catch (e) {}

        this.logger.log(`Ranking recalculated for ${realUsersData.length} real traders.`);
    }
}
