import React, { useEffect, useState } from 'react';
import {
    BellRing,
    BookOpenCheck,
    CheckCircle2,
    Download,
    FileSpreadsheet,
    LineChart,
    Share,
    Smartphone,
    WifiOff,
    X,
} from 'lucide-react';
import {
    PWA_STATE_EVENT,
    canTriggerNativeInstall,
    getLocalPushStatus,
    isAppMarkedInstalled,
    isIosDevice,
    isStandaloneMode,
    subscribeUserToPush,
    triggerNativeInstall,
} from '../../lib/pwaManager';

const DASHBOARD_CARD_DISMISSED_KEY = 'torex_dash_pwa_card_dismissed_v1';

interface DashboardAppInstallCardProps {
    locale?: 'pt' | 'en';
}

export const DashboardAppInstallCard: React.FC<DashboardAppInstallCardProps> = ({
    locale = 'pt',
}) => {
    const isEn = locale === 'en';
    const [installed, setInstalled] = useState(() => isAppMarkedInstalled() || isStandaloneMode());
    const [canNativeInstall, setCanNativeInstall] = useState(() => canTriggerNativeInstall());
    const [pushSubscribed, setPushSubscribed] = useState(false);
    const [pushSupported, setPushSupported] = useState(true);
    const [showInstallHint, setShowInstallHint] = useState(false);
    const [busyInstall, setBusyInstall] = useState(false);
    const [busyPush, setBusyPush] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [dismissed, setDismissed] = useState(() => {
        try {
            const raw = window.localStorage.getItem(DASHBOARD_CARD_DISMISSED_KEY);
            return Boolean(raw && Date.now() - Number(raw) < 7 * 86_400_000);
        } catch {
            return false;
        }
    });

    const syncPwaState = React.useCallback(async () => {
        setInstalled(isAppMarkedInstalled() || isStandaloneMode());
        setCanNativeInstall(canTriggerNativeInstall());
        const status = await getLocalPushStatus();
        setPushSupported(status.supported);
        setPushSubscribed(status.subscribed);
    }, []);

    useEffect(() => {
        void syncPwaState();
        const handler = () => {
            void syncPwaState();
        };
        window.addEventListener(PWA_STATE_EVENT, handler);
        return () => window.removeEventListener(PWA_STATE_EVENT, handler);
    }, [syncPwaState]);

    if (dismissed) return null;
    if (installed && pushSubscribed) return null;

    const handleDismiss = () => {
        setDismissed(true);
        try {
            window.localStorage.setItem(DASHBOARD_CARD_DISMISSED_KEY, String(Date.now()));
        } catch {
            // ignore
        }
    };

    const handleInstall = async () => {
        setBusyInstall(true);
        const outcome = await triggerNativeInstall();
        setBusyInstall(false);
        if (outcome === 'accepted') {
            setInstalled(true);
            setFeedback(
                isEn
                    ? 'App installed! Turn on push notifications to receive smart trade alerts.'
                    : 'App instalado! Ative as notificações para receber lembretes das suas operações.',
            );
        } else if (outcome === 'unavailable') {
            setShowInstallHint((prev) => !prev);
        }
    };

    const handleEnablePush = async () => {
        setBusyPush(true);
        setFeedback(null);
        const res = await subscribeUserToPush({
            locale: isEn ? 'en' : 'pt',
            sendWelcome: true,
        });
        setBusyPush(false);
        if (res.ok) {
            setPushSubscribed(true);
            setFeedback(
                isEn
                    ? 'Push alerts activated! We will remind you after new trades arrive.'
                    : 'Notificações ativadas! Vamos avisar sempre que importar novas trades.',
            );
        } else if (res.reason === 'denied') {
            setFeedback(
                isEn
                    ? 'Notifications blocked in browser settings. Allow notifications for Torex to receive alerts.'
                    : 'Permissão bloqueada no navegador. Autorize notificações nas definições para ativar alertas.',
            );
        } else {
            setFeedback(
                isEn
                    ? 'Could not subscribe on this browser session.'
                    : 'Não foi possível ativar notificações neste navegador agora.',
            );
        }
    };

    if (installed && !pushSubscribed && pushSupported) {
        return (
            <div className="relative overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-r from-surface via-surface to-accent/10 p-4 sm:p-5 shadow-sm">
                <button
                    type="button"
                    onClick={handleDismiss}
                    aria-label={isEn ? 'Dismiss card' : 'Dispensar card'}
                    className="absolute right-3 top-3 rounded-lg p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer"
                >
                    <X size={15} />
                </button>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pr-6">
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 border border-accent/30 text-accent-fg">
                            <BellRing size={20} />
                        </div>
                        <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                                    <CheckCircle2 size={11} />
                                    {isEn ? 'App Installed' : 'App Instalado'}
                                </span>
                                <span className="text-[11px] font-semibold text-fg-subtle">
                                    {isEn ? 'Smart Push Sync' : 'Alertas Inteligentes'}
                                </span>
                            </div>
                            <h3 className="text-sm font-bold text-fg">
                                {isEn
                                    ? 'Receive smart alerts on your trades, 2-min journal prompts & insights'
                                    : 'Ative as notificações inteligentes do App Torex Journal'}
                            </h3>
                            <p className="text-xs text-fg-muted">
                                {isEn
                                    ? 'Get prompted right after importing trades to complete your journal in 2 minutes plus data-backed performance insights.'
                                    : 'Irá receber alertas ao importar novas operações para preencher o diário em 2 min, curiosidades precisas dos seus dados e novidades da comunidade.'}
                            </p>
                            {feedback && <p className="text-xs font-semibold text-accent-fg">{feedback}</p>}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleEnablePush}
                        disabled={busyPush}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-60 cursor-pointer"
                    >
                        <BellRing size={14} />
                        {busyPush
                            ? isEn
                                ? 'Activating...'
                                : 'Ativando...'
                            : isEn
                              ? 'Enable Notifications'
                              : 'Ativar Notificações'}
                    </button>
                </div>
            </div>
        );
    }

    const highlights = isEn
        ? [
              {
                  icon: BookOpenCheck,
                  title: 'Offline Trading Journal',
                  desc: 'Record emotional & technical notes anytime without Wi-Fi; syncs automatically online.',
              },
              {
                  icon: LineChart,
                  title: 'Local Trade Analytics',
                  desc: 'Inspect cached executions, equity curve & edge scores straight from the app.',
              },
              {
                  icon: FileSpreadsheet,
                  title: 'Advanced Detailed Reports',
                  desc: 'Download complete PDF/CSV institutional reports and track +20 brokers clearly.',
              },
          ]
        : [
              {
                  icon: BookOpenCheck,
                  title: 'Diário Offline em 2 Min',
                  desc: 'Registe emoções, setups e lições mesmo sem internet — sincroniza ao reconectar.',
              },
              {
                  icon: LineChart,
                  title: 'Análise das Operações',
                  desc: 'Acompanhe histórico, P&L e métricas quantitativas com abertura instantânea no app.',
              },
              {
                  icon: FileSpreadsheet,
                  title: 'Relatórios Avançados Detalhados',
                  desc: 'Baixe relatórios completos com detalhes operacionais e receba alertas no telemóvel.',
              },
          ];

    return (
        <section
            aria-label={isEn ? 'Install Torex Offline App' : 'Instalar App Offline Torex'}
            className="relative overflow-hidden rounded-2xl border border-line-strong bg-gradient-to-br from-surface via-canvas-subtle to-accent/10 p-4 sm:p-5 shadow-sm"
        >
            <button
                type="button"
                onClick={handleDismiss}
                aria-label={isEn ? 'Hide install card' : 'Ocultar card de instalação'}
                className="absolute right-3 top-3 rounded-lg p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer"
            >
                <X size={15} />
            </button>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between pr-4">
                <div className="space-y-3 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/15 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-accent-fg">
                            <WifiOff size={11} />
                            {isEn ? 'Use Torex Journal Offline' : 'Use o Torex Journal de Forma Offline'}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-subtle">
                            <Smartphone size={12} />
                            {isEn ? 'Mobile & Desktop App' : 'Android · iOS · Desktop'}
                        </span>
                    </div>

                    <div>
                        <h3 className="text-sm sm:text-base font-bold tracking-tight text-fg">
                            {isEn
                                ? 'Install the Torex App: Journal offline, analyze trades & download full reports anywhere'
                                : 'Leve a sua mesa operacional no bolso: registe o diário offline e receba alertas das suas trades'}
                        </h3>
                        <p className="mt-1 text-xs text-fg-muted max-w-2xl">
                            {isEn
                                ? 'Install in seconds with zero app-store friction. Once installed, turn on notifications to never miss a post-trade debrief or data insight.'
                                : 'Instale em segundos no seu telemóvel ou computador. Depois de instalar, ative as notificações para nunca deixar o diário nem insights passarem.'}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-0.5">
                        {highlights.map((item) => {
                            const Icon = item.icon;
                            return (
                                <div
                                    key={item.title}
                                    className="flex items-start gap-2.5 rounded-xl border border-line bg-surface/80 p-2.5"
                                >
                                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-fg">
                                        <Icon size={14} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-fg leading-snug">{item.title}</p>
                                        <p className="text-[11px] text-fg-subtle leading-snug mt-0.5">{item.desc}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {showInstallHint && (
                        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-fg">
                            <Share size={14} className="shrink-0 text-amber-400" />
                            <span>
                                {isIosDevice()
                                    ? isEn
                                        ? 'On iPhone/iPad: tap Share in Safari bar and choose "Add to Home Screen".'
                                        : 'No iPhone/iPad: toque no ícone Partilhar do Safari e selecione "Adicionar ao Ecrã Principal".'
                                    : isEn
                                      ? 'In your browser menu (⋮ or Address Bar), choose "Install Torex Journal".'
                                      : 'No menu do navegador (⋮ ou barra de endereço), clique em "Instalar aplicação / Torex Journal".'}
                            </span>
                        </div>
                    )}

                    {feedback && <p className="text-xs font-semibold text-accent-fg">{feedback}</p>}
                </div>

                <div className="flex flex-col sm:flex-row lg:flex-col gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={handleInstall}
                        disabled={busyInstall}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-extrabold text-accent-on shadow-sm transition-all hover:bg-accent-hover active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                    >
                        <Download size={15} />
                        {busyInstall
                            ? isEn
                                ? 'Preparing...'
                                : 'A preparar...'
                            : canNativeInstall
                              ? isEn
                                  ? 'Install App Now'
                                  : 'Instalar App Agora'
                              : isEn
                                ? 'How to Install App'
                                : 'Instalar no Dispositivo'}
                    </button>
                    {!pushSubscribed && pushSupported && (
                        <button
                            type="button"
                            onClick={handleEnablePush}
                            disabled={busyPush}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-semibold text-fg hover:bg-surface-2 cursor-pointer"
                        >
                            <BellRing size={13} className="text-accent-fg" />
                            {busyPush
                                ? isEn
                                    ? 'Enabling...'
                                    : 'Ativando...'
                                : isEn
                                  ? 'Enable Push Alerts'
                                  : 'Ativar Notificações'}
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
};
