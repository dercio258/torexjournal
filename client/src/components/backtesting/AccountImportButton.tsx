import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { useAccount } from '../../context/AccountContext';
import { useLocale } from '../../context/LocaleContext';
import { pullAccountHistoryInBatchesAndBuildUnifiedSession, UnifiedSyncBatchProgress } from '../../services/historicalBatchCache';

/**
 * Pulls the selected account's closed trades in batches, pre-caches the OHLCV
 * around them and assembles one replay session, then opens it.
 */
export const AccountImportButton = ({ onDone }: { onDone?: () => void }) => {
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const { selectedAccountId, selectedAccount } = useAccount();
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<UnifiedSyncBatchProgress | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        setBusy(true);
        setError(null);
        try {
            const broker = String((selectedAccount as any)?.broker || selectedAccount?.name || '').toLowerCase();
            const isDeriv = broker.includes('deriv');
            const result = await pullAccountHistoryInBatchesAndBuildUnifiedSession({
                accountId: selectedAccountId !== 'all' ? selectedAccountId : undefined,
                accountName: selectedAccount?.name || (isEn ? 'Primary Account' : 'Conta principal'),
                syncSourceLabel: isDeriv ? 'Deriv Sync' : 'MT5 Sync',
                isDeriv,
                triggerLiveBrokerSync: true,
                onProgress: setProgress,
            });
            onDone?.();
            navigate(`/backtesting/replay/${result.session.id}`);
        } catch (e: any) {
            setError(
                e?.message ||
                    (isEn
                        ? 'Unable to import executions from the selected account.'
                        : 'Não foi possível importar os trades da conta.')
            );
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    return (
        <div className="space-y-2">
            <Button
                variant="outline"
                size="sm"
                isLoading={busy}
                icon={<Download size={14} />}
                onClick={run}
                title={
                    isEn
                        ? 'Create a replay session using closed trades from the selected account and pre-cache surrounding bars'
                        : 'Cria uma sessão com os trades fechados da conta selecionada e pré-carrega as velas à volta deles'
                }
            >
                {isEn ? 'Import Account Trades' : 'Importar trades da conta'}
            </Button>
            {progress && (
                <div role="status" className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] text-fg-muted">
                    <p className="flex items-center gap-1.5 font-semibold text-fg">
                        <RefreshCw size={12} className="animate-spin" aria-hidden /> {progress.message}
                    </p>
                    <p className="mt-0.5 tabular-nums">
                        {isEn
                            ? `Trades: ${progress.loadedTradeBatches}/${progress.totalTradeBatches} batches · Bars: ${progress.loadedCandleBatches}/${progress.totalCandleBatches} batches (${progress.totalCandlesCached.toLocaleString('en-US')})`
                            : `Trades: ${progress.loadedTradeBatches}/${progress.totalTradeBatches} lotes · Velas: ${progress.loadedCandleBatches}/${progress.totalCandleBatches} lotes (${progress.totalCandlesCached.toLocaleString('pt-BR')})`}
                    </p>
                </div>
            )}
            {error && <p role="alert" className="text-[11px] text-danger-fg">{error}</p>}
        </div>
    );
};
