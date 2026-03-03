import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
        days.push(<div key={`empty-${i}`} className="min-h-[80px] bg-slate-900/20 border-r border-b border-slate-700/50" />);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        // Find trades for this day
        const dayTrades = trades.filter(t => {
            const d = new Date(t.close_time);
            return d.getDate() === day && d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
        });

        const pnl = dayTrades.reduce((acc, t) => acc + t.profit, 0);
        const hasTrades = dayTrades.length > 0;
        const isSelected = selectedDate?.getDate() === day && selectedDate?.getMonth() === currentDate.getMonth() && selectedDate?.getFullYear() === currentDate.getFullYear();
        const isToday = new Date().getDate() === day && new Date().getMonth() === currentDate.getMonth() && new Date().getFullYear() === currentDate.getFullYear();

        let bgClass = "bg-slate-900/20 hover:bg-slate-800/50";
        if (hasTrades) {
            bgClass = pnl >= 0
                ? "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20"
                : "bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/20";
        }

        let borderClass = "border-r border-b border-slate-700/50";
        if (isSelected) {
            bgClass = "bg-indigo-600/20 hover:bg-indigo-600/30 ring-inset ring-2 ring-indigo-500 z-10";
            borderClass = "border-transparent";
        }

        days.push(
            <div
                key={day}
                onClick={() => onDateSelect(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))}
                className={`relative p-2 min-h-[80px] cursor-pointer transition-all flex flex-col justify-between group ${bgClass} ${borderClass}`}
            >
                <div className="flex justify-between items-start">
                    <span className={`text-sm font-bold ${isSelected || isToday ? 'text-white' : 'text-slate-400'}`}>
                        {day}
                    </span>
                    {isToday && <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>}
                </div>

                {hasTrades && (
                    <div className="text-right">
                        <div className="flex justify-end gap-0.5 mb-1 opacity-60">
                            {dayTrades.slice(0, 5).map((t, i) => (
                                <div key={i} className={`w-1 h-1 rounded-full ${t.profit >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            ))}
                        </div>
                        <div className={`text-[10px] font-bold font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {pnl >= 0 ? '+' : ''}{pnl.toFixed(0)}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl overflow-hidden shadow-xl flex flex-col h-full">
            {/* Calendar Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
                <h3 className="font-bold text-white flex items-center gap-2">
                    <span className="capitalize">{currentDate.toLocaleString('pt-BR', { month: 'long' })}</span>
                    <span className="text-slate-500 font-mono text-sm">{currentDate.getFullYear()}</span>
                </h3>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onMonthChange(-1)}
                        className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    <button
                        onClick={() => onMonthChange(1)}
                        className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>

            {/* Days Header */}
            <div className="grid grid-cols-7 bg-slate-950/30 border-b border-slate-800 py-2 text-center">
                {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                    <span key={i} className={`text-[10px] font-bold ${i === 0 || i === 6 ? 'text-rose-500/50' : 'text-slate-500'}`}>
                        {d}
                    </span>
                ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 flex-1 overflow-y-auto content-start bg-slate-950/20">
                {days}
            </div>
        </div>
    );
};
