import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calendar, Search, RefreshCw,
    X, Info
} from 'lucide-react';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { CalendarSkeleton } from '../components/ui/Skeleton';
import { FeatureUpgradeGateCard } from '../components/subscription/FeatureUpgradeGateCard';
import { isBasicPlanTier, openWorkspacePlansModal } from '../lib/planGate';
import api from '../api';

interface EconomicEvent {
    id: string;
    time?: string;
    eventDate?: string;
    currency: string;
    country?: string;
    event?: string;
    title?: string;
    category?: string;
    impact: 'high' | 'medium' | 'low' | 'HIGH' | 'MEDIUM' | 'LOW' | string;
    status?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED' | string;
    actual?: string | null;
    forecast?: string | null;
    previous?: string | null;
    unit?: string | null;
    description?: string | null;
    source?: string;
    isAccountRelevant?: boolean;
    relevanceReason?: string | null;
}

const CURRENCY_COUNTRY_MAP: Record<string, { flag: string; country: string; countryEn: string }> = {
    USD: { flag: '🇺🇸', country: 'Estados Unidos', countryEn: 'United States' },
    EUR: { flag: '🇪🇺', country: 'Zona do Euro', countryEn: 'Eurozone' },
    GBP: { flag: '🇬🇧', country: 'Reino Unido', countryEn: 'United Kingdom' },
    JPY: { flag: '🇯🇵', country: 'Japão', countryEn: 'Japan' },
    CAD: { flag: '🇨🇦', country: 'Canadá', countryEn: 'Canada' },
    AUD: { flag: '🇦🇺', country: 'Austrália', countryEn: 'Australia' },
    CHF: { flag: '🇨🇭', country: 'Suíça', countryEn: 'Switzerland' },
    NZD: { flag: '🇳🇿', country: 'Nova Zelândia', countryEn: 'New Zealand' },
    BRL: { flag: '🇧🇷', country: 'Brasil', countryEn: 'Brazil' },
    CNY: { flag: '🇨🇳', country: 'China', countryEn: 'China' },
    XAU: { flag: '🪙', country: 'Ouro Spot', countryEn: 'Spot Gold' },
    BTC: { flag: '₿', country: 'Bitcoin', countryEn: 'Bitcoin' },
};

const eventDate = (evt: { eventDate?: string | null; time?: string | null }): Date | null => {
    const raw = evt.eventDate || evt.time;
    if (!raw) return null;
    const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
};
const hasTime = (evt: { eventDate?: string | null; time?: string | null }) => /[T ]\d{2}:\d{2}/.test(evt.eventDate || evt.time || '');
const localDayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
};
const eventDayKey = (evt: { eventDate?: string | null; time?: string | null }) => {
    const d = eventDate(evt);
    return d ? localDayKey(d) : null;
};

const IMPACT = {
    HIGH: { label: 'Alto', labelEn: 'High', badge: 'text-danger-fg bg-danger/10 border-danger/25', active: 'bg-danger text-white', idle: 'text-danger-fg hover:bg-danger/10' },
    MEDIUM: { label: 'Médio', labelEn: 'Medium', badge: 'text-warning bg-warning/10 border-warning/25', active: 'bg-warning text-slate-950', idle: 'text-warning hover:bg-warning/10' },
    LOW: { label: 'Baixo', labelEn: 'Low', badge: 'text-fg-muted bg-surface-2 border-line', active: 'bg-surface-3 text-fg', idle: 'text-fg-muted hover:bg-surface-2' },
} as const;
const impactOf = (raw?: string | null) => IMPACT[(raw || 'MEDIUM').toUpperCase() as keyof typeof IMPACT] ?? IMPACT.MEDIUM;

const EconomicCalendar: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const isBasic = isBasicPlanTier(user?.tier);
    const { selectedAccountId } = useAccount();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const hasPromptedUpgradeRef = useRef(false);

    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [events, setEvents] = useState<EconomicEvent[]>([]);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

    // Filters
    const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'tomorrow' | 'this_week'>('all');
    const [impactFilter, setImpactFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
    const [currencyFilter, setCurrencyFilter] = useState<string>('ALL');
    const [searchTerm, setSearchTerm] = useState('');

    // Modal
    const [selectedEvent, setSelectedEvent] = useState<EconomicEvent | null>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

    const delayedSyncTimerRef = useRef<number | null>(null);

    const fetchCalendar = useCallback(async (isManualRefresh = false, silent = false) => {
        try {
            if (isManualRefresh) {
                setIsRefreshing(true);
                await api.post('/mt5/calendar/sync').catch(() => {});
            } else if (!silent) {
                setLoading(true);
            }

            const params: any = {
                limit: 500,
                from: addDays(new Date(), -7).toISOString(),
                to: addDays(new Date(), 14).toISOString(),
            };
            if (selectedAccountId && selectedAccountId !== 'all') {
                params.accountId = selectedAccountId;
            }

            const res = await api.get('/economic-calendar/events', { params });
            if (res.data) {
                if (Array.isArray(res.data)) {
                    setEvents(res.data);
                } else if (res.data.data && Array.isArray(res.data.data)) {
                    setEvents(res.data.data);
                } else if (res.data.events && Array.isArray(res.data.events)) {
                    setEvents(res.data.events);
                } else {
                    setEvents([]);
                }
            } else {
                setEvents([]);
            }
            setLastUpdated(new Date());

            if (isManualRefresh) {
                if (delayedSyncTimerRef.current) {
                    window.clearTimeout(delayedSyncTimerRef.current);
                }
                delayedSyncTimerRef.current = window.setTimeout(() => {
                    fetchCalendar(false, true);
                }, 4500);
            }
        } catch (error) {
            console.error('Falha ao carregar calendário econômico:', error);
            if (!silent) {
                setEvents([]);
            }
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        return () => {
            if (delayedSyncTimerRef.current) {
                window.clearTimeout(delayedSyncTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (isBasic) {
            setLoading(false);
            if (!hasPromptedUpgradeRef.current) {
                hasPromptedUpgradeRef.current = true;
                openWorkspacePlansModal('economic_calendar_page');
            }
            return;
        }
        fetchCalendar(false);
        const intervalId = window.setInterval(() => {
            fetchCalendar(false);
        }, 10 * 60 * 1000);
        return () => window.clearInterval(intervalId);
    }, [fetchCalendar, isBasic]);

    const availableCurrencies = useMemo(() => {
        const set = new Set<string>();
        events.forEach(e => {
            if (e.currency) set.add(e.currency.toUpperCase());
        });
        return Array.from(set).sort();
    }, [events]);

    const getCurrencyInfo = (curr: string) => {
        const code = (curr || 'USD').toUpperCase();
        const entry = CURRENCY_COUNTRY_MAP[code];
        if (!entry) return { flag: '🌐', country: code };
        return { flag: entry.flag, country: isEn ? entry.countryEn : entry.country };
    };

    const compareActualVsForecast = (actual?: string | null, forecast?: string | null) => {
        if (!actual || !forecast) return null;
        const clean = (v: string) => {
            const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
            return isNaN(n) ? null : n;
        };
        const act = clean(actual);
        const fct = clean(forecast);
        if (act === null || fct === null) return null;
        if (act > fct) return 'HIGHER';
        if (act < fct) return 'LOWER';
        return 'EQUAL';
    };

    const filteredEvents = useMemo(() => {
        const todayStr = localDayKey(new Date());
        const tomorrowStr = localDayKey(addDays(new Date(), 1));
        const nextWeekStr = localDayKey(addDays(new Date(), 7));

        return events.filter(evt => {
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                const eventName = (evt.title || evt.event || '').toLowerCase();
                const matchName = eventName.includes(term);
                const matchCurrency = (evt.currency || '').toLowerCase().includes(term);
                const matchCountry = (evt.country || '').toLowerCase().includes(term);
                if (!matchName && !matchCurrency && !matchCountry) return false;
            }

            if (impactFilter !== 'ALL') {
                const evtImpact = (evt.impact || '').toUpperCase();
                if (evtImpact !== impactFilter) return false;
            }

            if (currencyFilter !== 'ALL') {
                if ((evt.currency || '').toUpperCase() !== currencyFilter.toUpperCase()) return false;
            }

            const eventDateStr = eventDayKey(evt);
            if (eventDateStr) {
                if (periodFilter === 'today' && eventDateStr !== todayStr) return false;
                if (periodFilter === 'tomorrow' && eventDateStr !== tomorrowStr) return false;
                if (periodFilter === 'this_week' && (eventDateStr < todayStr || eventDateStr > nextWeekStr)) return false;
            }

            return true;
        });
    }, [events, searchTerm, impactFilter, currencyFilter, periodFilter]);

    const groupedEvents = useMemo(() => {
        const groups: Record<string, EconomicEvent[]> = {};
        for (const evt of filteredEvents) {
            const dateStr = eventDayKey(evt) || (isEn ? 'Upcoming' : 'Próximos');
            if (!groups[dateStr]) groups[dateStr] = [];
            groups[dateStr].push(evt);
        }

        Object.keys(groups).forEach(dateKey => {
            groups[dateKey].sort((a, b) => {
                return (eventDate(a)?.getTime() ?? 0) - (eventDate(b)?.getTime() ?? 0);
            });
        });

        return groups;
    }, [filteredEvents, isEn]);

    const sortedDates = Object.keys(groupedEvents).sort();
    const todayStr = localDayKey(new Date());
    const tzLabel = useMemo(() => {
        const offset = -new Date().getTimezoneOffset() / 60;
        return `GMT${offset >= 0 ? '+' : ''}${offset}`;
    }, []);

    const handleOpenDetail = (evt: EconomicEvent) => {
        setSelectedEvent(evt);
        setIsDetailModalOpen(true);
    };

    if (isBasic) {
        return (
            <FeatureUpgradeGateCard
                featureKey="economic_calendar"
                title="Calendário Econômico Institucional exclusivo Pro & Premium"
                titleEn="Economic Calendar Requires Pro or Premium"
                description="Acompanhe notícias macroeconômicas de alto impacto sincronizadas com os ativos das suas contas no Plano Pro ou Premium."
                descriptionEn="Track high-impact macroeconomic releases filtered by your trading account currencies with Pro or Premium."
                bullets={[
                    'Sincronização contínua MT5 com impacto Real vs Previsão',
                    'Alertas automáticos de moedas relevantes para sua conta',
                    'Backtesting completo & Trade Replay integrados',
                    '1.500 Créditos AI / mês no Plano Pro',
                ]}
                bulletsEn={[
                    'Real-time MT5 calendar sync with Actual vs Forecast comparison',
                    'Currency relevance matching for your portfolio',
                    'Full Backtesting & Trade Replay suite',
                    '1,500 monthly AI credits on Pro',
                ]}
                onBack={() => navigate('/dashboard')}
                backLabel="Voltar à Dashboard"
                backLabelEn="Back to Dashboard"
            />
        );
    }

    return (
        <div className="w-full space-y-3 pb-10 animate-in fade-in duration-300">
            {/* Compact Status Bar */}
            <div className="flex flex-wrap justify-between items-center gap-2">
                <p className="text-xs text-fg-muted">
                    {isEn ? (
                        <>Macroeconomic releases · times in your local timezone (<span className="font-mono text-fg">{tzLabel}</span>)</>
                    ) : (
                        <>Divulgações macroeconômicas · horários no seu fuso (<span className="font-mono text-fg">{tzLabel}</span>)</>
                    )}
                </p>

                <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-accent/10 border border-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent-fg">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                        MT5 Auto-Sync · 10 min
                    </span>
                    <span className="text-[11px] text-fg-subtle hidden md:inline tabular-nums">
                        {isEn ? 'Synced:' : 'Sincronizado:'} {lastUpdated.toLocaleTimeString(isEn ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button
                        onClick={() => fetchCalendar(true)}
                        className="h-8 px-3 rounded-lg bg-surface hover:bg-surface-2 text-fg border border-line text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                        <RefreshCw size={13} className={isRefreshing || loading ? 'animate-spin text-accent-fg' : ''} />
                        <span>{isEn ? 'Refresh' : 'Atualizar'}</span>
                    </button>
                </div>
            </div>

            {/* Filter Toolbar */}
            <div className="bg-surface border border-line rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5">
                {/* Search Input */}
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
                    <input
                        type="text"
                        placeholder={isEn ? 'Search event or currency...' : 'Buscar notícia...'}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full h-8 bg-canvas-subtle border border-line text-xs rounded-lg pl-8 pr-7 text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/50"
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg cursor-pointer"
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>

                {/* Period Pills */}
                <div className="flex items-center gap-0.5 bg-canvas-subtle p-0.5 rounded-lg border border-line-subtle">
                    {[
                        { id: 'all', label: isEn ? 'All' : 'Todos' },
                        { id: 'today', label: isEn ? 'Today' : 'Hoje' },
                        { id: 'tomorrow', label: isEn ? 'Tomorrow' : 'Amanhã' },
                        { id: 'this_week', label: isEn ? '7 Days' : '7 Dias' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setPeriodFilter(tab.id as any)}
                            className={`h-7 px-2.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                                periodFilter === tab.id
                                    ? 'bg-surface-2 text-fg border border-line-subtle'
                                    : 'text-fg-muted hover:text-fg'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Impact Filter */}
                <div className="flex items-center gap-0.5 bg-canvas-subtle p-0.5 rounded-lg border border-line-subtle">
                    <span className="text-[10px] uppercase font-semibold text-fg-subtle px-2">{isEn ? 'Impact:' : 'Impacto:'}</span>
                    <button
                        onClick={() => setImpactFilter('ALL')}
                        className={`h-7 px-2 rounded-md text-xs font-semibold cursor-pointer ${
                            impactFilter === 'ALL' ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg'
                        }`}
                    >
                        {isEn ? 'All' : 'Todos'}
                    </button>
                    <button
                        onClick={() => setImpactFilter('HIGH')}
                        className={`h-7 px-2 rounded-md text-xs font-semibold cursor-pointer ${
                            impactFilter === 'HIGH' ? IMPACT.HIGH.active : IMPACT.HIGH.idle
                        }`}
                    >
                        {isEn ? 'High' : 'Alto'}
                    </button>
                    <button
                        onClick={() => setImpactFilter('MEDIUM')}
                        className={`h-7 px-2 rounded-md text-xs font-semibold cursor-pointer ${
                            impactFilter === 'MEDIUM' ? IMPACT.MEDIUM.active : IMPACT.MEDIUM.idle
                        }`}
                    >
                        {isEn ? 'Medium' : 'Médio'}
                    </button>
                    <button
                        onClick={() => setImpactFilter('LOW')}
                        className={`h-7 px-2 rounded-md text-xs font-semibold cursor-pointer ${
                            impactFilter === 'LOW' ? IMPACT.LOW.active : IMPACT.LOW.idle
                        }`}
                    >
                        {isEn ? 'Low' : 'Baixo'}
                    </button>
                </div>

                {/* Currency Dropdown */}
                {availableCurrencies.length > 0 && (
                    <select
                        value={currencyFilter}
                        onChange={(e) => setCurrencyFilter(e.target.value)}
                        className="h-8 bg-canvas-subtle border border-line text-fg text-xs rounded-lg px-2.5 focus:outline-none focus:border-accent/50 cursor-pointer"
                    >
                        <option value="ALL">{isEn ? 'All Currencies' : 'Todas Moedas'}</option>
                        {availableCurrencies.map(c => (
                            <option key={c} value={c}>
                                {getCurrencyInfo(c).flag} {c}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {/* Content Area */}
            {loading ? (
                <CalendarSkeleton />
            ) : sortedDates.length === 0 ? (
                <div className="py-16 text-center space-y-2.5 bg-surface rounded-xl border border-line p-8">
                    <Calendar size={32} className="mx-auto text-fg-subtle" />
                    <h3 className="text-sm font-semibold text-fg">
                        {isEn ? 'No economic events found' : 'Nenhum evento econômico encontrado'}
                    </h3>
                    <p className="text-fg-muted text-xs max-w-sm mx-auto">
                        {isEn ? 'No macroeconomic releases match the selected filters.' : 'Não há divulgações publicadas para os filtros selecionados.'}
                    </p>
                    <Button
                        variant="secondary"
                        onClick={() => {
                            setSearchTerm('');
                            setImpactFilter('ALL');
                            setCurrencyFilter('ALL');
                            setPeriodFilter('all');
                            fetchCalendar(true);
                        }}
                        className="text-xs py-1 px-3 mt-1"
                    >
                        {isEn ? 'Reset Filters' : 'Limpar Filtros'}
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    {sortedDates.map((dateStr) => {
                        const dayEvents = groupedEvents[dateStr];
                        const dateObj = new Date(dateStr + 'T12:00:00');
                        const isToday = todayStr === dateStr;

                        return (
                            <div
                                key={dateStr}
                                className="bg-surface border border-line rounded-xl overflow-hidden"
                            >
                                {/* Clean Date Header */}
                                <div className={`px-4 py-2.5 border-b border-line-subtle flex items-center justify-between ${
                                    isToday ? 'bg-accent/[0.06]' : 'bg-canvas-subtle'
                                }`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-1.5 h-1.5 rounded-full ${isToday ? 'bg-accent' : 'bg-fg-subtle'}`} />
                                        <h3 className="text-xs font-bold text-fg capitalize">
                                            {dateObj.toLocaleDateString(isEn ? 'en-US' : 'pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                                        </h3>
                                        {isToday && (
                                            <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent-fg text-[10px] font-bold uppercase">
                                                {isEn ? 'Today' : 'Hoje'}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[11px] text-fg-subtle font-mono tabular-nums">
                                        {dayEvents.length} {isEn ? (dayEvents.length === 1 ? 'event' : 'events') : (dayEvents.length === 1 ? 'evento' : 'eventos')}
                                    </span>
                                </div>

                                {/* Table Column Headers (Desktop) */}
                                <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle bg-canvas-subtle/60 border-b border-line-subtle">
                                    <div className="col-span-1">{isEn ? 'Time' : 'Hora'}</div>
                                    <div className="col-span-2">{isEn ? 'Currency' : 'Moeda'}</div>
                                    <div className="col-span-2">{isEn ? 'Impact' : 'Impacto'}</div>
                                    <div className="col-span-4">{isEn ? 'Event' : 'Notícia / Evento'}</div>
                                    <div className="col-span-1 text-right">{isEn ? 'Actual' : 'Atual'}</div>
                                    <div className="col-span-1 text-right">{isEn ? 'Forecast' : 'Previsão'}</div>
                                    <div className="col-span-1 text-right">{isEn ? 'Previous' : 'Anterior'}</div>
                                </div>

                                {/* Event Rows */}
                                <div className="divide-y divide-line-subtle">
                                    {dayEvents.map((evt) => {
                                        const impact = impactOf(evt.impact);

                                        const evDate = eventDate(evt);
                                        const timeDisplay = evDate && hasTime(evt)
                                            ? evDate.toLocaleTimeString(isEn ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit', ...(isEn ? { hour12: false } : {}) })
                                            : '--:--';

                                        const currencyInfo = getCurrencyInfo(evt.currency);
                                        const comparison = compareActualVsForecast(evt.actual, evt.forecast);

                                        return (
                                            <div
                                                key={evt.id}
                                                onClick={() => handleOpenDetail(evt)}
                                                className="px-4 py-2.5 grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 items-center hover:bg-surface-2/50 cursor-pointer transition-colors text-xs"
                                            >
                                                <div className="md:col-span-1 font-mono font-semibold text-fg tabular-nums">
                                                    {timeDisplay}
                                                </div>

                                                <div className="md:col-span-2 flex items-center gap-1.5 font-semibold text-fg">
                                                    <span>{currencyInfo.flag}</span>
                                                    <span>{evt.currency}</span>
                                                    {evt.country && (
                                                        <span className="text-[10px] text-fg-subtle truncate hidden lg:inline">
                                                            ({evt.country})
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="md:col-span-2">
                                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${impact.badge}`}>
                                                        {isEn ? impact.labelEn : impact.label}
                                                    </span>
                                                </div>

                                                <div className="md:col-span-4 flex items-center gap-2">
                                                    <span className="font-medium text-fg truncate" title={evt.title || evt.event}>
                                                        {evt.title || evt.event}
                                                    </span>
                                                    {evt.status === 'COMPLETED' && (
                                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent/15 text-accent-fg flex-shrink-0">
                                                            {isEn ? 'Released' : 'Publicado'}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="md:col-span-1 text-right font-mono tabular-nums">
                                                    <span className="md:hidden text-fg-subtle mr-2 text-[10px]">{isEn ? 'Act:' : 'Atual:'}</span>
                                                    <span className={`font-bold ${evt.actual ? 'text-fg' : 'text-fg-subtle'}`}>
                                                        {evt.actual ? `${evt.actual}${evt.unit ? ` ${evt.unit}` : ''}` : '—'}
                                                    </span>
                                                    {evt.actual && comparison && comparison !== 'EQUAL' && (
                                                        <span
                                                            className="ml-1 text-[10px] text-fg-subtle"
                                                            title={
                                                                comparison === 'HIGHER'
                                                                    ? (isEn ? 'Above forecast' : 'Acima da previsão')
                                                                    : (isEn ? 'Below forecast' : 'Abaixo da previsão')
                                                            }
                                                        >
                                                            <span aria-hidden>{comparison === 'HIGHER' ? '▲' : '▼'}</span>
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="md:col-span-1 text-right font-mono text-fg-muted tabular-nums">
                                                    <span className="md:hidden text-fg-subtle mr-2 text-[10px]">{isEn ? 'Fcst:' : 'Prev:'}</span>
                                                    {evt.forecast ? `${evt.forecast}${evt.unit ? ` ${evt.unit}` : ''}` : '—'}
                                                </div>

                                                <div className="md:col-span-1 text-right font-mono text-fg-subtle tabular-nums">
                                                    <span className="md:hidden text-fg-subtle mr-2 text-[10px]">{isEn ? 'Prev:' : 'Ant:'}</span>
                                                    {evt.previous ? `${evt.previous}${evt.unit ? ` ${evt.unit}` : ''}` : '—'}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Event Detail Modal */}
            <Modal
                isOpen={isDetailModalOpen}
                onClose={() => setIsDetailModalOpen(false)}
                title={selectedEvent ? `${selectedEvent.currency} · ${selectedEvent.title || selectedEvent.event}` : (isEn ? 'Event Details' : 'Detalhes do Evento')}
            >
                {selectedEvent && (
                    <div className="space-y-3.5 text-fg text-xs">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-canvas-subtle border border-line-subtle">
                            <div className="flex items-center gap-2.5">
                                <span className="text-2xl">{getCurrencyInfo(selectedEvent.currency).flag}</span>
                                <div>
                                    <div className="font-bold text-fg">
                                        {selectedEvent.currency} — {selectedEvent.country || getCurrencyInfo(selectedEvent.currency).country}
                                    </div>
                                    <div className="text-[11px] text-fg-muted">
                                        {isEn ? 'Impact:' : 'Impacto:'} <strong className="text-fg">{isEn ? impactOf(selectedEvent.impact).labelEn : impactOf(selectedEvent.impact).label}</strong>
                                    </div>
                                </div>
                            </div>
                            <div className="text-right font-mono tabular-nums">
                                <div className="text-xs font-bold text-fg">
                                    {selectedEvent.eventDate || selectedEvent.time ? (
                                        (eventDate(selectedEvent)?.toLocaleString(isEn ? 'en-US' : 'pt-BR', { dateStyle: 'short', timeStyle: 'short' }) ?? '--')
                                    ) : '--'}
                                </div>
                                <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                                    selectedEvent.status === 'COMPLETED' || selectedEvent.actual
                                        ? 'bg-accent/15 text-accent-fg'
                                        : 'bg-surface-2 text-fg-muted'
                                }`}>
                                    {selectedEvent.status === 'COMPLETED' || selectedEvent.actual
                                        ? (isEn ? 'Released' : 'Divulgado')
                                        : (isEn ? 'Scheduled' : 'Agendado')}
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <div className="p-3 rounded-lg bg-canvas-subtle border border-line-subtle text-center">
                                <span className="text-[10px] uppercase font-semibold text-fg-subtle block mb-1">{isEn ? 'Actual' : 'Atual'}</span>
                                <div className={`text-sm font-bold font-mono tabular-nums ${selectedEvent.actual ? 'text-fg' : 'text-fg-subtle'}`}>
                                    {selectedEvent.actual ? `${selectedEvent.actual}${selectedEvent.unit ? ` ${selectedEvent.unit}` : ''}` : '—'}
                                </div>
                            </div>
                            <div className="p-3 rounded-lg bg-canvas-subtle border border-line-subtle text-center">
                                <span className="text-[10px] uppercase font-semibold text-fg-subtle block mb-1">{isEn ? 'Forecast' : 'Previsão'}</span>
                                <div className="text-sm font-bold font-mono tabular-nums text-fg">
                                    {selectedEvent.forecast ? `${selectedEvent.forecast}${selectedEvent.unit ? ` ${selectedEvent.unit}` : ''}` : '—'}
                                </div>
                            </div>
                            <div className="p-3 rounded-lg bg-canvas-subtle border border-line-subtle text-center">
                                <span className="text-[10px] uppercase font-semibold text-fg-subtle block mb-1">{isEn ? 'Previous' : 'Anterior'}</span>
                                <div className="text-sm font-bold font-mono tabular-nums text-fg-muted">
                                    {selectedEvent.previous ? `${selectedEvent.previous}${selectedEvent.unit ? ` ${selectedEvent.unit}` : ''}` : '—'}
                                </div>
                            </div>
                        </div>

                        {selectedEvent.description && (
                            <div className="p-3 rounded-lg bg-canvas-subtle border border-line-subtle space-y-1">
                                <div className="font-semibold text-fg text-xs flex items-center gap-1.5">
                                    <Info size={13} className="text-accent-fg" />
                                    <span>{isEn ? 'Description / Analysis' : 'Descrição / Análise'}</span>
                                </div>
                                <p className="text-fg-muted text-xs leading-relaxed">
                                    {selectedEvent.description}
                                </p>
                            </div>
                        )}

                        <div className="flex justify-end pt-1">
                            <Button variant="secondary" onClick={() => setIsDetailModalOpen(false)}>
                                {isEn ? 'Close' : 'Fechar'}
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default EconomicCalendar;
