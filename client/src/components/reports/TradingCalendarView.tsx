import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, FileText, Settings, Info, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/cn';
import api from '../../api';
import { DashboardOperationalFilters } from '../../hooks/useDashboard';

const MONTH_NAMES_PT = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
];

const MONTH_NAMES_EN = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

const DAYS_HEADER_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAYS_HEADER_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface TradingCalendarViewProps {
    trades?: any[];
    dailyPnL?: any[];
    /** Optional account + filters so navigating to months outside the header date range still loads month data */
    accountId?: string;
    filters?: DashboardOperationalFilters;
    queryRange?: { start: string; end: string };
    locale?: 'pt' | 'en';
    className?: string;
}

const parseIsoParts = (raw: unknown): { year: number; monthIdx: number; day: number; iso: string } | null => {
    if (!raw) return null;
    const str = String(raw).trim();
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
        const year = Number(m[1]);
        const monthIdx = Number(m[2]) - 1;
        const day = Number(m[3]);
        if (monthIdx >= 0 && monthIdx <= 11 && day >= 1 && day <= 31) {
            return { year, monthIdx, day, iso: `${m[1]}-${m[2]}-${m[3]}` };
        }
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
        const y = d.getUTCFullYear();
        const mo = d.getUTCMonth();
        const da = d.getUTCDate();
        return {
            year: y,
            monthIdx: mo,
            day: da,
            iso: `${y}-${String(mo + 1).padStart(2, '0')}-${String(da).padStart(2, '0')}`,
        };
    }
    return null;
};

const formatCompactPnl = (amount: number) => {
    const isNeg = amount < -0.001;
    const abs = Math.abs(amount);
    const sign = isNeg ? '-' : '';
    if (abs === 0) return '$0';
    if (abs >= 100000) {
        return `${sign}$${(abs / 1000).toFixed(0)}K`;
    }
    if (abs >= 1000) {
        const k = abs / 1000;
        const decimals = k >= 10 ? 1 : 2;
        return `${sign}$${parseFloat(k.toFixed(decimals))}K`;
    }
    if (abs >= 100) {
        return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
    }
    return `${sign}$${parseFloat(abs.toFixed(1))}`;
};

const EMPTY_TRADES: any[] = [];
const EMPTY_DAILY: any[] = [];

export const TradingCalendarView: React.FC<TradingCalendarViewProps> = ({
    trades = EMPTY_TRADES,
    dailyPnL = EMPTY_DAILY,
    accountId,
    filters,
    queryRange,
    locale = 'pt',
    className,
}) => {
    const isEn = locale === 'en';
    const monthNames = isEn ? MONTH_NAMES_EN : MONTH_NAMES_PT;
    const daysHeader = isEn ? DAYS_HEADER_EN : DAYS_HEADER_PT;
    const [showWinRate, setShowWinRate] = useState(true);
    const [showTradeCount, setShowTradeCount] = useState(true);
    const [showWeeklySummary, setShowWeeklySummary] = useState(true);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const settingsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onClickOutside = (e: MouseEvent) => {
            if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
                setIsSettingsOpen(false);
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    const resolveInitialMonth = () => {
        if (Array.isArray(trades) && trades.length > 0) {
            for (let i = trades.length - 1; i >= 0; i--) {
                const t = trades[i];
                const parsed = parseIsoParts(t.closeTime || t.openTime || t.date);
                if (parsed) return new Date(parsed.year, parsed.monthIdx, 1);
            }
        }
        if (Array.isArray(dailyPnL) && dailyPnL.length > 0) {
            const last = dailyPnL[dailyPnL.length - 1];
            const parsed = parseIsoParts(last?.isoDate || last?.date);
            if (parsed) return new Date(parsed.year, parsed.monthIdx, 1);
        }
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    };

    const [currentDate, setCurrentDate] = useState<Date>(resolveInitialMonth);
    const [userNavigated, setUserNavigated] = useState(false);

    useEffect(() => {
        if (userNavigated) return;
        if (Array.isArray(trades) && trades.length > 0) {
            for (let i = trades.length - 1; i >= 0; i--) {
                const parsed = parseIsoParts(trades[i]?.closeTime || trades[i]?.openTime || trades[i]?.date);
                if (parsed) {
                    setCurrentDate((prev) =>
                        prev.getFullYear() === parsed.year && prev.getMonth() === parsed.monthIdx
                            ? prev
                            : new Date(parsed.year, parsed.monthIdx, 1)
                    );
                    return;
                }
            }
        }
        if (Array.isArray(dailyPnL) && dailyPnL.length > 0) {
            const last = dailyPnL[dailyPnL.length - 1];
            const parsed = parseIsoParts(last?.isoDate || last?.date);
            if (parsed) {
                setCurrentDate((prev) =>
                    prev.getFullYear() === parsed.year && prev.getMonth() === parsed.monthIdx
                        ? prev
                        : new Date(parsed.year, parsed.monthIdx, 1)
                );
            }
        }
    }, [trades, dailyPnL, userNavigated]);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const handlePrevMonth = () => {
        setUserNavigated(true);
        setCurrentDate(new Date(year, month - 1, 1));
    };

    const handleNextMonth = () => {
        setUserNavigated(true);
        setCurrentDate(new Date(year, month + 1, 1));
    };

    const handleThisMonth = () => {
        setUserNavigated(true);
        const now = new Date();
        setCurrentDate(new Date(now.getFullYear(), now.getMonth(), 1));
    };

    const monthBounds = useMemo(() => {
        const startIso = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)).toISOString();
        const endIso = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)).toISOString();
        return { startIso, endIso };
    }, [year, month]);

    const needsMonthFetch = useMemo(() => {
        if (!queryRange || !queryRange.start || !queryRange.end) return false;
        const now = new Date();
        const endOfTodayIso = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
        ).toISOString();
        // Future days cannot have closed trades; clamp month end to today so current-month presets don't double-fetch
        const effectiveMonthEndIso = monthBounds.endIso > endOfTodayIso ? endOfTodayIso : monthBounds.endIso;
        return queryRange.start > monthBounds.startIso || queryRange.end < effectiveMonthEndIso;
    }, [queryRange, monthBounds]);

    const normalizedAccountId = !accountId || accountId === 'all' || accountId === 'undefined' ? undefined : accountId;
    const symbolsParam =
        filters?.symbols && filters.symbols.length > 0
            ? [...filters.symbols].map(s => s.trim()).filter(Boolean).sort().join(',')
            : undefined;
    const sideParam = filters?.side && filters.side !== 'ALL' ? filters.side : undefined;
    const sessionsParam =
        filters?.sessions && filters.sessions.length > 0 ? [...filters.sessions].sort().join(',') : undefined;
    const outcomeParam = filters?.outcome && filters.outcome !== 'ALL' ? filters.outcome : undefined;

    const { data: fetchedMonthData } = useQuery({
        queryKey: [
            'dashboard',
            'calendar-month',
            normalizedAccountId || 'all',
            year,
            month,
            symbolsParam || 'all',
            sideParam || 'ALL',
            sessionsParam || 'all',
            outcomeParam || 'ALL',
        ],
        queryFn: async () => {
            const params: any = {
                startDate: monthBounds.startIso,
                endDate: monthBounds.endIso,
            };
            if (normalizedAccountId) params.accountId = normalizedAccountId;
            if (symbolsParam) params.symbols = symbolsParam;
            if (sideParam) params.side = sideParam;
            if (sessionsParam) params.sessions = sessionsParam;
            if (outcomeParam) params.outcome = outcomeParam;
            const { data } = await api.get('/dashboard/performance', { params });
            return data?.dailyPnL || [];
        },
        enabled: needsMonthFetch,
    });

    const tradesByDate = useMemo(() => {
        const map: Record<
            string,
            { date: string; pnl: number; count: number; wins: number; winRate: number; hasNotes: boolean }
        > = {};

        if (Array.isArray(trades) && trades.length > 0) {
            trades.forEach(t => {
                const parsed = parseIsoParts(t.closeTime || t.openTime || t.date);
                if (!parsed) return;
                const dateStr = parsed.iso;

                const netPnl = Number(
                    t.netPnl ?? (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0)
                );
                const isWin = netPnl > 0.001;
                const hasNotes = Boolean(t.notes || t.lesson || t.setup || t.mood);

                if (!map[dateStr]) {
                    map[dateStr] = { date: dateStr, pnl: 0, count: 0, wins: 0, winRate: 0, hasNotes: false };
                }

                map[dateStr].pnl += netPnl;
                map[dateStr].count += 1;
                if (isWin) map[dateStr].wins += 1;
                if (hasNotes) map[dateStr].hasNotes = true;
                map[dateStr].winRate = (map[dateStr].wins / map[dateStr].count) * 100;
            });
        } else {
            const sourceList = needsMonthFetch && Array.isArray(fetchedMonthData) ? fetchedMonthData : dailyPnL;
            if (Array.isArray(sourceList) && sourceList.length > 0) {
                sourceList.forEach(dp => {
                    const parsed = parseIsoParts(dp.isoDate || dp.date);
                    if (!parsed) return;
                    const dateStr = parsed.iso;
                    const val = Number(dp.pnl ?? dp.value) || 0;
                    const count = Number.isFinite(Number(dp.trades ?? dp.count))
                        ? Number(dp.trades ?? dp.count)
                        : val !== 0
                          ? 1
                          : 0;
                    const wins = dp.wins !== undefined ? Number(dp.wins) : val > 0 ? count : 0;
                    const winRate =
                        dp.winRate !== undefined ? Number(dp.winRate) : count > 0 ? (wins / count) * 100 : 0;

                    map[dateStr] = {
                        date: dateStr,
                        pnl: val,
                        count,
                        wins,
                        winRate,
                        hasNotes: Boolean(dp.hasNotes),
                    };
                });
            }
        }

        return map;
    }, [trades, dailyPnL, needsMonthFetch, fetchedMonthData]);

    const { calendarWeeks, monthStats } = useMemo(() => {
        const firstDayIndex = new Date(year, month, 1).getDay();
        const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        const weeks: {
            days: {
                dayNum: number;
                dateStr: string;
                isCurrentMonth: boolean;
                pnl: number;
                tradesCount: number;
                winRate: number;
                hasNotes: boolean;
            }[];
            weekPnl: number;
            activeDays: number;
        }[] = [];

        let currentDayCounter = 1;
        let nextMonthDayCounter = 1;

        let totalMonthPnl = 0;
        let totalMonthTrades = 0;
        let totalMonthWins = 0;
        let totalMonthActiveDays = 0;

        for (let w = 0; w < 6; w++) {
            const daysRow = [];
            let weekTotalPnl = 0;
            let weekActiveDays = 0;

            for (let d = 0; d < 7; d++) {
                const cellIndex = w * 7 + d;
                let dateStr = '';
                let dayNum = 0;
                let isCurrentMonth = false;

                if (cellIndex < firstDayIndex) {
                    dayNum = daysInPrevMonth - (firstDayIndex - cellIndex - 1);
                    const prevM = month === 0 ? 11 : month - 1;
                    const prevY = month === 0 ? year - 1 : year;
                    dateStr = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                } else if (currentDayCounter <= daysInCurrentMonth) {
                    dayNum = currentDayCounter;
                    isCurrentMonth = true;
                    dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                    currentDayCounter++;
                } else {
                    dayNum = nextMonthDayCounter;
                    const nextM = month === 11 ? 0 : month + 1;
                    const nextY = month === 11 ? year + 1 : year;
                    dateStr = `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                    nextMonthDayCounter++;
                }

                const tradeData = tradesByDate[dateStr];
                const dayPnl = tradeData ? tradeData.pnl : 0;
                const tradesCount = tradeData ? tradeData.count : 0;
                const winRate = tradeData ? tradeData.winRate : 0;
                const hasNotes = tradeData ? tradeData.hasNotes : false;

                if (isCurrentMonth && tradesCount > 0) {
                    weekTotalPnl += dayPnl;
                    weekActiveDays++;
                    totalMonthPnl += dayPnl;
                    totalMonthTrades += tradesCount;
                    totalMonthWins += tradeData.wins;
                    totalMonthActiveDays++;
                }

                daysRow.push({
                    dayNum,
                    dateStr,
                    isCurrentMonth,
                    pnl: dayPnl,
                    tradesCount,
                    winRate,
                    hasNotes,
                });
            }

            weeks.push({
                days: daysRow,
                weekPnl: weekTotalPnl,
                activeDays: weekActiveDays,
            });

            if (currentDayCounter > daysInCurrentMonth && nextMonthDayCounter > 7) {
                break;
            }
        }

        return {
            calendarWeeks: weeks,
            monthStats: {
                totalMonthPnl,
                totalMonthTrades,
                totalMonthActiveDays,
                monthWinRate: totalMonthTrades > 0 ? (totalMonthWins / totalMonthTrades) * 100 : 0,
            },
        };
    }, [year, month, tradesByDate]);

    const getCellClasses = (day: { isCurrentMonth: boolean; tradesCount: number; pnl: number }) => {
        if (!day.isCurrentMonth) {
            return 'bg-transparent border-transparent opacity-25';
        }
        if (day.tradesCount === 0) {
            return 'bg-canvas-subtle/45 border-line-subtle hover:border-line text-fg-subtle';
        }
        if (day.pnl > 0.001) {
            return 'bg-data-pos/10 border-data-pos/30 hover:border-data-pos/55 text-fg';
        }
        if (day.pnl < -0.001) {
            return 'bg-data-neg/10 border-data-neg/30 hover:border-data-neg/55 text-fg';
        }
        return 'bg-data-1/10 border-data-1/30 hover:border-data-1/55 text-fg';
    };

    const gridColsClass = showWeeklySummary
        ? 'grid-cols-[repeat(7,minmax(42px,1fr))_78px] sm:grid-cols-[repeat(7,minmax(50px,1fr))_88px]'
        : 'grid-cols-7';

    return (
        <section
            className={cn(
                'bg-surface border border-line hover:border-line-strong rounded-xl p-3.5 sm:p-4 transition-colors flex flex-col justify-between w-full h-full',
                className
            )}
        >
            {/* Compact Top Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2 border-b border-line-subtle">
                <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-0.5">
                        <button
                            type="button"
                            onClick={handlePrevMonth}
                            className="w-6 h-6 flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                            title={isEn ? 'Previous month' : 'Mês anterior'}
                        >
                            <ChevronLeft size={14} />
                        </button>

                        <span className="text-xs font-bold text-fg min-w-[98px] text-center tracking-tight">
                            {monthNames[month]} {year}
                        </span>

                        <button
                            type="button"
                            onClick={handleNextMonth}
                            className="w-6 h-6 flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                            title={isEn ? 'Next month' : 'Próximo mês'}
                        >
                            <ChevronRight size={14} />
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={handleThisMonth}
                        className="px-2 py-0.5 rounded-md bg-surface-2/80 hover:bg-surface-3 border border-line text-[10.5px] font-semibold text-fg-muted hover:text-fg transition-colors cursor-pointer"
                    >
                        {isEn ? 'This Month' : 'Este mês'}
                    </button>
                </div>

                {/* Compact Monthly Stats + Utility Icons */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10.5px] font-medium text-fg-subtle hidden sm:inline">
                        {isEn ? 'MTD:' : 'Mês:'}
                    </span>

                    <span
                        className={cn(
                            'px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums border',
                            monthStats.totalMonthPnl > 0.001
                                ? 'bg-data-pos/12 border-data-pos/30 text-accent-fg'
                                : monthStats.totalMonthPnl < -0.001
                                  ? 'bg-data-neg/12 border-data-neg/30 text-danger-fg'
                                  : 'bg-surface-2 border-line text-fg-muted'
                        )}
                    >
                        {formatCompactPnl(monthStats.totalMonthPnl)}
                    </span>

                    <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold tabular-nums bg-canvas-subtle border border-line text-fg-muted">
                        {monthStats.totalMonthActiveDays}d
                    </span>

                    {/* Display Settings Popover */}
                    <div className="relative" ref={settingsRef}>
                        <button
                            type="button"
                            onClick={() => setIsSettingsOpen(prev => !prev)}
                            className={cn(
                                'w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer',
                                isSettingsOpen
                                    ? 'bg-surface-2 text-fg border border-line'
                                    : 'text-fg-subtle hover:text-fg hover:bg-surface-2'
                            )}
                            title={isEn ? 'Calendar display options' : 'Opções de exibição do calendário'}
                        >
                            <Settings size={13} />
                        </button>

                        {isSettingsOpen && (
                            <div className="absolute right-0 mt-1.5 w-52 rounded-xl bg-surface border border-line-strong shadow-panel p-1.5 z-40 space-y-0.5 animate-fade-in-up">
                                <span className="block px-2 py-1 text-[9.5px] font-semibold uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Calendar Display' : 'Exibir no Calendário'}
                                </span>
                                {[
                                    {
                                        label: isEn ? 'Trade Count' : 'Contagem de trades',
                                        checked: showTradeCount,
                                        toggle: () => setShowTradeCount(v => !v),
                                    },
                                    {
                                        label: isEn ? 'Win Rate (%)' : 'Taxa de acerto (%)',
                                        checked: showWinRate,
                                        toggle: () => setShowWinRate(v => !v),
                                    },
                                    {
                                        label: isEn ? 'Weekly P&L' : 'Resumo semanal',
                                        checked: showWeeklySummary,
                                        toggle: () => setShowWeeklySummary(v => !v),
                                    },
                                ].map(opt => (
                                    <button
                                        key={opt.label}
                                        type="button"
                                        onClick={opt.toggle}
                                        className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[11px] font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                                    >
                                        <span>{opt.label}</span>
                                        {opt.checked && <Check size={12} className="text-accent-fg" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <span
                        title={
                            isEn
                                ? 'Green: profitable day · Red: losing day · Blue: breakeven. Top-left icon indicates journal notes.'
                                : 'Verde: dia positivo · Vermelho: dia negativo · Azul: breakeven. O ícone superior esquerdo indica anotações.'
                        }
                        className="w-5 h-5 inline-flex items-center justify-center text-fg-subtle hover:text-fg cursor-help"
                    >
                        <Info size={12} />
                    </span>
                </div>
            </div>

            {/* Compact Calendar Matrix */}
            <div className="overflow-x-auto no-scrollbar flex-1 flex flex-col justify-center">
                <div className={cn('space-y-1', showWeeklySummary ? 'min-w-[395px]' : 'min-w-[310px]')}>
                    {/* Subtle Unboxed Weekday Headers */}
                    <div className={cn('grid gap-1', gridColsClass)}>
                        {daysHeader.map(day => (
                            <div
                                key={day}
                                className="py-0.5 text-center text-[10px] font-semibold uppercase tracking-wider text-fg-subtle"
                            >
                                {day}
                            </div>
                        ))}
                        {showWeeklySummary && (
                            <div className="py-0.5 text-center text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                                {isEn ? 'Wk' : 'Sem.'}
                            </div>
                        )}
                    </div>

                    {/* Compact Week Rows */}
                    <div className="space-y-1">
                        {calendarWeeks.map((week, wIndex) => (
                            <div key={wIndex} className={cn('grid gap-1 items-stretch', gridColsClass)}>
                                {week.days.map(day => {
                                    const metaParts: string[] = [];
                                    if (showTradeCount) metaParts.push(`${day.tradesCount}t`);
                                    if (showWinRate) metaParts.push(`${Math.round(day.winRate)}%`);

                                    return (
                                        <div
                                            key={day.dateStr}
                                            title={
                                                day.isCurrentMonth && day.tradesCount > 0
                                                    ? `${day.dateStr}: ${formatCompactPnl(day.pnl)} · ${day.tradesCount} ${
                                                          day.tradesCount === 1 ? 'trade' : 'trades'
                                                      } · ${day.winRate.toFixed(1)}% ${isEn ? 'win rate' : 'acerto'}`
                                                    : undefined
                                            }
                                            className={cn(
                                                'border rounded-md px-1.5 py-1 min-h-[46px] sm:min-h-[50px] flex flex-col justify-between transition-colors',
                                                getCellClasses(day)
                                            )}
                                        >
                                            <div className="w-full flex items-center justify-between leading-none">
                                                {day.isCurrentMonth && day.hasNotes ? (
                                                    <span
                                                        title={isEn ? 'Journal note recorded' : 'Possui anotação registrada'}
                                                        className="text-fg-muted"
                                                    >
                                                        <FileText size={9.5} />
                                                    </span>
                                                ) : (
                                                    <span />
                                                )}
                                                <span className="text-[9.5px] font-medium tabular-nums text-fg-subtle ml-auto">
                                                    {day.dayNum}
                                                </span>
                                            </div>

                                            {day.isCurrentMonth && day.tradesCount > 0 ? (
                                                <div className="flex flex-col items-end text-right leading-none">
                                                    <span
                                                        className={cn(
                                                            'text-[11px] sm:text-xs font-bold tabular-nums tracking-tight',
                                                            day.pnl > 0.001
                                                                ? 'text-accent-fg'
                                                                : day.pnl < -0.001
                                                                  ? 'text-danger-fg'
                                                                  : 'text-fg'
                                                        )}
                                                    >
                                                        {formatCompactPnl(day.pnl)}
                                                    </span>

                                                    {metaParts.length > 0 && (
                                                        <span className="mt-0.5 text-[8.5px] sm:text-[9px] font-mono tabular-nums text-fg-subtle">
                                                            {metaParts.join(' · ')}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <div />
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Compact 8th Weekly Summary Column */}
                                {showWeeklySummary && (
                                    <div className="rounded-md border border-line-subtle bg-canvas-subtle/55 px-1.5 py-1 flex flex-col justify-between min-h-[46px] sm:min-h-[50px]">
                                        <div className="flex items-center justify-between gap-1 leading-none">
                                            <span className="text-[9.5px] font-medium text-fg-subtle">
                                                {isEn ? `W${wIndex + 1}` : `S${wIndex + 1}`}
                                            </span>
                                            {week.activeDays > 0 && (
                                                <span className="text-[9px] font-mono tabular-nums text-fg-muted">
                                                    {week.activeDays}d
                                                </span>
                                            )}
                                        </div>

                                        <span
                                            className={cn(
                                                'text-[11px] sm:text-xs font-bold tabular-nums tracking-tight leading-none text-right',
                                                week.weekPnl > 0.001
                                                    ? 'text-accent-fg'
                                                    : week.weekPnl < -0.001
                                                      ? 'text-danger-fg'
                                                      : 'text-fg-subtle'
                                            )}
                                        >
                                            {formatCompactPnl(week.weekPnl)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};
