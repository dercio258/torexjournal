import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../api';
import { useAuth } from './AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import {
    addTransactionOfflineAware,
    archiveAccountOfflineAware,
    createAccountOfflineAware,
    deleteAccountOfflineAware,
    restoreAccountOfflineAware,
    setPrimaryAccountOfflineAware,
    updateAccountOfflineAware,
} from '../services/offlineMutations';
import {
    getCurrentUserScope,
    listUserAccountsFromIDB,
    upsertAccountsInIDB,
} from '../services/offlineDb';

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
    zeroBalanceSince?: string | null;
    inactivityDisconnectAt?: string | null;
    appToken: string;
    appTokenMasked?: string;
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
    revealToken: (id: string) => Promise<string>;
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

const ACCOUNTS_CACHE_KEY = 'torex_accounts_cache';

function readCachedAccounts(): TradingAccount[] {
    try {
        const raw = localStorage.getItem(ACCOUNTS_CACHE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeCachedAccounts(list: TradingAccount[]) {
    try {
        if (!list || list.length === 0) {
            localStorage.removeItem(ACCOUNTS_CACHE_KEY);
            return;
        }
        const sanitized = list.map((acc) => ({ ...acc, appToken: '' }));
        localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify(sanitized));
        const userScope = getCurrentUserScope();
        if (userScope && userScope !== 'anon') {
            void upsertAccountsInIDB(userScope, sanitized);
        }
    } catch {
        // ignore storage quota errors
    }
}

function computeConsolidatedSummary(allAccounts: TradingAccount[]): ConsolidatedSummary {
    const active = allAccounts.filter(a => !a.isArchived);
    if (active.length === 0) {
        return {
            totalInitialBalance: 0,
            totalCurrentBalance: 0,
            totalNetPnl: 0,
            totalTrades: 0,
            totalWins: 0,
            winRate: 0,
            currencies: ['USD'],
            hasMultipleCurrencies: false,
            accounts: [],
        };
    }

    const currencies = Array.from(new Set(active.map(a => a.currency || 'USD')));
    let totalInitialBalance = 0;
    let totalCurrentBalance = 0;
    let totalNetPnl = 0;
    let totalTrades = 0;
    let totalWins = 0;

    for (const acc of active) {
        totalInitialBalance += Number(acc.initialBalance || 0);
        totalCurrentBalance += Number(acc.balance || 0);
        totalNetPnl += Number(acc.netPnl || 0);
        const count = Number(acc.tradesCount || 0);
        totalTrades += count;
        totalWins += Math.round((Number(acc.winRate || 0) / 100) * count);
    }

    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    return {
        totalInitialBalance: Number(totalInitialBalance.toFixed(2)),
        totalCurrentBalance: Number(totalCurrentBalance.toFixed(2)),
        totalNetPnl: Number(totalNetPnl.toFixed(2)),
        totalTrades,
        totalWins,
        winRate: Number(winRate.toFixed(1)),
        currencies,
        hasMultipleCurrencies: currencies.length > 1,
        accounts: active,
    };
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { token } = useAuth();
    const queryClient = useQueryClient();

    const [accounts, setAccounts] = useState<TradingAccount[]>(() => (localStorage.getItem('token') ? readCachedAccounts() : []));
    const [selectedAccountId, setSelectedAccountId] = useState<string>(() => {
        const saved = localStorage.getItem('torex_selected_account_id');
        if (saved) return saved;
        const cached = readCachedAccounts().filter(a => !a.isArchived);
        if (cached.length > 0) {
            const primary = cached.find(a => a.isPrimary) || cached[0];
            return primary.id;
        }
        return 'all';
    });
    const [isLoading, setIsLoading] = useState<boolean>(() => {
        if (!localStorage.getItem('token')) return false;
        return readCachedAccounts().length === 0;
    });

    // Modal state
    const [isManagerOpen, setIsManagerOpen] = useState(false);
    const [activeManagerTab, setActiveManagerTab] = useState<'accounts' | 'create' | 'transactions'>('accounts');
    const [editingAccount, setEditingAccount] = useState<TradingAccount | null>(null);

    const inFlightRefreshRef = useRef<Promise<void> | null>(null);

    const consolidatedSummary = useMemo<ConsolidatedSummary | null>(
        () => (token ? computeConsolidatedSummary(accounts) : null),
        [accounts, token]
    );

    const refreshAccounts = useCallback(async () => {
        if (!token) {
            setAccounts([]);
            writeCachedAccounts([]);
            setIsLoading(false);
            return;
        }

        if (inFlightRefreshRef.current) {
            return inFlightRefreshRef.current;
        }

        const task = (async () => {
            const requestToken = localStorage.getItem('token');
            try {
                if (accounts.length === 0) {
                    setIsLoading(true);
                }
                const accRes = await api.get('/accounts?includeArchived=true');
                const currentToken = localStorage.getItem('token');
                if (!requestToken || currentToken !== requestToken) {
                    return;
                }
                const list: TradingAccount[] = Array.isArray(accRes.data) ? accRes.data : [];
                setAccounts(list);
                writeCachedAccounts(list);

                // Validate whether selectedAccountId is still valid
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
                inFlightRefreshRef.current = null;
                setIsLoading(false);
            }
        })();

        inFlightRefreshRef.current = task;
        return task;
    }, [token]);

    useEffect(() => {
        if (token) {
            const scope = getCurrentUserScope();
            void listUserAccountsFromIDB(scope).then((stored) => {
                if (stored.length > 0) {
                    setAccounts((prev) =>
                        prev.length === 0 ? (stored as TradingAccount[]) : prev
                    );
                    setIsLoading(false);
                }
            });
        }
        refreshAccounts();
    }, [token, refreshAccounts]);

    useEffect(() => {
        const handleAccountSyncEvent = () => {
            refreshAccounts();
        };
        window.addEventListener('trade-imported', handleAccountSyncEvent);
        window.addEventListener('torex:offline-sync-completed', handleAccountSyncEvent);
        return () => {
            window.removeEventListener('trade-imported', handleAccountSyncEvent);
            window.removeEventListener('torex:offline-sync-completed', handleAccountSyncEvent);
        };
    }, [refreshAccounts]);

    const selectAccount = (id: string) => {
        setSelectedAccountId(id);
        localStorage.setItem('torex_selected_account_id', id);

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

    const canCreateAccount = true;

    const createAccount = async (data: Partial<TradingAccount>) => {
        const res = await createAccountOfflineAware(data);
        const newAccount: TradingAccount = res.data;
        if (res.offlineQueued) {
            setAccounts(prev => {
                const next = [...prev, newAccount];
                writeCachedAccounts(next);
                return next;
            });
        } else {
            await refreshAccounts();
        }
        selectAccount(newAccount.id);
        return newAccount;
    };

    const updateAccount = async (id: string, data: Partial<TradingAccount>) => {
        const res = await updateAccountOfflineAware(id, data);
        const updated: TradingAccount = res.data;
        if (res.offlineQueued) {
            setAccounts(prev => {
                const next = prev.map(a => (a.id === id ? { ...a, ...updated } : a));
                writeCachedAccounts(next);
                return next;
            });
        } else {
            await refreshAccounts();
        }
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        return updated;
    };

    const setPrimaryAccount = async (id: string) => {
        const res = await setPrimaryAccountOfflineAware(id);
        if (res.offlineQueued) {
            setAccounts(prev => {
                const next = prev.map(a => ({ ...a, isPrimary: a.id === id }));
                writeCachedAccounts(next);
                return next;
            });
        } else {
            await refreshAccounts();
        }
    };

    const archiveAccount = async (id: string) => {
        const res = await archiveAccountOfflineAware(id);
        if (res.offlineQueued) {
            const nowIso = new Date().toISOString();
            setAccounts(prev => {
                const next = prev.map(a =>
                    a.id === id ? { ...a, isArchived: true, archivedAt: nowIso } : a
                );
                writeCachedAccounts(next);
                return next;
            });
        } else {
            await refreshAccounts();
        }
        if (selectedAccountId === id) {
            setSelectedAccountId('all');
            localStorage.setItem('torex_selected_account_id', 'all');
        }
    };

    const restoreAccount = async (id: string) => {
        const res = await restoreAccountOfflineAware(id);
        if (res.offlineQueued) {
            setAccounts(prev => {
                const next = prev.map(a =>
                    a.id === id ? { ...a, isArchived: false, archivedAt: null } : a
                );
                writeCachedAccounts(next);
                return next;
            });
        } else {
            await refreshAccounts();
        }
    };

    const deleteAccount = async (id: string, force = false) => {
        const res = await deleteAccountOfflineAware(id, force);
        if (res.offlineQueued) {
            setAccounts(prev => {
                const next = prev.filter(a => a.id !== id);
                writeCachedAccounts(next);
                return next;
            });
        } else {
            await refreshAccounts();
        }
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

    const revealToken = async (id: string): Promise<string> => {
        const res = await api.post(`/accounts/${id}/token/reveal`);
        return String(res.data?.token || '');
    };

    const getTransactions = async (accountId: string) => {
        const res = await api.get(`/accounts/${accountId}/transactions`);
        return res.data;
    };

    const addTransaction = async (accountId: string, data: { type: string; amount: number; description?: string; date?: string }) => {
        const res = await addTransactionOfflineAware(accountId, data);
        if (!res.offlineQueued) {
            await refreshAccounts();
        }
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
                revealToken,
                getTransactions,
                addTransaction,
                isManagerOpen,
                setIsManagerOpen,
                activeManagerTab,
                setActiveManagerTab,
                editingAccount,
                setEditingAccount,
                openCreateModal,
                openManageModal,
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
