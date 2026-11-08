import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount, TradingAccount, AccountType } from '../context/AccountContext';
import api from '../api';
import { 
    Briefcase, 
    Check, 
    Plus,
    Copy, 
    RefreshCw, 
    Trash2, 
    Archive, 
    RotateCcw, 
    Edit3, 
    KeyRound, 
    AlertCircle, 
    Layers, 
    CheckCircle2, 
    X,
    Shield
} from 'lucide-react';

export const Profile: React.FC = () => {
    const { user, updateUser } = useAuth();
    const {
        accounts,
        selectedAccountId,
        isConsolidated,
        selectAccount,
        createAccount,
        updateAccount,
        setPrimaryAccount,
        archiveAccount,
        restoreAccount,
        deleteAccount,
        regenerateToken,
        canCreateAccount,
        isLoading: isLoadingAccounts
    } = useAccount();

    const [showArchived, setShowArchived] = useState(false);
    const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
    const [visibleTokenId, setVisibleTokenId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Profile Edit State
    const [isEditingUsername, setIsEditingUsername] = useState(false);
    const [usernameInput, setUsernameInput] = useState(user?.username || '');
    const [isSavingProfile, setIsSavingProfile] = useState(false);

    // Modal state for Create / Edit Trading Account
    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<TradingAccount | null>(null);
    const [accountForm, setAccountForm] = useState({
        name: '',
        broker: 'MetaTrader 5',
        type: 'live' as AccountType,
        currency: 'USD',
        profitTarget: 0,
        dailyLossLimit: 0,
        maxDrawdown: 0
    });

    useEffect(() => {
        if (user?.username) {
            setUsernameInput(user.username);
        }
    }, [user]);

    const formatMoney = (val: number, currency = 'USD') => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(val || 0);
    };

    const handleCopyToken = (accountId: string, token: string) => {
        navigator.clipboard.writeText(token);
        setCopiedTokenId(accountId);
        setTimeout(() => setCopiedTokenId(null), 2500);
    };

    const handleRegenerateToken = async (accountId: string) => {
        if (window.confirm('Tem certeza que deseja gerar um novo token EA para esta conta? Seus EAs precisarão ser atualizados com o novo token.')) {
            try {
                await regenerateToken(accountId);
                setSuccessMessage('Token EA regenerado com sucesso!');
                setTimeout(() => setSuccessMessage(null), 3500);
            } catch (err: any) {
                setErrorMessage(err.response?.data?.message || 'Erro ao regenerar token');
                setTimeout(() => setErrorMessage(null), 4000);
            }
        }
    };

    const openCreateAccount = () => {
        if (!canCreateAccount) return;
        setEditingAccount(null);
        setAccountForm({
            name: '',
            broker: 'MetaTrader 5',
            type: 'live',
            currency: 'USD',
            profitTarget: 0,
            dailyLossLimit: 0,
            maxDrawdown: 0
        });
        setErrorMessage(null);
        setIsAccountModalOpen(true);
    };

    const openEditAccount = (acc: TradingAccount) => {
        setEditingAccount(acc);
        setAccountForm({
            name: acc.name,
            broker: acc.broker,
            type: acc.type,
            currency: acc.currency,
            profitTarget: acc.propFirmRules?.profitTarget || 0,
            dailyLossLimit: acc.propFirmRules?.dailyLossLimit || 0,
            maxDrawdown: acc.propFirmRules?.maxDrawdown || 0
        });
        setErrorMessage(null);
        setIsAccountModalOpen(true);
    };

    const handleSubmitAccount = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage(null);
        setSuccessMessage(null);

        if (!editingAccount && !canCreateAccount) {
            return;
        }

        if (!accountForm.name.trim()) {
            setErrorMessage('Por favor, informe o nome da conta.');
            return;
        }

        setIsSubmitting(true);
        try {
            const isPropFirm = ['prop_firm', 'challenge', 'funded'].includes(accountForm.type);
            const propFirmRules = isPropFirm ? {
                profitTarget: Number(accountForm.profitTarget) || 0,
                dailyLossLimit: Number(accountForm.dailyLossLimit) || 0,
                maxDrawdown: Number(accountForm.maxDrawdown) || 0
            } : undefined;

            if (editingAccount) {
                await updateAccount(editingAccount.id, {
                    name: accountForm.name.trim(),
                    broker: accountForm.broker.trim(),
                    type: accountForm.type,
                    currency: accountForm.currency,
                    propFirmRules
                });
                setSuccessMessage('Conta atualizada com sucesso!');
            } else if (canCreateAccount) {
                await createAccount({
                    name: accountForm.name.trim(),
                    broker: accountForm.broker.trim(),
                    type: accountForm.type,
                    currency: accountForm.currency,
                    propFirmRules
                });
                setSuccessMessage('Nova conta criada e definida como ativa com sucesso!');
            }

            setIsAccountModalOpen(false);
            setTimeout(() => setSuccessMessage(null), 3500);
        } catch (err: any) {
            setErrorMessage(err.response?.data?.message || 'Erro ao salvar conta.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteAccount = async (account: TradingAccount) => {
        const confirmMsg = `Tem certeza que deseja excluir a conta "${account.name}"?`;
        if (window.confirm(confirmMsg)) {
            try {
                await deleteAccount(account.id, false);
                setSuccessMessage(`Conta "${account.name}" excluída com sucesso.`);
                setTimeout(() => setSuccessMessage(null), 3000);
            } catch (err: any) {
                if (window.confirm(`${err.response?.data?.message || err.message}\nDeseja forçar a exclusão permanente de todos os dados desta conta?`)) {
                    await deleteAccount(account.id, true);
                    setSuccessMessage(`Conta "${account.name}" excluída permanentemente.`);
                    setTimeout(() => setSuccessMessage(null), 3000);
                }
            }
        }
    };

    const handleSaveUsername = async () => {
        if (!usernameInput.trim()) return;
        setIsSavingProfile(true);
        try {
            await api.put('/auth/profile', { username: usernameInput.trim() });
            if (updateUser) {
                updateUser({ username: usernameInput.trim() });
            }
            setIsEditingUsername(false);
            setSuccessMessage('Nome de usuário atualizado com sucesso!');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: any) {
            setErrorMessage(err.response?.data?.message || 'Erro ao atualizar perfil.');
            setTimeout(() => setErrorMessage(null), 3500);
        } finally {
            setIsSavingProfile(false);
        }
    };

    const filteredAccounts = accounts.filter(a => showArchived ? a.isArchived : !a.isArchived);

    // Consolidated metrics calculation from real trade stats
    const totalConsolidatedTrades = accounts.reduce((sum, a) => sum + (a.tradesCount || 0), 0);
    const totalConsolidatedPnl = accounts.reduce((sum, a) => sum + (a.netPnl || 0), 0);
    const totalWinsEstimated = accounts.reduce((sum, a) => {
        const count = a.tradesCount || 0;
        const rate = (a.winRate || 0) / 100;
        return sum + Math.round(count * rate);
    }, 0);
    const consolidatedWinRate = totalConsolidatedTrades > 0 ? (totalWinsEstimated / totalConsolidatedTrades) * 100 : 0;

    const initials = user?.username
        ? user.username.substring(0, 2).toUpperCase()
        : 'TR';

    return (
        <div className="space-y-8 animate-in fade-in duration-300 pb-16">
            {/* Feedback Alerts */}
            {successMessage && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-accent-fg text-sm flex items-center justify-between shadow-lg">
                    <div className="flex items-center gap-2.5">
                        <CheckCircle2 size={18} />
                        <span>{successMessage}</span>
                    </div>
                    <button onClick={() => setSuccessMessage(null)} className="text-emerald-400/80 hover:text-emerald-300">
                        <X size={16} />
                    </button>
                </div>
            )}

            {errorMessage && (
                <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-danger-fg text-sm flex items-center justify-between shadow-lg">
                    <div className="flex items-center gap-2.5">
                        <AlertCircle size={18} />
                        <span>{errorMessage}</span>
                    </div>
                    <button onClick={() => setErrorMessage(null)} className="text-rose-400/80 hover:text-rose-300">
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Perfil do Usuário Card */}
            <div className="p-6 md:p-8 rounded-3xl bg-surface/80 border border-line shadow-xl relative overflow-hidden backdrop-blur-md">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
                    <div className="flex items-center gap-5">
                        <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-emerald-500 text-white font-black text-2xl flex items-center justify-center shadow-xl shadow-indigo-500/20 border border-indigo-400/30 shrink-0">
                            {user?.avatarUrl ? (
                                <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover rounded-2xl" />
                            ) : (
                                <span>{initials}</span>
                            )}
                        </div>

                        <div className="space-y-1">
                            <div className="flex items-center gap-3">
                                {isEditingUsername ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={usernameInput}
                                            onChange={(e) => setUsernameInput(e.target.value)}
                                            className="px-3 py-1 rounded-lg bg-surface-2 border border-line-strong text-sm font-bold text-fg focus:outline-none focus:border-emerald-500"
                                            autoFocus
                                        />
                                        <button
                                            onClick={handleSaveUsername}
                                            disabled={isSavingProfile}
                                            className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-xs font-bold text-white transition-colors"
                                        >
                                            Salvar
                                        </button>
                                        <button
                                            onClick={() => setIsEditingUsername(false)}
                                            className="p-1 text-fg-muted hover:text-fg"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <h1 className="text-2xl font-bold text-fg tracking-tight">
                                            {user?.username || 'Trader'}
                                        </h1>
                                        <button
                                            onClick={() => setIsEditingUsername(true)}
                                            className="p-1 rounded text-fg-muted hover:text-fg transition-colors"
                                            title="Editar nome"
                                        >
                                            <Edit3 size={15} />
                                        </button>
                                    </div>
                                )}

                                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 uppercase tracking-wide">
                                    Plano {user?.tier || 'PRO'}
                                </span>
                            </div>

                            <p className="text-xs text-fg-muted flex items-center gap-2">
                                <span>{user?.email || 'email@exemplo.com'}</span>
                                <span>•</span>
                                <span className="text-accent-fg font-medium">Conta Ativa</span>
                            </p>
                        </div>
                    </div>

                    {/* Botão Nova Conta de Trading (Oculto se usuário já tiver 3 contas) */}
                    {canCreateAccount && (
                        <div className="flex items-center gap-3 w-full md:w-auto">
                            <button
                                onClick={openCreateAccount}
                                className="flex-1 md:flex-initial flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-500/20 active:scale-98 transition-all"
                            >
                                <Plus size={16} />
                                <span>Nova Conta de Trading</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* SEÇÃO: CONTAS DE TRADING */}
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-accent-fg">
                                <Briefcase size={16} />
                            </div>
                            <h2 className="text-xl font-bold text-fg">Contas de Trading</h2>
                        </div>
                        <p className="text-xs text-fg-muted mt-1">
                            Clique em qualquer conta para torná-la ativa. Todas as métricas refletem exclusivamente o resultado real dos seus trades.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                        <button
                            onClick={() => setShowArchived(!showArchived)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors border ${
                                showArchived 
                                    ? 'bg-surface-2 text-fg border-line-strong' 
                                    : 'text-fg-muted hover:text-fg border-transparent hover:bg-surface-2/40'
                            }`}
                        >
                            {showArchived ? 'Ocultar Arquivadas' : 'Ver Arquivadas'}
                        </button>
                    </div>
                </div>

                {/* CARD: VISÃO CONSOLIDADA (TODAS AS CONTAS) */}
                <div
                    onClick={() => selectAccount('all')}
                    className={`cursor-pointer p-5 rounded-2xl border transition-all relative overflow-hidden group ${
                        isConsolidated
                            ? 'bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border-indigo-500 shadow-xl shadow-indigo-500/10'
                            : 'bg-surface/60 border-line hover:border-line-strong'
                    }`}
                >
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                                isConsolidated 
                                    ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30' 
                                    : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-105'
                            }`}>
                                <Layers size={20} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-fg text-base">Todas as Contas (Visão Consolidada)</h3>
                                    {isConsolidated && (
                                        <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                            <Check size={10} />
                                            SELEÇÃO ATIVA
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-fg-muted mt-0.5">
                                    Exibe os resultados agregados de todas as {accounts.length} contas de trading combinadas
                                </p>
                            </div>
                        </div>

                        {/* Estatísticas Reais Consolidadas */}
                        <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end pt-3 md:pt-0 border-t md:border-t-0 border-line">
                            <div>
                                <span className="text-[10px] text-fg-muted uppercase tracking-wider block">Lucro Líquido dos Trades</span>
                                <span className={`text-base font-bold font-mono ${totalConsolidatedPnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                    {totalConsolidatedPnl >= 0 ? '+' : ''}{formatMoney(totalConsolidatedPnl)}
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] text-fg-muted uppercase tracking-wider block">Taxa de Acerto</span>
                                <span className="text-base font-bold font-mono text-fg">
                                    {consolidatedWinRate.toFixed(1)}%
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] text-fg-muted uppercase tracking-wider block">Total Operações</span>
                                <span className="text-base font-bold font-mono text-fg">
                                    {totalConsolidatedTrades}
                                </span>
                            </div>
                            <div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        selectAccount('all');
                                    }}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                        isConsolidated
                                            ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                                            : 'bg-surface-2 hover:bg-surface-3 text-fg/80'
                                    }`}
                                >
                                    {isConsolidated ? 'Ativa' : 'Selecionar'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* GRID DE CONTAS INDIVIDUAIS */}
                {isLoadingAccounts ? (
                    <div className="py-12 flex items-center justify-center">
                        <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : filteredAccounts.length === 0 ? (
                    <div className="p-12 text-center rounded-3xl bg-surface/40 border border-line">
                        <Briefcase size={36} className="mx-auto text-slate-600 mb-3" />
                        <h3 className="text-base font-bold text-fg/80">Nenhuma conta encontrada</h3>
                        <p className="text-xs text-fg-subtle max-w-sm mx-auto mt-1">
                            {canCreateAccount ? 'Crie sua primeira conta de trading para registrar operações e conectar ao MetaTrader 5.' : 'Nenhuma conta de trading ativa disponível.'}
                        </p>
                        {canCreateAccount && (
                            <button
                                onClick={openCreateAccount}
                                className="mt-4 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-xs font-bold text-white transition-colors"
                            >
                                + Criar Conta
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {filteredAccounts.map(account => {
                            const isSelected = selectedAccountId === account.id;
                            const isPropFirm = ['prop_firm', 'challenge', 'funded'].includes(account.type);
                            const netPnl = account.netPnl || 0;
                            const tradesCount = account.tradesCount || 0;
                            const winRate = account.winRate || 0;
                            const isTokenVisible = visibleTokenId === account.id;

                            return (
                                <div
                                    key={account.id}
                                    onClick={() => selectAccount(account.id)}
                                    className={`p-5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden ${
                                        isSelected
                                            ? 'bg-surface/90 border-emerald-500 shadow-xl shadow-emerald-500/10 ring-1 ring-emerald-500/30'
                                            : 'bg-surface/50 border-line hover:border-line-strong'
                                    }`}
                                >
                                    <div>
                                        {/* Top Header Card */}
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="font-bold text-fg text-base truncate">
                                                        {account.name}
                                                    </h3>
                                                    {account.mt5Id && (
                                                        <span className="text-[10px] font-mono bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded-md font-bold shrink-0">
                                                            MT5 #{account.mt5Id}
                                                        </span>
                                                    )}
                                                    {account.isPrimary && (
                                                        <span className="text-[9px] bg-emerald-500/20 text-accent-fg border border-emerald-500/30 px-1.5 py-0.5 rounded-full font-bold uppercase shrink-0">
                                                            Principal
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-fg-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
                                                    <span>{account.broker}</span>
                                                    <span>•</span>
                                                    <span>{account.currency}</span>
                                                    {(account.mt5Id || Number(account.balance) > 0) && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="font-mono text-fg font-semibold">
                                                                Saldo: {formatMoney(Number(account.balance) || 0, account.currency)}
                                                            </span>
                                                        </>
                                                    )}
                                                </p>
                                            </div>

                                            <div className="flex flex-col items-end gap-1 shrink-0">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                                    isPropFirm 
                                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' 
                                                        : account.type === 'demo'
                                                        ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                                                        : 'bg-emerald-500/10 text-accent-fg border-emerald-500/30'
                                                }`}>
                                                    {account.type.toUpperCase()}
                                                </span>

                                                {account.isConnected && (
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-accent-fg border border-emerald-500/30">
                                                        MT5 ONLINE
                                                    </span>
                                                )}

                                                {isSelected && (
                                                    <span className="text-[10px] font-bold text-accent-fg flex items-center gap-1">
                                                        <Check size={12} />
                                                        ATIVA
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Métricas Reais do Trading (Zero Saldo Inexistente) */}
                                        <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-canvas/70 border border-line my-3.5">
                                            <div>
                                                <span className="text-[9px] text-fg-subtle uppercase tracking-wider block">Lucro Líquido</span>
                                                <span className={`font-mono font-bold text-xs sm:text-sm block truncate ${netPnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'}`}>
                                                    {netPnl >= 0 ? '+' : ''}{formatMoney(netPnl, account.currency)}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-[9px] text-fg-subtle uppercase tracking-wider block">Win Rate</span>
                                                <span className="font-mono font-bold text-xs sm:text-sm text-fg block">
                                                    {winRate.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-[9px] text-fg-subtle uppercase tracking-wider block">Trades</span>
                                                <span className="font-mono font-bold text-xs sm:text-sm text-fg block">
                                                    {tradesCount}
                                                </span>
                                            </div>
                                        </div>

                                        {/* MT5 EA Token Container */}
                                        <div
                                            onClick={(e) => e.stopPropagation()}
                                            className="p-2.5 rounded-xl bg-canvas/40 border border-line mb-3.5"
                                        >
                                            <div className="flex items-center justify-between text-[11px] text-fg-muted mb-1">
                                                <span className="flex items-center gap-1 font-medium">
                                                    <KeyRound size={12} className="text-indigo-400" />
                                                    Token EA (MT5):
                                                </span>
                                                <button
                                                    onClick={() => setVisibleTokenId(isTokenVisible ? null : account.id)}
                                                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium"
                                                >
                                                    {isTokenVisible ? 'Ocultar' : 'Mostrar'}
                                                </button>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <code className="text-[10px] font-mono text-fg/80 truncate select-all">
                                                    {isTokenVisible ? account.appToken : '••••••••••••••••••••••••'}
                                                </code>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        onClick={() => handleCopyToken(account.id, account.appToken)}
                                                        className="p-1 rounded-lg bg-surface-2 hover:bg-surface-3 text-fg/80 hover:text-fg transition-colors"
                                                        title="Copiar Token MT5"
                                                    >
                                                        {copiedTokenId === account.id ? <Check size={12} className="text-accent-fg" /> : <Copy size={12} />}
                                                    </button>
                                                    <button
                                                        onClick={() => handleRegenerateToken(account.id)}
                                                        className="p-1 rounded-lg bg-surface-2 hover:bg-surface-3 text-fg/80 hover:text-fg transition-colors"
                                                        title="Regenerar Token MT5"
                                                    >
                                                        <RefreshCw size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Footer Actions */}
                                    <div 
                                        onClick={(e) => e.stopPropagation()} 
                                        className="pt-3 border-t border-line flex items-center justify-between gap-2 text-xs"
                                    >
                                        <div className="flex items-center gap-2">
                                            {!account.isPrimary && !account.isArchived && (
                                                <button
                                                    onClick={() => setPrimaryAccount(account.id)}
                                                    className="text-fg-muted hover:text-accent-fg text-[11px] font-medium transition-colors"
                                                >
                                                    Tornar Principal
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <button
                                                onClick={() => openEditAccount(account)}
                                                className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                                title="Editar Informações da Conta"
                                            >
                                                <Edit3 size={14} />
                                            </button>

                                            {account.isArchived ? (
                                                <button
                                                    onClick={() => restoreAccount(account.id)}
                                                    className="p-1.5 rounded-lg text-accent-fg hover:bg-emerald-500/10 transition-colors"
                                                    title="Restaurar Conta"
                                                >
                                                    <RotateCcw size={14} />
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => archiveAccount(account.id)}
                                                    className="p-1.5 rounded-lg text-fg-muted hover:text-amber-400 hover:bg-surface-2 transition-colors"
                                                    title="Arquivar Conta"
                                                >
                                                    <Archive size={14} />
                                                </button>
                                            )}

                                            <button
                                                onClick={() => handleDeleteAccount(account)}
                                                className="p-1.5 rounded-lg text-fg-muted hover:text-danger-fg hover:bg-rose-500/10 transition-colors"
                                                title="Excluir Conta"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* MODAL: CRIAR / EDITAR CONTA DE TRADING */}
            {isAccountModalOpen && (editingAccount || canCreateAccount) && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-canvas/80 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="relative w-full max-w-lg rounded-3xl bg-surface border border-line shadow-2xl overflow-hidden">
                        {/* Header */}
                        <div className="p-6 border-b border-line flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-accent-fg">
                                    <Briefcase size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-fg">
                                        {editingAccount ? 'Editar Conta de Trading' : 'Nova Conta de Trading'}
                                    </h3>
                                    <p className="text-xs text-fg-muted">
                                        Configure as informações de identificação e conexão da sua conta
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsAccountModalOpen(false)}
                                className="p-2 text-fg-muted hover:text-fg rounded-lg hover:bg-surface-2 transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmitAccount} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-fg/80 mb-1.5">
                                    Nome da Conta *
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Ex: FTMO $100K, Exness Live, IC Markets Scalp"
                                    value={accountForm.name}
                                    onChange={e => setAccountForm({ ...accountForm, name: e.target.value })}
                                    className="w-full px-4 py-2.5 rounded-xl bg-canvas border border-line text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-fg/80 mb-1.5">
                                        Corretora / Broker *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="Ex: MetaTrader 5, Exness, FTMO"
                                        value={accountForm.broker}
                                        onChange={e => setAccountForm({ ...accountForm, broker: e.target.value })}
                                        className="w-full px-4 py-2.5 rounded-xl bg-canvas border border-line text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-emerald-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-fg/80 mb-1.5">
                                        Moeda Base *
                                    </label>
                                    <select
                                        value={accountForm.currency}
                                        onChange={e => setAccountForm({ ...accountForm, currency: e.target.value })}
                                        className="w-full px-4 py-2.5 rounded-xl bg-canvas border border-line text-sm text-fg focus:outline-none focus:border-emerald-500"
                                    >
                                        <option value="USD">USD ($)</option>
                                        <option value="EUR">EUR (€)</option>
                                        <option value="GBP">GBP (£)</option>
                                        <option value="BRL">BRL (R$)</option>
                                        <option value="JPY">JPY (¥)</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-fg/80 mb-1.5">
                                    Tipo de Conta *
                                </label>
                                <select
                                    value={accountForm.type}
                                    onChange={e => setAccountForm({ ...accountForm, type: e.target.value as AccountType })}
                                    className="w-full px-4 py-2.5 rounded-xl bg-canvas border border-line text-sm text-fg focus:outline-none focus:border-emerald-500"
                                >
                                    <option value="live">Live (Conta Real)</option>
                                    <option value="demo">Demo (Demonstrativa)</option>
                                    <option value="prop_firm">Prop Firm (Mesa Proprietária)</option>
                                    <option value="challenge">Challenge (Desafio / Avaliação)</option>
                                    <option value="funded">Funded (Conta Financiada)</option>
                                    <option value="custom">Personalizada</option>
                                </select>
                            </div>

                            {/* Regras Opcionais de Prop Firm */}
                            {['prop_firm', 'challenge', 'funded'].includes(accountForm.type) && (
                                <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                                        <Shield size={14} />
                                        <span>Metas & Limites da Prop Firm</span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-[10px] text-fg-muted mb-1">Meta Lucro (%)</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.5"
                                                value={accountForm.profitTarget || ''}
                                                onChange={e => setAccountForm({ ...accountForm, profitTarget: parseFloat(e.target.value) || 0 })}
                                                placeholder="10"
                                                className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-xs text-fg focus:outline-none focus:border-amber-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-[10px] text-fg-muted mb-1">Limite Perda/Dia (%)</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.5"
                                                value={accountForm.dailyLossLimit || ''}
                                                onChange={e => setAccountForm({ ...accountForm, dailyLossLimit: parseFloat(e.target.value) || 0 })}
                                                placeholder="5"
                                                className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-xs text-fg focus:outline-none focus:border-amber-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-[10px] text-fg-muted mb-1">Max Drawdown (%)</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.5"
                                                value={accountForm.maxDrawdown || ''}
                                                onChange={e => setAccountForm({ ...accountForm, maxDrawdown: parseFloat(e.target.value) || 0 })}
                                                placeholder="10"
                                                className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-xs text-fg focus:outline-none focus:border-amber-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="pt-4 flex items-center justify-end gap-3 border-t border-line">
                                <button
                                    type="button"
                                    onClick={() => setIsAccountModalOpen(false)}
                                    className="px-4 py-2.5 rounded-xl bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-fg/80 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2"
                                >
                                    {isSubmitting ? (
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <Check size={14} />
                                    )}
                                    <span>{editingAccount ? 'Salvar Alterações' : 'Criar Conta'}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
