import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle,
    Calendar,
    CheckCircle2,
    Loader2,
    ShieldCheck,
} from 'lucide-react';
import api from '../api';
import { useLocale } from '../context/LocaleContext';
import {
    ActiveCryptoPayment,
    ActivePixPayment,
    CardBrandsIcon,
    CardPaymentView,
    CheckoutLocationOption,
    CheckoutLocationSwitcher,
    CheckoutMethodId,
    CryptoCurrencyOption,
    CryptoMethodIcon,
    CryptoPaymentView,
    DEFAULT_CRYPTO_CURRENCIES,
    EmolaIcon,
    getPaymentMethodGridClass,
    MobileMoneyForm,
    MpesaIcon,
    PayFastIcon,
    PayFastPaymentView,
    PaymentFailedModal,
    PaymentMethodBadge,
    PixIcon,
    PixPaymentView,
    resolveLocationOption,
} from '../components/subscription/CheckoutFlow';
import { useAdaptivePaymentPolling } from '../hooks/useAdaptivePaymentPolling';
import {
    detectCallbackFailureFromSearch,
    resolvePaymentFailureCopy,
} from '../lib/paymentPolling';

interface RenewalInvoiceData {
    token: string;
    tier: string;
    cycle: string;
    amountUsd: number;
    currency: string;
    status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
    dueDate: string;
    expiresAt: string;
    paidAt?: string | null;
    geo?: {
        countryCode?: string;
        availableMethods?: CheckoutMethodId[];
        defaultMethod?: CheckoutMethodId;
    };
}

export const RenewalPayment = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { locale, localizeBrowserPath } = useLocale();
    const isEn = locale === 'en';

    const [invoice, setInvoice] = useState<RenewalInvoiceData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [countryCode, setCountryCode] = useState<CheckoutLocationOption['code']>('INTL');
    const [availableMethods, setAvailableMethods] = useState<CheckoutMethodId[]>(['card', 'crypto']);
    const [paymentMethod, setPaymentMethod] = useState<CheckoutMethodId>('card');

    const [phoneNumber, setPhoneNumber] = useState('');
    const [cardPhoneNumber, setCardPhoneNumber] = useState('');
    const [pixDocument, setPixDocument] = useState('');
    const [selectedCrypto, setSelectedCrypto] = useState('USDT.TRC20');
    const [cryptoCurrencies, setCryptoCurrencies] =
        useState<CryptoCurrencyOption[]>(DEFAULT_CRYPTO_CURRENCIES);
    const [activeCrypto, setActiveCrypto] = useState<ActiveCryptoPayment | null>(null);
    const [activePix, setActivePix] = useState<ActivePixPayment | null>(null);
    const [pendingRef, setPendingRef] = useState<string | null>(
        () => searchParams.get('subscription_id') || searchParams.get('reference') || null,
    );
    const [pendingMethod, setPendingMethod] = useState<CheckoutMethodId | null>(
        () => (searchParams.get('method') as CheckoutMethodId) || null,
    );
    const [mobileMessage, setMobileMessage] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);
    const [checkingStatus, setCheckingStatus] = useState(false);
    const [payError, setPayError] = useState<string | null>(null);
    const [failedModal, setFailedModal] = useState<{
        open: boolean;
        title: string;
        message: string;
        method?: string;
        reference?: string;
    }>({ open: false, title: '', message: '' });

    const openFailureModal = useCallback(
        (opts: { reason?: string | null; method?: string | null; reference?: string | null }) => {
            const copy = resolvePaymentFailureCopy(opts.reason, isEn);
            setFailedModal({
                open: true,
                title: copy.title,
                message: copy.message,
                method: opts.method || undefined,
                reference: opts.reference || undefined,
            });
        },
        [isEn],
    );

    useEffect(() => {
        if (!token) {
            setError(isEn ? 'Invalid renewal link.' : 'Link de renovação inválido.');
            setLoading(false);
            return;
        }

        let mounted = true;
        Promise.allSettled([
            api.get(`/payment/renewal/${encodeURIComponent(token)}`),
            api.get('/payment/crypto-currencies'),
        ])
            .then(([invRes, coinsRes]) => {
                if (!mounted) return;
                if (invRes.status === 'fulfilled' && invRes.value.data) {
                    const data = invRes.value.data as RenewalInvoiceData;
                    setInvoice(data);
                    const savedCountry = (() => {
                        try {
                            return sessionStorage.getItem('torex_checkout_country_manual');
                        } catch {
                            return null;
                        }
                    })();
                    const loc = resolveLocationOption(savedCountry || data.geo?.countryCode, isEn);
                    const methods =
                        !savedCountry && Array.isArray(data.geo?.availableMethods)
                            ? data.geo!.availableMethods!
                            : loc.methods;
                    setCountryCode(loc.code);
                    setAvailableMethods(methods);
                    setPaymentMethod(
                        !savedCountry && data.geo?.defaultMethod
                            ? data.geo.defaultMethod
                            : loc.defaultMethod,
                    );
                } else {
                    setError(
                        isEn
                            ? 'Renewal link not found or expired.'
                            : 'Link de renovação não encontrado ou expirado.',
                    );
                }

                if (
                    coinsRes.status === 'fulfilled' &&
                    Array.isArray(coinsRes.value.data?.currencies) &&
                    coinsRes.value.data.currencies.length > 0
                ) {
                    setCryptoCurrencies(coinsRes.value.data.currencies);
                }
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [token, isEn]);

    // Handle external callback query params (?payment_status=failed or ?subscription_id=...)
    useEffect(() => {
        if (!token || loading || !invoice || invoice.status !== 'PENDING') return;
        const callbackFailure = detectCallbackFailureFromSearch(searchParams);
        const urlRef = searchParams.get('subscription_id') || searchParams.get('reference') || '';
        const urlMethod = searchParams.get('method') || '';

        if (callbackFailure.isFailed) {
            if (urlRef) {
                api.get(`/payment/renewal/${encodeURIComponent(token)}/status`, {
                    params: { reference: urlRef, force: '1' },
                })
                    .then((res) => {
                        const data = res.data || {};
                        if (data.invoiceStatus === 'PAID' || data.status === 'ACTIVE' || data.status === 'APPROVED') {
                            setInvoice((prev) => (prev ? { ...prev, status: 'PAID' } : prev));
                            setSearchParams({}, { replace: true });
                            return;
                        }
                        openFailureModal({
                            reason: data.failureReason || callbackFailure.reason || callbackFailure.statusCode,
                            method: data.paymentMethod || urlMethod || undefined,
                            reference: urlRef,
                        });
                    })
                    .catch(() => {
                        openFailureModal({
                            reason: callbackFailure.reason || callbackFailure.statusCode,
                            method: urlMethod || undefined,
                            reference: urlRef,
                        });
                    });
            } else {
                openFailureModal({
                    reason: callbackFailure.reason || callbackFailure.statusCode,
                    method: urlMethod || undefined,
                });
            }
        } else if (urlRef && !pendingRef) {
            setPendingRef(urlRef);
            if (urlMethod) setPendingMethod(urlMethod as CheckoutMethodId);
        }
    }, [token, loading, invoice, searchParams, openFailureModal, pendingRef, setSearchParams]);

    const checkRenewalStatusOnce = useCallback(
        async (refOverride?: string | null, force = false) => {
            const targetRef = refOverride || pendingRef || activeCrypto?.reference || activePix?.reference;
            if (!token || !targetRef) {
                return { settled: true, nextPollAfterMs: 0 };
            }
            if (force) setCheckingStatus(true);
            try {
                const res = await api.get(`/payment/renewal/${encodeURIComponent(token)}/status`, {
                    params: { reference: targetRef, ...(force ? { force: '1' } : {}) },
                });
                const data = res.data || {};
                const st = String(data.status || '').toUpperCase();
                if (data.invoiceStatus === 'PAID' || st === 'ACTIVE' || st === 'APPROVED') {
                    setPendingRef(null);
                    setPendingMethod(null);
                    setActiveCrypto(null);
                    setActivePix(null);
                    setMobileMessage(null);
                    setInvoice((prev) =>
                        prev ? { ...prev, status: 'PAID', paidAt: data.paidAt || new Date().toISOString() } : prev,
                    );
                    setSearchParams({}, { replace: true });
                    return { settled: true, nextPollAfterMs: 0 };
                }

                if (st === 'CANCELLED' || st === 'EXPIRED') {
                    setPendingRef(null);
                    setPendingMethod(null);
                    setActiveCrypto(null);
                    setActivePix(null);
                    setMobileMessage(null);
                    openFailureModal({
                        reason: data.failureReason || (st === 'EXPIRED' ? 'expired' : 'failed'),
                        method: data.paymentMethod || pendingMethod || paymentMethod,
                        reference: targetRef,
                    });
                    return { settled: true, nextPollAfterMs: 0 };
                }

                return {
                    settled: false,
                    nextPollAfterMs:
                        typeof data.nextPollAfterMs === 'number' ? data.nextPollAfterMs : null,
                };
            } catch (err: any) {
                if (force) {
                    const msg =
                        err?.response?.data?.message ||
                        (isEn
                            ? 'Could not check payment status right now.'
                            : 'Não foi possível verificar o status agora.');
                    setPayError(Array.isArray(msg) ? msg.join(' ') : String(msg));
                    return { settled: false, nextPollAfterMs: null };
                }
                throw err;
            } finally {
                if (force) setCheckingStatus(false);
            }
        },
        [
            token,
            pendingRef,
            activeCrypto?.reference,
            activePix?.reference,
            pendingMethod,
            paymentMethod,
            openFailureModal,
            setSearchParams,
        ],
    );

    const activePollRef = pendingRef || activeCrypto?.reference || activePix?.reference || null;
    const activePollMethod: CheckoutMethodId =
        pendingMethod || (activeCrypto ? 'crypto' : activePix ? 'pix' : paymentMethod);

    useAdaptivePaymentPolling({
        enabled: Boolean(invoice?.status === 'PENDING' && activePollRef && !failedModal.open),
        method: activePollMethod,
        maxDurationMs:
            activePollMethod === 'crypto'
                ? 65 * 60 * 1000
                : activePollMethod === 'pix'
                  ? 35 * 60 * 1000
                  : activePollMethod === 'mpesa' || activePollMethod === 'emola'
                    ? 3 * 60 * 1000
                    : 5 * 60 * 1000,
        onPoll: () => checkRenewalStatusOnce(activePollRef, false),
        onTimeout: () => {
            setPendingRef(null);
            setMobileMessage(null);
            openFailureModal({
                reason: 'timeout',
                method: activePollMethod,
                reference: activePollRef,
            });
        },
    });

    const handleSelectLocation = (loc: CheckoutLocationOption) => {
        try {
            sessionStorage.setItem('torex_checkout_country_manual', loc.code);
        } catch {
            // ignore
        }
        setCountryCode(loc.code);
        setAvailableMethods(loc.methods);
        setPayError(null);
        setPaymentMethod((prev) => (loc.methods.includes(prev) ? prev : loc.defaultMethod));
    };

    const handlePhoneCountrySync = (iso2: string) => {
        handleSelectLocation(resolveLocationOption(iso2, isEn));
    };

    const submitRenewal = async (method: CheckoutMethodId) => {
        if (!token || !invoice) return;
        setProcessing(true);
        setPayError(null);
        setMobileMessage(null);
        setFailedModal({ open: false, title: '', message: '' });
        try {
            const payload: Record<string, any> = {
                paymentMethod: method,
                returnUrl: `${window.location.origin}${localizeBrowserPath(`/subscription/payment/${encodeURIComponent(token)}`)}`,
            };
            if (method === 'mpesa' || method === 'emola') payload.phoneNumber = phoneNumber;
            if (method === 'card' && (cardPhoneNumber || phoneNumber)) {
                payload.phoneNumber = cardPhoneNumber || phoneNumber;
            }
            if (method === 'payfast' && phoneNumber) {
                payload.phoneNumber = `+27${phoneNumber.replace(/^0+/, '')}`;
            }
            if (method === 'pix') payload.payerDocument = pixDocument;
            if (method === 'crypto') payload.cryptocurrency = selectedCrypto;

            const res = await api.post(`/payment/renewal/${encodeURIComponent(token)}/pay`, payload);

            if (res.data?.status === 'ACTIVE' || res.data?.subscriptionStatus === 'ACTIVE') {
                setInvoice((prev) =>
                    prev ? { ...prev, status: 'PAID', paidAt: new Date().toISOString() } : prev,
                );
                return;
            }
            if (res.data?.checkoutUrl) {
                window.location.href = res.data.checkoutUrl;
                return;
            }
            if (method === 'crypto' && res.data?.session) {
                setActiveCrypto(res.data.session);
                setPendingRef(res.data.session.reference || null);
                setPendingMethod('crypto');
                return;
            }
            if (method === 'pix' && res.data?.session) {
                setActivePix(res.data.session);
                setPendingRef(res.data.session.reference || null);
                setPendingMethod('pix');
                return;
            }
            if (method === 'mpesa' || method === 'emola') {
                setPendingRef(res.data?.reference || null);
                setPendingMethod(method);
                setMobileMessage(
                    isEn
                        ? 'Payment request sent to your phone. Enter your PIN to confirm.'
                        : 'Pedido enviado para o seu telemóvel. Introduza o PIN para confirmar.',
                );
            }
        } catch (err: any) {
            const msg =
                err?.response?.data?.message ||
                (isEn ? 'Could not process renewal payment.' : 'Não foi possível iniciar a renovação.');
            const text = Array.isArray(msg) ? msg.join(' ') : String(msg);
            setPayError(text);
        } finally {
            setProcessing(false);
        }
    };

    if (loading) {
        return (
            <div className="theme-light min-h-screen bg-white flex items-center justify-center p-6">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            </div>
        );
    }

    if (error || !invoice) {
        return (
            <div className="theme-light min-h-screen bg-white flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-4 shadow-xl">
                    <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
                    <h1 className="text-lg font-black text-slate-900">
                        {isEn ? 'Renewal Unavailable' : 'Renovação Indisponível'}
                    </h1>
                    <p className="text-xs text-slate-600">{error}</p>
                    <button
                        type="button"
                        onClick={() => navigate('/dashboard')}
                        className="w-full h-11 rounded-xl bg-indigo-600 text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
                    >
                        {isEn ? 'Go to Dashboard' : 'Ir para o Painel'}
                    </button>
                </div>
            </div>
        );
    }

    if (invoice.status !== 'PENDING') {
        return (
            <div className="theme-light min-h-screen bg-white flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-4 shadow-xl">
                    {invoice.status === 'PAID' ? (
                        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                    ) : (
                        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
                    )}
                    <h1 className="text-lg font-black text-slate-900">
                        {invoice.status === 'PAID'
                            ? isEn
                                ? 'Renewal Confirmed!'
                                : 'Renovação Confirmada!'
                            : isEn
                              ? 'Renewal Link Expired'
                              : 'Link Expirado'}
                    </h1>
                    <p className="text-xs text-slate-600">
                        {invoice.status === 'PAID'
                            ? isEn
                                ? 'This subscription renewal has been confirmed and your access is active.'
                                : 'Esta renovação de assinatura foi confirmada e o seu acesso encontra-se ativo.'
                            : isEn
                              ? 'This renewal link is no longer valid.'
                              : 'Este link de renovação não está mais disponível.'}
                    </p>
                    <button
                        type="button"
                        onClick={() => navigate('/dashboard')}
                        className="w-full h-11 rounded-xl bg-indigo-600 text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
                    >
                        {isEn ? 'Open Workspace' : 'Acessar Painel'}
                    </button>
                </div>
            </div>
        );
    }

    const methodGridClass = getPaymentMethodGridClass(availableMethods.length);
    const dismissFailureModal = () => {
        setFailedModal({ open: false, title: '', message: '' });
        if (searchParams.toString()) {
            setSearchParams({}, { replace: true });
        }
    };

    return (
        <div className="theme-light min-h-screen bg-white text-slate-900 pt-4 pb-8 sm:pt-6 sm:pb-10 px-4">
            <div className="max-w-2xl mx-auto space-y-5">
                <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black tracking-wider uppercase text-slate-900">
                        TOREX <span className="text-emerald-600">JOURNAL</span>
                    </div>
                    <CheckoutLocationSwitcher
                        currentCode={countryCode}
                        onSelectLocation={handleSelectLocation}
                        isEn={isEn}
                    />
                </div>

                <div className="bg-white border border-slate-200 rounded-[28px] p-5 sm:p-8 shadow-xl space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                        <div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 block">
                                {isEn ? 'Subscription Renewal' : 'Renovação de Assinatura'}
                            </span>
                            <h1 className="text-2xl font-black text-slate-900 mt-0.5">
                                {isEn ? `${invoice.tier} Plan` : `Plano ${invoice.tier}`}
                            </h1>
                            <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-1">
                                <Calendar size={12} />
                                <span>
                                    {new Date(invoice.dueDate).toLocaleDateString(
                                        isEn ? 'en-US' : 'pt-PT',
                                    )}
                                </span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-[10px] font-bold uppercase text-slate-500 block">
                                {isEn ? 'Amount' : 'Valor'}
                            </span>
                            <span className="text-2xl font-mono font-black text-slate-900">
                                ${Number(invoice.amountUsd).toFixed(2)} USD
                            </span>
                        </div>
                    </div>

                    {mobileMessage && (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800 font-semibold flex items-center justify-between gap-3">
                            <span>{mobileMessage}</span>
                            {pendingRef && (
                                <Loader2 className="w-4 h-4 text-emerald-700 animate-spin shrink-0" />
                            )}
                        </div>
                    )}

                    <div className={`grid ${methodGridClass}`}>
                        {availableMethods.map((m) => (
                            <PaymentMethodBadge
                                key={m}
                                id={m}
                                label={
                                    m === 'mpesa'
                                        ? 'M-Pesa'
                                        : m === 'emola'
                                          ? 'e-Mola'
                                          : m === 'pix'
                                            ? 'PIX'
                                            : m === 'payfast'
                                              ? 'PayFast'
                                              : m === 'crypto'
                                                ? isEn
                                                    ? 'Cryptocurrency'
                                                    : 'Criptomoeda'
                                                : 'Visa / Mastercard'
                                }
                                mobileLabel={
                                    m === 'card'
                                        ? isEn
                                            ? 'Card'
                                            : 'Cartão'
                                        : m === 'crypto'
                                          ? isEn
                                              ? 'Crypto'
                                              : 'Cripto'
                                          : undefined
                                }
                                icon={
                                    m === 'mpesa'
                                        ? MpesaIcon
                                        : m === 'emola'
                                          ? EmolaIcon
                                          : m === 'pix'
                                            ? PixIcon
                                            : m === 'payfast'
                                              ? PayFastIcon
                                              : m === 'crypto'
                                                ? CryptoMethodIcon
                                                : CardBrandsIcon
                                }
                                active={paymentMethod === m}
                                onClick={() => {
                                    setPaymentMethod(m);
                                    setPayError(null);
                                }}
                            />
                        ))}
                    </div>

                    <div>
                        {(paymentMethod === 'mpesa' || paymentMethod === 'emola') && (
                            <MobileMoneyForm
                                method={paymentMethod}
                                phoneNumber={phoneNumber}
                                setPhoneNumber={setPhoneNumber}
                                selectedIso2={countryCode}
                                onCountryChange={handlePhoneCountrySync}
                                savePreference={false}
                                setSavePreference={() => {}}
                                onSubmit={() => void submitRenewal(paymentMethod)}
                                processing={processing}
                                payableTotalUSD={invoice.amountUsd}
                                errorMessage={payError}
                                isEn={isEn}
                            />
                        )}
                        {paymentMethod === 'card' && (
                            <CardPaymentView
                                onSubmit={() => void submitRenewal('card')}
                                processing={processing}
                                onPhoneChange={setCardPhoneNumber}
                                nationalPhone={phoneNumber}
                                onNationalPhoneChange={setPhoneNumber}
                                selectedIso2={countryCode}
                                onCountryChange={handlePhoneCountrySync}
                                payableTotalUSD={invoice.amountUsd}
                                errorMessage={payError}
                                isEn={isEn}
                            />
                        )}
                        {paymentMethod === 'payfast' && (
                            <PayFastPaymentView
                                phoneNumber={phoneNumber}
                                setPhoneNumber={setPhoneNumber}
                                selectedIso2={countryCode}
                                onCountryChange={handlePhoneCountrySync}
                                onSubmit={() => void submitRenewal('payfast')}
                                processing={processing}
                                payableTotalUSD={invoice.amountUsd}
                                errorMessage={payError}
                                isEn={isEn}
                            />
                        )}
                        {paymentMethod === 'pix' && (
                            <PixPaymentView
                                payerDocument={pixDocument}
                                setPayerDocument={setPixDocument}
                                activePixPayment={activePix}
                                payableTotalUSD={invoice.amountUsd}
                                processing={processing}
                                checkingStatus={checkingStatus}
                                cancelling={false}
                                errorMessage={payError}
                                onGeneratePix={() => void submitRenewal('pix')}
                                onCheckStatus={() =>
                                    void checkRenewalStatusOnce(activePix?.reference, true)
                                }
                                onResetPix={() => {
                                    setActivePix(null);
                                    setPendingRef(null);
                                }}
                                isEn={isEn}
                            />
                        )}
                        {paymentMethod === 'crypto' && (
                            <CryptoPaymentView
                                currencies={cryptoCurrencies}
                                selectedCrypto={selectedCrypto}
                                setSelectedCrypto={setSelectedCrypto}
                                activePayment={activeCrypto}
                                payableTotalUSD={invoice.amountUsd}
                                processing={processing}
                                checkingStatus={checkingStatus}
                                cancelling={false}
                                errorMessage={payError}
                                onGenerateWallet={() => void submitRenewal('crypto')}
                                onCheckStatus={() =>
                                    void checkRenewalStatusOnce(activeCrypto?.reference, true)
                                }
                                onChangeCoin={() => {
                                    setActiveCrypto(null);
                                    setPendingRef(null);
                                }}
                                isEn={isEn}
                            />
                        )}
                    </div>

                    <div className="pt-4 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500 uppercase font-bold">
                        <span className="inline-flex items-center gap-1.5">
                            <ShieldCheck size={14} className="text-indigo-600" />
                            {isEn ? 'Encrypted Checkout' : 'Pagamento Seguro'}
                        </span>
                        <span>USD</span>
                    </div>
                </div>
            </div>

            <PaymentFailedModal
                open={failedModal.open}
                title={failedModal.title}
                message={failedModal.message}
                methodLabel={failedModal.method}
                reference={failedModal.reference}
                isEn={isEn}
                onRetry={dismissFailureModal}
                onClose={dismissFailureModal}
            />
        </div>
    );
};
