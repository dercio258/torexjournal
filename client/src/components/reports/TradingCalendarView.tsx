import React, { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, BookOpen, Calendar } from 'lucide-react';

const MONTH_NAMES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const DAYS_HEADER = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

interface TradingCalendarViewProps {
    trades?: any[];
    dailyPnL?: any[];
}

export const TradingCalendarView: React.FC<TradingCalendarViewProps> = ({
    trades = [],
    dailyPnL = []
}) => {
    // Determine default month from available trades
    const [currentDate, setCurrentDate] = useState(() => {
        if (Array.isArray(trades) && trades.length > 0) {
            for (const t of trades) {
                const timeVal = t.closeTime || t.openTime || t.date;
                if (timeVal) {
                    const d = new Date(timeVal);
                    if (!isNaN(d.getTime())) {
                        return new Date(d.getFullYear(), d.getMonth(), 1);
                    }
                }
            }
        }
        if (Array.isArray(dailyPnL) && dailyPnL.length > 0) {
            const last = dailyPnL[dailyPnL.length - 1];
            if (last?.date) {
                const d = new Date(last.date);
                if (!isNaN(d.getTime())) {
                    return new Date(d.getFullYear(), d.getMonth(), 1);
                }
            }
        }
        return new Date();
    });

    // Automatically navigate to latest trade month when new trades load
    useEffect(() => {
        if (Array.isArray(trades) && trades.length > 0) {
            for (const t of trades) {
                const timeVal = t.closeTime || t.openTime || t.date;
                if (timeVal) {
                    const d = new Date(timeVal);
                    if (!isNaN(d.getTime())) {
                        setCurrentDate(new Date(d.getFullYear(), d.getMonth(), 1));
                        break;
                    }
                }
            }
        }
    }, [trades]);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    // Map trades by 'YYYY-MM-DD'
    const tradesByDate = useMemo(() => {
        const map: Record<string, { date: string; pnl: number; count: number; wins: number; hasNotes: boolean }> = {};

        if (Array.isArray(trades) && trades.length > 0) {
            trades.forEach(t => {
                const timeVal = t.closeTime || t.openTime || t.date;
                if (!timeVal) return;
                const d = new Date(timeVal);
                if (isNaN(d.getTime())) return;

                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                const dateStr = `${y}-${m}-${day}`;

                const netPnl = Number(t.netPnl ?? (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0));
                const isWin = netPnl > 0.001;
                const hasNotes = Boolean(t.notes || t.comment || t.setup || t.mood);

                if (!map[dateStr]) {
                    map[dateStr] = { date: dateStr, pnl: 0, count: 0, wins: 0, hasNotes: false };
                }

                map[dateStr].pnl += netPnl;
                map[dateStr].count += 1;
                if (isWin) map[dateStr].wins += 1;
                if (hasNotes) map[dateStr].hasNotes = true;
            });
        } else if (Array.isArray(dailyPnL) && dailyPnL.length > 0) {
            dailyPnL.forEach(dp => {
                const dateStr = dp.date ? String(dp.date).split('T')[0] : '';
                if (!dateStr) return;
                const val = Number(dp.pnl ?? dp.value) || 0;
                const count = Number(dp.trades) || 1;
                const wins = dp.wins !== undefined ? Number(dp.wins) : (val > 0 ? count : 0);
                map[dateStr] = {
                    date: dateStr,
                    pnl: val,
                    count,
                    wins,
                    hasNotes: false
                };
            });
        }

        return map;
    }, [trades, dailyPnL]);

    // Construct weeks grid (8 columns: 7 days + 1 summary column)
    const { calendarWeeks, monthStats } = useMemo(() => {
        const firstDayIndex = new Date(year, month, 1).getDay();
        const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        const weeks = [];
        let currentDayCounter = 1;
        let nextMonthDayCounter = 1;

        let totalMonthPnl = 0;
        let totalMonthTrades = 0;
        let totalMonthWins = 0;
        let totalMonthActiveDays = 0;
        let greenDays = 0;
        let redDays = 0;

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
                const winRate = tradeData && tradesCount > 0 ? ((tradeData.wins / tradesCount) * 100).toFixed(0) : '0';
                const hasNotes = tradeData ? tradeData.hasNotes : false;

                if (isCurrentMonth && tradesCount > 0) {
                    weekTotalPnl += dayPnl;
                    weekActiveDays++;
                    totalMonthPnl += dayPnl;
                    totalMonthTrades += tradesCount;
                    totalMonthWins += tradeData.wins;
                    totalMonthActiveDays++;
                    if (dayPnl > 0.001) greenDays++;
                    else if (dayPnl < -0.001) redDays++;
                }

                daysRow.push({
                    dayNum,
                    dateStr,
                    isCurrentMonth,
                    pnl: dayPnl,
                    tradesCount,
                    winRate,
                    hasNotes
                });
            }

            weeks.push({
                days: daysRow,
                weekPnl: weekTotalPnl,
                activeDays: weekActiveDays
            });

            if (currentDayCounter > daysInCurrentMonth && nextMonthDayCounter > 7) {
                break;
            }
        }

        const monthWinRate = totalMonthTrades > 0 ? Math.round((totalMonthWins / totalMonthTrades) * 100) : 0;

        return {
            calendarWeeks: weeks,
            monthStats: {
                totalMonthPnl,
                totalMonthTrades,
                totalMonthActiveDays,
                monthWinRate,
                greenDays,
                redDays
            }
        };
    }, [year, month, tradesByDate]);

    const getCellClasses = (day: any) => {
        if (!day.isCurrentMonth) {
            return "bg-slate-100/30 dark:bg-[#08090C]/30 border-slate-200/40 dark:border-white/[0.03] opacity-25";
        }
        if (day.tradesCount === 0) {
            return "bg-white/50 dark:bg-[#111319]/40 border-slate-200/70 dark:border-white/[0.05]";
        }
        if (day.pnl > 0.001) {
            return "bg-emerald-500/[0.09] dark:bg-emerald-950/45 border-emerald-500/35 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500/60 shadow-[0_2px_8px_rgba(16,185,129,0.06)]";
        }
        if (day.pnl < -0.001) {
            return "bg-rose-500/[0.09] dark:bg-rose-950/45 border-rose-500/35 dark:border-rose-500/40 text-rose-600 dark:text-rose-400 hover:border-rose-500/60 shadow-[0_2px_8px_rgba(244,63,94,0.06)]";
        }
        return "bg-slate-100 dark:bg-slate-900/80 border-line text-fg-muted";
    };

    const formatCurrency = (amount: number, compact: boolean = true) => {
        const isNeg = amount < -0.001;
        const abs = Math.abs(amount);
        if (compact) {
            if (abs >= 100000) {
                return `${isNeg ? '-' : '+'}$${(abs / 1000).toFixed(0)}k`;
            }
            if (abs >= 1000) {
                return `${isNeg ? '-' : '+'}$${Math.round(abs).toLocaleString('en-US')}`;
            }
            return `${isNeg ? '-' : '+'}$${abs.toFixed(0)}`;
        }
        return `${isNeg ? '-' : '+'}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    return (
        <div className="bg-slate-50 dark:bg-[#111319] p-3.5 sm:p-4 rounded-xl border border-line shadow-xs dark:shadow-none flex flex-col justify-between w-full h-full">
            {/* Header: Title, Month Navigation & Monthly KPIs */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2.5 mb-2 border-b border-line ">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-500 dark:text-purple-400">
                        <Calendar size={15} />
                    </div>
                    <div>
                        <h3 className="text-xs sm:text-sm font-bold text-fg uppercase tracking-wider font-mono">
                            Calendário Operacional
                        </h3>
                        <p className="text-[10px] text-fg-subtle dark:text-slate-400">
                            Resultados diários e semanais
                        </p>
                    </div>
                </div>

                {/* Month Navigation & Metrics Bar */}
                <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-between sm:justify-end">
                    {/* Monthly KPI Badges */}
                    {monthStats.totalMonthTrades > 0 && (
                        <div className="flex items-center gap-1.5">
                            <div className={`px-2 py-0.5 rounded font-mono text-[10px] sm:text-[11px] font-bold border ${
                                monthStats.totalMonthPnl >= 0 
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
                            }`}>
                                {formatCurrency(monthStats.totalMonthPnl, false)}
                            </div>
                            <div className="px-1.5 py-0.5 rounded font-mono text-[10px] sm:text-[11px] font-semibold bg-slate-100 dark:bg-[#08090C] text-fg-muted border border-line ">
                                <span className="text-emerald-500">{monthStats.greenDays}W</span> / <span className="text-rose-500">{monthStats.redDays}L</span>
                            </div>
                        </div>
                    )}

                    {/* Month Navigator Controls */}
                    <div className="flex items-center gap-1 bg-white dark:bg-[#08090C] border border-line rounded-lg p-0.5 shadow-xs">
                        <button 
                            onClick={handlePrevMonth}
                            className="p-1 text-fg-subtle hover:text-fg dark:text-slate-400 rounded hover:bg-surface-2 transition-colors cursor-pointer"
                            title="Mês Anterior"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        
                        <span className="font-mono text-[11px] sm:text-xs font-bold text-fg min-w-[105px] text-center tracking-tight">
                            {MONTH_NAMES[month]} {year}
                        </span>
                        
                        <button 
                            onClick={handleNextMonth}
                            className="p-1 text-fg-subtle hover:text-fg dark:text-slate-400 rounded hover:bg-surface-2 transition-colors cursor-pointer"
                            title="Próximo Mês"
                        >
                            <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* High-Resolution Responsive Grid Container */}
            <div className="overflow-x-auto pb-1 no-scrollbar flex-1 flex flex-col justify-center">
                <div className="min-w-[340px] space-y-1">
                    {/* Days of Week Header (7 Columns) */}
                    <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center text-[10px] sm:text-[11px] font-bold text-fg-subtle dark:text-slate-400 font-mono">
                        {DAYS_HEADER.map((day, idx) => (
                            <div key={idx} className="py-0.5 uppercase tracking-wider">{day}</div>
                        ))}
                    </div>

                    {/* Calendar Weeks Rows (7 Columns) */}
                    <div className="space-y-1">
                        {calendarWeeks.map((week, wIndex) => (
                            <div key={wIndex} className="grid grid-cols-7 gap-1 sm:gap-1.5">
                                {/* 7 Day Cells */}
                                {week.days.map((day, dIndex) => (
                                    <div
                                        key={dIndex}
                                        className={`border rounded-lg p-1 h-[45px] sm:h-[48px] flex flex-col justify-between transition-all group ${getCellClasses(day)}`}
                                    >
                                        {/* Day Header: Note Flag & Day Number */}
                                        <div className="w-full flex justify-between items-center leading-none">
                                            {day.hasNotes ? (
                                                <span title="Anotação de Trade">
                                                    <BookOpen className="w-2 h-2 text-amber-400" />
                                                </span>
                                            ) : <span />}
                                            <span className="text-[8.5px] sm:text-[9px] font-semibold text-slate-400/80 dark:text-slate-500/80 font-mono ml-auto">
                                                {day.dayNum}
                                            </span>
                                        </div>

                                        {/* Centered Day Content: PnL & Trade Count (No Percentage) */}
                                        {day.isCurrentMonth && day.tradesCount > 0 ? (
                                            <div className="my-auto flex flex-col items-center justify-center text-center leading-none">
                                                <span className="text-[10px] sm:text-[10.5px] font-bold font-mono tracking-tight leading-tight">
                                                    {formatCurrency(day.pnl, true)}
                                                </span>
                                                <span className="text-[7.5px] sm:text-[8px] font-mono text-slate-500/80 dark:text-slate-400/80 mt-0.5 leading-none">
                                                    {day.tradesCount} {day.tradesCount === 1 ? 'trade' : 'trades'}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="my-auto" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Subtle Footer Legend & Help Text */}
            <div className="flex flex-wrap justify-between items-center text-[10px] text-fg-subtle dark:text-slate-400 mt-2 border-t border-line pt-2 font-mono">
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shadow-[0_0_6px_rgba(16,185,129,0.4)]" /> 
                        Lucro
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-rose-500 inline-block shadow-[0_0_6px_rgba(244,63,94,0.4)]" /> 
                        Loss
                    </span>
                    <span className="flex items-center gap-1">
                        <BookOpen className="w-2.5 h-2.5 text-amber-400" /> Notas
                    </span>
                </div>
                <span>Navegue com as setas para outros meses</span>
            </div>
        </div>
    );
};
