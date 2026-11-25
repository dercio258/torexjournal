import { Injectable, Inject, Optional, ForbiddenException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual, In, Not } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { TradeEntity } from '../mt5/trade.entity';
import { PositionEntity } from '../mt5/position.entity';
import { AccountEntity, AccountType } from '../account/account.entity';
import { MentalLog } from './mental-log.entity';
import { TechnicalJournal } from './technical-journal.entity';
import { BacktestSession } from './backtest-session.entity';
import {
    BacktestStrategyEntity,
    BacktestSessionBlobEntity,
    BacktestHypothesisEntity,
} from './backtest-normalized.entity';
import { DailyNoteEntity, TradeNoteEntity } from './journal-notes.entity';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { getQuantInternalHeaders } from '../common/security/security.config';
import { CloudflareR2StorageService } from '../common/security/cloudflare-r2-storage.service';
import { PlanPermissionService, PlanTier } from '../payment/plan-permission.service';

@Injectable()
export class DashboardService {
    private readonly logger = new Logger(DashboardService.name);
    private readonly userCacheVersions = new Map<string, number>();

    constructor(
        @InjectRepository(TradeEntity)
        private tradeRepo: Repository<TradeEntity>,
        @InjectRepository(PositionEntity)
        private positionRepo: Repository<PositionEntity>,
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
        @InjectRepository(MentalLog)
        private mentalLogRepo: Repository<MentalLog>,
        @InjectRepository(TechnicalJournal)
        private techJournalRepo: Repository<TechnicalJournal>,
        @InjectRepository(BacktestSession)
        private backtestRepo: Repository<BacktestSession>,
        @InjectRepository(DailyNoteEntity)
        private dailyNoteRepo: Repository<DailyNoteEntity>,
        @InjectRepository(TradeNoteEntity)
        private tradeNoteRepo: Repository<TradeNoteEntity>,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private clickHouseService: ClickHouseService,
        @Optional()
        @InjectRepository(BacktestStrategyEntity)
        private strategyRepo?: Repository<BacktestStrategyEntity>,
        @Optional()
        @InjectRepository(BacktestSessionBlobEntity)
        private sessionBlobRepo?: Repository<BacktestSessionBlobEntity>,
        @Optional()
        @InjectRepository(BacktestHypothesisEntity)
        private hypothesisRepo?: Repository<BacktestHypothesisEntity>,
        @Optional()
        private readonly planPermissionService?: PlanPermissionService,
        @Optional()
        private readonly r2Storage?: CloudflareR2StorageService,
    ) { }

    private isValidUuid(id?: string): boolean {
        return !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
    }

    private stripHtmlText(html?: string | null): string {
        if (!html) return '';
        return String(html)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private mapDailyPsychToMentalScores(
        psych?: {
            sleep?: string | null;
            energy?: string | null;
            focus?: string | null;
            caffeine?: string | null;
            moodState?: string | null;
            stress?: string | null;
        },
        fallbackMood?: string | null
    ) {
        const sleepMap: Record<string, number> = { Exausto: 2, Sonolento: 4, Normal: 6, Disposto: 8, Excelente: 10 };
        const energyMap: Record<string, number> = { Esgotado: 2, Fadigado: 4, Normal: 6, Hiperativo: 7, Confiante: 9 };
        const focusMap: Record<string, number> = { Distraído: 2, Frágil: 4, 'Foco funcional': 8, 'Hiper foco': 10 };
        const caffeineMap: Record<string, number> = { 'Sem consumo': 0, Baixo: 2, Normal: 5, Elevado: 7, 'Consumo crítico': 9 };
        const moodMap: Record<string, number> = {
            Estressado: 2,
            Ansioso: 3,
            Preocupado: 4,
            Impulsivo: 3,
            Eufórico: 6,
            Confiante: 8,
            Focado: 8,
            Calmo: 9,
        };
        const stressMap: Record<string, number> = { Baixo: 2, Normal: 5, Excessivo: 9 };

        const sleepQuality = psych?.sleep ? sleepMap[psych.sleep] : undefined;
        const energy = psych?.energy ? energyMap[psych.energy] : undefined;
        const focus = psych?.focus ? focusMap[psych.focus] : undefined;
        const caffeine = psych?.caffeine ? caffeineMap[psych.caffeine] : undefined;
        const moodKey = psych?.moodState || fallbackMood || '';
        const mood = moodKey ? moodMap[moodKey] : undefined;
        const stress = psych?.stress ? stressMap[psych.stress] : undefined;

        return { sleepQuality, energy, focus, caffeine, mood, stress };
    }

    /**
     * Calcula uma assinatura ultrarrápida (<1ms via IDX_trades_account_status_close_time)
     * do conjunto de trades fechados para invalidar caches Redis automaticamente sem risco de dados defasados.
     */
    private async getTradesDataFingerprint(accountIds: string[]): Promise<string> {
        if (!accountIds || accountIds.length === 0) return '0_0';
        try {
            const rows: Array<{ cnt: number; max_ts: string | number }> = await this.tradeRepo.query(
                `SELECT COUNT(*)::int AS cnt,
                        COALESCE(EXTRACT(EPOCH FROM MAX(close_time))::bigint, 0) AS max_ts
                 FROM trades
                 WHERE account_id = ANY($1) AND status = 'CLOSED'`,
                [accountIds]
            );
            if (rows && rows[0]) {
                return `${rows[0].cnt}_${rows[0].max_ts}`;
            }
        } catch {
            // Fallback silencioso
        }
        return '0_0';
    }

    /**
     * Busca notas individuais de trades usando ANY($2::text[]) (apenas 2 bind params),
     * eliminando o limite de 65.535 bind parameters do PostgreSQL em contas com histórico extenso.
     */
    private async findTradeNotesByKeys(userId: string, tradeKeys: string[]): Promise<TradeNoteEntity[]> {
        if (!tradeKeys || tradeKeys.length === 0) return [];
        try {
            return await this.tradeNoteRepo
                .createQueryBuilder('tn')
                .where('tn.user_id = :userId', { userId })
                .andWhere('tn.trade_id = ANY(:tradeKeys)', { tradeKeys })
                .getMany();
        } catch {
            return [];
        }
    }

    /**
     * Enriquece operações em lote com notas individuais (TradeNoteEntity) e espalha
     * automaticamente os dados e anotações diárias (DailyNoteEntity / TechnicalJournal / MentalLog)
     * caso a operação não possua anotações próprias.
     */
    private async enrichTradesWithJournalContext(
        userId: string,
        accountIds: string[],
        trades: any[]
    ): Promise<any[]> {
        if (!trades || trades.length === 0) return [];

        try {
            const tradeIds = Array.from(
                new Set(
                    trades
                        .flatMap((t) => [String(t.id || ''), String(t.ticket || '')])
                        .filter(Boolean)
                )
            );
            const dateKeys = Array.from(
                new Set(
                    trades
                        .map((t) => {
                            const ref = t.closeTime || t.openTime;
                            if (!ref) return '';
                            const d = new Date(ref);
                            return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
                        })
                        .filter(Boolean)
                )
            );

            const [tradeNotes, dailyNotes, techJournals, mentalLogs] = await Promise.all([
                this.findTradeNotesByKeys(userId, tradeIds),
                dateKeys.length > 0
                    ? this.dailyNoteRepo
                          .createQueryBuilder('dn')
                          .where('dn.user_id = :userId', { userId })
                          .andWhere('dn.date = ANY(:dateKeys)', { dateKeys })
                          .orderBy('dn.updated_at', 'DESC')
                          .getMany()
                          .catch(() => [] as DailyNoteEntity[])
                    : Promise.resolve([] as DailyNoteEntity[]),
                dateKeys.length > 0 && accountIds.length > 0
                    ? this.techJournalRepo
                          .createQueryBuilder('tj')
                          .where('tj.account_id = ANY(:accountIds)', { accountIds })
                          .andWhere('tj.date = ANY(:dateKeys)', { dateKeys })
                          .orderBy('tj.updatedAt', 'DESC')
                          .getMany()
                          .catch(() => [] as TechnicalJournal[])
                    : Promise.resolve([] as TechnicalJournal[]),
                dateKeys.length > 0 && accountIds.length > 0
                    ? this.mentalLogRepo
                          .createQueryBuilder('ml')
                          .where('ml.account_id = ANY(:accountIds)', { accountIds })
                          .andWhere('ml.date = ANY(:dateKeys)', { dateKeys })
                          .orderBy('ml.created_at', 'DESC')
                          .getMany()
                          .catch(() => [] as MentalLog[])
                    : Promise.resolve([] as MentalLog[]),
            ]);

            const tnMap = new Map<string, TradeNoteEntity>();
            for (const tn of tradeNotes) {
                tnMap.set(String(tn.tradeId), tn);
            }

            const dnByAccDate = new Map<string, DailyNoteEntity>();
            const dnByAllDate = new Map<string, DailyNoteEntity>();
            for (const dn of dailyNotes) {
                const dKey = String(dn.date).slice(0, 10);
                if (dn.accountKey && dn.accountKey !== 'all') {
                    const k = `${dn.accountKey}:${dKey}`;
                    if (!dnByAccDate.has(k)) dnByAccDate.set(k, dn);
                } else {
                    if (!dnByAllDate.has(dKey)) dnByAllDate.set(dKey, dn);
                }
                if (!dnByAllDate.has(dKey)) {
                    dnByAllDate.set(dKey, dn);
                }
            }

            const tjByAccDate = new Map<string, TechnicalJournal>();
            const tjByAnyDate = new Map<string, TechnicalJournal>();
            for (const tj of techJournals) {
                const dKey = String(tj.date).slice(0, 10);
                const k = `${tj.accountId}:${dKey}`;
                if (!tjByAccDate.has(k)) tjByAccDate.set(k, tj);
                if (!tjByAnyDate.has(dKey)) tjByAnyDate.set(dKey, tj);
            }

            const mlByAccDate = new Map<string, MentalLog>();
            const mlByAnyDate = new Map<string, MentalLog>();
            for (const ml of mentalLogs) {
                const dKey = String(ml.date).slice(0, 10);
                const k = `${ml.accountId}:${dKey}`;
                if (!mlByAccDate.has(k)) mlByAccDate.set(k, ml);
                if (!mlByAnyDate.has(dKey)) mlByAnyDate.set(dKey, ml);
            }

            return trades.map((t) => {
                const ref = t.closeTime || t.openTime;
                const dKey =
                    ref && !isNaN(new Date(ref).getTime())
                        ? new Date(ref).toISOString().slice(0, 10)
                        : '';
                const tn =
                    tnMap.get(String(t.id || '')) || tnMap.get(String(t.ticket || '')) || null;
                const dn = dKey
                    ? dnByAccDate.get(`${t.accountId}:${dKey}`) || dnByAllDate.get(dKey) || null
                    : null;
                const tj = dKey
                    ? tjByAccDate.get(`${t.accountId}:${dKey}`) || tjByAnyDate.get(dKey) || null
                    : null;
                const ml = dKey
                    ? mlByAccDate.get(`${t.accountId}:${dKey}`) || mlByAnyDate.get(dKey) || null
                    : null;

                const tradeNoteText = this.stripHtmlText(tn?.content);
                const ownTradeNotes = [
                    tradeNoteText,
                    tn?.lessons && tn.lessons !== tradeNoteText ? tn.lessons : '',
                    tn?.mistakes ? `Erros: ${tn.mistakes}` : '',
                    !tradeNoteText && !tn?.lessons && t.lesson ? String(t.lesson) : '',
                ]
                    .filter(Boolean)
                    .join(' — ');

                const dailyNoteText = this.stripHtmlText(dn?.content);
                const dailySpreadNotes = [
                    dailyNoteText,
                    !dailyNoteText && tj?.notes ? tj.notes : '',
                    tj?.lessons ? `Lições: ${tj.lessons}` : '',
                    tj?.mistakes ? `Erros: ${tj.mistakes}` : '',
                    !dailyNoteText && !tj?.notes && ml?.notes ? ml.notes : '',
                ]
                    .filter(Boolean)
                    .join(' — ');

                const tradePsychParts: string[] = [];
                if (tn?.psychCheck?.feeling || t.mood) {
                    tradePsychParts.push(`Sentimento: ${tn?.psychCheck?.feeling || t.mood}`);
                }
                if (tn?.psychCheck?.followingPlan) {
                    tradePsychParts.push(`Plano: ${tn.psychCheck.followingPlan}`);
                }
                if (tn?.psychCheck?.entryDriver) {
                    tradePsychParts.push(`Gatilho: ${tn.psychCheck.entryDriver}`);
                }
                if (tn?.psychCheck?.riskComfort) {
                    tradePsychParts.push(`Risco OK: ${tn.psychCheck.riskComfort}`);
                }
                const tradeSentiment = tradePsychParts.join(' | ');

                const dailyPsychParts: string[] = [];
                const effDailyMood = dn?.psychCheck?.moodState || dn?.mood || tj?.emotionalState;
                if (effDailyMood) dailyPsychParts.push(`Humor: ${effDailyMood}`);
                if (dn?.psychCheck?.focus) dailyPsychParts.push(`Foco: ${dn.psychCheck.focus}`);
                if (dn?.psychCheck?.stress) dailyPsychParts.push(`Estresse: ${dn.psychCheck.stress}`);
                if (dn?.psychCheck?.energy) dailyPsychParts.push(`Energia: ${dn.psychCheck.energy}`);
                if (!dailyPsychParts.length && ml?.overallScore) {
                    const normScore =
                        ml.overallScore <= 10
                            ? Math.round(ml.overallScore * 10)
                            : Math.round(ml.overallScore);
                    dailyPsychParts.push(`Score Mental: ${normScore}/100`);
                }
                const dailySentiment = dailyPsychParts.join(' | ');

                const hasOwnTradeAnnotation = Boolean(ownTradeNotes);
                const annotationSource = hasOwnTradeAnnotation
                    ? 'trade'
                    : dailySpreadNotes || dailySentiment || dn?.marketBias || tj?.marketTrend
                    ? 'daily'
                    : 'none';

                const effectiveNotes = hasOwnTradeAnnotation ? ownTradeNotes : dailySpreadNotes;
                const effectiveMood =
                    tn?.psychCheck?.feeling ||
                    t.mood ||
                    dn?.psychCheck?.moodState ||
                    dn?.mood ||
                    tj?.emotionalState ||
                    null;
                const effectiveSetup =
                    tn?.setup || t.setup || dn?.title || tj?.strategyUsed || null;
                const effectiveRating = Number(tn?.rating || t.rating || tj?.rating || 0);
                const effectiveBias = dn?.marketBias || tj?.marketTrend || null;
                const effectiveShots =
                    tn?.screenshots && tn.screenshots.length > 0
                        ? tn.screenshots
                        : tn?.screenshotUrl
                        ? [tn.screenshotUrl]
                        : Array.isArray(dn?.images)
                        ? dn!.images
                        : [];

                return {
                    ...t,
                    setup: effectiveSetup,
                    rating: effectiveRating,
                    mood: effectiveMood,
                    marketBias: effectiveBias,
                    mfe: t.mfe !== undefined && t.mfe !== null ? Number(t.mfe) : null,
                    mae: t.mae !== undefined && t.mae !== null ? Number(t.mae) : null,
                    lesson: t.lesson || effectiveNotes || null,
                    journalNotes: effectiveNotes || '',
                    sentimentSummary: tradeSentiment || dailySentiment || effectiveMood || '',
                    annotationSource,
                    screenshots: effectiveShots,
                };
            });
        } catch (err) {
            this.logger.warn(`enrichTradesWithJournalContext fallback: ${(err as Error).message}`);
            return trades;
        }
    }

    private setUserCacheVersion(userId: string, version: number) {
        const MAX_CACHE_VERSION_KEYS = 2000;
        if (this.userCacheVersions.has(userId)) {
            this.userCacheVersions.delete(userId);
        }
        while (this.userCacheVersions.size >= MAX_CACHE_VERSION_KEYS) {
            const oldestKey = this.userCacheVersions.keys().next().value;
            if (oldestKey === undefined) break;
            this.userCacheVersions.delete(oldestKey);
        }
        this.userCacheVersions.set(userId, version);
    }

    private async getUserCacheVersion(userId: string): Promise<number> {
        try {
            const cachedVer = await this.cacheManager.get<number>(`dashboard:ver:${userId}`);
            if (typeof cachedVer === 'number' && cachedVer > 0) {
                this.setUserCacheVersion(userId, cachedVer);
                return cachedVer;
            }
        } catch { }
        return this.userCacheVersions.get(userId) || 1;
    }

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

    private getUsdConversionFactor(currency?: string | null): number {
        const code = String(currency || 'USD').trim().toUpperCase();
        if (code === 'USC' || code === 'CENT') return 0.01;
        if (code === 'MZN') return 1 / 65;
        if (code === 'EUR') return 1.08;
        if (code === 'GBP') return 1.27;
        return 1;
    }

    /**
     * Validação de posse da conta para operações de Dashboard
     */
    public async validateUserAccount(userId: string, accountId?: string) {
        if (this.isValidUuid(accountId)) {
            const targetAccount = await this.accountRepo.findOne({
                where: { id: accountId!.trim(), userId }
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

        const allAccounts = await this.accountRepo.find({
            where: { userId, isArchived: false }
        });
        const nonDemoAccounts = allAccounts.filter(a => a.type !== AccountType.DEMO);
        const accounts = nonDemoAccounts.length > 0 ? nonDemoAccounts : allAccounts;
        return {
            isConsolidated: true,
            accounts,
            accountIds: accounts.map(a => a.id),
            targetAccount: null
        };
    }

    async getTrades(userId: string, accountId?: string, endDate?: string, limit = 100) {
        const { accountIds, accounts } = await this.validateUserAccount(userId, accountId);
        if (accountIds.length === 0) return [];

        const accMap = new Map(accounts.map(a => [a.id, a]));

        // Posições abertas em tempo real (sempre frescas, sem cache, para refletir PnL flutuante do MT5)
        const openPositions = await this.positionRepo.find({
            where: { accountId: In(accountIds) },
            order: { openTime: 'DESC' }
        });

        const mappedOpenPositions = openPositions.map(p => {
            const acc = accMap.get(p.accountId);
            const rawType = (p.type || 'BUY').toString().toUpperCase();
            const normalizedType = rawType.includes('SELL') || rawType.includes('PUT') ? 'SELL' : 'BUY';
            const openTime = p.openTime || p.updatedAt || new Date();
            const floatingProfit = Number(p.profit || 0);
            return {
                id: p.id || `pos-${p.ticket}`,
                accountId: p.accountId,
                ticket: p.ticket,
                contractId: p.ticket,
                symbol: p.symbol,
                type: normalizedType,
                volume: Number(p.volume || 0),
                openPrice: Number(p.openPrice || 0),
                closePrice: Number(p.currentPrice || p.openPrice || 0),
                currentPrice: Number(p.currentPrice || p.openPrice || 0),
                profit: floatingProfit,
                commission: 0,
                swap: 0,
                netPnl: floatingProfit,
                sl: p.sl ? Number(p.sl) : null,
                tp: p.tp ? Number(p.tp) : null,
                openTime: openTime,
                closeTime: openTime,
                status: 'OPEN',
                isOpenPosition: true,
                accountName: acc?.name || 'Conta',
                accountBroker: acc?.broker || 'Corretora'
            };
        });

        const ver = await this.getUserCacheVersion(userId);
        const cacheKey = `dashboard:trades:closed:${userId}:v${ver}:${accountId || 'all'}:${endDate || 'all'}:${limit}`;
        let enrichedClosedTrades: any[] | null = null;
        try {
            const cached = await this.cacheManager.get<any[]>(cacheKey);
            if (cached) {
                enrichedClosedTrades = cached;
            }
        } catch (err) {
            console.warn(`[DashboardService] Cache get failed for trades: ${err.message}`);
        }

        if (!enrichedClosedTrades) {
            const whereClause: any = { accountId: In(accountIds), status: 'CLOSED' };
            if (endDate) {
                whereClause.closeTime = LessThanOrEqual(new Date(endDate));
            }

            const trades = await this.tradeRepo.find({
                where: whereClause,
                order: { closeTime: 'DESC' },
                take: limit
            });

            // Enriquecer com identificadores de conta e contexto do Diário (espalhando notas diárias quando sem nota individual)
            const baseClosedTrades = trades.map(t => {
                const acc = accMap.get(t.accountId);
                return {
                    ...t,
                    status: 'CLOSED',
                    isOpenPosition: false,
                    accountName: acc?.name || 'Conta',
                    accountBroker: acc?.broker || 'Corretora'
                };
            });
            enrichedClosedTrades = await this.enrichTradesWithJournalContext(
                userId,
                accountIds,
                baseClosedTrades
            );

            try {
                await this.cacheManager.set(cacheKey, enrichedClosedTrades, 300000); // 5 minutes cache
            } catch (err) {
                console.warn(`[DashboardService] Cache set failed for trades: ${err.message}`);
            }
        }

        const enrichedOpenPositions =
            mappedOpenPositions.length > 0
                ? await this.enrichTradesWithJournalContext(userId, accountIds, mappedOpenPositions)
                : [];

        return [...enrichedOpenPositions, ...enrichedClosedTrades];
    }

    /**
     * Paginação, filtragem e ordenação server-side para a página /trades.
     * Utiliza índices compostos (account_id, status, close_time) e agrega total + summaryNet via SQL,
     * enriquecendo apenas as linhas visíveis da página atual (ex.: 15 linhas).
     */
    async getTradesPaginated(
        userId: string,
        opts: {
            accountId?: string;
            page?: number;
            limit?: number;
            symbol?: string;
            type?: string;
            status?: string;
            ticket?: string;
            startDate?: string;
            endDate?: string;
            sort?: string;
            tz?: string;
            mlFilter?: string;
        }
    ) {
        const page = Math.max(1, Number(opts.page) || 1);
        const limit = Math.min(5000, Math.max(1, Number(opts.limit) || 15));
        const { accountIds, accounts } = await this.validateUserAccount(userId, opts.accountId);

        if (accountIds.length === 0) {
            return {
                items: [],
                total: 0,
                page,
                limit,
                totalPages: 0,
                summaryNet: 0,
                availableSymbols: [],
            };
        }

        const accMap = new Map(accounts.map((a) => [a.id, a]));
        const statusNorm = String(opts.status || 'ALL').trim().toUpperCase();
        const typeNorm = String(opts.type || 'ALL').trim().toUpperCase();
        const symbolNorm = opts.symbol && opts.symbol !== 'ALL' ? String(opts.symbol).trim() : '';
        const ticketNorm = opts.ticket ? String(opts.ticket).trim() : '';
        const sortNorm = String(opts.sort || 'date-desc').trim().toLowerCase();
        const mlFilterNorm = String(opts.mlFilter || 'ALL').trim().toUpperCase();
        const effectiveTz = this.resolveValidIanaTz(opts.tz);

        // 1. Símbolos distintos disponíveis na conta/portfólio (query indexada leve)
        const [symRows, openPositionsRaw] = await Promise.all([
            this.tradeRepo
                .query(
                    `SELECT DISTINCT regexp_replace(symbol, 'm$', '') AS sym
                     FROM trades
                     WHERE account_id = ANY($1) AND symbol IS NOT NULL AND symbol <> ''
                     ORDER BY 1 ASC
                     LIMIT 250`,
                    [accountIds]
                )
                .catch(() => [] as Array<{ sym: string }>),
            statusNorm === 'CLOSED'
                ? Promise.resolve([] as PositionEntity[])
                : this.positionRepo.find({
                      where: { accountId: In(accountIds) },
                      order: { openTime: 'DESC' },
                  }),
        ]);

        const availableSymbolsSet = new Set<string>(
            symRows.map((r: any) => String(r.sym || '').trim()).filter(Boolean)
        );
        for (const p of openPositionsRaw) {
            if (p.symbol) availableSymbolsSet.add(String(p.symbol).replace(/m$/, ''));
        }
        const availableSymbols = Array.from(availableSymbolsSet).sort((a, b) => a.localeCompare(b));

        // 2. Filtra posições abertas em memória (normalmente 0..20 posições ativas)
        const filteredOpenPositions = openPositionsRaw
            .map((p) => {
                const acc = accMap.get(p.accountId);
                const rawType = String(p.type || 'BUY').toUpperCase();
                const normalizedType = rawType.includes('SELL') || rawType.includes('PUT') ? 'SELL' : 'BUY';
                const openTime = p.openTime || p.updatedAt || new Date();
                const floatingProfit = Number(p.profit || 0);
                return {
                    id: p.id || `pos-${p.ticket}`,
                    accountId: p.accountId,
                    ticket: p.ticket,
                    contractId: p.ticket,
                    symbol: p.symbol,
                    cleanSymbol: p.symbol ? String(p.symbol).replace(/m$/, '') : '',
                    type: normalizedType,
                    volume: Number(p.volume || 0),
                    openPrice: Number(p.openPrice || 0),
                    closePrice: Number(p.currentPrice || p.openPrice || 0),
                    currentPrice: Number(p.currentPrice || p.openPrice || 0),
                    profit: floatingProfit,
                    commission: 0,
                    swap: 0,
                    netPnl: floatingProfit,
                    sl: p.sl ? Number(p.sl) : null,
                    tp: p.tp ? Number(p.tp) : null,
                    openTime,
                    closeTime: openTime,
                    status: 'OPEN',
                    isOpenPosition: true,
                    accountName: acc?.name || 'Conta',
                    accountBroker: acc?.broker || 'Corretora',
                };
            })
            .filter((pos) => {
                if (mlFilterNorm !== 'ALL') return false;
                if (ticketNorm && !String(pos.ticket || '').includes(ticketNorm)) return false;
                if (symbolNorm && pos.cleanSymbol !== symbolNorm && pos.symbol !== symbolNorm) return false;
                if ((typeNorm === 'BUY' || typeNorm === 'SELL') && pos.type !== typeNorm) return false;
                if (opts.startDate) {
                    const dKey = this.formatDateKeyInTz(pos.openTime, effectiveTz);
                    if (dKey !== 'Unknown' && dKey < opts.startDate) return false;
                }
                if (opts.endDate) {
                    const dKey = this.formatDateKeyInTz(pos.openTime, effectiveTz);
                    if (dKey !== 'Unknown' && dKey > opts.endDate) return false;
                }
                return true;
            });

        // Caso o usuário filtre apenas posições abertas (status === 'OPEN')
        if (statusNorm === 'OPEN') {
            const total = filteredOpenPositions.length;
            const summaryNet = Number(
                filteredOpenPositions.reduce((s, p) => s + Number(p.netPnl || 0), 0).toFixed(2)
            );
            const slice = filteredOpenPositions.slice((page - 1) * limit, page * limit);
            const enrichedSlice =
                slice.length > 0
                    ? await this.enrichTradesWithJournalContext(userId, accountIds, slice)
                    : [];
            return {
                items: enrichedSlice,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
                summaryNet,
                availableSymbols,
            };
        }

        // 3. Query SQL parametrizada para trades fechados
        const sqlConditions: string[] = [`t.account_id = ANY($1)`, `t.status = 'CLOSED'`];
        const sqlParams: any[] = [accountIds];

        if (ticketNorm) {
            sqlParams.push(`%${ticketNorm}%`);
            sqlConditions.push(`t.ticket::text ILIKE $${sqlParams.length}`);
        }
        if (symbolNorm) {
            sqlParams.push(symbolNorm, `${symbolNorm}m`);
            sqlConditions.push(`(t.symbol = $${sqlParams.length - 1} OR t.symbol = $${sqlParams.length})`);
        }
        if (typeNorm === 'BUY') {
            sqlConditions.push(`(UPPER(t.type) LIKE '%BUY%' OR UPPER(t.type) LIKE '%CALL%' OR UPPER(t.type) = 'LONG')`);
        } else if (typeNorm === 'SELL') {
            sqlConditions.push(`(UPPER(t.type) LIKE '%SELL%' OR UPPER(t.type) LIKE '%PUT%' OR UPPER(t.type) = 'SHORT')`);
        }
        if (opts.startDate) {
            sqlParams.push(effectiveTz, opts.startDate.slice(0, 10));
            sqlConditions.push(
                `TO_CHAR(COALESCE(t.close_time, t.open_time) AT TIME ZONE $${sqlParams.length - 1}, 'YYYY-MM-DD') >= $${sqlParams.length}`
            );
        }
        if (opts.endDate) {
            sqlParams.push(effectiveTz, opts.endDate.slice(0, 10));
            sqlConditions.push(
                `TO_CHAR(COALESCE(t.close_time, t.open_time) AT TIME ZONE $${sqlParams.length - 1}, 'YYYY-MM-DD') <= $${sqlParams.length}`
            );
        }
        if (mlFilterNorm === 'FLAGGED') {
            sqlConditions.push(
                `(COALESCE(t."qualityFlags"->'behavioralFeedback'->>'verdict', '') <> 'FALSE_POSITIVE' AND (COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(t."qualityFlags"->'behavioralMl'->'activeFlags') = 'array' THEN t."qualityFlags"->'behavioralMl'->'activeFlags' ELSE '[]'::jsonb END), 0) > 0 OR (t."qualityFlags"->'behavioralMl'->>'riskLevel') IN ('MODERATE', 'HIGH', 'CRITICAL')))`
            );
        } else if (mlFilterNorm === 'HIGH_CRITICAL') {
            sqlConditions.push(
                `(COALESCE(t."qualityFlags"->'behavioralFeedback'->>'verdict', '') <> 'FALSE_POSITIVE' AND (t."qualityFlags"->'behavioralMl'->>'riskLevel') IN ('HIGH', 'CRITICAL'))`
            );
        } else if (mlFilterNorm === 'CLEAN') {
            sqlConditions.push(
                `((t."qualityFlags"->'behavioralFeedback'->>'verdict') = 'FALSE_POSITIVE' OR ((t."qualityFlags"->'behavioralMl'->>'riskLevel') = 'LOW' AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(t."qualityFlags"->'behavioralMl'->'activeFlags') = 'array' THEN t."qualityFlags"->'behavioralMl'->'activeFlags' ELSE '[]'::jsonb END), 0) = 0))`
            );
        }

        const whereSql = sqlConditions.join(' AND ');
        let orderBySql = `COALESCE(t.close_time, t.open_time) DESC`;
        switch (sortNorm) {
            case 'date-asc':
                orderBySql = `COALESCE(t.close_time, t.open_time) ASC`;
                break;
            case 'profit-desc':
                orderBySql = `t.profit DESC, COALESCE(t.close_time, t.open_time) DESC`;
                break;
            case 'profit-asc':
                orderBySql = `t.profit ASC, COALESCE(t.close_time, t.open_time) DESC`;
                break;
            case 'volume-desc':
                orderBySql = `t.volume DESC, COALESCE(t.close_time, t.open_time) DESC`;
                break;
            case 'volume-asc':
                orderBySql = `t.volume ASC, COALESCE(t.close_time, t.open_time) DESC`;
                break;
        }

        const openCount = filteredOpenPositions.length;
        const globalOffset = (page - 1) * limit;
        const openSlice =
            sortNorm === 'date-desc' && openCount > 0
                ? filteredOpenPositions.slice(globalOffset, globalOffset + limit)
                : [];
        const closedLimit = Math.max(0, limit - openSlice.length);
        const closedOffset =
            sortNorm === 'date-desc' && openCount > 0
                ? Math.max(0, globalOffset - openCount)
                : globalOffset;

        const [aggRows, pageClosedTrades] = await Promise.all([
            this.tradeRepo.query(
                `SELECT COUNT(*)::int AS cnt,
                        COALESCE(SUM(COALESCE(t.profit, 0) + COALESCE(t.commission, 0) + COALESCE(t.swap, 0)), 0)::float8 AS net_sum
                 FROM trades t
                 WHERE ${whereSql}`,
                sqlParams
            ),
            closedLimit > 0
                ? this.tradeRepo.query(
                      `SELECT t.id,
                              t.account_id AS "accountId",
                              t.ticket,
                              t."contractId",
                              t.symbol,
                              t.type,
                              t.volume,
                              t.open_price AS "openPrice",
                              t.close_price AS "closePrice",
                              t.profit,
                              t.commission,
                              t.swap,
                              t."netPnl",
                              t.sl,
                              t.tp,
                              t.open_time AS "openTime",
                              t.close_time AS "closeTime",
                              t.session,
                              t.status,
                              t.mood,
                              t.setup,
                              t.lesson,
                              t.rating,
                              t."qualityFlags"
                       FROM trades t
                       WHERE ${whereSql}
                       ORDER BY ${orderBySql}
                       LIMIT $${sqlParams.length + 1} OFFSET $${sqlParams.length + 2}`,
                      [...sqlParams, closedLimit, closedOffset]
                  )
                : Promise.resolve([]),
        ]);

        const closedCount = Number(aggRows?.[0]?.cnt || 0);
        const closedNetSum = Number(aggRows?.[0]?.net_sum || 0);
        const openNetSum = filteredOpenPositions.reduce((s, p) => s + Number(p.netPnl || 0), 0);

        const total = closedCount + (sortNorm === 'date-desc' ? openCount : 0);
        const summaryNet = Number((closedNetSum + (sortNorm === 'date-desc' ? openNetSum : 0)).toFixed(2));

        const mappedClosed = (pageClosedTrades || []).map((t: any) => {
            const acc = accMap.get(t.accountId);
            return {
                ...t,
                status: 'CLOSED',
                isOpenPosition: false,
                accountName: acc?.name || 'Conta',
                accountBroker: acc?.broker || 'Corretora',
            };
        });

        const combinedPageRows = [...openSlice, ...mappedClosed];
        const enrichedPageRows =
            combinedPageRows.length > 0
                ? await this.enrichTradesWithJournalContext(userId, accountIds, combinedPageRows)
                : [];

        return {
            items: enrichedPageRows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            summaryNet,
            availableSymbols,
        };
    }

    private resolveSessionBucket(tag?: string | null): 'asia' | 'london' | 'overlap' | 'ny' | 'other' {
        const t = (tag || '').toLowerCase();
        const london = /london|londres/.test(t);
        const ny = /new york|nova iorque|\bny\b/.test(t);
        if (london && ny) return 'overlap';
        if (london) return 'london';
        if (ny) return 'ny';
        if (/sydney|tokyo|t[oó]quio|asia|ásia|asian/.test(t)) return 'asia';
        return 'other';
    }

    private resolveValidIanaTz(tz?: string): string {
        if (!tz || typeof tz !== 'string') return 'UTC';
        const clean = tz.trim();
        if (!clean) return 'UTC';
        try {
            Intl.DateTimeFormat('en-US', { timeZone: clean });
            return clean;
        } catch {
            return 'UTC';
        }
    }

    private formatDateKeyInTz(val: Date | string | number, timeZone = 'UTC'): string {
        const d = val instanceof Date ? val : new Date(val);
        if (isNaN(d.getTime())) return 'Unknown';
        if (!timeZone || timeZone === 'UTC') {
            return d.toISOString().split('T')[0];
        }
        try {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).formatToParts(d);
            let y = '';
            let m = '';
            let day = '';
            for (const p of parts) {
                if (p.type === 'year') y = p.value;
                else if (p.type === 'month') m = p.value;
                else if (p.type === 'day') day = p.value;
            }
            return y && m && day ? `${y}-${m}-${day}` : d.toISOString().split('T')[0];
        } catch {
            return d.toISOString().split('T')[0];
        }
    }

    private getWeekdayInTz(val: Date | string | number, timeZone = 'UTC'): number {
        const d = val instanceof Date ? val : new Date(val);
        if (isNaN(d.getTime())) return 0;
        if (!timeZone || timeZone === 'UTC') {
            return d.getUTCDay();
        }
        try {
            const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(d);
            const map: Record<string, number> = {
                Sun: 0,
                Mon: 1,
                Tue: 2,
                Wed: 3,
                Thu: 4,
                Fri: 5,
                Sat: 6,
            };
            return map[wd] ?? d.getUTCDay();
        } catch {
            return d.getUTCDay();
        }
    }

    async getPerformance(
        userId: string,
        accountId?: string,
        startDate?: string,
        endDate?: string,
        filters?: { symbols?: string; side?: string; sessions?: string; outcome?: string; tz?: string }
    ) {
        const effectiveTz = this.resolveValidIanaTz(filters?.tz);
        const symbolList = (filters?.symbols || '')
            .split(',')
            .map(s => s.trim().toUpperCase())
            .filter(Boolean)
            .sort();
        const symbolSet = new Set(symbolList);

        const rawSide = String(filters?.side || 'ALL').trim().toUpperCase();
        const sideNorm = rawSide === 'BUY' || rawSide === 'SELL' ? rawSide : 'ALL';

        const sessionList = (filters?.sessions || '')
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean)
            .sort();
        const sessionSet = new Set(sessionList);

        const rawOutcome = String(filters?.outcome || 'ALL').trim().toUpperCase();
        const outcomeNorm = rawOutcome === 'WIN' || rawOutcome === 'LOSS' || rawOutcome === 'BE' ? rawOutcome : 'ALL';

        const filterCacheSuffix = `sym=${symbolList.join(',') || 'all'}:side=${sideNorm}:sess=${sessionList.join(',') || 'all'}:out=${outcomeNorm}:tz=${effectiveTz}`;

        const ver = await this.getUserCacheVersion(userId);
        const cacheKey = `dashboard:performance:${userId}:v${ver}:${accountId || 'all'}:${startDate || 'all'}:${endDate || 'all'}:${filterCacheSuffix}`;
        try {
            const cached = await this.cacheManager.get(cacheKey);
            if (cached) {
                return cached;
            }
        } catch (err) {
            console.warn(`[DashboardService] Cache get failed for performance: ${err.message}`);
        }

        try {
            const emptyRadarMeta = {
                usedJournalSignals: false,
                annotatedTrades: 0,
                annotatedDays: 0,
                sources: {
                    consistency: 'legacy' as 'legacy' | 'blended',
                    riskManagement: 'legacy' as 'legacy' | 'blended',
                    discipline: 'legacy' as 'legacy' | 'blended',
                },
                tips: [] as string[],
            };

            const { isConsolidated, accounts, accountIds, targetAccount } = await this.validateUserAccount(userId, accountId);
            if (accounts.length === 0) {
                return {
                    totalPnL: 0,
                    winRate: 0,
                    totalTrades: 0,
                    profitFactor: 0,
                    avgWin: 0,
                    avgLoss: 0,
                    payoffRatio: 0,
                    torexScore: 0,
                    radarMetrics: {
                        consistency: 0,
                        riskManagement: 0,
                        discipline: 0,
                        profitability: 0,
                        winRate: 0,
                        profitFactorScore: 0
                    },
                    radarMeta: emptyRadarMeta,
                    dailyPnL: [],
                    tradePnL: [],
                    distribution: { wins: 0, losses: 0, breakeven: 0 },
                    byMood: [],
                    bySetup: [],
                    bySession: [],
                    bySymbol: [],
                    byWeekday: [],
                    availableSymbols: [],
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

            const dateRangeFilter =
                startDate && endDate
                    ? Between(startDate.slice(0, 10), endDate.slice(0, 10))
                    : startDate
                      ? MoreThanOrEqual(startDate.slice(0, 10))
                      : endDate
                        ? LessThanOrEqual(endDate.slice(0, 10))
                        : undefined;

            const journalWhere: any = { accountId: In(accountIds) };
            const dailyNoteWhere: any = { userId };
            if (dateRangeFilter) {
                journalWhere.date = dateRangeFilter;
                dailyNoteWhere.date = dateRangeFilter;
            }

            // Query PostgreSQL directly as the single authoritative transactional source of truth
            const [rawTrades, journals, rawDailyNotes, mentalLogs] = await Promise.all([
                this.tradeRepo.find({
                    where: whereClause,
                    order: { closeTime: 'ASC' }
                }),
                this.techJournalRepo
                    .find({
                        where: journalWhere,
                        order: { updatedAt: 'DESC' }
                    })
                    .catch(() => [] as TechnicalJournal[]),
                this.dailyNoteRepo
                    .find({
                        where: dailyNoteWhere,
                        order: { updatedAt: 'DESC' }
                    })
                    .catch(() => [] as DailyNoteEntity[]),
                this.mentalLogRepo
                    .find({
                        where: journalWhere,
                        order: { createdAt: 'DESC' }
                    })
                    .catch(() => [] as MentalLog[])
            ]);

            const allowedAccountKeys = new Set<string>(['all', ...accountIds.map(id => String(id))]);
            const dailyNotes = rawDailyNotes.filter(dn => allowedAccountKeys.has(String(dn.accountKey || 'all')));

            const hasDailyNoteSignal = (dn?: DailyNoteEntity): boolean => {
                if (!dn) return false;
                const pc = dn.psychCheck || {};
                return Boolean(
                    this.stripHtmlText(dn.content) ||
                    (dn.title && String(dn.title).trim()) ||
                    (dn.mood && String(dn.mood).trim()) ||
                    (dn.marketBias && String(dn.marketBias).trim()) ||
                    (Array.isArray(dn.images) && dn.images.length > 0) ||
                    pc.sleep ||
                    pc.energy ||
                    pc.focus ||
                    pc.caffeine ||
                    pc.moodState ||
                    pc.stress
                );
            };

            const dailyNoteByAccDate = new Map<string, DailyNoteEntity>();
            const dailyNoteByDate = new Map<string, DailyNoteEntity>();
            for (const dn of dailyNotes) {
                const dKey = String(dn.date).slice(0, 10);
                const accKey = `${dn.accountKey || 'all'}|${dKey}`;
                if (!dailyNoteByAccDate.has(accKey)) {
                    dailyNoteByAccDate.set(accKey, dn);
                }
                if (!dailyNoteByDate.has(dKey) || (dn.accountKey && dn.accountKey !== 'all' && dailyNoteByDate.get(dKey)?.accountKey === 'all')) {
                    dailyNoteByDate.set(dKey, dn);
                }
            }

            const techJournalByAccDate = new Map<string, TechnicalJournal>();
            const techJournalByDate = new Map<string, TechnicalJournal>();
            for (const tj of journals) {
                const dKey = String(tj.date).slice(0, 10);
                if (tj.accountId && !techJournalByAccDate.has(`${tj.accountId}|${dKey}`)) {
                    techJournalByAccDate.set(`${tj.accountId}|${dKey}`, tj);
                }
                if (!techJournalByDate.has(dKey)) {
                    techJournalByDate.set(dKey, tj);
                }
            }

            const mentalLogByAccDate = new Map<string, MentalLog>();
            const mentalLogByDate = new Map<string, MentalLog>();
            for (const ml of mentalLogs) {
                const dKey = String(ml.date).slice(0, 10);
                if (ml.accountId && !mentalLogByAccDate.has(`${ml.accountId}|${dKey}`)) {
                    mentalLogByAccDate.set(`${ml.accountId}|${dKey}`, ml);
                }
                if (!mentalLogByDate.has(dKey)) {
                    mentalLogByDate.set(dKey, ml);
                }
            }

            const journalDateSet = new Set<string>([
                ...journals.map(j => String(j.date).slice(0, 10)),
                ...mentalLogs.map(m => String(m.date).slice(0, 10)),
                ...dailyNotes.filter(dn => hasDailyNoteSignal(dn)).map(dn => String(dn.date).slice(0, 10)),
            ]);

            // Collect all symbols present in the account/date window before symbol filter is applied
            const availableSymbols = Array.from(
                new Set(
                    rawTrades
                        .map(t => String(t.symbol || '').trim())
                        .filter(s => s && s !== 'Unknown')
                )
            ).sort((a, b) => a.localeCompare(b));

            const trades: any[] = rawTrades.filter(t => {
                if (symbolSet.size > 0) {
                    const sym = String(t.symbol || '').trim().toUpperCase();
                    if (!symbolSet.has(sym)) return false;
                }
                if (sideNorm === 'BUY' || sideNorm === 'SELL') {
                    const rawType = String(t.type || '').toUpperCase();
                    const isBuy = rawType.includes('BUY') || rawType.includes('CALL') || rawType === 'LONG';
                    const isSell = rawType.includes('SELL') || rawType.includes('PUT') || rawType === 'SHORT';
                    if (sideNorm === 'BUY' && !isBuy) return false;
                    if (sideNorm === 'SELL' && !isSell) return false;
                }
                if (sessionSet.size > 0) {
                    const bucket = this.resolveSessionBucket(t.session);
                    if (!sessionSet.has(bucket)) return false;
                }
                if (outcomeNorm === 'WIN' || outcomeNorm === 'LOSS' || outcomeNorm === 'BE') {
                    const pnl = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
                    if (outcomeNorm === 'WIN' && !(pnl > 0.001)) return false;
                    if (outcomeNorm === 'LOSS' && !(pnl < -0.001)) return false;
                    if (outcomeNorm === 'BE' && !(Math.abs(pnl) <= 0.001)) return false;
                }
                return true;
            });

            const dailyMap = new Map<string, { pnl: number; count: number; wins: number; losses: number; buyCount: number; sellCount: number; hasNotes: boolean }>();
            const moodMap = new Map<string, { count: number; pnl: number }>();
            const setupMap = new Map<string, { count: number; pnl: number }>();
            const sessionMap = new Map<string, { count: number; wins: number; pnl: number }>();
            // Per-symbol and per-weekday breakdowns over the same filtered, closed trades
            const symbolMap = new Map<string, { count: number; wins: number; losses: number; pnl: number }>();
            const weekdayMap = new Map<number, { count: number; wins: number; pnl: number }>();

            const totalTrades = trades.length;
            if (totalTrades === 0) {
                return {
                    totalPnL: 0,
                    winRate: 0,
                    totalTrades: 0,
                    profitFactor: 0,
                    avgWin: 0,
                    avgLoss: 0,
                    payoffRatio: 0,
                    torexScore: 0,
                    radarMetrics: {
                        consistency: 0,
                        riskManagement: 0,
                        discipline: 0,
                        profitability: 0,
                        winRate: 0,
                        profitFactorScore: 0
                    },
                    radarMeta: emptyRadarMeta,
                    dailyPnL: [],
                    tradePnL: [],
                    distribution: { wins: 0, losses: 0, breakeven: 0 },
                    byMood: [],
                    bySetup: [],
                    bySession: [],
                    bySymbol: [],
                    byWeekday: [],
                    availableSymbols,
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

            // Query TradeNoteEntity for the filtered closed trades using ANY($2::text[]) (2 bind params only)
            const filteredTradeKeys = Array.from(
                new Set(
                    trades
                        .flatMap(t => [String(t.id || ''), String(t.ticket || '')])
                        .filter(Boolean)
                )
            );
            const tradeNotes = await this.findTradeNotesByKeys(userId, filteredTradeKeys);
            const tradeNoteMap = new Map<string, TradeNoteEntity>();
            for (const tn of tradeNotes) {
                tradeNoteMap.set(String(tn.tradeId), tn);
            }

            const scoreEmotionLabel = (raw?: string | null): number | null => {
                const val = String(raw || '').trim().toLowerCase();
                if (!val || val === 'unknown' || val === 'neutral' || val === 'neutro') return null;
                if (val.includes('calmo') || val.includes('calm') || val.includes('tranquil')) return 92;
                if (val.includes('focad') || val.includes('focus')) return 90;
                if (val.includes('confiant') || val.includes('confid')) return 88;
                if (val.includes('normal')) return 75;
                if (val.includes('preocupad') || val.includes('eufóric') || val.includes('euforic') || val.includes('hesita')) return 52;
                if (val.includes('ansios') || val.includes('anxi') || val.includes('estress') || val.includes('stress') || val.includes('impuls') || val.includes('frustr') || val.includes('raiva') || val.includes('medo')) return 28;
                return null;
            };

            const consistencySignals: number[] = [];
            const disciplineSignals: number[] = [];
            const riskSignals: number[] = [];

            let annotatedTradesCount = 0;
            let planYesCount = 0;
            let planTotalCount = 0;
            let strategyDriverCount = 0;
            let impulseDriverCount = 0;
            let riskComfortYesCount = 0;
            let riskComfortTotalCount = 0;
            let excursionTrackedCount = 0;

            let totalPnL = 0;
            let wins = 0;
            let losses = 0;
            let breakevens = 0;
            let grossProfit = 0;
            let grossLoss = 0;

            let peakEquity = 0;
            let currentEquity = 0;
            let maxDrawdown = 0;

            const todayStr = this.formatDateKeyInTz(new Date(), effectiveTz);
            let todayPnL = 0;

            const accCurrencyById = new Map(accounts.map(a => [a.id, a.currency || 'USD']));
            const normalizeMultiCurrencyPnl =
                isConsolidated &&
                new Set(accounts.map(a => String(a.currency || 'USD').trim().toUpperCase())).size > 1;

            for (const t of trades) {
                const profit = Number(t.profit) || 0;
                const commission = Number(t.commission) || 0;
                const swap = Number(t.swap) || 0;
                const rawPnl = profit + commission + swap;
                const tAccId = String(t.accountId || (t as any).account_id || '');
                const fxFactor = normalizeMultiCurrencyPnl
                    ? this.getUsdConversionFactor(accCurrencyById.get(tAccId))
                    : 1;
                const pnl = rawPnl * fxFactor;

                totalPnL += pnl;

                // Drawdown tracking
                currentEquity += pnl;
                if (currentEquity > peakEquity) peakEquity = currentEquity;
                const dd = peakEquity - currentEquity;
                if (dd > maxDrawdown) maxDrawdown = dd;

                // Today PnL tracking (no fuso horário local do usuário)
                if (t.closeTime) {
                    const cDate = this.formatDateKeyInTz(t.closeTime, effectiveTz);
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

                const dateStr = t.closeTime ? this.formatDateKeyInTz(t.closeTime, effectiveTz) : 'Unknown';
                const accId = String(t.accountId || (t as any).account_id || '');
                const tNote = tradeNoteMap.get(String(t.id)) || (t.ticket ? tradeNoteMap.get(String(t.ticket)) : undefined);
                const dNote =
                    (accId ? dailyNoteByAccDate.get(`${accId}|${dateStr}`) : undefined) ||
                    dailyNoteByAccDate.get(`all|${dateStr}`) ||
                    dailyNoteByDate.get(dateStr);
                const tJournal =
                    (accId ? techJournalByAccDate.get(`${accId}|${dateStr}`) : undefined) ||
                    techJournalByDate.get(dateStr);

                const tPsych = tNote?.psychCheck || {};
                const hasDirectTradeNote = Boolean(
                    (tNote && (
                        this.stripHtmlText(tNote.content) ||
                        (tNote.setup && String(tNote.setup).trim()) ||
                        (tNote.mistakes && String(tNote.mistakes).trim()) ||
                        (tNote.lessons && String(tNote.lessons).trim()) ||
                        Number(tNote.rating) > 0 ||
                        (Array.isArray(tNote.screenshots) && tNote.screenshots.length > 0) ||
                        tNote.screenshotUrl ||
                        tPsych.feeling ||
                        tPsych.followingPlan ||
                        tPsych.entryDriver ||
                        tPsych.riskComfort
                    )) ||
                    (t.lesson && String(t.lesson).trim()) ||
                    (t.mistakes && String(t.mistakes).trim()) ||
                    (t.setup && String(t.setup).trim() && t.setup !== 'Unknown') ||
                    (t.mood && String(t.mood).trim() && t.mood !== 'Unknown') ||
                    (Array.isArray(t.tags) && t.tags.length > 0) ||
                    Number(t.mfe) > 0 ||
                    Number(t.mae) > 0
                );

                if (hasDirectTradeNote) {
                    annotatedTradesCount++;
                }

                // Collect trade-level journal signals ONLY when explicitly filled (never 0 on absence)
                if (Number(tNote?.rating) > 0) {
                    consistencySignals.push(Math.max(20, Math.min(100, Math.round((Number(tNote!.rating) / 5) * 100))));
                }

                const followingPlan = String(tPsych.followingPlan || '').trim().toLowerCase();
                if (followingPlan) {
                    if (followingPlan === 'sim' || followingPlan === 'yes') {
                        disciplineSignals.push(98);
                        planYesCount++;
                        planTotalCount++;
                    } else if (followingPlan.includes('parcial')) {
                        disciplineSignals.push(60);
                        planTotalCount++;
                    } else if (followingPlan === 'não' || followingPlan === 'nao' || followingPlan === 'no') {
                        disciplineSignals.push(20);
                        planTotalCount++;
                    }
                }

                const entryDriver = String(tPsych.entryDriver || '').trim().toLowerCase();
                if (entryDriver) {
                    if (entryDriver.includes('estratégia') || entryDriver.includes('estrategia') || entryDriver.includes('plano')) {
                        disciplineSignals.push(98);
                        strategyDriverCount++;
                    } else if (entryDriver.includes('intui')) {
                        disciplineSignals.push(55);
                    } else if (entryDriver.includes('impulso') || entryDriver.includes('fomo') || entryDriver.includes('vingan')) {
                        disciplineSignals.push(15);
                        impulseDriverCount++;
                    }
                }

                const directEmotionScore = scoreEmotionLabel(tPsych.feeling || (t.mood && t.mood !== 'Unknown' ? t.mood : null));
                if (directEmotionScore !== null) {
                    disciplineSignals.push(directEmotionScore);
                }

                const mistakesTxt = this.stripHtmlText(tNote?.mistakes || t.mistakes);
                const lessonsTxt = this.stripHtmlText(tNote?.lessons || t.lesson);
                if (mistakesTxt && !/^(nenhum|nenhuma|none|n\/a|-|0)$/i.test(mistakesTxt)) {
                    disciplineSignals.push(lessonsTxt ? 68 : 42);
                } else if (lessonsTxt) {
                    consistencySignals.push(86);
                }

                const riskComfort = String(tPsych.riskComfort || '').trim().toLowerCase();
                if (riskComfort) {
                    if (riskComfort === 'sim' || riskComfort === 'yes') {
                        riskSignals.push(95);
                        riskComfortYesCount++;
                        riskComfortTotalCount++;
                    } else if (riskComfort === 'não' || riskComfort === 'nao' || riskComfort === 'no') {
                        riskSignals.push(25);
                        riskComfortTotalCount++;
                    }
                }

                const mfeVal = Number(t.mfe);
                const maeVal = Number(t.mae);
                if (Number.isFinite(mfeVal) && mfeVal > 0 && Number.isFinite(maeVal) && maeVal > 0) {
                    riskSignals.push(Math.round(Math.max(25, Math.min(100, (mfeVal / (mfeVal + maeVal)) * 115))));
                    excursionTrackedCount++;
                } else if ((Number.isFinite(mfeVal) && mfeVal > 0) || (Number.isFinite(maeVal) && maeVal > 0)) {
                    riskSignals.push(78);
                    excursionTrackedCount++;
                }

                const rawType = String(t.type || '').toUpperCase();
                const isBuyTrade = rawType.includes('BUY') || rawType.includes('CALL') || rawType === 'LONG';
                const isSellTrade = rawType.includes('SELL') || rawType.includes('PUT') || rawType === 'SHORT';

                const hasTradeAnnotation = hasDirectTradeNote || journalDateSet.has(dateStr);
                const curDay = dailyMap.get(dateStr) || {
                    pnl: 0,
                    count: 0,
                    wins: 0,
                    losses: 0,
                    buyCount: 0,
                    sellCount: 0,
                    hasNotes: journalDateSet.has(dateStr)
                };
                curDay.pnl += pnl;
                curDay.count += 1;
                if (pnl > 0) curDay.wins += 1;
                else if (pnl < 0) curDay.losses += 1;
                if (isBuyTrade) curDay.buyCount += 1;
                if (isSellTrade) curDay.sellCount += 1;
                if (hasTradeAnnotation) curDay.hasNotes = true;
                dailyMap.set(dateStr, curDay);

                // Spread daily mood & setup when individual trade fields are absent
                const effectiveMood =
                    (tPsych.feeling && String(tPsych.feeling).trim()) ||
                    (t.mood && String(t.mood).trim() && t.mood !== 'Unknown' ? String(t.mood).trim() : '') ||
                    (dNote?.psychCheck?.moodState && String(dNote.psychCheck.moodState).trim()) ||
                    (dNote?.mood && String(dNote.mood).trim()) ||
                    (tJournal?.emotionalState && String(tJournal.emotionalState).trim()) ||
                    'Unknown';
                const mData = moodMap.get(effectiveMood) || { count: 0, pnl: 0 };
                moodMap.set(effectiveMood, { count: mData.count + 1, pnl: mData.pnl + pnl });

                const effectiveSetup =
                    (tNote?.setup && String(tNote.setup).trim()) ||
                    (t.setup && String(t.setup).trim() && t.setup !== 'Unknown' ? String(t.setup).trim() : '') ||
                    (tJournal?.strategyUsed && String(tJournal.strategyUsed).trim()) ||
                    (dNote?.title && String(dNote.title).trim()) ||
                    'Unknown';
                const sData = setupMap.get(effectiveSetup) || { count: 0, pnl: 0 };
                setupMap.set(effectiveSetup, { count: sData.count + 1, pnl: sData.pnl + pnl });

                const session = t.session || 'Unknown';
                const sessData = sessionMap.get(session) || { count: 0, wins: 0, pnl: 0 };
                sessionMap.set(session, { count: sessData.count + 1, wins: sessData.wins + (pnl > 0 ? 1 : 0), pnl: sessData.pnl + pnl });

                const symbol = String(t.symbol || 'Unknown').trim();
                const symData = symbolMap.get(symbol) || { count: 0, wins: 0, losses: 0, pnl: 0 };
                symbolMap.set(symbol, {
                    count: symData.count + 1,
                    wins: symData.wins + (pnl > 0 ? 1 : 0),
                    losses: symData.losses + (pnl < 0 ? 1 : 0),
                    pnl: symData.pnl + pnl,
                });

                if (t.closeTime) {
                    const weekday = this.getWeekdayInTz(t.closeTime, effectiveTz);
                    const wd = weekdayMap.get(weekday) || { count: 0, wins: 0, pnl: 0 };
                    weekdayMap.set(weekday, { count: wd.count + 1, wins: wd.wins + (pnl > 0 ? 1 : 0), pnl: wd.pnl + pnl });
                }
            }

            // Collect day-level journal signals across active trading days ONLY when non-empty (never 0 on absence)
            let annotatedDaysCount = 0;
            let lowFocusOrHighStressDays = 0;
            let rulesBrokenDays = 0;

            for (const [dateStr, dayStats] of dailyMap.entries()) {
                if (!dateStr || dateStr === 'Unknown') continue;
                const dNote =
                    (targetAccount ? dailyNoteByAccDate.get(`${targetAccount.id}|${dateStr}`) : undefined) ||
                    dailyNoteByAccDate.get(`all|${dateStr}`) ||
                    dailyNoteByDate.get(dateStr);
                const tJournal =
                    (targetAccount ? techJournalByAccDate.get(`${targetAccount.id}|${dateStr}`) : undefined) ||
                    techJournalByDate.get(dateStr);
                const mLog =
                    (targetAccount ? mentalLogByAccDate.get(`${targetAccount.id}|${dateStr}`) : undefined) ||
                    mentalLogByDate.get(dateStr);

                const dayHasJournal = hasDailyNoteSignal(dNote) || Boolean(tJournal) || Boolean(mLog);
                if (!dayHasJournal) continue;
                annotatedDaysCount++;

                // Daily Consistency hints
                const hasWrittenReview = Boolean(
                    this.stripHtmlText(dNote?.content) ||
                    (dNote?.title && String(dNote.title).trim()) ||
                    (Array.isArray(dNote?.images) && dNote!.images.length > 0) ||
                    this.stripHtmlText(tJournal?.notes) ||
                    this.stripHtmlText(tJournal?.lessons) ||
                    this.stripHtmlText(tJournal?.actionPlan)
                );
                if (hasWrittenReview) {
                    consistencySignals.push(86);
                }

                const prep = String(tJournal?.preMarketPrep || '').trim().toLowerCase();
                if (prep) {
                    if (prep === 'excellent' || prep === 'excelente') consistencySignals.push(96);
                    else if (prep === 'good' || prep === 'bom' || prep === 'boa') consistencySignals.push(84);
                    else if (prep === 'poor' || prep === 'fraco' || prep === 'ruim') consistencySignals.push(42);
                    else if (prep === 'none' || prep === 'nenhum') consistencySignals.push(25);
                }

                const sq = String(tJournal?.setupQuality || '').trim().toUpperCase();
                if (sq) {
                    if (sq === 'A+') consistencySignals.push(98);
                    else if (sq === 'A') consistencySignals.push(88);
                    else if (sq === 'B') consistencySignals.push(72);
                    else if (sq === 'C') consistencySignals.push(42);
                }

                if (Number(tJournal?.rating) > 0) {
                    consistencySignals.push(Math.max(15, Math.min(100, Math.round(Number(tJournal!.rating) * 10))));
                }

                const biasRaw = String(dNote?.marketBias || tJournal?.marketTrend || '').trim().toLowerCase();
                if (biasRaw) {
                    if (biasRaw.includes('alta') || biasRaw.includes('bull')) {
                        const aligned = dayStats.buyCount >= dayStats.sellCount;
                        consistencySignals.push(aligned && dayStats.pnl >= 0 ? 92 : aligned ? 78 : dayStats.pnl > 0 ? 75 : 48);
                    } else if (biasRaw.includes('baixa') || biasRaw.includes('bear')) {
                        const aligned = dayStats.sellCount >= dayStats.buyCount;
                        consistencySignals.push(aligned && dayStats.pnl >= 0 ? 92 : aligned ? 78 : dayStats.pnl > 0 ? 75 : 48);
                    } else if (biasRaw.includes('lateral') || biasRaw.includes('neutro') || biasRaw.includes('sideways') || biasRaw.includes('rang')) {
                        consistencySignals.push(dayStats.pnl >= 0 ? 86 : 68);
                    }
                }

                const dPsych = dNote?.psychCheck || {};
                const mappedMental = this.mapDailyPsychToMentalScores(dPsych, dNote?.mood);
                if (mLog && Number(mLog.overallScore) > 0) {
                    const normScore = Number(mLog.overallScore) <= 10 ? Number(mLog.overallScore) * 10 : Number(mLog.overallScore);
                    consistencySignals.push(Math.round(Math.max(20, Math.min(100, normScore))));
                } else {
                    const readinessVals = [mappedMental.sleepQuality, mappedMental.energy].filter((v): v is number => typeof v === 'number');
                    if (readinessVals.length > 0) {
                        const avgReadiness = readinessVals.reduce((s, v) => s + v, 0) / readinessVals.length;
                        consistencySignals.push(Math.round(Math.max(20, Math.min(100, avgReadiness * 10))));
                    }
                }

                // Daily Discipline hints
                if (dPsych.focus) {
                    if (dPsych.focus === 'Hiper foco') disciplineSignals.push(96);
                    else if (dPsych.focus === 'Foco funcional') disciplineSignals.push(85);
                    else if (dPsych.focus === 'Frágil') {
                        disciplineSignals.push(45);
                        lowFocusOrHighStressDays++;
                    } else if (dPsych.focus === 'Distraído') {
                        disciplineSignals.push(25);
                        lowFocusOrHighStressDays++;
                    }
                } else if (mLog && Number(mLog.focus) > 0) {
                    const fScore = Math.min(100, Math.round(Number(mLog.focus) * 10));
                    disciplineSignals.push(fScore);
                    if (fScore <= 40) lowFocusOrHighStressDays++;
                }

                if (dPsych.stress) {
                    if (dPsych.stress === 'Baixo') disciplineSignals.push(90);
                    else if (dPsych.stress === 'Normal') disciplineSignals.push(76);
                    else if (dPsych.stress === 'Excessivo') {
                        disciplineSignals.push(28);
                        lowFocusOrHighStressDays++;
                    }
                } else if (mLog && Number(mLog.stress) > 0) {
                    const sScore = Math.max(10, Math.min(100, Math.round((11 - Number(mLog.stress)) * 10)));
                    disciplineSignals.push(sScore);
                    if (Number(mLog.stress) >= 8) lowFocusOrHighStressDays++;
                }

                const dayMoodScore = scoreEmotionLabel(dPsych.moodState || dNote?.mood || tJournal?.emotionalState);
                if (dayMoodScore !== null) {
                    disciplineSignals.push(dayMoodScore);
                }

                const entryPrec = String(tJournal?.entryPrecision || '').trim().toLowerCase();
                if (entryPrec) {
                    if (entryPrec === 'perfect') disciplineSignals.push(96);
                    else if (entryPrec === 'early' || entryPrec === 'late') disciplineSignals.push(60);
                    else if (entryPrec === 'impulse') disciplineSignals.push(18);
                }

                const execSpeed = String(tJournal?.executionSpeed || '').trim().toLowerCase();
                if (execSpeed) {
                    if (execSpeed === 'immediate') disciplineSignals.push(92);
                    else if (execSpeed === 'delayed') disciplineSignals.push(65);
                    else if (execSpeed === 'rushed') disciplineSignals.push(30);
                }

                const rulesBroken = this.stripHtmlText(tJournal?.rulesBroken);
                if (rulesBroken) {
                    if (/^(nenhum|nenhuma|none|n\/a|-|0|não|nao)$/i.test(rulesBroken)) {
                        disciplineSignals.push(95);
                    } else {
                        disciplineSignals.push(22);
                        rulesBrokenDays++;
                    }
                }

                // Daily Risk Management hints
                const jRisk = String(tJournal?.riskManagement || '').trim().toLowerCase();
                if (jRisk) {
                    if (jRisk === 'planned' || jRisk === 'adequado' || jRisk === 'bom') riskSignals.push(95);
                    else if (jRisk === 'high' || jRisk === 'alto') riskSignals.push(35);
                    else if (jRisk === 'fear' || jRisk === 'medo') riskSignals.push(40);
                    else if (jRisk === 'nostop' || jRisk === 'sem stop') riskSignals.push(15);
                }

                const jExit = String(tJournal?.tradeExit || '').trim().toLowerCase();
                if (jExit) {
                    if (jExit === 'target' || jExit === 'alvo') riskSignals.push(95);
                    else if (jExit === 'stop') riskSignals.push(82);
                    else if (jExit === 'early' || jExit === 'late') riskSignals.push(58);
                }

                if (dPsych.caffeine === 'Consumo crítico') riskSignals.push(35);
                else if (dPsych.caffeine === 'Elevado') riskSignals.push(62);
                if (dPsych.sleep === 'Exausto') riskSignals.push(35);
                else if (dPsych.sleep === 'Sonolento') riskSignals.push(55);
                else if (dPsych.sleep === 'Disposto' || dPsych.sleep === 'Excelente') riskSignals.push(88);
            }

            const winRate = (wins / totalTrades) * 100;
            const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99.99 : 0) : grossProfit / grossLoss;

            // 1. Legacy mathematical baselines (100% preserved whenever journal data is absent — NEVER assumes zero on missing notes)
            const tradingDays = Array.from(dailyMap.values());
            const winningDays = tradingDays.filter(d => d.pnl > 0).length;
            const legacyConsistency = tradingDays.length > 0
                ? Math.round((winningDays / tradingDays.length) * 100)
                : 0;

            const avgWin = wins > 0 ? grossProfit / wins : 0;
            const avgLoss = losses > 0 ? grossLoss / losses : 0;
            const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 2 : 0);
            const tradesWithSl = trades.filter(t => Number(t.sl) > 0).length;
            const slUsageRatio = totalTrades > 0 ? (tradesWithSl / totalTrades) * 100 : 0;
            const payoffComponent = Math.min(100, (payoffRatio / 2.0) * 100);
            const legacyRiskManagement = Math.round(Math.min(100, (payoffComponent * 0.6) + (slUsageRatio * 0.4)));

            // Volume sizing stability (Discipline): penalize erratic lot size spikes (revenge trading / martingale)
            const volumes = trades.map(t => Number(t.volume) || 0).filter(v => v > 0);
            let legacyDiscipline = 0;
            if (volumes.length > 0) {
                const meanVol = volumes.reduce((s, v) => s + v, 0) / volumes.length;
                const varianceVol = volumes.reduce((s, v) => s + Math.pow(v - meanVol, 2), 0) / volumes.length;
                const cvVol = meanVol > 0 ? Math.sqrt(varianceVol) / meanVol : 0; // Coefficient of variation
                legacyDiscipline = Math.max(0, Math.min(100, Math.round((1 - Math.min(cvVol, 1)) * 100)));
            }

            // 2. Non-zero coverage-proportional blending with /journal signals (when absent -> 100% legacy score)
            const blendWithLegacy = (
                legacyVal: number,
                signals: number[],
                referenceTotal: number,
                hasLegacyBase = true
            ): { value: number; source: 'legacy' | 'blended' } => {
                if (signals.length === 0) {
                    return { value: legacyVal, source: 'legacy' };
                }
                const avgSignal = signals.reduce((s, v) => s + v, 0) / signals.length;
                if (!hasLegacyBase) {
                    return {
                        value: Math.max(0, Math.min(100, Math.round(avgSignal))),
                        source: 'blended',
                    };
                }
                const denom = Math.max(1, referenceTotal);
                const coverage = Math.min(1, signals.length / denom);
                const weight = 0.18 + 0.27 * coverage; // 18%..45% proportional to journal signal coverage
                return {
                    value: Math.max(0, Math.min(100, Math.round(legacyVal * (1 - weight) + avgSignal * weight))),
                    source: 'blended',
                };
            };

            const consistencyResult = blendWithLegacy(
                legacyConsistency,
                consistencySignals,
                Math.max(1, tradingDays.length),
                tradingDays.length > 0
            );
            const consistencyScore = consistencyResult.value;

            // If broker/import does not populate SL (tradesWithSl === 0) AND journal risk signals exist,
            // avoid penalizing absent SL as 0 before blending with journal risk signals.
            let effectiveRiskBase = legacyRiskManagement;
            if (riskSignals.length > 0 && tradesWithSl === 0) {
                const avgRiskSig = riskSignals.reduce((s, v) => s + v, 0) / riskSignals.length;
                const riskCov = Math.min(1, riskSignals.length / Math.max(1, totalTrades));
                const inferredSlSlot = payoffComponent * (1 - riskCov) + avgRiskSig * riskCov;
                effectiveRiskBase = Math.round(Math.min(100, (payoffComponent * 0.6) + (inferredSlSlot * 0.4)));
            }
            const riskResult = blendWithLegacy(
                effectiveRiskBase,
                riskSignals,
                Math.max(1, totalTrades),
                true
            );
            const riskManagementScore = riskResult.value;

            const disciplineResult = blendWithLegacy(
                legacyDiscipline,
                disciplineSignals,
                Math.max(1, totalTrades),
                volumes.length > 0
            );
            const disciplineScore = disciplineResult.value;

            const profitFactorScore = grossLoss === 0
                ? (grossProfit > 0 ? 100 : 0)
                : Math.max(0, Math.min(100, Math.round((profitFactor / 2.5) * 100)));

            // Net profit retention efficiency (0-100): distinct from raw PF ratio
            const netRetention = grossProfit > 0 ? Math.max(0, (grossProfit - grossLoss) / grossProfit) : 0;
            const profitabilityScore = Math.max(0, Math.min(100, Math.round(netRetention * 125)));

            const radarMetrics = {
                consistency: consistencyScore,
                riskManagement: riskManagementScore,
                discipline: disciplineScore,
                profitability: profitabilityScore,
                winRate: Number(winRate.toFixed(1)),
                profitFactorScore
            };

            const usedJournalSignals =
                consistencyResult.source === 'blended' ||
                riskResult.source === 'blended' ||
                disciplineResult.source === 'blended';

            const radarTips: string[] = [];
            if (planTotalCount > 0) {
                const pctPlan = Math.round((planYesCount / planTotalCount) * 100);
                radarTips.push(`Plano seguido em ${pctPlan}% dos trades avaliados no Diário`);
            }
            if (impulseDriverCount > 0) {
                radarTips.push(`${impulseDriverCount} entrada(s) por impulso impactaram a Disciplina`);
            } else if (strategyDriverCount > 0) {
                radarTips.push(`${strategyDriverCount} entrada(s) confirmadas por Estratégia no Diário`);
            }
            if (riskComfortTotalCount > 0) {
                const pctRisk = Math.round((riskComfortYesCount / riskComfortTotalCount) * 100);
                radarTips.push(`${pctRisk}% de conforto com o risco registrado nas notas`);
            } else if (excursionTrackedCount > 0) {
                radarTips.push(`Excursão MFE/MAE considerada em ${excursionTrackedCount} trade(s)`);
            }
            if (lowFocusOrHighStressDays > 0 && radarTips.length < 3) {
                radarTips.push(`${lowFocusOrHighStressDays} pregão(ões) com alerta de foco frágil ou estresse elevado`);
            } else if (rulesBrokenDays > 0 && radarTips.length < 3) {
                radarTips.push(`Quebra de regras registrada em ${rulesBrokenDays} dia(s)`);
            } else if (usedJournalSignals && radarTips.length === 0) {
                radarTips.push(`Enriquecido com ${annotatedDaysCount} dia(s) e ${annotatedTradesCount} nota(s) do Diário`);
            }

            const radarMeta = {
                usedJournalSignals,
                annotatedTrades: annotatedTradesCount,
                annotatedDays: annotatedDaysCount,
                sources: {
                    consistency: consistencyResult.source,
                    riskManagement: riskResult.source,
                    discipline: disciplineResult.source,
                },
                tips: radarTips.slice(0, 3),
            };

            const rawTorexScore = (
                profitabilityScore * 0.20 +
                consistencyScore * 0.20 +
                riskManagementScore * 0.20 +
                disciplineScore * 0.15 +
                Math.min(100, winRate) * 0.125 +
                profitFactorScore * 0.125
            );
            const torexScore = Number(Math.max(0, Math.min(100, rawTorexScore)).toFixed(2));

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
                avgWin: Number(avgWin.toFixed(2)),
                avgLoss: Number(avgLoss.toFixed(2)),
                payoffRatio: Number(payoffRatio.toFixed(2)),
                torexScore,
                radarMetrics,
                radarMeta,
                dailyPnL: Array.from(dailyMap.entries()).map(([date, d]) => ({
                    date,
                    pnl: Number(d.pnl.toFixed(2)),
                    value: Number(d.pnl.toFixed(2)),
                    trades: d.count,
                    wins: d.wins,
                    losses: d.losses,
                    winRate: d.count > 0 ? Number(((d.wins / d.count) * 100).toFixed(1)) : 0,
                    hasNotes: d.hasNotes
                })),
                tradePnL: trades.slice(-25).map(t => ({
                    date: t.closeTime ? new Date(t.closeTime).toISOString() : null,
                    value: Number(((Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0)).toFixed(2)),
                    ticket: t.ticket ? String(t.ticket) : String(t.id || '').slice(0, 8).toUpperCase()
                })),
                distribution: { wins, losses, breakeven: breakevens },
                byMood: Array.from(moodMap.entries()).map(([mood, data]) => ({ mood, count: data.count, pnl: Number(data.pnl.toFixed(2)) })),
                bySetup: Array.from(setupMap.entries()).map(([setup, data]) => ({ setup, count: data.count, pnl: Number(data.pnl.toFixed(2)) })),
                bySession: Array.from(sessionMap.entries()).map(([session, data]) => ({ session, count: data.count, wins: data.wins, pnl: Number(data.pnl.toFixed(2)) })),
                bySymbol: Array.from(symbolMap.entries())
                    .map(([symbol, d]) => ({ symbol, count: d.count, wins: d.wins, losses: d.losses, pnl: Number(d.pnl.toFixed(2)) }))
                    .sort((a, b) => b.count - a.count),
                byWeekday: Array.from(weekdayMap.entries())
                    .map(([weekday, d]) => ({ weekday, count: d.count, wins: d.wins, pnl: Number(d.pnl.toFixed(2)) }))
                    .sort((a, b) => a.weekday - b.weekday),
                availableSymbols,
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
                totalPnL: 0,
                winRate: 0,
                totalTrades: 0,
                profitFactor: 0,
                avgWin: 0,
                avgLoss: 0,
                payoffRatio: 0,
                torexScore: 0,
                radarMetrics: {
                    consistency: 0,
                    riskManagement: 0,
                    discipline: 0,
                    profitability: 0,
                    winRate: 0,
                    profitFactorScore: 0
                },
                dailyPnL: [],
                tradePnL: [],
                distribution: { wins: 0, losses: 0, breakeven: 0 },
                byMood: [],
                bySetup: [],
                bySession: [],
                bySymbol: [],
                byWeekday: [],
                availableSymbols: []
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

        const savedMental = await this.mentalLogRepo.save(log);
        await this.invalidateUserCache(userId);
        return savedMental;
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

        const savedMental = await this.mentalLogRepo.save(log);
        await this.invalidateUserCache(userId);
        return savedMental;
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

        const savedJournal = await this.techJournalRepo.save(journal);
        await this.invalidateUserCache(userId);
        return savedJournal;
    }

    async getTradeDetails(userId: string, id: string) {
        const accounts = await this.accountRepo.find({ where: { userId } });
        if (accounts.length === 0) throw new NotFoundException('Conta não encontrada');

        const accountIds = accounts.map(a => a.id);

        let trade: any = null;
        try {
            if (this.isValidUuid(id)) {
                trade = await this.tradeRepo.findOne({
                    where: { id: id, accountId: In(accountIds) }
                });
            }

            if (!trade) {
                trade = await this.tradeRepo.findOne({
                    where: [
                        { ticket: id, accountId: In(accountIds) },
                        { contractId: id, accountId: In(accountIds) }
                    ]
                });
            }

            // Fallback para posições abertas clicadas a partir do /journal
            if (!trade) {
                let pos: PositionEntity | null = null;
                if (this.isValidUuid(id)) {
                    pos = await this.positionRepo.findOne({
                        where: { id: id, accountId: In(accountIds) }
                    });
                }
                if (!pos) {
                    const cleanPosId = id.startsWith('pos-') ? id.slice(4) : id;
                    pos = await this.positionRepo.findOne({
                        where: { ticket: cleanPosId, accountId: In(accountIds) }
                    });
                }
                if (pos) {
                    const rawType = String(pos.type || 'BUY').toUpperCase();
                    trade = {
                        id: pos.id,
                        ticket: pos.ticket,
                        accountId: pos.accountId,
                        symbol: pos.symbol,
                        type: rawType.includes('SELL') || rawType.includes('PUT') ? 'SELL' : 'BUY',
                        volume: Number(pos.volume || 0),
                        openPrice: Number(pos.openPrice || 0),
                        closePrice: Number(pos.currentPrice || pos.openPrice || 0),
                        sl: pos.sl ? Number(pos.sl) : null,
                        tp: pos.tp ? Number(pos.tp) : null,
                        openTime: pos.openTime || new Date(),
                        closeTime: pos.openTime || new Date(),
                        profit: Number(pos.profit || 0),
                        commission: Number((pos as any).commission || 0),
                        swap: Number((pos as any).swap || 0),
                        comment: '',
                        status: 'OPEN',
                    };
                }
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

        // Get tradeNote, dailyNote, technicalJournal and mentalLog for trade date
        const tradeDate = trade.closeTime
            ? new Date(trade.closeTime).toISOString().split('T')[0]
            : (trade.openTime ? new Date(trade.openTime).toISOString().split('T')[0] : null);

        const lookupIds = Array.from(
            new Set([String(trade.id || ''), String(trade.ticket || '')].filter(Boolean))
        );

        let tradeNote: TradeNoteEntity | null = null;
        if (lookupIds.length > 0) {
            tradeNote = await this.tradeNoteRepo
                .findOne({
                    where: { userId, tradeId: In(lookupIds) },
                    order: { updatedAt: 'DESC' },
                })
                .catch(() => null);
        }

        let dailyNote: DailyNoteEntity | null = null;
        let technicalJournal: TechnicalJournal | null = null;
        let mentalLog: MentalLog | null = null;

        if (tradeDate) {
            const candidateDailyNotes = await this.dailyNoteRepo
                .find({
                    where: { userId, date: tradeDate },
                    order: { updatedAt: 'DESC' },
                })
                .catch(() => [] as DailyNoteEntity[]);

            dailyNote =
                candidateDailyNotes.find((d) => d.accountKey === String(trade.accountId)) ||
                candidateDailyNotes.find((d) => d.accountKey === 'all') ||
                candidateDailyNotes[0] ||
                null;

            technicalJournal = await this.techJournalRepo.findOne({
                where: { accountId: trade.accountId, date: tradeDate }
            });
            if (!technicalJournal && accountIds.length > 0) {
                technicalJournal = await this.techJournalRepo.findOne({
                    where: { accountId: In(accountIds), date: tradeDate }
                });
            }

            mentalLog = await this.mentalLogRepo.findOne({
                where: { accountId: trade.accountId, date: tradeDate },
                order: { createdAt: 'DESC' },
            });
            if (!mentalLog && accountIds.length > 0) {
                mentalLog = await this.mentalLogRepo.findOne({
                    where: { accountId: In(accountIds), date: tradeDate },
                    order: { createdAt: 'DESC' },
                });
            }
        }

        const tradeNotePlain = this.stripHtmlText(tradeNote?.content);
        const dailyNotePlain = this.stripHtmlText(dailyNote?.content);

        const hasOwnTradeAnnotation = Boolean(
            tradeNotePlain ||
                tradeNote?.mistakes ||
                tradeNote?.lessons ||
                trade.lesson
        );
        const hasDailyContext = Boolean(
            dailyNotePlain ||
                dailyNote?.marketBias ||
                dailyNote?.title ||
                dailyNote?.mood ||
                (dailyNote?.psychCheck && Object.values(dailyNote.psychCheck).some(Boolean)) ||
                technicalJournal ||
                mentalLog
        );

        const annotationSource: 'trade' | 'daily' | 'none' = hasOwnTradeAnnotation
            ? 'trade'
            : hasDailyContext
            ? 'daily'
            : 'none';

        const tradeShots =
            tradeNote?.screenshots && tradeNote.screenshots.length > 0
                ? tradeNote.screenshots
                : tradeNote?.screenshotUrl
                ? [tradeNote.screenshotUrl]
                : [];
        const dailyShots = Array.isArray(dailyNote?.images) ? dailyNote!.images : [];
        const effectiveScreenshots = tradeShots.length > 0 ? tradeShots : dailyShots;
        const imageSource: 'trade' | 'daily' | 'none' =
            tradeShots.length > 0 ? 'trade' : dailyShots.length > 0 ? 'daily' : 'none';

        const effectiveSetup =
            tradeNote?.setup ||
            trade.setup ||
            dailyNote?.title ||
            technicalJournal?.strategyUsed ||
            '';
        const effectiveMood =
            tradeNote?.psychCheck?.feeling ||
            trade.mood ||
            dailyNote?.psychCheck?.moodState ||
            dailyNote?.mood ||
            technicalJournal?.emotionalState ||
            '';
        const effectiveRating5 = Number(
            tradeNote?.rating || trade.rating || (technicalJournal?.rating ? Math.round(technicalJournal.rating / 2) : 0)
        );
        const effectiveRating10 =
            tradeNote?.rating
                ? tradeNote.rating * 2
                : technicalJournal?.rating || (trade.rating ? Number(trade.rating) * 2 : 0);

        // Mescla Análise Técnica: usa nota do trade quando houver, ou espalha o Diário do Dia
        let mergedTechnicalJournal: any = null;
        if (
            technicalJournal ||
            hasOwnTradeAnnotation ||
            effectiveSetup ||
            dailyNotePlain ||
            dailyNote?.marketBias
        ) {
            mergedTechnicalJournal = {
                marketTrend: dailyNote?.marketBias || technicalJournal?.marketTrend || '',
                volatility: technicalJournal?.volatility || '',
                strategyUsed: effectiveSetup || 'Não especificado',
                mistakes: tradeNote?.mistakes || technicalJournal?.mistakes || '',
                lessons:
                    tradeNote?.lessons ||
                    trade.lesson ||
                    technicalJournal?.lessons ||
                    '',
                rating: effectiveRating10,
                notes: hasOwnTradeAnnotation
                    ? tradeNotePlain
                    : dailyNotePlain || technicalJournal?.notes || '',
                entryPrecision:
                    tradeNote?.psychCheck?.entryDriver ||
                    technicalJournal?.entryPrecision ||
                    '',
                riskManagement:
                    tradeNote?.psychCheck?.riskComfort
                        ? `Confortável: ${tradeNote.psychCheck.riskComfort}`
                        : technicalJournal?.riskManagement || '',
                tradeExit: technicalJournal?.tradeExit || '',
                emotionalState: effectiveMood || '',
                setupQuality:
                    tradeNote?.psychCheck?.followingPlan
                        ? `Plano: ${tradeNote.psychCheck.followingPlan}`
                        : technicalJournal?.setupQuality || '',
                executionSpeed: technicalJournal?.executionSpeed || '',
                marketContext:
                    dailyNote?.marketBias || technicalJournal?.marketContext || '',
                preMarketPrep: dailyNote?.title || technicalJournal?.preMarketPrep || '',
                rulesBroken:
                    tradeNote?.psychCheck?.followingPlan === 'Não'
                        ? 'Operou fora do plano de trading'
                        : technicalJournal?.rulesBroken || '',
                actionPlan: technicalJournal?.actionPlan || '',
            };
        }

        // Mescla Gestão Emocional: combina MentalLog + DailyNote psychCheck + TradeNote psychCheck
        const mappedScores = this.mapDailyPsychToMentalScores(
            dailyNote?.psychCheck,
            effectiveMood
        );
        const hasTradePsych = Boolean(
            tradeNote?.psychCheck && Object.values(tradeNote.psychCheck).some(Boolean)
        );
        const hasDailyPsych = Boolean(
            dailyNote?.psychCheck && Object.values(dailyNote.psychCheck).some(Boolean)
        );

        let mergedMentalLog: any = null;
        if (mentalLog || hasDailyPsych || hasTradePsych || effectiveMood) {
            const sleepVal = mentalLog?.sleepQuality ?? mappedScores.sleepQuality ?? 6;
            let energyVal = mentalLog?.energy ?? mappedScores.energy ?? 6;
            let focusVal = mentalLog?.focus ?? mappedScores.focus ?? 6;
            let moodVal = mentalLog?.mood ?? mappedScores.mood ?? 6;
            let stressVal = mentalLog?.stress ?? mappedScores.stress ?? 5;
            const caffeineVal = mentalLog?.caffeine ?? mappedScores.caffeine ?? 0;

            if (!mentalLog && !hasDailyPsych && hasTradePsych) {
                if (tradeNote?.psychCheck?.feeling === 'Calmo') {
                    moodVal = 9;
                    stressVal = 3;
                } else if (tradeNote?.psychCheck?.feeling === 'Ansioso') {
                    moodVal = 4;
                    stressVal = 8;
                }
                if (tradeNote?.psychCheck?.followingPlan === 'Sim') {
                    focusVal = 8;
                } else if (tradeNote?.psychCheck?.followingPlan === 'Não') {
                    focusVal = 4;
                }
                if (tradeNote?.psychCheck?.entryDriver === 'Estratégia') {
                    energyVal = 8;
                } else if (tradeNote?.psychCheck?.entryDriver === 'Impulso') {
                    stressVal = Math.max(stressVal, 8);
                }
            }

            const rawOverall =
                mentalLog?.overallScore ??
                Number(
                    ((sleepVal + energyVal + focusVal + moodVal + (11 - stressVal)) / 5).toFixed(2)
                );
            const overallScore100 =
                rawOverall <= 10 ? Math.round(rawOverall * 10) : Math.round(rawOverall);

            mergedMentalLog = {
                sleepQuality: sleepVal,
                energy: energyVal,
                focus: focusVal,
                mood: moodVal,
                stress: stressVal,
                caffeine: caffeineVal,
                overallScore: overallScore100,
                notes:
                    mentalLog?.notes ||
                    dailyNotePlain ||
                    (hasOwnTradeAnnotation ? tradeNotePlain : '') ||
                    '',
            };
        }

        const tradeObj = {
            ...trade,
            setup: effectiveSetup || trade.setup || null,
            mood: effectiveMood || trade.mood || null,
            rating: effectiveRating5,
            lesson:
                trade.lesson ||
                tradeNote?.lessons ||
                tradeNotePlain ||
                dailyNotePlain ||
                null,
            mfe: trade.mfe !== undefined && trade.mfe !== null ? Number(trade.mfe) : null,
            mae: trade.mae !== undefined && trade.mae !== null ? Number(trade.mae) : null,
            marketBias: dailyNote?.marketBias || technicalJournal?.marketTrend || null,
            annotationSource,
            journalNotes: hasOwnTradeAnnotation
                ? tradeNotePlain || trade.lesson || ''
                : dailyNotePlain || technicalJournal?.notes || '',
            siblings: siblingTrades.filter(s => s.id !== trade.id)
        };

        return {
            ...tradeObj,
            trade: tradeObj,
            tradeNote: tradeNote
                ? {
                      id: tradeNote.id,
                      tradeId: tradeNote.tradeId,
                      content: tradeNote.content || '',
                      screenshotUrl: tradeNote.screenshotUrl || null,
                      screenshots: Array.isArray(tradeNote.screenshots) ? tradeNote.screenshots : [],
                      setup: tradeNote.setup || null,
                      mistakes: tradeNote.mistakes || null,
                      lessons: tradeNote.lessons || null,
                      rating: tradeNote.rating || 0,
                      psychCheck: tradeNote.psychCheck || {},
                      updatedAt: tradeNote.updatedAt,
                  }
                : null,
            dailyNote: dailyNote
                ? {
                      id: dailyNote.id,
                      date: String(dailyNote.date).slice(0, 10),
                      title: dailyNote.title || null,
                      content: dailyNote.content || '',
                      mood: dailyNote.mood || null,
                      marketBias: dailyNote.marketBias || null,
                      psychCheck: dailyNote.psychCheck || {},
                      images: Array.isArray(dailyNote.images) ? dailyNote.images : [],
                      updatedAt: dailyNote.updatedAt,
                  }
                : null,
            annotationSource,
            imageSource,
            effectiveScreenshots,
            technicalJournal: mergedTechnicalJournal,
            mentalLog: mergedMentalLog
        };
    }

    async updateTradeMetadata(
        userId: string,
        id: string,
        data: { session?: string, mood?: string, rating?: number, setup?: string, lesson?: string, tags?: string[] },
        clientUpdatedAt?: string,
    ) {
        const accounts = await this.accountRepo.find({ where: { userId } });
        if (accounts.length === 0) throw new NotFoundException('Conta não encontrada');

        const accountIds = accounts.map(a => a.id);
        let trade: any = null;
        try {
            if (this.isValidUuid(id)) {
                trade = await this.tradeRepo.findOne({
                    where: { id: id, accountId: In(accountIds) }
                });
            }
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

        if (clientUpdatedAt && trade.updatedAt instanceof Date) {
            const clientMs = Date.parse(clientUpdatedAt);
            if (
                Number.isFinite(clientMs) &&
                trade.updatedAt.getTime() > clientMs + 1000
            ) {
                return trade;
            }
        }

        if (data.session !== undefined) trade.session = data.session;
        if (data.mood !== undefined) trade.mood = data.mood;
        if (data.rating !== undefined) trade.rating = data.rating;
        if (data.setup !== undefined) trade.setup = data.setup;
        if (data.lesson !== undefined) trade.lesson = data.lesson;
        if (data.tags !== undefined) trade.tags = data.tags;

        const updated = await this.tradeRepo.save(trade);

        // Sincroniza também com TradeNoteEntity (/journal) para consistência bidirecional
        try {
            let tn = await this.tradeNoteRepo.findOne({
                where: { userId, tradeId: String(trade.id) },
            });
            if (tn || data.setup || data.lesson || data.rating || data.mood) {
                if (!tn) {
                    tn = this.tradeNoteRepo.create({
                        userId,
                        tradeId: String(trade.id),
                        content: data.lesson ? `<p>${data.lesson}</p>` : '',
                        screenshots: [],
                        setup: data.setup ?? trade.setup ?? null,
                        lessons: data.lesson ?? trade.lesson ?? null,
                        rating: data.rating !== undefined ? Number(data.rating) || 0 : trade.rating || 0,
                        psychCheck: data.mood ? { feeling: data.mood } : {},
                    });
                } else {
                    if (data.setup !== undefined) tn.setup = data.setup || null;
                    if (data.rating !== undefined) tn.rating = Number(data.rating) || 0;
                    if (data.lesson !== undefined) {
                        tn.lessons = data.lesson || null;
                        if (!this.stripHtmlText(tn.content) && data.lesson) {
                            tn.content = `<p>${data.lesson}</p>`;
                        }
                    }
                    if (data.mood !== undefined && data.mood) {
                        tn.psychCheck = {
                            ...(tn.psychCheck || {}),
                            feeling: data.mood,
                        };
                    }
                }
                await this.tradeNoteRepo.save(tn);
            }
        } catch (tnErr) {
            this.logger.warn(`TradeNote sync warning on updateTradeMetadata: ${(tnErr as Error).message}`);
        }

        await this.invalidateUserCache(userId);

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
        return this.getPeriodSummary(userId, 7, accountId);
    }

    async getMonthlySummary(userId: string, accountId?: string) {
        return this.getPeriodSummary(userId, 30, accountId);
    }

    private async getPeriodSummary(userId: string, days: number, accountId?: string) {
        const { accountIds } = await this.validateUserAccount(userId, accountId);
        if (accountIds.length === 0) return null;

        const periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - days);

        const trades = await this.tradeRepo.find({
            where: {
                accountId: In(accountIds),
                status: 'CLOSED',
                closeTime: MoreThanOrEqual(periodStart)
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
                start: periodStart.toISOString(),
                end: new Date().toISOString()
            }
        };
    }

    async invalidateUserCache(userId: string) {
        try {
            const currentVer = await this.getUserCacheVersion(userId);
            const nextVer = currentVer + 1;
            this.setUserCacheVersion(userId, nextVer);
            await this.cacheManager.set(`dashboard:ver:${userId}`, nextVer, 86400000);
        } catch (e) {
            console.warn(`[DashboardService] Cache invalidation warning for user ${userId}:`, e.message);
        }
    }

    async getReportData(
        userId: string,
        accountId?: string,
        startDate?: string,
        endDate?: string,
        symbolFilter?: string,
        typeFilter?: string,
        filters?: { symbols?: string; side?: string; sessions?: string; outcome?: string }
    ) {
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
                availableSymbols: [],
                trades: []
            };
        }

        const ver = await this.getUserCacheVersion(userId);
        const fp = await this.getTradesDataFingerprint(accountIds);
        const filterSig = [
            symbolFilter || 'ALL',
            typeFilter || 'ALL',
            filters?.symbols || '',
            filters?.side || '',
            filters?.sessions || '',
            filters?.outcome || '',
        ].join('|');
        const reportCacheKey = `dashboard:report:${userId}:v${ver}:${fp}:${accountId || 'all'}:${startDate || 'all'}:${endDate || 'all'}:${filterSig}`;
        try {
            const cachedReport = await this.cacheManager.get(reportCacheKey);
            if (cachedReport) {
                return cachedReport;
            }
        } catch {}

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

        const fetchedTrades = await this.tradeRepo.find({
            where: whereClause,
            select: [
                'id',
                'accountId',
                'ticket',
                'symbol',
                'type',
                'volume',
                'openPrice',
                'closePrice',
                'sl',
                'tp',
                'profit',
                'commission',
                'swap',
                'openTime',
                'closeTime',
                'session',
                'mood',
                'rating',
                'setup',
                'lesson',
                'mfe',
                'mae',
            ],
            order: { closeTime: 'ASC' }
        });

        const availableSymbols = Array.from(
            new Set(
                fetchedTrades
                    .map(t => String(t.symbol || '').trim())
                    .filter(s => s && s !== 'Unknown')
            )
        ).sort((a, b) => a.localeCompare(b));

        const symbolSet = new Set(
            (filters?.symbols || '')
                .split(',')
                .map(s => s.trim().toUpperCase())
                .filter(Boolean)
        );
        const rawSide = String(filters?.side || 'ALL').trim().toUpperCase();
        const sideNorm = rawSide === 'BUY' || rawSide === 'SELL' ? rawSide : 'ALL';
        const sessionSet = new Set(
            (filters?.sessions || '')
                .split(',')
                .map(s => s.trim().toLowerCase())
                .filter(Boolean)
        );
        const rawOutcome = String(filters?.outcome || 'ALL').trim().toUpperCase();
        const outcomeNorm = rawOutcome === 'WIN' || rawOutcome === 'LOSS' || rawOutcome === 'BE' ? rawOutcome : 'ALL';

        const rawTrades = fetchedTrades.filter(t => {
            if (symbolSet.size > 0) {
                const sym = String(t.symbol || '').trim().toUpperCase();
                if (!symbolSet.has(sym)) return false;
            }
            if (sideNorm === 'BUY' || sideNorm === 'SELL') {
                const rawType = String(t.type || '').toUpperCase();
                const isBuy = rawType.includes('BUY') || rawType.includes('CALL') || rawType === 'LONG';
                const isSell = rawType.includes('SELL') || rawType.includes('PUT') || rawType === 'SHORT';
                if (sideNorm === 'BUY' && !isBuy) return false;
                if (sideNorm === 'SELL' && !isSell) return false;
            }
            if (sessionSet.size > 0) {
                const bucket = this.resolveSessionBucket(t.session);
                if (!sessionSet.has(bucket)) return false;
            }
            if (outcomeNorm === 'WIN' || outcomeNorm === 'LOSS' || outcomeNorm === 'BE') {
                const pnl = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
                if (outcomeNorm === 'WIN' && !(pnl > 0.001)) return false;
                if (outcomeNorm === 'LOSS' && !(pnl < -0.001)) return false;
                if (outcomeNorm === 'BE' && !(Math.abs(pnl) <= 0.001)) return false;
            }
            return true;
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
        const dayOfWeekMap = new Map<string, { day: string, weekday: number, trades: number, wins: number, pnl: number }>();

        const daysNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        for (let i = 1; i <= 5; i++) {
            dayOfWeekMap.set(daysNames[i], { day: daysNames[i], weekday: i, trades: 0, wins: 0, pnl: 0 });
        }

        const accMap = new Map(accounts.map(a => [a.id, a]));
        const normalizeAdvMultiCurrency =
            isConsolidated &&
            new Set(accounts.map(a => String(a.currency || 'USD').trim().toUpperCase())).size > 1;
        const totalTradesPnl = rawTrades.reduce((sum, t) => {
            const rawPnl = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
            const tAccId = String(t.accountId || (t as any).account_id || '');
            const fx = normalizeAdvMultiCurrency ? this.getUsdConversionFactor(accMap.get(tAccId)?.currency) : 1;
            return sum + rawPnl * fx;
        }, 0);
        const rawStartBalance = isConsolidated 
            ? accounts.reduce((sum, a) => {
                const initBal = Number(a.initialBalance) || 0;
                const base = initBal > 0 ? initBal : Math.max(0, Number(a.balance || 0));
                const fx = normalizeAdvMultiCurrency ? this.getUsdConversionFactor(a.currency) : 1;
                return sum + base * fx;
            }, 0)
            : (Number(targetAccount?.initialBalance) > 0
                ? Number(targetAccount?.initialBalance)
                : Math.max(0, Number(targetAccount?.balance || 0) - totalTradesPnl));
        const startBalance = Number(rawStartBalance.toFixed(2));

        let runningBalance = startBalance;
        peakEquity = startBalance;
        currentEquity = startBalance;

        for (const t of rawTrades) {
            const tAccId = String(t.accountId || (t as any).account_id || '');
            const fx = normalizeAdvMultiCurrency ? this.getUsdConversionFactor(accMap.get(tAccId)?.currency) : 1;
            const profit = (Number(t.profit) || 0) * fx;
            const comm = (Number(t.commission) || 0) * fx;
            const swap = (Number(t.swap) || 0) * fx;
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
                // UTC, consistent with the daily buckets. Weekend days appear only when traded.
                const dayIndex = new Date(t.closeTime).getUTCDay();
                const dayName = daysNames[dayIndex];
                if (!dayOfWeekMap.has(dayName)) {
                    dayOfWeekMap.set(dayName, { day: dayName, weekday: dayIndex, trades: 0, wins: 0, pnl: 0 });
                }
                {
                    const dItem = dayOfWeekMap.get(dayName)!;
                    dItem.trades += 1;
                    dItem.pnl += netPnl;
                    if (netPnl > 0) dItem.wins += 1;
                }
            }
        }

        const totalTrades = rawTrades.length;
        const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0;
        const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99.99 : 0) : Number((grossProfit / grossLoss).toFixed(2));
        const averageWin = wins > 0 ? Number((grossProfit / wins).toFixed(2)) : 0;
        const averageLoss = losses > 0 ? Number((grossLoss / losses).toFixed(2)) : 0;
        const riskRewardRatio = averageLoss > 0 ? Number((averageWin / averageLoss).toFixed(2)) : 0;
        const expectancy = totalTrades > 0 ? Number((totalNetProfit / totalTrades).toFixed(2)) : 0;
        const maxDrawdownPercent = peakEquity > 0 ? Number(((maxDrawdown / peakEquity) * 100).toFixed(1)) : 0;

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
        })).sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7)); // Mon..Sun

        const dailyPnL = Array.from(dailyMap.values()).map(d => ({
            ...d,
            pnl: Number(d.pnl.toFixed(2)),
            winRate: d.trades > 0 ? Number(((d.wins / d.trades) * 100).toFixed(1)) : 0
        })).sort((a, b) => a.date.localeCompare(b.date));

        const baseLedger = rawTrades.map(t => {
            const acc = accMap.get(t.accountId);
            const net = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
            return {
                id: t.id,
                accountId: t.accountId,
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
                lesson: t.lesson,
                mfe: t.mfe,
                mae: t.mae,
                accountName: acc?.name || 'Conta',
                accountBroker: acc?.broker || 'Corretora',
                accountType: acc?.type || 'LIVE'
            };
        }).reverse();

        // Enriquece com contexto de Diário os 500 registos mais recentes do ledger (mantendo 100% dos KPIs sobre todo o período)
        const headLedger = await this.enrichTradesWithJournalContext(
            userId,
            accountIds,
            baseLedger.slice(0, 500)
        );
        const enrichedLedger =
            baseLedger.length > 500 ? [...headLedger, ...baseLedger.slice(500)] : headLedger;

        const reportPayload = {
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
            availableSymbols,
            trades: enrichedLedger
        };

        await this.cacheManager.set(reportCacheKey, reportPayload, 120_000).catch(() => {});
        return reportPayload;
    }

    private async assertMonthlyBacktestRunQuota(userId: string): Promise<void> {
        if (!this.planPermissionService) return;
        const plan = await this.planPermissionService.getUserPlan(userId);
        if (plan === PlanTier.FREE || plan === PlanTier.BASIC) {
            throw new ForbiddenException({
                statusCode: 403,
                code: 'UPGRADE_REQUIRED',
                requiredPlan: PlanTier.PRO,
                currentPlan: plan,
                feature: 'backtesting',
                message: 'Backtesting e Trade Replay requerem o plano Pro ou Premium.',
            });
        }

        const monthlyLimit = plan === PlanTier.PRO ? 10 : plan === PlanTier.PREMIUM ? 100 : null;
        if (!monthlyLimit) return;

        const now = new Date();
        const monthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
        const usedRunsThisMonth = await this.backtestRepo.count({
            where: {
                userId,
                mode: Not('STRATEGY_DEFINITION'),
                createdAt: MoreThanOrEqual(monthStartUtc),
            },
        });

        if (usedRunsThisMonth >= monthlyLimit) {
            throw new ForbiddenException({
                statusCode: 403,
                code: 'BACKTEST_MONTHLY_QUOTA_EXCEEDED',
                requiredPlan: PlanTier.PREMIUM,
                currentPlan: plan,
                monthlyLimit,
                usedRunsThisMonth,
                feature: 'backtesting',
                message:
                    plan === PlanTier.PRO
                        ? `Você atingiu o limite de ${monthlyLimit} sessões de backteste este mês no plano Pro. Faça upgrade para o plano Premium para liberar até 100 sessões/mês.`
                        : `Você atingiu o limite de ${monthlyLimit} sessões de backteste este mês no plano Premium.`,
            });
        }
    }

    async simulateBacktest(userId: string, accountId: string, config: any) {
        await this.assertMonthlyBacktestRunQuota(userId);
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

            const quantUrl = process.env.QUANT_ENGINE_URL?.trim();
            if (quantUrl) {
                try {
                    const pyRes = await fetch(`${quantUrl.replace(/\/$/, '')}/api/quant/simulate/what-if`, {
                        method: 'POST',
                        headers: getQuantInternalHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify({
                            trades: rawTrades.map((t: any) => ({
                                id: t.id ? String(t.id) : undefined,
                                ticket: t.ticket ?? undefined,
                                symbol: t.symbol || 'XAUUSD',
                                type: t.type || 'BUY',
                                profit: Number(t.profit || 0),
                                commission: Number(t.commission || 0),
                                swap: Number(t.swap || 0),
                                netPnl: t.netPnl !== undefined && t.netPnl !== null ? Number(t.netPnl) : undefined,
                                closeTime: t.closeTime ? new Date(t.closeTime).toISOString() : undefined,
                                session: t.session || undefined,
                            })),
                            initialBalance,
                            riskPerTrade: riskPercent,
                            rrTarget,
                            excludeAsian,
                            excludeFridays,
                            accountName: targetAccount?.name || 'Conta',
                            accountCurrency: targetAccount?.currency || 'USD',
                            locale: 'pt',
                        }),
                        signal: AbortSignal.timeout(3000),
                    });
                    if (pyRes.ok) {
                        const pyPayload = await pyRes.json();
                        return { ...pyPayload, config };
                    }
                } catch (err) {
                    this.logger.warn(`Quant Engine What-If fallback to local TS: ${(err as Error).message}`);
                }
            }

            let simEquity = initialBalance;
            let realEquity = initialBalance;
            let simWins = 0;
            let simLosses = 0;
            let simGrossProfit = 0;
            let simGrossLoss = 0;
            let realNetProfit = 0;
            let simPeakEquity = initialBalance;
            let simMaxDrawdown = 0;
            // Real-account metrics, so the comparison is like for like.
            let realWins = 0;
            let realLosses = 0;
            let realGrossProfit = 0;
            let realGrossLoss = 0;
            let realPeakEquity = initialBalance;
            let realMaxDrawdown = 0;
            let excludedTrades = 0;
            let breakevenTrades = 0;

            // Session tags hold every market open at the trade's OPEN hour, e.g.
            // "Sydney / Tokyo" or "Tokyo / London": Asian = no London/NY overlap.
            const isAsianTag = (tag: string) => {
                const v = (tag || '').toLowerCase();
                if (/london|new york|\bny\b/.test(v)) return false;
                return /sydney|tokyo|asia/.test(v);
            };

            const equityCurve: any[] = [];
            const simulatedTradeLog: any[] = [];

            for (const t of rawTrades) {
                const origPnl = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
                realNetProfit += origPnl;
                realEquity += origPnl;
                if (origPnl > 0) { realWins++; realGrossProfit += origPnl; }
                else if (origPnl < 0) { realLosses++; realGrossLoss += -origPnl; }
                if (realEquity > realPeakEquity) realPeakEquity = realEquity;
                realMaxDrawdown = Math.max(realMaxDrawdown, realPeakEquity - realEquity);

                const closeDate = t.closeTime ? new Date(t.closeTime) : null;
                const isAsian = isAsianTag(t.session);
                // Weekday in UTC, like the rest of the dashboard.
                const isFriday = closeDate ? closeDate.getUTCDay() === 5 : false;
                const dateStr = closeDate ? closeDate.toISOString().split('T')[0] : 'N/A';

                if ((excludeAsian && isAsian) || (excludeFridays && isFriday)) {
                    excludedTrades++;
                    // Keep the point so both curves share the same x axis.
                    equityCurve.push({
                        date: dateStr,
                        ticket: t.ticket || t.id,
                        realEquity: Number(realEquity.toFixed(2)),
                        simulatedEquity: Number(simEquity.toFixed(2)),
                        realPnl: Number(origPnl.toFixed(2)),
                        simulatedPnl: 0,
                        excluded: true,
                    });
                    continue;
                }
                if (origPnl === 0) breakevenTrades++;

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
            const simProfitFactor = simGrossLoss === 0 ? null : Number((simGrossProfit / simGrossLoss).toFixed(2));
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
                initialBalance,
                realWinRate: realWins + realLosses > 0 ? Number(((realWins / (realWins + realLosses)) * 100).toFixed(1)) : 0,
                realProfitFactor: realGrossLoss === 0 ? null : Number((realGrossProfit / realGrossLoss).toFixed(2)),
                realMaxDrawdown: Number(realMaxDrawdown.toFixed(2)),
                realMaxDrawdownPercent: realPeakEquity > 0 ? Number(((realMaxDrawdown / realPeakEquity) * 100).toFixed(1)) : 0,
                excludedTrades,
                breakevenTrades,
            };

            // Factual statements only: what changed and why, no claims we didn't measure.
            const insights: string[] = [];
            const delta = simNetProfit - realNetProfit;
            insights.push(`${delta >= 0 ? 'A hipótese melhora' : 'A hipótese piora'} o resultado em ${delta >= 0 ? '+' : '−'}$${Math.abs(delta).toFixed(2)} face ao real.`);
            if (excludedTrades > 0) insights.push(`${excludedTrades} de ${rawTrades.length} trades foram excluídos pelos filtros.`);
            if (breakevenTrades > 0) insights.push(`${breakevenTrades} trades a zero ficaram sem resultado na simulação.`);
            const breakEvenWr = 100 / (1 + rrTarget);
            insights.push(`Com alvo 1:${rrTarget}, a taxa de acerto de equilíbrio é ${breakEvenWr.toFixed(1)}%; a amostra tem ${simWinRate}%.`);

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
            // Strategy Sim with deterministic seeded PRNG (Mulberry32) & realistic R-multiple variance
            const symbol = config?.symbol || 'EURUSD';
            const strategy = config?.strategy || 'MACD Cross';
            const totalSimTrades = Math.max(1, Number(config?.totalTrades) || 40);
            const winRateTarget = Number(config?.targetWinRate) || 55;
            const rr = Number(config?.rrTarget) || 2.0;
            const riskPercent = Number(config?.riskPerTrade) || 1.5;

            const seedSource =
                config?.seed !== undefined && Number.isFinite(Number(config.seed))
                    ? String(config.seed)
                    : `${userId}:${symbol}:${strategy}:${totalSimTrades}:${winRateTarget}:${rr}:${riskPercent}`;
            let seedHash = 2166136261;
            for (let k = 0; k < seedSource.length; k++) {
                seedHash ^= seedSource.charCodeAt(k);
                seedHash = Math.imul(seedHash, 16777619);
            }
            let prngState = (seedHash >>> 0) || 1;
            const nextRand = () => {
                prngState = (prngState + 0x6d2b79f5) | 0;
                let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };

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
                const isWin = nextRand() * 100 < winRateTarget;
                let pnl = 0;

                if (isWin) {
                    const winFactor = 0.85 + nextRand() * 0.3; // [0.85R, 1.15R] around target RR
                    pnl = riskAmount * rr * winFactor;
                    wins++;
                    grossProfit += pnl;
                } else {
                    const lossFactor = 0.9 + nextRand() * 0.2; // [0.90R, 1.10R] slippage/partial stop variance
                    pnl = -(riskAmount * lossFactor);
                    losses++;
                    grossLoss += Math.abs(pnl);
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
        if (data?.mode === 'ACCOUNT_HISTORY' || data?.mode === 'STRATEGY_SIM') {
            return this.saveBacktestHypothesis(userId, data);
        }
        return this.syncReplaySessionState(userId, data);
    }

    private async loadSessionBlobSafe(
        userId: string,
        sessionId?: string | null
    ): Promise<BacktestSessionBlobEntity | null> {
        if (!this.sessionBlobRepo || !sessionId || !this.isValidUuid(sessionId)) return null;
        try {
            return await this.sessionBlobRepo.findOne({ where: { sessionId, userId } });
        } catch {
            return null;
        }
    }

    private stripHeavyCanvasFields(cfg: Record<string, any>): Record<string, any> {
        const {
            drawings: _d,
            drawnItems: _di,
            drawingStylesById: _ds,
            overlayGeometries: _og,
            sessionScreenshots: _ss,
            journalImages: _ji,
            ...restCfg
        } = cfg || {};
        return {
            ...restCfg,
            _blobSplit: true,
        };
    }

    private rehydrateSessionWithBlob(
        session: BacktestSession,
        blob?: BacktestSessionBlobEntity | null
    ): BacktestSession {
        if (!blob) return session;
        const cfg = { ...(session.config || {}) };
        delete cfg._blobSplit;

        const cfgRev = Number(cfg.revision ?? 0);
        const blobRev = Number(blob.revision ?? 0);
        const useBlobOrders =
            Array.isArray(blob.orders) &&
            (blobRev >= cfgRev || !Array.isArray(cfg.orders) || cfg.orders.length === 0);

        const nextConfig = {
            ...cfg,
            ...(useBlobOrders ? { orders: blob.orders } : {}),
            drawings: Array.isArray(blob.drawings) ? blob.drawings : cfg.drawings || [],
            drawnItems: Array.isArray(blob.drawnItems) ? blob.drawnItems : cfg.drawnItems || [],
            drawingStylesById: blob.drawingStylesById ?? cfg.drawingStylesById ?? {},
            overlayGeometries: blob.overlayGeometries ?? cfg.overlayGeometries ?? {},
            sessionScreenshots: Array.isArray(blob.sessionScreenshots)
                ? blob.sessionScreenshots
                : cfg.sessionScreenshots || [],
            journalImages: Array.isArray(blob.journalImages)
                ? blob.journalImages
                : cfg.journalImages || [],
        };

        const nextResults = blob.quantMetrics
            ? { ...(session.results || {}), quantMetrics: blob.quantMetrics }
            : session.results;

        return {
            ...session,
            config: nextConfig,
            results: nextResults,
        } as BacktestSession;
    }

    private sanitizePathToken(raw?: string, fallback: string = 'item'): string {
        const clean = String(raw || '')
            .replace(/[^a-zA-Z0-9_-]/g, '')
            .slice(0, 80);
        return clean || fallback;
    }

    /**
     * Persists a Backtest / Replay Journal screenshot as a binary image file under
     * `/uploads/backtest-screenshots/<safeUserId>/` so session sync payloads stay tiny (<15KB).
     */
    async saveBacktestScreenshotFile(userId: string, file: any, body: any) {
        const safeUser = this.sanitizePathToken(userId, 'user');
        const safeSession = this.sanitizePathToken(body?.sessionId, 'session').slice(0, 24);
        const safeShotId = this.sanitizePathToken(
            body?.screenshotId,
            `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        );

        let buffer: Buffer | null = null;
        let ext = 'png';

        if (file?.buffer && Buffer.isBuffer(file.buffer) && file.buffer.length > 0) {
            if (file.buffer.length > 12 * 1024 * 1024) {
                throw new BadRequestException('Screenshot exceeds 12MB limit');
            }
            const mime = String(file.mimetype || '').toLowerCase();
            if (mime && !['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mime)) {
                throw new BadRequestException('Unsupported screenshot image format');
            }
            ext = mime === 'image/webp' ? 'webp' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
            buffer = file.buffer;
        } else if (typeof body?.dataUrl === 'string' && body.dataUrl.startsWith('data:image/')) {
            const match = body.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
            if (!match) {
                throw new BadRequestException('Invalid Base64 image dataUrl');
            }
            const kind = match[1].toLowerCase();
            ext = kind === 'webp' ? 'webp' : kind === 'png' ? 'png' : 'jpg';
            buffer = Buffer.from(match[2], 'base64');
            if (buffer.length > 12 * 1024 * 1024) {
                throw new BadRequestException('Screenshot exceeds 12MB limit');
            }
        }

        if (!buffer || buffer.length === 0) {
            throw new BadRequestException('No screenshot binary provided');
        }

        if (this.r2Storage) {
            const stored = await this.r2Storage.uploadPrivateObject({
                userId,
                folder: 'backtest-screenshots',
                buffer,
                ext,
            });
            return {
                ok: true,
                id: safeShotId,
                url: stored.url,
                key: stored.key,
                provider: stored.provider,
                sizeBytes: buffer.length,
            };
        }

        const userDir = path.join(process.cwd(), 'uploads', 'backtest-screenshots', safeUser);
        await fs.promises.mkdir(userDir, { recursive: true });
        const filename = `${safeSession}_${safeShotId}.${ext}`;
        const fullPath = path.join(userDir, filename);
        await fs.promises.writeFile(fullPath, buffer);

        return {
            ok: true,
            id: safeShotId,
            url: `/uploads/backtest-screenshots/${safeUser}/${filename}`,
            sizeBytes: buffer.length,
        };
    }

    /**
     * Deletes a user-owned backtest screenshot file from private R2/local storage or legacy `/uploads/backtest-screenshots/<safeUserId>/`.
     */
    async deleteBacktestScreenshotFile(userId: string, rawUrl?: string) {
        if (!rawUrl || typeof rawUrl !== 'string') {
            return { ok: false };
        }

        if (this.r2Storage && rawUrl.startsWith('/api/media/private/')) {
            const ok = await this.r2Storage.deleteByUrl(rawUrl, userId);
            return { ok };
        }

        const safeUser = this.sanitizePathToken(userId, 'user');
        const expectedPrefix = `/uploads/backtest-screenshots/${safeUser}/`;
        if (!rawUrl.startsWith(expectedPrefix)) {
            return { ok: false };
        }

        const rawFilename = rawUrl.slice(expectedPrefix.length);
        if (!rawFilename || rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
            return { ok: false };
        }

        const userDir = path.resolve(process.cwd(), 'uploads', 'backtest-screenshots', safeUser);
        const targetPath = path.resolve(userDir, rawFilename);
        if (!targetPath.startsWith(userDir)) {
            return { ok: false };
        }

        try {
            await fs.promises.unlink(targetPath);
            return { ok: true };
        } catch {
            return { ok: false };
        }
    }

    /**
     * Automatically converts any legacy or offline inline `data:image/...;base64,...` screenshots
     * into `/uploads/backtest-screenshots/...` files before writing JSONB/Redis.
     */
    private async externalizeInlineScreenshots(
        userId: string,
        sessionId: string,
        rawList: any[]
    ): Promise<any[]> {
        if (!Array.isArray(rawList) || rawList.length === 0) return [];
        const safeUser = this.sanitizePathToken(userId, 'user');
        const safeSession = this.sanitizePathToken(sessionId, 'session').slice(0, 24);
        const userDir = path.join(process.cwd(), 'uploads', 'backtest-screenshots', safeUser);
        let dirEnsured = false;

        const out: any[] = [];
        for (const item of rawList.slice(0, 50)) {
            if (!item || typeof item !== 'object') continue;
            const dataUrl = typeof item.dataUrl === 'string' ? item.dataUrl : '';
            if (dataUrl.startsWith('data:image/')) {
                try {
                    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
                    if (match) {
                        const kind = match[1].toLowerCase();
                        const ext = kind === 'webp' ? 'webp' : kind === 'png' ? 'png' : 'jpg';
                        const buf = Buffer.from(match[2], 'base64');
                        if (buf.length > 0 && buf.length <= 12 * 1024 * 1024) {
                            if (this.r2Storage) {
                                const stored = await this.r2Storage.uploadPrivateObject({
                                    userId,
                                    folder: 'backtest-screenshots',
                                    buffer: buf,
                                    ext,
                                });
                                out.push({
                                    ...item,
                                    dataUrl: stored.url,
                                });
                                continue;
                            }
                            if (!dirEnsured) {
                                await fs.promises.mkdir(userDir, { recursive: true });
                                dirEnsured = true;
                            }
                            const safeShotId = this.sanitizePathToken(item.id, `shot_${Date.now()}`);
                            const filename = `${safeSession}_${safeShotId}.${ext}`;
                            await fs.promises.writeFile(path.join(userDir, filename), buf);
                            out.push({
                                ...item,
                                dataUrl: `/uploads/backtest-screenshots/${safeUser}/${filename}`,
                            });
                            continue;
                        }
                    }
                } catch (err) {
                    this.logger.warn(`Failed to externalize inline screenshot: ${(err as Error).message}`);
                }
            }
            out.push(item);
        }
        return out;
    }

    /**
     * Externalizes an array of string image URLs (`string[]`), converting any `data:image/...;base64,...`
     * entries into `/uploads/backtest-screenshots/<user>/<prefix>_<idx>.<ext>` while keeping normal URLs intact.
     */
    private async externalizeImageUrls(
        userId: string,
        prefixId: string,
        rawUrls: unknown
    ): Promise<string[]> {
        if (!Array.isArray(rawUrls) || rawUrls.length === 0) return [];
        const safeUser = this.sanitizePathToken(userId, 'user');
        const safePrefix = this.sanitizePathToken(prefixId, 'jrn').slice(0, 24);
        const userDir = path.join(process.cwd(), 'uploads', 'backtest-screenshots', safeUser);
        let dirEnsured = false;

        const out: string[] = [];
        for (let idx = 0; idx < Math.min(rawUrls.length, 24); idx++) {
            const val = rawUrls[idx];
            if (typeof val !== 'string') continue;
            if (val.startsWith('data:image/')) {
                try {
                    const match = val.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
                    if (match) {
                        const kind = match[1].toLowerCase();
                        const ext = kind === 'webp' ? 'webp' : kind === 'png' ? 'png' : 'jpg';
                        const buf = Buffer.from(match[2], 'base64');
                        if (buf.length > 0 && buf.length <= 12 * 1024 * 1024) {
                            if (this.r2Storage) {
                                const stored = await this.r2Storage.uploadPrivateObject({
                                    userId,
                                    folder: 'backtest-screenshots',
                                    buffer: buf,
                                    ext,
                                });
                                out.push(stored.url);
                                continue;
                            }
                            if (!dirEnsured) {
                                await fs.promises.mkdir(userDir, { recursive: true });
                                dirEnsured = true;
                            }
                            const filename = `${safePrefix}_jrn_${Date.now()}_${idx}.${ext}`;
                            await fs.promises.writeFile(path.join(userDir, filename), buf);
                            out.push(`/uploads/backtest-screenshots/${safeUser}/${filename}`);
                            continue;
                        }
                    }
                } catch (err) {
                    this.logger.warn(`Failed to externalize inline journal image: ${(err as Error).message}`);
                }
            }
            out.push(val);
        }
        return out;
    }

    /**
     * Upserts a Replay / Backtesting Session into PostgreSQL (`backtest_sessions`)
     * AND caches it in Redis (`this.cacheManager`) for sub-millisecond reads & unload reliability.
     * Enforces monotonic `revision` protection so out-of-order network requests never overwrite newer state.
     */
    async syncReplaySessionState(userId: string, data: any) {
        let accountId = data.accountId;
        if (!accountId || accountId === 'all' || !this.isValidUuid(accountId)) {
            const primary = await this.getPrimaryAccount(userId);
            accountId = primary?.id;
        }

        const rawSessionId = String(data.sessionId || data.id || data.config?.sessionId || '').trim();
        const isUuidSessionId = this.isValidUuid(rawSessionId);

        let existing: BacktestSession | null = null;
        if (isUuidSessionId) {
            existing = await this.backtestRepo.findOne({
                where: { id: rawSessionId, userId, mode: Not('STRATEGY_DEFINITION') },
            });
        }
        if (!existing && rawSessionId) {
            // Fast indexed lookup via IDX_backtest_sessions_user_client_id (<0.3ms)
            existing = await this.backtestRepo.findOne({
                where: { userId, clientSessionId: rawSessionId, mode: Not('STRATEGY_DEFINITION') },
                order: { updatedAt: 'DESC' },
            });
        }
        if (!existing && rawSessionId) {
            // Legacy JSONB / name fallback via SQL filter without pulling 100 JSONB blobs into Node RAM
            existing = await this.backtestRepo
                .createQueryBuilder('bs')
                .where('bs.user_id = :userId', { userId })
                .andWhere('bs.mode != :stratMode', { stratMode: 'STRATEGY_DEFINITION' })
                .andWhere(
                    `(bs.config->>'clientSessionId' = :rawSessionId OR (:sessionName <> '' AND bs.name = :sessionName AND bs.mode = 'REPLAY_SESSION'))`,
                    { rawSessionId, sessionName: String(data.name || '').trim() }
                )
                .orderBy('bs.updated_at', 'DESC')
                .getOne();
        }

        if (!existing) {
            await this.assertMonthlyBacktestRunQuota(userId);
        }

        // Phase 3 Monotonic Revision Guard: reject strictly older out-of-order sync requests
        const rawIncomingRev = data.revision ?? data.config?.revision;
        const hasIncomingRev =
            rawIncomingRev !== undefined &&
            rawIncomingRev !== null &&
            Number.isFinite(Number(rawIncomingRev));
        const incomingRevision = hasIncomingRev ? Math.max(0, Math.floor(Number(rawIncomingRev))) : null;
        const existingRevision = Math.max(0, Math.floor(Number(existing?.config?.revision ?? 0)));

        if (existing && incomingRevision !== null && existingRevision > 0 && incomingRevision < existingRevision) {
            this.logger.warn(
                `Ignored stale backtest session-sync for session=${existing.id} (incoming rev=${incomingRevision} < existing rev=${existingRevision})`
            );
            return {
                ...existing,
                staleIgnored: true,
                currentRevision: existingRevision,
            };
        }

        const resolvedRevision = Math.max(existingRevision, incomingRevision ?? existingRevision);
        const existingBlob =
            existing?.id && existing?.config?._blobSplit
                ? await this.loadSessionBlobSafe(userId, existing.id)
                : null;

        // Candidate screenshots: if an emergency unload stripped `sessionScreenshots` (`undefined`), preserve existing URLs
        const rawCandidateScreenshots = Array.isArray(data.sessionScreenshots)
            ? data.sessionScreenshots
            : Array.isArray(data.config?.sessionScreenshots)
              ? data.config.sessionScreenshots
              : existing?.config?.sessionScreenshots || existingBlob?.sessionScreenshots || [];

        const externalizedScreenshots = await this.externalizeInlineScreenshots(
            userId,
            rawSessionId || existing?.id || 'session',
            rawCandidateScreenshots
        );

        const rawJournalImages = Array.isArray(data.journalImages)
            ? data.journalImages
            : Array.isArray(data.config?.journalImages)
              ? data.config.journalImages
              : existing?.config?.journalImages || existingBlob?.journalImages || [];
        const externalizedJournalImages = await this.externalizeImageUrls(
            userId,
            rawSessionId || existing?.id || 'session',
            rawJournalImages
        );

        const rawOrdersList: any[] = Array.isArray(data.orders)
            ? data.orders
            : Array.isArray(data.config?.orders)
              ? data.config.orders
              : existing?.config?.orders || existingBlob?.orders || [];
        const externalizedOrders = await Promise.all(
            rawOrdersList.map(async (ord) => {
                if (!ord || typeof ord !== 'object' || !Array.isArray(ord.journalImages) || ord.journalImages.length === 0) {
                    return ord;
                }
                const cleanedImgs = await this.externalizeImageUrls(
                    userId,
                    `${rawSessionId || existing?.id || 'session'}_${ord.id || 'ord'}`,
                    ord.journalImages
                );
                return { ...ord, journalImages: cleanedImgs };
            })
        );

        const mergedConfig: Record<string, any> = {
            ...(existing?.config || {}),
            ...(data.config || {}),
            schemaVersion: 2,
            revision: resolvedRevision,
            clientSessionId: rawSessionId || existing?.id,
            status: data.status ?? data.config?.status ?? existing?.config?.status ?? 'ACTIVE',
            strategyId: data.strategyId ?? data.config?.strategyId ?? existing?.config?.strategyId ?? null,
            strategyName:
                data.strategyName ??
                data.strategy ??
                data.config?.strategyName ??
                existing?.config?.strategyName ??
                existing?.strategy ??
                'Smart Money / Price Action',
            startingCapital: Number(
                data.startingCapital ?? data.config?.startingCapital ?? existing?.config?.startingCapital ?? 100000
            ),
            riskPerTrade: Number(
                data.riskPerTrade ?? data.config?.riskPerTrade ?? existing?.config?.riskPerTrade ?? 1.0
            ),
            rrTarget: Number(data.rrTarget ?? data.config?.rrTarget ?? existing?.config?.rrTarget ?? 2.0),
            fundedMode: data.fundedMode ?? data.config?.fundedMode ?? existing?.config?.fundedMode ?? null,
            keepEndFollowingToday: Boolean(
                data.keepEndFollowingToday ??
                    data.config?.keepEndFollowingToday ??
                    existing?.config?.keepEndFollowingToday ??
                    false
            ),
            randomStartDate: Boolean(
                data.randomStartDate ?? data.config?.randomStartDate ?? existing?.config?.randomStartDate ?? false
            ),
            pairs: data.pairs ?? data.config?.pairs ?? existing?.config?.pairs ?? [data.symbol || 'XAUUSD'],
            fromDate: data.fromDate ?? data.config?.fromDate ?? existing?.config?.fromDate,
            toDate: data.toDate ?? data.config?.toDate ?? existing?.config?.toDate,
            timeframe: data.timeframe ?? data.config?.timeframe ?? existing?.config?.timeframe ?? '15m',
            secondaryTimeframe:
                data.secondaryTimeframe ?? data.config?.secondaryTimeframe ?? existing?.config?.secondaryTimeframe ?? '1h',
            auxPeriodTexts:
                data.auxPeriodTexts ?? data.config?.auxPeriodTexts ?? existing?.config?.auxPeriodTexts ?? undefined,
            timezone: data.timezone ?? data.config?.timezone ?? existing?.config?.timezone ?? undefined,
            dataSource: data.dataSource ?? data.config?.dataSource ?? existing?.config?.dataSource ?? 'TRADINGVIEW',
            layoutMode: data.layoutMode ?? data.config?.layoutMode ?? existing?.config?.layoutMode ?? '1x1',
            selectedCandleStyle:
                data.selectedCandleStyle ?? data.config?.selectedCandleStyle ?? existing?.config?.selectedCandleStyle ?? 'candles',
            replayActive: data.replayActive ?? data.config?.replayActive ?? existing?.config?.replayActive ?? true,
            syncEnabled: data.syncEnabled ?? data.config?.syncEnabled ?? existing?.config?.syncEnabled ?? true,
            yAxis: data.yAxis ?? data.config?.yAxis ?? existing?.config?.yAxis ?? null,
            drawingTools: data.drawingTools ?? data.config?.drawingTools ?? existing?.config?.drawingTools ?? null,
            ticketDefaults: data.ticketDefaults ?? data.config?.ticketDefaults ?? existing?.config?.ticketDefaults ?? null,
            spread: Number(data.spread ?? data.config?.spread ?? existing?.config?.spread ?? 0),
            commission: Number(data.commission ?? data.config?.commission ?? existing?.config?.commission ?? 0),
            activeIndicators: Array.isArray(data.activeIndicators)
                ? data.activeIndicators
                : Array.isArray(data.config?.activeIndicators)
                  ? data.config.activeIndicators
                  : existing?.config?.activeIndicators || [],
            indicatorParamsByCode:
                data.indicatorParamsByCode ??
                data.config?.indicatorParamsByCode ??
                existing?.config?.indicatorParamsByCode ??
                {},
            replayTimestamp: data.replayTimestamp ?? data.config?.replayTimestamp ?? existing?.config?.replayTimestamp ?? null,
            orders: externalizedOrders,
            journalTitle:
                data.journalTitle !== undefined
                    ? data.journalTitle
                    : data.config?.journalTitle !== undefined
                      ? data.config.journalTitle
                      : existing?.config?.journalTitle ?? null,
            journalMarketBias:
                data.journalMarketBias !== undefined
                    ? data.journalMarketBias
                    : data.config?.journalMarketBias !== undefined
                      ? data.config.journalMarketBias
                      : existing?.config?.journalMarketBias ?? null,
            journalPsychCheck:
                data.journalPsychCheck !== undefined
                    ? data.journalPsychCheck
                    : data.config?.journalPsychCheck !== undefined
                      ? data.config.journalPsychCheck
                      : existing?.config?.journalPsychCheck ?? null,
            journalImages: externalizedJournalImages,
            drawings: Array.isArray(data.drawings)
                ? data.drawings
                : Array.isArray(data.config?.drawings)
                  ? data.config.drawings
                  : existing?.config?.drawings || existingBlob?.drawings || [],
            drawnItems: Array.isArray(data.drawnItems)
                ? data.drawnItems
                : Array.isArray(data.config?.drawnItems)
                  ? data.config.drawnItems
                  : existing?.config?.drawnItems || existingBlob?.drawnItems || [],
            drawingStylesById:
                data.drawingStylesById ??
                data.config?.drawingStylesById ??
                existing?.config?.drawingStylesById ??
                existingBlob?.drawingStylesById ??
                {},
            overlayGeometries:
                data.overlayGeometries ??
                data.config?.overlayGeometries ??
                existing?.config?.overlayGeometries ??
                existingBlob?.overlayGeometries ??
                {},
            sessionScreenshots: externalizedScreenshots,
            encryptedDigest: data.encryptedDigest ?? data.config?.encryptedDigest ?? existing?.config?.encryptedDigest,
            timeInvestedSeconds:
                Number(data.timeInvestedSeconds ?? data.config?.timeInvestedSeconds ?? existing?.config?.timeInvestedSeconds ?? 0),
            syncedAt: new Date().toISOString(),
        };
        delete mergedConfig._blobSplit;

        let calcNetPnl = 0;
        let calcBalance = Number(mergedConfig.startingCapital || existing?.results?.initialBalance || 100000);
        let calcClosed = 0;
        let calcWins = 0;
        let calcLosses = 0;
        let calcWinRate = 0;
        let calcPf = 0;
        let calcExpectancy = 0;
        let calcAvgR = 0;
        let calcMaxDd = 0;
        let calcMaxDdPct = 0;
        let pyQuantMetrics: any = null;

        if (Array.isArray(mergedConfig.orders) && mergedConfig.orders.length > 0) {
            const initCap = Number(mergedConfig.startingCapital || existing?.results?.initialBalance || 100000);
            const fallbackSummary = this.computeAuthoritativeOrderSummary(mergedConfig.orders, initCap);
            calcNetPnl = fallbackSummary.netPnl;
            calcBalance = fallbackSummary.currentBalance;
            calcClosed = fallbackSummary.closedTradesCount;
            calcWins = fallbackSummary.winsCount;
            calcLosses = fallbackSummary.lossesCount;
            calcWinRate = fallbackSummary.winRate;
            calcPf = fallbackSummary.profitFactor;
            calcExpectancy = fallbackSummary.expectancy;
            calcAvgR = fallbackSummary.avgR;
            calcMaxDd = fallbackSummary.maxDrawdown;
            calcMaxDdPct = fallbackSummary.maxDrawdownPct;

            const quantUrl = process.env.QUANT_ENGINE_URL?.trim();
            if (quantUrl) {
                try {
                    const pyRes = await fetch(`${quantUrl.replace(/\/$/, '')}/api/quant/reconcile-session`, {
                        method: 'POST',
                        headers: getQuantInternalHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify({
                            orders: mergedConfig.orders,
                            initialBalance: initCap,
                            locale: 'pt',
                        }),
                        signal: AbortSignal.timeout(2500),
                    });
                    if (pyRes.ok) {
                        const pyData = await pyRes.json();
                        if (pyData?.stats) {
                            calcNetPnl = Number(pyData.stats.netProfit ?? calcNetPnl);
                            calcBalance = Number(pyData.stats.realizedBalance ?? calcBalance);
                            calcClosed = Number(pyData.stats.trades ?? calcClosed);
                            calcWins = Number(pyData.stats.wins ?? calcWins);
                            calcLosses = Number(pyData.stats.losses ?? calcLosses);
                            calcWinRate = Number(pyData.stats.winRate ?? calcWinRate);
                            calcPf = Number(pyData.stats.profitFactor ?? calcPf);
                            calcExpectancy = Number(pyData.stats.expectancy ?? calcExpectancy);
                            calcAvgR = Number(pyData.stats.avgR ?? calcAvgR);
                            calcMaxDd = Number(pyData.stats.maxDrawdown ?? calcMaxDd);
                            calcMaxDdPct = Number(pyData.stats.maxDrawdownPct ?? calcMaxDdPct);
                        }
                        if (pyData?.quantMetrics) {
                            pyQuantMetrics = pyData.quantMetrics;
                        }
                    }
                } catch (err) {
                    this.logger.warn(`Quant Engine reconcile-session fallback: ${(err as Error).message}`);
                }
            }
        }

        const mergedResults = {
            ...(existing?.results || {}),
            ...(data.results || {}),
            ...(Array.isArray(mergedConfig.orders) && mergedConfig.orders.length > 0
                ? {
                      currentBalance: calcBalance,
                      finalBalance: calcBalance,
                      netPnl: calcNetPnl,
                      simulatedNetProfit: calcNetPnl,
                      closedTradesCount: calcClosed,
                      simulatedTrades: calcClosed,
                      winsCount: calcWins,
                      lossesCount: calcLosses,
                      winRate: calcWinRate,
                      simulatedWinRate: calcWinRate,
                      profitFactor: calcPf,
                      simulatedProfitFactor: calcPf,
                      expectancy: calcExpectancy,
                      avgR: calcAvgR,
                      maxDrawdown: calcMaxDd,
                      maxDrawdownPct: calcMaxDdPct,
                  }
                : {
                      currentBalance:
                          data.currentBalance ?? data.results?.finalBalance ?? existing?.results?.currentBalance ?? 100000,
                      netPnl: data.netPnl ?? data.results?.simulatedNetProfit ?? existing?.results?.netPnl ?? 0,
                      closedTradesCount:
                          data.closedTradesCount ??
                          data.results?.simulatedTrades ??
                          existing?.results?.closedTradesCount ??
                          0,
                      winsCount: data.winsCount ?? data.results?.winsCount ?? existing?.results?.winsCount ?? 0,
                      lossesCount: data.lossesCount ?? data.results?.lossesCount ?? existing?.results?.lossesCount ?? 0,
                      winRate: data.winRate ?? data.results?.simulatedWinRate ?? existing?.results?.winRate ?? 0,
                      profitFactor:
                          data.profitFactor ?? data.results?.simulatedProfitFactor ?? existing?.results?.profitFactor ?? 0,
                      expectancy: data.expectancy ?? data.results?.expectancy ?? existing?.results?.expectancy ?? 0,
                      avgR: data.avgR ?? data.results?.avgR ?? existing?.results?.avgR ?? 0,
                      maxDrawdown: data.maxDrawdown ?? data.results?.maxDrawdown ?? existing?.results?.maxDrawdown ?? 0,
                      maxDrawdownPct:
                          data.maxDrawdownPct ?? data.results?.maxDrawdownPct ?? existing?.results?.maxDrawdownPct ?? 0,
                  }),
            quantMetrics:
                pyQuantMetrics ??
                data.quantMetrics ??
                data.results?.quantMetrics ??
                existing?.results?.quantMetrics ??
                existingBlob?.quantMetrics ??
                null,
        };

        const configForSessionTable = this.sessionBlobRepo
            ? this.stripHeavyCanvasFields(mergedConfig)
            : mergedConfig;

        let saved: BacktestSession;
        if (existing) {
            existing.accountId = accountId || existing.accountId;
            existing.clientSessionId = rawSessionId || existing.clientSessionId || existing.id;
            existing.name = data.name || existing.name;
            existing.mode = data.mode || existing.mode || 'REPLAY_SESSION';
            existing.strategy = data.strategy || data.strategyName || existing.strategy || 'Smart Money / Price Action';
            existing.symbol = data.symbol || data.primarySymbol || existing.symbol || 'XAUUSD';
            existing.config = configForSessionTable;
            existing.results = mergedResults;
            existing.notes = data.notes ?? data.journalNotes ?? existing.notes ?? '';
            saved = await this.backtestRepo.save(existing);
        } else {
            const created = this.backtestRepo.create({
                ...(isUuidSessionId ? { id: rawSessionId } : {}),
                userId,
                clientSessionId: rawSessionId || null,
                accountId,
                name: data.name || `Sessão Replay - ${new Date().toLocaleDateString('pt-BR')}`,
                mode: data.mode || 'REPLAY_SESSION',
                strategy: data.strategy || data.strategyName || 'Smart Money / Price Action',
                symbol: data.symbol || data.primarySymbol || 'XAUUSD',
                config: configForSessionTable,
                results: mergedResults,
                notes: data.notes ?? data.journalNotes ?? '',
            });
            saved = await this.backtestRepo.save(created);
        }

        if (this.sessionBlobRepo && saved?.id) {
            try {
                await this.sessionBlobRepo.save({
                    sessionId: saved.id,
                    userId,
                    revision: resolvedRevision,
                    orders: Array.isArray(mergedConfig.orders) ? mergedConfig.orders : [],
                    drawings: Array.isArray(mergedConfig.drawings) ? mergedConfig.drawings : [],
                    drawnItems: Array.isArray(mergedConfig.drawnItems) ? mergedConfig.drawnItems : [],
                    drawingStylesById: mergedConfig.drawingStylesById || {},
                    overlayGeometries: mergedConfig.overlayGeometries || {},
                    sessionScreenshots: Array.isArray(mergedConfig.sessionScreenshots)
                        ? mergedConfig.sessionScreenshots
                        : [],
                    journalImages: Array.isArray(mergedConfig.journalImages) ? mergedConfig.journalImages : [],
                    quantMetrics: mergedResults.quantMetrics ?? null,
                });
            } catch (err) {
                this.logger.warn(
                    `Failed to persist normalized backtest_session_blobs row, keeping full config inline: ${(err as Error).message}`
                );
                saved.config = mergedConfig;
                saved = await this.backtestRepo.save(saved);
            }
        }

        const hydratedSaved = {
            ...saved,
            config: mergedConfig,
            results: mergedResults,
        } as BacktestSession;

        // Write-through to Redis Cache (24h TTL for individual session, invalidate history list cache)
        let wroteToRedis = false;
        try {
            const cacheKeyByUuid = `backtest:session:${userId}:${hydratedSaved.id}`;
            await this.cacheManager.set(cacheKeyByUuid, hydratedSaved, 86_400_000);
            if (rawSessionId && rawSessionId !== hydratedSaved.id) {
                await this.cacheManager.set(`backtest:session:${userId}:${rawSessionId}`, hydratedSaved, 86_400_000);
            }
            await this.invalidateBacktestHistoryCaches(userId, accountId);
            wroteToRedis = true;
        } catch (err) {
            this.logger.warn(`Redis cache write warning on backtest session sync: ${(err as Error).message}`);
        }

        // Optional ClickHouse Columnar Analytical Sink (non-blocking fire-and-forget when CLICKHOUSE_ENABLED=true)
        const clickhouseUrl = process.env.CLICKHOUSE_URL;
        if (process.env.CLICKHOUSE_ENABLED === 'true' && clickhouseUrl) {
            setImmediate(() => {
                const chRow = JSON.stringify({
                    session_id: hydratedSaved.id,
                    user_id: userId,
                    symbol: hydratedSaved.symbol,
                    timeframe: mergedConfig.timeframe,
                    net_pnl: Number(mergedResults.netPnl || 0),
                    win_rate: Number(mergedResults.winRate || 0),
                    profit_factor: Number(mergedResults.profitFactor || 0),
                    closed_trades: Number(mergedResults.closedTradesCount || 0),
                    time_invested_sec: Number(mergedConfig.timeInvestedSeconds || 0),
                    synced_at: Math.floor(Date.now() / 1000),
                });
                fetch(
                    `${clickhouseUrl.replace(/\/$/, '')}/?query=${encodeURIComponent(
                        'INSERT INTO backtest_session_telemetry FORMAT JSONEachRow'
                    )}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: `${chRow}\n`,
                    }
                ).catch(() => {});
            });
        }

        return {
            ...hydratedSaved,
            cacheLayer: wroteToRedis ? 'REDIS' : 'POSTGRES',
            syncedRevision: resolvedRevision,
        };
    }

    private computeAuthoritativeOrderSummary(orders: any[], startingCapital: number) {
        const closed = (orders || [])
            .filter((o) => o && (o.status === 'WIN' || o.status === 'LOSS'))
            .sort((a, b) => Number(a.closedAt ?? a.openedAt ?? 0) - Number(b.closedAt ?? b.openedAt ?? 0));

        const round2 = (n: number) => Math.sign(n) * Math.round((Math.abs(n) + 1e-12) * 100) / 100 || 0;
        const round1 = (n: number) => Math.sign(n) * Math.round((Math.abs(n) + 1e-12) * 10) / 10 || 0;

        const wins = closed.filter((o) => Number(o.pnl || 0) > 0);
        const losses = closed.filter((o) => Number(o.pnl || 0) < 0);
        const gp = round2(wins.reduce((acc, o) => acc + Number(o.pnl || 0), 0));
        const gl = round2(Math.abs(losses.reduce((acc, o) => acc + Number(o.pnl || 0), 0)));
        const netPnl = round2(closed.reduce((acc, o) => acc + Number(o.pnl || 0), 0));
        const closedTradesCount = closed.length;
        const winsCount = wins.length;
        const lossesCount = losses.length;
        const winRate = closedTradesCount > 0 ? round1((winsCount / closedTradesCount) * 100) : 0;
        const profitFactor = gl > 0 ? round2(gp / gl) : gp > 0 ? 9.99 : 0;
        const expectancy = closedTradesCount > 0 ? round2(netPnl / closedTradesCount) : 0;
        const rList = closed.filter((o) => o.rMultiple !== undefined && o.rMultiple !== null);
        const avgR =
            rList.length > 0
                ? round2(rList.reduce((acc, o) => acc + Number(o.rMultiple || 0), 0) / rList.length)
                : 0;

        let equity = startingCapital;
        let peak = startingCapital;
        let maxDrawdown = 0;
        let maxDrawdownPct = 0;
        for (const o of closed) {
            equity += Number(o.pnl || 0);
            if (equity > peak) peak = equity;
            const dd = peak - equity;
            if (dd > maxDrawdown) maxDrawdown = dd;
            if (peak > 0) {
                const ddPct = (dd / peak) * 100;
                if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
            }
        }

        const currentBalance = round2(startingCapital + netPnl);
        return {
            currentBalance,
            finalBalance: currentBalance,
            netPnl,
            simulatedNetProfit: netPnl,
            closedTradesCount,
            simulatedTrades: closedTradesCount,
            winsCount,
            lossesCount,
            winRate,
            simulatedWinRate: winRate,
            profitFactor,
            simulatedProfitFactor: profitFactor,
            expectancy,
            avgR,
            maxDrawdown: round2(maxDrawdown),
            maxDrawdownPct: round2(maxDrawdownPct),
        };
    }

    private async invalidateBacktestHistoryCaches(userId: string, accountId?: string | null) {
        try {
            const scopes = new Set<string>(['all']);
            if (accountId) scopes.add(accountId);
            const accounts = await this.accountRepo.find({ where: { userId }, select: ['id'] });
            for (const acc of accounts) {
                if (acc?.id) scopes.add(acc.id);
            }
            const keys: string[] = [];
            for (const sc of scopes) {
                keys.push(`backtest:history:${userId}:${sc}`);
                keys.push(`backtest:history:${userId}:${sc}:slim`);
                keys.push(`backtest:history:${userId}:${sc}:full`);
            }
            await Promise.all(keys.map((k) => this.cacheManager.del(k).catch(() => {})));
        } catch (_) {}
    }

    /**
     * Reads a Replay Session from Redis Cache first (`<5ms`), falling back to PostgreSQL (`backtest_sessions`).
     * Supports `knownRevision` conditional fetch: returns `{ unchanged: true }` when client revision matches.
     */
    async getReplaySessionById(userId: string, sessionId: string, knownRevision?: number) {
        const cleanId = (sessionId || '').trim();
        if (!cleanId) return null;

        const cacheKey = `backtest:session:${userId}:${cleanId}`;
        try {
            const cached = await this.cacheManager.get<BacktestSession>(cacheKey);
            if (cached && cached.mode !== 'STRATEGY_DEFINITION') {
                const cachedRev = Math.max(0, Math.floor(Number(cached.config?.revision ?? 0)));
                if (knownRevision && cachedRev > 0 && cachedRev === knownRevision) {
                    return {
                        id: cached.id || cleanId,
                        unchanged: true,
                        revision: cachedRev,
                        fromRedisCache: true,
                        cacheLayer: 'REDIS' as const,
                    };
                }
                const hydratedCached =
                    cached.config?._blobSplit && this.sessionBlobRepo && cached.id
                        ? this.rehydrateSessionWithBlob(
                              cached,
                              await this.loadSessionBlobSafe(userId, cached.id)
                          )
                        : cached;
                return { ...hydratedCached, fromRedisCache: true, cacheLayer: 'REDIS' as const };
            }
        } catch (_) {}

        let found: BacktestSession | null = null;
        if (this.isValidUuid(cleanId)) {
            found = await this.backtestRepo.findOne({
                where: { id: cleanId, userId, mode: Not('STRATEGY_DEFINITION') },
            });
        }

        if (!found) {
            found = await this.backtestRepo.findOne({
                where: { userId, clientSessionId: cleanId, mode: Not('STRATEGY_DEFINITION') },
                order: { updatedAt: 'DESC' },
            });
        }

        if (!found) {
            found = await this.backtestRepo
                .createQueryBuilder('bs')
                .where('bs.user_id = :userId', { userId })
                .andWhere('bs.mode != :stratMode', { stratMode: 'STRATEGY_DEFINITION' })
                .andWhere(`bs.config->>'clientSessionId' = :cleanId`, { cleanId })
                .orderBy('bs.updated_at', 'DESC')
                .getOne();
        }

        if (found) {
            const foundRev = Math.max(0, Math.floor(Number(found.config?.revision ?? 0)));
            if (knownRevision && foundRev > 0 && foundRev === knownRevision) {
                return {
                    id: found.id || cleanId,
                    unchanged: true,
                    revision: foundRev,
                    fromRedisCache: false,
                    cacheLayer: 'POSTGRES' as const,
                };
            }

            if (this.sessionBlobRepo && found.id) {
                const blob = await this.loadSessionBlobSafe(userId, found.id);
                found = this.rehydrateSessionWithBlob(found, blob);
            }

            try {
                await this.cacheManager.set(cacheKey, found, 86_400_000);
            } catch (_) {}
        }

        return found ? { ...found, fromRedisCache: false, cacheLayer: 'POSTGRES' as const } : null;
    }

    /**
     * Permanently deletes a Replay Session from PostgreSQL + normalized blob/hypothesis tables + Redis + owned disk screenshots.
     */
    async deleteReplaySessionById(userId: string, sessionId: string) {
        const cleanId = (sessionId || '').trim();
        if (!cleanId) return { ok: false, deleted: false };

        let found: BacktestSession | null = null;
        if (this.isValidUuid(cleanId)) {
            found = await this.backtestRepo.findOne({
                where: { id: cleanId, userId, mode: Not('STRATEGY_DEFINITION') },
            });
        }
        if (!found) {
            found = await this.backtestRepo.findOne({
                where: { userId, clientSessionId: cleanId, mode: Not('STRATEGY_DEFINITION') },
                order: { updatedAt: 'DESC' },
            });
        }
        if (!found) {
            found = await this.backtestRepo
                .createQueryBuilder('bs')
                .where('bs.user_id = :userId', { userId })
                .andWhere('bs.mode != :stratMode', { stratMode: 'STRATEGY_DEFINITION' })
                .andWhere(`bs.config->>'clientSessionId' = :cleanId`, { cleanId })
                .orderBy('bs.updated_at', 'DESC')
                .getOne();
        }

        if (found) {
            const deletedId = found.id;
            const blob = await this.loadSessionBlobSafe(userId, deletedId);
            const screenshots = [
                ...(Array.isArray(blob?.sessionScreenshots) ? blob.sessionScreenshots : []),
                ...(Array.isArray(found.config?.sessionScreenshots) ? found.config.sessionScreenshots : []),
            ];
            const seenUrls = new Set<string>();
            for (const shot of screenshots) {
                const url = shot?.dataUrl;
                if (url && typeof url === 'string' && !seenUrls.has(url)) {
                    seenUrls.add(url);
                    await this.deleteBacktestScreenshotFile(userId, url).catch(() => {});
                }
            }
            const deletedClientId = found.clientSessionId || found.config?.clientSessionId;
            const deletedAccountId = found.accountId;

            if (this.sessionBlobRepo) {
                await this.sessionBlobRepo.delete({ sessionId: deletedId, userId }).catch(() => {});
            }
            await this.backtestRepo.remove(found);
            if (this.hypothesisRepo && this.isValidUuid(deletedId)) {
                await this.hypothesisRepo.delete({ id: deletedId, userId }).catch(() => {});
            }

            try {
                await this.cacheManager.del(`backtest:session:${userId}:${deletedId}`);
                if (deletedClientId) {
                    await this.cacheManager.del(`backtest:session:${userId}:${deletedClientId}`);
                }
                await this.cacheManager.del(`backtest:hypotheses:${userId}:all`);
                if (deletedAccountId) {
                    await this.cacheManager.del(`backtest:hypotheses:${userId}:${deletedAccountId}`);
                }
            } catch (_) {}
            await this.invalidateBacktestHistoryCaches(userId, deletedAccountId);
            return { ok: true, deleted: true, id: deletedId };
        }

        if (this.hypothesisRepo && this.isValidUuid(cleanId)) {
            const hypResult = await this.deleteBacktestHypothesisById(userId, cleanId);
            if (hypResult.deleted) return hypResult;
        }

        try {
            await this.cacheManager.del(`backtest:session:${userId}:${cleanId}`);
        } catch (_) {}
        await this.invalidateBacktestHistoryCaches(userId);
        return { ok: true, deleted: false, id: cleanId };
    }

    private formatStrategyRow(row: BacktestSession) {
        const cfg = row.config || {};
        const primarySymbol = String(cfg.primarySymbol || row.symbol || 'XAUUSD').toUpperCase();
        const symbols = Array.isArray(cfg.symbols) && cfg.symbols.length > 0
            ? cfg.symbols
            : [primarySymbol];
        return {
            id: String(cfg.clientStrategyId || row.id),
            name: String(row.name || cfg.name || 'Nova Estratégia'),
            tradingMethod: String(cfg.tradingMethod || 'Smart Money Concepts (SMC / ICT)'),
            description: String(cfg.description ?? row.notes ?? ''),
            sessionTag: String(cfg.sessionTag || 'London & NY'),
            status: cfg.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
            startingCapital: Number(cfg.startingCapital || 100000),
            currency: String(cfg.currency || 'USD'),
            riskMode:
                cfg.riskMode === 'COMPOUNDING' || cfg.riskMode === 'DYNAMIC_RISK'
                    ? cfg.riskMode
                    : 'FIXED_RISK',
            riskPerTrade: Number(cfg.riskPerTrade || 1.0),
            defaultTimeframe: String(cfg.defaultTimeframe || '5m'),
            rrTarget: Number(cfg.rrTarget || 2.0),
            primarySymbol,
            symbols,
            rules: Array.isArray(cfg.rules) ? cfg.rules : [],
            journalNotes: typeof cfg.journalNotes === 'string' ? cfg.journalNotes : undefined,
            journalTitle: typeof cfg.journalTitle === 'string' ? cfg.journalTitle : null,
            journalMarketBias: typeof cfg.journalMarketBias === 'string' ? cfg.journalMarketBias : null,
            journalPsychCheck:
                cfg.journalPsychCheck && typeof cfg.journalPsychCheck === 'object'
                    ? cfg.journalPsychCheck
                    : undefined,
            journalImages: Array.isArray(cfg.journalImages) ? cfg.journalImages : undefined,
            createdAt:
                typeof cfg.createdAt === 'string'
                    ? cfg.createdAt
                    : row.createdAt
                      ? new Date(row.createdAt).toISOString()
                      : new Date().toISOString(),
            updatedAt: row.updatedAt
                ? new Date(row.updatedAt).toISOString()
                : typeof cfg.updatedAt === 'string'
                  ? cfg.updatedAt
                  : new Date().toISOString(),
        };
    }

    private formatNormalizedStrategyRow(row: BacktestStrategyEntity) {
        const jCfg = row.journalConfig || {};
        const primarySymbol = String(row.primarySymbol || 'XAUUSD').toUpperCase();
        const symbols = Array.isArray(row.symbols) && row.symbols.length > 0
            ? row.symbols
            : [primarySymbol];
        return {
            id: String(row.clientStrategyId || row.id),
            name: String(row.name || 'Nova Estratégia'),
            tradingMethod: String(row.tradingMethod || 'Smart Money Concepts (SMC / ICT)'),
            description: String(row.description ?? ''),
            sessionTag: String(row.sessionTag || 'London & NY'),
            status: row.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
            startingCapital: Number(row.startingCapital || 100000),
            currency: String(row.currency || 'USD'),
            riskMode:
                row.riskMode === 'COMPOUNDING' || row.riskMode === 'DYNAMIC_RISK'
                    ? row.riskMode
                    : 'FIXED_RISK',
            riskPerTrade: Number(row.riskPerTrade || 1.0),
            defaultTimeframe: String(row.defaultTimeframe || '5m'),
            rrTarget: Number(row.rrTarget || 2.0),
            primarySymbol,
            symbols,
            rules: Array.isArray(row.rules) ? row.rules : [],
            journalNotes: typeof jCfg.journalNotes === 'string' ? jCfg.journalNotes : undefined,
            journalTitle: typeof jCfg.journalTitle === 'string' ? jCfg.journalTitle : null,
            journalMarketBias: typeof jCfg.journalMarketBias === 'string' ? jCfg.journalMarketBias : null,
            journalPsychCheck:
                jCfg.journalPsychCheck && typeof jCfg.journalPsychCheck === 'object'
                    ? jCfg.journalPsychCheck
                    : undefined,
            journalImages: Array.isArray(jCfg.journalImages) ? jCfg.journalImages : undefined,
            createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
            updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
        };
    }

    /**
     * Returns user-defined Backtest Strategies (`backtest_strategies` primary, legacy fallback) cached in Redis + PostgreSQL.
     */
    async getBacktestStrategies(userId: string) {
        const cacheKey = `backtest:strategies:${userId}`;
        try {
            const cached = await this.cacheManager.get<any[]>(cacheKey);
            if (Array.isArray(cached)) {
                return cached;
            }
        } catch (_) {}

        if (this.strategyRepo) {
            try {
                const normRows = await this.strategyRepo.find({
                    where: { userId },
                    order: { updatedAt: 'DESC' },
                    take: 100,
                });
                if (normRows.length > 0) {
                    const formattedNorm = normRows.map((row) => this.formatNormalizedStrategyRow(row));
                    try {
                        await this.cacheManager.set(cacheKey, formattedNorm, 600_000);
                    } catch (_) {}
                    return formattedNorm;
                }
            } catch (_) {}
        }

        const rows = await this.backtestRepo.find({
            where: { userId, mode: 'STRATEGY_DEFINITION' },
            order: { updatedAt: 'DESC' },
            take: 100,
        });

        if (this.strategyRepo && rows.length > 0) {
            try {
                await Promise.all(
                    rows.map((legacy) => {
                        const formatted = this.formatStrategyRow(legacy);
                        return this.strategyRepo!.save({
                            id: legacy.id,
                            userId,
                            clientStrategyId: legacy.config?.clientStrategyId || legacy.clientSessionId || legacy.id,
                            name: formatted.name,
                            tradingMethod: formatted.tradingMethod,
                            description: formatted.description,
                            sessionTag: formatted.sessionTag,
                            status: formatted.status,
                            startingCapital: formatted.startingCapital,
                            currency: formatted.currency,
                            riskMode: formatted.riskMode,
                            riskPerTrade: formatted.riskPerTrade,
                            defaultTimeframe: formatted.defaultTimeframe,
                            rrTarget: formatted.rrTarget,
                            primarySymbol: formatted.primarySymbol,
                            symbols: formatted.symbols,
                            rules: formatted.rules,
                            journalConfig: {
                                journalNotes: formatted.journalNotes,
                                journalTitle: formatted.journalTitle,
                                journalMarketBias: formatted.journalMarketBias,
                                journalPsychCheck: formatted.journalPsychCheck,
                                journalImages: formatted.journalImages || [],
                            },
                        });
                    })
                );
            } catch (_) {}
        }

        const formatted = rows.map((row) => this.formatStrategyRow(row));
        try {
            await this.cacheManager.set(cacheKey, formatted, 600_000); // 10 min Redis cache
        } catch (_) {}
        return formatted;
    }

    /**
     * Upserts a Backtest Strategy definition in PostgreSQL (dual-write to `backtest_sessions` + `backtest_strategies`)
     * and invalidates Redis strategy cache.
     */
    async syncBacktestStrategy(userId: string, data: any) {
        if (!data || typeof data !== 'object') {
            throw new BadRequestException('Invalid strategy payload');
        }
        const rawId = String(data.id || data.strategyId || '').trim();
        const isUuidId = this.isValidUuid(rawId);
        const strategyName = String(data.name || '').trim() || 'Nova Estratégia';
        const primarySymbol = String(data.primarySymbol || data.symbols?.[0] || 'XAUUSD').toUpperCase();
        const symbols = Array.isArray(data.symbols) && data.symbols.length > 0
            ? data.symbols
            : [primarySymbol];

        let existing: BacktestSession | null = null;
        if (isUuidId) {
            existing = await this.backtestRepo.findOne({
                where: { id: rawId, userId, mode: 'STRATEGY_DEFINITION' },
            });
        }
        if (!existing && rawId) {
            existing = await this.backtestRepo.findOne({
                where: { userId, clientSessionId: rawId, mode: 'STRATEGY_DEFINITION' },
                order: { updatedAt: 'DESC' },
            });
        }
        if (!existing && rawId) {
            existing = await this.backtestRepo
                .createQueryBuilder('bs')
                .where('bs.user_id = :userId', { userId })
                .andWhere('bs.mode = :stratMode', { stratMode: 'STRATEGY_DEFINITION' })
                .andWhere(
                    `(bs.config->>'clientStrategyId' = :rawId OR LOWER(bs.name) = LOWER(:strategyName))`,
                    { rawId, strategyName }
                )
                .orderBy('bs.updated_at', 'DESC')
                .getOne();
        }

        let existingNorm: BacktestStrategyEntity | null = null;
        if (this.strategyRepo) {
            try {
                if (existing?.id && this.isValidUuid(existing.id)) {
                    existingNorm = await this.strategyRepo.findOne({ where: { id: existing.id, userId } });
                }
                if (!existingNorm && isUuidId) {
                    existingNorm = await this.strategyRepo.findOne({ where: { id: rawId, userId } });
                }
                if (!existingNorm && rawId) {
                    existingNorm = await this.strategyRepo.findOne({
                        where: { userId, clientStrategyId: rawId },
                        order: { updatedAt: 'DESC' },
                    });
                }
            } catch (_) {}
        }

        const resolvedUuid = existing?.id || existingNorm?.id || (isUuidId ? rawId : undefined);
        const rawStratImages = Array.isArray(data.journalImages)
            ? data.journalImages
            : existing?.config?.journalImages || existingNorm?.journalConfig?.journalImages || [];
        const externalizedStratImages = await this.externalizeImageUrls(
            userId,
            `strat_${rawId || resolvedUuid || 'strategy'}`,
            rawStratImages
        );

        const existingJournalCfg = existingNorm?.journalConfig || existing?.config || {};
        const strategyConfig = {
            ...(existing?.config || {}),
            clientStrategyId: rawId || existing?.id || existingNorm?.id,
            name: strategyName,
            tradingMethod: String(
                data.tradingMethod ??
                    existing?.config?.tradingMethod ??
                    existingNorm?.tradingMethod ??
                    'Smart Money Concepts (SMC / ICT)'
            ),
            description: String(
                data.description ?? existing?.config?.description ?? existingNorm?.description ?? ''
            ),
            sessionTag: String(
                data.sessionTag ?? existing?.config?.sessionTag ?? existingNorm?.sessionTag ?? 'London & NY'
            ),
            status:
                (data.status ?? existing?.config?.status ?? existingNorm?.status) === 'ARCHIVED'
                    ? 'ARCHIVED'
                    : 'ACTIVE',
            startingCapital: Number(
                data.startingCapital ?? existing?.config?.startingCapital ?? existingNorm?.startingCapital ?? 100000
            ),
            currency: String(
                data.currency ?? existing?.config?.currency ?? existingNorm?.currency ?? 'USD'
            ).toUpperCase(),
            riskMode: String(
                data.riskMode ?? existing?.config?.riskMode ?? existingNorm?.riskMode ?? 'FIXED_RISK'
            ),
            riskPerTrade: Number(
                data.riskPerTrade ?? existing?.config?.riskPerTrade ?? existingNorm?.riskPerTrade ?? 1.0
            ),
            defaultTimeframe: String(
                data.defaultTimeframe ?? existing?.config?.defaultTimeframe ?? existingNorm?.defaultTimeframe ?? '5m'
            ),
            rrTarget: Number(data.rrTarget ?? existing?.config?.rrTarget ?? existingNorm?.rrTarget ?? 2.0),
            primarySymbol,
            symbols,
            rules: Array.isArray(data.rules)
                ? data.rules
                : existing?.config?.rules || existingNorm?.rules || [],
            journalNotes: data.journalNotes ?? existingJournalCfg.journalNotes,
            journalTitle:
                data.journalTitle !== undefined ? data.journalTitle : existingJournalCfg.journalTitle ?? null,
            journalMarketBias:
                data.journalMarketBias !== undefined
                    ? data.journalMarketBias
                    : existingJournalCfg.journalMarketBias ?? null,
            journalPsychCheck:
                data.journalPsychCheck !== undefined
                    ? data.journalPsychCheck
                    : existingJournalCfg.journalPsychCheck ?? null,
            journalImages: externalizedStratImages,
            createdAt: data.createdAt ?? existing?.config?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        let saved: BacktestSession;
        if (existing) {
            existing.clientSessionId = rawId || existing.clientSessionId || existing.id;
            existing.name = strategyName;
            existing.mode = 'STRATEGY_DEFINITION';
            existing.strategy = strategyName;
            existing.symbol = primarySymbol;
            existing.config = strategyConfig;
            existing.notes = strategyConfig.description;
            saved = await this.backtestRepo.save(existing);
        } else {
            const created = this.backtestRepo.create({
                ...(resolvedUuid ? { id: resolvedUuid } : {}),
                userId,
                clientSessionId: rawId || null,
                accountId: null,
                name: strategyName,
                mode: 'STRATEGY_DEFINITION',
                strategy: strategyName,
                symbol: primarySymbol,
                config: strategyConfig,
                results: {},
                notes: strategyConfig.description,
            });
            saved = await this.backtestRepo.save(created);
        }

        if (this.strategyRepo && saved?.id) {
            try {
                await this.strategyRepo.save({
                    id: saved.id,
                    userId,
                    clientStrategyId: rawId || saved.id,
                    name: strategyName,
                    tradingMethod: strategyConfig.tradingMethod,
                    description: strategyConfig.description,
                    sessionTag: strategyConfig.sessionTag,
                    status: strategyConfig.status,
                    startingCapital: strategyConfig.startingCapital,
                    currency: strategyConfig.currency,
                    riskMode: strategyConfig.riskMode,
                    riskPerTrade: strategyConfig.riskPerTrade,
                    defaultTimeframe: strategyConfig.defaultTimeframe,
                    rrTarget: strategyConfig.rrTarget,
                    primarySymbol,
                    symbols,
                    rules: strategyConfig.rules,
                    journalConfig: {
                        journalNotes: strategyConfig.journalNotes,
                        journalTitle: strategyConfig.journalTitle,
                        journalMarketBias: strategyConfig.journalMarketBias,
                        journalPsychCheck: strategyConfig.journalPsychCheck,
                        journalImages: externalizedStratImages,
                    },
                });
            } catch (err) {
                this.logger.warn(
                    `Failed to dual-write backtest_strategies row: ${(err as Error).message}`
                );
            }
        }

        try {
            await this.cacheManager.del(`backtest:strategies:${userId}`);
        } catch (_) {}

        return this.formatStrategyRow(saved);
    }

    /**
     * Deletes a user-defined Backtest Strategy from PostgreSQL (`backtest_sessions` + `backtest_strategies`) + Redis.
     */
    async deleteBacktestStrategyById(userId: string, strategyId: string) {
        const cleanId = (strategyId || '').trim();
        if (!cleanId) return { ok: false, deleted: false };

        let found: BacktestSession | null = null;
        if (this.isValidUuid(cleanId)) {
            found = await this.backtestRepo.findOne({
                where: { id: cleanId, userId, mode: 'STRATEGY_DEFINITION' },
            });
        }
        if (!found) {
            found = await this.backtestRepo.findOne({
                where: { userId, clientSessionId: cleanId, mode: 'STRATEGY_DEFINITION' },
                order: { updatedAt: 'DESC' },
            });
        }
        if (!found) {
            found = await this.backtestRepo
                .createQueryBuilder('bs')
                .where('bs.user_id = :userId', { userId })
                .andWhere('bs.mode = :stratMode', { stratMode: 'STRATEGY_DEFINITION' })
                .andWhere(`bs.config->>'clientStrategyId' = :cleanId`, { cleanId })
                .orderBy('bs.updated_at', 'DESC')
                .getOne();
        }

        const deletedLegacyId = found?.id;
        if (found) {
            await this.backtestRepo.remove(found);
        }

        let deletedNormalized = false;
        if (this.strategyRepo) {
            try {
                if (deletedLegacyId && this.isValidUuid(deletedLegacyId)) {
                    const res1 = await this.strategyRepo.delete({ id: deletedLegacyId, userId });
                    if (Number(res1?.affected || 0) > 0) deletedNormalized = true;
                }
                if (this.isValidUuid(cleanId)) {
                    const res2 = await this.strategyRepo.delete({ id: cleanId, userId });
                    if (Number(res2?.affected || 0) > 0) deletedNormalized = true;
                }
                const res3 = await this.strategyRepo.delete({ userId, clientStrategyId: cleanId });
                if (Number(res3?.affected || 0) > 0) deletedNormalized = true;
            } catch (_) {}
        }

        try {
            await this.cacheManager.del(`backtest:strategies:${userId}`);
        } catch (_) {}

        return { ok: true, deleted: Boolean(found || deletedNormalized), id: cleanId };
    }

    private hypothesisToSessionShape(hyp: BacktestHypothesisEntity): BacktestSession {
        return {
            id: hyp.id,
            userId: hyp.userId,
            clientSessionId: hyp.id,
            accountId: hyp.accountId || undefined,
            name: hyp.name,
            mode: hyp.mode,
            strategy: hyp.strategy,
            symbol: hyp.symbol,
            config: hyp.config || {},
            results: hyp.results || {},
            notes: hyp.notes || '',
            createdAt: hyp.createdAt,
            updatedAt: hyp.updatedAt,
        } as BacktestSession;
    }

    private async assertValidAccountScope(userId: string, accountId?: string): Promise<boolean> {
        const hasSpecificAccount = Boolean(accountId && accountId !== 'all');
        if (hasSpecificAccount) {
            if (!this.isValidUuid(accountId!)) {
                throw new ForbiddenException('Acesso negado à conta');
            }
            const acc = await this.accountRepo.findOne({
                where: { id: accountId, userId },
                select: ['id'],
            });
            if (!acc) throw new ForbiddenException('Acesso negado à conta');
        }
        return hasSpecificAccount;
    }

    /**
     * Persists a Backtest Hypothesis (`ACCOUNT_HISTORY` | `STRATEGY_SIM`) with dual-write into
     * `backtest_hypotheses` + `backtest_sessions` using shared UUID.
     */
    async saveBacktestHypothesis(userId: string, data: any) {
        if (!data || typeof data !== 'object') {
            throw new BadRequestException('Invalid hypothesis payload');
        }

        let resolvedAccountId: string | null = null;
        if (data.accountId && data.accountId !== 'all') {
            await this.assertValidAccountScope(userId, String(data.accountId));
            resolvedAccountId = String(data.accountId);
        } else {
            const primary = await this.getPrimaryAccount(userId);
            resolvedAccountId = primary?.id || null;
        }

        const rawId = String(data.id || data.hypothesisId || '').trim();
        const isUuidId = this.isValidUuid(rawId);
        const mode = data.mode === 'STRATEGY_SIM' ? 'STRATEGY_SIM' : 'ACCOUNT_HISTORY';
        const name = String(data.name || '').trim() || `Hipótese - ${new Date().toLocaleDateString('pt-BR')}`;
        const strategy = String(data.strategy || data.strategyName || 'Hipótese sobre o histórico');
        const symbol = String(data.symbol || data.config?.symbol || 'ALL');
        const config = data.config && typeof data.config === 'object' ? data.config : {};
        const results = data.results && typeof data.results === 'object' ? data.results : {};
        const notes = data.notes ?? '';

        let existingLegacy: BacktestSession | null = null;
        if (isUuidId) {
            existingLegacy = await this.backtestRepo.findOne({
                where: { id: rawId, userId },
            });
        }

        let savedLegacy: BacktestSession;
        if (existingLegacy) {
            existingLegacy.accountId = resolvedAccountId || existingLegacy.accountId;
            existingLegacy.name = name;
            existingLegacy.mode = mode;
            existingLegacy.strategy = strategy;
            existingLegacy.symbol = symbol;
            existingLegacy.config = config;
            existingLegacy.results = results;
            existingLegacy.notes = notes;
            savedLegacy = await this.backtestRepo.save(existingLegacy);
        } else {
            const created = this.backtestRepo.create({
                ...(isUuidId ? { id: rawId } : {}),
                userId,
                clientSessionId: isUuidId ? rawId : null,
                accountId: resolvedAccountId,
                name,
                mode,
                strategy,
                symbol,
                config,
                results,
                notes,
            });
            savedLegacy = await this.backtestRepo.save(created);
        }

        if (this.hypothesisRepo && savedLegacy?.id) {
            try {
                await this.hypothesisRepo.save({
                    id: savedLegacy.id,
                    userId,
                    accountId: resolvedAccountId,
                    name,
                    mode,
                    strategy,
                    symbol,
                    config,
                    results,
                    notes,
                });
            } catch (err) {
                this.logger.warn(
                    `Failed to persist normalized backtest_hypotheses row: ${(err as Error).message}`
                );
            }
        }

        try {
            await this.cacheManager.del(`backtest:hypotheses:${userId}:all`);
            if (resolvedAccountId) {
                await this.cacheManager.del(`backtest:hypotheses:${userId}:${resolvedAccountId}`);
            }
        } catch (_) {}
        await this.invalidateBacktestHistoryCaches(userId, resolvedAccountId);

        return savedLegacy;
    }

    /**
     * Lists user hypotheses from `backtest_hypotheses` with lazy fallback/backfill from `backtest_sessions`.
     */
    async getBacktestHypotheses(userId: string, accountId?: string) {
        const hasSpecificAccount = await this.assertValidAccountScope(userId, accountId);
        const cacheKey = `backtest:hypotheses:${userId}:${hasSpecificAccount ? accountId : 'all'}`;

        try {
            const cached = await this.cacheManager.get<BacktestSession[]>(cacheKey);
            if (Array.isArray(cached)) {
                return cached;
            }
        } catch (_) {}

        if (this.hypothesisRepo) {
            try {
                const hypWhere: any = hasSpecificAccount ? { userId, accountId } : { userId };
                const normRows = await this.hypothesisRepo.find({
                    where: hypWhere,
                    order: { updatedAt: 'DESC' },
                    take: 100,
                });
                if (normRows.length > 0) {
                    const shaped = normRows.map((row) => this.hypothesisToSessionShape(row));
                    try {
                        await this.cacheManager.set(cacheKey, shaped, 300_000);
                    } catch (_) {}
                    return shaped;
                }
            } catch (_) {}
        }

        const legacyWhere: any = hasSpecificAccount
            ? { userId, accountId, mode: In(['ACCOUNT_HISTORY', 'STRATEGY_SIM']) }
            : { userId, mode: In(['ACCOUNT_HISTORY', 'STRATEGY_SIM']) };
        const legacyRows = await this.backtestRepo.find({
            where: legacyWhere,
            order: { updatedAt: 'DESC' },
            take: 100,
        });

        if (this.hypothesisRepo && legacyRows.length > 0) {
            try {
                await Promise.all(
                    legacyRows.map((legacy) =>
                        this.hypothesisRepo!.save({
                            id: legacy.id,
                            userId,
                            accountId: legacy.accountId || null,
                            name: legacy.name,
                            mode: legacy.mode,
                            strategy: legacy.strategy,
                            symbol: legacy.symbol,
                            config: legacy.config || {},
                            results: legacy.results || {},
                            notes: legacy.notes || '',
                        })
                    )
                );
            } catch (_) {}
        }

        try {
            await this.cacheManager.set(cacheKey, legacyRows, 300_000);
        } catch (_) {}
        return legacyRows;
    }

    /**
     * Deletes a hypothesis from both `backtest_hypotheses` and `backtest_sessions` + Redis caches.
     */
    async deleteBacktestHypothesisById(userId: string, hypothesisId: string) {
        const cleanId = (hypothesisId || '').trim();
        if (!cleanId) return { ok: false, deleted: false };

        let deletedNorm = false;
        let deletedAccountId: string | null = null;
        if (this.hypothesisRepo && this.isValidUuid(cleanId)) {
            try {
                const existingNorm = await this.hypothesisRepo.findOne({
                    where: { id: cleanId, userId },
                    select: ['id', 'accountId'],
                });
                if (existingNorm) deletedAccountId = existingNorm.accountId || null;
                const res = await this.hypothesisRepo.delete({ id: cleanId, userId });
                if (Number(res?.affected || 0) > 0) deletedNorm = true;
            } catch (_) {}
        }

        let deletedLegacy = false;
        if (this.isValidUuid(cleanId)) {
            const existingLegacy = await this.backtestRepo.findOne({
                where: { id: cleanId, userId, mode: In(['ACCOUNT_HISTORY', 'STRATEGY_SIM']) },
            });
            if (existingLegacy) {
                deletedAccountId = deletedAccountId || existingLegacy.accountId || null;
                await this.backtestRepo.remove(existingLegacy);
                deletedLegacy = true;
            }
        }

        try {
            await this.cacheManager.del(`backtest:hypotheses:${userId}:all`);
            if (deletedAccountId) {
                await this.cacheManager.del(`backtest:hypotheses:${userId}:${deletedAccountId}`);
            }
        } catch (_) {}
        await this.invalidateBacktestHistoryCaches(userId, deletedAccountId);

        return { ok: true, deleted: Boolean(deletedNorm || deletedLegacy), id: cleanId };
    }

    private toSlimHistoryRecords(records: BacktestSession[], slim: boolean): BacktestSession[] {
        if (!slim || !Array.isArray(records)) return records;
        return records.map((rec) => {
            if (!rec?.config || typeof rec.config !== 'object') return rec;
            const cfg = rec.config as Record<string, any>;
            let enrichedResults = rec.results;
            if (rec.mode === 'REPLAY_SESSION' && Array.isArray(cfg.orders) && cfg.orders.length > 0) {
                const startCap = Number(cfg.startingCapital || rec.results?.initialBalance || 100000);
                const calc = this.computeAuthoritativeOrderSummary(cfg.orders, startCap);
                enrichedResults = {
                    ...(rec.results || {}),
                    ...calc,
                };
            }
            const {
                orders: _ord,
                drawings: _d,
                drawnItems: _di,
                drawingStylesById: _ds,
                overlayGeometries: _og,
                sessionScreenshots: _ss,
                journalImages: _ji,
                _blobSplit: _bs,
                ...restCfg
            } = cfg;
            return {
                ...rec,
                results: enrichedResults,
                config: {
                    ...restCfg,
                    orders: [],
                    _slimHistory: true,
                },
            } as BacktestSession;
        });
    }

    async getBacktestHistory(userId: string, accountId?: string, slim: boolean = false) {
        const hasSpecificAccount = await this.assertValidAccountScope(userId, accountId);
        const scope = hasSpecificAccount ? accountId : 'all';
        const historyCacheKey = `backtest:history:${userId}:${scope}:${slim ? 'slim' : 'full'}`;

        try {
            const cachedHistory = await this.cacheManager.get<BacktestSession[]>(historyCacheKey);
            if (Array.isArray(cachedHistory)) {
                return cachedHistory;
            }
        } catch (_) {}

        const whereClause: any = hasSpecificAccount
            ? { userId, accountId, mode: Not('STRATEGY_DEFINITION') }
            : { userId, mode: Not('STRATEGY_DEFINITION') };

        let records = await this.backtestRepo.find({
            where: whereClause,
            order: { updatedAt: 'DESC' },
            take: 100,
        });

        // Always rehydrate `_blobSplit` records so `results` KPIs can be reconciled before slimming
        if (this.sessionBlobRepo && records.length > 0) {
            const splitIds = records
                .filter((r) => r?.config?._blobSplit && this.isValidUuid(r.id))
                .map((r) => r.id);
            if (splitIds.length > 0) {
                try {
                    const blobs = await this.sessionBlobRepo.find({
                        where: { sessionId: In(splitIds), userId },
                    });
                    const blobMap = new Map(blobs.map((b) => [b.sessionId, b]));
                    records = records.map((rec) =>
                        rec?.config?._blobSplit
                            ? this.rehydrateSessionWithBlob(rec, blobMap.get(rec.id))
                            : rec
                    );
                } catch (_) {}
            }
        }

        if (this.hypothesisRepo) {
            try {
                const hypWhere: any = hasSpecificAccount ? { userId, accountId } : { userId };
                const normHyps = await this.hypothesisRepo.find({
                    where: hypWhere,
                    order: { updatedAt: 'DESC' },
                    take: 100,
                });
                const existingIds = new Set(records.map((r) => r.id));
                let mergedAny = false;
                for (const hyp of normHyps) {
                    if (!existingIds.has(hyp.id)) {
                        records.push(this.hypothesisToSessionShape(hyp));
                        mergedAny = true;
                    }
                }
                if (mergedAny) {
                    records.sort(
                        (a, b) =>
                            new Date(b.updatedAt || b.createdAt || 0).getTime() -
                            new Date(a.updatedAt || a.createdAt || 0).getTime()
                    );
                }
            } catch (_) {}
        }

        const payloadToCache = slim ? this.toSlimHistoryRecords(records, true) : records;

        try {
            await this.cacheManager.set(historyCacheKey, payloadToCache, 300_000); // 5 min Redis cache
        } catch (_) {}

        return payloadToCache;
    }
}
