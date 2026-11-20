import React, { useState } from 'react';
import { Clock, ShieldCheck } from 'lucide-react';
import api from '../../api';
import { useAccount } from '../../context/AccountContext';

interface IdleAccountWarningBannerProps {
    isEn?: boolean;
}

export const IdleAccountWarningBanner: React.FC<IdleAccountWarningBannerProps> = ({
    isEn = false,
}) => {
    const { accounts, refreshAccounts } = useAccount();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>({});
    const [toastMsg, setToastMsg] = useState<string | null>(null);

    const pendingAccounts = accounts.filter((acc) => {
        if (acc.isArchived || !acc.isConnected || !acc.inactivityDisconnectAt) return false;
        if (dismissedIds[acc.id]) return false;
        const ms = new Date(acc.inactivityDisconnectAt).getTime();
        return Number.isFinite(ms) && ms > Date.now() - 3600_000;
    });

    if (pendingAccounts.length === 0 && !toastMsg) return null;

    const handleKeepAlive = async (accountId: string) => {
        if (busyId) return;
        setBusyId(accountId);
        try {
            const res = await api.post('/mt5/cloud/keep-alive', { accountId });
            setDismissedIds((prev) => ({ ...prev, [accountId]: true }));
            setToastMsg(
                res.data?.message ||
                    (isEn
                        ? 'Auto-sync will remain active for your account.'
                        : 'Sincronização mantida ativa! A sua conta continuará conectada normalmente.'),
            );
            await refreshAccounts();
            window.setTimeout(() => setToastMsg(null), 4000);
        } catch {
            // keep visible on transient error
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="space-y-2">
            {toastMsg && (
                <div className="bg-emerald-500/10 border border-emerald-500/25 px-3.5 py-2.5 rounded-xl flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>{toastMsg}</span>
                </div>
            )}
            {pendingAccounts.map((acc) => {
                const diffMs = Math.max(
                    0,
                    new Date(acc.inactivityDisconnectAt!).getTime() - Date.now(),
                );
                const hoursLeft = Math.max(1, Math.ceil(diffMs / 3_600_000));
                return (
                    <div
                        key={acc.id}
                        className="bg-amber-500/10 border border-amber-500/25 p-3.5 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3 animate-in fade-in duration-300"
                    >
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-amber-500/20 rounded-lg text-amber-600 dark:text-amber-400 shrink-0">
                                <Clock className="w-4 h-4" />
                            </div>
                            <div className="space-y-0.5">
                                <h3 className="text-fg font-bold text-xs sm:text-sm">
                                    {isEn
                                        ? `Auto-sync for "${acc.name}" pauses in ${hoursLeft}h`
                                        : `Sincronização de "${acc.name}" será pausada em ${hoursLeft}h`}
                                </h3>
                                <p className="text-fg-muted text-xs leading-relaxed">
                                    {isEn
                                        ? 'This account has had zero balance movement for 7 days. Keep automatic sync running with one click.'
                                        : 'Esta conta está sem movimentação de saldo há 7 dias. Deseja manter a sincronização automática conectada?'}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            disabled={busyId === acc.id}
                            onClick={() => void handleKeepAlive(acc.id)}
                            className="w-full md:w-auto px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                        >
                            {busyId === acc.id
                                ? isEn
                                    ? 'Updating...'
                                    : 'Atualizando...'
                                : isEn
                                ? 'Keep Sync Active'
                                : 'Manter Sincronização Ativa'}
                        </button>
                    </div>
                );
            })}
        </div>
    );
};
