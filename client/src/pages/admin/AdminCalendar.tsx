import { useState, useEffect, useMemo } from 'react';
import { 
    Calendar as CalendarIcon, Search, Plus, Clock, 
    CheckCircle2, XCircle, Copy, Trash2, Edit, Check, History, 
    ChevronLeft, ChevronRight, CalendarDays
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import api from '../../api';

interface EconomicEvent {
    id: string;
    title: string;
    country: string;
    currency: string;
    category: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED';
    eventDate: string;
    time?: string;
    actual?: string;
    forecast?: string;
    previous?: string;
    unit?: string;
    description?: string;
    source?: string;
}

interface AuditHistoryItem {
    id: string;
    action: string;
    changedBy: string;
    createdAt: string;
    oldData: any;
    newData: any;
}

export const AdminCalendar = () => {
    const [events, setEvents] = useState<EconomicEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [totalEvents, setTotalEvents] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 20;

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [currencyFilter, setCurrencyFilter] = useState('ALL');
    const [impactFilter, setImpactFilter] = useState('ALL');
    const [categoryFilter, setCategoryFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [dateRange, setDateRange] = useState({ from: '', to: '' });

    // Modals
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
    const [isPostponeModalOpen, setIsPostponeModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

    // Active Selection
    const [selectedEvent, setSelectedEvent] = useState<EconomicEvent | null>(null);
    const [auditHistory, setAuditHistory] = useState<AuditHistoryItem[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // Form states
    const [formData, setFormData] = useState({
        title: '',
        currency: 'USD',
        country: 'United States',
        category: 'EMPLOYMENT',
        impact: 'HIGH',
        eventDate: '',
        forecast: '',
        previous: '',
        actual: '',
        unit: '',
        description: '',
        status: 'SCHEDULED'
    });

    const [actualInput, setActualInput] = useState('');
    const [postponeDate, setPostponeDate] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const categories = [
        'EMPLOYMENT', 'INFLATION', 'INTEREST_RATE', 'GDP', 
        'MANUFACTURING', 'SERVICES', 'CONSUMER', 'HOUSING', 
        'TRADE', 'CENTRAL_BANK', 'GOVERNMENT', 'ENERGY', 'HOLIDAY', 'OTHER'
    ];

    const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY', 'BRL', 'ZAR'];

    const fetchEvents = async () => {
        setIsLoading(true);
        try {
            const params: any = {
                page: currentPage,
                limit: pageSize
            };
            if (searchTerm) params.search = searchTerm;
            if (currencyFilter !== 'ALL') params.currency = currencyFilter;
            if (impactFilter !== 'ALL') params.impact = impactFilter;
            if (categoryFilter !== 'ALL') params.category = categoryFilter;
            if (statusFilter !== 'ALL') params.status = statusFilter;
            if (dateRange.from) params.from = dateRange.from;
            if (dateRange.to) params.to = dateRange.to;

            const res = await api.get('/admin/economic-calendar', { params });
            if (res.data) {
                setEvents(res.data.data || []);
                setTotalEvents(res.data.pagination?.total || 0);
            }
        } catch (error) {
            console.error('Falha ao carregar eventos:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchEvents();
    }, [currentPage, currencyFilter, impactFilter, categoryFilter, statusFilter, dateRange]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setCurrentPage(1);
        fetchEvents();
    };

    // Open Create Modal
    const handleOpenCreate = () => {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const defaultDate = now.toISOString().slice(0, 16);

        setFormData({
            title: '',
            currency: 'USD',
            country: 'United States',
            category: 'EMPLOYMENT',
            impact: 'HIGH',
            eventDate: defaultDate,
            forecast: '',
            previous: '',
            actual: '',
            unit: '',
            description: '',
            status: 'SCHEDULED'
        });
        setIsCreateModalOpen(true);
    };

    // Open Edit Modal
    const handleOpenEdit = (evt: EconomicEvent) => {
        setSelectedEvent(evt);
        let dateVal = '';
        if (evt.eventDate) {
            const d = new Date(evt.eventDate);
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            dateVal = d.toISOString().slice(0, 16);
        }

        setFormData({
            title: evt.title,
            currency: evt.currency,
            country: evt.country || '',
            category: evt.category || 'OTHER',
            impact: evt.impact || 'MEDIUM',
            eventDate: dateVal,
            forecast: evt.forecast || '',
            previous: evt.previous || '',
            actual: evt.actual || '',
            unit: evt.unit || '',
            description: evt.description || '',
            status: evt.status || 'SCHEDULED'
        });
        setIsEditModalOpen(true);
    };

    // Open Complete Modal
    const handleOpenComplete = (evt: EconomicEvent) => {
        setSelectedEvent(evt);
        setActualInput(evt.actual || evt.forecast || '');
        setIsCompleteModalOpen(true);
    };

    // Open Postpone Modal
    const handleOpenPostpone = (evt: EconomicEvent) => {
        setSelectedEvent(evt);
        let dateVal = '';
        if (evt.eventDate) {
            const d = new Date(evt.eventDate);
            d.setDate(d.getDate() + 1); // Default suggest next day
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            dateVal = d.toISOString().slice(0, 16);
        }
        setPostponeDate(dateVal);
        setIsPostponeModalOpen(true);
    };

    // Open History Modal
    const handleOpenHistory = async (evt: EconomicEvent) => {
        setSelectedEvent(evt);
        setIsHistoryModalOpen(true);
        setIsLoadingHistory(true);
        try {
            const res = await api.get(`/admin/economic-calendar/${evt.id}`);
            setAuditHistory(res.data.history || []);
        } catch (err) {
            console.error('Falha ao carregar histórico:', err);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    // Submit Create
    const handleCreateSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await api.post('/admin/economic-calendar', {
                ...formData,
                eventDate: new Date(formData.eventDate).toISOString()
            });
            setIsCreateModalOpen(false);
            fetchEvents();
        } catch (err: any) {
            alert('Erro ao criar evento: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsSubmitting(false);
        }
    };

    // Submit Edit
    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEvent) return;
        setIsSubmitting(true);
        try {
            await api.patch(`/admin/economic-calendar/${selectedEvent.id}`, {
                ...formData,
                eventDate: new Date(formData.eventDate).toISOString()
            });
            setIsEditModalOpen(false);
            fetchEvents();
        } catch (err: any) {
            alert('Erro ao editar evento: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsSubmitting(false);
        }
    };

    // Submit Complete
    const handleCompleteSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEvent) return;
        setIsSubmitting(true);
        try {
            await api.post(`/admin/economic-calendar/${selectedEvent.id}/complete`, {
                actual: actualInput
            });
            setIsCompleteModalOpen(false);
            fetchEvents();
        } catch (err: any) {
            alert('Erro ao publicar resultado: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsSubmitting(false);
        }
    };

    // Submit Postpone
    const handlePostponeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEvent) return;
        setIsSubmitting(true);
        try {
            await api.post(`/admin/economic-calendar/${selectedEvent.id}/postpone`, {
                newEventDate: new Date(postponeDate).toISOString()
            });
            setIsPostponeModalOpen(false);
            fetchEvents();
        } catch (err: any) {
            alert('Erro ao adiar evento: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsSubmitting(false);
        }
    };

    // Cancel Event
    const handleCancelEvent = async (evt: EconomicEvent) => {
        if (!confirm(`Tem certeza que deseja marcar "${evt.title}" como CANCELADO?`)) return;
        try {
            await api.post(`/admin/economic-calendar/${evt.id}/cancel`, {});
            fetchEvents();
        } catch (err: any) {
            alert('Erro ao cancelar evento: ' + (err.response?.data?.message || err.message));
        }
    };

    // Duplicate Event
    const handleDuplicateEvent = async (evt: EconomicEvent) => {
        if (!confirm(`Deseja duplicar o evento "${evt.title}"?`)) return;
        try {
            await api.post(`/admin/economic-calendar/${evt.id}/duplicate`, {});
            alert('Evento duplicado com sucesso! Você pode editá-lo para ajustar a nova data.');
            fetchEvents();
        } catch (err: any) {
            alert('Erro ao duplicar evento: ' + (err.response?.data?.message || err.message));
        }
    };

    // Delete Event
    const handleDeleteEvent = async (evt: EconomicEvent) => {
        if (!confirm(`ATENÇÃO: Deseja realmente excluir permanentemente "${evt.title}"? Esta ação será registrada na auditoria.`)) return;
        try {
            await api.delete(`/admin/economic-calendar/${evt.id}`);
            fetchEvents();
        } catch (err: any) {
            alert('Erro ao excluir evento: ' + (err.response?.data?.message || err.message));
        }
    };

    // KPIs summary
    const highImpactCount = useMemo(() => events.filter(e => e.impact === 'HIGH').length, [events]);
    const scheduledCount = useMemo(() => events.filter(e => e.status === 'SCHEDULED').length, [events]);
    const completedCount = useMemo(() => events.filter(e => e.status === 'COMPLETED').length, [events]);

    const totalPages = Math.ceil(totalEvents / pageSize);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-fg flex items-center gap-3">
                        <CalendarIcon className="text-emerald-500" size={28} />
                        Calendário Econômico
                    </h1>
                    <p className="text-sm text-fg-muted mt-1">
                        Gerenciamento manual, divulgação de resultados macroeconômicos e auditoria interna
                    </p>
                </div>
                <Button onClick={handleOpenCreate} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500">
                    <Plus size={18} /> Novo Evento
                </Button>
            </div>

            {/* Quick KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-surface/60 border border-line rounded-xl p-4">
                    <span className="text-xs font-bold text-fg-muted uppercase tracking-wider">Total de Eventos</span>
                    <div className="text-2xl font-bold text-fg mt-1">{totalEvents}</div>
                    <span className="text-[10px] text-fg-subtle">Cadastrados no TorexJournal</span>
                </div>
                <div className="bg-surface/60 border border-line rounded-xl p-4">
                    <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Alto Impacto</span>
                    <div className="text-2xl font-bold text-red-400 mt-1">{highImpactCount}</div>
                    <span className="text-[10px] text-fg-subtle">Na página atual</span>
                </div>
                <div className="bg-surface/60 border border-line rounded-xl p-4">
                    <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Agendados</span>
                    <div className="text-2xl font-bold text-blue-400 mt-1">{scheduledCount}</div>
                    <span className="text-[10px] text-fg-subtle">Aguardando divulgação</span>
                </div>
                <div className="bg-surface/60 border border-line rounded-xl p-4">
                    <span className="text-xs font-bold text-accent-fg uppercase tracking-wider">Concluídos</span>
                    <div className="text-2xl font-bold text-accent-fg mt-1">{completedCount}</div>
                    <span className="text-[10px] text-fg-subtle">Com resultado publicado</span>
                </div>
            </div>

            {/* Filters Bar */}
            <Card className="border-line bg-surface/50 p-4">
                <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[220px] relative">
                        <Search className="absolute left-3 top-2.5 text-fg-subtle" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar notícia, país ou moeda..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-canvas border border-line rounded-xl pl-9 pr-4 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500"
                        />
                    </div>

                    <select
                        value={currencyFilter}
                        onChange={(e) => { setCurrencyFilter(e.target.value); setCurrentPage(1); }}
                        className="bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                        <option value="ALL">Todas Moedas</option>
                        {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>

                    <select
                        value={impactFilter}
                        onChange={(e) => { setImpactFilter(e.target.value); setCurrentPage(1); }}
                        className="bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                        <option value="ALL">Todos Impactos</option>
                        <option value="HIGH">🔴 Alto Impacto (HIGH)</option>
                        <option value="MEDIUM">🟠 Médio Impacto (MEDIUM)</option>
                        <option value="LOW">🟡 Baixo Impacto (LOW)</option>
                    </select>

                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                        className="bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                        <option value="ALL">Todos Status</option>
                        <option value="SCHEDULED">Agendado (SCHEDULED)</option>
                        <option value="COMPLETED">Concluído (COMPLETED)</option>
                        <option value="CANCELLED">Cancelado (CANCELLED)</option>
                        <option value="POSTPONED">Adiado (POSTPONED)</option>
                    </select>

                    <select
                        value={categoryFilter}
                        onChange={(e) => { setCategoryFilter(e.target.value); setCurrentPage(1); }}
                        className="bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                        <option value="ALL">Todas Categorias</option>
                        {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>

                    <input
                        type="date"
                        value={dateRange.from}
                        onChange={(e) => { setDateRange(prev => ({ ...prev, from: e.target.value })); setCurrentPage(1); }}
                        className="bg-canvas border border-line rounded-xl px-2 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500"
                        title="Data inicial"
                    />
                    <input
                        type="date"
                        value={dateRange.to}
                        onChange={(e) => { setDateRange(prev => ({ ...prev, to: e.target.value })); setCurrentPage(1); }}
                        className="bg-canvas border border-line rounded-xl px-2 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500"
                        title="Data final"
                    />

                    <Button type="submit" variant="secondary" className="text-xs py-2">
                        Buscar
                    </Button>
                </form>
            </Card>

            {/* Table */}
            <Card className="border-line bg-surface/50 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-fg-muted">
                        <thead className="bg-surface text-fg/80 uppercase font-bold text-[10px] tracking-wider border-b border-line">
                            <tr>
                                <th className="px-4 py-3.5">Data / Hora (UTC)</th>
                                <th className="px-4 py-3.5">Moeda / País</th>
                                <th className="px-4 py-3.5">Evento</th>
                                <th className="px-4 py-3.5">Categoria</th>
                                <th className="px-4 py-3.5 text-center">Impacto</th>
                                <th className="px-4 py-3.5 text-right">Anterior</th>
                                <th className="px-4 py-3.5 text-right">Previsão</th>
                                <th className="px-4 py-3.5 text-right font-bold text-fg">Resultado (Actual)</th>
                                <th className="px-4 py-3.5 text-center">Status</th>
                                <th className="px-4 py-3.5 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line font-mono">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={10} className="px-6 py-12 text-center text-fg-subtle font-sans">
                                        Carregando eventos...
                                    </td>
                                </tr>
                            ) : events.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-6 py-12 text-center text-fg-subtle font-sans">
                                        Nenhum evento econômico cadastrado para os filtros selecionados.
                                    </td>
                                </tr>
                            ) : (
                                events.map((evt) => {
                                    const eventDateObj = new Date(evt.eventDate);
                                    const dateStr = eventDateObj.toLocaleDateString('pt-BR');
                                    const timeStr = eventDateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

                                    return (
                                        <tr key={evt.id} className="hover:bg-surface-2/40 transition-colors">
                                            {/* Date / Time */}
                                            <td className="px-4 py-3 whitespace-nowrap text-fg/80">
                                                <div className="font-bold">{dateStr}</div>
                                                <div className="text-[10px] text-fg-subtle flex items-center gap-1">
                                                    <Clock size={10} /> {timeStr}
                                                </div>
                                            </td>

                                            {/* Currency / Country */}
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className="px-2 py-0.5 rounded font-bold bg-surface-2 text-fg border border-line-strong">
                                                    {evt.currency}
                                                </span>
                                                {evt.country && (
                                                    <span className="ml-2 text-[11px] text-fg-muted font-sans">
                                                        {evt.country}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Title */}
                                            <td className="px-4 py-3 font-sans font-medium text-fg min-w-[200px]">
                                                {evt.title}
                                                {evt.description && (
                                                    <div className="text-[10px] text-fg-subtle line-clamp-1 mt-0.5">
                                                        {evt.description}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Category */}
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className="text-[10px] px-2 py-0.5 rounded bg-surface-2 text-fg-muted border border-line-strong font-sans">
                                                    {evt.category}
                                                </span>
                                            </td>

                                            {/* Impact */}
                                            <td className="px-4 py-3 text-center whitespace-nowrap">
                                                {evt.impact === 'HIGH' ? (
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/30">
                                                        HIGH
                                                    </span>
                                                ) : evt.impact === 'MEDIUM' ? (
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                                                        MEDIUM
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-500/10 text-fg-muted border border-slate-500/30">
                                                        LOW
                                                    </span>
                                                )}
                                            </td>

                                            {/* Previous */}
                                            <td className="px-4 py-3 text-right text-fg-muted">
                                                {evt.previous || '-'}
                                            </td>

                                            {/* Forecast */}
                                            <td className="px-4 py-3 text-right text-fg/80">
                                                {evt.forecast || '-'}
                                            </td>

                                            {/* Actual */}
                                            <td className="px-4 py-3 text-right">
                                                {evt.actual ? (
                                                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                                                        {evt.actual}
                                                    </span>
                                                ) : (
                                                    <button
                                                        onClick={() => handleOpenComplete(evt)}
                                                        className="text-[11px] font-sans font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/30 transition-colors"
                                                    >
                                                        + Lançar
                                                    </button>
                                                )}
                                            </td>

                                            {/* Status */}
                                            <td className="px-4 py-3 text-center whitespace-nowrap">
                                                {evt.status === 'COMPLETED' ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-accent-fg font-sans font-bold">
                                                        <CheckCircle2 size={12} /> Concluído
                                                    </span>
                                                ) : evt.status === 'CANCELLED' ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-danger-fg font-sans font-bold">
                                                        <XCircle size={12} /> Cancelado
                                                    </span>
                                                ) : evt.status === 'POSTPONED' ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-purple-400 font-sans font-bold">
                                                        <Clock size={12} /> Adiado
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-blue-400 font-sans font-bold">
                                                        <CalendarDays size={12} /> Agendado
                                                    </span>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1.5 font-sans">
                                                    {/* Complete button */}
                                                    <button
                                                        onClick={() => handleOpenComplete(evt)}
                                                        title="Lançar Resultado"
                                                        className="p-1.5 rounded hover:bg-emerald-500/20 text-accent-fg transition-colors"
                                                    >
                                                        <Check size={14} />
                                                    </button>

                                                    {/* Edit button */}
                                                    <button
                                                        onClick={() => handleOpenEdit(evt)}
                                                        title="Editar Evento"
                                                        className="p-1.5 rounded hover:bg-surface-3 text-fg/80 transition-colors"
                                                    >
                                                        <Edit size={14} />
                                                    </button>

                                                    {/* Postpone button */}
                                                    <button
                                                        onClick={() => handleOpenPostpone(evt)}
                                                        title="Adiar Evento"
                                                        className="p-1.5 rounded hover:bg-purple-500/20 text-purple-400 transition-colors"
                                                    >
                                                        <Clock size={14} />
                                                    </button>

                                                    {/* Duplicate button */}
                                                    <button
                                                        onClick={() => handleDuplicateEvent(evt)}
                                                        title="Duplicar Evento"
                                                        className="p-1.5 rounded hover:bg-blue-500/20 text-blue-400 transition-colors"
                                                    >
                                                        <Copy size={14} />
                                                    </button>

                                                    {/* History button */}
                                                    <button
                                                        onClick={() => handleOpenHistory(evt)}
                                                        title="Histórico de Auditoria"
                                                        className="p-1.5 rounded hover:bg-surface-3 text-fg-muted transition-colors"
                                                    >
                                                        <History size={14} />
                                                    </button>

                                                    {/* Cancel button */}
                                                    {evt.status !== 'CANCELLED' && (
                                                        <button
                                                            onClick={() => handleCancelEvent(evt)}
                                                            title="Cancelar Notícia"
                                                            className="p-1.5 rounded hover:bg-rose-500/20 text-danger-fg transition-colors"
                                                        >
                                                            <XCircle size={14} />
                                                        </button>
                                                    )}

                                                    {/* Delete button */}
                                                    <button
                                                        onClick={() => handleDeleteEvent(evt)}
                                                        title="Excluir Permanentemente"
                                                        className="p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="p-4 border-t border-line flex justify-between items-center text-xs text-fg-muted">
                    <div>
                        Mostrando {events.length} de {totalEvents} eventos
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5"
                        >
                            <ChevronLeft size={16} />
                        </Button>
                        <span className="font-bold text-fg">
                            Página {currentPage} de {totalPages || 1}
                        </span>
                        <Button
                            variant="secondary"
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage >= totalPages}
                            className="p-1.5"
                        >
                            <ChevronRight size={16} />
                        </Button>
                    </div>
                </div>
            </Card>

            {/* ========================================= */}
            {/* MODAL: CRIAR EVENTO                       */}
            {/* ========================================= */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title="Cadastrar Novo Evento Macroeconômico"
            >
                <form onSubmit={handleCreateSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-fg/80 mb-1">Título do Evento *</label>
                        <input
                            type="text"
                            required
                            placeholder="Ex: Non-Farm Payrolls, Taxa de Inflação CPI"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Moeda (3 letras) *</label>
                            <input
                                type="text"
                                required
                                maxLength={10}
                                placeholder="USD, EUR, GBP..."
                                value={formData.currency}
                                onChange={(e) => setFormData({ ...formData, currency: e.target.value.toUpperCase() })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500 uppercase font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">País / Região</label>
                            <input
                                type="text"
                                placeholder="Ex: United States, Eurozone"
                                value={formData.country}
                                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Impacto *</label>
                            <select
                                value={formData.impact}
                                onChange={(e) => setFormData({ ...formData, impact: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500"
                            >
                                <option value="HIGH">🔴 Alto Impacto (HIGH)</option>
                                <option value="MEDIUM">🟠 Médio Impacto (MEDIUM)</option>
                                <option value="LOW">🟡 Baixo Impacto (LOW)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Categoria *</label>
                            <select
                                value={formData.category}
                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500"
                            >
                                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-fg/80 mb-1">Data e Hora *</label>
                        <input
                            type="datetime-local"
                            required
                            value={formData.eventDate}
                            onChange={(e) => setFormData({ ...formData, eventDate: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500"
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Anterior (Previous)</label>
                            <input
                                type="text"
                                placeholder="Ex: 135K ou 4.0%"
                                value={formData.previous}
                                onChange={(e) => setFormData({ ...formData, previous: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500 font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Previsão (Forecast)</label>
                            <input
                                type="text"
                                placeholder="Ex: 145K ou 4.1%"
                                value={formData.forecast}
                                onChange={(e) => setFormData({ ...formData, forecast: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500 font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Unidade (Unit)</label>
                            <input
                                type="text"
                                placeholder="Ex: %, K, M, B, pts"
                                value={formData.unit}
                                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500 font-mono"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-fg/80 mb-1">Descrição / Contexto</label>
                        <textarea
                            rows={2}
                            placeholder="Observações contextuais sobre a notícia..."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500 resize-none"
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-line">
                        <Button type="button" variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isSubmitting} className="bg-emerald-600 hover:bg-emerald-500">
                            {isSubmitting ? 'Salvando...' : 'Salvar Evento'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* ========================================= */}
            {/* MODAL: EDITAR EVENTO                      */}
            {/* ========================================= */}
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title="Editar Evento Macroeconômico"
            >
                <form onSubmit={handleEditSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-fg/80 mb-1">Título do Evento *</label>
                        <input
                            type="text"
                            required
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Moeda *</label>
                            <input
                                type="text"
                                required
                                value={formData.currency}
                                onChange={(e) => setFormData({ ...formData, currency: e.target.value.toUpperCase() })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500 uppercase font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">País</label>
                            <input
                                type="text"
                                value={formData.country}
                                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Impacto *</label>
                            <select
                                value={formData.impact}
                                onChange={(e) => setFormData({ ...formData, impact: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500"
                            >
                                <option value="HIGH">🔴 Alto</option>
                                <option value="MEDIUM">🟠 Médio</option>
                                <option value="LOW">🟡 Baixo</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Categoria *</label>
                            <select
                                value={formData.category}
                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500"
                            >
                                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Status</label>
                            <select
                                value={formData.status}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg/80 focus:outline-none focus:border-emerald-500"
                            >
                                <option value="SCHEDULED">SCHEDULED</option>
                                <option value="COMPLETED">COMPLETED</option>
                                <option value="CANCELLED">CANCELLED</option>
                                <option value="POSTPONED">POSTPONED</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-fg/80 mb-1">Data e Hora *</label>
                        <input
                            type="datetime-local"
                            required
                            value={formData.eventDate}
                            onChange={(e) => setFormData({ ...formData, eventDate: e.target.value })}
                            className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500"
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Anterior</label>
                            <input
                                type="text"
                                value={formData.previous}
                                onChange={(e) => setFormData({ ...formData, previous: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500 font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Previsão</label>
                            <input
                                type="text"
                                value={formData.forecast}
                                onChange={(e) => setFormData({ ...formData, forecast: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500 font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-fg/80 mb-1">Resultado (Actual)</label>
                            <input
                                type="text"
                                value={formData.actual}
                                onChange={(e) => setFormData({ ...formData, actual: e.target.value })}
                                className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-emerald-500 font-mono"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-line">
                        <Button type="button" variant="secondary" onClick={() => setIsEditModalOpen(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-500">
                            {isSubmitting ? 'Atualizando...' : 'Salvar Alterações'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* ========================================= */}
            {/* MODAL: LANÇAR RESULTADO (COMPLETE)        */}
            {/* ========================================= */}
            <Modal
                isOpen={isCompleteModalOpen}
                onClose={() => setIsCompleteModalOpen(false)}
                title="Publicar Resultado da Notícia (Actual)"
            >
                <form onSubmit={handleCompleteSubmit} className="space-y-4">
                    <div className="p-3 bg-canvas border border-line rounded-xl text-xs space-y-1.5">
                        <div className="text-fg font-bold">{selectedEvent?.title}</div>
                        <div className="text-fg-muted">Moeda: <span className="text-fg font-mono">{selectedEvent?.currency}</span> • Impacto: <span className="font-bold text-red-400">{selectedEvent?.impact}</span></div>
                        <div className="text-fg-subtle flex gap-4 pt-1 font-mono">
                            <span>Anterior: {selectedEvent?.previous || '-'}</span>
                            <span>Previsão: {selectedEvent?.forecast || '-'}</span>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-fg mb-1">
                            Valor Divulgado (Actual) *
                        </label>
                        <input
                            type="text"
                            required
                            placeholder="Ex: 151K ou 4.1%"
                            value={actualInput}
                            onChange={(e) => setActualInput(e.target.value)}
                            className="w-full bg-canvas border border-line rounded-xl px-3 py-2.5 text-sm text-fg font-mono font-bold focus:outline-none focus:border-emerald-500"
                            autoFocus
                        />
                        <p className="text-[11px] text-fg-subtle mt-1">
                            Ao confirmar, o status será automaticamente alterado para <strong className="text-accent-fg">COMPLETED</strong> e ficará visível aos traders.
                        </p>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-line">
                        <Button type="button" variant="secondary" onClick={() => setIsCompleteModalOpen(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isSubmitting} className="bg-emerald-600 hover:bg-emerald-500">
                            {isSubmitting ? 'Publicando...' : 'Publicar Resultado'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* ========================================= */}
            {/* MODAL: ADIAR EVENTO (POSTPONE)            */}
            {/* ========================================= */}
            <Modal
                isOpen={isPostponeModalOpen}
                onClose={() => setIsPostponeModalOpen(false)}
                title="Adiar Divulgação da Notícia"
            >
                <form onSubmit={handlePostponeSubmit} className="space-y-4">
                    <div className="p-3 bg-canvas border border-line rounded-xl text-xs space-y-1">
                        <div className="text-fg font-bold">{selectedEvent?.title}</div>
                        <div className="text-fg-muted">Data anterior: {selectedEvent?.eventDate ? new Date(selectedEvent.eventDate).toLocaleString('pt-BR') : '-'}</div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-fg mb-1">
                            Nova Data e Hora *
                        </label>
                        <input
                            type="datetime-local"
                            required
                            value={postponeDate}
                            onChange={(e) => setPostponeDate(e.target.value)}
                            className="w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-fg focus:outline-none focus:border-purple-500"
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-line">
                        <Button type="button" variant="secondary" onClick={() => setIsPostponeModalOpen(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isSubmitting} className="bg-purple-600 hover:bg-purple-500">
                            {isSubmitting ? 'Salvando...' : 'Confirmar Novo Horário'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* ========================================= */}
            {/* MODAL: HISTÓRICO DE AUDITORIA             */}
            {/* ========================================= */}
            <Modal
                isOpen={isHistoryModalOpen}
                onClose={() => setIsHistoryModalOpen(false)}
                title={`Auditoria: ${selectedEvent?.title || ''}`}
            >
                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                    {isLoadingHistory ? (
                        <div className="text-center py-6 text-fg-subtle text-xs">Carregando histórico de alterações...</div>
                    ) : auditHistory.length === 0 ? (
                        <div className="text-center py-6 text-fg-subtle text-xs">Nenhum histórico de auditoria registrado para este evento.</div>
                    ) : (
                        auditHistory.map((item) => (
                            <div key={item.id} className="p-3 bg-canvas border border-line rounded-xl text-xs space-y-1.5 font-sans">
                                <div className="flex items-center justify-between">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        item.action === 'CREATED' ? 'bg-emerald-500/20 text-accent-fg' :
                                        item.action === 'COMPLETED' ? 'bg-blue-500/20 text-blue-400' :
                                        item.action === 'CANCELLED' ? 'bg-rose-500/20 text-danger-fg' :
                                        item.action === 'POSTPONED' ? 'bg-purple-500/20 text-purple-400' :
                                        'bg-surface-2 text-fg/80'
                                    }`}>
                                        {item.action}
                                    </span>
                                    <span className="text-[10px] text-fg-subtle font-mono">
                                        {new Date(item.createdAt).toLocaleString('pt-BR')}
                                    </span>
                                </div>
                                <div className="text-fg-muted text-[11px]">
                                    Alterado por: <strong className="text-fg">{item.changedBy || 'ADMIN'}</strong>
                                </div>
                                {item.newData && item.newData.actual && (
                                    <div className="text-[11px] font-mono text-accent-fg">
                                        Actual definido: {item.newData.actual}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
                <div className="flex justify-end pt-4 border-t border-line">
                    <Button variant="secondary" onClick={() => setIsHistoryModalOpen(false)}>
                        Fechar
                    </Button>
                </div>
            </Modal>
        </div>
    );
};
