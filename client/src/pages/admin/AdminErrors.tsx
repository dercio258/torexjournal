import { useCallback, useEffect, useState } from 'react';
import {
    AlertTriangle,
    Bug,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Copy,
    Check,
    RefreshCw,
    RotateCcw,
    Search,
    ShieldAlert,
    ShieldCheck,
    Terminal,
    Lock,
} from 'lucide-react';
import api from '../../api';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import {
    AdminBadge,
    AdminBanner,
    AdminLoadingState,
    AdminPageHeader,
    AdminSectionCard,
    AdminStatCard,
} from './components/AdminPrimitives';

interface TechnicalErrorItem {
    id: string;
    errorRef: string;
    timestamp: string;
    domain: string;
    severity: 'critical' | 'error' | 'warning';
    statusCode: number | null;
    method: string | null;
    path: string | null;
    userId: string | null;
    exceptionName: string | null;
    errorCode: string | null;
    technicalMessage: string;
    publicMessage: string | null;
    wasSanitized: boolean;
    stackPreview: string | null;
    correlationId?: string;
    status: 'OPEN' | 'RESOLVED';
    resolvedAt: string | null;
}

interface TechnicalErrorStats {
    total: number;
    open: number;
    criticalOpen: number;
    sanitizedCount: number;
    last24h: number;
    byDomain: Record<string, number>;
}

interface AdminAuditItem {
    id: string;
    timestamp: string;
    adminEmail: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    ip: string | null;
    details: Record<string, unknown>;
    prevHash: string;
    entryHash: string;
}

interface AuditChainIntegrity {
    valid: boolean;
    checked: number;
    brokenAtId?: string;
}

const DOMAIN_OPTIONS = [
    { value: 'ALL', label: 'Todos os domínios' },
    { value: 'REG', label: 'REG · Registo' },
    { value: 'AUTH', label: 'AUTH · Autenticação' },
    { value: 'PAY', label: 'PAY · Pagamentos' },
    { value: 'MT5', label: 'MT5 · Sincronização' },
    { value: 'DRV', label: 'DRV · Deriv' },
    { value: 'IMP', label: 'IMP · Importação' },
    { value: 'MKT', label: 'MKT · Mercado' },
    { value: 'AI', label: 'AI · Torex AI' },
    { value: 'APP', label: 'APP · Dashboard/Contas' },
    { value: 'NET', label: 'NET · Comunidade' },
    { value: 'NTF', label: 'NTF · Notificações/SMTP' },
    { value: 'ADM', label: 'ADM · Admin' },
    { value: 'SYS', label: 'SYS · Sistema' },
];

function formatDateTime(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-PT', {
        dateStyle: 'short',
        timeStyle: 'medium',
    });
}

export const AdminErrors = () => {
    const [items, setItems] = useState<TechnicalErrorItem[]>([]);
    const [stats, setStats] = useState<TechnicalErrorStats>({
        total: 0,
        open: 0,
        criticalOpen: 0,
        sanitizedCount: 0,
        last24h: 0,
        byDomain: {},
    });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState('');
    const [domain, setDomain] = useState('ALL');
    const [severity, setSeverity] = useState('ALL');
    const [status, setStatus] = useState('OPEN');
    const [expandedStack, setExpandedStack] = useState<Record<string, boolean>>({});
    const [copiedRef, setCopiedRef] = useState<string | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'errors' | 'audit'>('errors');
    const [auditItems, setAuditItems] = useState<AdminAuditItem[]>([]);
    const [auditIntegrity, setAuditIntegrity] = useState<AuditChainIntegrity>({
        valid: true,
        checked: 0,
    });
    const [loadingAudit, setLoadingAudit] = useState(false);
    const [banner, setBanner] = useState<{
        tone: 'success' | 'warning' | 'danger' | 'info';
        message: string;
    } | null>(null);

    const fetchAuditLogs = useCallback(async () => {
        setLoadingAudit(true);
        try {
            const res = await api.get('/admin/audit-logs', { params: { limit: 120 } });
            setAuditItems(Array.isArray(res.data?.items) ? res.data.items : []);
            if (res.data?.chainIntegrity) {
                setAuditIntegrity(res.data.chainIntegrity);
            }
        } catch {
            // keep existing items
        } finally {
            setLoadingAudit(false);
        }
    }, []);

    const fetchErrors = useCallback(
        async (silent = false) => {
            if (!silent) setRefreshing(true);
            try {
                const res = await api.get('/admin/errors', {
                    params: {
                        ...(search.trim() ? { search: search.trim() } : {}),
                        ...(domain !== 'ALL' ? { domain } : {}),
                        ...(severity !== 'ALL' ? { severity } : {}),
                        ...(status !== 'ALL' ? { status } : {}),
                        limit: 120,
                    },
                });
                setItems(Array.isArray(res.data?.items) ? res.data.items : []);
                if (res.data?.stats) {
                    setStats(res.data.stats);
                }
            } catch (err: any) {
                if (!silent) {
                    setBanner({
                        tone: 'danger',
                        message:
                            err?.response?.data?.message ||
                            'Não foi possível carregar os registos técnicos de erros.',
                    });
                }
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [search, domain, severity, status],
    );

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void fetchErrors();
        }, 200);
        return () => window.clearTimeout(timer);
    }, [fetchErrors]);

    useEffect(() => {
        if (activeTab === 'audit') {
            void fetchAuditLogs();
        }
    }, [activeTab, fetchAuditLogs]);

    useEffect(() => {
        const interval = window.setInterval(() => void fetchErrors(true), 25000);
        return () => window.clearInterval(interval);
    }, [fetchErrors]);

    const handleCopyRef = async (refCode: string) => {
        try {
            await navigator.clipboard.writeText(refCode);
            setCopiedRef(refCode);
            window.setTimeout(() => setCopiedRef((prev) => (prev === refCode ? null : prev)), 1800);
        } catch {
            // ignore clipboard errors
        }
    };

    const handleToggleResolve = async (item: TechnicalErrorItem) => {
        setUpdatingId(item.id);
        const nextResolved = item.status !== 'RESOLVED';
        try {
            await api.patch(`/admin/errors/${encodeURIComponent(item.id)}/resolve`, {
                resolved: nextResolved,
            });
            setBanner({
                tone: 'success',
                message: nextResolved
                    ? `Incidente ${item.errorRef} marcado como resolvido.`
                    : `Incidente ${item.errorRef} reaberto para análise.`,
            });
            await fetchErrors(true);
        } catch (err: any) {
            setBanner({
                tone: 'danger',
                message:
                    err?.response?.data?.message ||
                    `Falha ao atualizar estado do incidente ${item.errorRef}.`,
            });
        } finally {
            setUpdatingId(null);
        }
    };

    if (loading) {
        return <AdminLoadingState label="A carregar consola técnica de erros e referências..." />;
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <AdminPageHeader
                badge="Diagnóstico Técnico · Restrito ao Admin"
                title="Erros Técnicos & Referências de Suporte"
                subtitle="Pesquise pela referência reportada pelo utilizador (ex.: TRX-REG-9F7D6B81) para inspecionar a causa técnica real, stack trace e rota afetada — mantendo o backend público limpo e sem vazamento de arquitetura."
                icon={<Bug className="h-5 w-5" />}
                actions={
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchErrors()}
                        isLoading={refreshing}
                        icon={<RefreshCw className="h-3.5 w-3.5" />}
                    >
                        Atualizar
                    </Button>
                }
            />

            {banner && (
                <AdminBanner
                    tone={banner.tone}
                    message={banner.message}
                    onDismiss={() => setBanner(null)}
                />
            )}

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => setActiveTab('errors')}
                    className={cn(
                        'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-all',
                        activeTab === 'errors'
                            ? 'border-accent bg-accent/15 text-accent-fg'
                            : 'border-line bg-surface text-fg-muted hover:text-fg',
                    )}
                >
                    <Bug className="h-3.5 w-3.5" />
                    Erros Técnicos & Referências ({stats.open})
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('audit')}
                    className={cn(
                        'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-all',
                        activeTab === 'audit'
                            ? 'border-accent bg-accent/15 text-accent-fg'
                            : 'border-line bg-surface text-fg-muted hover:text-fg',
                    )}
                >
                    <Lock className="h-3.5 w-3.5" />
                    Auditoria Admin Imutável (Hash-Chain)
                </button>
            </div>

            {activeTab === 'audit' ? (
                <AdminSectionCard
                    title="Trilha de Auditoria Administrativa (Append-Only SHA-256)"
                    subtitle="Cada ação administrativa é encadeada criptograficamente ao registo anterior para deteção imediata de adulteração."
                    icon={<Lock className="h-5 w-5" />}
                    actions={
                        <div className="flex items-center gap-2">
                            <AdminBadge tone={auditIntegrity.valid ? 'success' : 'danger'} dot>
                                {auditIntegrity.valid
                                    ? `Cadeia Íntegra (${auditIntegrity.checked} verificados)`
                                    : 'Alerta: Adulteração Detetada'}
                            </AdminBadge>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => fetchAuditLogs()}
                                isLoading={loadingAudit}
                                icon={<RefreshCw className="h-3.5 w-3.5" />}
                            >
                                Revalidar
                            </Button>
                        </div>
                    }
                    noPadding
                >
                    {auditItems.length === 0 ? (
                        <div className="p-10 text-center text-xs text-fg-muted">
                            Nenhum evento administrativo registado ainda.
                        </div>
                    ) : (
                        <div className="divide-y divide-line">
                            {auditItems.map((entry) => (
                                <div key={entry.id} className="space-y-1.5 px-5 py-3.5 text-xs">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <AdminBadge tone="info">{entry.action}</AdminBadge>
                                            <span className="font-semibold text-fg">{entry.adminEmail}</span>
                                            {entry.targetType && (
                                                <span className="font-mono text-[11px] text-fg-subtle">
                                                    {entry.targetType}
                                                    {entry.targetId ? `:${entry.targetId}` : ''}
                                                </span>
                                            )}
                                        </div>
                                        <span className="font-mono text-[11px] text-fg-subtle">
                                            {formatDateTime(entry.timestamp)}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-fg-subtle">
                                        {entry.ip && <span>IP: {entry.ip}</span>}
                                        <span>SHA-256: {entry.entryHash.slice(0, 16)}…</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </AdminSectionCard>
            ) : (
                <>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <AdminStatCard
                    label="Críticos Abertos (5xx)"
                    value={stats.criticalOpen.toLocaleString('pt-PT')}
                    hint="Exceções não tratadas e falhas internas"
                    icon={<ShieldAlert className="h-4 w-4" />}
                    tone={stats.criticalOpen > 0 ? 'danger' : 'accent'}
                />
                <AdminStatCard
                    label="Vazamentos Sanitizados"
                    value={stats.sanitizedCount.toLocaleString('pt-PT')}
                    hint="Respostas técnicas substituídas antes de chegar ao cliente"
                    icon={<ShieldCheck className="h-4 w-4" />}
                    tone="info"
                />
                <AdminStatCard
                    label="Incidentes (Últimas 24h)"
                    value={stats.last24h.toLocaleString('pt-PT')}
                    hint={`${stats.open} em aberto no momento`}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone={stats.last24h > 0 ? 'warning' : 'accent'}
                />
                <AdminStatCard
                    label="Total Histórico Registado"
                    value={stats.total.toLocaleString('pt-PT')}
                    hint="Persistido no PostgreSQL + buffer em tempo real"
                    icon={<Terminal className="h-4 w-4" />}
                    tone="info"
                />
            </div>

            <AdminSectionCard
                title="Pesquisa por Referência & Filtros Técnicos"
                subtitle="Cole o código TRX-... enviado pelo cliente para info@torexjournal.com ou filtre por domínio/severidade."
                icon={<Search className="h-5 w-5" />}
            >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                    <div className="relative md:col-span-5">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Ex.: TRX-REG-9F7D6B81, QueryFailedError, /api/auth/..."
                            className="w-full rounded-xl border border-line bg-surface-2/60 py-2 pl-9 pr-3 text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
                        />
                    </div>
                    <select
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        className="rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-xs text-fg focus:border-accent focus:outline-none md:col-span-3"
                    >
                        {DOMAIN_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    <select
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value)}
                        className="rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-xs text-fg focus:border-accent focus:outline-none md:col-span-2"
                    >
                        <option value="ALL">Todas severidades</option>
                        <option value="critical">Crítico (5xx)</option>
                        <option value="error">Sanitizado (4xx)</option>
                        <option value="warning">Aviso Operacional</option>
                    </select>
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-xs text-fg focus:border-accent focus:outline-none md:col-span-2"
                    >
                        <option value="OPEN">Em Aberto</option>
                        <option value="RESOLVED">Resolvidos</option>
                        <option value="ALL">Todos estados</option>
                    </select>
                </div>
            </AdminSectionCard>

            <AdminSectionCard
                title={`Registos Técnicos (${items.length})`}
                subtitle="Detalhes completos de diagnóstico técnico visíveis exclusivamente para administradores autenticados."
                icon={<Terminal className="h-5 w-5" />}
                noPadding
            >
                {items.length === 0 ? (
                    <div className="p-10 text-center text-xs text-fg-muted">
                        Nenhum incidente encontrado para os filtros aplicados. Operação limpa.
                    </div>
                ) : (
                    <div className="divide-y divide-line">
                        {items.map((item) => {
                            const isOpenStack = Boolean(expandedStack[item.id]);
                            const sevTone =
                                item.severity === 'critical'
                                    ? 'danger'
                                    : item.severity === 'error'
                                      ? 'warning'
                                      : 'info';
                            const sevLabel =
                                item.severity === 'critical'
                                    ? 'Crítico'
                                    : item.severity === 'error'
                                      ? 'Sanitizado'
                                      : 'Aviso';

                            return (
                                <div
                                    key={item.id}
                                    className="space-y-3 p-5 transition-colors hover:bg-surface-2/30"
                                >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleCopyRef(item.errorRef)}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-accent/35 bg-accent/10 px-2.5 py-1 font-mono text-xs font-bold text-accent-fg hover:bg-accent/20"
                                                title="Copiar referência"
                                            >
                                                <span>{item.errorRef}</span>
                                                {copiedRef === item.errorRef ? (
                                                    <Check className="h-3 w-3 text-emerald-400" />
                                                ) : (
                                                    <Copy className="h-3 w-3 opacity-75" />
                                                )}
                                            </button>
                                            <AdminBadge tone={sevTone} dot>
                                                {sevLabel}
                                            </AdminBadge>
                                            <AdminBadge tone="neutral">{item.domain}</AdminBadge>
                                            {item.statusCode && (
                                                <AdminBadge
                                                    tone={item.statusCode >= 500 ? 'danger' : 'warning'}
                                                >
                                                    HTTP {item.statusCode}
                                                </AdminBadge>
                                            )}
                                            {item.wasSanitized && (
                                                <AdminBadge tone="success">
                                                    Sanitizado p/ Cliente
                                                </AdminBadge>
                                            )}
                                            {item.status === 'RESOLVED' && (
                                                <AdminBadge tone="success">Resolvido</AdminBadge>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-[11px] text-fg-subtle">
                                                {formatDateTime(item.timestamp)}
                                            </span>
                                            <Button
                                                variant={item.status === 'RESOLVED' ? 'outline' : 'brand'}
                                                size="sm"
                                                isLoading={updatingId === item.id}
                                                onClick={() => handleToggleResolve(item)}
                                                icon={
                                                    item.status === 'RESOLVED' ? (
                                                        <RotateCcw className="h-3 w-3" />
                                                    ) : (
                                                        <CheckCircle2 className="h-3 w-3" />
                                                    )
                                                }
                                            >
                                                {item.status === 'RESOLVED' ? 'Reabrir' : 'Resolver'}
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
                                        {item.path && (
                                            <span className="font-mono text-fg">
                                                {item.method || 'HTTP'} {item.path}
                                            </span>
                                        )}
                                        {item.exceptionName && (
                                            <span>
                                                Exceção:{' '}
                                                <strong className="font-mono text-rose-400">
                                                    {item.exceptionName}
                                                </strong>
                                            </span>
                                        )}
                                        {item.errorCode && (
                                            <span>
                                                Código:{' '}
                                                <strong className="font-mono text-amber-400">
                                                    {item.errorCode}
                                                </strong>
                                            </span>
                                        )}
                                        {item.userId && (
                                            <span>
                                                UserID:{' '}
                                                <code className="font-mono text-fg">{item.userId}</code>
                                            </span>
                                        )}
                                        {item.correlationId && (
                                            <span>
                                                CID:{' '}
                                                <code className="font-mono">{item.correlationId}</code>
                                            </span>
                                        )}
                                    </div>

                                    {/* Technical diagnosis box (Admin-only) */}
                                    <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
                                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-400">
                                            Detalhe Técnico (Backend / DB / Infra)
                                        </div>
                                        <p className="break-words font-mono text-xs leading-relaxed text-fg">
                                            {item.technicalMessage}
                                        </p>
                                    </div>

                                    {/* Sanitized message delivered to the customer */}
                                    {item.publicMessage && (
                                        <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                                            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">
                                                Mensagem Sanitizada Exibida ao Utilizador
                                            </div>
                                            <p className="text-xs leading-relaxed text-fg-muted">
                                                {item.publicMessage}
                                            </p>
                                        </div>
                                    )}

                                    {item.stackPreview && (
                                        <div>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setExpandedStack((prev) => ({
                                                        ...prev,
                                                        [item.id]: !prev[item.id],
                                                    }))
                                                }
                                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-fg hover:underline"
                                            >
                                                {isOpenStack ? (
                                                    <>
                                                        <ChevronUp className="h-3.5 w-3.5" />
                                                        Ocultar Stack Trace
                                                    </>
                                                ) : (
                                                    <>
                                                        <ChevronDown className="h-3.5 w-3.5" />
                                                        Ver Stack Trace Técnico
                                                    </>
                                                )}
                                            </button>
                                            {isOpenStack && (
                                                <pre
                                                    className={cn(
                                                        'mt-2 max-h-64 overflow-auto rounded-xl border border-line bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-emerald-300/90',
                                                    )}
                                                >
                                                    {item.stackPreview}
                                                </pre>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </AdminSectionCard>
                </>
            )}
        </div>
    );
};
