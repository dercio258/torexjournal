import React, { useState, useRef, useEffect } from 'react';
import { useAccount } from '../../context/AccountContext';
import { 
    ChevronDown, 
    Check, 
    Plus,
    Settings2, 
    Layers, 
    Shield, 
    Award, 
    Briefcase, 
    Flame
} from 'lucide-react';

export const AccountSelector: React.FC = () => {
    const { 
        accounts, 
        selectedAccountId, 
        selectedAccount, 
        isConsolidated, 
        selectAccount,
        openCreateModal,
        openManageModal,
        canCreateAccount
    } = useAccount();

    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fechar dropdown ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const activeAccounts = accounts.filter(a => !a.isArchived);

    const formatMoney = (val: number, currency = 'USD') => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(val || 0);
    };

    const getTypeBadge = (type: string) => {
        switch (type) {
            case 'prop_firm':
            case 'challenge':
            case 'funded':
                return {
                    label: type === 'prop_firm' ? 'PROP' : type.toUpperCase(),
                    classes: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                    icon: <Award size={12} className="text-amber-400" />
                };
            case 'demo':
                return {
                    label: 'DEMO',
                    classes: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
                    icon: <Shield size={12} className="text-sky-400" />
                };
            case 'live':
            default:
                return {
                    label: 'LIVE',
                    classes: 'bg-emerald-500/15 text-accent-fg border-emerald-500/30',
                    icon: <Flame size={12} className="text-accent-fg" />
                };
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-3 px-3.5 py-2 rounded-xl bg-surface hover:bg-surface-2 border border-line hover:border-line-strong transition-all duration-200 shadow-md group focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                title="Alternar Conta de Trading"
            >
                <div className="flex items-center gap-2.5">
                    {isConsolidated ? (
                        <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                            <Layers size={15} />
                        </div>
                    ) : (
                        <div className="w-7 h-7 rounded-lg bg-surface-2 border border-line flex items-center justify-center">
                            {getTypeBadge(selectedAccount?.type || 'live').icon}
                        </div>
                    )}

                    <div className="flex flex-col text-left">
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-fg max-w-[130px] sm:max-w-[160px] truncate leading-tight">
                                {isConsolidated 
                                    ? 'Todas as contas' 
                                    : `${selectedAccount?.name || 'Conta'}${selectedAccount?.mt5Id ? ` (#${selectedAccount.mt5Id})` : ''}`}
                            </span>
                            {!isConsolidated && selectedAccount && (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded border ${getTypeBadge(selectedAccount.type).classes}`}>
                                    {getTypeBadge(selectedAccount.type).label}
                                </span>
                            )}
                        </div>
                        <span className="text-[11px] font-mono leading-tight mt-0.5">
                            {isConsolidated ? (
                                <span className="text-indigo-400 font-semibold">{activeAccounts.length} contas</span>
                            ) : (
                                <span className={`font-bold ${(selectedAccount?.netPnl || 0) >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                    {(selectedAccount?.netPnl || 0) >= 0 ? '+' : ''}
                                    {formatMoney(selectedAccount?.netPnl || 0, selectedAccount?.currency)}
                                </span>
                            )}
                        </span>
                    </div>
                </div>

                <ChevronDown 
                    size={15} 
                    className={`text-fg-muted transition-transform duration-200 ml-1 ${isOpen ? 'rotate-180 text-accent-fg' : 'group-hover:text-fg'}`} 
                />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute right-0 sm:left-0 sm:right-auto mt-2 w-72 rounded-2xl bg-surface/95 border border-line shadow-2xl backdrop-blur-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="p-3 border-b border-line flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-fg-muted uppercase tracking-wider">
                            <Briefcase size={13} />
                            <span>Contas de Trading</span>
                        </div>
                        <span className="text-[10px] bg-surface-2 text-fg-muted px-2 py-0.5 rounded-full font-mono border border-line">
                            {activeAccounts.length}
                        </span>
                    </div>

                    {/* Lista de Contas Ativas */}
                    <div className="max-h-64 overflow-y-auto p-1.5 space-y-1">
                        {activeAccounts.map(account => {
                            const isSelected = !isConsolidated && selectedAccountId === account.id;
                            const badge = getTypeBadge(account.type);

                            return (
                                <button
                                    key={account.id}
                                    onClick={() => {
                                        selectAccount(account.id);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                                        isSelected 
                                            ? 'bg-emerald-500/10 border border-emerald-500/30 text-fg shadow-sm' 
                                            : 'hover:bg-surface-2/60 text-fg-muted hover:text-fg border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 overflow-hidden">
                                         <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                                             isSelected ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-surface-2 border-line'
                                         }`}>
                                             {badge.icon}
                                         </div>

                                         <div className="flex flex-col truncate">
                                             <div className="flex items-center gap-1.5 truncate">
                                                 <span className="text-xs font-semibold truncate leading-tight">
                                                     {account.name}
                                                 </span>
                                                 {account.mt5Id && (
                                                     <span className="text-[10px] text-fg-subtle font-mono">
                                                         (#{account.mt5Id})
                                                     </span>
                                                 )}
                                                 <span className={`text-[9px] font-bold px-1 rounded border ${badge.classes}`}>
                                                     {badge.label}
                                                 </span>
                                                 {account.isPrimary && (
                                                     <span className="text-[9px] bg-surface-2 text-fg-muted px-1 rounded border border-line">
                                                         Principal
                                                     </span>
                                                 )}
                                             </div>
                                             <div className="flex items-center gap-2 text-[11px] font-mono text-fg-muted leading-tight mt-0.5">
                                                 <span>{account.broker}</span>
                                                 <span>•</span>
                                                 <span className={`font-semibold ${(account.netPnl || 0) >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                                     {(account.netPnl || 0) >= 0 ? '+' : ''}{formatMoney(account.netPnl || 0, account.currency)}
                                                 </span>
                                             </div>
                                         </div>
                                     </div>

                                     {isSelected && (
                                         <Check size={16} className="text-accent-fg flex-shrink-0 ml-2" />
                                     )}
                                 </button>
                             );
                         })}

                         {activeAccounts.length === 0 && (
                             <div className="text-center py-4 text-xs text-fg-subtle">
                                 Nenhuma conta cadastrada
                             </div>
                         )}
                     </div>

                     {/* Divisor */}
                     <div className="border-t border-line" />

                     {/* Ações Especiais */}
                     <div className="p-1.5 space-y-1 bg-canvas-subtle/60">
                         {/* Opção Todas as Contas */}
                         <button
                             onClick={() => {
                                 selectAccount('all');
                                 setIsOpen(false);
                             }}
                             className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                                 isConsolidated 
                                     ? 'bg-indigo-500/10 border border-indigo-500/30 text-indigo-300' 
                                     : 'hover:bg-surface-2/60 text-fg-muted hover:text-fg border border-transparent'
                             }`}
                         >
                             <div className="flex items-center gap-2.5">
                                 <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                                     <Layers size={15} />
                                 </div>
                                 <div className="flex flex-col">
                                     <span className="text-xs font-semibold leading-tight">
                                         Todas as contas
                                     </span>
                                     <span className="text-[10px] text-fg-subtle leading-tight mt-0.5">
                                         Visão Consolidada Geral
                                     </span>
                                 </div>
                             </div>
                             {isConsolidated && (
                                 <Check size={16} className="text-indigo-400 flex-shrink-0" />
                             )}
                         </button>

                         {/* Botão Adicionar Conta (Oculto se usuário já tiver 3 contas) */}
                         {canCreateAccount && (
                             <button
                                 onClick={() => {
                                     setIsOpen(false);
                                     openCreateModal();
                                 }}
                                 className="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-xs font-medium text-accent-fg hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors"
                             >
                                 <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-accent-fg">
                                     <Plus size={15} />
                                 </div>
                                 <span>Adicionar conta</span>
                             </button>
                         )}
                         <button
                             onClick={() => {
                                 setIsOpen(false);
                                 openManageModal('accounts');
                             }}
                             className="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-xs font-medium text-fg-muted hover:bg-surface-2/60 hover:text-fg transition-colors"
                         >
                             <div className="w-8 h-8 rounded-lg bg-surface-2 border border-line flex items-center justify-center text-fg-muted">
                                 <Settings2 size={15} />
                             </div>
                             <span>Gerenciar contas</span>
                         </button>
                     </div>
                </div>
            )}
        </div>
    );
};
