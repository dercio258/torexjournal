import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual, In } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { TradeEntity } from '../mt5/trade.entity';
import { AccountEntity } from '../account/account.entity';
import { MentalLog } from './mental-log.entity';
import { TechnicalJournal } from './technical-journal.entity';
import { ClickHouseService } from '../clickhouse/clickhouse.service';

@Injectable()
export class DashboardService {
    constructor(
        @InjectRepository(TradeEntity)
        private tradeRepo: Repository<TradeEntity>,
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
        @InjectRepository(MentalLog)
        private mentalLogRepo: Repository<MentalLog>,
        @InjectRepository(TechnicalJournal)
        private techJournalRepo: Repository<TechnicalJournal>,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private clickHouseService: ClickHouseService
    ) { }

    private async getPrimaryAccount(userId: string) {
        const account = await this.accountRepo.findOne({
            where: { userId },
            order: { lastSeen: 'DESC' } // Prefer the most recently active
        });
        return account;
    }

    async getTrades(userId: string, endDate?: string) {
        const cacheKey = `dashboard:trades:${userId}:${endDate || 'all'}`;
        try {
            const cached = await this.cacheManager.get<any[]>(cacheKey);
            if (cached) {
                return cached;
            }
        } catch (err) {
            console.warn(`[DashboardService] Cache get failed for trades: ${err.message}`);
        }

        const accounts = await this.accountRepo.find({ where: { userId } });
        if (accounts.length === 0) return [];

        const accountIds = accounts.map(a => a.id);
        const whereClause: any = { accountId: In(accountIds), status: 'CLOSED' };
        if (endDate) {
            whereClause.closeTime = LessThanOrEqual(new Date(endDate));
        }

        const trades = await this.tradeRepo.find({
            where: whereClause,
            order: { closeTime: 'DESC' },
            take: 100
        });

        try {
            await this.cacheManager.set(cacheKey, trades, 300000); // 5 minutes cache
        } catch (err) {
            console.warn(`[DashboardService] Cache set failed for trades: ${err.message}`);
        }
        return trades;
    }

    async getPerformance(userId: string, startDate?: string, endDate?: string) {
        const cacheKey = `dashboard:performance:${userId}:${startDate || 'all'}:${endDate || 'all'}`;
        try {
            const cached = await this.cacheManager.get(cacheKey);
            if (cached) {
                return cached;
            }
        } catch (err) {
            console.warn(`[DashboardService] Cache get failed for performance: ${err.message}`);
        }

        try {
            const accounts = await this.accountRepo.find({ where: { userId } });
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
                    bySession: []
                };
            }

            const accountIds = accounts.map(a => a.id);
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
                    FROM trades 
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
                console.warn('ClickHouse query failed, falling back to PostgreSQL:', clickhouseErr.message);
                trades = await this.tradeRepo.find({
                    where: whereClause,
                    order: { closeTime: 'ASC' }
                });
            }

            const dailyMap = new Map<string, number>();
            const moodMap = new Map<string, { count: number; pnl: number }>();
            const setupMap = new Map<string, { count: number; pnl: number }>();
            const sessionMap = new Map<string, { count: number; pnl: number }>();

            const totalTrades = trades.length;
            if (totalTrades === 0) {
                // return empty...
                return {
                    totalPnL: 0, winRate: 0, totalTrades: 0, profitFactor: 0,
                    radarMetrics: { consistency: 0, riskManagement: 0, discipline: 0, profitability: 0, winRate: 0 },
                    dailyPnL: [], tradePnL: [], byMood: [], bySetup: [], bySession: []
                };
            }

            let totalPnL = 0;
            let wins = 0;
            let losses = 0;
            let breakevens = 0;
            let grossProfit = 0;
            let grossLoss = 0;

            for (const t of trades) {
                if (!t.closeTime) continue;

                const profit = Number(t.profit) || 0;
                const commission = Number(t.commission) || 0;
                const swap = Number(t.swap) || 0;
                const pnl = profit + commission + swap;
                totalPnL += pnl;

                // Define BE as +/- 0.5 cents/pips to be safe with commissions
                if (pnl > 0.1) {
                    wins++;
                    grossProfit += pnl;
                } else if (pnl < -0.1) {
                    losses++;
                    grossLoss += Math.abs(pnl);
                } else {
                    breakevens++;
                }

                try {
                    const dateStr = new Date(t.closeTime).toISOString().split('T')[0];
                    dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + pnl);
                } catch (e) {
                    console.warn(`Invalid closeTime for trade ${t.ticket}: ${t.closeTime}`);
                }

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
            const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;

            const radarMetrics = {
                consistency: 75,
                riskManagement: profitFactor > 1.5 ? 90 : 60,
                discipline: 80,
                profitability: totalPnL > 0 ? 85 : 40,
                winRate: winRate
            };

            const result = {
                totalPnL,
                winRate,
                totalTrades,
                profitFactor,
                radarMetrics,
                dailyPnL: Array.from(dailyMap.entries()).map(([date, pnl]) => ({ date, pnl })),
                tradePnL: trades.map(t => ({
                    date: t.closeTime ? new Date(t.closeTime).toISOString() : null,
                    value: (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0),
                    ticket: t.ticket
                })),
                distribution: { wins, losses, breakeven: breakevens },
                byMood: Array.from(moodMap.entries()).map(([mood, data]) => ({ mood, ...data })),
                bySetup: Array.from(setupMap.entries()).map(([setup, data]) => ({ setup, ...data })),
                bySession: Array.from(sessionMap.entries()).map(([session, data]) => ({ session, ...data }))
            };

            try {
                await this.cacheManager.set(cacheKey, result, 300000); // 5 minutes
            } catch (err) {
                console.warn(`[DashboardService] Cache set failed for performance: ${err.message}`);
            }

            return result;

        } catch (error) {
            console.error('getPerformance error:', error);
            return {
                totalPnL: 0, winRate: 0, totalTrades: 0, profitFactor: 0,
                radarMetrics: { consistency: 0, riskManagement: 0, discipline: 0, profitability: 0, winRate: 0 },
                dailyPnL: [], tradePnL: [], byMood: [], bySetup: [], bySession: []
            };
        }
    }

    async saveMentalLog(userId: string, data: Partial<MentalLog>) {
        const account = await this.getPrimaryAccount(userId);
        if (!account) throw new Error('Account not found');

        const dateStr = new Date().toISOString().split('T')[0];
        // If session is provided, find by date+session. If not, default to no session or 'General'.
        const searchCriteria: any = { accountId: account.id, date: dateStr };
        if (data.session) {
            searchCriteria.session = data.session;
        }

        let log = await this.mentalLogRepo.findOne({
            where: searchCriteria
        });

        if (!log) {
            log = this.mentalLogRepo.create({
                accountId: account.id,
                date: dateStr,
                session: data.session || 'General', // Default if not provided
                time: data.time || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            });
        }

        if (data.sleepQuality !== undefined) log.sleepQuality = data.sleepQuality;
        if (data.energy !== undefined) log.energy = data.energy;
        if (data.focus !== undefined) log.focus = data.focus;
        if (data.mood !== undefined) log.mood = data.mood;
        if (data.stress !== undefined) log.stress = data.stress;
        if (data.caffeine !== undefined) log.caffeine = data.caffeine;
        if (data.notes !== undefined) log.notes = data.notes;
        if (data.time !== undefined) log.time = data.time;
        if (data.session !== undefined) log.session = data.session;

        const s = log.sleepQuality || 5;
        const e = log.energy || 5;
        const f = log.focus || 5;
        const m = log.mood || 5;
        const st = log.stress || 5;

        const scoreVal = (s + e + f + m + (10 - st)) / 5;
        log.overallScore = parseFloat((scoreVal * 10).toFixed(1));

        return this.mentalLogRepo.save(log);
    }

    async saveMentalLogImage(userId: string, imageUrl: string, session?: string) {
        const account = await this.getPrimaryAccount(userId);
        if (!account) throw new Error('Account not found');

        const dateStr = new Date().toISOString().split('T')[0];

        const searchCriteria: any = { accountId: account.id, date: dateStr };
        if (session) {
            searchCriteria.session = session;
        }

        // If session not provided, we might grab the WRONG log if multiple exist.
        // But for backward compatibility we try to find one.
        // Ideally frontend always sends session.
        let log = await this.mentalLogRepo.findOne({
            where: searchCriteria,
            order: { updatedAt: 'DESC' } // Try to get the latest manipulated one
        });

        if (log) {
            log.imageUrl = imageUrl;
            return this.mentalLogRepo.save(log);
        }
    }

    async getTodayMentalLog(userId: string, session?: string) {
        const account = await this.getPrimaryAccount(userId);
        if (!account) throw new Error('Account not found');

        const dateStr = new Date().toISOString().split('T')[0];

        const searchCriteria: any = { accountId: account.id, date: dateStr };
        if (session) {
            searchCriteria.session = session;
        }

        const log = await this.mentalLogRepo.findOne({
            where: searchCriteria,
            order: { updatedAt: 'DESC' } // Get latest if multiple matches (e.g. duplicating sessions?)
        });

        if (!log) {
            // Return default structure if no log exists yet for this session
            return {
                date: dateStr,
                session: session || '',
                sleepQuality: 5,
                energy: 5,
                focus: 5,
                mood: 5,
                stress: 5,
                caffeine: 1,
                notes: '',
                overallScore: 50
            };
        }

        return log;
    }

    async getMentalLogHistory(userId: string) {
        const accounts = await this.accountRepo.find({ where: { userId } });
        if (accounts.length === 0) throw new Error('Account not found');

        return this.mentalLogRepo.find({
            where: { accountId: In(accounts.map(a => a.id)) },
            order: { date: 'DESC' },
            take: 50
        });
    }

    async getTechnicalJournal(userId: string, date: string) {
        const accounts = await this.accountRepo.find({ where: { userId } });
        if (accounts.length === 0) throw new Error('Account not found');

        return this.techJournalRepo.findOne({
            where: { accountId: In(accounts.map(a => a.id)), date }
        });
    }

    async createTechnicalJournal(
        userId: string,
        date: string,
        marketTrend: string,
        volatility: string,
        session: string,
        strategyUsed: string,
        mistakes: string,
        lessons: string,
        rating: number,
        notes: string,
        entryPrecision?: string,
        riskManagement?: string,
        tradeExit?: string,
        emotionalState?: string
    ) {
        const account = await this.getPrimaryAccount(userId);
        if (!account) throw new Error('Account not found');

        let journal = await this.techJournalRepo.findOne({
            where: {
                account: { id: account.id },
                date: date
            }
        });

        if (journal) {
            journal.marketTrend = marketTrend;
            journal.volatility = volatility;
            journal.session = session;
            journal.strategyUsed = strategyUsed;
            journal.mistakes = mistakes;
            journal.lessons = lessons;
            journal.rating = rating;
            journal.notes = notes;
            if (entryPrecision !== undefined) journal.entryPrecision = entryPrecision;
            if (riskManagement !== undefined) journal.riskManagement = riskManagement;
            if (tradeExit !== undefined) journal.tradeExit = tradeExit;
            if (emotionalState !== undefined) journal.emotionalState = emotionalState;
        } else {
            journal = this.techJournalRepo.create({
                account,
                date,
                marketTrend,
                volatility,
                session,
                strategyUsed,
                mistakes,
                lessons,
                rating,
                notes,
                entryPrecision,
                riskManagement,
                tradeExit,
                emotionalState
            });
        }

        return this.techJournalRepo.save(journal);
    }

    async saveTechnicalJournal(userId: string, date: string, data: Partial<TechnicalJournal>) {
        const account = await this.getPrimaryAccount(userId);
        if (!account) throw new Error('Account not found');

        let journal = await this.techJournalRepo.findOne({
            where: { accountId: account.id, date }
        });

        if (!journal) {
            journal = this.techJournalRepo.create({
                accountId: account.id,
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
        if (accounts.length === 0) throw new Error('Account not found');

        let trade;
        try {
            trade = await this.tradeRepo.findOne({
                where: { id: id, accountId: In(accounts.map(a => a.id)) }
            });
        } catch (e) {
            console.warn(`Invalid trade ID format for fetch: ${id}`);
            return null;
        }

        if (!trade) {
            return null;
        }

        // Determine date for journal lookup (use closeTime if available, else openTime)
        const dateRef = trade.closeTime ? trade.closeTime : trade.openTime;
        const dateStr = dateRef.toISOString().split('T')[0];

        const [technicalJournal, mentalLog] = await Promise.all([
            this.techJournalRepo.findOne({ where: { accountId: trade.accountId, date: dateStr } }),
            this.mentalLogRepo.findOne({ where: { accountId: trade.accountId, date: dateStr } })
        ]);

        return {
            trade,
            technicalJournal,
            mentalLog
        };
    }

    async updateTradeMetadata(userId: string, tradeId: string, data: Partial<TradeEntity>) {
        const accounts = await this.accountRepo.find({ where: { userId } });
        if (accounts.length === 0) throw new Error('Account not found');

        const trade = await this.tradeRepo.findOne({
            where: { id: tradeId, accountId: In(accounts.map(a => a.id)) }
        });

        if (!trade) throw new Error('Trade not found or unauthorized');

        // Whitelist fields that can be updated
        if (data.mood !== undefined) trade.mood = data.mood;
        if (data.setup !== undefined) trade.setup = data.setup;
        if (data.rating !== undefined) trade.rating = data.rating;
        if (data.lesson !== undefined) trade.lesson = data.lesson;
        if (data.tags !== undefined) trade.tags = data.tags;

        const saved = await this.tradeRepo.save(trade);
        
        // Invalidate cache since performance metrics might change
        await this.invalidateUserCache(userId);
        
        return saved;
    }

    async invalidateUserCache(userId: string) {
        // Log it
        console.log(`[DashboardService] Invalidation triggered for user ${userId}`);

        // 1. Try to delete by pattern if supported by cache store (Redis/Memory)
        const store = (this.cacheManager as any).store;
        if (store && typeof store.keys === 'function') {
            try {
                const keys = await store.keys(`*:${userId}:*`);
                if (keys && keys.length > 0) {
                    for (const key of keys) {
                        await this.cacheManager.del(key);
                    }
                    console.log(`[DashboardService] Deleted ${keys.length} pattern-matched cache keys.`);
                    return;
                }
            } catch (err) {
                console.warn('[DashboardService] Pattern-based cache invalidation failed:', err.message);
            }
        }

        // 2. Fallback to explicit deletion of common keys
        const commonKeys = [
            `dashboard:performance:${userId}:all:all`,
            `dashboard:trades:${userId}:all`
        ];
        for (const key of commonKeys) {
            await this.cacheManager.del(key);
        }
        console.log(`[DashboardService] Cleaned default common cache keys.`);
    }

    async getHeatmapData(userId: string, endDate?: string) {
        const accounts = await this.accountRepo.find({ where: { userId } });
        if (accounts.length === 0) return { pnl: [], counts: [] };

        const whereClause: any = { accountId: In(accounts.map(a => a.id)), status: 'CLOSED' };
        if (endDate) {
            whereClause.closeTime = LessThanOrEqual(new Date(endDate));
        }

        const trades = await this.tradeRepo.find({
            where: whereClause
        });

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

    async getWeeklySummary(userId: string) {
        const accounts = await this.accountRepo.find({ where: { userId } });
        if (accounts.length === 0) return null;

        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const trades = await this.tradeRepo.find({
            where: { 
                accountId: In(accounts.map(a => a.id)), 
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
}
