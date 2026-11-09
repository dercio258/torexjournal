import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Calendar, Search, RefreshCw,
    X, Info
} from 'lucide-react';
import { useAccount } from '../context/AccountContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
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

const CURRENCY_COUNTRY_MAP: Record<string, { flag: string; country: string }> = {
    USD: { flag: '🇺🇸', country: 'Estados Unidos' },
    EUR: { flag: '🇪🇺', country: 'Zona do Euro' },
    GBP: { flag: '🇬🇧', country: 'Reino Unido' },
    JPY: { flag: '🇯🇵', country: 'Japão' },
    CAD: { flag: '🇨🇦', country: 'Canadá' },
    AUD: { flag: '🇦🇺', country: 'Austrália' },
    CHF: { flag: '🇨🇭', country: 'Suíça' },
    NZD: { flag: '🇳🇿', country: 'Nova Zelândia' },
    BRL: { flag: '🇧🇷', country: 'Brasil' },
    CNY: { flag: '🇨🇳', country: 'China' },
    XAU: { flag: '🪙', country: 'Ouro Spot' },
    BTC: { flag: '₿', country: 'Bitcoin' },
};

/** Event timestamp as a Date. ISO strings carry their zone; "YYYY-MM-DD HH:mm" is taken as local. */
const eventDate = (evt: { eventDate?: string | null; time?: string | null }): Date | null => {
    const raw = evt.eventDate || evt.time;
    if (!raw) return null;
    const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
};
const hasTime = (evt: { eventDate?: string | null; time?: string | null }) => /[T ]\d{2}:\d{2}/.test(evt.eventDate || evt.time || '');
/** YYYY-MM-DD in the user's local timezone. */
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

/** Impact = severity. Light/dark text steps chosen for >= 4.5:1 on each surface; always labeled. */
const IMPACT = {
    HIGH: { label: 'Alto', badge: 'text-danger-fg bg-danger/10 border-danger/25', active: 'bg-danger text-white', idle: 'text-danger-fg hover:bg-danger/10' },
    MEDIUM: { label: 'Médio', badge: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30', active: 'bg-amber-500 text-slate-950', idle: 'text-amber-700 dark:text-amber-400 hover:bg-amber-500/10' },
    LOW: { label: 'Baixo', badge: 'text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/25', active: 'bg-blue-600 text-white', idle: 'text-blue-700 dark:text-blue-400 hover:bg-blue-500/10' },
} as const;
const impactOf = (raw?: string | null) => IMPACT[(raw || 'MEDIUM').toUpperCase() as keyof typeof IMPACT] ?? IMPACT.MEDIUM;

const EconomicCalendar: React.FC = () => {
    const { selectedAccountId } = useAccount();

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

    // Fetch genuine events from API
    const fetchCalendar = useCallback(async (isManualRefresh = false) => {
        try {
            if (isManualRefresh) setIsRefreshing(true);
            else setLoading(true);

            const params: any = { limit: 100 };
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
        } catch (error) {
            console.error('Falha ao carregar calendário econômico:', error);
            setEvents([]);
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        fetchCalendar();
    }, [fetchCalendar]);

    // Available unique currencies in real events
    const availableCurrencies = useMemo(() => {
        const set = new Set<string>();
        events.forEach(e => {
            if (e.currency) set.add(e.currency.toUpperCase());
        });
        return Array.from(set).sort();
    }, [events]);

    const getCurrencyInfo = (curr: string) => {
        const code = (curr || 'USD').toUpperCase();
        return CURRENCY_COUNTRY_MAP[code] || { flag: '🌐', country: code };
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

    // Filter events (all day boundaries in the user's local timezone — same as the times shown)
    const filteredEvents = useMemo(() => {
        const todayStr = localDayKey(new Date());
        const tomorrowStr = localDayKey(addDays(new Date(), 1));
        const nextWeekStr = localDayKey(addDays(new Date(), 7));

        return events.filter(evt => {
            // Search
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                const eventName = (evt.title || evt.event || '').toLowerCase();
                const matchName = eventName.includes(term);
                const matchCurrency = (evt.currency || '').toLowerCase().includes(term);
                const matchCountry = (evt.country || '').toLowerCase().includes(term);
                if (!matchName && !matchCurrency && !matchCountry) return false;
            }

            // Impact Filter
            if (impactFilter !== 'ALL') {
                const evtImpact = (evt.impact || '').toUpperCase();
                if (evtImpact !== impactFilter) return false;
            }

            // Currency Filter
            if (currencyFilter !== 'ALL') {
                if ((evt.currency || '').toUpperCase() !== currencyFilter.toUpperCase()) return false;
            }

            // Period Filter
            const eventDateStr = eventDayKey(evt);
            if (eventDateStr) {
                if (periodFilter === 'today' && eventDateStr !== todayStr) return false;
                if (periodFilter === 'tomorrow' && eventDateStr !== tomorrowStr) return false;
                if (periodFilter === 'this_week' && (eventDateStr < todayStr || eventDateStr > nextWeekStr)) return false;
            }

            return true;
        });
    }, [events, searchTerm, impactFilter, currencyFilter, periodFilter]);

    // Group events by date
    const groupedEvents = useMemo(() => {
        const groups: Record<string, EconomicEvent[]> = {};
        for (const evt of filteredEvents) {
            const dateStr = eventDayKey(evt) || 'Próximos';
            if (!groups[dateStr]) groups[dateStr] = [];
            groups[dateStr].push(evt);
        }

        // Sort by time within each date
        Object.keys(groups).forEach(dateKey => {
            groups[dateKey].sort((a, b) => {
                return (eventDate(a)?.getTime() ?? 0) - (eventDate(b)?.getTime() ?? 0);
            });
        });

        return groups;
    }, [filteredEvents]);

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

    return (
        <div className="space-y-4 max-w-6xl mx-auto pb-16 px-2 sm:px-4">
            {/* Clean Header Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-line">
                <div>
                    <h1 className="text-xl font-bold text-fg flex items-center gap-2">
                        <Calendar size={20} className="text-accent-fg" />
                        Calendário Econômico
                    </h1>
                    <p className="text-xs text-fg-muted mt-0.5">
                        Divulgações macroeconômicas · horários no seu fuso ({tzLabel})
                    </p>
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                    <span className="text-[11px] text-fg-subtle hidden md:inline">
                        Sincronizado: {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <Button
                        onClick={() => fetchCalendar(true)}
                        variant="secondary"
                        icon={<RefreshCw size={13} className={isRefreshing || loading ? 'animate-spin text-accent-fg' : ''} />}
                        className="bg-surface hover:bg-surface-2 text-fg border border-line text-xs py-1.5 px-3"
                    >
                        Atualizar
                    </Button>
                </div>
            </div>

            {/* Simplified Filter Toolbar */}
            <div className="bg-surface border border-line rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                {/* Search Input */}
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                    <input
                        type="text"
                        placeholder="Buscar notícia..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-canvas border border-line text-xs rounded-lg pl-8 pr-7 py-1.5 text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg/80"
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>

                {/* Period Pills */}
                <div className="flex items-center gap-1 bg-canvas p-1 rounded-lg border border-line">
                    {[
                        { id: 'all', label: 'Todos' },
                        { id: 'today', label: 'Hoje' },
                        { id: 'tomorrow', label: 'Amanhã' },
                        { id: 'this_week', label: '7 Dias' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setPeriodFilter(tab.id as any)}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                                periodFilter === tab.id
                                    ? 'bg-surface-2 text-fg shadow-sm ring-1 ring-line-strong'
                                    : 'text-fg-muted hover:text-fg'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Impact Filter */}
                <div className="flex items-center gap-1 bg-canvas p-1 rounded-lg border border-line">
                    <span className="text-[10px] uppercase font-bold text-fg-subtle px-1.5">Impacto:</span>
                    <button
                        onClick={() => setImpactFilter('ALL')}
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                            impactFilter === 'ALL' ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg'
                        }`}
                    >
                        Todos
                    </button>
                    <button
                        onClick={() => setImpactFilter('HIGH')}
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            impactFilter === 'HIGH' ? IMPACT.HIGH.active : IMPACT.HIGH.idle
                        }`}
                    >
                        Alto
                    </button>
                    <button
                        onClick={() => setImpactFilter('MEDIUM')}
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            impactFilter === 'MEDIUM' ? IMPACT.MEDIUM.active : IMPACT.MEDIUM.idle
                        }`}
                    >
                        Médio
                    </button>
                    <button
                        onClick={() => setImpactFilter('LOW')}
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            impactFilter === 'LOW' ? IMPACT.LOW.active : IMPACT.LOW.idle
                        }`}
                    >
                        Baixo
                    </button>
                </div>

                {/* Currency Dropdown */}
                {availableCurrencies.length > 0 && (
                    <select
                        value={currencyFilter}
                        onChange={(e) => setCurrencyFilter(e.target.value)}
                        className="bg-canvas border border-line text-fg text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
                    >
                        <option value="ALL">Todas Moedas</option>
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
                <div className="py-20 text-center space-y-2 text-fg-subtle text-xs">
                    <RefreshCw size={22} className="animate-spin mx-auto text-accent-fg mb-2" />
                    Carregando calendário econômico...
                </div>
            ) : sortedDates.length === 0 ? (
                <div className="py-20 text-center space-y-3 bg-surface rounded-xl border border-line p-8">
                    <Calendar size={36} className="mx-auto text-fg-subtle" />
                    <h3 className="text-sm font-semibold text-fg">
                        Nenhum evento econômico cadastrado
                    </h3>
                    <p className="text-fg-muted text-xs max-w-sm mx-auto">
                        Não há notícias ou dados publicados para os filtros selecionados. Novos eventos adicionados pelo admin aparecerão aqui.
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
                        className="text-xs py-1 px-3 mt-2"
                    >
                        Limpar Filtros
                    </Button>
                </div>
            ) : (
                <div className="space-y-4">
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
                                <div className={`px-4 py-2.5 border-b border-line flex items-center justify-between ${
                                    isToday ? 'bg-accent/[0.06]' : 'bg-canvas'
                                }`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${isToday ? 'bg-accent' : 'bg-fg-subtle/40'}`} />
                                        <h3 className="text-xs font-bold text-fg capitalize">
                                            {dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                                        </h3>
                                        {isToday && (
                                            <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent-fg text-[10px] font-bold uppercase">
                                                Hoje
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[11px] text-fg-subtle font-mono">
                                        {dayEvents.length} {dayEvents.length === 1 ? 'evento' : 'eventos'}
                                    </span>
                                </div>

                                {/* Table Column Headers (Desktop) */}
                                <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-fg-subtle bg-canvas border-b border-line">
                                    <div className="col-span-1">Hora</div>
                                    <div className="col-span-2">Moeda</div>
                                    <div className="col-span-2">Impacto</div>
                                    <div className="col-span-4">Notícia / Evento</div>
                                    <div className="col-span-1 text-right">Atual</div>
                                    <div className="col-span-1 text-right">Previsão</div>
                                    <div className="col-span-1 text-right">Anterior</div>
                                </div>

                                {/* Event Rows */}
                                <div className="divide-y divide-line">
                                    {dayEvents.map((evt) => {
                                        const impact = impactOf(evt.impact);

                                        const evDate = eventDate(evt);
                                        const timeDisplay = evDate && hasTime(evt)
                                            ? evDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                                            : '--:--';

                                        const currencyInfo = getCurrencyInfo(evt.currency);
                                        const comparison = compareActualVsForecast(evt.actual, evt.forecast);

                                        return (
                                            <div
                                                key={evt.id}
                                                onClick={() => handleOpenDetail(evt)}
                                                className="px-4 py-3 md:py-2.5 grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 items-center hover:bg-surface-2 cursor-pointer transition-colors text-xs"
                                            >
                                                {/* Time */}
                                                <div className="md:col-span-1 font-mono font-semibold text-fg tabular-nums">
                                                    {timeDisplay}
                                                </div>

                                                {/* Currency */}
                                                <div className="md:col-span-2 flex items-center gap-1.5 font-semibold text-fg">
                                                    <span>{currencyInfo.flag}</span>
                                                    <span>{evt.currency}</span>
                                                    {evt.country && (
                                                        <span className="text-[10px] text-fg-subtle truncate hidden lg:inline">
                                                            ({evt.country})
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Impact */}
                                                <div className="md:col-span-2">
                                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${impact.badge}`}>
                                                        {impact.label}
                                                    </span>
                                                </div>

                                                {/* Title */}
                                                <div className="md:col-span-4 flex items-center gap-2">
                                                    <span className="font-medium text-fg truncate" title={evt.title || evt.event}>
                                                        {evt.title || evt.event}
                                                    </span>
                                                    {evt.status === 'COMPLETED' && (
                                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent/15 text-accent-fg flex-shrink-0">
                                                            Publicado
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Actual */}
                                                <div className="md:col-span-1 text-right font-mono">
                                                    <span className="md:hidden text-fg-subtle mr-2 text-[10px]">Atual:</span>
                                                    <span className={`font-bold ${evt.actual ? 'text-fg' : 'text-fg-subtle'}`}>
                                                        {evt.actual ? `${evt.actual}${evt.unit ? ` ${evt.unit}` : ''}` : '—'}
                                                    </span>
                                                    {evt.actual && comparison && comparison !== 'EQUAL' && (
                                                        <span className="ml-1 text-[10px] text-fg-subtle" title={comparison === 'HIGHER' ? 'Acima da previsão' : 'Abaixo da previsão'}>
                                                            <span aria-hidden>{comparison === 'HIGHER' ? '▲' : '▼'}</span>
                                                            <span className="sr-only">{comparison === 'HIGHER' ? 'acima da previsão' : 'abaixo da previsão'}</span>
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Forecast */}
                                                <div className="md:col-span-1 text-right font-mono text-fg-muted tabular-nums">
                                                    <span className="md:hidden text-fg-subtle mr-2 text-[10px]">Prev:</span>
                                                    {evt.forecast ? `${evt.forecast}${evt.unit ? ` ${evt.unit}` : ''}` : '—'}
                                                </div>

                                                {/* Previous */}
                                                <div className="md:col-span-1 text-right font-mono text-fg-subtle tabular-nums">
                                                    <span className="md:hidden text-fg-subtle mr-2 text-[10px]">Ant:</span>
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
                title={selectedEvent ? `${selectedEvent.currency} • ${selectedEvent.title || selectedEvent.event}` : 'Detalhes do Evento'}
            >
                {selectedEvent && (
                    <div className="space-y-4 text-fg/80 text-xs">
                        {/* Event Basic Info */}
                        <div className="flex items-center justify-between p-3 rounded-lg bg-canvas border border-line">
                            <div className="flex items-center gap-2">
                                <span className="text-2xl">{getCurrencyInfo(selectedEvent.currency).flag}</span>
                                <div>
                                    <div className="font-bold text-fg">
                                        {selectedEvent.currency} - {selectedEvent.country || getCurrencyInfo(selectedEvent.currency).country}
                                    </div>
                                    <div className="text-[11px] text-fg-muted">
                                        Impacto: <strong className="text-fg">{impactOf(selectedEvent.impact).label}</strong>
                                    </div>
                                </div>
                            </div>
                            <div className="text-right font-mono">
                                <div className="text-xs font-bold text-fg">
                                    {selectedEvent.eventDate || selectedEvent.time ? (
                                        (eventDate(selectedEvent)?.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) ?? '--')
                                    ) : '--'}
                                </div>
                                <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                                    selectedEvent.status === 'COMPLETED' || selectedEvent.actual
                                        ? 'bg-accent/15 text-accent-fg' 
                                        : 'bg-surface-2 text-fg-muted'
                                }`}>
                                    {selectedEvent.status === 'COMPLETED' || selectedEvent.actual ? 'Divulgado' : 'Agendado'}
                                </span>
                            </div>
                        </div>

                        {/* Numbers Comparison */}
                        <div className="grid grid-cols-3 gap-2">
                            <div className="p-3 rounded-lg bg-canvas border border-line text-center">
                                <span className="text-[10px] uppercase font-bold text-fg-subtle block mb-1">Atual</span>
                                <div className={`text-base font-bold font-mono ${selectedEvent.actual ? 'text-fg' : 'text-fg-subtle'}`}>
                                    {selectedEvent.actual ? `${selectedEvent.actual}${selectedEvent.unit ? ` ${selectedEvent.unit}` : ''}` : '—'}
                                </div>
                            </div>
                            <div className="p-3 rounded-lg bg-canvas border border-line text-center">
                                <span className="text-[10px] uppercase font-bold text-fg-subtle block mb-1">Previsão</span>
                                <div className="text-base font-bold font-mono text-fg">
                                    {selectedEvent.forecast ? `${selectedEvent.forecast}${selectedEvent.unit ? ` ${selectedEvent.unit}` : ''}` : '—'}
                                </div>
                            </div>
                            <div className="p-3 rounded-lg bg-canvas border border-line text-center">
                                <span className="text-[10px] uppercase font-bold text-fg-subtle block mb-1">Anterior</span>
                                <div className="text-base font-bold font-mono text-fg-muted">
                                    {selectedEvent.previous ? `${selectedEvent.previous}${selectedEvent.unit ? ` ${selectedEvent.unit}` : ''}` : '—'}
                                </div>
                            </div>
                        </div>

                        {/* Description */}
                        {selectedEvent.description && (
                            <div className="p-3 rounded-lg bg-canvas border border-line space-y-1">
                                <div className="font-semibold text-fg text-xs flex items-center gap-1">
                                    <Info size={13} className="text-accent-fg" />
                                    <span>Descrição / Análise</span>
                                </div>
                                <p className="text-fg/80 text-xs leading-relaxed">
                                    {selectedEvent.description}
                                </p>
                            </div>
                        )}

                        <div className="flex justify-end pt-2">
                            <Button variant="secondary" onClick={() => setIsDetailModalOpen(false)}>
                                Fechar
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default EconomicCalendar;
