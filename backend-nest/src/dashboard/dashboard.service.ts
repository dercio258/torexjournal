import { Injectable, Inject, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual, In } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';
import { MentalLog } from './mental-log.entity';
import { TechnicalJournal } from './technical-journal.entity';
import { BacktestSession } from './backtest-session.entity';
import { ClickHouseService } from '../clickhouse/clickhouse.service';

@Injectable()
export class DashboardService {
    private readonly logger = new Logger(DashboardService.name);

    constructor(
        @InjectRepository(TradeEntity)
        private tradeRepo: Repository<TradeEntity>,
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
        @InjectRepository(MentalLog)
        private mentalLogRepo: Repository<MentalLog>,
        @InjectRepository(TechnicalJournal)
        private techJournalRepo: Repository<TechnicalJournal>,
        @InjectRepository(BacktestSession)
        private backtestRepo: Repository<BacktestSession>,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private clickHouseService: ClickHouseService
    ) { }

    private async getPrimaryAccount(userId: string) {
        let account = await this.accountRepo.findOne({
            where: { userId, isArchived: false, isPrimary: true }
        });
        if (!account) {
            account = await this.accountRepo.findOne({
                where: { userId, isArchived: false },
                order: { lastSeen: 'DESC' }
            });
        }
        return account;
    }

    /**
     * Validação de posse da conta para operações de Dashboard
     */
    public async validateUserAccount(userId: string, accountId?: string) {
        if (accountId && accountId !== 'all') {
            const targetAccount = await this.accountRepo.findOne({
                where: { id: accountId, userId }
            });
            if (!targetAccount) {
                throw new ForbiddenException('Acesso negado: a conta informada não existe ou não pertence a este usuário');
            }
            return {
                isConsolidated: false,
                accounts: [targetAccount],
                accountIds: [targetAccount.id],
                targetAccount
            };
        }

        const accounts = await this.accountRepo.find({
            where: { userId, isArchived: false }
        });
        return {
            isConsolidated: true,
            accounts,
            accountIds: accounts.map(a => a.id),
            targetAccount: null
        };
    }

    async getTrades(userId: string, accountId?: string, endDate?: string, limit = 100) {
        const cacheKey = `dashboard:trades:${userId}:${accountId || 'all'}:${endDate || 'all'}:${limit}`;
        try {
            const cached = await this.cacheManager.get<any[]>(cacheKey);
            if (cached) {
                return cached;
            }
        } catch (err) {
            console.warn(`[DashboardService] Cache get failed for trades: ${err.message}`);
        }

        const { accountIds, accounts } = await this.validateUserAccount(userId, accountId);
        if (accountIds.length === 0) return [];

        const whereClause: any = { accountId: In(accountIds), status: 'CLOSED' };
        if (endDate) {
            whereClause.closeTime = LessThanOrEqual(new Date(endDate));
        }

        const trades = await this.tradeRepo.find({
            where: whereClause,
            order: { closeTime: 'DESC' },
            take: limit
        });

        // Enriquecer com identificadores de conta para a visão consolidada
        const accMap = new Map(accounts.map(a => [a.id, a]));
        const enrichedTrades = trades.map(t => {
            const acc = accMap.get(t.accountId);
            return {
                ...t,
                accountName: acc?.name || 'Conta',
                accountBroker: acc?.broker || 'Corretora'
            };
        });

        try {
            await this.cacheManager.set(cacheKey, enrichedTrades, 300000); // 5 minutes cache
        } catch (err) {
            console.warn(`[DashboardService] Cache set failed for trades: ${err.message}`);
        }
        return enrichedTrades;
    }

    async getPerformance(userId: string, accountId?: string, startDate?: string, endDate?: string) {
        const cacheKey = `dashboard:performance:${userId}:${accountId || 'all'}:${startDate || 'all'}:${endDate || 'all'}`;
        try {
            const cached = await this.cacheManager.get(cacheKey);
            if (cached) {
                return cached;
            }
        } catch (err) {
            console.warn(`[DashboardService] Cache get failed for performance: ${err.message}`);
        }

        try {
            const { isConsolidated, accounts, accountIds, targetAccount } = await this.validateUserAccount(userId, accountId);
            if (accounts.length === 0) {
                return {
                    totalPnL: 0,
                    winRate: 0,
                    totalTrades: 0,
                    profitFactor: 0,
                    radarMetrics: { consistency: 0, riskManagement: 0, discipline: 0, profitability: 0, winRate: 0 },
                    dailyPnL: [],
                    tradePnL: [],
                    byMood: [],
                    bySetup: [],
                    bySession: [],
                    isConsolidated: false,
                    targetAccount: null,
                    currencies: ['USD'],
                    hasMultipleCurrencies: false,
                    accountBreakdown: []
                };
            }

            const whereClause: any = { accountId: In(accountIds) };

            if (startDate && endDate) {
                whereClause.closeTime = Between(new Date(startDate), new Date(endDate));
            } else if (startDate) {
                whereClause.closeTime = MoreThanOrEqual(new Date(startDate));
            } else if (endDate) {
                whereClause.closeTime = LessThanOrEqual(new Date(endDate));
            }

            // FILTER: Only consider CLOSED trades for performance metrics
            whereClause.status = 'CLOSED';

            let trades: any[] = [];
            try {
                let clickhouseQuery = `
                    SELECT 
                        id, accountId, ticket, contractId, symbol, type, 
                        volume, openPrice, closePrice, profit, sl, tp, 
                        commission, swap, openTime, closeTime, status, 
                        magic, comment, session, mood, rating, setup, 
                        lesson, tags, dataQuality, importLogId, updatedAt
                    FROM trades FINAL
                    WHERE accountId IN ({accountIds:Array(String)}) AND status = 'CLOSED'
                `;
                const params: any = { accountIds };

                if (startDate && endDate) {
                    clickhouseQuery += ` AND closeTime BETWEEN {startDate:DateTime} AND {endDate:DateTime}`;
                    params.startDate = new Date(startDate).toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
                    params.endDate = new Date(endDate).toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
                } else if (startDate) {
                    clickhouseQuery += ` AND closeTime >= {startDate:DateTime}`;
                    params.startDate = new Date(startDate).toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
                } else if (endDate) {
                    clickhouseQuery += ` AND closeTime <= {endDate:DateTime}`;
                    params.endDate = new Date(endDate).toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
                }

                clickhouseQuery += ` ORDER BY closeTime ASC`;
                trades = await this.clickHouseService.query(clickhouseQuery, params);
            } catch (clickhouseErr) {
                this.logger.warn(`ClickHouse query failed, falling back to PostgreSQL: ${clickhouseErr.message}`);
                trades = await this.tradeRepo.find({
                    where: whereClause,
                    order: { closeTime: 'ASC' }
                });
            }

            // Consistency check with PostgreSQL (authoritative transactional source of truth):
            const pgTradeCount = await this.tradeRepo.count({ where: whereClause });
            if (trades.length !== pgTradeCount) {
                this.logger.log(`[DashboardService] Discrepancy detected: ClickHouse had ${trades.length} trades, PostgreSQL has ${pgTradeCount}. Using PostgreSQL as source of truth.`);
                const previousChLength = trades.length;
                const pgTrades = await this.tradeRepo.find({
                    where: whereClause,
                    order: { closeTime: 'ASC' }
                });
                trades = pgTrades;

                if (previousChLength > pgTradeCount) {
                    // ClickHouse had ghost / reverted / deleted trades!
                    // Heal ClickHouse for these accounts by replacing with pgTrades
                    this.clickHouseService.syncAccountTrades(accountIds, pgTrades).catch(err => {
                        this.logger.warn(`Failed to heal ClickHouse ghost trades: ${err.message}`);
                    });
                } else {
                    // ClickHouse was missing trades
                    this.clickHouseService.saveTrades(pgTrades).catch(err => {
                        this.logger.warn(`Failed to sync trades to ClickHouse: ${err.message}`);
                    });
                }
            }

            const dailyMap = new Map<string, number>();
            const moodMap = new Map<string, { count: number; pnl: number }>();
            const setupMap = new Map<string, { count: number; pnl: number }>();
            const sessionMap = new Map<string, { count: number; pnl: number }>();

            const totalTrades = trades.length;
            if (totalTrades === 0) {
                return {
                    totalPnL: 0,
                    winRate: 0,
                    totalTrades: 0,
                    profitFactor: 0,
                    radarMetrics: { consistency: 0, riskManagement: 0, discipline: 0, profitability: 0, winRate: 0 },
                    dailyPnL: [],
                    tradePnL: [],
                    byMood: [],
                    bySetup: [],
                    bySession: [],
                    isConsolidated,
                    currencies: [...new Set(accounts.map(a => a.currency || 'USD'))],
                    hasMultipleCurrencies: false,
                    accountBreakdown: accounts.map(a => ({
                        id: a.id,
                        name: a.name,
                        broker: a.broker,
                        type: a.type,
                        currency: a.currency,
                        balance: a.balance,
                        initialBalance: a.initialBalance,
                        pnl: 0,
                        trades: 0,
                        winRate: 0
                    })),
                    targetAccount: targetAccount ? {
                        id: targetAccount.id,
                        name: targetAccount.name,
                        broker: targetAccount.broker,
                        type: targetAccount.type,
                        currency: targetAccount.currency,
                        balance: targetAccount.balance,
                        initialBalance: targetAccount.initialBalance,
                        propFirmRules: targetAccount.propFirmRules
                    } : null
                };
            }

            let totalPnL = 0;
            let wins = 0;
            let losses = 0;
            let breakevens = 0;
            let grossProfit = 0;
            let grossLoss = 0;

            let peakEquity = 0;
            let currentEquity = 0;
            let maxDrawdown = 0;

            const todayStr = new Date().toISOString().split('T')[0];
            let todayPnL = 0;

            for (const t of trades) {
                const profit = Number(t.profit) || 0;
                const commission = Number(t.commission) || 0;
                const swap = Number(t.swap) || 0;
                const pnl = profit + commission + swap;

                totalPnL += pnl;

                // Drawdown tracking
                currentEquity += pnl;
                if (currentEquity > peakEquity) peakEquity = currentEquity;
                const dd = peakEquity - currentEquity;
                if (dd > maxDrawdown) maxDrawdown = dd;

                // Today PnL tracking
                if (t.closeTime) {
                    const cDate = new Date(t.closeTime).toISOString().split('T')[0];
                    if (cDate === todayStr) {
                        todayPnL += pnl;
                    }
                }

                if (pnl > 0) {
                    wins++;
                    grossProfit += pnl;
                } else if (pnl < 0) {
                    losses++;
                    grossLoss += Math.abs(pnl);
                } else {
                    breakevens++;
                }

                const dateStr = t.closeTime ? new Date(t.closeTime).toISOString().split('T')[0] : 'Unknown';
                dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + pnl);

                const mood = t.mood || 'Unknown';
                const mData = moodMap.get(mood) || { count: 0, pnl: 0 };
                moodMap.set(mood, { count: mData.count + 1, pnl: mData.pnl + pnl });

                const setup = t.setup || 'Unknown';
                const sData = setupMap.get(setup) || { count: 0, pnl: 0 };
                setupMap.set(setup, { count: sData.count + 1, pnl: sData.pnl + pnl });

                const session = t.session || 'Unknown';
                const sessData = sessionMap.get(session) || { count: 0, pnl: 0 };
                sessionMap.set(session, { count: sessData.count + 1, pnl: sessData.pnl + pnl });
            }

            const winRate = (wins / totalTrades) * 100;
            const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? grossProfit : 0) : grossProfit / grossLoss;

            // Real mathematical calculation for Radar Metrics (0-100 scale, no hardcoded fake values)
            const tradingDays = Array.from(dailyMap.values());
            const winningDays = tradingDays.filter(dPnl => dPnl > 0).length;
            const consistencyScore = tradingDays.length > 0
                ? Math.round((winningDays / tradingDays.length) * 100)
                : 0;

            const avgWin = wins > 0 ? grossProfit / wins : 0;
            const avgLoss = losses > 0 ? grossLoss / losses : 0;
            const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 2 : 0);
            const tradesWithSl = trades.filter(t => Number(t.sl) > 0).length;
            const slUsageRatio = totalTrades > 0 ? (tradesWithSl / totalTrades) * 100 : 0;
            const payoffComponent = Math.min(100, (payoffRatio / 2.0) * 100);
            const riskManagementScore = Math.round(Math.min(100, (payoffComponent * 0.6) + (slUsageRatio * 0.4)));

            // Volume sizing stability (Discipline): penalize erratic lot size spikes (revenge trading / martingale)
            const volumes = trades.map(t => Number(t.volume) || 0).filter(v => v > 0);
            let disciplineScore = 0;
            if (volumes.length > 0) {
                const meanVol = volumes.reduce((s, v) => s + v, 0) / volumes.length;
                const varianceVol = volumes.reduce((s, v) => s + Math.pow(v - meanVol, 2), 0) / volumes.length;
                const cvVol = meanVol > 0 ? Math.sqrt(varianceVol) / meanVol : 0; // Coefficient of variation
                disciplineScore = Math.max(0, Math.min(100, Math.round((1 - Math.min(cvVol, 1)) * 100)));
            }

            const profitabilityScore = grossLoss === 0
                ? (grossProfit > 0 ? 100 : 0)
                : Math.max(0, Math.min(100, Math.round((profitFactor / 2.5) * 100)));

            const radarMetrics = {
                consistency: consistencyScore,
                riskManagement: riskManagementScore,
                discipline: disciplineScore,
                profitability: profitabilityScore,
                winRate: Number(winRate.toFixed(1))
            };

            // Currencies and Account Breakdown for consolidated view
            const currencies = [...new Set(accounts.map(a => a.currency || 'USD'))];
            const hasMultipleCurrencies = currencies.length > 1;

            let accountBreakdown: any[] = [];
            if (isConsolidated) {
                const breakdownMap = new Map<string, { id: string; name: string; broker: string; type: string; currency: string; pnl: number; trades: number; wins: number; balance: number; initialBalance: number }>();
                for (const acc of accounts) {
                    breakdownMap.set(acc.id, {
                        id: acc.id,
                        name: acc.name,
                        broker: acc.broker,
                        type: acc.type,
                        currency: acc.currency,
                        balance: acc.balance,
                        initialBalance: acc.initialBalance,
                        pnl: 0,
                        trades: 0,
                        wins: 0
                    });
                }
                for (const t of trades) {
                    const accId = t.accountId || (t as any).account_id;
                    const item = breakdownMap.get(accId);
                    if (item) {
                        const pnl = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
                        item.pnl += pnl;
                        item.trades += 1;
                        if (pnl > 0) item.wins += 1;
                    }
                }
                accountBreakdown = Array.from(breakdownMap.values()).map(b => ({
                    ...b,
                    pnl: Number(b.pnl.toFixed(2)),
                    winRate: b.trades > 0 ? Number(((b.wins / b.trades) * 100).toFixed(1)) : 0
                }));
            }

            // Prop Firm calculation for individual account
            let propFirmStatus: any = null;
            if (targetAccount) {
                const rules = targetAccount.propFirmRules || {};
                const profitTarget = Number(rules.profitTarget) || 0;
                const dailyLossLimit = Number(rules.dailyLossLimit) || 0;
                const maxDrawdownLimit = Number(rules.maxDrawdown) || 0;

                const profitTargetProgress = profitTarget > 0 ? Number(((totalPnL / profitTarget) * 100).toFixed(1)) : null;
                const dailyLossMargin = dailyLossLimit > 0 ? Number((dailyLossLimit + todayPnL).toFixed(2)) : null;
                const maxDrawdownRecorded = Number(maxDrawdown.toFixed(2));

                propFirmStatus = {
                    hasRules: profitTarget > 0 || dailyLossLimit > 0 || maxDrawdownLimit > 0,
                    profitTarget,
                    profitTargetProgress,
                    dailyLossLimit,
                    todayPnL: Number(todayPnL.toFixed(2)),
                    dailyLossMargin,
                    maxDrawdownLimit,
                    maxDrawdownRecorded
                };
            }

            const result = {
                totalPnL: Number(totalPnL.toFixed(2)),
                winRate: Number(winRate.toFixed(1)),
                totalTrades,
                profitFactor: Number(profitFactor.toFixed(2)),
                radarMetrics,
                dailyPnL: Array.from(dailyMap.entries()).map(([date, val]) => ({ date, pnl: Number(val.toFixed(2)), value: Number(val.toFixed(2)) })),
                tradePnL: trades.slice(-20).map(t => ({
                    date: t.closeTime ? new Date(t.closeTime).toISOString() : null,
                    value: Number(((Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0)).toFixed(2)),
                    ticket: t.ticket
                })),
                distribution: { wins, losses, breakeven: breakevens },
                byMood: Array.from(moodMap.entries()).map(([mood, data]) => ({ mood, count: data.count, pnl: Number(data.pnl.toFixed(2)) })),
                bySetup: Array.from(setupMap.entries()).map(([setup, data]) => ({ setup, count: data.count, pnl: Number(data.pnl.toFixed(2)) })),
                bySession: Array.from(sessionMap.entries()).map(([session, data]) => ({ session, count: data.count, pnl: Number(data.pnl.toFixed(2)) })),
                isConsolidated,
                currencies,
                hasMultipleCurrencies,
                accountBreakdown,
                targetAccount: targetAccount ? {
                    id: targetAccount.id,
                    name: targetAccount.name,
                    broker: targetAccount.broker,
                    type: targetAccount.type,
                    currency: targetAccount.currency,
                    balance: targetAccount.balance,
                    initialBalance: targetAccount.initialBalance,
                    propFirmRules: targetAccount.propFirmRules
                } : null,
                propFirmStatus
            };

            try {
                await this.cacheManager.set(cacheKey, result, 15000); // 15s responsive cache
            } catch (err) {
                console.warn(`[DashboardService] Cache set failed for performance: ${err.message}`);
            }

            return result;

        } catch (error) {
            console.error('getPerformance error:', error);
            if (error instanceof ForbiddenException) throw error;
            return {
                totalPnL: 0, winRate: 0, totalTrades: 0, profitFactor: 0,
                radarMetrics: { consistency: 0, riskManagement: 0, discipline: 0, profitability: 0, winRate: 0 },
                dailyPnL: [], tradePnL: [], byMood: [], bySetup: [], bySession: []
            };
        }
    }

    async saveMentalLog(userId: string, data: Partial<MentalLog>, accountId?: string) {
        let targetAccount = null;
        if (accountId && accountId !== 'all') {
            targetAccount = await this.accountRepo.findOne({ where: { id: accountId, userId, isArchived: false } });
        }
        if (!targetAccount) {
            targetAccount = await this.getPrimaryAccount(userId);
        }
        if (!targetAccount) throw new NotFoundException('Conta de trading não encontrada');

        const dateStr = data.date || new Date().toISOString().split('T')[0];

        let log = await this.mentalLogRepo.findOne({
            where: {
                accountId: targetAccount.id,
                date: dateStr,
                session: data.session
            }
        });

        const overall = (
            (data.sleepQuality || 5) +
            (data.energy || 5) +
            (data.focus || 5) +
            (data.mood || 5) +
            (11 - (data.stress || 5))
        ) / 5;

        if (log) {
            log.sleepQuality = data.sleepQuality;
            log.energy = data.energy;
            log.focus = data.focus;
            log.mood = data.mood;
            log.stress = data.stress;
            log.caffeine = data.caffeine;
            log.notes = data.notes;
            log.overallScore = overall;
            log.account = targetAccount;
            log.accountId = targetAccount.id;
        } else {
            log = this.mentalLogRepo.create({
                account: targetAccount,
                accountId: targetAccount.id,
                date: dateStr,
                time: data.time || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                session: data.session,
                sleepQuality: data.sleepQuality || 5,
                energy: data.energy || 5,
                focus: data.focus || 5,
                mood: data.mood || 5,
                stress: data.stress || 5,
                caffeine: data.caffeine || 0,
                notes: data.notes || '',
                overallScore: overall
            });
        }

        return this.mentalLogRepo.save(log);
    }

    async getTodayMentalLog(userId: string, session: string, accountId?: string) {
        let targetAccountIds: string[] = [];
        if (accountId && accountId !== 'all') {
            const acc = await this.accountRepo.findOne({ where: { id: accountId, userId } });
            if (!acc) throw new ForbiddenException('Acesso negado à conta');
            targetAccountIds = [acc.id];
        } else {
            const accounts = await this.accountRepo.find({ where: { userId } });
            targetAccountIds = accounts.map(a => a.id);
        }
        if (targetAccountIds.length === 0) return null;

        const dateStr = new Date().toISOString().split('T')[0];

        return this.mentalLogRepo.findOne({
            where: {
                accountId: In(targetAccountIds),
                date: dateStr,
                session: session
            },
            relations: ['account']
        });
    }

    async saveMentalLogImage(userId: string, imageUrl: string, session: string, accountId?: string) {
        let targetAccount = null;
        if (accountId && accountId !== 'all') {
            targetAccount = await this.accountRepo.findOne({ where: { id: accountId, userId, isArchived: false } });
        }
        if (!targetAccount) {
            targetAccount = await this.getPrimaryAccount(userId);
        }
        if (!targetAccount) throw new NotFoundException('Conta de trading não encontrada');

        const dateStr = new Date().toISOString().split('T')[0];

        let log = await this.mentalLogRepo.findOne({
            where: {
                accountId: targetAccount.id,
                date: dateStr,
                session: session
            }
        });

        if (!log) {
            log = this.mentalLogRepo.create({
                account: targetAccount,
                accountId: targetAccount.id,
                date: dateStr,
                time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                session: session,
                sleepQuality: 5,
                energy: 5,
                focus: 5,
                mood: 5,
                stress: 5,
                caffeine: 0,
                imageUrl
            });
        } else {
            log.imageUrl = imageUrl;
            log.account = targetAccount;
            log.accountId = targetAccount.id;
        }

        return this.mentalLogRepo.save(log);
    }

    async getMentalLogHistory(userId: string, accountId?: string) {
        let targetAccountIds: string[] = [];
        if (accountId && accountId !== 'all') {
            const acc = await this.accountRepo.findOne({ where: { id: accountId, userId } });
            if (!acc) throw new ForbiddenException('Acesso negado à conta');
            targetAccountIds = [acc.id];
        } else {
            const accounts = await this.accountRepo.find({ where: { userId } });
            targetAccountIds = accounts.map(a => a.id);
        }
        if (targetAccountIds.length === 0) return [];

        return this.mentalLogRepo.find({
            where: {
                accountId: In(targetAccountIds)
            },
            relations: ['account'],
            order: { date: 'DESC', createdAt: 'DESC' },
            take: 30
        });
    }

    async getTechnicalJournal(userId: string, date: string, accountId?: string) {
        let targetAccountId = accountId;
        if (!targetAccountId || targetAccountId === 'all') {
            const primary = await this.getPrimaryAccount(userId);
            if (!primary) return null;
            targetAccountId = primary.id;
        } else {
            const acc = await this.accountRepo.findOne({ where: { id: targetAccountId, userId } });
            if (!acc) throw new ForbiddenException('Acesso negado à conta');
        }

        return this.techJournalRepo.findOne({
            where: { accountId: targetAccountId, date }
        });
    }

    async saveTechnicalJournal(userId: string, date: string, data: Partial<TechnicalJournal>, accountId?: string) {
        let targetAccountId = accountId || data.accountId;
        if (!targetAccountId || targetAccountId === 'all') {
            const primary = await this.getPrimaryAccount(userId);
            if (!primary) throw new NotFoundException('Conta não encontrada');
            targetAccountId = primary.id;
        } else {
            const acc = await this.accountRepo.findOne({ where: { id: targetAccountId, userId } });
            if (!acc) throw new ForbiddenException('Acesso negado à conta');
        }

        let journal = await this.techJournalRepo.findOne({
            where: { accountId: targetAccountId, date }
        });

        if (!journal) {
            journal = this.techJournalRepo.create({
                accountId: targetAccountId,
                date
            });
        }

        // Update fields
        if (data.marketTrend !== undefined) journal.marketTrend = data.marketTrend;
        if (data.volatility !== undefined) journal.volatility = data.volatility;
        if (data.session !== undefined) journal.session = data.session;
        if (data.strategyUsed !== undefined) journal.strategyUsed = data.strategyUsed;
        if (data.mistakes !== undefined) journal.mistakes = data.mistakes;
        if (data.lessons !== undefined) journal.lessons = data.lessons;
        if (data.rating !== undefined) journal.rating = data.rating;
        if (data.notes !== undefined) journal.notes = data.notes;

        // Objective Evaluation Fields
        if (data.entryPrecision !== undefined) journal.entryPrecision = data.entryPrecision;
        if (data.riskManagement !== undefined) journal.riskManagement = data.riskManagement;
        if (data.tradeExit !== undefined) journal.tradeExit = data.tradeExit;
        if (data.emotionalState !== undefined) journal.emotionalState = data.emotionalState;
        if (data.setupQuality !== undefined) journal.setupQuality = data.setupQuality;
        if (data.executionSpeed !== undefined) journal.executionSpeed = data.executionSpeed;
        if (data.marketContext !== undefined) journal.marketContext = data.marketContext;
        if (data.preMarketPrep !== undefined) journal.preMarketPrep = data.preMarketPrep;

        // Subjective Evaluation Fields
        if (data.rulesBroken !== undefined) journal.rulesBroken = data.rulesBroken;
        if (data.actionPlan !== undefined) journal.actionPlan = data.actionPlan;

        return this.techJournalRepo.save(journal);
    }

    async getTradeDetails(userId: string, id: string) {
        const accounts = await this.accountRepo.find({ where: { userId } });
        if (accounts.length === 0) throw new NotFoundException('Conta não encontrada');

        const accountIds = accounts.map(a => a.id);

        let trade: any = null;
        try {
            trade = await this.tradeRepo.findOne({
                where: { id: id, accountId: In(accountIds) }
            });

            if (!trade) {
                trade = await this.tradeRepo.findOne({
                    where: [
                        { ticket: id, accountId: In(accountIds) },
                        { contractId: id, accountId: In(accountIds) }
                    ]
                });
            }
        } catch (e) {
            console.warn(`Initial trade lookup failed for ${id}, trying fallback:`, e);
            try {
                trade = await this.tradeRepo.findOne({
                    where: [
                        { ticket: id, accountId: In(accountIds) },
                        { contractId: id, accountId: In(accountIds) }
                    ]
                });
            } catch (err2) {
                console.warn(`Fallback trade lookup failed:`, err2);
                return null;
            }
        }

        if (!trade) {
            return null;
        }

        // Find sibling trades if this is an option trade
        let siblingTrades: any[] = [];
        if (trade.contractId) {
            siblingTrades = await this.tradeRepo.find({
                where: {
                    contractId: trade.contractId,
                    accountId: trade.accountId
                },
                order: { closeTime: 'ASC' }
            });
        }

        // Get technicalJournal and mentalLog for trade date
        const tradeDate = trade.closeTime
            ? new Date(trade.closeTime).toISOString().split('T')[0]
            : (trade.openTime ? new Date(trade.openTime).toISOString().split('T')[0] : null);

        let technicalJournal = null;
        let mentalLog = null;

        if (tradeDate) {
            technicalJournal = await this.techJournalRepo.findOne({
                where: { accountId: trade.accountId, date: tradeDate }
            });
            if (!technicalJournal && accountIds.length > 0) {
                technicalJournal = await this.techJournalRepo.findOne({
                    where: { accountId: In(accountIds), date: tradeDate }
                });
            }

            mentalLog = await this.mentalLogRepo.findOne({
                where: { accountId: trade.accountId, date: tradeDate }
            });
            if (!mentalLog && accountIds.length > 0) {
                mentalLog = await this.mentalLogRepo.findOne({
                    where: { accountId: In(accountIds), date: tradeDate }
                });
            }
        }

        const tradeObj = {
            ...trade,
            siblings: siblingTrades.filter(s => s.id !== trade.id)
        };

        return {
            ...tradeObj,
            trade: tradeObj,
            technicalJournal,
            mentalLog
        };
    }

    async updateTradeMetadata(userId: string, id: string, data: { session?: string, mood?: string, rating?: number, setup?: string, lesson?: string, tags?: string[] }) {
        const accounts = await this.accountRepo.find({ where: { userId } });
        if (accounts.length === 0) throw new NotFoundException('Conta não encontrada');

        const accountIds = accounts.map(a => a.id);
        let trade: any = null;
        try {
            trade = await this.tradeRepo.findOne({
                where: { id: id, accountId: In(accountIds) }
            });
        } catch (e) {
            // Ignore UUID parse error
        }

        if (!trade) {
            trade = await this.tradeRepo.findOne({
                where: [
                    { ticket: id, accountId: In(accountIds) },
                    { contractId: id, accountId: In(accountIds) }
                ]
            });
        }

        if (!trade) throw new NotFoundException('Trade não encontrado');

        if (data.session !== undefined) trade.session = data.session;
        if (data.mood !== undefined) trade.mood = data.mood;
        if (data.rating !== undefined) trade.rating = data.rating;
        if (data.setup !== undefined) trade.setup = data.setup;
        if (data.lesson !== undefined) trade.lesson = data.lesson;
        if (data.tags !== undefined) trade.tags = data.tags;

        const updated = await this.tradeRepo.save(trade);

        // Sync metadata update to ClickHouse asynchronously
        if (typeof (this.clickHouseService as any)?.updateTradeMetadata === 'function') {
            (this.clickHouseService as any).updateTradeMetadata(trade.id, {
                session: trade.session,
                mood: trade.mood,
                rating: trade.rating,
                setup: trade.setup,
                lesson: trade.lesson,
                tags: trade.tags
            }).catch(err => console.warn(`Failed to sync trade ${trade.id} metadata to ClickHouse:`, err.message));
        }

        return updated;
    }

    async getHeatmapData(userId: string, accountId?: string, endDate?: string) {
        const { accountIds } = await this.validateUserAccount(userId, accountId);
        if (accountIds.length === 0) {
            const emptyHeatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
            return {
                pnl: emptyHeatmap.map((row, day) => row.map((val, hour) => ({ day, hour, val }))),
                counts: emptyHeatmap.map((row, day) => row.map((val, hour) => ({ day, hour, val })))
            };
        }

        const whereClause: any = { accountId: In(accountIds), status: 'CLOSED' };
        if (endDate) {
            whereClause.closeTime = LessThanOrEqual(new Date(endDate));
        }

        const trades = await this.tradeRepo.find({ where: whereClause });

        // Matrix (7 days x 24 hours)
        const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
        const counts = Array.from({ length: 7 }, () => Array(24).fill(0));

        for (const t of trades) {
            if (!t.closeTime) continue;

            const date = new Date(t.closeTime);
            const day = date.getDay(); // 0-6 (Sun-Sat)
            const hour = date.getHours(); // 0-23

            const pnl = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
            heatmap[day][hour] += pnl;
            counts[day][hour] += 1;
        }

        return {
            pnl: heatmap.map((row, day) => row.map((val, hour) => ({ day, hour, val }))),
            counts: counts.map((row, day) => row.map((val, hour) => ({ day, hour, val })))
        };
    }

    async getWeeklySummary(userId: string, accountId?: string) {
        const { accountIds } = await this.validateUserAccount(userId, accountId);
        if (accountIds.length === 0) return null;

        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const trades = await this.tradeRepo.find({
            where: {
                accountId: In(accountIds),
                status: 'CLOSED',
                closeTime: MoreThanOrEqual(oneWeekAgo)
            }
        });

        const totalPnL = trades.reduce((sum, t) => sum + (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0), 0);
        const winRate = trades.length > 0 ? (trades.filter(t => (Number(t.profit) || 0) > 0).length / trades.length) * 100 : 0;

        // Group by lessons (mistakes)
        const lessonsMap = new Map<string, number>();
        trades.forEach(t => {
            if (t.lesson) {
                lessonsMap.set(t.lesson, (lessonsMap.get(t.lesson) || 0) + 1);
            }
        });

        const topLessons = Array.from(lessonsMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([lesson, count]) => ({ lesson, count }));

        return {
            totalPnL,
            winRate,
            totalTrades: trades.length,
            topLessons,
            period: {
                start: oneWeekAgo.toISOString(),
                end: new Date().toISOString()
            }
        };
    }

    async invalidateUserCache(userId: string) {
        try {
            const store = (this.cacheManager as any)?.store;
            let keys: string[] = [];
            if (store && typeof store.keys === 'function') {
                keys = await store.keys(`*dashboard:*:${userId}:*`);
            } else if (store?.getClient && typeof store.getClient === 'function') {
                const redis = store.getClient();
                if (typeof redis.keys === 'function') {
                    keys = await redis.keys(`*dashboard:*:${userId}:*`);
                }
            }
            if (keys && keys.length > 0) {
                for (const key of keys) {
                    await this.cacheManager.del(key);
                }
            }
            if ((!keys || keys.length === 0) && store && typeof store.reset === 'function') {
                await store.reset();
            }
        } catch (e) {
            console.warn(`[DashboardService] Cache invalidation warning for user ${userId}:`, e.message);
        }
    }

    async getReportData(userId: string, accountId?: string, startDate?: string, endDate?: string, symbolFilter?: string, typeFilter?: string) {
        const { accountIds, accounts, isConsolidated, targetAccount } = await this.validateUserAccount(userId, accountId);
        if (accountIds.length === 0) {
            return {
                accountInfo: null,
                kpis: null,
                equityCurve: [],
                dailyPnL: [],
                bySymbol: [],
                bySession: [],
                byDayOfWeek: [],
                trades: []
            };
        }

        const whereClause: any = { accountId: In(accountIds), status: 'CLOSED' };
        if (startDate && endDate) {
            whereClause.closeTime = Between(new Date(startDate), new Date(endDate));
        } else if (startDate) {
            whereClause.closeTime = MoreThanOrEqual(new Date(startDate));
        } else if (endDate) {
            whereClause.closeTime = LessThanOrEqual(new Date(endDate));
        }

        if (symbolFilter && symbolFilter !== 'ALL') {
            whereClause.symbol = symbolFilter;
        }
        if (typeFilter && typeFilter !== 'ALL') {
            whereClause.type = typeFilter;
        }

        const rawTrades = await this.tradeRepo.find({
            where: whereClause,
            order: { closeTime: 'ASC' }
        });

        // Calculate KPIs
        let grossProfit = 0;
        let grossLoss = 0;
        let totalNetProfit = 0;
        let wins = 0;
        let losses = 0;
        let breakevens = 0;
        let totalVolume = 0;
        let totalCommission = 0;
        let totalSwap = 0;
        let largestWin = 0;
        let largestLoss = 0;

        let peakEquity = 0;
        let currentEquity = 0;
        let maxDrawdown = 0;

        const equityCurve: any[] = [];
        const dailyMap = new Map<string, { date: string, pnl: number, trades: number, wins: number, losses: number }>();
        const symbolMap = new Map<string, { symbol: string, trades: number, wins: number, losses: number, pnl: number, volume: number }>();
        const sessionMap = new Map<string, { session: string, trades: number, wins: number, pnl: number }>();
        const dayOfWeekMap = new Map<string, { day: string, trades: number, wins: number, pnl: number }>();

        const daysNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        for (let i = 1; i <= 5; i++) {
            dayOfWeekMap.set(daysNames[i], { day: daysNames[i], trades: 0, wins: 0, pnl: 0 });
        }

        const accMap = new Map(accounts.map(a => [a.id, a]));
        const startBalance = isConsolidated 
            ? accounts.reduce((sum, a) => sum + Number(a.initialBalance || a.balance || 0), 0)
            : Number(targetAccount?.initialBalance || targetAccount?.balance || 0);

        let runningBalance = startBalance;

        for (const t of rawTrades) {
            const profit = Number(t.profit) || 0;
            const comm = Number(t.commission) || 0;
            const swap = Number(t.swap) || 0;
            const vol = Number(t.volume) || 0;
            const netPnl = profit + comm + swap;

            totalNetProfit += netPnl;
            totalVolume += vol;
            totalCommission += comm;
            totalSwap += swap;

            if (netPnl > 0) {
                wins++;
                grossProfit += netPnl;
                if (netPnl > largestWin) largestWin = netPnl;
            } else if (netPnl < 0) {
                losses++;
                grossLoss += Math.abs(netPnl);
                if (netPnl < largestLoss) largestLoss = netPnl;
            } else {
                breakevens++;
            }

            // Drawdown & Equity Curve
            currentEquity += netPnl;
            runningBalance += netPnl;
            if (currentEquity > peakEquity) peakEquity = currentEquity;
            const dd = peakEquity - currentEquity;
            if (dd > maxDrawdown) maxDrawdown = dd;

            const closeDateStr = t.closeTime ? new Date(t.closeTime).toISOString().split('T')[0] : 'N/A';
            const closeTimeStr = t.closeTime ? new Date(t.closeTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

            equityCurve.push({
                date: closeDateStr,
                time: closeTimeStr,
                ticket: t.ticket || t.id,
                pnl: Number(netPnl.toFixed(2)),
                cumulativePnL: Number(totalNetProfit.toFixed(2)),
                balance: Number(runningBalance.toFixed(2))
            });

            // Daily PnL
            if (closeDateStr !== 'N/A') {
                const dayItem = dailyMap.get(closeDateStr) || { date: closeDateStr, pnl: 0, trades: 0, wins: 0, losses: 0 };
                dayItem.pnl += netPnl;
                dayItem.trades += 1;
                if (netPnl > 0) dayItem.wins += 1;
                else if (netPnl < 0) dayItem.losses += 1;
                dailyMap.set(closeDateStr, dayItem);
            }

            // By Symbol
            const sym = t.symbol || 'OTHER';
            const symItem = symbolMap.get(sym) || { symbol: sym, trades: 0, wins: 0, losses: 0, pnl: 0, volume: 0 };
            symItem.trades += 1;
            symItem.volume += vol;
            symItem.pnl += netPnl;
            if (netPnl > 0) symItem.wins += 1;
            else if (netPnl < 0) symItem.losses += 1;
            symbolMap.set(sym, symItem);

            // By Session
            const sess = t.session || 'General';
            const sessItem = sessionMap.get(sess) || { session: sess, trades: 0, wins: 0, pnl: 0 };
            sessItem.trades += 1;
            sessItem.pnl += netPnl;
            if (netPnl > 0) sessItem.wins += 1;
            sessionMap.set(sess, sessItem);

            // By Day of Week
            if (t.closeTime) {
                const dayIndex = new Date(t.closeTime).getDay();
                const dayName = daysNames[dayIndex];
                if (dayOfWeekMap.has(dayName)) {
                    const dItem = dayOfWeekMap.get(dayName)!;
                    dItem.trades += 1;
                    dItem.pnl += netPnl;
                    if (netPnl > 0) dItem.wins += 1;
                }
            }
        }

        const totalTrades = rawTrades.length;
        const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0;
        const profitFactor = grossLoss === 0 ? Number(grossProfit.toFixed(2)) : Number((grossProfit / grossLoss).toFixed(2));
        const averageWin = wins > 0 ? Number((grossProfit / wins).toFixed(2)) : 0;
        const averageLoss = losses > 0 ? Number((grossLoss / losses).toFixed(2)) : 0;
        const riskRewardRatio = averageLoss > 0 ? Number((averageWin / averageLoss).toFixed(2)) : 0;
        const expectancy = totalTrades > 0 ? Number((totalNetProfit / totalTrades).toFixed(2)) : 0;
        const maxDrawdownPercent = (startBalance + peakEquity) > 0 ? Number(((maxDrawdown / (startBalance + peakEquity)) * 100).toFixed(1)) : 0;

        const kpis = {
            totalTrades,
            wins,
            losses,
            breakevens,
            winRate,
            netProfit: Number(totalNetProfit.toFixed(2)),
            grossProfit: Number(grossProfit.toFixed(2)),
            grossLoss: Number(grossLoss.toFixed(2)),
            profitFactor,
            averageWin,
            averageLoss,
            riskRewardRatio,
            expectancy,
            maxDrawdown: Number(maxDrawdown.toFixed(2)),
            maxDrawdownPercent,
            largestWin: Number(largestWin.toFixed(2)),
            largestLoss: Number(largestLoss.toFixed(2)),
            totalVolume: Number(totalVolume.toFixed(2)),
            totalCommission: Number(totalCommission.toFixed(2)),
            totalSwap: Number(totalSwap.toFixed(2)),
            initialBalance: startBalance,
            currentBalance: Number(runningBalance.toFixed(2)),
            roi: startBalance > 0 ? Number(((totalNetProfit / startBalance) * 100).toFixed(2)) : 0
        };

        const bySymbol = Array.from(symbolMap.values()).map(s => ({
            ...s,
            pnl: Number(s.pnl.toFixed(2)),
            volume: Number(s.volume.toFixed(2)),
            winRate: s.trades > 0 ? Number(((s.wins / s.trades) * 100).toFixed(1)) : 0
        })).sort((a, b) => b.pnl - a.pnl);

        const bySession = Array.from(sessionMap.values()).map(s => ({
            ...s,
            pnl: Number(s.pnl.toFixed(2)),
            winRate: s.trades > 0 ? Number(((s.wins / s.trades) * 100).toFixed(1)) : 0
        }));

        const byDayOfWeek = Array.from(dayOfWeekMap.values()).map(d => ({
            ...d,
            pnl: Number(d.pnl.toFixed(2)),
            winRate: d.trades > 0 ? Number(((d.wins / d.trades) * 100).toFixed(1)) : 0
        }));

        const dailyPnL = Array.from(dailyMap.values()).map(d => ({
            ...d,
            pnl: Number(d.pnl.toFixed(2)),
            winRate: d.trades > 0 ? Number(((d.wins / d.trades) * 100).toFixed(1)) : 0
        })).sort((a, b) => a.date.localeCompare(b.date));

        const enrichedLedger = rawTrades.map(t => {
            const acc = accMap.get(t.accountId);
            const net = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
            return {
                id: t.id,
                ticket: t.ticket || t.id,
                symbol: t.symbol,
                type: t.type,
                volume: Number(t.volume) || 0,
                openPrice: Number(t.openPrice) || 0,
                closePrice: Number(t.closePrice) || 0,
                sl: t.sl !== null ? Number(t.sl) : null,
                tp: t.tp !== null ? Number(t.tp) : null,
                profit: Number(t.profit) || 0,
                commission: Number(t.commission) || 0,
                swap: Number(t.swap) || 0,
                netPnl: Number(net.toFixed(2)),
                openTime: t.openTime,
                closeTime: t.closeTime,
                session: t.session || 'General',
                mood: t.mood,
                rating: t.rating,
                setup: t.setup,
                accountName: acc?.name || 'Conta',
                accountBroker: acc?.broker || 'Corretora',
                accountType: acc?.type || 'LIVE'
            };
        }).reverse();

        return {
            accountInfo: {
                id: isConsolidated ? 'all' : targetAccount?.id,
                name: isConsolidated ? 'Todas as Contas (Consolidado)' : targetAccount?.name,
                broker: isConsolidated ? 'Multi-Corretora' : targetAccount?.broker,
                type: isConsolidated ? 'CONSOLIDATED' : targetAccount?.type,
                currency: isConsolidated ? 'USD' : (targetAccount?.currency || 'USD'),
                accounts: accounts.map(a => ({ id: a.id, name: a.name, broker: a.broker, type: a.type, currency: a.currency }))
            },
            kpis,
            equityCurve,
            dailyPnL,
            bySymbol,
            bySession,
            byDayOfWeek,
            trades: enrichedLedger
        };
    }

    async simulateBacktest(userId: string, accountId: string, config: any) {
        const { accounts, targetAccount, isConsolidated } = await this.validateUserAccount(userId, accountId);
        const mode = config?.mode || 'ACCOUNT_HISTORY';

        const accountIds = isConsolidated ? accounts.map(a => a.id) : [targetAccount.id];
        const initialBalance = Number(config?.initialBalance) || Number(targetAccount?.initialBalance || targetAccount?.balance || 10000);

        if (mode === 'ACCOUNT_HISTORY') {
            const rawTrades = await this.tradeRepo.find({
                where: { accountId: In(accountIds), status: 'CLOSED' },
                order: { closeTime: 'ASC' }
            });

            if (rawTrades.length === 0) {
                return {
                    mode,
                    message: 'Nenhuma operação encontrada nesta conta para executar a simulação What-If.',
                    stats: null,
                    comparison: null,
                    equityCurve: [],
                    tradeLog: []
                };
            }

            const riskPercent = Number(config?.riskPerTrade) || 1.0;
            const rrTarget = Number(config?.rrTarget) || 2.0;
            const excludeAsian = Boolean(config?.excludeAsian);
            const excludeFridays = Boolean(config?.excludeFridays);

            let simEquity = initialBalance;
            let realEquity = initialBalance;
            let simWins = 0;
            let simLosses = 0;
            let simGrossProfit = 0;
            let simGrossLoss = 0;
            let realNetProfit = 0;
            let simPeakEquity = initialBalance;
            let simMaxDrawdown = 0;

            const equityCurve: any[] = [];
            const simulatedTradeLog: any[] = [];

            for (const t of rawTrades) {
                const origPnl = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
                realNetProfit += origPnl;
                realEquity += origPnl;

                const closeDate = t.closeTime ? new Date(t.closeTime) : null;
                const isAsian = (t.session || '').toLowerCase() === 'asian';
                const isFriday = closeDate ? closeDate.getDay() === 5 : false;

                if (excludeAsian && isAsian) continue;
                if (excludeFridays && isFriday) continue;

                const riskAmount = simEquity * (riskPercent / 100);
                let simulatedPnl = 0;

                if (origPnl > 0) {
                    simulatedPnl = riskAmount * rrTarget;
                    simWins++;
                    simGrossProfit += simulatedPnl;
                } else if (origPnl < 0) {
                    simulatedPnl = -riskAmount;
                    simLosses++;
                    simGrossLoss += riskAmount;
                }

                simEquity += simulatedPnl;
                if (simEquity > simPeakEquity) simPeakEquity = simEquity;
                const dd = simPeakEquity - simEquity;
                if (dd > simMaxDrawdown) simMaxDrawdown = dd;

                const dateStr = closeDate ? closeDate.toISOString().split('T')[0] : 'N/A';
                equityCurve.push({
                    date: dateStr,
                    ticket: t.ticket || t.id,
                    realEquity: Number(realEquity.toFixed(2)),
                    simulatedEquity: Number(simEquity.toFixed(2)),
                    realPnl: Number(origPnl.toFixed(2)),
                    simulatedPnl: Number(simulatedPnl.toFixed(2))
                });

                simulatedTradeLog.push({
                    ticket: t.ticket || t.id,
                    symbol: t.symbol,
                    type: t.type,
                    date: dateStr,
                    realPnl: Number(origPnl.toFixed(2)),
                    simulatedPnl: Number(simulatedPnl.toFixed(2)),
                    status: simulatedPnl >= 0 ? 'WIN' : 'LOSS'
                });
            }

            const simTotalTrades = simWins + simLosses;
            const simWinRate = simTotalTrades > 0 ? Number(((simWins / simTotalTrades) * 100).toFixed(1)) : 0;
            const simProfitFactor = simGrossLoss === 0 ? Number(simGrossProfit.toFixed(2)) : Number((simGrossProfit / simGrossLoss).toFixed(2));
            const simNetProfit = Number((simEquity - initialBalance).toFixed(2));
            const simMaxDdPercent = simPeakEquity > 0 ? Number(((simMaxDrawdown / simPeakEquity) * 100).toFixed(1)) : 0;

            const comparison = {
                realNetProfit: Number(realNetProfit.toFixed(2)),
                simulatedNetProfit: simNetProfit,
                profitDelta: Number((simNetProfit - realNetProfit).toFixed(2)),
                realTrades: rawTrades.length,
                simulatedTrades: simTotalTrades,
                simulatedWinRate: simWinRate,
                simulatedProfitFactor: simProfitFactor,
                simulatedMaxDrawdown: Number(simMaxDrawdown.toFixed(2)),
                simulatedMaxDrawdownPercent: simMaxDdPercent,
                finalBalance: Number(simEquity.toFixed(2)),
                initialBalance
            };

            const insights: string[] = [];
            if (simNetProfit > realNetProfit) {
                insights.push(`A regra simulada aumentou o resultado da conta em +$${(simNetProfit - realNetProfit).toFixed(2)}.`);
            } else {
                insights.push(`O desempenho real da conta superou a regra estática de simulação.`);
            }
            if (excludeAsian) {
                insights.push(`A filtragem da sessão Asiática protegeu a curva contra ruídos noturnos.`);
            }
            if (rrTarget >= 2) {
                insights.push(`A relação R:R de 1:${rrTarget} gerou expectativa matemática fortemente positiva.`);
            }

            return {
                mode: 'ACCOUNT_HISTORY',
                accountName: targetAccount?.name || 'Conta',
                accountCurrency: targetAccount?.currency || 'USD',
                config,
                comparison,
                equityCurve,
                tradeLog: simulatedTradeLog.slice(-50),
                insights
            };
        } else {
            // Strategy Sim
            const symbol = config?.symbol || 'EURUSD';
            const strategy = config?.strategy || 'MACD Cross';
            const totalSimTrades = Number(config?.totalTrades) || 40;
            const winRateTarget = Number(config?.targetWinRate) || 55;
            const rr = Number(config?.rrTarget) || 2.0;
            const riskPercent = Number(config?.riskPerTrade) || 1.5;

            let equity = initialBalance;
            let peakEquity = initialBalance;
            let maxDrawdown = 0;
            let wins = 0;
            let losses = 0;
            let grossProfit = 0;
            let grossLoss = 0;

            const equityCurve: any[] = [];
            const tradeLog: any[] = [];
            const today = new Date();

            for (let i = 0; i < totalSimTrades; i++) {
                const tradeDate = new Date(today);
                tradeDate.setDate(tradeDate.getDate() - (totalSimTrades - i));
                const dateStr = tradeDate.toISOString().split('T')[0];

                const riskAmount = equity * (riskPercent / 100);
                const isWin = ((i * 37 + 13) % 100) < winRateTarget;
                let pnl = 0;

                if (isWin) {
                    pnl = riskAmount * rr;
                    wins++;
                    grossProfit += pnl;
                } else {
                    pnl = -riskAmount;
                    losses++;
                    grossLoss += riskAmount;
                }

                equity += pnl;
                if (equity > peakEquity) peakEquity = equity;
                const dd = peakEquity - equity;
                if (dd > maxDrawdown) maxDrawdown = dd;

                equityCurve.push({
                    date: dateStr,
                    trade: i + 1,
                    pnl: Number(pnl.toFixed(2)),
                    equity: Number(equity.toFixed(2))
                });

                tradeLog.push({
                    ticket: 100000 + i,
                    symbol,
                    type: i % 2 === 0 ? 'BUY' : 'SELL',
                    date: dateStr,
                    pnl: Number(pnl.toFixed(2)),
                    status: isWin ? 'WIN' : 'LOSS'
                });
            }

            const winRate = Number(((wins / totalSimTrades) * 100).toFixed(1));
            const profitFactor = grossLoss === 0 ? Number(grossProfit.toFixed(2)) : Number((grossProfit / grossLoss).toFixed(2));
            const netProfit = Number((equity - initialBalance).toFixed(2));
            const maxDdPercent = peakEquity > 0 ? Number(((maxDrawdown / peakEquity) * 100).toFixed(1)) : 0;

            return {
                mode: 'STRATEGY_SIM',
                accountName: targetAccount?.name || 'Conta',
                accountCurrency: targetAccount?.currency || 'USD',
                config,
                comparison: {
                    initialBalance,
                    finalBalance: Number(equity.toFixed(2)),
                    simulatedNetProfit: netProfit,
                    simulatedTrades: totalSimTrades,
                    simulatedWinRate: winRate,
                    simulatedProfitFactor: profitFactor,
                    simulatedMaxDrawdown: Number(maxDrawdown.toFixed(2)),
                    simulatedMaxDrawdownPercent: maxDdPercent
                },
                equityCurve,
                tradeLog: tradeLog.slice(-50),
                insights: [
                    `Estratégia ${strategy} em ${symbol} obteve taxa de acerto de ${winRate}%.`,
                    `Fator de Lucro: ${profitFactor} com rebaixamento máximo de ${maxDdPercent}%.`,
                    `Retorno projetado sobre a conta: ${(((equity - initialBalance) / initialBalance) * 100).toFixed(1)}%.`
                ]
            };
        }
    }

    async saveBacktestSession(userId: string, data: any) {
        let accountId = data.accountId;
        if (!accountId || accountId === 'all') {
            const primary = await this.getPrimaryAccount(userId);
            accountId = primary?.id;
        }

        const session = this.backtestRepo.create({
            userId,
            accountId,
            name: data.name || `Simulação - ${new Date().toLocaleDateString('pt-BR')}`,
            mode: data.mode || 'ACCOUNT_HISTORY',
            strategy: data.strategy || 'What-If Optimization',
            symbol: data.symbol || 'ALL',
            config: data.config || {},
            results: data.results || {},
            notes: data.notes || ''
        });

        return this.backtestRepo.save(session);
    }

    async getBacktestHistory(userId: string, accountId?: string) {
        let targetAccountIds: string[] = [];
        if (accountId && accountId !== 'all') {
            const acc = await this.accountRepo.findOne({ where: { id: accountId, userId } });
            if (!acc) throw new ForbiddenException('Acesso negado à conta');
            targetAccountIds = [acc.id];
        } else {
            const accounts = await this.accountRepo.find({ where: { userId } });
            targetAccountIds = accounts.map(a => a.id);
        }

        if (targetAccountIds.length === 0) return [];

        return this.backtestRepo.find({
            where: {
                userId,
                accountId: In(targetAccountIds)
            },
            relations: ['account'],
            order: { createdAt: 'DESC' },
            take: 20
        });
    }
}
