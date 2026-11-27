import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    ArrowRightLeft,
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

interface WorkerAccountTag {
    telemetryId: string;
    accountMask: string;
    ownerName?: string | null;
    accountName?: string | null;
    connectionState: ConnectionState;
    syncTier: string;
    leaseEpoch: number;
    pingMs: number | null;
}

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
    connectedCount?: number;
    alertCount?: number;
    avgPingMs?: number | null;
    tierBreakdown?: {
        HOT: number;
        WARM: number;
        COLD: number;
        QUARANTINED: number;
    };
    accountTags?: WorkerAccountTag[];
}

interface WorkerCorrelationItem {
    workerId: string;
    isOnline: boolean;
    assignedAccountsCount: number;
    slotUtilizationPct: number;
    connectedRatePct: number;
    alertCount: number;
    avgPingMs: number | null;
    cpuPercent: number | null;
    memoryPercent: number | null;
}

interface AnonymizedMt5Account {
    telemetryId: string;
    accountMask: string;
    ownerName?: string | null;
    accountLabel?: string | null;
    accountName?: string | null;
    broker?: string | null;
    hasStoredCredentials?: boolean;
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
    lastTaskId?: string | null;
    lastTaskStatus?: 'QUEUED' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | null;
    lastTaskMessage?: string | null;
    lastTaskError?: string | null;
    lastTaskUpdatedAt?: string | null;
}

interface ActiveAccountActionState {
    action: 'RECONNECT' | 'MIGRATE';
    taskId: string;
    workerId: string;
    status: 'QUEUED' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';
    detail: string;
    startedAt: number;
}

interface Mt5ServerMigrationLog {
    id: string;
    telemetryId: string;
    accountMask: string;
    accountName: string | null;
    fromWorkerId: string | null;
    toWorkerId: string;
    trigger: 'AUTO_FAILOVER' | 'MANUAL_ADMIN' | 'WORKER_DRAIN' | 'CLUSTER_REBALANCE';
    reason: string;
    status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    leaseEpoch: number;
    taskId: string | null;
    details: string | null;
    createdAt: string;
    completedAt: string | null;
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
    correlations?: {
        onlineWorkersCount: number;
        unassignedCount: number;
        pairStrideBalanceGap: number;
        avgAccountsPerOnlineWorker: number;
        workerCorrelation: WorkerCorrelationItem[];
    };
    accounts: AnonymizedMt5Account[];
    migrationLogs?: Mt5ServerMigrationLog[];
}

const MIGRATION_TRIGGER_META: Record<
    Mt5ServerMigrationLog['trigger'],
    { label: string; tone: 'warning' | 'accent' | 'info' | 'neutral' }
> = {
    AUTO_FAILOVER: { label: 'Failover Automático', tone: 'warning' },
    MANUAL_ADMIN: { label: 'Migração Manual', tone: 'accent' },
    WORKER_DRAIN: { label: 'Drain de Servidor', tone: 'neutral' },
    CLUSTER_REBALANCE: { label: 'Rebalanceamento', tone: 'info' },
};

const MIGRATION_STATUS_META: Record<
    Mt5ServerMigrationLog['status'],
    { label: string; tone: 'info' | 'success' | 'danger' }
> = {
    IN_PROGRESS: { label: 'Em andamento', tone: 'info' },
    COMPLETED: { label: 'Concluída', tone: 'success' },
    FAILED: { label: 'Falhou', tone: 'danger' },
};

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

function formatAdminApiError(err: any, fallback: string, routeHint?: string): string {
    const status = err?.response?.status;
    const rawMsg = err?.response?.data?.message;
    const errorRef = err?.response?.data?.errorRef;
    const textMsg = Array.isArray(rawMsg)
        ? rawMsg.join(' ')
        : typeof rawMsg === 'string'
          ? rawMsg.trim()
          : '';

    if (status === 404 && routeHint) {
        return `Rota ${routeHint} não encontrada no backend em execução (HTTP 404${errorRef ? ` · ${errorRef}` : ''}). Recompile (npm run build) e reinicie o backend-nest na VPS.`;
    }
    if (textMsg) {
        const suffix =
            errorRef && !textMsg.includes(errorRef)
                ? ` (HTTP ${status || 'ERR'} · ${errorRef})`
                : status && !textMsg.includes(`HTTP ${status}`)
                  ? ` (HTTP ${status})`
                  : '';
        return `${textMsg}${suffix}`;
    }
    if (err?.message) {
        return `${fallback} (${err.message})`;
    }
    return fallback;
}

export const AdminMt5Telemetry = () => {
    const [data, setData] = useState<Mt5ClusterOverviewResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [rebalancing, setRebalancing] = useState(false);
    const [drainingId, setDrainingId] = useState<string | null>(null);
    const [migratingWorkerId, setMigratingWorkerId] = useState<string | null>(null);
    const [reconnectingId, setReconnectingId] = useState<string | null>(null);
    const [migratingId, setMigratingId] = useState<string | null>(null);
    const [selectedTargetWorker, setSelectedTargetWorker] = useState<Record<string, string>>({});
    const [activeTaskByTelemetry, setActiveTaskByTelemetry] = useState<
        Record<string, ActiveAccountActionState>
    >({});
    const [banner, setBanner] = useState<{
        tone: 'success' | 'warning' | 'danger' | 'info';
        message: string;
    } | null>(null);

    const [stateFilter, setStateFilter] = useState<'ALL' | ConnectionState>('ALL');
    const [workerFilter, setWorkerFilter] = useState<string>('ALL');
    const [searchQuery, setSearchQuery] = useState<string>('');
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
            const res = await api.post<{
                migrated?: number;
                failed?: number;
                details?: string[];
                message?: string;
            }>(`/admin/mt5-cluster/workers/${encodeURIComponent(worker.workerId)}/drain`, {
                drain: nextDrain,
            });
            setBanner({
                tone: (res.data?.failed || 0) > 0 ? 'warning' : 'info',
                message:
                    res.data?.message ||
                    (nextDrain
                        ? `Worker ${worker.workerId} colocado em modo Drain (${res.data?.migrated ?? 0} conta(s) migrada(s)).`
                        : `Worker ${worker.workerId} reativado no balanceador.`),
            });
            await fetchTelemetry(true);
        } catch (err: any) {
            setBanner({
                tone: 'danger',
                message: formatAdminApiError(
                    err,
                    `Falha ao atualizar estado do worker ${worker.workerId}.`,
                    `POST /admin/mt5-cluster/workers/${worker.workerId}/drain`,
                ),
            });
        } finally {
            setDrainingId(null);
        }
    };

    const handleMigrateWorker = async (worker: ClusterWorkerNode) => {
        setMigratingWorkerId(worker.workerId);
        try {
            const res = await api.post<{
                migrated?: number;
                failed?: number;
                details?: string[];
                message?: string;
            }>(`/admin/mt5-cluster/workers/${encodeURIComponent(worker.workerId)}/migrate`, {});
            setBanner({
                tone: (res.data?.failed || 0) > 0 ? 'warning' : 'success',
                message:
                    res.data?.message ||
                    `Migração da VPS ${worker.workerId} iniciada (${res.data?.migrated ?? 0} conta(s)).`,
            });
            await fetchTelemetry(true);
        } catch (err: any) {
            setBanner({
                tone: 'danger',
                message: formatAdminApiError(
                    err,
                    `Não foi possível migrar as contas do servidor ${worker.workerId}.`,
                    `POST /admin/mt5-cluster/workers/${worker.workerId}/migrate`,
                ),
            });
        } finally {
            setMigratingWorkerId(null);
        }
    };

    const pollTaskUntilSettled = useCallback(
        (
            telemetryId: string,
            accountLabel: string,
            taskId: string,
            action: 'RECONNECT' | 'MIGRATE',
            workerId: string,
        ) => {
            const startedAt = Date.now();
            const actionLabel = action === 'MIGRATE' ? 'Migração' : 'Reconexão';
            const intervalId = window.setInterval(async () => {
                const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
                try {
                    const statusRes = await api.get<{
                        taskStatus: 'QUEUED' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'UNKNOWN';
                        connectionState: ConnectionState;
                        assignedWorkerId: string | null;
                        workerOnline: boolean;
                        pingMs: number | null;
                        message: string | null;
                        errorMessage: string | null;
                    }>(
                        `/admin/mt5-cluster/accounts/${encodeURIComponent(telemetryId)}/tasks/${encodeURIComponent(taskId)}`,
                    );
                    const st = statusRes.data;
                    const resolvedWorker = st.assignedWorkerId || workerId;

                    if (st.taskStatus === 'SUCCESS') {
                        window.clearInterval(intervalId);
                        const detail = `Conectada no servidor ${resolvedWorker}${typeof st.pingMs === 'number' ? ` (ping ${st.pingMs}ms)` : ''}${st.message ? ` · ${st.message}` : ''}`;
                        setActiveTaskByTelemetry((prev) => ({
                            ...prev,
                            [telemetryId]: {
                                action,
                                taskId,
                                workerId: resolvedWorker,
                                status: 'SUCCESS',
                                detail,
                                startedAt,
                            },
                        }));
                        setBanner({
                            tone: 'success',
                            message: `${actionLabel} concluída para ${accountLabel}: ${detail}`,
                        });
                        await fetchTelemetry(true);
                        return;
                    }

                    if (st.taskStatus === 'FAILED') {
                        window.clearInterval(intervalId);
                        const reason =
                            st.errorMessage ||
                            st.message ||
                            'O worker MT5 reportou falha sem detalhe adicional.';
                        setActiveTaskByTelemetry((prev) => ({
                            ...prev,
                            [telemetryId]: {
                                action,
                                taskId,
                                workerId: resolvedWorker,
                                status: 'FAILED',
                                detail: reason,
                                startedAt,
                            },
                        }));
                        setBanner({
                            tone: 'danger',
                            message: `${actionLabel} falhou para ${accountLabel} (${st.connectionState}): ${reason}`,
                        });
                        await fetchTelemetry(true);
                        return;
                    }

                    if (elapsedSec >= 45) {
                        window.clearInterval(intervalId);
                        const timeoutDetail =
                            st.taskStatus === 'QUEUED'
                                ? `Worker ${resolvedWorker} não coletou a tarefa em ${elapsedSec}s (${st.workerOnline ? 'worker online, mas fila ocupada' : 'worker offline'}).`
                                : `Em execução há ${elapsedSec}s no worker ${resolvedWorker} (${st.message || st.connectionState}). Atualize a telemetria para acompanhar.`;
                        setActiveTaskByTelemetry((prev) => ({
                            ...prev,
                            [telemetryId]: {
                                action,
                                taskId,
                                workerId: resolvedWorker,
                                status: 'TIMEOUT',
                                detail: timeoutDetail,
                                startedAt,
                            },
                        }));
                        setBanner({ tone: 'warning', message: `${accountLabel}: ${timeoutDetail}` });
                        await fetchTelemetry(true);
                        return;
                    }

                    const liveDetail =
                        st.taskStatus === 'IN_PROGRESS'
                            ? `Worker ${resolvedWorker} executando (${elapsedSec}s): ${st.message || 'autenticando no terminal MT5...'}`
                            : `Na fila do worker ${resolvedWorker} (${elapsedSec}s · aguardando worker coletar)`;
                    setActiveTaskByTelemetry((prev) => ({
                        ...prev,
                        [telemetryId]: {
                            action,
                            taskId,
                            workerId: resolvedWorker,
                            status: st.taskStatus === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'QUEUED',
                            detail: liveDetail,
                            startedAt,
                        },
                    }));
                } catch (pollErr: any) {
                    if (pollErr?.response?.status === 404 || elapsedSec >= 45) {
                        window.clearInterval(intervalId);
                    }
                }
            }, 2500);
        },
        [fetchTelemetry],
    );

    const handleReconnectAccount = async (acc: AnonymizedMt5Account) => {
        setReconnectingId(acc.telemetryId);
        const label = acc.accountName ? `${acc.accountName} (${acc.accountMask})` : acc.accountMask;
        try {
            const res = await api.post<{
                message?: string;
                workerId?: string;
                taskId?: string;
                credentialStatus?: string;
            }>(`/admin/mt5-cluster/accounts/${encodeURIComponent(acc.telemetryId)}/reconnect`);
            const targetWorker = res.data?.workerId || acc.assignedWorkerId || 'AUTO';
            const msg =
                res.data?.message ||
                `Reconexão solicitada para ${label} no worker ${targetWorker}.`;
            setBanner({
                tone: res.data?.credentialStatus && res.data.credentialStatus !== 'OK' ? 'warning' : 'info',
                message: msg,
            });
            if (res.data?.taskId) {
                setActiveTaskByTelemetry((prev) => ({
                    ...prev,
                    [acc.telemetryId]: {
                        action: 'RECONNECT',
                        taskId: res.data.taskId!,
                        workerId: targetWorker,
                        status: 'QUEUED',
                        detail: `Na fila do worker ${targetWorker} · aguardando coleta...`,
                        startedAt: Date.now(),
                    },
                }));
                pollTaskUntilSettled(
                    acc.telemetryId,
                    label,
                    res.data.taskId,
                    'RECONNECT',
                    targetWorker,
                );
            }
            await fetchTelemetry(true);
        } catch (err: any) {
            const concreteError = formatAdminApiError(
                err,
                `Não foi possível solicitar a reconexão da conta ${label}.`,
                `POST /admin/mt5-cluster/accounts/${acc.telemetryId}/reconnect`,
            );
            setActiveTaskByTelemetry((prev) => ({
                ...prev,
                [acc.telemetryId]: {
                    action: 'RECONNECT',
                    taskId: '',
                    workerId: acc.assignedWorkerId || '—',
                    status: 'FAILED',
                    detail: concreteError,
                    startedAt: Date.now(),
                },
            }));
            setBanner({ tone: 'danger', message: concreteError });
        } finally {
            setReconnectingId(null);
        }
    };

    const onlineHealthyWorkers = useMemo(() => {
        return (data?.workers || []).filter((w) => w.isOnline && !w.isDraining);
    }, [data?.workers]);

    const workerOnlineMap = useMemo(() => {
        const map = new Map<string, boolean>();
        for (const w of data?.workers || []) {
            map.set(w.workerId, Boolean(w.isOnline));
        }
        return map;
    }, [data?.workers]);

    const handleMigrateAccount = async (acc: AnonymizedMt5Account, explicitTarget?: string) => {
        const candidateTargets = onlineHealthyWorkers.filter(
            (w) => w.workerId !== acc.assignedWorkerId,
        );
        const targetWorkerId =
            explicitTarget ||
            selectedTargetWorker[acc.telemetryId] ||
            candidateTargets[0]?.workerId;

        if (!targetWorkerId) {
            setBanner({
                tone: 'warning',
                message: 'Nenhum outro servidor online saudável disponível para receber esta conta.',
            });
            return;
        }

        const label = acc.accountName ? `${acc.accountName} (${acc.accountMask})` : acc.accountMask;
        setMigratingId(acc.telemetryId);
        try {
            const res = await api.post<{
                message?: string;
                toWorkerId?: string;
                taskId?: string;
            }>(`/admin/mt5-cluster/accounts/${encodeURIComponent(acc.telemetryId)}/migrate`, {
                targetWorkerId,
            });
            const destWorker = res.data?.toWorkerId || targetWorkerId;
            setBanner({
                tone: 'info',
                message:
                    res.data?.message ||
                    `Migração silenciosa iniciada para ${label} → ${destWorker}.`,
            });
            if (res.data?.taskId) {
                setActiveTaskByTelemetry((prev) => ({
                    ...prev,
                    [acc.telemetryId]: {
                        action: 'MIGRATE',
                        taskId: res.data.taskId!,
                        workerId: destWorker,
                        status: 'QUEUED',
                        detail: `Migração na fila do worker ${destWorker} · aguardando login MT5...`,
                        startedAt: Date.now(),
                    },
                }));
                pollTaskUntilSettled(
                    acc.telemetryId,
                    label,
                    res.data.taskId,
                    'MIGRATE',
                    destWorker,
                );
            }
            await fetchTelemetry(true);
        } catch (err: any) {
            const concreteError = formatAdminApiError(
                err,
                `Não foi possível migrar a conta ${label}.`,
                `POST /admin/mt5-cluster/accounts/${acc.telemetryId}/migrate`,
            );
            setActiveTaskByTelemetry((prev) => ({
                ...prev,
                [acc.telemetryId]: {
                    action: 'MIGRATE',
                    taskId: '',
                    workerId: targetWorkerId,
                    status: 'FAILED',
                    detail: concreteError,
                    startedAt: Date.now(),
                },
            }));
            setBanner({ tone: 'danger', message: concreteError });
        } finally {
            setMigratingId(null);
        }
    };

    const filteredAccounts = useMemo(() => {
        const list = data?.accounts || [];
        const q = searchQuery.trim().toLowerCase();
        return list.filter((acc) => {
            if (stateFilter !== 'ALL' && acc.connectionState !== stateFilter) return false;
            if (workerFilter !== 'ALL' && (acc.assignedWorkerId || 'UNASSIGNED') !== workerFilter) {
                return false;
            }
            if (q) {
                const haystack = [
                    acc.ownerName || '',
                    acc.accountName || '',
                    acc.accountLabel || '',
                    acc.accountMask || '',
                    acc.telemetryId || '',
                    acc.assignedWorkerId || '',
                ]
                    .join(' ')
                    .toLowerCase();
                if (!haystack.includes(q)) return false;
            }
            return true;
        });
    }, [data?.accounts, stateFilter, workerFilter, searchQuery]);

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
                title="Telemetria Protegida (Zero Exposição de Credenciais e Saldos)"
                message="Esta visualização exibe métricas técnicas, nome de identificação da conta e ação direta de reconexão. Nenhuma senha, e-mail, login completo, saldo ou equity é exposto."
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

                                <div className="flex items-center justify-between text-[11px] text-fg-muted">
                                    <span>
                                        Conectadas: <strong className="text-fg">{w.connectedCount ?? 0}</strong> · Alertas:{' '}
                                        <strong className={cn((w.alertCount ?? 0) > 0 ? 'text-danger-fg' : 'text-fg')}>
                                            {w.alertCount ?? 0}
                                        </strong>
                                    </span>
                                    <span>
                                        Ping médio: <strong className="text-fg">{w.avgPingMs !== null && w.avgPingMs !== undefined ? `${w.avgPingMs}ms` : '—'}</strong>
                                    </span>
                                </div>

                                <div className="space-y-1.5 border-t border-line pt-2.5">
                                    <div className="flex items-center justify-between text-[11px] text-fg-muted">
                                        <span>Contas associadas a este servidor</span>
                                        <button
                                            type="button"
                                            onClick={() => setWorkerFilter(w.workerId)}
                                            className="text-accent-fg hover:underline font-medium"
                                        >
                                            Filtrar tabela
                                        </button>
                                    </div>
                                    {!w.accountTags?.length ? (
                                        <div className="text-[11px] text-fg-subtle italic">
                                            Nenhuma conta alocada neste nó.
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                            {w.accountTags.map((tag) => {
                                                const st = STATE_META[tag.connectionState] || STATE_META.DISCONNECTED;
                                                const tagLabel = tag.ownerName || tag.accountName;
                                                return (
                                                    <span
                                                        key={tag.telemetryId}
                                                        title={`${tagLabel ? `${tagLabel} · ` : ''}#${tag.telemetryId} · ${tag.syncTier} · e${tag.leaseEpoch}`}
                                                        className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[10px] text-fg max-w-[220px]"
                                                    >
                                                        <span
                                                            className={cn(
                                                                'h-1.5 w-1.5 rounded-full shrink-0',
                                                                st.tone === 'success'
                                                                    ? 'bg-emerald-500'
                                                                    : st.tone === 'info'
                                                                      ? 'bg-sky-500'
                                                                      : st.tone === 'warning'
                                                                        ? 'bg-amber-500'
                                                                        : st.tone === 'danger'
                                                                          ? 'bg-rose-500'
                                                                          : 'bg-fg-subtle',
                                                            )}
                                                        />
                                                        {tagLabel && (
                                                            <span className="font-semibold truncate">
                                                                {tagLabel}
                                                            </span>
                                                        )}
                                                        <span className="font-mono text-fg-muted shrink-0">
                                                            {tag.accountMask}
                                                        </span>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center justify-between gap-2 pt-1">
                                    <span className="text-[11px] text-fg-muted">
                                        Terminais ativos: {w.activeTerminals ?? 0}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                        {w.assignedAccountsCount > 0 &&
                                            onlineHealthyWorkers.some((o) => o.workerId !== w.workerId) && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={migratingWorkerId === w.workerId}
                                                    onClick={() => handleMigrateWorker(w)}
                                                    className="h-7 px-2.5 text-xs gap-1"
                                                    title={`Migrar todas as contas de ${w.workerId} para outro servidor online`}
                                                >
                                                    <ArrowRightLeft
                                                        className={cn(
                                                            'h-3.5 w-3.5',
                                                            migratingWorkerId === w.workerId && 'animate-pulse',
                                                        )}
                                                    />
                                                    {migratingWorkerId === w.workerId ? 'Migrando...' : 'Migrar VPS'}
                                                </Button>
                                            )}
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
                            </div>
                        ))}
                    </div>
                )}
            </AdminSectionCard>

            {/* Correlações Servidor × Contas */}
            <AdminSectionCard
                title={`Correlações Servidor × Contas (Balanceador K=${data?.stride ?? 2})`}
                subtitle="Relação entre ocupação de slots, saúde de hardware (CPU/RAM), latência e estabilidade das contas por nó"
                icon={<Activity className="h-4 w-4" />}
            >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
                    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                        <div className="text-[11px] text-fg-muted">Servidores Online</div>
                        <div className="text-lg font-bold text-fg mt-0.5">
                            {data?.correlations?.onlineWorkersCount ?? 0}
                        </div>
                    </div>
                    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                        <div className="text-[11px] text-fg-muted">Média Contas / Servidor</div>
                        <div className="text-lg font-bold text-fg mt-0.5">
                            {data?.correlations?.avgAccountsPerOnlineWorker ?? 0}
                        </div>
                    </div>
                    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                        <div className="text-[11px] text-fg-muted">Desvio de Carga (Gap)</div>
                        <div className="text-lg font-bold text-fg mt-0.5">
                            {data?.correlations?.pairStrideBalanceGap ?? 0}
                        </div>
                    </div>
                    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                        <div className="text-[11px] text-fg-muted">Sem Servidor Atribuído</div>
                        <div className={cn('text-lg font-bold mt-0.5', (data?.correlations?.unassignedCount ?? 0) > 0 ? 'text-amber-500' : 'text-fg')}>
                            {data?.correlations?.unassignedCount ?? 0}
                        </div>
                    </div>
                </div>

                {!data?.correlations?.workerCorrelation?.length ? (
                    <p className="text-xs text-fg-muted">Sem dados suficientes de correlação entre servidores.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="border-b border-line bg-surface-2/40 text-[11px] uppercase tracking-wider text-fg-muted">
                                <tr>
                                    <th className="px-3 py-2.5 font-semibold">Servidor</th>
                                    <th className="px-3 py-2.5 font-semibold">Contas</th>
                                    <th className="px-3 py-2.5 font-semibold">Ocupação Slots</th>
                                    <th className="px-3 py-2.5 font-semibold">Taxa Conectada</th>
                                    <th className="px-3 py-2.5 font-semibold">CPU / RAM</th>
                                    <th className="px-3 py-2.5 font-semibold">Ping Médio</th>
                                    <th className="px-3 py-2.5 font-semibold">Alertas</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {data.correlations.workerCorrelation.map((corr) => (
                                    <tr key={corr.workerId} className="hover:bg-surface-2/30">
                                        <td className="px-3 py-2.5 font-mono font-semibold text-fg whitespace-nowrap">
                                            {corr.workerId}
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">{corr.assignedAccountsCount}</td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <div className="h-1.5 w-20 rounded-full bg-surface-2 overflow-hidden">
                                                    <div
                                                        className="h-full bg-accent"
                                                        style={{ width: `${Math.min(100, corr.slotUtilizationPct)}%` }}
                                                    />
                                                </div>
                                                <span className="font-mono">{corr.slotUtilizationPct}%</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                            <AdminBadge tone={corr.connectedRatePct >= 80 ? 'success' : corr.connectedRatePct >= 50 ? 'warning' : 'danger'}>
                                                {corr.connectedRatePct}%
                                            </AdminBadge>
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-fg-muted whitespace-nowrap">
                                            {corr.cpuPercent !== null ? `${corr.cpuPercent}%` : '—'} /{' '}
                                            {corr.memoryPercent !== null ? `${corr.memoryPercent}%` : '—'}
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-fg-muted whitespace-nowrap">
                                            {corr.avgPingMs !== null ? `${corr.avgPingMs}ms` : '—'}
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                            <AdminBadge tone={corr.alertCount > 0 ? 'danger' : 'neutral'}>
                                                {corr.alertCount}
                                            </AdminBadge>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </AdminSectionCard>

            {/* Log Exclusivo do Admin: Migrações & Failover entre Servidores */}
            <AdminSectionCard
                title="Log de Migrações & Failover entre Servidores (Somente Admin)"
                subtitle="Trocas automáticas quando um servidor cai e migrações manuais — 100% invisível para os clientes mantendo a conexão ativa"
                icon={<ArrowRightLeft className="h-4 w-4" />}
            >
                {!data?.migrationLogs?.length ? (
                    <div className="flex items-center gap-2 text-xs text-fg-muted">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        Nenhuma migração ou failover entre servidores registrado ainda.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {data.migrationLogs.slice(0, 20).map((log) => {
                            const trig =
                                MIGRATION_TRIGGER_META[log.trigger] ||
                                MIGRATION_TRIGGER_META.AUTO_FAILOVER;
                            const stat =
                                MIGRATION_STATUS_META[log.status] ||
                                MIGRATION_STATUS_META.IN_PROGRESS;
                            return (
                                <div
                                    key={log.id}
                                    className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2/30 px-3.5 py-2.5 lg:flex-row lg:items-center lg:justify-between"
                                >
                                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                                        <span className="font-semibold text-xs text-fg shrink-0">
                                            {log.accountName || log.accountMask}
                                        </span>
                                        <span className="font-mono text-[11px] text-fg-muted shrink-0">
                                            {log.accountMask} · #{log.telemetryId}
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-fg shrink-0">
                                            <span className="text-fg-muted">
                                                {log.fromWorkerId || 'sem-servidor'}
                                            </span>
                                            <ArrowRight className="h-3 w-3 text-accent-fg" />
                                            <span className="font-semibold text-fg">
                                                {log.toWorkerId}
                                            </span>
                                            <span className="text-[10px] text-fg-subtle">
                                                (e{log.leaseEpoch})
                                            </span>
                                        </span>
                                        <AdminBadge tone={trig.tone}>{trig.label}</AdminBadge>
                                        <AdminBadge tone={stat.tone} dot>
                                            {stat.label}
                                        </AdminBadge>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 text-[11px] text-fg-muted lg:justify-end min-w-0">
                                        <span
                                            className="truncate max-w-md"
                                            title={log.details || log.reason}
                                        >
                                            {log.details || log.reason}
                                        </span>
                                        <span
                                            className="font-mono text-fg-subtle shrink-0"
                                            title={new Date(log.createdAt).toLocaleString()}
                                        >
                                            {formatRelativeTime(log.createdAt)}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
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
                                        {(item.ownerName || item.accountName) && (
                                            <span className="text-xs font-semibold text-fg shrink-0 max-w-[180px] truncate">
                                                {item.ownerName || item.accountName}
                                            </span>
                                        )}
                                        <span className="font-mono text-xs font-semibold text-fg-muted shrink-0">
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
                        <input
                            type="text"
                            aria-label="Buscar por usuário, conta ou ID"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Buscar usuário ou MT5..."
                            className="h-8 w-44 rounded-lg border border-line bg-surface px-2.5 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-line-strong"
                        />
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
                                    <th className="px-4 py-3 font-semibold">Usuário / Conta (Mask / ID)</th>
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
                                    const primaryUserLabel = acc.ownerName || acc.accountName;
                                    const secondaryAccountLabel =
                                        acc.accountLabel &&
                                        acc.accountLabel.toLowerCase() !==
                                            (primaryUserLabel || '').toLowerCase()
                                            ? acc.accountLabel
                                            : null;
                                    return (
                                        <tr key={acc.telemetryId} className="hover:bg-surface-2/30 transition-colors">
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div
                                                            className="font-semibold text-fg truncate max-w-[220px]"
                                                            title={primaryUserLabel || acc.accountMask}
                                                        >
                                                            {primaryUserLabel || 'Utilizador não vinculado'}
                                                        </div>
                                                        {secondaryAccountLabel && (
                                                            <div
                                                                className="text-[11px] text-fg-muted truncate max-w-[220px]"
                                                                title={secondaryAccountLabel}
                                                            >
                                                                {secondaryAccountLabel}
                                                            </div>
                                                        )}
                                                        <div className="font-mono text-[11px] text-fg-muted">
                                                            {acc.accountMask}{' '}
                                                            <span className="text-[10px] text-fg-subtle">
                                                                · #{acc.telemetryId}
                                                            </span>
                                                        </div>
                                                        {acc.hasStoredCredentials === false && (
                                                            <div className="mt-0.5">
                                                                <span
                                                                    className="inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
                                                                    title="Senha MT5 não armazenada no cofre do backend — migração entre VPS exige reconexão única pelo cliente"
                                                                >
                                                                    Sem senha no cofre
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={reconnectingId === acc.telemetryId}
                                                        onClick={() => handleReconnectAccount(acc)}
                                                        className="h-7 px-2.5 text-[11px] gap-1 shrink-0"
                                                        title={`Reconectar ${acc.accountName || acc.accountMask}`}
                                                    >
                                                        <RefreshCw
                                                            className={cn(
                                                                'h-3 w-3',
                                                                reconnectingId === acc.telemetryId && 'animate-spin',
                                                            )}
                                                        />
                                                        {reconnectingId === acc.telemetryId
                                                            ? 'Reconectando...'
                                                            : 'Reconectar'}
                                                    </Button>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <AdminBadge tone={meta.tone} dot>
                                                    {meta.label}
                                                </AdminBadge>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <AdminBadge tone={tierTone}>{acc.syncTier}</AdminBadge>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                {(() => {
                                                    const assignedOnline = acc.assignedWorkerId
                                                        ? workerOnlineMap.get(acc.assignedWorkerId) !== false
                                                        : false;
                                                    const candidateTargets = onlineHealthyWorkers.filter(
                                                        (w) => w.workerId !== acc.assignedWorkerId,
                                                    );
                                                    const chosenTarget =
                                                        selectedTargetWorker[acc.telemetryId] &&
                                                        candidateTargets.some(
                                                            (w) => w.workerId === selectedTargetWorker[acc.telemetryId],
                                                        )
                                                            ? selectedTargetWorker[acc.telemetryId]
                                                            : candidateTargets[0]?.workerId || '';
                                                    return (
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1.5 font-mono text-fg-muted">
                                                                {acc.assignedWorkerId && (
                                                                    <span
                                                                        className={cn(
                                                                            'h-1.5 w-1.5 rounded-full shrink-0',
                                                                            assignedOnline
                                                                                ? 'bg-emerald-500'
                                                                                : 'bg-rose-500',
                                                                        )}
                                                                        title={
                                                                            assignedOnline
                                                                                ? 'Servidor online'
                                                                                : 'Servidor offline'
                                                                        }
                                                                    />
                                                                )}
                                                                <span>{acc.assignedWorkerId || '—'}</span>
                                                            </div>
                                                            {candidateTargets.length > 0 && (
                                                                <div className="flex items-center gap-1">
                                                                    {candidateTargets.length > 1 && (
                                                                        <select
                                                                            aria-label={`Selecionar servidor destino para ${acc.accountName || acc.accountMask}`}
                                                                            value={chosenTarget}
                                                                            onChange={(e) =>
                                                                                setSelectedTargetWorker((prev) => ({
                                                                                    ...prev,
                                                                                    [acc.telemetryId]: e.target.value,
                                                                                }))
                                                                            }
                                                                            className="h-7 rounded-md border border-line bg-surface px-1.5 font-mono text-[11px] text-fg"
                                                                        >
                                                                            {candidateTargets.map((w) => (
                                                                                <option
                                                                                    key={w.workerId}
                                                                                    value={w.workerId}
                                                                                >
                                                                                    {w.workerId}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    )}
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        disabled={migratingId === acc.telemetryId}
                                                                        onClick={() =>
                                                                            handleMigrateAccount(acc, chosenTarget)
                                                                        }
                                                                        className="h-7 px-2 text-[11px] gap-1 shrink-0"
                                                                        title={`Migrar silenciosamente para ${chosenTarget} mantendo a conexão ativa`}
                                                                    >
                                                                        <ArrowRightLeft
                                                                            className={cn(
                                                                                'h-3 w-3',
                                                                                migratingId === acc.telemetryId &&
                                                                                    'animate-pulse',
                                                                            )}
                                                                        />
                                                                        {migratingId === acc.telemetryId
                                                                            ? 'Migrando...'
                                                                            : candidateTargets.length === 1
                                                                              ? `→ ${chosenTarget}`
                                                                              : 'Migrar'}
                                                                    </Button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
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
                                            <td className="px-4 py-3 max-w-sm text-fg-muted">
                                                {(() => {
                                                    const liveAction = activeTaskByTelemetry[acc.telemetryId];
                                                    const concreteText =
                                                        liveAction?.detail ||
                                                        acc.lastTaskError ||
                                                        acc.feedback ||
                                                        acc.lastTaskMessage ||
                                                        null;
                                                    const statusTone =
                                                        liveAction?.status === 'FAILED' ||
                                                        acc.lastTaskStatus === 'FAILED' ||
                                                        acc.connectionState === 'AUTH_FAILED'
                                                            ? 'text-danger-fg'
                                                            : liveAction?.status === 'SUCCESS'
                                                              ? 'text-emerald-400'
                                                              : liveAction?.status === 'TIMEOUT'
                                                                ? 'text-amber-400'
                                                                : liveAction?.status === 'QUEUED' ||
                                                                    liveAction?.status === 'IN_PROGRESS'
                                                                  ? 'text-sky-400'
                                                                  : 'text-fg-muted';
                                                    return concreteText ? (
                                                        <div
                                                            className={cn(
                                                                'text-[11px] leading-snug line-clamp-2 break-words',
                                                                statusTone,
                                                            )}
                                                            title={concreteText}
                                                        >
                                                            {concreteText}
                                                        </div>
                                                    ) : (
                                                        <span className="text-fg-subtle">—</span>
                                                    );
                                                })()}
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
