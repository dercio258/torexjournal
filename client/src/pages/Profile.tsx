import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount, TradingAccount, AccountType } from '../context/AccountContext';
import { useLocale } from '../context/LocaleContext';
import { updateUserProfileOfflineAware } from '../services/offlineMutations';
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
    Shield,
} from 'lucide-react';

export const Profile: React.FC = () => {
    const { user, updateUser } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
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
        isLoading: isLoadingAccounts,
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
        maxDrawdown: 0,
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
            maximumFractionDigits: 2,
        }).format(val || 0);
    };

    const handleCopyToken = (accountId: string, token: string) => {
        navigator.clipboard.writeText(token);
        setCopiedTokenId(accountId);
        setTimeout(() => setCopiedTokenId(null), 2500);
    };

    const handleRegenerateToken = async (accountId: string) => {
        if (
            window.confirm(
                isEn
                    ? 'Are you sure you want to generate a new EA token for this account? Your EAs will need to be updated with the new token.'
                    : 'Tem certeza que deseja gerar um novo token EA para esta conta? Seus EAs precisarão ser atualizados com o novo token.'
            )
        ) {
            try {
                await regenerateToken(accountId);
                setSuccessMessage(isEn ? 'EA token regenerated successfully!' : 'Token EA regenerado com sucesso!');
                setTimeout(() => setSuccessMessage(null), 3500);
            } catch (err: any) {
                setErrorMessage(err.response?.data?.message || (isEn ? 'Failed to regenerate token' : 'Erro ao regenerar token'));
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
            maxDrawdown: 0,
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
            maxDrawdown: acc.propFirmRules?.maxDrawdown || 0,
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
            setErrorMessage(isEn ? 'Please enter an account name.' : 'Por favor, informe o nome da conta.');
            return;
        }

        setIsSubmitting(true);
        try {
            const isPropFirm = ['prop_firm', 'challenge', 'funded'].includes(accountForm.type);
            const propFirmRules = isPropFirm
                ? {
                      profitTarget: Number(accountForm.profitTarget) || 0,
                      dailyLossLimit: Number(accountForm.dailyLossLimit) || 0,
                      maxDrawdown: Number(accountForm.maxDrawdown) || 0,
                  }
                : undefined;

            if (editingAccount) {
                await updateAccount(editingAccount.id, {
                    name: accountForm.name.trim(),
                    broker: accountForm.broker.trim(),
                    type: accountForm.type,
                    currency: accountForm.currency,
                    propFirmRules,
                });
                setSuccessMessage(isEn ? 'Account updated successfully!' : 'Conta atualizada com sucesso!');
            } else if (canCreateAccount) {
                await createAccount({
                    name: accountForm.name.trim(),
                    broker: accountForm.broker.trim(),
                    type: accountForm.type,
                    currency: accountForm.currency,
                    propFirmRules,
                });
                setSuccessMessage(
                    isEn
                        ? 'New account created and set as active!'
                        : 'Nova conta criada e definida como ativa com sucesso!'
                );
            }

            setIsAccountModalOpen(false);
            setTimeout(() => setSuccessMessage(null), 3500);
        } catch (err: any) {
            setErrorMessage(err.response?.data?.message || (isEn ? 'Failed to save account.' : 'Erro ao salvar conta.'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteAccount = async (account: TradingAccount) => {
        const confirmMsg = isEn
            ? `Are you sure you want to delete account "${account.name}"?`
            : `Tem certeza que deseja excluir a conta "${account.name}"?`;
        if (window.confirm(confirmMsg)) {
            try {
                await deleteAccount(account.id, false);
                setSuccessMessage(
                    isEn ? `Account "${account.name}" deleted successfully.` : `Conta "${account.name}" excluída com sucesso.`
                );
                setTimeout(() => setSuccessMessage(null), 3000);
            } catch (err: any) {
                if (
                    window.confirm(
                        isEn
                            ? `${err.response?.data?.message || err.message}\nDo you want to force permanent deletion of all data in this account?`
                            : `${err.response?.data?.message || err.message}\nDeseja forçar a exclusão permanente de todos os dados desta conta?`
                    )
                ) {
                    await deleteAccount(account.id, true);
                    setSuccessMessage(
                        isEn ? `Account "${account.name}" permanently deleted.` : `Conta "${account.name}" excluída permanentemente.`
                    );
                    setTimeout(() => setSuccessMessage(null), 3000);
                }
            }
        }
    };

    const handleSaveUsername = async () => {
        if (!usernameInput.trim()) return;
        setIsSavingProfile(true);
        try {
            await updateUserProfileOfflineAware({ username: usernameInput.trim() });
            if (updateUser) {
                updateUser({ username: usernameInput.trim() });
            }
            setIsEditingUsername(false);
            setSuccessMessage(isEn ? 'Username updated successfully!' : 'Nome de usuário atualizado com sucesso!');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: any) {
            setErrorMessage(err.response?.data?.message || (isEn ? 'Failed to update profile.' : 'Erro ao atualizar perfil.'));
            setTimeout(() => setErrorMessage(null), 3500);
        } finally {
            setIsSavingProfile(false);
        }
    };

    const filteredAccounts = accounts.filter((a) => (showArchived ? a.isArchived : !a.isArchived));

    // Consolidated metrics calculation from real trade stats
    const totalConsolidatedTrades = accounts.reduce((sum, a) => sum + (a.tradesCount || 0), 0);
    const totalConsolidatedPnl = accounts.reduce((sum, a) => sum + (a.netPnl || 0), 0);
    const totalWinsEstimated = accounts.reduce((sum, a) => {
        const count = a.tradesCount || 0;
        const rate = (a.winRate || 0) / 100;
        return sum + Math.round(count * rate);
    }, 0);
    const consolidatedWinRate =
        totalConsolidatedTrades > 0 ? (totalWinsEstimated / totalConsolidatedTrades) * 100 : 0;

    const initials = user?.username ? user.username.substring(0, 2).toUpperCase() : 'TR';

    return (
        <div className="w-full space-y-4 pb-10">
            {/* Feedback Alerts */}
            {successMessage && (
                <div className="px-4 py-3 rounded-xl bg-accent/10 border border-accent/25 text-accent-fg text-xs sm:text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 size={16} />
                        <span>{successMessage}</span>
                    </div>
                    <button
                        onClick={() => setSuccessMessage(null)}
                        className="text-accent-fg/80 hover:text-accent-fg"
                    >
                        <X size={15} />
                    </button>
                </div>
            )}

            {errorMessage && (
                <div className="px-4 py-3 rounded-xl bg-danger/10 border border-danger/25 text-danger-fg text-xs sm:text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertCircle size={16} />
                        <span>{errorMessage}</span>
                    </div>
                    <button
                        onClick={() => setErrorMessage(null)}
                        className="text-danger-fg/80 hover:text-danger-fg"
                    >
                        <X size={15} />
                    </button>
                </div>
            )}

            {/* Perfil do Usuário Card */}
            <div className="p-4 sm:p-5 rounded-xl bg-surface border border-line flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-surface-2 border border-line-strong text-accent-fg font-bold text-lg flex items-center justify-center shrink-0 overflow-hidden">
                        {user?.avatarUrl ? (
                            <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                            <span>{initials}</span>
                        )}
                    </div>

                    <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            {isEditingUsername ? (
                                <div className="flex items-center gap-1.5">
                                    <input
                                        type="text"
                                        value={usernameInput}
                                        onChange={(e) => setUsernameInput(e.target.value)}
                                        className="h-8 px-2.5 rounded-lg bg-canvas-subtle border border-line-strong text-xs sm:text-sm font-semibold text-fg focus:outline-none focus:border-accent/60"
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleSaveUsername}
                                        disabled={isSavingProfile}
                                        className="h-8 px-3 rounded-lg bg-accent text-accent-on text-xs font-semibold hover:opacity-95 transition-opacity"
                                    >
                                        {isEn ? 'Save' : 'Salvar'}
                                    </button>
                                    <button
                                        onClick={() => setIsEditingUsername(false)}
                                        className="p-1.5 text-fg-muted hover:text-fg rounded-lg hover:bg-surface-2"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5">
                                    <h2 className="text-base sm:text-lg font-bold text-fg tracking-tight truncate">
                                        {user?.username || 'Trader'}
                                    </h2>
                                    <button
                                        onClick={() => setIsEditingUsername(true)}
                                        className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                        title={isEn ? 'Edit username' : 'Editar nome'}
                                    >
                                        <Edit3 size={13} />
                                    </button>
                                </div>
                            )}

                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-accent/10 text-accent-fg border border-accent/25 uppercase tracking-wider">
                                {isEn ? `${user?.tier || 'PRO'} Plan` : `Plano ${user?.tier || 'PRO'}`}
                            </span>
                        </div>

                        <p className="text-xs text-fg-muted flex flex-wrap items-center gap-1.5">
                            <span className="truncate">{user?.email || 'trader@example.com'}</span>
                            <span className="text-fg-subtle">•</span>
                            <span className="text-accent-fg font-medium">{isEn ? 'Active Account' : 'Conta Ativa'}</span>
                        </p>
                    </div>
                </div>

                {canCreateAccount && (
                    <button
                        onClick={openCreateAccount}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-accent hover:opacity-95 text-accent-on font-semibold text-xs transition-opacity shrink-0"
                    >
                        <Plus size={14} />
                        <span>{isEn ? 'New Trading Account' : 'Nova Conta de Trading'}</span>
                    </button>
                )}
            </div>

            {/* SEÇÃO: CONTAS DE TRADING */}
            <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-surface border border-line flex items-center justify-center text-accent-fg shrink-0">
                            <Briefcase size={14} />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-fg">
                                {isEn ? 'Trading Accounts' : 'Contas de Trading'}
                            </h2>
                            <p className="text-[11px] text-fg-muted">
                                {isEn
                                    ? 'Click any account to activate it across Dashboard and Analytics.'
                                    : 'Clique em uma conta para ativá-la no Dashboard e relatórios.'}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => setShowArchived(!showArchived)}
                        className={`self-end sm:self-auto h-8 px-3 rounded-lg text-xs font-semibold transition-colors border ${
                            showArchived
                                ? 'bg-surface-2 text-fg border-line-strong'
                                : 'bg-surface text-fg-muted hover:text-fg border-line hover:bg-surface-2'
                        }`}
                    >
                        {showArchived
                            ? (isEn ? 'Hide Archived' : 'Ocultar Arquivadas')
                            : (isEn ? 'View Archived' : 'Ver Arquivadas')}
                    </button>
                </div>

                {/* CARD: VISÃO CONSOLIDADA (TODAS AS CONTAS) */}
                <div
                    onClick={() => selectAccount('all')}
                    className={`cursor-pointer p-4 rounded-xl border transition-all group ${
                        isConsolidated
                            ? 'bg-surface border-accent/50'
                            : 'bg-surface border-line hover:border-line-strong'
                    }`}
                >
                    <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3.5">
                        <div className="flex items-center gap-3">
                            <div
                                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${
                                    isConsolidated
                                        ? 'bg-accent/15 text-accent-fg border-accent/30'
                                        : 'bg-canvas-subtle text-fg-muted border-line'
                                }`}
                            >
                                <Layers size={16} />
                            </div>
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="font-bold text-fg text-sm">
                                        {isEn ? 'All Accounts (Consolidated View)' : 'Todas as Contas (Visão Consolidada)'}
                                    </h3>
                                    {isConsolidated && (
                                        <span className="text-[10px] bg-accent/15 text-accent-fg border border-accent/30 px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-1">
                                            <Check size={10} />
                                            {isEn ? 'ACTIVE' : 'ATIVA'}
                                        </span>
                                    )}
                                </div>
                                <p className="text-[11px] text-fg-muted mt-0.5">
                                    {isEn
                                        ? `Aggregated performance across ${accounts.length} registered accounts`
                                        : `Resultados agregados das ${accounts.length} contas registradas`}
                                </p>
                            </div>
                        </div>

                        {/* Estatísticas Reais Consolidadas */}
                        <div className="flex flex-wrap items-center gap-5 w-full lg:w-auto justify-between lg:justify-end pt-3 lg:pt-0 border-t lg:border-t-0 border-line-subtle">
                            <div>
                                <span className="text-[10px] text-fg-subtle uppercase tracking-wider block">
                                    {isEn ? 'Net P&L' : 'Lucro Líquido'}
                                </span>
                                <span
                                    className={`text-sm font-bold font-mono tabular-nums ${
                                        totalConsolidatedPnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                                    }`}
                                >
                                    {totalConsolidatedPnl >= 0 ? '+' : ''}
                                    {formatMoney(totalConsolidatedPnl)}
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] text-fg-subtle uppercase tracking-wider block">
                                    Win Rate
                                </span>
                                <span className="text-sm font-bold font-mono tabular-nums text-fg">
                                    {consolidatedWinRate.toFixed(1)}%
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] text-fg-subtle uppercase tracking-wider block">
                                    {isEn ? 'Trades' : 'Operações'}
                                </span>
                                <span className="text-sm font-bold font-mono tabular-nums text-fg">
                                    {totalConsolidatedTrades}
                                </span>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    selectAccount('all');
                                }}
                                className={`h-8 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                                    isConsolidated
                                        ? 'bg-accent/15 text-accent-fg border-accent/30'
                                        : 'bg-canvas-subtle hover:bg-surface-2 text-fg border-line'
                                }`}
                            >
                                {isConsolidated ? (isEn ? 'Active' : 'Ativa') : (isEn ? 'Select' : 'Selecionar')}
                            </button>
                        </div>
                    </div>
                </div>

                {/* GRID DE CONTAS INDIVIDUAIS */}
                {isLoadingAccounts ? (
                    <div className="py-10 flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : filteredAccounts.length === 0 ? (
                    <div className="p-10 text-center rounded-xl bg-surface border border-line space-y-2">
                        <Briefcase size={28} className="mx-auto text-fg-subtle" />
                        <h3 className="text-sm font-bold text-fg">
                            {isEn ? 'No accounts found' : 'Nenhuma conta encontrada'}
                        </h3>
                        <p className="text-xs text-fg-muted max-w-sm mx-auto">
                            {canCreateAccount
                                ? isEn
                                    ? 'Create your first trading account to log executions and connect MetaTrader 5.'
                                    : 'Crie sua primeira conta de trading para registrar operações e conectar ao MetaTrader 5.'
                                : isEn
                                  ? 'No active trading accounts available.'
                                  : 'Nenhuma conta de trading ativa disponível.'}
                        </p>
                        {canCreateAccount && (
                            <button
                                onClick={openCreateAccount}
                                className="mt-2 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-accent text-accent-on text-xs font-semibold hover:opacity-95 transition-opacity"
                            >
                                <Plus size={13} />
                                <span>{isEn ? 'Create Account' : 'Criar Conta'}</span>
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {filteredAccounts.map((account) => {
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
                                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between group ${
                                        isSelected
                                            ? 'bg-surface border-accent/50'
                                            : 'bg-surface border-line hover:border-line-strong'
                                    }`}
                                >
                                    <div>
                                        {/* Top Header Card */}
                                        <div className="flex items-start justify-between gap-2 mb-2.5">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <h3 className="font-bold text-fg text-sm truncate">
                                                        {account.name}
                                                    </h3>
                                                    {account.mt5Id && (
                                                        <span className="text-[10px] font-mono bg-canvas-subtle text-fg-muted border border-line-subtle px-1.5 py-0.5 rounded font-semibold shrink-0">
                                                            #{account.mt5Id}
                                                        </span>
                                                    )}
                                                    {account.isPrimary && (
                                                        <span className="text-[9px] bg-accent/15 text-accent-fg border border-accent/25 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                                                            {isEn ? 'Primary' : 'Principal'}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[11px] text-fg-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
                                                    <span>{account.broker}</span>
                                                    <span className="text-fg-subtle">•</span>
                                                    <span>{account.currency}</span>
                                                    {(account.mt5Id || Number(account.balance) > 0) && (
                                                        <>
                                                            <span className="text-fg-subtle">•</span>
                                                            <span className="font-mono tabular-nums text-fg font-semibold">
                                                                {formatMoney(
                                                                    Number(account.balance) || 0,
                                                                    account.currency
                                                                )}
                                                            </span>
                                                        </>
                                                    )}
                                                </p>
                                            </div>

                                            <div className="flex flex-col items-end gap-1 shrink-0">
                                                <span
                                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                                                        isPropFirm
                                                            ? 'bg-warning/10 text-warning border-warning/25'
                                                            : account.type === 'demo'
                                                              ? 'bg-data-1/10 text-data-1 border-data-1/25'
                                                              : 'bg-accent/10 text-accent-fg border-accent/25'
                                                    }`}
                                                >
                                                    {account.type}
                                                </span>

                                                {account.isConnected && (
                                                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-accent/10 text-accent-fg border border-accent/25">
                                                        ONLINE
                                                    </span>
                                                )}

                                                {isSelected && (
                                                    <span className="text-[10px] font-bold text-accent-fg inline-flex items-center gap-1">
                                                        <Check size={11} />
                                                        {isEn ? 'ACTIVE' : 'ATIVA'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Métricas Reais do Trading */}
                                        <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-canvas-subtle border border-line-subtle my-3">
                                            <div>
                                                <span className="text-[9px] text-fg-subtle uppercase tracking-wider block">
                                                    {isEn ? 'Net P&L' : 'Lucro Líquido'}
                                                </span>
                                                <span
                                                    className={`font-mono tabular-nums font-bold text-xs block truncate ${
                                                        netPnl >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                                                    }`}
                                                >
                                                    {netPnl >= 0 ? '+' : ''}
                                                    {formatMoney(netPnl, account.currency)}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-[9px] text-fg-subtle uppercase tracking-wider block">
                                                    Win Rate
                                                </span>
                                                <span className="font-mono tabular-nums font-bold text-xs text-fg block">
                                                    {winRate.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-[9px] text-fg-subtle uppercase tracking-wider block">
                                                    Trades
                                                </span>
                                                <span className="font-mono tabular-nums font-bold text-xs text-fg block">
                                                    {tradesCount}
                                                </span>
                                            </div>
                                        </div>

                                        {/* MT5 EA Token Container */}
                                        <div
                                            onClick={(e) => e.stopPropagation()}
                                            className="p-2.5 rounded-lg bg-canvas-subtle border border-line-subtle mb-3"
                                        >
                                            <div className="flex items-center justify-between text-[10px] text-fg-muted mb-1">
                                                <span className="inline-flex items-center gap-1 font-medium">
                                                    <KeyRound size={11} className="text-fg-subtle" />
                                                    {isEn ? 'EA Token (MT5)' : 'Token EA (MT5)'}
                                                </span>
                                                <button
                                                    onClick={() =>
                                                        setVisibleTokenId(isTokenVisible ? null : account.id)
                                                    }
                                                    className="text-[10px] text-accent-fg hover:underline font-medium"
                                                >
                                                    {isTokenVisible ? (isEn ? 'Hide' : 'Ocultar') : (isEn ? 'Show' : 'Mostrar')}
                                                </button>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <code className="text-[10px] font-mono text-fg truncate select-all">
                                                    {isTokenVisible
                                                        ? account.appToken
                                                        : '••••••••••••••••••••••••'}
                                                </code>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        onClick={() =>
                                                            handleCopyToken(account.id, account.appToken)
                                                        }
                                                        className="p-1 rounded bg-surface-2 hover:bg-surface-3 text-fg-muted hover:text-fg border border-line-subtle transition-colors"
                                                        title={isEn ? 'Copy MT5 Token' : 'Copiar Token MT5'}
                                                    >
                                                        {copiedTokenId === account.id ? (
                                                            <Check size={11} className="text-accent-fg" />
                                                        ) : (
                                                            <Copy size={11} />
                                                        )}
                                                    </button>
                                                    <button
                                                        onClick={() => handleRegenerateToken(account.id)}
                                                        className="p-1 rounded bg-surface-2 hover:bg-surface-3 text-fg-muted hover:text-fg border border-line-subtle transition-colors"
                                                        title={isEn ? 'Regenerate MT5 Token' : 'Regenerar Token MT5'}
                                                    >
                                                        <RefreshCw size={11} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Footer Actions */}
                                    <div
                                        onClick={(e) => e.stopPropagation()}
                                        className="pt-2.5 border-t border-line-subtle flex items-center justify-between gap-2 text-xs"
                                    >
                                        <div className="flex items-center gap-2">
                                            {!account.isPrimary && !account.isArchived && (
                                                <button
                                                    onClick={() => setPrimaryAccount(account.id)}
                                                    className="text-fg-muted hover:text-accent-fg text-[11px] font-medium transition-colors"
                                                >
                                                    {isEn ? 'Set as Primary' : 'Tornar Principal'}
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => openEditAccount(account)}
                                                className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                                title={isEn ? 'Edit Account Info' : 'Editar Informações da Conta'}
                                            >
                                                <Edit3 size={13} />
                                            </button>

                                            {account.isArchived ? (
                                                <button
                                                    onClick={() => restoreAccount(account.id)}
                                                    className="p-1.5 rounded-lg text-accent-fg hover:bg-accent/10 transition-colors"
                                                    title={isEn ? 'Restore Account' : 'Restaurar Conta'}
                                                >
                                                    <RotateCcw size={13} />
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => archiveAccount(account.id)}
                                                    className="p-1.5 rounded-lg text-fg-muted hover:text-warning hover:bg-surface-2 transition-colors"
                                                    title={isEn ? 'Archive Account' : 'Arquivar Conta'}
                                                >
                                                    <Archive size={13} />
                                                </button>
                                            )}

                                            <button
                                                onClick={() => handleDeleteAccount(account)}
                                                className="p-1.5 rounded-lg text-fg-muted hover:text-danger-fg hover:bg-danger/10 transition-colors"
                                                title={isEn ? 'Delete Account' : 'Excluir Conta'}
                                            >
                                                <Trash2 size={13} />
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
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-canvas/80 backdrop-blur-sm">
                    <div className="relative w-full max-w-lg rounded-xl bg-surface border border-line shadow-2xl overflow-hidden">
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/25 flex items-center justify-center text-accent-fg">
                                    <Briefcase size={16} />
                                </div>
                                <div>
                                    <h3 className="text-sm sm:text-base font-bold text-fg">
                                        {editingAccount
                                            ? isEn
                                                ? 'Edit Trading Account'
                                                : 'Editar Conta de Trading'
                                            : isEn
                                              ? 'New Trading Account'
                                              : 'Nova Conta de Trading'}
                                    </h3>
                                    <p className="text-[11px] text-fg-muted">
                                        {isEn
                                            ? 'Configure identification, broker, and operational rules'
                                            : 'Configure identificação, corretora e regras operacionais'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsAccountModalOpen(false)}
                                className="p-1.5 text-fg-muted hover:text-fg rounded-lg hover:bg-surface-2 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmitAccount} className="p-5 space-y-3.5">
                            <div>
                                <label className="block text-[11px] font-semibold text-fg-muted mb-1">
                                    {isEn ? 'Account Name *' : 'Nome da Conta *'}
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder={isEn ? 'e.g. FTMO $100K, Exness Live, IC Markets Scalp' : 'Ex: FTMO $100K, Exness Live, IC Markets Scalp'}
                                    value={accountForm.name}
                                    onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                                    className="w-full h-9 px-3 rounded-lg bg-canvas-subtle border border-line text-xs sm:text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-accent/60"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[11px] font-semibold text-fg-muted mb-1">
                                        {isEn ? 'Broker / Firm *' : 'Corretora / Broker *'}
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder={isEn ? 'e.g. MetaTrader 5, Exness, FTMO' : 'Ex: MetaTrader 5, Exness, FTMO'}
                                        value={accountForm.broker}
                                        onChange={(e) =>
                                            setAccountForm({ ...accountForm, broker: e.target.value })
                                        }
                                        className="w-full h-9 px-3 rounded-lg bg-canvas-subtle border border-line text-xs sm:text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-accent/60"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[11px] font-semibold text-fg-muted mb-1">
                                        {isEn ? 'Base Currency *' : 'Moeda Base *'}
                                    </label>
                                    <select
                                        value={accountForm.currency}
                                        onChange={(e) =>
                                            setAccountForm({ ...accountForm, currency: e.target.value })
                                        }
                                        className="w-full h-9 px-3 rounded-lg bg-canvas-subtle border border-line text-xs sm:text-sm text-fg focus:outline-none focus:border-accent/60"
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
                                <label className="block text-[11px] font-semibold text-fg-muted mb-1">
                                    {isEn ? 'Account Type *' : 'Tipo de Conta *'}
                                </label>
                                <select
                                    value={accountForm.type}
                                    onChange={(e) =>
                                        setAccountForm({
                                            ...accountForm,
                                            type: e.target.value as AccountType,
                                        })
                                    }
                                    className="w-full h-9 px-3 rounded-lg bg-canvas-subtle border border-line text-xs sm:text-sm text-fg focus:outline-none focus:border-accent/60"
                                >
                                    <option value="live">{isEn ? 'Live (Real Account)' : 'Live (Conta Real)'}</option>
                                    <option value="demo">{isEn ? 'Demo (Practice)' : 'Demo (Demonstrativa)'}</option>
                                    <option value="prop_firm">Prop Firm</option>
                                    <option value="challenge">{isEn ? 'Challenge (Evaluation)' : 'Challenge (Desafio / Avaliação)'}</option>
                                    <option value="funded">{isEn ? 'Funded Account' : 'Funded (Conta Financiada)'}</option>
                                    <option value="custom">{isEn ? 'Custom' : 'Personalizada'}</option>
                                </select>
                            </div>

                            {/* Regras Opcionais de Prop Firm */}
                            {['prop_firm', 'challenge', 'funded'].includes(accountForm.type) && (
                                <div className="p-3.5 rounded-xl bg-warning/5 border border-warning/20 space-y-2.5">
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-warning">
                                        <Shield size={13} />
                                        <span>{isEn ? 'Prop Firm Targets & Guardrails' : 'Metas & Limites da Prop Firm'}</span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2.5">
                                        <div>
                                            <label className="block text-[10px] text-fg-muted mb-1">
                                                {isEn ? 'Profit Target (%)' : 'Meta Lucro (%)'}
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.5"
                                                value={accountForm.profitTarget || ''}
                                                onChange={(e) =>
                                                    setAccountForm({
                                                        ...accountForm,
                                                        profitTarget: parseFloat(e.target.value) || 0,
                                                    })
                                                }
                                                placeholder="10"
                                                className="w-full h-8 px-2.5 rounded-lg bg-canvas-subtle border border-line text-xs text-fg focus:outline-none focus:border-warning/60"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-[10px] text-fg-muted mb-1">
                                                {isEn ? 'Daily Loss (%)' : 'Perda/Dia (%)'}
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.5"
                                                value={accountForm.dailyLossLimit || ''}
                                                onChange={(e) =>
                                                    setAccountForm({
                                                        ...accountForm,
                                                        dailyLossLimit: parseFloat(e.target.value) || 0,
                                                    })
                                                }
                                                placeholder="5"
                                                className="w-full h-8 px-2.5 rounded-lg bg-canvas-subtle border border-line text-xs text-fg focus:outline-none focus:border-warning/60"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-[10px] text-fg-muted mb-1">
                                                Max DD (%)
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.5"
                                                value={accountForm.maxDrawdown || ''}
                                                onChange={(e) =>
                                                    setAccountForm({
                                                        ...accountForm,
                                                        maxDrawdown: parseFloat(e.target.value) || 0,
                                                    })
                                                }
                                                placeholder="10"
                                                className="w-full h-8 px-2.5 rounded-lg bg-canvas-subtle border border-line text-xs text-fg focus:outline-none focus:border-warning/60"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="pt-3 flex items-center justify-end gap-2 border-t border-line-subtle">
                                <button
                                    type="button"
                                    onClick={() => setIsAccountModalOpen(false)}
                                    className="h-9 px-3.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-xs font-semibold text-fg transition-colors"
                                >
                                    {isEn ? 'Cancel' : 'Cancelar'}
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="h-9 px-4 rounded-lg bg-accent hover:opacity-95 text-accent-on text-xs font-semibold transition-opacity inline-flex items-center gap-1.5"
                                >
                                    {isSubmitting ? (
                                        <div className="w-3.5 h-3.5 border-2 border-accent-on border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <Check size={14} />
                                    )}
                                    <span>
                                        {editingAccount
                                            ? isEn
                                                ? 'Save Changes'
                                                : 'Salvar Alterações'
                                            : isEn
                                              ? 'Create Account'
                                              : 'Criar Conta'}
                                    </span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
