import { PieChart, CalendarDays, Clock } from 'lucide-react';
import { BreakdownRow } from '../charts/BreakdownBars';
import { AdaptiveOperationalChart } from './AdaptiveOperationalChart';

const WEEKDAYS_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
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

export const SESSION_BUCKETS: { key: SessionBucket; label: string; labelEn: string; hours: string; hoursEn: string }[] = [
    { key: 'asia', label: 'Ásia (Sydney/Tóquio)', labelEn: 'Asia (Sydney/Tokyo)', hours: '22h–08h UTC', hoursEn: '22:00–08:00 UTC' },
    { key: 'london', label: 'Londres', labelEn: 'London', hours: '08h–13h UTC', hoursEn: '08:00–13:00 UTC' },
    { key: 'overlap', label: 'Londres + Nova Iorque', labelEn: 'London + New York', hours: '13h–17h UTC', hoursEn: '13:00–17:00 UTC' },
    { key: 'ny', label: 'Nova Iorque', labelEn: 'New York', hours: '17h–22h UTC', hoursEn: '17:00–22:00 UTC' },
    { key: 'other', label: 'Sem sessão', labelEn: 'Off-Session', hours: 'manual / desconhecida', hoursEn: 'manual / unknown' },
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

export const toSessionRows = (raw: RawSession[] = [], locale: 'pt' | 'en' = 'pt'): BreakdownRow[] => {
    const isEn = locale === 'en';
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
        const baseLabel = isEn ? b.labelEn : b.label;
        const hrs = isEn ? b.hoursEn : b.hours;
        return {
            key: b.key,
            label: `${baseLabel} · ${hrs}`,
            pnl: Math.round(d.pnl * 100) / 100,
            count: d.count,
            winRate: rate(d.wins, d.count),
        };
    });
};

const DAY_INDEX: Record<string, number> = {
    domingo: 0,
    sunday: 0,
    segunda: 1,
    monday: 1,
    terça: 2,
    terca: 2,
    tuesday: 2,
    quarta: 3,
    wednesday: 3,
    quinta: 4,
    thursday: 4,
    sexta: 5,
    friday: 5,
    sábado: 6,
    sabado: 6,
    saturday: 6,
};

export const toWeekdayRows = (raw: RawWeekday[] = [], locale: 'pt' | 'en' = 'pt'): BreakdownRow[] => {
    const labels = locale === 'en' ? WEEKDAYS_EN : WEEKDAYS_PT;
    const byIdx = new Map<number, RawWeekday>();
    raw.forEach((r) => {
        const idx = r.weekday ?? DAY_INDEX[(r.day || '').toLowerCase().replace('-feira', '')];
        if (idx !== undefined) byIdx.set(idx, r);
    });
    return WEEK_ORDER.filter((i) => (i >= 1 && i <= 5) || num(byIdx.get(i)?.count ?? byIdx.get(i)?.trades) > 0).map((i) => {
        const r = byIdx.get(i);
        const count = num(r?.count ?? r?.trades);
        return { key: String(i), label: labels[i], pnl: num(r?.pnl), count, winRate: r ? rate(r.wins, count, r.winRate) : undefined };
    });
};

interface OperationalBreakdownProps {
    symbols: BreakdownRow[];
    sessions: BreakdownRow[];
    weekdays: BreakdownRow[];
    locale?: 'pt' | 'en';
}

/** "Detalhamento Operacional" / "Market & Session Breakdown" */
export const OperationalBreakdown = ({
    symbols,
    sessions,
    weekdays,
    locale = 'pt',
}: OperationalBreakdownProps) => {
    const isEn = locale === 'en';
    const activeSymbolsCount = symbols.filter((s) => s.count > 0).length;
    const activeSessionsCount = sessions.filter((s) => s.count > 0).length;
    const activeWeekdaysCount = weekdays.filter((d) => d.count > 0).length;

    return (
        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3">
            <AdaptiveOperationalChart
                title={isEn ? 'Instrument Performance' : 'Desempenho por Ativos'}
                icon={<PieChart size={14} />}
                subtitle={
                    isEn
                        ? `${activeSymbolsCount} ${activeSymbolsCount === 1 ? 'traded instrument' : 'traded instruments'} · distribution`
                        : `${activeSymbolsCount} ${activeSymbolsCount === 1 ? 'ativo operado' : 'ativos operados'} · distribuição`
                }
                rows={symbols}
                categoryType="symbol"
                fixedView="donut"
                locale={locale}
            />
            <AdaptiveOperationalChart
                title={isEn ? 'Market Session Edge' : 'Desempenho por Sessões'}
                icon={<Clock size={14} />}
                subtitle={
                    isEn
                        ? `${activeSessionsCount} ${activeSessionsCount === 1 ? 'active session' : 'active sessions'} · UTC open`
                        : `${activeSessionsCount} ${activeSessionsCount === 1 ? 'sessão ativa' : 'sessões ativas'} · abertura UTC`
                }
                rows={sessions}
                categoryType="session"
                fixedView="bars"
                locale={locale}
            />
            <AdaptiveOperationalChart
                title={isEn ? 'Day of Week Edge' : 'Operação por Dias'}
                icon={<CalendarDays size={14} />}
                subtitle={
                    isEn
                        ? `${activeWeekdaysCount} ${activeWeekdaysCount === 1 ? 'active day' : 'active days'} · UTC close`
                        : `${activeWeekdaysCount} ${activeWeekdaysCount === 1 ? 'dia ativo' : 'dias ativos'} · fechamento UTC`
                }
                rows={weekdays}
                categoryType="weekday"
                fixedView="polygon"
                locale={locale}
            />
        </div>
    );
};
