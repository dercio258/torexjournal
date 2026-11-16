import { useEffect, useState } from 'react';
import { Check, Copy, Download, Monitor, Wallet } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useLocale } from '../../context/LocaleContext';
import { Button } from '../../components/ui/Button';

export const Mt5EaSyncPage = () => {
    const { user } = useAuth();
    const { selectedAccountId, selectedAccount, openManageModal } = useAccount();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [appToken, setAppToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const fetchToken = async () => {
            try {
                const params: Record<string, string> = {};
                if (selectedAccountId && selectedAccountId !== 'all') {
                    params.accountId = selectedAccountId;
                }
                const res = await api.get('/auth/app-token', { params });
                if (res.data?.token) {
                    setAppToken(res.data.token);
                    return;
                }
            } catch {
                // Fallback to account token
            }
            if (selectedAccount?.appToken) {
                setAppToken(selectedAccount.appToken);
            } else {
                setAppToken(user?.id ? `ea-${user.id.substring(0, 8)}` : null);
            }
        };
        fetchToken();
    }, [user, selectedAccountId, selectedAccount]);

    const handleCopy = () => {
        if (!appToken) return;
        navigator.clipboard.writeText(appToken);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    return (
        <div className="rounded-2xl border border-line bg-surface p-5 sm:p-8 space-y-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex items-center gap-3.5 pb-5 border-b border-line">
                <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-line-strong flex items-center justify-center text-fg shrink-0">
                    <Monitor size={23} />
                </div>
                <div>
                    <h2 className="text-lg sm:text-xl font-bold text-fg">
                        {isEn ? 'Desktop EA Bridge' : 'Conector no Computador'}
                    </h2>
                    <p className="text-xs sm:text-sm text-fg-muted">
                        {isEn ? 'For local MetaTrader 5 terminals on Windows' : 'Para MetaTrader 5 instalado no Windows'}
                    </p>
                </div>
            </div>

            {/* Destination Account */}
            <div className="rounded-xl bg-canvas-subtle border border-line p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <Wallet size={17} className="text-accent-fg shrink-0" />
                    <div className="min-w-0">
                        <span className="text-[11px] uppercase tracking-wider text-fg-subtle font-semibold block">
                            {isEn ? 'Target Account' : 'Conta vinculada'}
                        </span>
                        <p className="text-sm font-bold text-fg truncate mt-0.5">
                            {selectedAccount?.name || (isEn ? 'Primary Account' : 'Conta Principal')}
                            <span className="text-xs text-fg-muted font-normal ml-1.5">
                                ({selectedAccount?.currency || 'USD'})
                            </span>
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => openManageModal('accounts')}
                    className="text-xs font-semibold text-accent-fg hover:underline shrink-0"
                >
                    {isEn ? 'Switch' : 'Trocar'}
                </button>
            </div>

            {/* Code + Download */}
            <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    {isEn ? 'Linking EA Token' : 'Código de vínculo'}
                </label>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <code className="flex-1 bg-canvas border border-line rounded-xl px-4 py-3 text-sm sm:text-base font-mono text-fg break-all select-all">
                        {appToken || (isEn ? 'Generating...' : 'Gerando...')}
                    </code>

                    <Button
                        type="button"
                        variant={copied ? 'subtle' : 'brand'}
                        size="md"
                        onClick={handleCopy}
                        disabled={!appToken}
                        icon={copied ? <Check size={15} /> : <Copy size={15} />}
                        className="shrink-0 py-3"
                    >
                        {copied ? (isEn ? 'Copied' : 'Copiado') : (isEn ? 'Copy' : 'Copiar')}
                    </Button>
                </div>
            </div>

            <Button
                type="button"
                variant="outline"
                size="lg"
                fullWidth
                onClick={() => window.open('/download/CossaConnector.ex5')}
                icon={<Download size={17} />}
            >
                {isEn ? 'Download Connector (.ex5)' : 'Baixar arquivo (.ex5)'}
            </Button>

            {/* Concise Numbered Guide */}
            <ol className="bg-canvas-subtle border border-line rounded-xl p-4 sm:p-5 text-xs sm:text-sm text-fg-muted space-y-2 list-decimal list-inside leading-relaxed">
                {isEn ? (
                    <>
                        <li>
                            Open MetaTrader 5 and select{' '}
                            <strong className="text-fg font-semibold">File → Open Data Folder</strong>.
                        </li>
                        <li>
                            Navigate to <strong className="text-fg font-semibold">MQL5 → Experts</strong> and paste the downloaded <code className="text-fg">.ex5</code> file.
                        </li>
                        <li>
                            Refresh your Navigator panel, attach the EA to any chart, and allow WebRequest / external connections.
                        </li>
                        <li>Paste the linking token above into the EA inputs and click OK.</li>
                    </>
                ) : (
                    <>
                        <li>
                            Abra o MetaTrader 5 e clique em{' '}
                            <strong className="text-fg font-semibold">Arquivo → Abrir Pasta de Dados</strong>.
                        </li>
                        <li>
                            Entre em <strong className="text-fg font-semibold">MQL5 → Experts</strong> e cole o
                            arquivo baixado.
                        </li>
                        <li>
                            Atualize o painel Navegador, arraste para qualquer gráfico e permita conexões
                            externas.
                        </li>
                        <li>Cole o código acima nas opções e confirme.</li>
                    </>
                )}
            </ol>
        </div>
    );
};
