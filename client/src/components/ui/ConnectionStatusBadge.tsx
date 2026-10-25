import React, { useState, useRef, useEffect } from 'react';
import { useSocket } from '../../context/SocketContext';
import { useAccount } from '../../context/AccountContext';
import { Wifi, WifiOff, RefreshCw, Server, Activity, CheckCircle2, AlertCircle, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const ConnectionStatusBadge: React.FC = () => {
    const { isConnected: isWsConnected, mt5Status } = useSocket();
    const { selectedAccount, isConsolidated, refreshAccounts, isLoading: isAccountLoading } = useAccount();
    const [isOpen, setIsOpen] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    // Fecha o popover ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Determina o status consolidado
    // Conta individual: checa flag isConnected do banco e status do WebSocket
    const isMt5Connected = mt5Status === 'connected' || (Boolean(selectedAccount?.isConnected) && isWsConnected);

    let statusType: 'online' | 'connecting' | 'offline' = 'offline';
    let statusLabel = 'Desconectado';
    let badgeClasses = 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400';
    let dotClasses = 'bg-rose-500';

    if (isWsConnected && isMt5Connected) {
        statusType = 'online';
        statusLabel = 'MT5 Online';
        badgeClasses = 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500/40';
        dotClasses = 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]';
    } else if (isWsConnected && !isMt5Connected) {
        statusType = 'connecting';
        statusLabel = 'MT5 Offline';
        badgeClasses = 'bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400 hover:border-amber-500/40';
        dotClasses = 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.7)]';
    } else {
        statusType = 'offline';
        statusLabel = 'Servidor Offline';
        badgeClasses = 'bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-400 hover:border-rose-500/40';
        dotClasses = 'bg-rose-500';
    }

    const handleManualRefresh = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsRefreshing(true);
        try {
            await refreshAccounts();
        } finally {
            setTimeout(() => setIsRefreshing(false), 800);
        }
    };

    const formatLastSeen = (timestamp?: string | null) => {
        if (!timestamp) return 'Sem registro recente';
        try {
            const date = new Date(timestamp);
            const now = new Date();
            const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

            if (diffSeconds < 30) return 'Agora mesmo';
            if (diffSeconds < 60) return `Há ${diffSeconds}s`;
            const diffMinutes = Math.floor(diffSeconds / 60);
            if (diffMinutes < 60) return `Há ${diffMinutes} min`;
            const diffHours = Math.floor(diffMinutes / 60);
            if (diffHours < 24) return `Há ${diffHours}h`;
            return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch {
            return 'Recente';
        }
    };

    return (
        <div className="relative" ref={popoverRef}>
            {/* BADGE BOTÃO NO HEADER */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-200 select-none focus:outline-none ${badgeClasses}`}
                title="Status da Conexão com MetaTrader 5"
            >
                {/* Indicador pulsante */}
                <span className="relative flex h-2 w-2">
                    {statusType === 'online' && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    )}
                    {statusType === 'connecting' && (
                        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${dotClasses}`}></span>
                </span>

                {/* Ícone Wifi */}
                {statusType === 'online' ? (
                    <Wifi size={13} className="shrink-0" />
                ) : (
                    <WifiOff size={13} className="shrink-0 opacity-80" />
                )}

                {/* Texto do Status */}
                <span className="hidden sm:inline font-mono tracking-tight text-[11px] font-bold">
                    {statusLabel}
                </span>
            </button>

            {/* POPOVER DE DIAGNÓSTICO DETALHADO */}
            {isOpen && (
                <div className="absolute right-0 sm:right-auto sm:left-0 mt-2 w-72 sm:w-80 rounded-xl bg-white dark:bg-[#111319] border border-slate-200 dark:border-white/[0.08] shadow-2xl backdrop-blur-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 text-slate-800 dark:text-slate-200">
                    {/* Header do Popover */}
                    <div className="p-3 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between bg-slate-50 dark:bg-[#0C0D12]">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-[#F3F4F6]">
                            <Activity size={14} className="text-emerald-500 dark:text-emerald-400" />
                            <span>Diagnóstico de Conexão</span>
                        </div>
                        <button
                            onClick={handleManualRefresh}
                            disabled={isRefreshing || isAccountLoading}
                            className="p-1 rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#161822] transition-colors disabled:opacity-50"
                            title="Recarregar status"
                        >
                            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-emerald-500' : ''} />
                        </button>
                    </div>

                    {/* Itens de Conexão */}
                    <div className="p-3 space-y-2.5 text-xs">
                        {/* 1. Servidor WebSocket Torex */}
                        <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-[#161822] border border-slate-200 dark:border-white/[0.05]">
                            <div className="flex items-center gap-2">
                                <Server size={14} className="text-slate-500 dark:text-slate-400" />
                                <div>
                                    <div className="font-semibold text-slate-900 dark:text-white leading-tight">Servidor Torex</div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400">WebSocket / Hub em Tempo Real</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                {isWsConnected ? (
                                    <>
                                        <CheckCircle2 size={13} className="text-emerald-500" />
                                        <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">ATIVO</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle size={13} className="text-rose-500" />
                                        <span className="text-[10px] font-mono font-bold text-rose-600 dark:text-rose-400">OFFLINE</span>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* 2. Ponte MetaTrader 5 */}
                        <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-[#161822] border border-slate-200 dark:border-white/[0.05]">
                            <div className="flex items-center gap-2">
                                <Wifi size={14} className="text-slate-500 dark:text-slate-400" />
                                <div>
                                    <div className="font-semibold text-slate-900 dark:text-white leading-tight">MetaTrader 5 Bridge</div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400">Worker Node Windows</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                {isMt5Connected ? (
                                    <>
                                        <CheckCircle2 size={13} className="text-emerald-500" />
                                        <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">SINCRONIZADO</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle size={13} className="text-amber-500" />
                                        <span className="text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400">DESCONECTADO</span>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* 3. Informações da Conta Atual */}
                        <div className="pt-2 border-t border-slate-200 dark:border-white/[0.08] space-y-1.5">
                            <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-500 dark:text-slate-400">Conta Ativa:</span>
                                <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[150px]">
                                    {isConsolidated ? 'Todas as Contas (Consolidado)' : (selectedAccount?.name || 'Conta Padrão')}
                                </span>
                            </div>

                            {!isConsolidated && selectedAccount && (
                                <>
                                    <div className="flex justify-between items-center text-[11px]">
                                        <span className="text-slate-500 dark:text-slate-400">Corretora:</span>
                                        <span className="font-mono text-slate-700 dark:text-slate-300">
                                            {selectedAccount.broker || 'MetaTrader 5'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center text-[11px]">
                                        <span className="text-slate-500 dark:text-slate-400">Último Sinal:</span>
                                        <span className="font-mono text-slate-700 dark:text-slate-300">
                                            {formatLastSeen(selectedAccount.lastSeen)}
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Rodapé com link de Ação */}
                    <div className="p-2 border-t border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#0C0D12]">
                        <button
                            onClick={() => {
                                setIsOpen(false);
                                navigate('/configuration');
                            }}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 text-xs font-semibold transition-colors"
                        >
                            <span>Gerenciar Conexões MT5</span>
                            <ArrowUpRight size={13} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
