import React, { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Download, Share, Smartphone, X } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import {
    PWA_STATE_EVENT,
    canTriggerNativeInstall,
    clearAppJustInstalledFlag,
    getLocalPushStatus,
    isIosDevice,
    isStandaloneMode,
    markPwaPromptDismissed,
    shouldProposeWebsiteInstall,
    subscribeUserToPush,
    triggerNativeInstall,
    wasAppJustInstalled,
} from '../../lib/pwaManager';

export const WebsitePwaPrompt: React.FC = () => {
    const { locale } = useLocale();
    const { token } = useAuth();
    const isEn = locale === 'en';

    const [eligible, setEligible] = useState(false);
    const [justInstalled, setJustInstalled] = useState(false);
    const [pushSubscribed, setPushSubscribed] = useState(false);
    const [canNativePrompt, setCanNativePrompt] = useState(false);
    const [showIosGuide, setShowIosGuide] = useState(false);
    const [busyPush, setBusyPush] = useState(false);
    const [pushFeedback, setPushFeedback] = useState<string | null>(null);

    const evaluateState = React.useCallback(async () => {
        if (isStandaloneMode()) {
            setEligible(false);
            return;
        }
        setCanNativePrompt(canTriggerNativeInstall());
        setJustInstalled(wasAppJustInstalled());
        setEligible(shouldProposeWebsiteInstall());
        const pushStatus = await getLocalPushStatus();
        setPushSubscribed(pushStatus.subscribed);
    }, []);

    useEffect(() => {
        void evaluateState();
        const timer = window.setInterval(() => {
            void evaluateState();
        }, 8000);

        const onSignal = () => {
            void evaluateState();
        };

        window.addEventListener('torex:behavior-updated', onSignal);
        window.addEventListener(PWA_STATE_EVENT, onSignal);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('torex:behavior-updated', onSignal);
            window.removeEventListener(PWA_STATE_EVENT, onSignal);
        };
    }, [evaluateState]);

    if (typeof window !== 'undefined' && window.location.pathname.toLowerCase().startsWith('/admin')) {
        return null;
    }

    if (justInstalled) {
        return (
            <div className="fixed bottom-20 md:bottom-4 right-4 z-[60] w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-emerald-500/40 bg-surface/95 p-4 shadow-2xl backdrop-blur-xl animate-fade-in-up">
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                        <CheckCircle2 size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-fg">
                            {isEn ? 'Torex Journal App Installed!' : 'App Torex Journal Instalado!'}
                        </h4>
                        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                            {isEn
                                ? 'You will receive smart notifications in the app whenever new trades arrive — including 2-min journal prompts & insights.'
                                : 'Poderá receber notificações no app sobre as suas operações, lembretes de 2 min para o diário e insights de performance.'}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            {token && !pushSubscribed && (
                                <button
                                    type="button"
                                    disabled={busyPush}
                                    onClick={async () => {
                                        setBusyPush(true);
                                        const res = await subscribeUserToPush({
                                            locale: isEn ? 'en' : 'pt',
                                            sendWelcome: true,
                                        });
                                        setBusyPush(false);
                                        if (res.ok) {
                                            setPushSubscribed(true);
                                            setPushFeedback(isEn ? 'Notifications active!' : 'Notificações ativadas!');
                                            window.setTimeout(() => clearAppJustInstalledFlag(), 2500);
                                        }
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold text-accent-on hover:bg-accent-hover cursor-pointer"
                                >
                                    <BellRing size={13} />
                                    {busyPush
                                        ? isEn
                                            ? 'Enabling...'
                                            : 'Ativando...'
                                        : isEn
                                          ? 'Enable App Alerts'
                                          : 'Ativar Notificações'}
                                </button>
                            )}
                            {pushFeedback && <span className="text-[11px] font-semibold text-emerald-400">{pushFeedback}</span>}
                            <button
                                type="button"
                                onClick={clearAppJustInstalledFlag}
                                className="ml-auto text-[11px] font-medium text-fg-subtle hover:text-fg cursor-pointer"
                            >
                                {isEn ? 'Close' : 'Fechar'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!eligible || (!canNativePrompt && !isIosDevice())) {
        return null;
    }

    const handleInstallClick = async () => {
        if (canNativePrompt) {
            await triggerNativeInstall();
            return;
        }
        setShowIosGuide((s) => !s);
    };

    return (
        <div className="fixed bottom-20 md:bottom-4 right-4 z-[55] w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-line-strong bg-surface/95 p-4 shadow-2xl backdrop-blur-xl animate-fade-in-up">
            <button
                type="button"
                onClick={() => {
                    markPwaPromptDismissed();
                    setEligible(false);
                }}
                aria-label={isEn ? 'Dismiss install prompt' : 'Dispensar instalação'}
                className="absolute right-3 top-3 rounded-lg p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer"
            >
                <X size={14} />
            </button>

            <div className="flex items-start gap-3 pr-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/15 text-accent-fg">
                    <Smartphone size={19} />
                </div>
                <div className="min-w-0 flex-1">
                    <span className="inline-block rounded-full bg-accent/15 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-accent-fg">
                        {isEn ? 'Offline Terminal App' : 'App Torex Offline'}
                    </span>
                    <h4 className="mt-1 text-xs font-bold text-fg">
                        {isEn ? 'Install Torex Journal on this device' : 'Instale o App Torex no seu dispositivo'}
                    </h4>
                    <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                        {isEn
                            ? 'Log your journal offline, get smart trade import alerts in the app, and review full analytics anywhere.'
                            : 'Use o diário offline, receba alertas inteligentes sobre suas operações no app e baixe relatórios avançados.'}
                    </p>

                    {showIosGuide && isIosDevice() && (
                        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-line bg-canvas-subtle px-2.5 py-2 text-[11px] text-fg-muted">
                            <Share size={13} className="shrink-0 text-accent-fg" />
                            <span>
                                {isEn
                                    ? 'Tap Share in Safari, then choose "Add to Home Screen".'
                                    : 'Toque em Partilhar no Safari e escolha "Adicionar ao Ecrã Principal".'}
                            </span>
                        </div>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleInstallClick}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold text-accent-on transition-colors hover:bg-accent-hover cursor-pointer"
                        >
                            <Download size={13} />
                            {isEn ? 'Install App' : 'Instalar App'}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                markPwaPromptDismissed();
                                setEligible(false);
                            }}
                            className="px-2 py-1 text-[11px] font-medium text-fg-subtle hover:text-fg cursor-pointer"
                        >
                            {isEn ? 'Later' : 'Agora não'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
