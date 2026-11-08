import React from 'react';
import { Award, AlertTriangle, CheckCircle2, TrendingUp, ShieldAlert, Target } from 'lucide-react';

interface PropFirmProgressCardProps {
    propFirmStatus?: {
        hasRules: boolean;
        profitTarget: number;
        profitTargetProgress: number | null;
        dailyLossLimit: number;
        todayPnL: number;
        dailyLossMargin: number | null;
        maxDrawdownLimit: number;
        maxDrawdownRecorded: number;
    } | null;
    currency?: string;
}

export const PropFirmProgressCard: React.FC<PropFirmProgressCardProps> = ({ propFirmStatus, currency = 'USD' }) => {
    if (!propFirmStatus || !propFirmStatus.hasRules) return null;

    const {
        profitTarget,
        profitTargetProgress,
        dailyLossLimit,
        todayPnL,
        maxDrawdownLimit,
        maxDrawdownRecorded
    } = propFirmStatus;

    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val || 0);
    };

    const targetProgressClamped = Math.min(Math.max(profitTargetProgress || 0, 0), 100);
    const isTargetReached = (profitTargetProgress || 0) >= 100;

    const dailyLossPercentage = dailyLossLimit > 0
        ? Math.min(Math.max((Math.abs(Math.min(todayPnL, 0)) / dailyLossLimit) * 100, 0), 100)
        : 0;
    const isDailyLossWarning = dailyLossPercentage >= 70;
    const isDailyLossBreached = dailyLossPercentage >= 100;

    const drawdownPercentage = maxDrawdownLimit > 0
        ? Math.min(Math.max((maxDrawdownRecorded / maxDrawdownLimit) * 100, 0), 100)
        : 0;

    return (
        <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-surface via-surface/90 to-canvas-subtle border border-amber-500/25 shadow-xl relative overflow-hidden group">
            {/* Ambient Background Glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400">
                        <Award size={22} />
                    </div>
                    <div>
                        <h3 className="font-bold text-fg text-sm sm:text-base flex items-center gap-2">
                            Regras & Progresso da Prop Firm
                            {isTargetReached && (
                                <span className="text-[10px] bg-emerald-500/20 text-accent-fg px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold">
                                    <CheckCircle2 size={12} /> Meta Batida!
                                </span>
                            )}
                        </h3>
                        <p className="text-xs text-fg-muted">Monitoramento em tempo real do desafio e limites de risco</p>
                    </div>
                </div>

                {isDailyLossBreached ? (
                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-rose-500/20 text-danger-fg flex items-center gap-1.5 animate-pulse">
                        <ShieldAlert size={14} /> Limite Diário Violado
                    </span>
                ) : isDailyLossWarning ? (
                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle size={14} /> Atenção ao Limite Diário
                    </span>
                ) : (
                    <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500/10 text-accent-fg">
                        Conta em Conformidade
                    </span>
                )}
            </div>

            {/* Grid de Métricas */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 relative z-10">
                {/* 1. Profit Target */}
                {profitTarget > 0 && (
                    <div className="p-3.5 sm:p-4 rounded-xl bg-canvas/60 border border-line">
                        <div className="flex items-center justify-between text-xs mb-2">
                            <span className="text-fg-muted font-medium flex items-center gap-1.5">
                                <Target size={14} className="text-accent-fg" />
                                Profit Target
                            </span>
                            <span className="font-bold text-accent-fg font-mono">
                                {(profitTargetProgress || 0).toFixed(1)}%
                            </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-canvas overflow-hidden mb-2 border border-line">
                            <div 
                                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                                style={{ width: `${targetProgressClamped}%` }}
                            />
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-fg-muted">
                            <span>Meta: {formatMoney(profitTarget)}</span>
                            <span className="text-accent-fg">
                                {isTargetReached ? 'Aprovado!' : `${(100 - targetProgressClamped).toFixed(0)}% restante`}
                            </span>
                        </div>
                    </div>
                )}

                {/* 2. Daily Loss Limit */}
                {dailyLossLimit > 0 && (
                    <div className="p-3.5 sm:p-4 rounded-xl bg-canvas/60 border border-line">
                        <div className="flex items-center justify-between text-xs mb-2">
                            <span className="text-fg-muted font-medium flex items-center gap-1.5">
                                <ShieldAlert size={14} className={isDailyLossWarning ? 'text-danger-fg' : 'text-amber-400'} />
                                Limite de Perda Diária
                            </span>
                            <span className={`font-bold font-mono ${isDailyLossWarning ? 'text-danger-fg' : 'text-fg/80'}`}>
                                {dailyLossPercentage.toFixed(1)}%
                            </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-canvas overflow-hidden mb-2 border border-line">
                            <div 
                                className={`h-full rounded-full transition-all duration-500 ${
                                    isDailyLossBreached
                                        ? 'bg-rose-500'
                                        : isDailyLossWarning
                                        ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                                        : 'bg-gradient-to-r from-indigo-500 to-sky-400'
                                }`}
                                style={{ width: `${dailyLossPercentage}%` }}
                            />
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-fg-muted">
                            <span>PnL Hoje: <b className={todayPnL >= 0 ? 'text-accent-fg' : 'text-danger-fg'}>{todayPnL >= 0 ? '+' : ''}{formatMoney(todayPnL)}</b></span>
                            <span>Teto: {formatMoney(dailyLossLimit)}</span>
                        </div>
                    </div>
                )}

                {/* 3. Max Drawdown */}
                {maxDrawdownLimit > 0 && (
                    <div className="p-3.5 sm:p-4 rounded-xl bg-canvas/60 border border-line">
                        <div className="flex items-center justify-between text-xs mb-2">
                            <span className="text-fg-muted font-medium flex items-center gap-1.5">
                                <TrendingUp size={14} className="text-danger-fg rotate-180" />
                                Drawdown Máximo Total
                            </span>
                            <span className="font-bold text-danger-fg font-mono">
                                {drawdownPercentage.toFixed(1)}%
                            </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-canvas overflow-hidden mb-2 border border-line">
                            <div 
                                className="h-full bg-gradient-to-r from-amber-500 to-rose-500 rounded-full transition-all duration-500"
                                style={{ width: `${drawdownPercentage}%` }}
                            />
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-fg-muted">
                            <span>Registrado: <b className="text-danger-fg">{formatMoney(maxDrawdownRecorded)}</b></span>
                            <span>Teto: {formatMoney(maxDrawdownLimit)}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
