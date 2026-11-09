import { BarChart2, CalendarDays, Clock } from 'lucide-react';
import { ChartCard } from '../charts/ChartCard';
import { BreakdownBars, BreakdownRow } from '../charts/BreakdownBars';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun

type RawSymbol = { symbol: string; count?: number; trades?: number; wins?: number; losses?: number; pnl?: number; winRate?: number };
type RawSession = { session: string; count?: number; trades?: number; wins?: number; pnl?: number; winRate?: number };
type RawWeekday = { weekday?: number; day?: string; count?: number; trades?: number; wins?: number; pnl?: number; winRate?: number };

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rate = (wins: number | undefined, count: number, given?: number) =>
    given !== undefined ? Math.round(num(given)) : wins !== undefined && count > 0 ? Math.round((num(wins) / count) * 100) : undefined;

/** Normalizes the dashboard (`count`) and reports (`trades`) payload shapes. */
export const toSymbolRows = (raw: RawSymbol[] = []): BreakdownRow[] =>
    raw.map((s) => {
        const count = num(s.count ?? s.trades);
        return { key: s.symbol, label: s.symbol.replace(/\s*Index$/i, ''), pnl: num(s.pnl), count, winRate: rate(s.wins, count, s.winRate) };
    });

/**
 * The importers tag each trade by its OPEN hour (UTC) with every market open at
 * that moment, joined by " / " — e.g. "London / New York" (13–17h UTC) or
 * "Sydney / Tokyo" (00–07h UTC). Every hour of the day is covered.
 *
 * Each tag maps to EXACTLY ONE exclusive window, so a trade is never counted
 * twice and the rows add up to the period total.
 */
type SessionBucket = 'asia' | 'london' | 'overlap' | 'ny' | 'other';

export const SESSION_BUCKETS: { key: SessionBucket; label: string; hours: string }[] = [
    { key: 'asia', label: 'Ásia (Sydney/Tóquio)', hours: '22h–08h UTC' },
    { key: 'london', label: 'Londres', hours: '08h–13h UTC' },
    { key: 'overlap', label: 'Londres + Nova Iorque', hours: '13h–17h UTC' },
    { key: 'ny', label: 'Nova Iorque', hours: '17h–22h UTC' },
    { key: 'other', label: 'Sem sessão', hours: 'manual / desconhecida' },
];

export const sessionBucketOf = (tag: string | null | undefined): SessionBucket => {
    const t = (tag || '').toLowerCase();
    const london = /london|londres/.test(t);
    const ny = /new york|nova iorque|\bny\b/.test(t);
    if (london && ny) return 'overlap';
    if (london) return 'london'; // includes "Tokyo / London" (08h): London open
    if (ny) return 'ny';
    if (/sydney|tokyo|t[oó]quio|asia|ásia|asian/.test(t)) return 'asia';
    return 'other';
};

export const toSessionRows = (raw: RawSession[] = []): BreakdownRow[] => {
    const acc = new Map<SessionBucket, { count: number; pnl: number; wins?: number }>();
    raw.forEach((r) => {
        const b = sessionBucketOf(r.session);
        const cur = acc.get(b) || { count: 0, pnl: 0 };
        cur.count += num(r.count ?? r.trades);
        cur.pnl += num(r.pnl);
        if (r.wins !== undefined) cur.wins = (cur.wins ?? 0) + num(r.wins);
        acc.set(b, cur);
    });
    return SESSION_BUCKETS.filter((b) => b.key !== 'other' || (acc.get('other')?.count ?? 0) > 0).map((b) => {
        const d = acc.get(b.key) || { count: 0, pnl: 0 };
        return {
            key: b.key,
            label: `${b.label} · ${b.hours}`,
            pnl: Math.round(d.pnl * 100) / 100,
            count: d.count,
            winRate: rate(d.wins, d.count),
        };
    });
};

const DAY_INDEX: Record<string, number> = { domingo: 0, segunda: 1, terça: 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, sábado: 6, sabado: 6 };

export const toWeekdayRows = (raw: RawWeekday[] = []): BreakdownRow[] => {
    const byIdx = new Map<number, RawWeekday>();
    raw.forEach((r) => {
        const idx = r.weekday ?? DAY_INDEX[(r.day || '').toLowerCase().replace('-feira', '')];
        if (idx !== undefined) byIdx.set(idx, r);
    });
    return WEEK_ORDER.filter((i) => (i >= 1 && i <= 5) || num(byIdx.get(i)?.count ?? byIdx.get(i)?.trades) > 0).map((i) => {
        const r = byIdx.get(i);
        const count = num(r?.count ?? r?.trades);
        return { key: String(i), label: WEEKDAYS[i], pnl: num(r?.pnl), count, winRate: r ? rate(r.wins, count, r.winRate) : undefined };
    });
};

interface OperationalBreakdownProps {
    symbols: BreakdownRow[];
    sessions: BreakdownRow[];
    weekdays: BreakdownRow[];
}

/** "Detalhamento Operacional": P&L by asset, session and weekday for the selected period. */
export const OperationalBreakdown = ({ symbols, sessions, weekdays }: OperationalBreakdownProps) => (
    <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-3">
        <ChartCard title="Por ativo" icon={<BarChart2 size={14} />} subtitle={`${symbols.filter((s) => s.count > 0).length} ativos · ordenado por resultado`}>
            <BreakdownBars rows={symbols} order="value" maxRows={6} />
        </ChartCard>
        <ChartCard title="Por sessão" icon={<Clock size={14} />} subtitle="Pela hora de abertura do trade · janelas exclusivas">
            <BreakdownBars rows={sessions} order="natural" />
        </ChartCard>
        <ChartCard title="Por dia da semana" icon={<CalendarDays size={14} />} subtitle="Dia de fechamento (UTC)">
            <BreakdownBars rows={weekdays} order="natural" />
        </ChartCard>
    </div>
);
