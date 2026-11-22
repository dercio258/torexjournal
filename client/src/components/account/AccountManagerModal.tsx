import React, { useState, useEffect } from 'react';
import { useAccount, TradingAccount, AccountType } from '../../context/AccountContext';
import { useLocale } from '../../context/LocaleContext';
import { 
    X, 
    Briefcase, 
    Plus,
    Check, 
    Copy, 
    RefreshCw, 
    Trash2, 
    Archive, 
    RotateCcw, 
    Edit3, 
    Award, 
    AlertCircle, 
    KeyRound,
    Lock
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isBasicPlanTier, isRestrictedBasicBrokerName, openWorkspacePlansModal } from '../../lib/planGate';

export const AccountManagerModal: React.FC = () => {
    const { user } = useAuth();
    const isBasic = isBasicPlanTier(user?.tier);
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const {
        accounts,
        isManagerOpen,
        setIsManagerOpen,
        activeManagerTab,
        setActiveManagerTab,
        editingAccount,
        setEditingAccount,
        createAccount,
        updateAccount,
        setPrimaryAccount,
        archiveAccount,
        restoreAccount,
        deleteAccount,
        regenerateToken,
        selectedAccountId,
        canCreateAccount
    } = useAccount();

    const [showArchived, setShowArchived] = useState(false);
    const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
    const [visibleTokenId, setVisibleTokenId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Form state for Create / Edit
    const [formData, setFormData] = useState({
        name: '',
        broker: 'MetaTrader 5',
        type: 'live' as AccountType,
        currency: 'USD',
        profitTarget: 0,
        dailyLossLimit: 0,
        maxDrawdown: 0
    });

    // Initialize or populate form when editingAccount changes
    useEffect(() => {
        if (!editingAccount && !canCreateAccount && activeManagerTab === 'create') {
            setActiveManagerTab('accounts');
            return;
        }

        if (editingAccount) {
            setFormData({
                name: editingAccount.name,
                broker: editingAccount.broker,
                type: editingAccount.type,
                currency: editingAccount.currency,
                profitTarget: editingAccount.propFirmRules?.profitTarget || 0,
                dailyLossLimit: editingAccount.propFirmRules?.dailyLossLimit || 0,
                maxDrawdown: editingAccount.propFirmRules?.maxDrawdown || 0
            });
        } else {
            setFormData({
                name: '',
                broker: 'MetaTrader 5',
                type: 'live',
                currency: 'USD',
                profitTarget: 0,
                dailyLossLimit: 0,
                maxDrawdown: 0
            });
        }
        setErrorMessage(null);
        setSuccessMessage(null);
    }, [editingAccount, activeManagerTab, canCreateAccount]);

    if (!isManagerOpen) return null;

    const filteredAccounts = accounts.filter(a => showArchived ? a.isArchived : !a.isArchived);

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
        if (window.confirm(
            isEn
                ? 'Generate a new EA token for this account? Your attached MetaTrader 5 EAs will need to be updated with the new token.'
                : 'Tem certeza que deseja gerar um novo token EA para esta conta? Seus EAs precisarão ser atualizados com o novo token.'
        )) {
            try {
                await regenerateToken(accountId);
                setSuccessMessage(isEn ? 'EA token regenerated successfully!' : 'Token EA regenerado com sucesso!');
                setTimeout(() => setSuccessMessage(null), 3000);
            } catch (err: any) {
                setErrorMessage(err.response?.data?.message || (isEn ? 'Failed to regenerate EA token' : 'Falha ao regenerar token'));
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage(null);
        setSuccessMessage(null);

        if (!editingAccount && !canCreateAccount) {
            return;
        }

        if (!formData.name.trim()) {
            setErrorMessage(isEn ? 'Account name is required.' : 'O nome da conta é obrigatório.');
            return;
        }

        setIsSubmitting(true);

        try {
            const isPropFirm = formData.type === 'prop_firm' || formData.type === 'challenge' || formData.type === 'funded';
            if (isBasic && (isPropFirm || isRestrictedBasicBrokerName(formData.broker))) {
                setErrorMessage(
                    isEn
                        ? 'Prop firm accounts (FTMO, FundedNext, FundingPips, etc.) and Deriv require the Pro or Premium plan.'
                        : 'Contas de Mesas Proprietárias (Prop Firms) e Deriv estão disponíveis apenas no Plano Pro ou Premium.'
                );
                openWorkspacePlansModal('account_propfirm_or_deriv', { broker: formData.broker, type: formData.type });
                setIsSubmitting(false);
                return;
            }
            const propFirmRules = isPropFirm ? {
                profitTarget: Number(formData.profitTarget) || 0,
                dailyLossLimit: Number(formData.dailyLossLimit) || 0,
                maxDrawdown: Number(formData.maxDrawdown) || 0
            } : undefined;

            const payload = {
                name: formData.name.trim(),
                broker: formData.broker.trim(),
                type: formData.type,
                currency: formData.currency,
                propFirmRules
            };

            if (editingAccount) {
                await updateAccount(editingAccount.id, payload);
                setSuccessMessage(isEn ? 'Account updated successfully!' : 'Conta atualizada com sucesso!');
            } else if (canCreateAccount) {
                await createAccount(payload);
                setSuccessMessage(isEn ? 'Trading account created successfully!' : 'Nova conta criada com sucesso!');
            }

            setTimeout(() => {
                setActiveManagerTab('accounts');
                setEditingAccount(null);
                setSuccessMessage(null);
            }, 1000);

        } catch (err: any) {
            setErrorMessage(err.response?.data?.message || err.message || (isEn ? 'Failed to save account' : 'Falha ao salvar conta'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (account: TradingAccount) => {
        const confirmMsg = isEn
            ? `Are you sure you want to delete account "${account.name}"?`
            : `Tem certeza que deseja excluir a conta "${account.name}"?`;
        if (window.confirm(confirmMsg)) {
            try {
                await deleteAccount(account.id, false);
            } catch (err: any) {
                if (window.confirm(
                    isEn
                        ? `${err.response?.data?.message || err.message}\nForce permanent deletion of all execution data for this account?`
                        : `${err.response?.data?.message || err.message}\nDeseja forçar a exclusão permanente de todos os dados desta conta?`
                )) {
                    await deleteAccount(account.id, true);
                }
            }
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-canvas/85 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl bg-surface border border-line shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-line flex items-center justify-between bg-canvas-subtle/90">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-accent-fg">
                            <Briefcase size={20} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-fg">
                                {isEn ? 'Trading Accounts & Portfolios' : 'Gerenciar Contas de Trading'}
                            </h2>
                            <p className="text-xs text-fg-muted">
                                {isEn ? 'Isolate and track live, demo, and prop firm accounts' : 'Crie, isole e administre suas contas de trading'}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsManagerOpen(false)}
                        className="p-2 rounded-xl text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Navigation Tabs */}
                <div className="flex items-center gap-2 px-6 pt-3 border-b border-line bg-canvas-subtle/40">
                    <button
                        onClick={() => {
                            setActiveManagerTab('accounts');
                            setEditingAccount(null);
                        }}
                        className={`pb-3 px-3 text-xs font-bold transition-all border-b-2 ${
                            activeManagerTab === 'accounts'
                                ? 'border-emerald-500 text-accent-fg'
                                : 'border-transparent text-fg-muted hover:text-fg'
                        }`}
                    >
                        {isEn ? `My Accounts (${accounts.filter(a => !a.isArchived).length})` : `Minhas Contas (${accounts.filter(a => !a.isArchived).length})`}
                    </button>

                    {(editingAccount || canCreateAccount) && (
                        <button
                            onClick={() => {
                                setActiveManagerTab('create');
                            }}
                            className={`pb-3 px-3 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 ${
                                activeManagerTab === 'create'
                                    ? 'border-emerald-500 text-accent-fg'
                                    : 'border-transparent text-fg-muted hover:text-fg'
                            }`}
                        >
                            {editingAccount ? <Edit3 size={14} /> : <Plus size={14} />}
                            {editingAccount
                                ? (isEn ? 'Edit Account' : 'Editar Conta')
                                : (isEn ? 'New Account' : 'Nova Conta')}
                        </button>
                    )}
                </div>

                {/* Feedback Alerts */}
                {errorMessage && (
                    <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-danger-fg text-xs flex items-center gap-2">
                        <AlertCircle size={16} />
                        <span>{errorMessage}</span>
                    </div>
                )}
                {successMessage && (
                    <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-accent-fg text-xs flex items-center gap-2">
                        <Check size={16} />
                        <span>{successMessage}</span>
                    </div>
                )}

                {/* Tab 1: Minhas Contas */}
                {activeManagerTab === 'accounts' && (
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-fg-muted">
                                {showArchived
                                    ? (isEn ? 'Archived accounts' : 'Contas arquivadas')
                                    : (isEn ? 'Active trading accounts' : 'Contas de trading ativas')}
                            </span>
                            <button
                                onClick={() => setShowArchived(!showArchived)}
                                className="text-xs text-fg-muted hover:text-fg underline"
                            >
                                {showArchived
                                    ? (isEn ? 'View active accounts' : 'Ver contas ativas')
                                    : (isEn ? 'View archived' : 'Ver contas arquivadas')}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredAccounts.map(account => {
                                const isPropFirm = account.type === 'prop_firm' || account.type === 'challenge' || account.type === 'funded';
                                const token = account.appToken;
                                const isTokenVisible = visibleTokenId === account.id;

                                return (
                                    <div
                                        key={account.id}
                                        className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                                            account.id === selectedAccountId
                                                ? 'bg-surface-2 border-emerald-500/60 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/30'
                                                : 'bg-canvas-subtle/70 border-line hover:border-line-strong'
                                        }`}
                                    >
                                        <div>
                                            <div className="flex items-start justify-between mb-2">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="font-bold text-fg text-sm">
                                                        {account.name}
                                                    </h3>
                                                    {account.mt5Id && (
                                                        <span className="text-[10px] font-mono bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded font-bold">
                                                            #{account.mt5Id}
                                                        </span>
                                                    )}
                                                    {account.isPrimary && (
                                                        <span className="text-[10px] bg-emerald-500/20 text-accent-fg border border-emerald-500/30 px-1.5 py-0.5 rounded-full font-semibold">
                                                            {isEn ? 'Primary' : 'Principal'}
                                                        </span>
                                                    )}
                                                </div>

                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                                    isPropFirm 
                                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' 
                                                        : account.type === 'demo'
                                                        ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                                                        : 'bg-emerald-500/10 text-accent-fg border-emerald-500/30'
                                                }`}>
                                                    {account.type.toUpperCase()}
                                                </span>
                                            </div>

                                            <div className="text-xs text-fg-muted flex items-center gap-2 mb-3 flex-wrap">
                                                <span>{account.broker}</span>
                                                <span>•</span>
                                                <span>{account.currency}</span>
                                                {(account.mt5Id || Number(account.balance) > 0) && (
                                                    <>
                                                        <span>•</span>
                                                        <span className="font-mono text-fg font-semibold">
                                                            {isEn ? 'Equity' : 'Saldo'}: {formatMoney(Number(account.balance) || 0, account.currency)}
                                                        </span>
                                                    </>
                                                )}
                                            </div>

                                            {/* Métricas Reais do Trading */}
                                            <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-canvas border border-line mb-3 text-xs">
                                                <div>
                                                    <span className="text-[9px] text-fg-subtle uppercase tracking-wider block">
                                                        {isEn ? 'Net P&L' : 'Lucro Líquido'}
                                                    </span>
                                                    <span className={`font-mono font-bold text-xs ${
                                                        (account.netPnl || 0) >= 0 ? 'text-accent-fg' : 'text-danger-fg'
                                                    }`}>
                                                        {(account.netPnl || 0) >= 0 ? '+' : ''}
                                                        {formatMoney(account.netPnl || 0, account.currency)}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-fg-subtle uppercase tracking-wider block">Win Rate</span>
                                                    <span className="font-mono font-bold text-xs text-fg">
                                                        {(account.winRate || 0).toFixed(1)}%
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-fg-subtle uppercase tracking-wider block">Trades</span>
                                                    <span className="font-mono font-bold text-xs text-fg">
                                                        {account.tradesCount || 0}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Token do EA MT5 */}
                                            <div className="p-2 rounded-xl bg-canvas/80 border border-line mb-3">
                                                <div className="flex items-center justify-between text-[11px] text-fg-muted mb-1">
                                                    <span className="flex items-center gap-1">
                                                        <KeyRound size={11} className="text-indigo-400" />
                                                        {isEn ? 'MT5 EA Token:' : 'Token MT5 EA:'}
                                                    </span>
                                                    <button
                                                        onClick={() => setVisibleTokenId(isTokenVisible ? null : account.id)}
                                                        className="text-[10px] text-indigo-400 hover:text-indigo-300"
                                                    >
                                                        {isTokenVisible ? (isEn ? 'Hide' : 'Ocultar') : (isEn ? 'Reveal' : 'Mostrar')}
                                                    </button>
                                                </div>
                                                <div className="flex items-center justify-between gap-2">
                                                    <code className="text-[10px] font-mono text-fg-muted truncate">
                                                        {isTokenVisible ? token : '••••••••••••••••••••••••'}
                                                    </code>
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => handleCopyToken(account.id, token)}
                                                            className="p-1 rounded bg-surface-2 hover:bg-surface-3 text-fg-muted hover:text-fg transition-colors"
                                                            title={isEn ? 'Copy EA Token' : 'Copiar Token EA'}
                                                        >
                                                            {copiedTokenId === account.id ? <Check size={12} className="text-accent-fg" /> : <Copy size={12} />}
                                                        </button>
                                                        <button
                                                            onClick={() => handleRegenerateToken(account.id)}
                                                            className="p-1 rounded bg-surface-2 hover:bg-surface-3 text-fg-muted hover:text-fg transition-colors"
                                                            title={isEn ? 'Regenerate EA Token' : 'Regenerar Token EA'}
                                                        >
                                                            <RefreshCw size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Ações da Conta */}
                                        <div className="pt-2 border-t border-line flex items-center justify-between gap-1 text-xs">
                                            {!account.isPrimary && !account.isArchived && (
                                                <button
                                                    onClick={() => setPrimaryAccount(account.id)}
                                                    className="text-fg-muted hover:text-accent-fg text-[11px] font-medium transition-colors"
                                                >
                                                    {isEn ? 'Set Primary' : 'Tornar Principal'}
                                                </button>
                                            )}

                                            <div className="flex items-center gap-1 ml-auto">
                                                <button
                                                    onClick={() => {
                                                        setEditingAccount(account);
                                                        setActiveManagerTab('create');
                                                    }}
                                                    className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                                                    title={isEn ? 'Edit' : 'Editar'}
                                                >
                                                    <Edit3 size={14} />
                                                </button>

                                                {account.isArchived ? (
                                                    <button
                                                        onClick={() => restoreAccount(account.id)}
                                                        className="p-1.5 rounded-lg text-accent-fg hover:bg-emerald-500/10 transition-colors"
                                                        title={isEn ? 'Restore' : 'Restaurar'}
                                                    >
                                                        <RotateCcw size={14} />
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => archiveAccount(account.id)}
                                                        className="p-1.5 rounded-lg text-fg-muted hover:text-amber-400 hover:bg-surface-2 transition-colors"
                                                        title={isEn ? 'Archive' : 'Arquivar'}
                                                    >
                                                        <Archive size={14} />
                                                    </button>
                                                )}

                                                <button
                                                    onClick={() => handleDelete(account)}
                                                    className="p-1.5 rounded-lg text-fg-muted hover:text-danger-fg hover:bg-rose-500/10 transition-colors"
                                                    title={isEn ? 'Delete' : 'Excluir'}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Tab 2: Criar / Editar Conta */}
                {activeManagerTab === 'create' && (editingAccount || canCreateAccount) && (
                    <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">

                        {/* Formulário Principal */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-fg-muted mb-1.5">
                                    {isEn ? 'Account Name *' : 'Nome da Conta *'}
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder={isEn ? 'e.g., FTMO $100K, Exness Live...' : 'Ex: FTMO $100K, Exness Live...'}
                                    className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-fg text-sm focus:border-emerald-500/60 focus:outline-none"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-fg-muted mb-1.5">
                                    {isEn ? 'Broker / Prop Firm *' : 'Corretora / Broker *'}
                                </label>
                                <input
                                    type="text"
                                    value={formData.broker}
                                    onChange={e => setFormData({ ...formData, broker: e.target.value })}
                                    placeholder={isEn ? 'e.g., FTMO, Exness, IC Markets, Deriv...' : 'Ex: FTMO, Exness, IC Markets, Deriv...'}
                                    className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-fg text-sm focus:border-emerald-500/60 focus:outline-none"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-fg-muted mb-1.5">
                                    {isEn ? 'Account Type' : 'Tipo de Conta'}
                                </label>
                                <select
                                    value={formData.type}
                                    onChange={e => {
                                        const nextType = e.target.value as AccountType;
                                        if (isBasic && (nextType === 'prop_firm' || nextType === 'challenge' || nextType === 'funded')) {
                                            openWorkspacePlansModal('account_propfirm_type', { type: nextType });
                                            return;
                                        }
                                        setFormData({ ...formData, type: nextType });
                                    }}
                                    className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-fg text-sm focus:border-emerald-500/60 focus:outline-none"
                                >
                                    <option value="live">{isEn ? 'Live Capital' : 'Live (Real)'}</option>
                                    <option value="demo">Demo</option>
                                    <option value="prop_firm">{isBasic ? '🔒 Prop Firm (PRO)' : 'Prop Firm'}</option>
                                    <option value="challenge">{isBasic ? (isEn ? '🔒 Evaluation Challenge (PRO)' : '🔒 Challenge / Desafio (PRO)') : (isEn ? 'Evaluation Challenge' : 'Challenge (Desafio)')}</option>
                                    <option value="funded">{isBasic ? '🔒 Funded (PRO)' : 'Funded'}</option>
                                    <option value="custom">{isEn ? 'Custom' : 'Personalizada'}</option>
                                </select>
                                {isBasic && (
                                    <button
                                        type="button"
                                        onClick={() => openWorkspacePlansModal('account_propfirm_type')}
                                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:underline cursor-pointer"
                                    >
                                        <Lock size={11} />
                                        <span>
                                            {isEn
                                                ? 'Prop Firms & Deriv sync require Pro or Premium'
                                                : 'Mesas Proprietárias & Deriv disponíveis no Plano Pro'}
                                        </span>
                                    </button>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-fg-muted mb-1.5">
                                    {isEn ? 'Base Currency' : 'Moeda Base'}
                                </label>
                                <select
                                    value={formData.currency}
                                    onChange={e => setFormData({ ...formData, currency: e.target.value })}
                                    className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-fg text-sm focus:border-emerald-500/60 focus:outline-none"
                                >
                                    <option value="USD">USD ($)</option>
                                    <option value="EUR">EUR (€)</option>
                                    <option value="GBP">GBP (£)</option>
                                    <option value="BRL">BRL (R$)</option>
                                    <option value="MZN">MZN (MT)</option>
                                    <option value="ZAR">ZAR (R)</option>
                                </select>
                            </div>
                        </div>

                        {/* Seção Específica para Prop Firms / Challenges */}
                        {(formData.type === 'prop_firm' || formData.type === 'challenge' || formData.type === 'funded') && (
                            <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-4">
                                <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                                    <Award size={16} />
                                    <span>{isEn ? 'Prop Firm Risk Parameters' : 'Parâmetros de Avaliação da Prop Firm'}</span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-[11px] text-fg-muted mb-1">
                                            {isEn ? 'Profit Target (%)' : 'Meta de Lucro (%)'}
                                        </label>
                                        <input
                                            type="number"
                                            value={formData.profitTarget || ''}
                                            onChange={e => setFormData({ ...formData, profitTarget: parseFloat(e.target.value) || 0 })}
                                            placeholder={isEn ? 'e.g. 10' : 'Ex: 10'}
                                            className="w-full px-3 py-2 rounded-lg bg-canvas border border-line text-fg text-xs font-mono focus:border-emerald-500/60 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] text-fg-muted mb-1">
                                            {isEn ? 'Max Daily Loss (%)' : 'Perda Máxima Diária (%)'}
                                        </label>
                                        <input
                                            type="number"
                                            value={formData.dailyLossLimit || ''}
                                            onChange={e => setFormData({ ...formData, dailyLossLimit: parseFloat(e.target.value) || 0 })}
                                            placeholder={isEn ? 'e.g. 5' : 'Ex: 5'}
                                            className="w-full px-3 py-2 rounded-lg bg-canvas border border-line text-fg text-xs font-mono focus:border-emerald-500/60 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] text-fg-muted mb-1">
                                            {isEn ? 'Max Drawdown (%)' : 'Drawdown Máximo (%)'}
                                        </label>
                                        <input
                                            type="number"
                                            value={formData.maxDrawdown || ''}
                                            onChange={e => setFormData({ ...formData, maxDrawdown: parseFloat(e.target.value) || 0 })}
                                            placeholder={isEn ? 'e.g. 10' : 'Ex: 10'}
                                            className="w-full px-3 py-2 rounded-lg bg-canvas border border-line text-fg text-xs font-mono focus:border-emerald-500/60 focus:outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end gap-3 pt-4 border-t border-line">
                            <button
                                type="button"
                                onClick={() => {
                                    setActiveManagerTab('accounts');
                                    setEditingAccount(null);
                                }}
                                className="px-4 py-2 rounded-xl text-xs font-semibold text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
                            >
                                {isEn ? 'Cancel' : 'Cancelar'}
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-all disabled:opacity-50"
                            >
                                {isSubmitting
                                    ? (isEn ? 'Saving...' : 'Salvando...')
                                    : editingAccount
                                    ? (isEn ? 'Save Changes' : 'Salvar Alterações')
                                    : (isEn ? 'Create Trading Account' : 'Criar Conta de Trading')}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};
