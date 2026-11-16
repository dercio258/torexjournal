import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

interface CalendarWidgetProps {
    currentDate: Date;
    selectedDate: Date | null;
    onDateSelect: (date: Date) => void;
    onMonthChange: (offset: number) => void;
    trades: any[];
}

export const CalendarWidget: React.FC<CalendarWidgetProps> = ({
    currentDate,
    selectedDate,
    onDateSelect,
    onMonthChange,
    trades
}) => {
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const getDaysInMonth = (date: Date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDay = new Date(year, month, 1).getDay();
        return { daysInMonth, firstDay };
    };

    const { daysInMonth, firstDay } = getDaysInMonth(currentDate);
    const days = [];

    // Empty slots for previous month
    for (let i = 0; i < firstDay; i++) {
        days.push(<div key={`empty-${i}`} className="min-h-[52px] sm:min-h-[58px] rounded-lg bg-canvas-subtle/30" />);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        // Find trades for this day (em UTC para preservar a data exata do MT5/Relatório)
        const dayTrades = trades.filter(t => {
            const d = new Date(t.close_time);
            return d.getUTCDate() === day && d.getUTCMonth() === currentDate.getMonth() && d.getUTCFullYear() === currentDate.getFullYear();
        });

        const pnl = dayTrades.reduce((acc, t) => acc + t.profit, 0);
        const hasTrades = dayTrades.length > 0;
        const isSelected =
            selectedDate?.getDate() === day &&
            selectedDate?.getMonth() === currentDate.getMonth() &&
            selectedDate?.getFullYear() === currentDate.getFullYear();
        const isToday =
            new Date().getDate() === day &&
            new Date().getMonth() === currentDate.getMonth() &&
            new Date().getFullYear() === currentDate.getFullYear();

        let cellStyle = 'bg-canvas-subtle/60 hover:bg-surface-2 border-line-subtle';
        if (hasTrades) {
            cellStyle =
                pnl >= 0
                    ? 'bg-emerald-500/[0.08] hover:bg-emerald-500/[0.14] border-emerald-500/25'
                    : 'bg-rose-500/[0.08] hover:bg-rose-500/[0.14] border-rose-500/25';
        }
        if (isSelected) {
            cellStyle += ' ring-1 ring-accent border-accent/50';
        }

        days.push(
            <div
                key={day}
                onClick={() => onDateSelect(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))}
                className={`relative p-1.5 min-h-[52px] sm:min-h-[58px] rounded-lg border cursor-pointer transition-colors flex flex-col justify-between ${cellStyle}`}
            >
                <div className="flex justify-between items-center">
                    <span
                        className={`text-[11px] font-semibold tabular-nums ${
                            isSelected ? 'text-accent-fg font-bold' : isToday ? 'text-fg font-bold' : 'text-fg-muted'
                        }`}
                    >
                        {day}
                    </span>
                    {isToday && <span className="w-1.5 h-1.5 bg-accent rounded-full" />}
                </div>

                {hasTrades && (
                    <div className="text-right leading-tight">
                        <div className={`text-[11px] font-bold font-mono tabular-nums ${pnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                            {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(0)}
                        </div>
                        <div className="text-[9px] text-fg-subtle font-medium tabular-nums">
                            {dayTrades.length} {dayTrades.length === 1 ? 'trade' : 'trades'}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="bg-surface border border-line rounded-xl p-3.5 sm:p-4 flex flex-col">
            {/* Calendar Header */}
            <div className="flex items-center justify-between pb-3 mb-2 border-b border-line-subtle">
                <h3 className="font-bold text-fg flex items-center gap-1.5 text-sm">
                    <span className="capitalize">{currentDate.toLocaleString(isEn ? 'en-US' : 'pt-BR', { month: 'long' })}</span>
                    <span className="text-fg-subtle font-mono text-xs">{currentDate.getFullYear()}</span>
                </h3>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onMonthChange(-1)}
                        className="h-7 w-7 flex items-center justify-center bg-canvas-subtle hover:bg-surface-2 rounded-lg text-fg-muted hover:text-fg transition-colors border border-line-subtle cursor-pointer"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <button
                        onClick={() => onMonthChange(1)}
                        className="h-7 w-7 flex items-center justify-center bg-canvas-subtle hover:bg-surface-2 rounded-lg text-fg-muted hover:text-fg transition-colors border border-line-subtle cursor-pointer"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>

            {/* Days Header */}
            <div className="grid grid-cols-7 gap-1.5 pb-1.5 text-center">
                {(isEn ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']).map((d, i) => (
                    <span key={i} className="text-[10px] uppercase font-semibold tracking-wider text-fg-subtle">
                        {d}
                    </span>
                ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1.5 flex-1 content-start">
                {days}
            </div>
        </div>
    );
};
