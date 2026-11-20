import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock,
    Cpu,
    HardDrive,
    PauseCircle,
    RefreshCw,
    Server,
    ShieldCheck,
    Wifi,
    WifiOff,
} from 'lucide-react';
import api from '../../api';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import {
    AdminBadge,
    AdminBanner,
    AdminEmptyState,
    AdminLoadingState,
    AdminPageHeader,
    AdminSectionCard,
    AdminStatCard,
} from './components/AdminPrimitives';

type ConnectionState = 'CONNECTED' | 'SYNCING' | 'CONNECTING' | 'DISCONNECTED' | 'AUTH_FAILED';

interface ClusterWorkerNode {
    workerId: string;
    capacity: number;
    isOnline: boolean;
    isDraining?: boolean;
    cpuPercent?: number;
    memoryPercent?: number;
    memoryAvailableMb?: number;
    diskFreeGb?: number;
    activeTerminals?: number;
    assignedAccountsCount: number;
    pairBucketsCompleted: number;
}

interface AnonymizedMt5Account {
    telemetryId: string;
    accountMask: string;
    connectionState: ConnectionState;
    syncTier: string;
    assignedWorkerId: string | null;
    leaseEpoch: number;
    pingMs: number | null;
    terminalBuild: number | null;
    openPositionsCount: number | null;
    lastSyncAt: string | null;
    zeroBalanceFlag: boolean;
    inactivityWarnedAt: string | null;
    inactivityDisconnectAt: string | null;
    feedback: string | null;
}

interface Mt5ClusterOverviewResponse {
    stride: number;
    totalTrackedAccounts: number;
    totalConnectedAccounts: number;
    tierSummary: {
        HOT: number;
        WARM: number;
        COLD: number;
        QUARANTINED: number;
        pendingDisconnect: number;
    };
    stateSummary: Record<ConnectionState, number>;
    workers: ClusterWorkerNode[];
    accounts: AnonymizedMt5Account[];
}

const STATE_META: Record<
    ConnectionState,
    { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' | 'danger' }
> = {
    CONNECTED: { label: 'Conectada', tone: 'success' },
    SYNCING: { label: 'Sincronizando', tone: 'info' },
    CONNECTING: { label: 'Conectando', tone: 'warning' },
    DISCONNECTED: { label: 'Desconectada', tone: 'neutral' },
    AUTH_FAILED: { label: 'Falha Auth', tone: 'danger' },
};

const TIER_TONE: Record<string, 'accent' | 'info' | 'neutral' | 'danger'> = {
    HOT: 'accent',
    WARM: 'info',
    COLD: 'neutral',
    QUARANTINED: 'danger',
};

function formatRelativeTime(iso: string | null): string {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return 'agora';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s atrás`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m atrás`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h atrás`;
    return `${Math.floor(hr / 24)}d atrás`;
}

export const AdminMt5Telemetry = () => {
    const [data, setData] = useState<Mt5ClusterOverviewResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [rebalancing, setRebalancing] = useState(false);
    const [drainingId, setDrainingId] = useState<string | null>(null);
    const [banner, setBanner] = useState<{
        tone: 'success' | 'warning' | 'danger' | 'info';
        message: string;
    } | null>(null);

    const [stateFilter, setStateFilter] = useState<'ALL' | ConnectionState>('ALL');
    const [workerFilter, setWorkerFilter] = useState<string>('ALL');
    const [autoRefresh, setAutoRefresh] = useState(true);

    const fetchTelemetry = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        else setRefreshing(true);
        try {
            const res = await api.get<Mt5ClusterOverviewResponse>('/admin/mt5-cluster/overview');
            setData(res.data);
        } catch (err: any) {
            setBanner({
                tone: 'danger',
                message: err?.response?.data?.message || 'Não foi possível carregar a telemetria MT5.',
            });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchTelemetry(false);
    }, [fetchTelemetry]);

    useEffect(() => {
        if (!autoRefresh) return;
        const timer = setInterval(() => {
            fetchTelemetry(true);
        }, 15_000);
        return () => clearInterval(timer);
    }, [autoRefresh, fetchTelemetry]);

    const handleRebalance = async () => {
        setRebalancing(true);
        try {
            const res = await api.post<{ moved?: number }>('/admin/mt5-cluster/rebalance');
            setBanner({
                tone: 'success',
                message: `Rebalanceamento concluído: ${res.data?.moved ?? 0} conta(s) realocada(s) no padrão K=${data?.stride ?? 2}.`,
            });
            await fetchTelemetry(true);
        } catch (err: any) {
            setBanner({
                tone: 'danger',
                message: err?.response?.data?.message || 'Falha ao rebalancear o cluster MT5.',
            });
        } finally {
            setRebalancing(false);
        }
    };

    const handleToggleDrain = async (worker: ClusterWorkerNode) => {
        const nextDrain = !worker.isDraining;
        setDrainingId(worker.workerId);
        try {
            await api.post(`/admin/mt5-cluster/workers/${encodeURIComponent(worker.workerId)}/drain`, {
                drain: nextDrain,
            });
            setBanner({
                tone: 'info',
                message: nextDrain
                    ? `Worker ${worker.workerId} colocado em modo Drain (não receberá novas contas).`
                    : `Worker ${worker.workerId} reativado no balanceador.`,
            });
            await fetchTelemetry(true);
        } catch (err: any) {
            setBanner({
                tone: 'danger',
                message: err?.response?.data?.message || `Falha ao atualizar estado do worker ${worker.workerId}.`,
            });
        } finally {
            setDrainingId(null);
        }
    };

    const filteredAccounts = useMemo(() => {
        const list = data?.accounts || [];
        return list.filter((acc) => {
            if (stateFilter !== 'ALL' && acc.connectionState !== stateFilter) return false;
            if (workerFilter !== 'ALL' && (acc.assignedWorkerId || 'UNASSIGNED') !== workerFilter) {
                return false;
            }
            return true;
        });
    }, [data?.accounts, stateFilter, workerFilter]);

    const feedbackLogs = useMemo(() => {
        return (data?.accounts || []).filter((a) => Boolean(a.feedback));
    }, [data?.accounts]);

    if (loading && !data) {
        return <AdminLoadingState label="Carregando telemetria anonimizada do cluster MT5..." />;
    }

    const totalTracked = data?.totalTrackedAccounts ?? 0;
    const totalConnected = data?.totalConnectedAccounts ?? 0;
    const alertsCount =
        (data?.stateSummary?.AUTH_FAILED ?? 0) + (data?.stateSummary?.DISCONNECTED ?? 0);
    const pending24h = data?.tierSummary?.pendingDisconnect ?? 0;

    return (
        <div className="space-y-6">
            <AdminPageHeader
                badge={`Balanceador Pair-Stride K=${data?.stride ?? 2}`}
                title="Telemetria MT5 & Feedback"
                subtitle="Monitoramento técnico contínuo das contas conectadas, saúde dos workers e diagnósticos de sincronização."
                icon={<Server className="h-5 w-5" />}
                actions={
                    <>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAutoRefresh((v) => !v)}
                            className="gap-1.5"
                        >
                            <Activity className={cn('h-3.5 w-3.5', autoRefresh && 'text-emerald-500 animate-pulse')} />
                            {autoRefresh ? 'Auto 15s: ON' : 'Auto 15s: OFF'}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchTelemetry(true)}
                            disabled={refreshing}
                            className="gap-1.5"
                        >
                            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                            Atualizar
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleRebalance}
                            disabled={rebalancing}
                            className="gap-1.5"
                        >
                            <Cpu className="h-3.5 w-3.5" />
                            {rebalancing ? 'Rebalanceando...' : 'Rebalancear Cluster'}
                        </Button>
                    </>
                }
            />

            <AdminBanner
                tone="info"
                title="Telemetria 100% Anonimizada (Zero Vazamento de Dados)"
                message="Esta visualização exibe exclusivamente métricas técnicas e diagnósticos sanitizados. Nenhum nome, e-mail, login completo, senha, saldo, equity ou identificador pessoal é exposto."
            />

            {banner && (
                <AdminBanner
                    tone={banner.tone}
                    message={banner.message}
                    onDismiss={() => setBanner(null)}
                />
            )}

            {/* KPIs principais */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <AdminStatCard
                    label="Contas MT5 Monitoradas"
                    value={totalTracked}
                    hint={`HOT: ${data?.tierSummary?.HOT ?? 0} · WARM: ${data?.tierSummary?.WARM ?? 0} · COLD: ${data?.tierSummary?.COLD ?? 0}`}
                    icon={<ShieldCheck className="h-4 w-4" />}
                    tone="default"
                />
                <AdminStatCard
                    label="Conectadas / Sync Ativo"
                    value={totalConnected}
                    hint={`Syncing agora: ${data?.stateSummary?.SYNCING ?? 0}`}
                    icon={<Wifi className="h-4 w-4" />}
                    tone="accent"
                />
                <AdminStatCard
                    label="Desconectadas / Falha Auth"
                    value={alertsCount}
                    hint={`Auth Failed: ${data?.stateSummary?.AUTH_FAILED ?? 0} · Quarentena: ${data?.tierSummary?.QUARANTINED ?? 0}`}
                    icon={<WifiOff className="h-4 w-4" />}
                    tone={alertsCount > 0 ? 'danger' : 'default'}
                />
                <AdminStatCard
                    label="Pausa 24h (Inatividade 7d)"
                    value={pending24h}
                    hint="Contas com aviso de desconexão ativo"
                    icon={<Clock className="h-4 w-4" />}
                    tone={pending24h > 0 ? 'warning' : 'default'}
                />
            </div>

            {/* Saúde dos Workers Windows */}
            <AdminSectionCard
                title="Nós Workers do Cluster"
                subtitle={`Distribuição em pares K=${data?.stride ?? 2} com guarda de hardware (CPU, RAM e disco)`}
                icon={<Cpu className="h-4 w-4" />}
            >
                {!data?.workers?.length ? (
                    <AdminEmptyState
                        icon={<Server className="h-5 w-5" />}
                        title="Nenhum worker MT5 registrado"
                        description="Os nós workers aparecerão aqui assim que enviarem o primeiro heartbeat."
                    />
                ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {data.workers.map((w) => (
                            <div
                                key={w.workerId}
                                className="rounded-xl border border-line bg-surface-2/40 p-4 space-y-3"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="font-mono text-sm font-bold text-fg truncate">
                                            {w.workerId}
                                        </div>
                                        <div className="text-xs text-fg-muted">
                                            {w.assignedAccountsCount} / {w.capacity} contas · {w.pairBucketsCompleted} pares completos
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {w.isDraining && (
                                            <AdminBadge tone="warning" dot>
                                                DRAIN
                                            </AdminBadge>
                                        )}
                                        <AdminBadge tone={w.isOnline ? 'success' : 'danger'} dot>
                                            {w.isOnline ? 'ONLINE' : 'OFFLINE'}
                                        </AdminBadge>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-2 text-xs">
                                    <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
                                        <div className="text-fg-muted">CPU</div>
                                        <div className="font-semibold text-fg mt-0.5">
                                            {typeof w.cpuPercent === 'number' ? `${w.cpuPercent.toFixed(1)}%` : '—'}
                                        </div>
                                    </div>
                                    <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
                                        <div className="text-fg-muted">RAM</div>
                                        <div className="font-semibold text-fg mt-0.5">
                                            {typeof w.memoryPercent === 'number' ? `${w.memoryPercent.toFixed(1)}%` : '—'}
                                        </div>
                                    </div>
                                    <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
                                        <div className="flex items-center gap-1 text-fg-muted">
                                            <HardDrive className="h-3 w-3" /> Disco
                                        </div>
                                        <div className="font-semibold text-fg mt-0.5">
                                            {typeof w.diskFreeGb === 'number' ? `${w.diskFreeGb.toFixed(1)} GB` : '—'}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-1">
                                    <span className="text-[11px] text-fg-muted">
                                        Terminais ativos: {w.activeTerminals ?? 0}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={drainingId === w.workerId}
                                        onClick={() => handleToggleDrain(w)}
                                        className="h-7 px-2.5 text-xs gap-1"
                                    >
                                        <PauseCircle className="h-3.5 w-3.5" />
                                        {w.isDraining ? 'Reativar' : 'Drain'}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </AdminSectionCard>

            {/* Feedback & Diagnósticos Recentes */}
            <AdminSectionCard
                title="Feedback de Telemetria & Incidentes"
                subtitle="Mensagens técnicas sanitizadas emitidas pelo sync e ciclo de vida das contas"
                icon={<AlertTriangle className="h-4 w-4" />}
            >
                {feedbackLogs.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs text-fg-muted">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        Sem alertas ou erros de sincronização reportados no momento.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {feedbackLogs.slice(0, 12).map((item) => {
                            const meta = STATE_META[item.connectionState] || STATE_META.DISCONNECTED;
                            return (
                                <div
                                    key={`${item.telemetryId}-fb`}
                                    className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2/30 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <span className="font-mono text-xs font-semibold text-fg shrink-0">
                                            {item.accountMask}
                                        </span>
                                        <AdminBadge tone={meta.tone}>{meta.label}</AdminBadge>
                                        <span className="text-xs text-fg-muted truncate">
                                            {item.feedback}
                                        </span>
                                    </div>
                                    <div className="text-[11px] font-mono text-fg-subtle shrink-0">
                                        {item.assignedWorkerId || 'sem-worker'} · {formatRelativeTime(item.lastSyncAt)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </AdminSectionCard>

            {/* Tabela completa de telemetria das contas */}
            <AdminSectionCard
                title="Estado das Contas MT5 (Telemetria)"
                subtitle={`${filteredAccounts.length} de ${totalTracked} conta(s) exibida(s)`}
                icon={<Activity className="h-4 w-4" />}
                noPadding
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            aria-label="Filtrar por estado"
                            value={stateFilter}
                            onChange={(e) => setStateFilter(e.target.value as 'ALL' | ConnectionState)}
                            className="h-8 rounded-lg border border-line bg-surface px-2.5 text-xs text-fg"
                        >
                            <option value="ALL">Todos os estados</option>
                            <option value="CONNECTED">Conectada</option>
                            <option value="SYNCING">Sincronizando</option>
                            <option value="CONNECTING">Conectando</option>
                            <option value="DISCONNECTED">Desconectada</option>
                            <option value="AUTH_FAILED">Falha Auth</option>
                        </select>
                        <select
                            aria-label="Filtrar por worker"
                            value={workerFilter}
                            onChange={(e) => setWorkerFilter(e.target.value)}
                            className="h-8 rounded-lg border border-line bg-surface px-2.5 text-xs text-fg"
                        >
                            <option value="ALL">Todos os workers</option>
                            {(data?.workers || []).map((w) => (
                                <option key={w.workerId} value={w.workerId}>
                                    {w.workerId}
                                </option>
                            ))}
                            <option value="UNASSIGNED">Sem worker</option>
                        </select>
                    </div>
                }
            >
                {filteredAccounts.length === 0 ? (
                    <div className="p-6">
                        <AdminEmptyState
                            icon={<Server className="h-5 w-5" />}
                            title="Nenhuma conta encontrada com os filtros atuais"
                            description="Ajuste os filtros de estado ou worker para visualizar a telemetria."
                        />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="border-b border-line bg-surface-2/40 text-[11px] uppercase tracking-wider text-fg-muted">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Conta (Mask / ID)</th>
                                    <th className="px-4 py-3 font-semibold">Estado</th>
                                    <th className="px-4 py-3 font-semibold">Tier</th>
                                    <th className="px-4 py-3 font-semibold">Worker</th>
                                    <th className="px-4 py-3 font-semibold">Epoch / Ping</th>
                                    <th className="px-4 py-3 font-semibold">Último Sync</th>
                                    <th className="px-4 py-3 font-semibold">Ciclo 7d/24h</th>
                                    <th className="px-4 py-3 font-semibold">Feedback</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {filteredAccounts.map((acc) => {
                                    const meta = STATE_META[acc.connectionState] || STATE_META.DISCONNECTED;
                                    const tierTone = TIER_TONE[acc.syncTier] || 'neutral';
                                    return (
                                        <tr key={acc.telemetryId} className="hover:bg-surface-2/30 transition-colors">
                                            <td className="px-4 py-3 font-mono whitespace-nowrap">
                                                <div className="font-semibold text-fg">{acc.accountMask}</div>
                                                <div className="text-[10px] text-fg-subtle">#{acc.telemetryId}</div>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <AdminBadge tone={meta.tone} dot>
                                                    {meta.label}
                                                </AdminBadge>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <AdminBadge tone={tierTone}>{acc.syncTier}</AdminBadge>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-fg-muted whitespace-nowrap">
                                                {acc.assignedWorkerId || '—'}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-fg-muted whitespace-nowrap">
                                                e{acc.leaseEpoch}
                                                {typeof acc.pingMs === 'number' ? ` · ${acc.pingMs}ms` : ''}
                                            </td>
                                            <td className="px-4 py-3 text-fg-muted whitespace-nowrap">
                                                {formatRelativeTime(acc.lastSyncAt)}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                {acc.inactivityDisconnectAt ? (
                                                    <AdminBadge tone="warning">Aviso 24h</AdminBadge>
                                                ) : acc.zeroBalanceFlag ? (
                                                    <AdminBadge tone="neutral">Sem saldo ativo</AdminBadge>
                                                ) : (
                                                    <span className="text-fg-subtle">Normal</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 max-w-xs truncate text-fg-muted" title={acc.feedback || ''}>
                                                {acc.feedback || '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </AdminSectionCard>
        </div>
    );
};
