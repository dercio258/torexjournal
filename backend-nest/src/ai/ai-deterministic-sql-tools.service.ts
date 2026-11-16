import { Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GeminiHandoffSpec, RouterTimeframeHint } from './ai-router.service';

export interface WindowedSqlSummary {
    timeframeHint: RouterTimeframeHint;
    sinceIso: string | null;
    totalTrades: number;
    wins: number;
    losses: number;
    breakevens: number;
    winRate: number;
    grossPnl: number;
    commissionsAndFees: number;
    netPnl: number;
    profitFactor: number | null;
    avgWin: number;
    avgLoss: number;
    payoffRatio: number | null;
    expectancy: number;
    maxWin: number;
    maxLoss: number;
    slUsagePct: number | null;
    avgWinHoldMinutes: number | null;
    avgLossHoldMinutes: number | null;
    avgMfe: number | null;
    avgMae: number | null;
}

export interface DirectionalSqlItem {
    side: 'BUY' | 'SELL';
    trades: number;
    wins: number;
    winRate: number;
    netPnl: number;
}

export interface SymbolSqlBreakdownItem {
    symbol: string;
    status: 'OPERATED_IN_WINDOW' | 'NO_TRADES_IN_WINDOW';
    trades: number;
    wins: number;
    winRate: number;
    netPnl: number;
}

export interface SessionSqlBreakdownItem {
    session: string;
    trades: number;
    wins: number;
    winRate: number;
    netPnl: number;
}

export interface WeekdaySqlBreakdownItem {
    weekdayIndex: number;
    weekdayLabel: string;
    trades: number;
    wins: number;
    winRate: number;
    netPnl: number;
}

export interface SetupSqlBreakdownItem {
    setup: string;
    trades: number;
    wins: number;
    winRate: number;
    netPnl: number;
}

export interface OvertradingDaySqlItem {
    date: string;
    trades: number;
    netPnl: number;
}

export interface BacktestingSessionSqlItem {
    name: string;
    symbol: string | null;
    strategy: string | null;
    mode: string;
    closedTradesCount: number;
    winRate: number | null;
    netPnl: number;
    profitFactor: number | null;
}

export interface BacktestingSqlSummary {
    sessionsCount: number;
    totalSimulatedTrades: number;
    totalWins: number;
    totalLosses: number;
    avgWinRate: number | null;
    totalSimulatedNetPnl: number;
    worstMaxDrawdown: number | null;
    recentSessions: BacktestingSessionSqlItem[];
}

export interface BehavioralMlSqlSummary {
    analyzedTrades: number;
    flaggedTrades: number;
    criticalOrHighTrades: number;
    avgAnomalyScore: number;
    maxAnomalyScore: number;
}

export interface DeterministicSqlToolsBundle {
    accountScope: {
        accountLabel: string;
        currency: string;
        accountCount: number;
    };
    toolsExecuted: string[];
    windowSummary: WindowedSqlSummary;
    directionalSplit: DirectionalSqlItem[];
    targetSymbolsBreakdown: SymbolSqlBreakdownItem[];
    topWinningSymbols: SymbolSqlBreakdownItem[];
    topLosingSymbols: SymbolSqlBreakdownItem[];
    sessionMatrix: SessionSqlBreakdownItem[];
    weekdayMatrix: WeekdaySqlBreakdownItem[];
    setupMatrix: SetupSqlBreakdownItem[];
    overtradingDays: OvertradingDaySqlItem[];
    backtestingIncluded: boolean;
    backtestingSummary: BacktestingSqlSummary | null;
    behavioralMlSummary?: BehavioralMlSqlSummary | null;
}

const SQL_NET_PNL_EXPR = `COALESCE(t."netPnl"::double precision, COALESCE(t.profit::double precision, 0) + COALESCE(t.commission::double precision, 0) + COALESCE(t.swap::double precision, 0) - ABS(COALESCE(t.fees::double precision, 0)))`;

const WEEKDAY_LABELS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AiDeterministicSqlToolsService {
    private readonly logger = new Logger(AiDeterministicSqlToolsService.name);

    constructor(
        @Optional()
        private readonly dataSource?: DataSource
    ) {}

    private extractRows(res: unknown): Record<string, any>[] {
        if (Array.isArray(res)) return res;
        if (res && typeof res === 'object' && Array.isArray((res as any).rows)) {
            return (res as any).rows;
        }
        return [];
    }

    private sanitizeLabel(raw: unknown, maxLen = 64): string {
        return String(raw ?? '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, ' ')
            .replace(
                /(ignore\s+(?:all\s+|previous\s+|prior\s+)*instructions?|system\s*prompt|developer\s*mode|<\/?[a-z_]+>)/gi,
                '[redacted]'
            )
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLen);
    }

    private round2(val: unknown): number {
        const n = Number(val);
        return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
    }

    private round1(val: unknown): number {
        const n = Number(val);
        return Number.isFinite(n) ? Number(n.toFixed(1)) : 0;
    }

    private finiteOrNull(val: unknown, decimals = 2): number | null {
        if (val === null || val === undefined || val === '') return null;
        const n = Number(val);
        if (!Number.isFinite(n)) return null;
        return Number(n.toFixed(decimals));
    }

    resolveWindowStartUtc(timeframeHint: RouterTimeframeHint): Date | null {
        const now = Date.now();
        if (timeframeHint === 'today') {
            const d = new Date(now);
            d.setUTCHours(0, 0, 0, 0);
            return d;
        }
        if (timeframeHint === 'recent_7d') {
            return new Date(now - 7 * 24 * 60 * 60 * 1000);
        }
        if (timeframeHint === 'recent_14d') {
            return new Date(now - 14 * 24 * 60 * 60 * 1000);
        }
        if (timeframeHint === 'recent_30d') {
            return new Date(now - 30 * 24 * 60 * 60 * 1000);
        }
        return null;
    }

    private createEmptyWindowSummary(
        timeframeHint: RouterTimeframeHint,
        sinceDate: Date | null
    ): WindowedSqlSummary {
        return {
            timeframeHint,
            sinceIso: sinceDate ? sinceDate.toISOString() : null,
            totalTrades: 0,
            wins: 0,
            losses: 0,
            breakevens: 0,
            winRate: 0,
            grossPnl: 0,
            commissionsAndFees: 0,
            netPnl: 0,
            profitFactor: null,
            avgWin: 0,
            avgLoss: 0,
            payoffRatio: null,
            expectancy: 0,
            maxWin: 0,
            maxLoss: 0,
            slUsagePct: null,
            avgWinHoldMinutes: null,
            avgLossHoldMinutes: null,
            avgMfe: null,
            avgMae: null,
        };
    }

    /**
     * Executa ferramentas SQL determinísticas de agregação em PostgreSQL sem NUNCA carregar
     * ou devolver o histórico bruto de trades (tickets, preços de abertura/fecho, ordens).
     */
    async executeAnalyticalTools(params: {
        userId: string;
        accountId?: string | null;
        handoff: GeminiHandoffSpec;
    }): Promise<DeterministicSqlToolsBundle | null> {
        const cleanUserId = String(params.userId || '').trim();
        if (!this.dataSource?.isInitialized || !cleanUserId) {
            return null;
        }

        const ds = this.dataSource;
        const timeframeHint: RouterTimeframeHint =
            params.handoff.timeframeHint || 'all_history';
        const sinceDate = this.resolveWindowStartUtc(timeframeHint);
        const includeBacktesting = Boolean(params.handoff.includeBacktesting);

        try {
            const accountRows = this.extractRows(
                await ds.query(
                    `SELECT id::text AS id, name, currency FROM accounts WHERE user_id = $1 AND is_archived = false`,
                    [cleanUserId]
                )
            );

            let selectedAccounts = accountRows;
            const requestedAccId =
                params.accountId && params.accountId !== 'all'
                    ? String(params.accountId).trim()
                    : '';
            if (requestedAccId) {
                const matched = accountRows.filter(
                    (a) => String(a.id) === requestedAccId
                );
                if (matched.length > 0) {
                    selectedAccounts = matched;
                }
            }

            const accountIds = selectedAccounts.map((a) => String(a.id));
            const currency =
                this.sanitizeLabel(selectedAccounts[0]?.currency || 'USD', 10) ||
                'USD';
            const accountLabel =
                selectedAccounts.length > 1
                    ? `Todas as Contas (${selectedAccounts.length})`
                    : this.sanitizeLabel(
                          selectedAccounts[0]?.name || 'Conta Selecionada',
                          80
                      ) || 'Conta Selecionada';

            const toolsExecuted: string[] = [];
            let windowSummary = this.createEmptyWindowSummary(
                timeframeHint,
                sinceDate
            );
            let directionalSplit: DirectionalSqlItem[] = [];
            let targetSymbolsBreakdown: SymbolSqlBreakdownItem[] = [];
            let topWinningSymbols: SymbolSqlBreakdownItem[] = [];
            let topLosingSymbols: SymbolSqlBreakdownItem[] = [];
            let sessionMatrix: SessionSqlBreakdownItem[] = [];
            let weekdayMatrix: WeekdaySqlBreakdownItem[] = [];
            let setupMatrix: SetupSqlBreakdownItem[] = [];
            let overtradingDays: OvertradingDaySqlItem[] = [];
            let behavioralMlSummary: BehavioralMlSqlSummary | null = null;

            if (accountIds.length > 0) {
                const baseParams: any[] = [accountIds];
                let windowFilterSql = '';
                if (sinceDate) {
                    baseParams.push(sinceDate.toISOString());
                    windowFilterSql = ` AND COALESCE(t.close_time, t.open_time) >= $2::timestamp`;
                }

                // Tool 1: Windowed KPIs
                const kpiRows = this.extractRows(
                    await ds.query(
                        `
                        SELECT
                            COUNT(*)::int AS total_trades,
                            COUNT(*) FILTER (WHERE (${SQL_NET_PNL_EXPR}) > 0.004)::int AS wins,
                            COUNT(*) FILTER (WHERE (${SQL_NET_PNL_EXPR}) < -0.004)::int AS losses,
                            COUNT(*) FILTER (WHERE (${SQL_NET_PNL_EXPR}) BETWEEN -0.004 AND 0.004)::int AS breakevens,
                            COALESCE(SUM(COALESCE(t.profit::double precision, 0)), 0) AS gross_pnl,
                            COALESCE(SUM(ABS(COALESCE(t.commission::double precision, 0)) + ABS(COALESCE(t.fees::double precision, 0))), 0) AS commissions_and_fees,
                            COALESCE(SUM(${SQL_NET_PNL_EXPR}), 0) AS net_pnl,
                            COALESCE(SUM(${SQL_NET_PNL_EXPR}) FILTER (WHERE (${SQL_NET_PNL_EXPR}) > 0.004), 0) AS gross_profit_wins,
                            COALESCE(SUM(ABS(${SQL_NET_PNL_EXPR})) FILTER (WHERE (${SQL_NET_PNL_EXPR}) < -0.004), 0) AS gross_loss_abs,
                            COALESCE(MAX(${SQL_NET_PNL_EXPR}) FILTER (WHERE (${SQL_NET_PNL_EXPR}) > 0.004), 0) AS max_win,
                            COALESCE(MIN(${SQL_NET_PNL_EXPR}) FILTER (WHERE (${SQL_NET_PNL_EXPR}) < -0.004), 0) AS max_loss,
                            COUNT(*) FILTER (WHERE t.sl IS NOT NULL AND t.sl::double precision > 0)::int AS trades_with_sl,
                            AVG(EXTRACT(EPOCH FROM (t.close_time - t.open_time)) / 60.0)
                                FILTER (WHERE t.open_time IS NOT NULL AND t.close_time IS NOT NULL AND t.close_time >= t.open_time AND (${SQL_NET_PNL_EXPR}) > 0.004) AS avg_win_hold_min,
                            AVG(EXTRACT(EPOCH FROM (t.close_time - t.open_time)) / 60.0)
                                FILTER (WHERE t.open_time IS NOT NULL AND t.close_time IS NOT NULL AND t.close_time >= t.open_time AND (${SQL_NET_PNL_EXPR}) < -0.004) AS avg_loss_hold_min,
                            AVG(ABS(t.mfe::double precision)) FILTER (WHERE t.mfe IS NOT NULL) AS avg_mfe,
                            AVG(ABS(t.mae::double precision)) FILTER (WHERE t.mae IS NOT NULL) AS avg_mae
                        FROM trades t
                        WHERE t.account_id::text = ANY($1::text[])
                          AND t.status = 'CLOSED'${windowFilterSql}
                        `,
                        baseParams
                    )
                );
                toolsExecuted.push('sql_window_kpis');

                const kpi = kpiRows[0] || {};
                const totalTrades = Math.max(0, Number(kpi.total_trades) || 0);
                const wins = Math.max(0, Number(kpi.wins) || 0);
                const losses = Math.max(0, Number(kpi.losses) || 0);
                const breakevens = Math.max(0, Number(kpi.breakevens) || 0);
                const grossProfitWins = Math.max(
                    0,
                    Number(kpi.gross_profit_wins) || 0
                );
                const grossLossAbs = Math.max(
                    0,
                    Number(kpi.gross_loss_abs) || 0
                );
                const netPnl = this.round2(kpi.net_pnl);
                const avgWin =
                    wins > 0 ? this.round2(grossProfitWins / wins) : 0;
                const avgLoss =
                    losses > 0 ? this.round2(grossLossAbs / losses) : 0;

                windowSummary = {
                    timeframeHint,
                    sinceIso: sinceDate ? sinceDate.toISOString() : null,
                    totalTrades,
                    wins,
                    losses,
                    breakevens,
                    winRate:
                        totalTrades > 0
                            ? this.round1((wins / totalTrades) * 100)
                            : 0,
                    grossPnl: this.round2(kpi.gross_pnl),
                    commissionsAndFees: this.round2(kpi.commissions_and_fees),
                    netPnl,
                    profitFactor:
                        grossLossAbs > 0
                            ? this.round2(grossProfitWins / grossLossAbs)
                            : null,
                    avgWin,
                    avgLoss,
                    payoffRatio:
                        avgLoss > 0 ? this.round2(avgWin / avgLoss) : null,
                    expectancy:
                        totalTrades > 0
                            ? this.round2(netPnl / totalTrades)
                            : 0,
                    maxWin: this.round2(kpi.max_win),
                    maxLoss: this.round2(kpi.max_loss),
                    slUsagePct:
                        totalTrades > 0
                            ? this.round1(
                                  ((Number(kpi.trades_with_sl) || 0) /
                                      totalTrades) *
                                      100
                              )
                            : null,
                    avgWinHoldMinutes: this.finiteOrNull(
                        kpi.avg_win_hold_min,
                        1
                    ),
                    avgLossHoldMinutes: this.finiteOrNull(
                        kpi.avg_loss_hold_min,
                        1
                    ),
                    avgMfe: this.finiteOrNull(kpi.avg_mfe, 2),
                    avgMae: this.finiteOrNull(kpi.avg_mae, 2),
                };

                const normalizedTargets = (params.handoff.targetSymbols || [])
                    .map((s) =>
                        String(s || '')
                            .toUpperCase()
                            .replace(/[^A-Z0-9_/]/g, '')
                            .trim()
                    )
                    .filter(Boolean)
                    .slice(0, 4);

                if (totalTrades > 0) {
                    const dirParams = [...baseParams];
                    let dirSymbolSql = '';
                    if (
                        params.handoff.subIntent === 'SYMBOL_FOCUS' &&
                        normalizedTargets.length > 0
                    ) {
                        dirParams.push(normalizedTargets);
                        dirSymbolSql = ` AND UPPER(t.symbol) = ANY($${dirParams.length}::text[])`;
                    }

                    const [
                        dirRows,
                        symbolRows,
                        setupRows,
                        sessionRows,
                        weekdayRows,
                        overtradingRows,
                    ] = await Promise.all([
                        ds.query(
                            `
                            SELECT
                                CASE
                                    WHEN UPPER(COALESCE(t.type, '')) LIKE '%SELL%' OR UPPER(COALESCE(t.type, '')) LIKE '%PUT%'
                                    THEN 'SELL'
                                    ELSE 'BUY'
                                END AS side,
                                COUNT(*)::int AS trades,
                                COUNT(*) FILTER (WHERE (${SQL_NET_PNL_EXPR}) > 0.004)::int AS wins,
                                COALESCE(SUM(${SQL_NET_PNL_EXPR}), 0) AS net_pnl
                            FROM trades t
                            WHERE t.account_id::text = ANY($1::text[])
                              AND t.status = 'CLOSED'${windowFilterSql}${dirSymbolSql}
                            GROUP BY 1
                            ORDER BY trades DESC
                            `,
                            dirParams
                        ),
                        ds.query(
                            `
                            SELECT
                                COALESCE(NULLIF(TRIM(t.symbol), ''), 'OUTRO') AS symbol,
                                COUNT(*)::int AS trades,
                                COUNT(*) FILTER (WHERE (${SQL_NET_PNL_EXPR}) > 0.004)::int AS wins,
                                COALESCE(SUM(${SQL_NET_PNL_EXPR}), 0) AS net_pnl
                            FROM trades t
                            WHERE t.account_id::text = ANY($1::text[])
                              AND t.status = 'CLOSED'${windowFilterSql}
                            GROUP BY 1
                            ORDER BY net_pnl DESC
                            `,
                            baseParams
                        ),
                        ds.query(
                            `
                            SELECT
                                TRIM(t.setup) AS setup,
                                COUNT(*)::int AS trades,
                                COUNT(*) FILTER (WHERE (${SQL_NET_PNL_EXPR}) > 0.004)::int AS wins,
                                COALESCE(SUM(${SQL_NET_PNL_EXPR}), 0) AS net_pnl
                            FROM trades t
                            WHERE t.account_id::text = ANY($1::text[])
                              AND t.status = 'CLOSED'
                              AND t.setup IS NOT NULL
                              AND TRIM(t.setup) <> ''${windowFilterSql}
                            GROUP BY 1
                            ORDER BY trades DESC, net_pnl DESC
                            LIMIT 5
                            `,
                            baseParams
                        ),
                        ds.query(
                            `
                            SELECT
                                CASE
                                    WHEN EXTRACT(HOUR FROM COALESCE(t.open_time, t.close_time)) >= 7
                                     AND EXTRACT(HOUR FROM COALESCE(t.open_time, t.close_time)) < 12 THEN 'Londres'
                                    WHEN EXTRACT(HOUR FROM COALESCE(t.open_time, t.close_time)) >= 12
                                     AND EXTRACT(HOUR FROM COALESCE(t.open_time, t.close_time)) < 16 THEN 'Londres + NY'
                                    WHEN EXTRACT(HOUR FROM COALESCE(t.open_time, t.close_time)) >= 16
                                     AND EXTRACT(HOUR FROM COALESCE(t.open_time, t.close_time)) < 21 THEN 'Nova Iorque'
                                    ELSE 'Ásia'
                                END AS session,
                                COUNT(*)::int AS trades,
                                COUNT(*) FILTER (WHERE (${SQL_NET_PNL_EXPR}) > 0.004)::int AS wins,
                                COALESCE(SUM(${SQL_NET_PNL_EXPR}), 0) AS net_pnl
                            FROM trades t
                            WHERE t.account_id::text = ANY($1::text[])
                              AND t.status = 'CLOSED'
                              AND COALESCE(t.open_time, t.close_time) IS NOT NULL${windowFilterSql}
                            GROUP BY 1
                            ORDER BY net_pnl DESC
                            `,
                            baseParams
                        ),
                        ds.query(
                            `
                            SELECT
                                EXTRACT(DOW FROM COALESCE(t.close_time, t.open_time))::int AS dow,
                                COUNT(*)::int AS trades,
                                COUNT(*) FILTER (WHERE (${SQL_NET_PNL_EXPR}) > 0.004)::int AS wins,
                                COALESCE(SUM(${SQL_NET_PNL_EXPR}), 0) AS net_pnl
                            FROM trades t
                            WHERE t.account_id::text = ANY($1::text[])
                              AND t.status = 'CLOSED'
                              AND COALESCE(t.close_time, t.open_time) IS NOT NULL${windowFilterSql}
                            GROUP BY 1
                            ORDER BY 1 ASC
                            `,
                            baseParams
                        ),
                        ds.query(
                            `
                            SELECT
                                TO_CHAR(COALESCE(t.close_time, t.open_time), 'YYYY-MM-DD') AS day_key,
                                COUNT(*)::int AS trades,
                                COALESCE(SUM(${SQL_NET_PNL_EXPR}), 0) AS daily_net_pnl
                            FROM trades t
                            WHERE t.account_id::text = ANY($1::text[])
                              AND t.status = 'CLOSED'
                              AND COALESCE(t.close_time, t.open_time) IS NOT NULL${windowFilterSql}
                            GROUP BY 1
                            HAVING COUNT(*) >= 6 AND COALESCE(SUM(${SQL_NET_PNL_EXPR}), 0) < 0
                            ORDER BY daily_net_pnl ASC
                            LIMIT 5
                            `,
                            baseParams
                        ),
                    ]);

                    toolsExecuted.push(
                        'sql_directional_split',
                        'sql_symbol_and_setup_matrix',
                        'sql_session_and_weekday_matrix'
                    );

                    directionalSplit = this.extractRows(dirRows).map((r) => {
                        const tr = Math.max(0, Number(r.trades) || 0);
                        const w = Math.max(0, Number(r.wins) || 0);
                        return {
                            side: String(r.side) === 'SELL' ? 'SELL' : 'BUY',
                            trades: tr,
                            wins: w,
                            winRate: tr > 0 ? this.round1((w / tr) * 100) : 0,
                            netPnl: this.round2(r.net_pnl),
                        };
                    });

                    const parsedSymbols: SymbolSqlBreakdownItem[] =
                        this.extractRows(symbolRows).map((r) => {
                            const tr = Math.max(0, Number(r.trades) || 0);
                            const w = Math.max(0, Number(r.wins) || 0);
                            return {
                                symbol:
                                    this.sanitizeLabel(r.symbol, 24) || 'OUTRO',
                                status: 'OPERATED_IN_WINDOW',
                                trades: tr,
                                wins: w,
                                winRate:
                                    tr > 0 ? this.round1((w / tr) * 100) : 0,
                                netPnl: this.round2(r.net_pnl),
                            };
                        });

                    topWinningSymbols = parsedSymbols
                        .filter((s) => s.netPnl > 0)
                        .slice(0, 4);
                    topLosingSymbols = [...parsedSymbols]
                        .filter((s) => s.netPnl < 0)
                        .sort((a, b) => a.netPnl - b.netPnl)
                        .slice(0, 4);

                    targetSymbolsBreakdown = normalizedTargets.map((target) => {
                        const cleanTarget = target.replace(/[^A-Z0-9]/g, '');
                        const matches = parsedSymbols.filter((item) => {
                            const cleanSym = item.symbol
                                .toUpperCase()
                                .replace(/[^A-Z0-9]/g, '');
                            return (
                                cleanSym === cleanTarget ||
                                (cleanTarget.length >= 3 &&
                                    cleanSym.includes(cleanTarget))
                            );
                        });
                        if (matches.length === 0) {
                            return {
                                symbol: target,
                                status: 'NO_TRADES_IN_WINDOW',
                                trades: 0,
                                wins: 0,
                                winRate: 0,
                                netPnl: 0,
                            };
                        }
                        const aggTrades = matches.reduce(
                            (acc, m) => acc + m.trades,
                            0
                        );
                        const aggWins = matches.reduce(
                            (acc, m) => acc + m.wins,
                            0
                        );
                        const aggNet = matches.reduce(
                            (acc, m) => acc + m.netPnl,
                            0
                        );
                        return {
                            symbol: matches[0].symbol,
                            status: 'OPERATED_IN_WINDOW',
                            trades: aggTrades,
                            wins: aggWins,
                            winRate:
                                aggTrades > 0
                                    ? this.round1((aggWins / aggTrades) * 100)
                                    : 0,
                            netPnl: this.round2(aggNet),
                        };
                    });

                    setupMatrix = this.extractRows(setupRows)
                        .map((r) => {
                            const tr = Math.max(0, Number(r.trades) || 0);
                            const w = Math.max(0, Number(r.wins) || 0);
                            return {
                                setup: this.sanitizeLabel(r.setup, 48),
                                trades: tr,
                                wins: w,
                                winRate:
                                    tr > 0 ? this.round1((w / tr) * 100) : 0,
                                netPnl: this.round2(r.net_pnl),
                            };
                        })
                        .filter((r) => Boolean(r.setup));

                    sessionMatrix = this.extractRows(sessionRows).map((r) => {
                        const tr = Math.max(0, Number(r.trades) || 0);
                        const w = Math.max(0, Number(r.wins) || 0);
                        return {
                            session: this.sanitizeLabel(r.session, 24),
                            trades: tr,
                            wins: w,
                            winRate: tr > 0 ? this.round1((w / tr) * 100) : 0,
                            netPnl: this.round2(r.net_pnl),
                        };
                    });

                    weekdayMatrix = this.extractRows(weekdayRows).map((r) => {
                        const dow = Math.max(
                            0,
                            Math.min(6, Number(r.dow) || 0)
                        );
                        const tr = Math.max(0, Number(r.trades) || 0);
                        const w = Math.max(0, Number(r.wins) || 0);
                        return {
                            weekdayIndex: dow,
                            weekdayLabel: WEEKDAY_LABELS_PT[dow] || String(dow),
                            trades: tr,
                            wins: w,
                            winRate: tr > 0 ? this.round1((w / tr) * 100) : 0,
                            netPnl: this.round2(r.net_pnl),
                        };
                    });

                    overtradingDays = this.extractRows(overtradingRows).map(
                        (r) => ({
                            date: String(r.day_key || '').slice(0, 10),
                            trades: Math.max(0, Number(r.trades) || 0),
                            netPnl: this.round2(r.daily_net_pnl),
                        })
                    );

                    try {
                        const mlRows = this.extractRows(
                            await ds.query(
                                `
                                SELECT
                                    COUNT(*) FILTER (WHERE t."qualityFlags" IS NOT NULL AND (t."qualityFlags" ? 'behavioralMl'))::int AS ml_analyzed_trades,
                                    COUNT(*) FILTER (WHERE jsonb_typeof(t."qualityFlags"->'behavioralMl'->'activeFlags') = 'array' AND jsonb_array_length(t."qualityFlags"->'behavioralMl'->'activeFlags') > 0)::int AS ml_flagged_trades,
                                    COUNT(*) FILTER (WHERE (t."qualityFlags"->'behavioralMl'->>'riskLevel') IN ('HIGH', 'CRITICAL'))::int AS ml_high_risk_trades,
                                    COALESCE(AVG((t."qualityFlags"->'behavioralMl'->>'anomalyScore')::double precision), 0) AS ml_avg_anomaly,
                                    COALESCE(MAX((t."qualityFlags"->'behavioralMl'->>'anomalyScore')::double precision), 0) AS ml_max_anomaly
                                FROM trades t
                                WHERE t.account_id::text = ANY($1::text[])
                                  AND t.status = 'CLOSED'${windowFilterSql}
                                `,
                                baseParams
                            )
                        );
                        const mlRow = mlRows[0];
                        const analyzedCount = Math.max(0, Number(mlRow?.ml_analyzed_trades) || 0);
                        if (analyzedCount > 0) {
                            behavioralMlSummary = {
                                analyzedTrades: analyzedCount,
                                flaggedTrades: Math.max(0, Number(mlRow?.ml_flagged_trades) || 0),
                                criticalOrHighTrades: Math.max(0, Number(mlRow?.ml_high_risk_trades) || 0),
                                avgAnomalyScore: this.round1(mlRow?.ml_avg_anomaly),
                                maxAnomalyScore: this.round1(mlRow?.ml_max_anomaly),
                            };
                            toolsExecuted.push('sql_behavioral_ml_summary');
                        }
                    } catch {
                        behavioralMlSummary = null;
                    }
                } else if (normalizedTargets.length > 0) {
                    targetSymbolsBreakdown = normalizedTargets.map((sym) => ({
                        symbol: sym,
                        status: 'NO_TRADES_IN_WINDOW',
                        trades: 0,
                        wins: 0,
                        winRate: 0,
                        netPnl: 0,
                    }));
                }
            }

            // =========================================================================
            // STRICT BACKTESTING ISOLATION GATE (Decision #7):
            // NEVER queries backtest_sessions unless handoff.includeBacktesting === true
            // =========================================================================
            let backtestingSummary: BacktestingSqlSummary | null = null;
            if (includeBacktesting) {
                const btParams: any[] = [cleanUserId];
                let btAccountClause = '';
                if (requestedAccId && UUID_REGEX.test(requestedAccId)) {
                    btParams.push(requestedAccId);
                    btAccountClause = ` AND (account_id IS NULL OR account_id = $2)`;
                }

                const btRows = this.extractRows(
                    await ds.query(
                        `
                        SELECT
                            name,
                            symbol,
                            strategy,
                            mode,
                            results
                        FROM backtest_sessions
                        WHERE user_id = $1
                          AND mode <> 'STRATEGY_DEFINITION'${btAccountClause}
                        ORDER BY updated_at DESC
                        LIMIT 100
                        `,
                        btParams
                    )
                );
                toolsExecuted.push('sql_backtesting_summary');

                let totalSimulatedTrades = 0;
                let totalWins = 0;
                let totalLosses = 0;
                let totalSimulatedNetPnl = 0;
                let worstMaxDrawdown: number | null = null;
                const winRates: number[] = [];

                const recentSessions: BacktestingSessionSqlItem[] = [];
                for (let i = 0; i < btRows.length; i += 1) {
                    const row = btRows[i];
                    const resObj =
                        row.results && typeof row.results === 'object'
                            ? row.results
                            : {};
                    const closedCount = Math.max(
                        0,
                        Math.trunc(
                            Number(
                                resObj.closedTradesCount ??
                                    resObj.simulatedTrades ??
                                    0
                            ) || 0
                        )
                    );
                    const winsCount = Math.max(
                        0,
                        Math.trunc(Number(resObj.winsCount ?? 0) || 0)
                    );
                    const lossesCount = Math.max(
                        0,
                        Math.trunc(Number(resObj.lossesCount ?? 0) || 0)
                    );
                    const sessNetPnl = this.round2(
                        resObj.netPnl ?? resObj.simulatedNetProfit ?? 0
                    );
                    const sessWinRate = this.finiteOrNull(
                        resObj.winRate ?? resObj.simulatedWinRate,
                        1
                    );
                    const sessPf = this.finiteOrNull(
                        resObj.profitFactor ?? resObj.simulatedProfitFactor,
                        2
                    );
                    const sessMaxDd = this.finiteOrNull(resObj.maxDrawdown, 2);

                    totalSimulatedTrades += closedCount;
                    totalWins += winsCount;
                    totalLosses += lossesCount;
                    totalSimulatedNetPnl += sessNetPnl;

                    if (sessWinRate !== null && closedCount > 0) {
                        winRates.push(sessWinRate);
                    }
                    if (
                        sessMaxDd !== null &&
                        (worstMaxDrawdown === null ||
                            Math.abs(sessMaxDd) > Math.abs(worstMaxDrawdown))
                    ) {
                        worstMaxDrawdown = Math.abs(sessMaxDd);
                    }

                    if (recentSessions.length < 5) {
                        recentSessions.push({
                            name:
                                this.sanitizeLabel(row.name, 72) ||
                                'Sessão Backtest',
                            symbol: row.symbol
                                ? this.sanitizeLabel(row.symbol, 24)
                                : null,
                            strategy: row.strategy
                                ? this.sanitizeLabel(row.strategy, 64)
                                : null,
                            mode:
                                this.sanitizeLabel(row.mode, 32) ||
                                'REPLAY_SESSION',
                            closedTradesCount: closedCount,
                            winRate: sessWinRate,
                            netPnl: sessNetPnl,
                            profitFactor: sessPf,
                        });
                    }
                }

                const avgWinRate =
                    totalSimulatedTrades > 0 && totalWins + totalLosses > 0
                        ? this.round1(
                              (totalWins / (totalWins + totalLosses)) * 100
                          )
                        : winRates.length > 0
                        ? this.round1(
                              winRates.reduce((acc, v) => acc + v, 0) /
                                  winRates.length
                          )
                        : null;

                backtestingSummary = {
                    sessionsCount: btRows.length,
                    totalSimulatedTrades,
                    totalWins,
                    totalLosses,
                    avgWinRate,
                    totalSimulatedNetPnl: this.round2(totalSimulatedNetPnl),
                    worstMaxDrawdown,
                    recentSessions,
                };
            }

            return {
                accountScope: {
                    accountLabel,
                    currency,
                    accountCount: selectedAccounts.length,
                },
                toolsExecuted,
                windowSummary,
                directionalSplit,
                targetSymbolsBreakdown,
                topWinningSymbols,
                topLosingSymbols,
                sessionMatrix,
                weekdayMatrix,
                setupMatrix,
                overtradingDays,
                backtestingIncluded: includeBacktesting,
                backtestingSummary,
                ...(behavioralMlSummary ? { behavioralMlSummary } : {}),
            };
        } catch (err: any) {
            this.logger.warn(
                `Deterministic SQL tools execution fallback (${err?.message || err})`
            );
            return null;
        }
    }
}
