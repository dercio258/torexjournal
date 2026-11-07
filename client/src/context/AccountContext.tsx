import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from './AuthContext';
import { useQueryClient } from '@tanstack/react-query';

export type AccountType = 'live' | 'demo' | 'prop_firm' | 'challenge' | 'funded' | 'custom';

export interface PropFirmRules {
    profitTarget?: number;
    dailyLossLimit?: number;
    maxDrawdown?: number;
    minTradingDays?: number;
    rulesDescription?: string;
    [key: string]: any;
}

export interface TradingAccount {
    id: string;
    name: string;
    broker: string;
    type: AccountType;
    currency: string;
    initialBalance: number;
    balance: number;
    equity: number;
    margin: number;
    marginFree: number;
    marginLevel: number;
    leverage: number;
    isConnected: boolean;
    lastSeen: string | null;
    appToken: string;
    userId: string;
    isPrimary: boolean;
    isArchived: boolean;
    archivedAt: string | null;
    propFirmRules: PropFirmRules | null;
    mt5Id?: string;
    tradesCount?: number;
    netPnl?: number;
    winRate?: number;
    createdAt: string;
    updatedAt: string;
}

export interface AccountTransaction {
    id: string;
    accountId: string;
    type: 'deposit' | 'withdrawal' | 'adjustment' | 'bonus' | 'fee';
    amount: number;
    date: string;
    description: string | null;
    balanceAfter: number;
    createdAt: string;
}

export interface ConsolidatedSummary {
    totalInitialBalance: number;
    totalCurrentBalance: number;
    totalNetPnl: number;
    totalTrades: number;
    totalWins: number;
    winRate: number;
    currencies: string[];
    hasMultipleCurrencies: boolean;
    accounts: TradingAccount[];
}

interface AccountContextType {
    accounts: TradingAccount[];
    selectedAccountId: string; // UUID or 'all'
    selectedAccount: TradingAccount | null;
    isConsolidated: boolean;
    isLoading: boolean;
    consolidatedSummary: ConsolidatedSummary | null;
    selectAccount: (id: string) => void;
    refreshAccounts: () => Promise<void>;
    createAccount: (data: Partial<TradingAccount>) => Promise<TradingAccount>;
    updateAccount: (id: string, data: Partial<TradingAccount>) => Promise<TradingAccount>;
    setPrimaryAccount: (id: string) => Promise<void>;
    archiveAccount: (id: string) => Promise<void>;
    restoreAccount: (id: string) => Promise<void>;
    deleteAccount: (id: string, force?: boolean) => Promise<void>;
    regenerateToken: (id: string) => Promise<string>;
    getTransactions: (accountId: string) => Promise<AccountTransaction[]>;
    addTransaction: (accountId: string, data: { type: string; amount: number; description?: string; date?: string }) => Promise<AccountTransaction>;
    // Manager Modal Controls
    isManagerOpen: boolean;
    setIsManagerOpen: (open: boolean) => void;
    activeManagerTab: 'accounts' | 'create' | 'transactions';
    setActiveManagerTab: (tab: 'accounts' | 'create' | 'transactions') => void;
    editingAccount: TradingAccount | null;
    setEditingAccount: (account: TradingAccount | null) => void;
    openCreateModal: () => void;
    openManageModal: (tab?: 'accounts' | 'create' | 'transactions') => void;
    canCreateAccount: boolean;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const [accounts, setAccounts] = useState<TradingAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>(() => {
        return localStorage.getItem('torex_selected_account_id') || 'all';
    });
    const [consolidatedSummary, setConsolidatedSummary] = useState<ConsolidatedSummary | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    // Modal state
    const [isManagerOpen, setIsManagerOpen] = useState(false);
    const [activeManagerTab, setActiveManagerTab] = useState<'accounts' | 'create' | 'transactions'>('accounts');
    const [editingAccount, setEditingAccount] = useState<TradingAccount | null>(null);

    const refreshAccounts = useCallback(async () => {
        if (!user) {
            setAccounts([]);
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            const [accRes, summaryRes] = await Promise.all([
                api.get('/accounts?includeArchived=true'),
                api.get('/accounts/summary/consolidated').catch(() => ({ data: null }))
            ]);

            const list: TradingAccount[] = Array.isArray(accRes.data) ? accRes.data : [];
            setAccounts(list);
            if (summaryRes?.data) {
                setConsolidatedSummary(summaryRes.data);
            }

            // Validar se o selectedAccountId ainda é válido
            const savedId = localStorage.getItem('torex_selected_account_id');
            const activeAccounts = list.filter(a => !a.isArchived);

            if (savedId === 'all') {
                setSelectedAccountId('all');
            } else if (savedId && activeAccounts.some(a => a.id === savedId)) {
                setSelectedAccountId(savedId);
            } else if (activeAccounts.length > 0) {
                const primary = activeAccounts.find(a => a.isPrimary) || activeAccounts[0];
                setSelectedAccountId(primary.id);
                localStorage.setItem('torex_selected_account_id', primary.id);
            } else {
                setSelectedAccountId('all');
                localStorage.setItem('torex_selected_account_id', 'all');
            }

        } catch (error) {
            console.error('Failed to load accounts:', error);
        } finally {
            setIsLoading(false);
        }
    }, [user]);

    useEffect(() => {
        refreshAccounts();
    }, [refreshAccounts]);

    useEffect(() => {
        const handleAccountSyncEvent = () => {
            refreshAccounts();
        };
        window.addEventListener('trade-imported', handleAccountSyncEvent);
        return () => window.removeEventListener('trade-imported', handleAccountSyncEvent);
    }, [refreshAccounts]);

    const selectAccount = (id: string) => {
        setSelectedAccountId(id);
        localStorage.setItem('torex_selected_account_id', id);

        // Invalida todos os caches do dashboard, trades e journal para reatividade instantânea
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['trades'] });
        queryClient.invalidateQueries({ queryKey: ['technical-journal'] });
        queryClient.invalidateQueries({ queryKey: ['heatmap'] });
        queryClient.invalidateQueries({ queryKey: ['reports'] });
        queryClient.invalidateQueries({ queryKey: ['calendar'] });
        queryClient.invalidateQueries({ queryKey: ['backtest'] });
    };

    const isConsolidated = selectedAccountId === 'all';
    const selectedAccount = isConsolidated
        ? null
        : accounts.find(a => a.id === selectedAccountId) || null;

    const activeAccountsCount = accounts.filter(a => !a.isArchived).length;
    const canCreateAccount = activeAccountsCount < 50;

    const createAccount = async (data: Partial<TradingAccount>) => {
        if (activeAccountsCount >= 50) {
            throw new Error('Limite máximo de contas de trading atingido.');
        }
        const res = await api.post('/accounts', data);
        const newAccount: TradingAccount = res.data;
        await refreshAccounts();
        selectAccount(newAccount.id);
        return newAccount;
    };

    const updateAccount = async (id: string, data: Partial<TradingAccount>) => {
        const res = await api.put(`/accounts/${id}`, data);
        const updated: TradingAccount = res.data;
        await refreshAccounts();
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        return updated;
    };

    const setPrimaryAccount = async (id: string) => {
        await api.post(`/accounts/${id}/primary`);
        await refreshAccounts();
    };

    const archiveAccount = async (id: string) => {
        await api.post(`/accounts/${id}/archive`);
        await refreshAccounts();
        if (selectedAccountId === id) {
            setSelectedAccountId('all');
            localStorage.setItem('torex_selected_account_id', 'all');
        }
    };

    const restoreAccount = async (id: string) => {
        await api.post(`/accounts/${id}/restore`);
        await refreshAccounts();
    };

    const deleteAccount = async (id: string, force = false) => {
        await api.delete(`/accounts/${id}${force ? '?force=true' : ''}`);
        await refreshAccounts();
        if (selectedAccountId === id) {
            setSelectedAccountId('all');
            localStorage.setItem('torex_selected_account_id', 'all');
        }
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['trades'] });
    };

    const regenerateToken = async (id: string) => {
        const res = await api.post(`/accounts/${id}/token/regenerate`);
        await refreshAccounts();
        return res.data.token;
    };

    const getTransactions = async (accountId: string) => {
        const res = await api.get(`/accounts/${accountId}/transactions`);
        return res.data;
    };

    const addTransaction = async (accountId: string, data: { type: string; amount: number; description?: string; date?: string }) => {
        const res = await api.post(`/accounts/${accountId}/transactions`, data);
        await refreshAccounts();
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        return res.data;
    };

    const openCreateModal = () => {
        if (!canCreateAccount) {
            setEditingAccount(null);
            setActiveManagerTab('accounts');
            setIsManagerOpen(true);
            return;
        }
        setEditingAccount(null);
        setActiveManagerTab('create');
        setIsManagerOpen(true);
    };

    const openManageModal = (tab: 'accounts' | 'create' | 'transactions' = 'accounts') => {
        if (tab === 'create' && !canCreateAccount) {
            tab = 'accounts';
        }
        setActiveManagerTab(tab);
        setIsManagerOpen(true);
    };

    return (
        <AccountContext.Provider
            value={{
                accounts,
                selectedAccountId,
                selectedAccount,
                isConsolidated,
                isLoading,
                consolidatedSummary,
                canCreateAccount,
                selectAccount,
                refreshAccounts,
                createAccount,
                updateAccount,
                setPrimaryAccount,
                archiveAccount,
                restoreAccount,
                deleteAccount,
                regenerateToken,
                getTransactions,
                addTransaction,
                isManagerOpen,
                setIsManagerOpen,
                activeManagerTab,
                setActiveManagerTab,
                editingAccount,
                setEditingAccount,
                openCreateModal,
                openManageModal
            }}
        >
            {children}
        </AccountContext.Provider>
    );
};

export const useAccount = () => {
    const context = useContext(AccountContext);
    if (!context) {
        throw new Error('useAccount must be used within an AccountProvider');
    }
    return context;
};
