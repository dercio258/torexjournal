import React, { useEffect, useRef, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    CloudUpload,
    Crown,
    Lock,
    RefreshCw,
    RotateCcw,
    Trash2,
    Wifi,
    WifiOff,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { useOfflineSyncStore } from '../../store/useOfflineSyncStore';
import {
    canUseGeneralOfflineMode,
    canUseReplayOfflineMode,
    openWorkspacePlansModal,
} from '../../lib/planGate';

export const OfflineSyncIndicator: React.FC = () => {
    const { user } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const allowGeneralOffline = canUseGeneralOfflineMode(user?.tier);
    const allowReplayOffline = canUseReplayOfflineMode(user?.tier);

    const {
        isOnline,
        isSyncing,
        syncStatus,
        pendingMutationsCount,
        pendingMediaCount,
        failedMutations,
        lastSyncedAt,
        justSyncedBannerUntil,
        triggerSync,
        retryFailedMutation,
        discardFailedMutation,
    } = useOfflineSyncStore();

    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onClickOutside);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onClickOutside);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const totalPending = pendingMutationsCount + pendingMediaCount;
    const showJustSynced =
        Boolean(justSyncedBannerUntil && Date.now() < justSyncedBannerUntil) &&
        isOnline &&
        !isSyncing &&
        totalPending === 0 &&
        failedMutations.length === 0;

    const shouldRender = !allowGeneralOffline
        ? !isOnline
        : !isOnline ||
          isSyncing ||
          totalPending > 0 ||
          failedMutations.length > 0 ||
          syncStatus === 'paused_auth' ||
          showJustSynced;

    if (!shouldRender) {
        return null;
    }

    if (!allowGeneralOffline) {
        return (
            <div ref={wrapperRef} className="relative">
                <button
                    type="button"
                    onClick={() => setOpen((prev) => !prev)}
                    className="h-7 px-2 rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-400 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer focus:outline-none"
                    title={
                        isEn
                            ? 'Offline Mode requires Pro or Premium plan'
                            : 'Modo Offline disponível nos planos Pro e Premium'
                    }
                >
                    <Lock size={11} className="shrink-0" />
                    <span className="hidden xs:inline whitespace-nowrap">
                        {isEn ? 'Offline (PRO)' : 'Offline (PRO)'}
                    </span>
                </button>

                {open && (
                    <div className="absolute right-0 mt-2 w-72 rounded-xl bg-surface border border-line-strong shadow-panel backdrop-blur-xl z-50 overflow-hidden animate-fade-in-up p-3.5 space-y-2.5 text-xs">
                        <div className="flex items-center gap-2 font-bold text-fg">
                            <Lock size={14} className="text-amber-400 shrink-0" />
                            <span>{isEn ? 'Offline Mode Locked' : 'Modo Offline Bloqueado'}</span>
                        </div>
                        <p className="text-[11px] text-fg-muted leading-relaxed">
                            {isEn
                                ? 'Basic plan operates online only. Upgrade to Pro for offline access in all sections except Trade Replay, or Premium for full offline mode including Trade Replay.'
                                : 'O pacote Básico opera apenas online. Atualize para o Pro (Offline em todas as secções exceto Trade Replay) ou Premium (Offline completo até no Replay).'}
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                openWorkspacePlansModal('offline_indicator_basic');
                            }}
                            className="w-full py-2 px-3 rounded-lg bg-accent hover:bg-accent-hover text-accent-on text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                            <Crown size={13} />
                            <span>{isEn ? 'Upgrade Plan' : 'Atualizar Plano'}</span>
                        </button>
                    </div>
                )}
            </div>
        );
    }

    let badgeClasses =
        'bg-surface/80 hover:bg-surface-2 border-line text-fg-muted';
    let icon = <Wifi size={12} className="text-accent-fg shrink-0" />;
    let label = isEn ? 'Online' : 'Online';

    if (!isOnline) {
        badgeClasses =
            'bg-warning/10 hover:bg-warning/15 border-warning/35 text-warning';
        icon = <WifiOff size={12} className="shrink-0" />;
        label =
            totalPending > 0
                ? `Offline (${totalPending})`
                : 'Offline';
    } else if (isSyncing) {
        badgeClasses =
            'bg-accent/10 border-accent/35 text-accent-fg';
        icon = <RefreshCw size={12} className="animate-spin shrink-0" />;
        label = isEn
            ? `Syncing${totalPending > 0 ? ` (${totalPending})` : '...'}`
            : `Sincronizando${totalPending > 0 ? ` (${totalPending})` : '...'}`;
    } else if (syncStatus === 'paused_auth') {
        badgeClasses =
            'bg-warning/10 hover:bg-warning/15 border-warning/35 text-warning';
        icon = <AlertTriangle size={12} className="shrink-0" />;
        label = isEn
            ? `Auth required (${totalPending})`
            : `Reautenticar (${totalPending})`;
    } else if (failedMutations.length > 0) {
        badgeClasses =
            'bg-danger/10 hover:bg-danger/15 border-danger/35 text-danger-fg';
        icon = <AlertTriangle size={12} className="shrink-0" />;
        label = isEn
            ? `Sync error (${failedMutations.length})`
            : `Erro sync (${failedMutations.length})`;
    } else if (totalPending > 0) {
        badgeClasses =
            'bg-accent/10 hover:bg-accent/15 border-accent/35 text-accent-fg';
        icon = <CloudUpload size={12} className="shrink-0" />;
        label = isEn ? `${totalPending} pending` : `${totalPending} pend.`;
    } else if (showJustSynced) {
        badgeClasses =
            'bg-accent/10 border-accent/35 text-accent-fg';
        icon = <CheckCircle2 size={12} className="shrink-0" />;
        label = isEn ? 'Synced' : 'Sincronizado';
    }

    const formattedLastSync = lastSyncedAt
        ? new Date(lastSyncedAt).toLocaleTimeString(isEn ? 'en-US' : 'pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
          })
        : null;

    return (
        <div ref={wrapperRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className={`h-7 px-2 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer focus:outline-none ${badgeClasses}`}
                title={
                    isEn
                        ? 'Offline storage & synchronization status'
                        : 'Estado offline e fila de sincronização'
                }
            >
                {icon}
                <span className="hidden xs:inline whitespace-nowrap">{label}</span>
            </button>

            {open && (
                <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-xl bg-surface border border-line-strong shadow-panel backdrop-blur-xl z-50 overflow-hidden animate-fade-in-up">
                    <div className="px-3.5 py-2.5 border-b border-line bg-canvas-subtle flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {isOnline ? (
                                <Wifi size={14} className="text-accent-fg" />
                            ) : (
                                <WifiOff size={14} className="text-warning" />
                            )}
                            <span className="text-xs font-semibold text-fg">
                                {isOnline
                                    ? isEn
                                        ? 'Online · Local Sync'
                                        : 'Online · Sync Local'
                                    : isEn
                                      ? 'Offline Mode (IndexedDB)'
                                      : 'Modo Offline (IndexedDB)'}
                            </span>
                        </div>
                        {formattedLastSync && (
                            <span className="text-[10px] text-fg-subtle tabular-nums">
                                {isEn ? `Last: ${formattedLastSync}` : `Último: ${formattedLastSync}`}
                            </span>
                        )}
                    </div>

                    <div className="p-3.5 space-y-3 text-xs">
                        <p className="text-[11px] text-fg-muted leading-relaxed">
                            {!isOnline
                                ? isEn
                                    ? 'Changes made offline are safely persisted in IndexedDB and will sync automatically when connection returns.'
                                    : 'Alterações feitas sem internet ficam salvas localmente no IndexedDB e serão sincronizadas automaticamente ao reconectar.'
                                : syncStatus === 'paused_auth'
                                  ? isEn
                                      ? 'Your session expired while offline. Sign in again to resume syncing pending local changes.'
                                      : 'Sua sessão expirou. Faça login novamente para retomar o envio das alterações locais.'
                                  : isEn
                                    ? 'Local IndexedDB outbox tracks pending edits and screenshots.'
                                    : 'A fila local no IndexedDB gerencia edições e imagens pendentes.'}
                        </p>
                        <div className="rounded-lg border border-line-subtle bg-canvas-subtle px-2.5 py-1.5 text-[10px] font-medium text-fg-muted flex items-center justify-between gap-2">
                            <span>
                                {allowReplayOffline
                                    ? isEn
                                        ? 'Premium: Full offline (incl. Trade Replay)'
                                        : 'Premium: Offline completo (incl. Replay)'
                                    : isEn
                                      ? 'Pro: Offline everywhere except Replay'
                                      : 'Pro: Offline em tudo exceto Replay'}
                            </span>
                            {!allowReplayOffline && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setOpen(false);
                                        openWorkspacePlansModal('offline_replay_scope');
                                    }}
                                    className="text-accent-fg font-bold hover:underline shrink-0 cursor-pointer"
                                >
                                    Premium
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div className="p-2 rounded-lg bg-canvas border border-line">
                                <span className="block text-[10px] uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Pending edits' : 'Edições na fila'}
                                </span>
                                <span className="text-sm font-bold text-fg tabular-nums">
                                    {pendingMutationsCount}
                                </span>
                            </div>
                            <div className="p-2 rounded-lg bg-canvas border border-line">
                                <span className="block text-[10px] uppercase tracking-wider text-fg-subtle">
                                    {isEn ? 'Queued images' : 'Imagens na fila'}
                                </span>
                                <span className="text-sm font-bold text-fg tabular-nums">
                                    {pendingMediaCount}
                                </span>
                            </div>
                        </div>

                        {failedMutations.length > 0 && (
                            <div className="space-y-1.5 max-h-40 overflow-y-auto pt-1">
                                <span className="block text-[10px] font-semibold uppercase tracking-wider text-danger-fg">
                                    {isEn ? 'Sync Errors' : 'Erros de Sincronização'}
                                </span>
                                {failedMutations.map((item) => (
                                    <div
                                        key={item.mutationId}
                                        className="p-2 rounded-lg bg-danger/5 border border-danger/25 space-y-1.5"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-semibold text-fg truncate">
                                                {item.method} · {item.entityType}
                                            </span>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        void retryFailedMutation(item.mutationId)
                                                    }
                                                    className="p-1 rounded hover:bg-surface-2 text-accent-fg cursor-pointer"
                                                    title={isEn ? 'Retry' : 'Tentar novamente'}
                                                >
                                                    <RotateCcw size={12} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        void discardFailedMutation(item.mutationId)
                                                    }
                                                    className="p-1 rounded hover:bg-surface-2 text-danger-fg cursor-pointer"
                                                    title={isEn ? 'Discard' : 'Descartar'}
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                        {item.lastError && (
                                            <p className="text-[10px] text-danger-fg break-words">
                                                {item.lastError}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        <button
                            type="button"
                            disabled={!isOnline || isSyncing || totalPending === 0}
                            onClick={() => void triggerSync()}
                            className="w-full py-2 px-3 rounded-lg bg-accent hover:bg-accent-hover text-accent-on text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-45 disabled:pointer-events-none cursor-pointer"
                        >
                            <RefreshCw
                                size={13}
                                className={isSyncing ? 'animate-spin' : ''}
                            />
                            <span>
                                {isSyncing
                                    ? isEn
                                        ? 'Syncing...'
                                        : 'Sincronizando...'
                                    : isEn
                                      ? 'Sync now'
                                      : 'Sincronizar agora'}
                            </span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
