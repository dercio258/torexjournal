import {
    Injectable,
    Inject,
    Optional,
    BadRequestException,
    ForbiddenException,
    NotFoundException,
    OnModuleInit,
    Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DataSource, In, Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { TradeEntity } from '../mt5/trade.entity';
import { PositionEntity } from '../mt5/position.entity';
import { AccountEntity } from '../account/account.entity';
import { MentalLog } from './mental-log.entity';
import { TechnicalJournal } from './technical-journal.entity';
import {
    DailyNoteEntity,
    TradeNoteEntity,
    GeneralNoteEntity,
} from './journal-notes.entity';
import { ClickHouseService } from '../clickhouse/clickhouse.service';

export interface DailyJournalMetrics {
    totalTrades: number;
    closedTrades: number;
    wins: number;
    losses: number;
    breakevens: number;
    totalCommissions: number;
    grossPnl: number;
    netPnl: number;
    winRate: number | null;
    profitFactor: number | null;
    avgMfe: number | null;
    maxMfe: number | null;
    avgMae: number | null;
    maxMae: number | null;
}

@Injectable()
export class JournalService implements OnModuleInit {
    private readonly logger = new Logger(JournalService.name);

    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(TradeEntity)
        private readonly tradeRepo: Repository<TradeEntity>,
        @InjectRepository(PositionEntity)
        private readonly positionRepo: Repository<PositionEntity>,
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
        @InjectRepository(MentalLog)
        private readonly mentalLogRepo: Repository<MentalLog>,
        @InjectRepository(TechnicalJournal)
        private readonly techJournalRepo: Repository<TechnicalJournal>,
        @InjectRepository(DailyNoteEntity)
        private readonly dailyNoteRepo: Repository<DailyNoteEntity>,
        @InjectRepository(TradeNoteEntity)
        private readonly tradeNoteRepo: Repository<TradeNoteEntity>,
        @InjectRepository(GeneralNoteEntity)
        private readonly generalNoteRepo: Repository<GeneralNoteEntity>,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
        private readonly clickHouseService: ClickHouseService,
        @Optional()
        private readonly eventEmitter?: EventEmitter2
    ) {}

    /**
     * Garante migração segura e idempotente das tabelas e colunas de Journal
     * mesmo quando DB_SYNCHRONIZE=false em produção.
     */
    async onModuleInit() {
        try {
            await this.dataSource.query(`
                ALTER TABLE trades ADD COLUMN IF NOT EXISTS mfe DECIMAL(18, 2);
                ALTER TABLE trades ADD COLUMN IF NOT EXISTS mae DECIMAL(18, 2);
                ALTER TABLE trades ADD COLUMN IF NOT EXISTS setup VARCHAR;
                ALTER TABLE trades ADD COLUMN IF NOT EXISTS mood VARCHAR;
                ALTER TABLE trades ADD COLUMN IF NOT EXISTS lesson TEXT;
                ALTER TABLE trades ADD COLUMN IF NOT EXISTS rating INT DEFAULT 0;
            `);

            await this.dataSource.query(`
                CREATE TABLE IF NOT EXISTS daily_notes (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR NOT NULL,
                    account_key VARCHAR NOT NULL DEFAULT 'all',
                    date DATE NOT NULL,
                    title VARCHAR,
                    content TEXT NOT NULL DEFAULT '',
                    mood VARCHAR,
                    market_bias VARCHAR,
                    psych_check JSONB NOT NULL DEFAULT '{}'::jsonb,
                    images JSONB NOT NULL DEFAULT '[]'::jsonb,
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP NOT NULL DEFAULT now()
                );
                ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS title VARCHAR;
                ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '';
                ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS mood VARCHAR;
                ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS market_bias VARCHAR;
                ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS psych_check JSONB NOT NULL DEFAULT '{}'::jsonb;
                ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb;
                CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_notes_user_acc_date
                    ON daily_notes (user_id, account_key, date);
                CREATE INDEX IF NOT EXISTS idx_daily_notes_user_date
                    ON daily_notes (user_id, date DESC);
            `);

            await this.dataSource.query(`
                CREATE TABLE IF NOT EXISTS trade_notes (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR NOT NULL,
                    trade_id VARCHAR NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    screenshot_url TEXT,
                    screenshots JSONB NOT NULL DEFAULT '[]'::jsonb,
                    setup VARCHAR,
                    mistakes TEXT,
                    lessons TEXT,
                    rating INT NOT NULL DEFAULT 0,
                    psych_check JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP NOT NULL DEFAULT now()
                );
                ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '';
                ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
                ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS screenshots JSONB NOT NULL DEFAULT '[]'::jsonb;
                ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS setup VARCHAR;
                ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS mistakes TEXT;
                ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS lessons TEXT;
                ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS rating INT NOT NULL DEFAULT 0;
                ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS psych_check JSONB NOT NULL DEFAULT '{}'::jsonb;
                CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_notes_user_trade
                    ON trade_notes (user_id, trade_id);
                CREATE INDEX IF NOT EXISTS idx_trade_notes_user_updated
                    ON trade_notes (user_id, updated_at DESC);
            `);

            await this.dataSource.query(`
                CREATE TABLE IF NOT EXISTS general_notes (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR NOT NULL,
                    title VARCHAR NOT NULL,
                    category VARCHAR NOT NULL DEFAULT 'GENERAL',
                    content TEXT NOT NULL DEFAULT '',
                    images JSONB NOT NULL DEFAULT '[]'::jsonb,
                    pinned BOOLEAN NOT NULL DEFAULT false,
                    is_template BOOLEAN NOT NULL DEFAULT false,
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP NOT NULL DEFAULT now()
                );
                ALTER TABLE general_notes ADD COLUMN IF NOT EXISTS category VARCHAR NOT NULL DEFAULT 'GENERAL';
                ALTER TABLE general_notes ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '';
                ALTER TABLE general_notes ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb;
                ALTER TABLE general_notes ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
                ALTER TABLE general_notes ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false;
                CREATE INDEX IF NOT EXISTS idx_general_notes_user_tpl_pin
                    ON general_notes (user_id, is_template, pinned);
            `);
        } catch (err) {
            this.logger.warn(`JournalService DDL check warning: ${(err as Error).message}`);
        }
    }

    private isValidUuid(id?: string): boolean {
        return !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
    }

    private stripHtml(html?: string | null): string {
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

    private cleanImageUrl(raw?: string | null): string | null {
        if (!raw || typeof raw !== 'string') return null;
        const cleaned = raw.replace(/#(antes|depois|extra)$/i, '').trim();
        return cleaned || null;
    }

    private async bumpDashboardCache(userId: string) {
        this.eventEmitter?.emit('ai.rag.invalidate_user', { userId });
        try {
            const key = `dashboard:ver:${userId}`;
            const cur = await this.cacheManager.get<number>(key);
            const next = (typeof cur === 'number' && cur > 0 ? cur : 1) + 1;
            await this.cacheManager.set(key, next, 86400000);
        } catch (err) {
            this.logger.debug(`Cache bump skipped: ${(err as Error).message}`);
        }
    }

    private mapPsychToMentalScores(
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
        const sleepMap: Record<string, number> = {
            Exausto: 2,
            Sonolento: 4,
            Normal: 6,
            Disposto: 8,
            Excelente: 10,
        };
        const energyMap: Record<string, number> = {
            Esgotado: 2,
            Fadigado: 4,
            Normal: 6,
            Hiperativo: 7,
            Confiante: 9,
        };
        const focusMap: Record<string, number> = {
            Distraído: 2,
            Frágil: 4,
            'Foco funcional': 8,
            'Hiper foco': 10,
        };
        const caffeineMap: Record<string, number> = {
            'Sem consumo': 0,
            Baixo: 2,
            Normal: 5,
            Elevado: 7,
            'Consumo crítico': 9,
        };
        const moodMap: Record<string, number> = {
            Estressado: 2,
            Ansioso: 3,
            Preocupado: 4,
            Eufórico: 6,
            Confiante: 8,
            Focado: 8,
            Calmo: 9,
        };
        const stressMap: Record<string, number> = {
            Baixo: 2,
            Normal: 5,
            Excessivo: 9,
        };

        const sleepQuality = psych?.sleep ? sleepMap[psych.sleep] : undefined;
        const energy = psych?.energy ? energyMap[psych.energy] : undefined;
        const focus = psych?.focus ? focusMap[psych.focus] : undefined;
        const caffeine = psych?.caffeine ? caffeineMap[psych.caffeine] : undefined;
        const moodKey = psych?.moodState || fallbackMood || '';
        const mood = moodKey ? moodMap[moodKey] : undefined;
        const stress = psych?.stress ? stressMap[psych.stress] : undefined;

        return { sleepQuality, energy, focus, caffeine, mood, stress };
    }

    private normalizeAccountKey(accountId?: string): string {
        if (!accountId || accountId === 'all' || accountId === 'undefined' || accountId === 'null') {
            return 'all';
        }
        return accountId;
    }

    private sanitizePathToken(raw?: string, fallback = 'item'): string {
        const clean = String(raw || '')
            .replace(/[^a-zA-Z0-9_-]/g, '')
            .slice(0, 80);
        return clean || fallback;
    }

    private normalizeSide(rawType?: string): 'BUY' | 'SELL' {
        const upper = String(rawType || '').toUpperCase();
        if (upper.includes('SELL') || upper.includes('PUT') || upper === 'SHORT') {
            return 'SELL';
        }
        return 'BUY';
    }

    private async resolveUserAccounts(userId: string, accountId?: string) {
        const allAccounts = await this.accountRepo.find({
            where: { userId, isArchived: false },
        });
        if (accountId && accountId !== 'all') {
            const target = allAccounts.find((a) => a.id === accountId);
            if (!target) {
                throw new ForbiddenException('Acesso negado à conta de trading selecionada');
            }
            return {
                accounts: [target],
                accountIds: [target.id],
                accountKey: target.id,
            };
        }
        return {
            accounts: allAccounts,
            accountIds: allAccounts.map((a) => a.id),
            accountKey: 'all',
        };
    }

    /**
     * Agrega blocos cronológicos diários com:
     * - Total de Comissões do dia
     * - Quantidade total de Trades executados
     * - Taxa de Acerto (Win %) sobre trades fechados
     * - Fator de Lucro (Profit Factor = Gross Profit / |Gross Loss|)
     * - Médias e extremos de MFE e MAE
     */
    async getOverview(
        userId: string,
        accountId?: string,
        startDate?: string,
        endDate?: string
    ) {
        const { accounts, accountIds, accountKey } = await this.resolveUserAccounts(
            userId,
            accountId
        );
        const accMap = new Map(accounts.map((a) => [a.id, a]));

        let closedTrades: TradeEntity[] = [];
        let openPositions: PositionEntity[] = [];
        let legacyJournals: TechnicalJournal[] = [];

        if (accountIds.length > 0) {
            const tradeWhere: any = { accountId: In(accountIds) };
            if (startDate && endDate) {
                tradeWhere.closeTime = Between(new Date(startDate), new Date(endDate));
            } else if (startDate) {
                tradeWhere.closeTime = MoreThanOrEqual(new Date(startDate));
            } else if (endDate) {
                tradeWhere.closeTime = LessThanOrEqual(new Date(endDate));
            }

            [closedTrades, openPositions, legacyJournals] = await Promise.all([
                this.tradeRepo.find({
                    where: tradeWhere,
                    order: { closeTime: 'DESC' },
                    take: 600,
                }),
                this.positionRepo.find({
                    where: { accountId: In(accountIds) },
                    order: { openTime: 'DESC' },
                }),
                this.techJournalRepo
                    .find({
                        where: { accountId: In(accountIds) },
                        order: { date: 'DESC' },
                        take: 180,
                    })
                    .catch(() => [] as TechnicalJournal[]),
            ]);
        }

        const visibleTradeIds = Array.from(
            new Set(
                [
                    ...closedTrades.flatMap((t) => [String(t.id || ''), String(t.ticket || '')]),
                    ...openPositions.flatMap((p) => [String(p.id || ''), String(p.ticket || '')]),
                ].filter(Boolean)
            )
        );

        const dailyWhere: any =
            accountKey === 'all'
                ? { userId }
                : [{ userId, accountKey }, { userId, accountKey: 'all' }];

        const [dailyNotes, tradeNotesList, allGeneralNotes] = await Promise.all([
            this.dailyNoteRepo.find({
                where: dailyWhere,
                order: { date: 'DESC', updatedAt: 'DESC' },
            }),
            visibleTradeIds.length > 0
                ? this.tradeNoteRepo
                      .createQueryBuilder('tn')
                      .where('tn.user_id = :userId', { userId })
                      .andWhere('tn.trade_id = ANY(:visibleTradeIds)', { visibleTradeIds })
                      .orderBy('tn.updated_at', 'DESC')
                      .getMany()
                      .catch(() => [] as TradeNoteEntity[])
                : Promise.resolve([] as TradeNoteEntity[]),
            this.generalNoteRepo.find({
                where: { userId },
                order: { pinned: 'DESC', updatedAt: 'DESC' },
            }),
        ]);

        const tradeNoteMap = new Map<string, TradeNoteEntity>();
        for (const tn of tradeNotesList) {
            tradeNoteMap.set(tn.tradeId, tn);
        }

        // Prioriza a nota específica da conta quando accountKey !== 'all'
        const dailyNoteByDate = new Map<string, DailyNoteEntity>();
        for (const dn of dailyNotes) {
            const dateKey = String(dn.date).slice(0, 10);
            const existing = dailyNoteByDate.get(dateKey);
            if (!existing || (accountKey !== 'all' && dn.accountKey === accountKey)) {
                dailyNoteByDate.set(dateKey, dn);
            }
        }

        // Fallback transparente para notas antigas em technical_journals
        const legacyByDate = new Map<string, TechnicalJournal>();
        for (const lj of legacyJournals) {
            const dateKey = String(lj.date).slice(0, 10);
            if (!legacyByDate.has(dateKey) && (lj.notes || lj.lessons || lj.mistakes)) {
                legacyByDate.set(dateKey, lj);
            }
        }

        // Unificar trades fechados e posições abertas em formato normalizado
        const normalizedTrades: any[] = [];

        for (const pos of openPositions) {
            const dateKey = pos.openTime
                ? new Date(pos.openTime).toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10);
            const acc = accMap.get(pos.accountId);
            const side = this.normalizeSide(pos.type);
            const gross = Number(pos.profit) || 0;
            const comm = Math.abs(Number((pos as any).commission) || 0);
            const swap = Number((pos as any).swap) || 0;
            const net = gross - comm + swap;
            const posIdStr = String(pos.id);
            const posTicketStr = String(pos.ticket || pos.id);
            const posNote = tradeNoteMap.get(posIdStr) || tradeNoteMap.get(posTicketStr);

            normalizedTrades.push({
                id: posIdStr,
                ticket: posTicketStr,
                accountId: pos.accountId,
                accountName: acc?.name || 'Conta',
                symbol: pos.symbol,
                side,
                status: 'OPEN',
                openTime: pos.openTime ? new Date(pos.openTime).toISOString() : null,
                closeTime: null,
                dateKey,
                openPrice: Number(pos.openPrice) || 0,
                closePrice: Number(pos.currentPrice) || 0,
                avgBuy: side === 'BUY' ? Number(pos.openPrice) || 0 : Number(pos.currentPrice) || 0,
                avgSell: side === 'SELL' ? Number(pos.openPrice) || 0 : Number(pos.currentPrice) || 0,
                volume: Number(pos.volume) || 0,
                grossPnl: Number(gross.toFixed(2)),
                netPnl: Number(net.toFixed(2)),
                commission: Number(comm.toFixed(2)),
                swap: Number(swap.toFixed(2)),
                mfe: null,
                mae: null,
                setup: posNote?.setup ?? null,
                rating: posNote?.rating ?? 0,
                behavioralMl: null,
                behavioralFeedback: null,
                tradeNote: posNote
                    ? {
                          id: posNote.id,
                          tradeId: posIdStr,
                          content: posNote.content || '',
                          screenshotUrl: posNote.screenshotUrl || null,
                          screenshots: Array.isArray(posNote.screenshots) ? posNote.screenshots : [],
                          setup: posNote.setup ?? null,
                          mistakes: posNote.mistakes ?? null,
                          lessons: posNote.lessons ?? null,
                          rating: posNote.rating ?? 0,
                          psychCheck:
                              posNote.psychCheck && typeof posNote.psychCheck === 'object'
                                  ? posNote.psychCheck
                                  : {},
                          updatedAt: posNote.updatedAt,
                      }
                    : null,
            });
        }

        for (const t of closedTrades) {
            const refDate = t.closeTime || t.openTime;
            if (!refDate) continue;
            const dateKey = new Date(refDate).toISOString().slice(0, 10);
            const acc = accMap.get(t.accountId);
            const side = this.normalizeSide(t.type);

            const gross = Number(t.profit) || 0;
            const rawComm = Number(t.commission) || 0;
            const rawFees = Number(t.fees) || 0;
            const swap = Number(t.swap) || 0;
            const absCommission = Math.abs(rawComm) + Math.abs(rawFees);
            const net =
                t.netPnl !== null && t.netPnl !== undefined
                    ? Number(t.netPnl)
                    : gross + rawComm - Math.abs(rawFees) + swap;

            const openPrice = Number(t.openPrice) || 0;
            const closePrice = Number(t.closePrice) || 0;
            const pctMove =
                openPrice > 0
                    ? Number(
                          (
                              ((side === 'BUY' ? closePrice - openPrice : openPrice - closePrice) /
                                  openPrice) *
                              100
                          ).toFixed(2)
                      )
                    : null;

            const tn = tradeNoteMap.get(t.id);
            const fallbackNoteContent =
                tn?.content ||
                (t.lesson ? `<p>${t.lesson}</p>` : '');

            normalizedTrades.push({
                id: t.id,
                ticket: String(t.ticket || t.id.slice(0, 8)),
                accountId: t.accountId,
                accountName: acc?.name || 'Conta',
                symbol: t.symbol,
                side,
                status: String(t.status || 'CLOSED').toUpperCase() === 'OPEN' ? 'OPEN' : 'CLOSED',
                openTime: t.openTime ? new Date(t.openTime).toISOString() : null,
                closeTime: t.closeTime ? new Date(t.closeTime).toISOString() : null,
                dateKey,
                openPrice,
                closePrice,
                avgBuy: side === 'BUY' ? openPrice : closePrice,
                avgSell: side === 'SELL' ? openPrice : closePrice,
                volume: Number(t.volume) || 0,
                grossPnl: Number(gross.toFixed(2)),
                netPnl: Number(net.toFixed(2)),
                pnlPct: pctMove,
                commission: Number(absCommission.toFixed(2)),
                swap: Number(swap.toFixed(2)),
                mfe: t.mfe !== null && t.mfe !== undefined ? Number(t.mfe) : null,
                mae: t.mae !== null && t.mae !== undefined ? Number(t.mae) : null,
                setup: tn?.setup ?? t.setup ?? null,
                rating: tn?.rating ?? t.rating ?? 0,
                behavioralMl: t.qualityFlags?.behavioralMl ?? null,
                behavioralFeedback: t.qualityFlags?.behavioralFeedback ?? null,
                tradeNote:
                    tn || fallbackNoteContent
                        ? {
                              id: tn?.id || null,
                              tradeId: t.id,
                              content: fallbackNoteContent,
                              screenshotUrl: tn?.screenshotUrl || null,
                              screenshots: Array.isArray(tn?.screenshots) ? tn!.screenshots : [],
                              setup: tn?.setup ?? t.setup ?? null,
                              mistakes: tn?.mistakes ?? null,
                              lessons: tn?.lessons ?? t.lesson ?? null,
                              rating: tn?.rating ?? t.rating ?? 0,
                              psychCheck:
                                  tn?.psychCheck && typeof tn.psychCheck === 'object'
                                      ? tn.psychCheck
                                      : {},
                              updatedAt: tn?.updatedAt || t.updatedAt,
                          }
                        : null,
            });
        }

        // Coletar todas as datas relevantes (dias com trades, dias com notas e hoje caso vazio)
        const allDatesSet = new Set<string>();
        for (const tr of normalizedTrades) {
            allDatesSet.add(tr.dateKey);
        }
        for (const dateKey of dailyNoteByDate.keys()) {
            allDatesSet.add(dateKey);
        }
        for (const dateKey of legacyByDate.keys()) {
            allDatesSet.add(dateKey);
        }

        const todayKey = new Date().toISOString().slice(0, 10);
        if (allDatesSet.size === 0) {
            allDatesSet.add(todayKey);
        }

        // Agrupar trades por data
        const tradesByDate = new Map<string, any[]>();
        for (const tr of normalizedTrades) {
            const list = tradesByDate.get(tr.dateKey) || [];
            list.push(tr);
            tradesByDate.set(tr.dateKey, list);
        }

        const sortedDates = Array.from(allDatesSet).sort((a, b) => b.localeCompare(a));

        const dailyBlocks = sortedDates.map((dateKey) => {
            const dayTrades = tradesByDate.get(dateKey) || [];
            const metrics = this.computeDailyAggregations(dayTrades);

            const dn = dailyNoteByDate.get(dateKey);
            const legacy = legacyByDate.get(dateKey);

            let notePayload: any = null;
            if (dn) {
                notePayload = {
                    id: dn.id,
                    date: dateKey,
                    title: dn.title,
                    content: dn.content || '',
                    mood: dn.mood,
                    marketBias: dn.marketBias,
                    psychCheck:
                        dn.psychCheck && typeof dn.psychCheck === 'object'
                            ? dn.psychCheck
                            : dn.mood
                            ? { moodState: dn.mood }
                            : {},
                    images: Array.isArray(dn.images) ? dn.images : [],
                    updatedAt: dn.updatedAt,
                };
            } else if (legacy) {
                const synthesizedParts: string[] = [];
                if (legacy.notes) synthesizedParts.push(legacy.notes);
                if (legacy.lessons) synthesizedParts.push(`<p><strong>Lições:</strong> ${legacy.lessons}</p>`);
                if (legacy.mistakes) synthesizedParts.push(`<p><strong>Erros:</strong> ${legacy.mistakes}</p>`);
                notePayload = {
                    id: null,
                    date: dateKey,
                    title: legacy.strategyUsed || null,
                    content: synthesizedParts.join('\n'),
                    mood: legacy.emotionalState || null,
                    marketBias: legacy.marketTrend || null,
                    psychCheck: legacy.emotionalState
                        ? { moodState: legacy.emotionalState }
                        : {},
                    images: [],
                    updatedAt: legacy.updatedAt,
                };
            }

            return {
                date: dateKey,
                metrics,
                note: notePayload,
                trades: dayTrades,
            };
        });

        const generalNotes = allGeneralNotes.filter((n) => !n.isTemplate);
        const templates = allGeneralNotes.filter((n) => n.isTemplate);

        return {
            dailyBlocks,
            recentTrades: normalizedTrades.slice(0, 120),
            generalNotes,
            templates,
        };
    }

    /**
     * Cálculo das agregações financeiras e de risco de um bloco diário.
     */
    computeDailyAggregations(dayTrades: any[]): DailyJournalMetrics {
        const totalTrades = dayTrades.length;
        const closedList = dayTrades.filter((t) => t.status === 'CLOSED');
        const closedTrades = closedList.length;

        let totalCommissions = 0;
        let grossPnl = 0;
        let netPnl = 0;
        let grossProfit = 0;
        let grossLossAbs = 0;
        let wins = 0;
        let losses = 0;
        let breakevens = 0;

        const mfeValues: number[] = [];
        const maeValues: number[] = [];

        for (const t of dayTrades) {
            totalCommissions += Math.abs(Number(t.commission) || 0);
            grossPnl += Number(t.grossPnl) || 0;
            netPnl += Number(t.netPnl) || 0;

            if (t.mfe !== null && t.mfe !== undefined && Number.isFinite(Number(t.mfe))) {
                mfeValues.push(Math.abs(Number(t.mfe)));
            }
            if (t.mae !== null && t.mae !== undefined && Number.isFinite(Number(t.mae))) {
                maeValues.push(Math.abs(Number(t.mae)));
            }
        }

        for (const t of closedList) {
            const pnl = Number(t.netPnl) || 0;
            if (pnl > 0.001) {
                wins += 1;
                grossProfit += pnl;
            } else if (pnl < -0.001) {
                losses += 1;
                grossLossAbs += Math.abs(pnl);
            } else {
                breakevens += 1;
            }
        }

        const winRate =
            closedTrades > 0 ? Number(((wins / closedTrades) * 100).toFixed(1)) : null;

        let profitFactor: number | null = null;
        if (closedTrades > 0) {
            if (grossLossAbs > 0) {
                profitFactor = Number((grossProfit / grossLossAbs).toFixed(2));
            } else if (grossProfit > 0) {
                profitFactor = 99.99;
            } else {
                profitFactor = 0;
            }
        }

        const avgMfe =
            mfeValues.length > 0
                ? Number((mfeValues.reduce((s, v) => s + v, 0) / mfeValues.length).toFixed(2))
                : null;
        const maxMfe =
            mfeValues.length > 0 ? Number(Math.max(...mfeValues).toFixed(2)) : null;

        const avgMae =
            maeValues.length > 0
                ? Number((maeValues.reduce((s, v) => s + v, 0) / maeValues.length).toFixed(2))
                : null;
        const maxMae =
            maeValues.length > 0 ? Number(Math.max(...maeValues).toFixed(2)) : null;

        return {
            totalTrades,
            closedTrades,
            wins,
            losses,
            breakevens,
            totalCommissions: Number(totalCommissions.toFixed(2)),
            grossPnl: Number(grossPnl.toFixed(2)),
            netPnl: Number(netPnl.toFixed(2)),
            winRate,
            profitFactor,
            avgMfe,
            maxMfe,
            avgMae,
            maxMae,
        };
    }

    private isServerStrictlyNewer(
        serverUpdatedAt?: Date | string | null,
        clientIso?: string
    ): boolean {
        if (!serverUpdatedAt || !clientIso || typeof clientIso !== 'string') {
            return false;
        }
        const serverMs = new Date(serverUpdatedAt).getTime();
        const clientMs = new Date(clientIso).getTime();
        if (!Number.isFinite(serverMs) || !Number.isFinite(clientMs)) {
            return false;
        }
        return serverMs > clientMs + 1000;
    }

    async upsertDailyNote(
        userId: string,
        date: string,
        body: {
            title?: string | null;
            content?: string;
            mood?: string | null;
            marketBias?: string | null;
            psychCheck?: {
                sleep?: string | null;
                energy?: string | null;
                focus?: string | null;
                caffeine?: string | null;
                moodState?: string | null;
                stress?: string | null;
            };
            images?: string[];
        },
        accountId?: string,
        clientUpdatedAt?: string
    ) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new BadRequestException('Formato de data inválido. Use YYYY-MM-DD.');
        }

        const { accounts, accountKey } = await this.resolveUserAccounts(userId, accountId);

        let note = await this.dailyNoteRepo.findOne({
            where: { userId, accountKey, date },
        });

        if (note && this.isServerStrictlyNewer(note.updatedAt, clientUpdatedAt)) {
            return note;
        }

        const images = Array.isArray(body.images)
            ? body.images.filter((u) => typeof u === 'string').slice(0, 20)
            : note?.images || [];

        const cleanPsych =
            body.psychCheck && typeof body.psychCheck === 'object'
                ? {
                      sleep: body.psychCheck.sleep || null,
                      energy: body.psychCheck.energy || null,
                      focus: body.psychCheck.focus || null,
                      caffeine: body.psychCheck.caffeine || null,
                      moodState: body.psychCheck.moodState || null,
                      stress: body.psychCheck.stress || null,
                  }
                : undefined;

        const derivedMood =
            cleanPsych?.moodState !== undefined
                ? cleanPsych.moodState
                : body.mood;

        if (note) {
            if (body.title !== undefined) note.title = body.title;
            if (body.content !== undefined) note.content = body.content;
            if (derivedMood !== undefined) note.mood = derivedMood;
            if (body.marketBias !== undefined) note.marketBias = body.marketBias;
            if (cleanPsych !== undefined) note.psychCheck = cleanPsych;
            if (body.images !== undefined) note.images = images;
        } else {
            note = this.dailyNoteRepo.create({
                userId,
                accountKey: this.normalizeAccountKey(accountKey),
                date,
                title: body.title ?? null,
                content: body.content ?? '',
                mood: derivedMood ?? null,
                marketBias: body.marketBias ?? null,
                psychCheck: cleanPsych ?? {},
                images,
            });
        }

        const saved = await this.dailyNoteRepo.save(note);

        // Sincroniza também com TechnicalJournal e MentalLog da conta alvo/primária
        // para que /trades/:id, /reports e painéis analíticos recebam os dados do dia imediatamente
        try {
            const targetAcc =
                accountKey !== 'all'
                    ? accounts.find((a) => a.id === accountKey) || accounts[0]
                    : accounts.find((a) => (a as any).isPrimary) || accounts[0];

            if (targetAcc) {
                const plainText = this.stripHtml(saved.content);

                // 1. TechnicalJournal sync
                let techJournal = await this.techJournalRepo.findOne({
                    where: { accountId: targetAcc.id, date },
                });
                if (techJournal || plainText || saved.marketBias || saved.mood || saved.title) {
                    if (!techJournal) {
                        techJournal = this.techJournalRepo.create({
                            accountId: targetAcc.id,
                            date,
                        });
                    }
                    if (saved.marketBias !== null && saved.marketBias !== undefined) {
                        techJournal.marketTrend = saved.marketBias;
                    }
                    if (saved.mood !== null && saved.mood !== undefined) {
                        techJournal.emotionalState = saved.mood;
                    }
                    if (saved.title) {
                        techJournal.strategyUsed = saved.title;
                    }
                    if (body.content !== undefined) {
                        techJournal.notes = plainText;
                    }
                    await this.techJournalRepo.save(techJournal);
                }

                // 2. MentalLog sync
                const scores = this.mapPsychToMentalScores(saved.psychCheck, saved.mood);
                const hasAnyScore = Object.values(scores).some((v) => v !== undefined);
                if (hasAnyScore || saved.mood) {
                    let mentalLog = await this.mentalLogRepo.findOne({
                        where: { accountId: targetAcc.id, date },
                        order: { createdAt: 'DESC' },
                    });

                    const sleepVal = scores.sleepQuality ?? mentalLog?.sleepQuality ?? 6;
                    const energyVal = scores.energy ?? mentalLog?.energy ?? 6;
                    const focusVal = scores.focus ?? mentalLog?.focus ?? 6;
                    const moodVal = scores.mood ?? mentalLog?.mood ?? 6;
                    const stressVal = scores.stress ?? mentalLog?.stress ?? 5;
                    const caffeineVal = scores.caffeine ?? mentalLog?.caffeine ?? 0;

                    const overall = Number(
                        (
                            (sleepVal + energyVal + focusVal + moodVal + (11 - stressVal)) /
                            5
                        ).toFixed(2)
                    );

                    if (mentalLog) {
                        mentalLog.sleepQuality = sleepVal;
                        mentalLog.energy = energyVal;
                        mentalLog.focus = focusVal;
                        mentalLog.mood = moodVal;
                        mentalLog.stress = stressVal;
                        mentalLog.caffeine = caffeineVal;
                        mentalLog.overallScore = overall;
                        if (plainText) {
                            mentalLog.notes = plainText;
                        }
                    } else {
                        mentalLog = this.mentalLogRepo.create({
                            accountId: targetAcc.id,
                            date,
                            time: new Date().toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                            }),
                            session: 'Daily Journal',
                            sleepQuality: sleepVal,
                            energy: energyVal,
                            focus: focusVal,
                            mood: moodVal,
                            stress: stressVal,
                            caffeine: caffeineVal,
                            notes: plainText || '',
                            overallScore: overall,
                        });
                    }
                    await this.mentalLogRepo.save(mentalLog);
                }
            }
        } catch (syncErr) {
            this.logger.warn(
                `DailyNote cross-table sync warning for ${date}: ${(syncErr as Error).message}`
            );
        }

        await this.bumpDashboardCache(userId);
        return saved;
    }

    async deleteDailyNote(userId: string, date: string, accountId?: string) {
        const accountKey = this.normalizeAccountKey(accountId);
        await this.dailyNoteRepo.delete({ userId, accountKey, date });
        await this.bumpDashboardCache(userId);
        return { ok: true };
    }

    async upsertTradeNote(
        userId: string,
        tradeId: string,
        body: {
            content?: string;
            screenshotUrl?: string | null;
            screenshots?: string[];
            setup?: string | null;
            mistakes?: string | null;
            lessons?: string | null;
            rating?: number;
            psychCheck?: {
                feeling?: string | null;
                followingPlan?: string | null;
                entryDriver?: string | null;
                riskComfort?: string | null;
            };
            mfe?: number | null;
            mae?: number | null;
        },
        clientUpdatedAt?: string
    ) {
        const { accountIds } = await this.resolveUserAccounts(userId);
        if (accountIds.length === 0) {
            throw new NotFoundException('Conta de trading não encontrada');
        }

        let trade: TradeEntity | null = null;
        if (this.isValidUuid(tradeId)) {
            trade = await this.tradeRepo.findOne({
                where: { id: tradeId, accountId: In(accountIds) },
            });
        }
        if (!trade) {
            trade = await this.tradeRepo.findOne({
                where: [
                    { ticket: tradeId, accountId: In(accountIds) },
                    { contractId: tradeId, accountId: In(accountIds) },
                ],
            });
        }

        let openPos: PositionEntity | null = null;
        if (!trade) {
            if (this.isValidUuid(tradeId)) {
                openPos = await this.positionRepo.findOne({
                    where: { id: tradeId, accountId: In(accountIds) },
                });
            }
            if (!openPos) {
                openPos = await this.positionRepo.findOne({
                    where: { ticket: tradeId, accountId: In(accountIds) },
                });
            }
        }

        if (!trade && !openPos) {
            throw new NotFoundException('Operação não encontrada');
        }

        const resolvedTradeId = trade ? trade.id : String(openPos!.id || tradeId);

        let note = await this.tradeNoteRepo.findOne({
            where: { userId, tradeId: resolvedTradeId },
        });

        if (note && this.isServerStrictlyNewer(note.updatedAt, clientUpdatedAt)) {
            return {
                ...note,
                mfe: trade?.mfe ?? null,
                mae: trade?.mae ?? null,
            };
        }

        const cleanTradePsych =
            body.psychCheck && typeof body.psychCheck === 'object'
                ? {
                      feeling: body.psychCheck.feeling || null,
                      followingPlan: body.psychCheck.followingPlan || null,
                      entryDriver: body.psychCheck.entryDriver || null,
                      riskComfort: body.psychCheck.riskComfort || null,
                  }
                : undefined;

        const plainContent =
            body.content !== undefined ? this.stripHtml(body.content) : undefined;

        // Sincroniza MFE, MAE, setup, rating, mood e lesson diretamente no TradeEntity
        if (trade) {
            let tradeTouched = false;
            if (body.mfe !== undefined) {
                trade.mfe =
                    body.mfe === null || body.mfe === ('' as any) ? null : Number(body.mfe);
                tradeTouched = true;
            }
            if (body.mae !== undefined) {
                trade.mae =
                    body.mae === null || body.mae === ('' as any) ? null : Number(body.mae);
                tradeTouched = true;
            }
            if (body.setup !== undefined) {
                trade.setup = body.setup || null;
                tradeTouched = true;
            }
            if (body.lessons !== undefined) {
                trade.lesson = body.lessons;
                tradeTouched = true;
            } else if (plainContent !== undefined) {
                trade.lesson = plainContent || null;
                tradeTouched = true;
            }
            if (cleanTradePsych?.feeling !== undefined) {
                trade.mood = cleanTradePsych.feeling || trade.mood || null;
                tradeTouched = true;
            }
            if (body.rating !== undefined) {
                trade.rating = Number(body.rating) || 0;
                tradeTouched = true;
            }
            if (tradeTouched) {
                await this.tradeRepo.save(trade);

                if (typeof (this.clickHouseService as any)?.updateTradeMetadata === 'function') {
                    (this.clickHouseService as any)
                        .updateTradeMetadata(trade.id, {
                            session: trade.session,
                            mood: trade.mood,
                            rating: trade.rating,
                            setup: trade.setup,
                            lesson: trade.lesson,
                            tags: trade.tags,
                        })
                        .catch((err: Error) =>
                            this.logger.debug(
                                `ClickHouse sync warning for trade ${trade.id}: ${err.message}`
                            )
                        );
                }
            }
        }

        const screenshots = Array.isArray(body.screenshots)
            ? body.screenshots.filter((u) => typeof u === 'string').slice(0, 20)
            : note?.screenshots || [];
        const rawPrimary =
            body.screenshotUrl !== undefined
                ? body.screenshotUrl
                : screenshots[0] || note?.screenshotUrl || null;
        const primaryUrl = this.cleanImageUrl(rawPrimary);

        if (note) {
            if (body.content !== undefined) note.content = body.content;
            note.screenshotUrl = primaryUrl;
            if (body.screenshots !== undefined) note.screenshots = screenshots;
            if (body.setup !== undefined) note.setup = body.setup;
            if (body.mistakes !== undefined) note.mistakes = body.mistakes;
            if (body.lessons !== undefined) {
                note.lessons = body.lessons;
            } else if (plainContent !== undefined) {
                note.lessons = plainContent || null;
            }
            if (body.rating !== undefined) note.rating = Number(body.rating) || 0;
            if (cleanTradePsych !== undefined) note.psychCheck = cleanTradePsych;
        } else {
            note = this.tradeNoteRepo.create({
                userId,
                tradeId: resolvedTradeId,
                content: body.content ?? '',
                screenshotUrl: primaryUrl,
                screenshots,
                setup: body.setup ?? trade?.setup ?? null,
                mistakes: body.mistakes ?? null,
                lessons:
                    body.lessons ??
                    (plainContent !== undefined ? plainContent || null : trade?.lesson ?? null),
                rating:
                    body.rating !== undefined
                        ? Number(body.rating) || 0
                        : trade?.rating || 0,
                psychCheck: cleanTradePsych ?? {},
            });
        }

        const saved = await this.tradeNoteRepo.save(note);
        await this.bumpDashboardCache(userId);
        return {
            ...saved,
            mfe: trade?.mfe ?? null,
            mae: trade?.mae ?? null,
        };
    }

    async deleteTradeNote(userId: string, tradeId: string) {
        await this.tradeNoteRepo.delete({ userId, tradeId });
        await this.bumpDashboardCache(userId);
        return { ok: true };
    }

    async createGeneralNote(
        userId: string,
        body: {
            title?: string;
            category?: string;
            content?: string;
            images?: string[];
            pinned?: boolean;
            isTemplate?: boolean;
        }
    ) {
        const title = String(body.title || '').trim() || (body.isTemplate ? 'Novo Modelo' : 'Nova Nota Geral');
        const images = Array.isArray(body.images)
            ? body.images.filter((u) => typeof u === 'string').slice(0, 20)
            : [];

        const created = this.generalNoteRepo.create({
            userId,
            title,
            category: body.category || 'GENERAL',
            content: body.content || '',
            images,
            pinned: Boolean(body.pinned),
            isTemplate: Boolean(body.isTemplate),
        });
        const saved = await this.generalNoteRepo.save(created);
        this.eventEmitter?.emit('ai.rag.invalidate_user', { userId });
        return saved;
    }

    async updateGeneralNote(
        userId: string,
        id: string,
        body: {
            title?: string;
            category?: string;
            content?: string;
            images?: string[];
            pinned?: boolean;
        },
        clientUpdatedAt?: string
    ) {
        const note = await this.generalNoteRepo.findOne({ where: { id, userId } });
        if (!note) {
            throw new NotFoundException('Nota geral não encontrada');
        }

        if (this.isServerStrictlyNewer(note.updatedAt, clientUpdatedAt)) {
            return note;
        }

        if (body.title !== undefined) note.title = String(body.title).trim() || note.title;
        if (body.category !== undefined) note.category = body.category;
        if (body.content !== undefined) note.content = body.content;
        if (body.pinned !== undefined) note.pinned = Boolean(body.pinned);
        if (body.images !== undefined && Array.isArray(body.images)) {
            note.images = body.images.filter((u) => typeof u === 'string').slice(0, 20);
        }

        const saved = await this.generalNoteRepo.save(note);
        this.eventEmitter?.emit('ai.rag.invalidate_user', { userId });
        return saved;
    }

    async deleteGeneralNote(userId: string, id: string) {
        await this.generalNoteRepo.delete({ id, userId });
        this.eventEmitter?.emit('ai.rag.invalidate_user', { userId });
        return { ok: true };
    }

    async uploadJournalScreenshot(userId: string, file: any, body: any) {
        const safeUser = this.sanitizePathToken(userId, 'user');
        const shotId = this.sanitizePathToken(
            body?.id,
            `jshot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        );

        let buffer: Buffer | null = null;
        let ext = 'png';

        if (file?.buffer && Buffer.isBuffer(file.buffer) && file.buffer.length > 0) {
            if (file.buffer.length > 12 * 1024 * 1024) {
                throw new BadRequestException('A imagem excede o limite de 12MB');
            }
            const mime = String(file.mimetype || '').toLowerCase();
            if (mime && !['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mime)) {
                throw new BadRequestException('Formato de imagem não suportado');
            }
            ext = mime === 'image/webp' ? 'webp' : mime.includes('jp') ? 'jpg' : 'png';
            buffer = file.buffer;
        } else if (typeof body?.dataUrl === 'string' && body.dataUrl.startsWith('data:image/')) {
            const match = body.dataUrl.match(
                /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i
            );
            if (!match) {
                throw new BadRequestException('Imagem Base64 inválida');
            }
            const kind = match[1].toLowerCase();
            ext = kind === 'webp' ? 'webp' : kind === 'png' ? 'png' : 'jpg';
            buffer = Buffer.from(match[2], 'base64');
            if (buffer.length > 12 * 1024 * 1024) {
                throw new BadRequestException('A imagem excede o limite de 12MB');
            }
        }

        if (!buffer || buffer.length === 0) {
            throw new BadRequestException('Nenhum arquivo de imagem recebido');
        }

        const userDir = path.join(process.cwd(), 'uploads', 'journal-screenshots', safeUser);
        await fs.promises.mkdir(userDir, { recursive: true });
        const filename = `${shotId}.${ext}`;
        await fs.promises.writeFile(path.join(userDir, filename), buffer);

        return {
            ok: true,
            url: `/uploads/journal-screenshots/${safeUser}/${filename}`,
        };
    }
}
