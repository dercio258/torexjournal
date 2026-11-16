import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    DashboardOperationalFilters,
    DashboardOutcomeFilter,
    DashboardSessionBucket,
    DashboardSideFilter,
} from '../hooks/useDashboard';
import { useAccount } from './AccountContext';
import { useLocale, type AppLocale } from './LocaleContext';

export type DateRangePreset = 'today' | 'yesterday' | '7days' | 'this_month' | '30days' | 'all' | 'custom';

export interface DateRangeState {
    preset: DateRangePreset;
    label: string;
    customStart: string; // YYYY-MM-DD
    customEnd: string;   // YYYY-MM-DD
}

export const getDatePresetOptions = (
    locale: AppLocale
): { value: Exclude<DateRangePreset, 'custom'>; label: string; shortLabel: string }[] =>
    locale === 'en'
        ? [
              { value: 'today', label: 'Today', shortLabel: 'Today' },
              { value: 'yesterday', label: 'Yesterday', shortLabel: 'Yesterday' },
              { value: '7days', label: 'Last 7 Days', shortLabel: '7D' },
              { value: 'this_month', label: 'This Month', shortLabel: 'MTD' },
              { value: '30days', label: 'Last 30 Days', shortLabel: '30D' },
              { value: 'all', label: 'All Time', shortLabel: 'All Time' },
          ]
        : [
              { value: 'today', label: 'Hoje', shortLabel: 'Hoje' },
              { value: 'yesterday', label: 'Ontem', shortLabel: 'Ontem' },
              { value: '7days', label: 'Últimos 7 dias', shortLabel: '7 Dias' },
              { value: 'this_month', label: 'Este mês', shortLabel: 'Este mês' },
              { value: '30days', label: 'Últimos 30 dias', shortLabel: '30 Dias' },
              { value: 'all', label: 'Todo o período', shortLabel: 'Tudo' },
          ];

export const DATE_PRESET_OPTIONS = getDatePresetOptions('pt');

const STORAGE_KEY = 'torex_dashboard_date_range';

const formatShortDate = (isoDate: string, locale: AppLocale = 'pt') => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
    return locale === 'en'
        ? `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)}`
        : `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
};

const loadInitialDateRange = (locale: AppLocale = 'pt'): DateRangeState => {
    const presetOptions = getDatePresetOptions(locale);
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            // Support both legacy { value, label, start, end } and v2 { preset, label, customStart, customEnd }
            const candidate = parsed.preset || parsed.value;
            const validPresets: DateRangePreset[] = ['today', 'yesterday', '7days', 'this_month', '30days', 'all', 'custom'];
            if (validPresets.includes(candidate)) {
                const customStart = parsed.customStart ?? parsed.start ?? '';
                const customEnd = parsed.customEnd ?? parsed.end ?? '';
                if (candidate === 'custom' && customStart) {
                    const label = customEnd
                        ? `${formatShortDate(customStart, locale)} – ${formatShortDate(customEnd, locale)}`
                        : `${locale === 'en' ? 'From' : 'Desde'} ${formatShortDate(customStart, locale)}`;
                    return { preset: 'custom', label, customStart, customEnd };
                }
                const found = presetOptions.find(o => o.value === candidate);
                if (found) {
                    return { preset: found.value, label: found.shortLabel, customStart: '', customEnd: '' };
                }
            }
        }
    } catch {
        // Ignore malformed storage
    }
    return {
        preset: 'all',
        label: locale === 'en' ? 'All Time' : 'Tudo',
        customStart: '',
        customEnd: '',
    };
};

interface DashboardFilterContextType {
    dateRange: DateRangeState;
    queryDates: { start: string; end: string };
    setDatePreset: (preset: Exclude<DateRangePreset, 'custom'>) => void;
    setCustomDateRange: (start: string, end?: string) => void;

    filters: Required<DashboardOperationalFilters>;
    setSideFilter: (side: DashboardSideFilter) => void;
    setOutcomeFilter: (outcome: DashboardOutcomeFilter) => void;
    toggleSessionFilter: (session: DashboardSessionBucket) => void;
    toggleSymbolFilter: (symbol: string) => void;
    clearSymbolsFilter: () => void;
    resetFilters: () => void;
    activeFilterCount: number;
    hasActiveFilters: boolean;

    availableSymbols: string[];
    setAvailableSymbols: (symbols: string[]) => void;
}

const DashboardFilterContext = createContext<DashboardFilterContextType | undefined>(undefined);

export const DashboardFilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { selectedAccountId } = useAccount();
    const { locale } = useLocale();

    const [dateRange, setDateRange] = useState<DateRangeState>(() => loadInitialDateRange(locale));
    const [symbols, setSymbols] = useState<string[]>([]);
    const [side, setSide] = useState<DashboardSideFilter>('ALL');
    const [sessions, setSessions] = useState<DashboardSessionBucket[]>([]);
    const [outcome, setOutcome] = useState<DashboardOutcomeFilter>('ALL');
    const [availableSymbols, setAvailableSymbolsState] = useState<string[]>([]);

    // Clear symbol-specific selections when switching accounts so stale symbols don't hide data
    useEffect(() => {
        setSymbols([]);
    }, [selectedAccountId]);

    // Sync displayed dateRange label when locale changes
    useEffect(() => {
        setDateRange((prev) => {
            if (prev.preset === 'custom' && prev.customStart) {
                const nextLabel = prev.customEnd
                    ? `${formatShortDate(prev.customStart, locale)} – ${formatShortDate(prev.customEnd, locale)}`
                    : `${locale === 'en' ? 'From' : 'Desde'} ${formatShortDate(prev.customStart, locale)}`;
                return prev.label === nextLabel ? prev : { ...prev, label: nextLabel };
            }
            const opts = getDatePresetOptions(locale);
            const found = opts.find((o) => o.value === prev.preset);
            if (!found || prev.label === found.shortLabel) return prev;
            return { ...prev, label: found.shortLabel };
        });
    }, [locale]);

    const persistDateRange = useCallback((next: DateRangeState) => {
        setDateRange(next);
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    preset: next.preset,
                    value: next.preset,
                    label: next.label,
                    customStart: next.customStart,
                    customEnd: next.customEnd,
                    start: next.customStart,
                    end: next.customEnd,
                })
            );
        } catch {
            // Ignore storage quota errors
        }
    }, []);

    const setDatePreset = useCallback(
        (preset: Exclude<DateRangePreset, 'custom'>) => {
            const opts = getDatePresetOptions(locale);
            const opt = opts.find(o => o.value === preset) || opts[opts.length - 1];
            persistDateRange({
                preset: opt.value,
                label: opt.shortLabel,
                customStart: '',
                customEnd: '',
            });
        },
        [locale, persistDateRange]
    );

    const setCustomDateRange = useCallback(
        (start: string, end = '') => {
            if (!start) return;
            const normalizedEnd = end && end >= start ? end : end ? start : '';
            const label = normalizedEnd
                ? `${formatShortDate(start, locale)} – ${formatShortDate(normalizedEnd, locale)}`
                : `${locale === 'en' ? 'From' : 'Desde'} ${formatShortDate(start, locale)}`;
            persistDateRange({
                preset: 'custom',
                label,
                customStart: start,
                customEnd: normalizedEnd,
            });
        },
        [locale, persistDateRange]
    );

    const queryDates = useMemo(() => {
        const now = new Date();
        let start = new Date(now);
        let end = new Date(now);

        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        switch (dateRange.preset) {
            case 'today':
                break;
            case 'yesterday':
                start.setDate(now.getDate() - 1);
                start.setHours(0, 0, 0, 0);
                end.setDate(now.getDate() - 1);
                end.setHours(23, 59, 59, 999);
                break;
            case '7days':
                start.setDate(now.getDate() - 7);
                start.setHours(0, 0, 0, 0);
                break;
            case 'this_month':
                start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                break;
            case '30days':
                start.setDate(now.getDate() - 30);
                start.setHours(0, 0, 0, 0);
                break;
            case 'all':
                start = new Date('2020-01-01T00:00:00.000Z');
                break;
            case 'custom':
                if (dateRange.customStart) {
                    start = new Date(`${dateRange.customStart}T00:00:00`);
                }
                if (dateRange.customEnd) {
                    end = new Date(`${dateRange.customEnd}T23:59:59.999`);
                }
                break;
        }

        return {
            start: start.toISOString(),
            end: end.toISOString(),
        };
    }, [dateRange.preset, dateRange.customStart, dateRange.customEnd]);

    const toggleSessionFilter = useCallback((session: DashboardSessionBucket) => {
        setSessions(prev => (prev.includes(session) ? prev.filter(s => s !== session) : [...prev, session]));
    }, []);

    const toggleSymbolFilter = useCallback((symbol: string) => {
        setSymbols(prev => (prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]));
    }, []);

    const clearSymbolsFilter = useCallback(() => {
        setSymbols([]);
    }, []);

    const resetFilters = useCallback(() => {
        setSymbols([]);
        setSide('ALL');
        setSessions([]);
        setOutcome('ALL');
    }, []);

    const setAvailableSymbols = useCallback((incoming: string[]) => {
        setAvailableSymbolsState(prev => {
            if (prev.length === incoming.length && prev.every((v, i) => v === incoming[i])) {
                return prev;
            }
            return incoming;
        });
    }, []);

    const filters = useMemo<Required<DashboardOperationalFilters>>(
        () => ({
            symbols,
            side,
            sessions,
            outcome,
        }),
        [symbols, side, sessions, outcome]
    );

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (side !== 'ALL') count += 1;
        if (outcome !== 'ALL') count += 1;
        count += sessions.length;
        count += symbols.length;
        return count;
    }, [side, outcome, sessions.length, symbols.length]);

    const value = useMemo<DashboardFilterContextType>(
        () => ({
            dateRange,
            queryDates,
            setDatePreset,
            setCustomDateRange,
            filters,
            setSideFilter: setSide,
            setOutcomeFilter: setOutcome,
            toggleSessionFilter,
            toggleSymbolFilter,
            clearSymbolsFilter,
            resetFilters,
            activeFilterCount,
            hasActiveFilters: activeFilterCount > 0,
            availableSymbols,
            setAvailableSymbols,
        }),
        [
            dateRange,
            queryDates,
            setDatePreset,
            setCustomDateRange,
            filters,
            toggleSessionFilter,
            toggleSymbolFilter,
            clearSymbolsFilter,
            resetFilters,
            activeFilterCount,
            availableSymbols,
            setAvailableSymbols,
        ]
    );

    return <DashboardFilterContext.Provider value={value}>{children}</DashboardFilterContext.Provider>;
};

export const useDashboardFilters = () => {
    const context = useContext(DashboardFilterContext);
    if (!context) {
        throw new Error('useDashboardFilters deve ser utilizado dentro de um DashboardFilterProvider');
    }
    return context;
};
