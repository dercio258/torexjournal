import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import {
    ShieldCheck,
    ChevronLeft,
    Smartphone,
    Loader2,
    Sparkles,
    Gift,
    AlertCircle,
    CheckCircle2,
    XCircle,
} from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
    PlanSummary,
    PaymentMethodBadge,
    MobileMoneyForm,
    CardPaymentView,
    PayFastPaymentView,
    CryptoPaymentView,
    PixPaymentView,
    CheckoutLocationSwitcher,
    MpesaIcon,
    EmolaIcon,
    CardBrandsIcon,
    CryptoMethodIcon,
    PixIcon,
    PayFastIcon,
    PaymentFailedModal,
    CheckoutMethodId,
    CheckoutLocationOption,
    CryptoCurrencyOption,
    ActiveCryptoPayment,
    ActivePixPayment,
    DEFAULT_CRYPTO_CURRENCIES,
    getPaymentMethodGridClass,
    resolveLocationOption,
} from '../components/subscription/CheckoutFlow';
import { trackButtonClick } from '../lib/tracking';
import {
    calculatePlanCyclePricing,
    normalizeBillingCycle,
    normalizeSingleWorkspacePlan,
    normalizeWorkspacePlansCatalog,
    normalizeWorkspaceTierClient,
    WorkspaceBillingCycle,
} from '../lib/pricingPlans';
import { useAdaptivePaymentPolling } from '../hooks/useAdaptivePaymentPolling';
import {
    buildCheckoutFailureUrl,
    detectCallbackFailureFromSearch,
    resolvePaymentFailureCopy,
} from '../lib/paymentPolling';

const MANUAL_COUNTRY_KEY = 'torex_checkout_country_manual';

function normalizeCheckoutPlan(rawPlan: any, isEn: boolean): any {
    if (!rawPlan?.tier) return rawPlan;
    return normalizeSingleWorkspacePlan(rawPlan, isEn) || rawPlan;
}

const getCheckoutSelectionKey = (userId?: string) =>
    `torex_checkout_selection:${userId || 'anon'}`;
const getCryptoSessionKey = (userId?: string) =>
    `torex_active_crypto_checkout:${userId || 'anon'}`;
const getPixSessionKey = (userId?: string) =>
    `torex_active_pix_checkout:${userId || 'anon'}`;

interface StoredCheckoutSelection {
    plan: any;
    billingCycle: string;
    savedAt: number;
}

function readStoredSelection(userId?: string, isEn = false): StoredCheckoutSelection | null {
    try {
        const raw = localStorage.getItem(getCheckoutSelectionKey(userId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.plan || !parsed?.billingCycle) return null;
        if (parsed.savedAt && Date.now() - Number(parsed.savedAt) > 24 * 60 * 60 * 1000) {
            localStorage.removeItem(getCheckoutSelectionKey(userId));
            return null;
        }
        return {
            ...parsed,
            plan: normalizeCheckoutPlan(parsed.plan, isEn),
            billingCycle: normalizeBillingCycle(parsed.billingCycle),
        };
    } catch {
        return null;
    }
}

function saveStoredSelection(userId: string | undefined, plan: any, billingCycle: string) {
    try {
        localStorage.setItem(
            getCheckoutSelectionKey(userId),
            JSON.stringify({ plan, billingCycle, savedAt: Date.now() }),
        );
    } catch {
        // Ignore storage errors
    }
}

function readStoredCryptoSession(userId?: string): ActiveCryptoPayment | null {
    try {
        const raw = localStorage.getItem(getCryptoSessionKey(userId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ActiveCryptoPayment;
        if (!parsed?.walletAddress || !parsed?.qrCodeDataUrl || !parsed?.reference) return null;
        return parsed;
    } catch {
        return null;
    }
}

function saveStoredCryptoSession(userId: string | undefined, session: ActiveCryptoPayment | null) {
    try {
        if (!session) localStorage.removeItem(getCryptoSessionKey(userId));
        else localStorage.setItem(getCryptoSessionKey(userId), JSON.stringify(session));
    } catch {
        // Ignore storage errors
    }
}

function readStoredPixSession(userId?: string): ActivePixPayment | null {
    try {
        const raw = localStorage.getItem(getPixSessionKey(userId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ActivePixPayment;
        if (!parsed?.emvCode || !parsed?.qrCodeDataUrl || !parsed?.reference) return null;
        return parsed;
    } catch {
        return null;
    }
}

function saveStoredPixSession(userId: string | undefined, session: ActivePixPayment | null) {
    try {
        if (!session) localStorage.removeItem(getPixSessionKey(userId));
        else localStorage.setItem(getPixSessionKey(userId), JSON.stringify(session));
    } catch {
        // Ignore storage errors
    }
}

function readManualCountryOverride(): CheckoutLocationOption['code'] | null {
    try {
        const v = String(sessionStorage.getItem(MANUAL_COUNTRY_KEY) || '')
            .trim()
            .toUpperCase();
        if (v === 'INTL' || /^[A-Z]{2}$/.test(v)) return v;
    } catch {
        // Ignore
    }
    return null;
}

export const Checkout = () => {
    const { user, refreshProfile } = useAuth();
    const { locale, localizeBrowserPath } = useLocale();
    const isEn = locale === 'en';
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const urlPixRef = searchParams.get('pixRef') || '';
    const urlTier = searchParams.get('tier') || '';
    const urlCycle = searchParams.get('cycle') || '';
    const urlMethod = searchParams.get('method') || '';
    const urlCallbackRef =
        searchParams.get('subscription_id') || searchParams.get('reference') || '';
    const shouldAutoCopyWallet = searchParams.get('copyWallet') === '1';
    const callbackFailure = detectCallbackFailureFromSearch(searchParams);
    const urlCryptoRef =
        searchParams.get('cryptoRef') ||
        (callbackFailure.isFailed ? '' : searchParams.get('reference') || '');

    const statePlan = location.state?.plan || null;
    const stateCycle = location.state?.billingCycle
        ? normalizeBillingCycle(location.state.billingCycle)
        : null;
    const explicitUrlTier = normalizeWorkspaceTierClient(urlTier);
    const explicitUrlCycle = urlCycle ? normalizeBillingCycle(urlCycle) : null;

    const [plan, setPlan] = useState<any>(() => {
        if (statePlan) return normalizeCheckoutPlan(statePlan, isEn);
        const stored = readStoredSelection(user?.id, isEn);
        if (explicitUrlTier) {
            if (stored?.plan && normalizeWorkspaceTierClient(stored.plan.tier) === explicitUrlTier) {
                return stored.plan;
            }
            return normalizeSingleWorkspacePlan({ tier: explicitUrlTier }, isEn);
        }
        return stored?.plan || null;
    });
    const [billingCycle, setBillingCycle] = useState<string>(() => {
        if (stateCycle) return stateCycle;
        if (explicitUrlCycle) return explicitUrlCycle;
        return readStoredSelection(user?.id, isEn)?.billingCycle || (explicitUrlTier ? 'YEARLY' : '');
    });
    const [hydratingCheckout, setHydratingCheckout] = useState<boolean>(
        () =>
            (!statePlan && !explicitUrlTier) ||
            (!stateCycle && !explicitUrlCycle) ||
            Boolean(urlCryptoRef) ||
            Boolean(urlPixRef) ||
            Boolean(urlTier) ||
            callbackFailure.isFailed,
    );

    // GeoIP Location & Adaptive Available Methods (Universal defaults immediately: card + crypto)
    const initialManualCountry = readManualCountryOverride();
    const initialLoc = resolveLocationOption(initialManualCountry || 'INTL', isEn);

    const [countryCode, setCountryCode] = useState<CheckoutLocationOption['code']>(initialLoc.code);
    const [availableMethods, setAvailableMethods] = useState<CheckoutMethodId[]>(
        initialManualCountry ? initialLoc.methods : ['card', 'crypto'],
    );
    const initialCryptoSession = (() => {
        const stored = readStoredCryptoSession(user?.id);
        if (!stored) return null;
        if (!urlCryptoRef && statePlan?.tier && stateCycle) {
            if (stored.tier !== statePlan.tier || stored.cycle !== stateCycle) {
                return null;
            }
        }
        return stored;
    })();
    const [paymentMethod, setPaymentMethod] = useState<CheckoutMethodId>(() => {
        if (urlPixRef) return 'pix';
        if (urlCryptoRef || initialCryptoSession) return 'crypto';
        if (readStoredPixSession(user?.id)) return 'pix';
        if (
            urlMethod &&
            ['mpesa', 'emola', 'card', 'payfast', 'pix', 'crypto'].includes(urlMethod)
        ) {
            return urlMethod as CheckoutMethodId;
        }
        return initialManualCountry ? initialLoc.defaultMethod : 'card';
    });

    const [phoneNumber, setPhoneNumber] = useState('');
    const [cardPhoneNumber, setCardPhoneNumber] = useState('');
    const [savePreference, setSavePreference] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [methodError, setMethodError] = useState<string | null>(null);

    // Popup Modal state for M-Pesa / e-Mola (C2B popup flow — never redirects)
    const [mobilePopupOpen, setMobilePopupOpen] = useState(false);
    const [mobilePopupState, setMobilePopupState] = useState<
        'processing' | 'pending' | 'success' | 'failed' | 'timeout'
    >('processing');
    const [mobilePopupMessage, setMobilePopupMessage] = useState<string>('');
    const [mobilePendingRef, setMobilePendingRef] = useState<string | null>(null);

    // Unified Failed Payment Modal (triggered when gateway callback returns failed/cancelled/expired)
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

    const dismissFailureModal = useCallback(() => {
        setFailedModal({ open: false, title: '', message: '' });
        if (searchParams.toString()) {
            const nextParams = new URLSearchParams(searchParams);
            [
                'payment_status',
                'payment_callback',
                'payment_reason',
                'status',
                'reason',
                'error',
                'message',
                'cancelled',
                'canceled',
                'subscription_id',
                'method',
                'tier',
                'cycle',
            ].forEach((k) => nextParams.delete(k));
            setSearchParams(nextParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const [referralCreditsUsd, setReferralCreditsUsd] = useState(0);
    const [pendingCreditsUsd, setPendingCreditsUsd] = useState(0);
    const [useReferralCredits, setUseReferralCredits] = useState(false);
    const [redeemingCredits, setRedeemingCredits] = useState(false);

    // Crypto payment states (persisted independently across reloads)
    const [cryptoCurrencies, setCryptoCurrencies] = useState<CryptoCurrencyOption[]>(
        DEFAULT_CRYPTO_CURRENCIES,
    );
    const [selectedCrypto, setSelectedCrypto] = useState<string>('USDT.TRC20');
    const [activeCryptoPayment, setActiveCryptoPayment] = useState<ActiveCryptoPayment | null>(
        () => initialCryptoSession,
    );
    const [cryptoError, setCryptoError] = useState<string | null>(null);
    const [checkingCryptoStatus, setCheckingCryptoStatus] = useState(false);
    const [cancellingCrypto, setCancellingCrypto] = useState(false);
    const [autoCopiedBanner, setAutoCopiedBanner] = useState(false);
    const autoCopyDoneRef = useRef(false);

    // PIX (BR ONLY — CPF/CNPJ only)
    const [pixPayerDocument, setPixPayerDocument] = useState<string>('');
    const [activePixPayment, setActivePixPayment] = useState<ActivePixPayment | null>(() =>
        readStoredPixSession(user?.id),
    );
    const [pixError, setPixError] = useState<string | null>(null);
    const [checkingPixStatus, setCheckingPixStatus] = useState(false);
    const [cancellingPix, setCancellingPix] = useState(false);

    // Sync selection when arriving via location.state
    useEffect(() => {
        if (statePlan && stateCycle) {
            const normalized = normalizeCheckoutPlan(statePlan, isEn);
            setPlan(normalized);
            setBillingCycle(stateCycle);
            saveStoredSelection(user?.id, normalized, stateCycle);
        }
    }, [statePlan, stateCycle, user?.id, isEn]);

    useEffect(() => {
        setPlan((prev: any) => (prev ? normalizeCheckoutPlan(prev, isEn) : prev));
    }, [isEn]);

    // Detect Checkout GeoIP from backend on load (strictly GeoIP, NOT user settings)
    useEffect(() => {
        const manual = readManualCountryOverride();
        if (manual) {
            const loc = resolveLocationOption(manual, isEn);
            setCountryCode(loc.code);
            setAvailableMethods(loc.methods);
            setPaymentMethod((prev) => (loc.methods.includes(prev) ? prev : loc.defaultMethod));
            return;
        }

        let mounted = true;
        api.get('/payment/checkout-context')
            .then((res) => {
                if (!mounted || !res.data) return;
                const loc = resolveLocationOption(res.data.countryCode, isEn);
                const serverMethods = Array.isArray(res.data.availableMethods)
                    ? (res.data.availableMethods as CheckoutMethodId[])
                    : loc.methods;

                setCountryCode(loc.code);
                setAvailableMethods(serverMethods);
                setPaymentMethod((prev) => {
                    if (urlCryptoRef && serverMethods.includes('crypto')) return 'crypto';
                    if (urlPixRef && serverMethods.includes('pix')) return 'pix';
                    if (activeCryptoPayment && serverMethods.includes('crypto')) return 'crypto';
                    if (activePixPayment && serverMethods.includes('pix')) return 'pix';
                    return serverMethods.includes(prev)
                        ? prev
                        : ((res.data.defaultMethod as CheckoutMethodId) || loc.defaultMethod);
                });
            })
            .catch(() => {
                // Keep universal methods (card + crypto) on error
            });

        return () => {
            mounted = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSelectLocationFlag = (loc: CheckoutLocationOption) => {
        try {
            sessionStorage.setItem(MANUAL_COUNTRY_KEY, loc.code);
        } catch {
            // Ignore
        }
        setCountryCode(loc.code);
        setAvailableMethods(loc.methods);
        setMethodError(null);
        setPaymentMethod((prev) => (loc.methods.includes(prev) ? prev : loc.defaultMethod));
    };

    const handlePhoneCountrySync = (iso2: string) => {
        handleSelectLocationFlag(resolveLocationOption(iso2, isEn));
    };

    // Fetch supported cryptocurrency catalog
    useEffect(() => {
        let mounted = true;
        api.get('/payment/crypto-currencies')
            .then((res) => {
                if (!mounted) return;
                if (Array.isArray(res.data?.currencies) && res.data.currencies.length > 0) {
                    setCryptoCurrencies(res.data.currencies);
                }
            })
            .catch(() => {});
        return () => {
            mounted = false;
        };
    }, []);

    // Hydrate active Crypto/PIX sessions and recover plan selection on external callback returns
    useEffect(() => {
        if (!user?.id) return;
        let mounted = true;

        const storedSel = readStoredSelection(user.id, isEn);
        const hasInitialPlan = Boolean(statePlan || explicitUrlTier || storedSel?.plan || plan);
        if (!statePlan && !explicitUrlTier && storedSel?.plan && !plan) {
            setPlan(storedSel.plan);
            setBillingCycle(normalizeBillingCycle(storedSel.billingCycle));
        }

        const cryptoQuery = urlCryptoRef
            ? `/subscription/crypto/active?reference=${encodeURIComponent(urlCryptoRef)}`
            : '/subscription/crypto/active';
        const pixQuery = urlPixRef
            ? `/subscription/pix/active?reference=${encodeURIComponent(urlPixRef)}`
            : '/subscription/pix/active';

        const needsPlanFallback =
            !hasInitialPlan &&
            (Boolean(urlTier) || Boolean(urlCallbackRef) || callbackFailure.isFailed);

        // Always fetch live catalog from /payment/plans so checkout never displays stale cached prices/discounts
        Promise.allSettled([
            api.get(cryptoQuery),
            api.get(pixQuery),
            api.get('/payment/plans').catch(() => api.get('/subscription/plans')),
            needsPlanFallback && urlCallbackRef && !urlTier
                ? api.post(`/subscription/check-status/${encodeURIComponent(urlCallbackRef)}`, {
                      force: false,
                  })
                : Promise.resolve(null),
        ])
            .then(async ([cryptoRes, pixRes, plansRes, refRes]) => {
                if (!mounted) return;

                if (plansRes.status === 'fulfilled' && plansRes.value?.data) {
                    const catalog = normalizeWorkspacePlansCatalog(
                        Array.isArray(plansRes.value.data) ? plansRes.value.data : [],
                        isEn,
                    );
                    const refData =
                        refRes.status === 'fulfilled' ? refRes.value?.data : null;
                    const desiredTier =
                        normalizeWorkspaceTierClient(
                            statePlan?.tier ||
                                urlTier ||
                                refData?.tier ||
                                storedSel?.plan?.tier ||
                                plan?.tier,
                        ) || (needsPlanFallback ? 'BASIC' : null);

                    if (desiredTier) {
                        const matchedPlan =
                            catalog.find((p) => p.tier === desiredTier) ||
                            (needsPlanFallback ? catalog[0] : null);
                        if (matchedPlan) {
                            const resolvedCycle = normalizeBillingCycle(
                                stateCycle ||
                                    explicitUrlCycle ||
                                    refData?.cycle ||
                                    storedSel?.billingCycle ||
                                    billingCycle,
                                'YEARLY',
                            );
                            setPlan(matchedPlan);
                            setBillingCycle(resolvedCycle);
                            saveStoredSelection(user.id, matchedPlan, resolvedCycle);
                        }
                    }
                }

                if (cryptoRes.status === 'fulfilled') {
                    const data = cryptoRes.value.data;
                    if (data?.subscriptionStatus === 'ACTIVE') {
                        saveStoredCryptoSession(user.id, null);
                        setActiveCryptoPayment(null);
                        await refreshProfile().catch(() => {});
                        if (mounted) {
                            navigate('/subscription/success', {
                                state: { method: 'crypto', success: true },
                            });
                        }
                        return;
                    }
                    if (data?.active && data?.session) {
                        const session = data.session as ActiveCryptoPayment;
                        const matchesCurrentSelection =
                            Boolean(urlCryptoRef) ||
                            !statePlan?.tier ||
                            !stateCycle ||
                            (session.tier === statePlan.tier && session.cycle === stateCycle);

                        if (matchesCurrentSelection) {
                            setActiveCryptoPayment(session);
                            setSelectedCrypto(session.cryptoCurrency || 'USDT.TRC20');
                            if (!urlPixRef) setPaymentMethod('crypto');
                            saveStoredCryptoSession(user?.id, session);
                            if (data.plan && (!statePlan || urlCryptoRef)) {
                                const normalizedPlan = normalizeCheckoutPlan(data.plan, isEn);
                                setPlan(normalizedPlan);
                                setBillingCycle(session.cycle || 'MONTHLY');
                                saveStoredSelection(user.id, normalizedPlan, session.cycle || 'MONTHLY');
                            }
                        }
                    } else if (!data?.active) {
                        saveStoredCryptoSession(user.id, null);
                        setActiveCryptoPayment(null);
                    }
                }

                if (pixRes.status === 'fulfilled') {
                    const pdata = pixRes.value.data;
                    if (pdata?.subscriptionStatus === 'ACTIVE') {
                        saveStoredPixSession(user.id, null);
                        setActivePixPayment(null);
                        await refreshProfile().catch(() => {});
                        if (mounted) {
                            navigate('/subscription/success', {
                                state: { method: 'pix', success: true },
                            });
                        }
                        return;
                    }
                    if (pdata?.active && pdata?.session) {
                        const pixSess = pdata.session as ActivePixPayment;
                        setActivePixPayment(pixSess);
                        if (urlPixRef) {
                            setCountryCode('BR');
                            setAvailableMethods(['pix', 'card', 'crypto']);
                            setPaymentMethod('pix');
                        }
                        saveStoredPixSession(user.id, pixSess);
                        if (pdata.plan && (!statePlan || urlPixRef)) {
                            const normalizedPlan = normalizeCheckoutPlan(pdata.plan, isEn);
                            setPlan(normalizedPlan);
                            setBillingCycle(pixSess.cycle || 'MONTHLY');
                            saveStoredSelection(user.id, normalizedPlan, pixSess.cycle || 'MONTHLY');
                        }
                    } else if (!pdata?.active) {
                        saveStoredPixSession(user.id, null);
                        setActivePixPayment(null);
                    }
                }
            })
            .finally(() => {
                if (mounted) setHydratingCheckout(false);
            });

        return () => {
            mounted = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, urlCryptoRef, urlPixRef, urlCallbackRef]);

    // Trigger failure modal when returned from a failed/cancelled payment callback
    const handledFailureSearchRef = useRef<string>('');
    useEffect(() => {
        if (!callbackFailure.isFailed) {
            handledFailureSearchRef.current = '';
            return;
        }
        const rawSearch = searchParams.toString();
        if (handledFailureSearchRef.current === rawSearch) return;
        handledFailureSearchRef.current = rawSearch;

        if (urlMethod === 'mpesa' || urlMethod === 'emola') {
            const loc = resolveLocationOption('MZ', isEn);
            setCountryCode(loc.code);
            setAvailableMethods(loc.methods);
            setPaymentMethod(urlMethod);
        } else if (urlMethod === 'payfast') {
            const loc = resolveLocationOption('ZA', isEn);
            setCountryCode(loc.code);
            setAvailableMethods(loc.methods);
            setPaymentMethod('payfast');
        } else if (urlMethod === 'pix') {
            const loc = resolveLocationOption('BR', isEn);
            setCountryCode(loc.code);
            setAvailableMethods(loc.methods);
            setPaymentMethod('pix');
        } else if (urlMethod === 'card' || urlMethod === 'crypto') {
            setPaymentMethod(urlMethod);
        }

        openFailureModal({
            reason: callbackFailure.reason || callbackFailure.statusCode,
            method: urlMethod || undefined,
            reference: urlCallbackRef || undefined,
        });
    }, [
        callbackFailure.isFailed,
        callbackFailure.reason,
        callbackFailure.statusCode,
        searchParams,
        urlMethod,
        urlCallbackRef,
        isEn,
        openFailureModal,
    ]);

    // Auto-copy wallet address when opened with ?copyWallet=1
    useEffect(() => {
        if (
            !shouldAutoCopyWallet ||
            autoCopyDoneRef.current ||
            !activeCryptoPayment?.walletAddress
        ) {
            return;
        }
        autoCopyDoneRef.current = true;
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            navigator.clipboard
                .writeText(activeCryptoPayment.walletAddress)
                .then(() => setAutoCopiedBanner(true))
                .catch(() => {});
        }
    }, [shouldAutoCopyWallet, activeCryptoPayment?.walletAddress]);

    useEffect(() => {
        if (user) {
            if (paymentMethod === 'mpesa' && user.preferredMpesa) {
                setPhoneNumber(
                    String(user.preferredMpesa).replace(/\D/g, '').replace(/^258(?=\d{9}$)/, ''),
                );
            } else if (paymentMethod === 'emola' && user.preferredEmola) {
                setPhoneNumber(
                    String(user.preferredEmola).replace(/\D/g, '').replace(/^258(?=\d{9}$)/, ''),
                );
            } else if (paymentMethod === 'payfast') {
                setPhoneNumber('');
            }
        }
    }, [user, paymentMethod]);

    useEffect(() => {
        if (!user?.id) return;
        let mounted = true;
        api.get('/referrals/me')
            .then((res) => {
                if (!mounted || !res.data) return;
                setReferralCreditsUsd(Number(res.data.creditsUsd || 0));
                setPendingCreditsUsd(Number(res.data.pendingCreditsUsd || 0));
            })
            .catch(() => {});
        return () => {
            mounted = false;
        };
    }, [user?.id]);

    // Demand-aware adaptive polling for M-Pesa / e-Mola Popup (reconciles via check-status)
    const pollMobileStatus = useCallback(async () => {
        if (!mobilePendingRef) {
            return { settled: true, nextPollAfterMs: 0 };
        }
        const checkRes = await api.post(
            `/subscription/check-status/${encodeURIComponent(mobilePendingRef)}`,
            { force: false },
        );
        const data = checkRes.data || {};
        const st = String(data.status || '').toUpperCase();
        if (st === 'ACTIVE' || st === 'APPROVED') {
            setMobilePopupState('success');
            await refreshProfile().catch(() => {});
            window.setTimeout(() => {
                navigate('/subscription/success', {
                    state: { method: paymentMethod, success: true },
                });
            }, 900);
            return { settled: true, nextPollAfterMs: 0 };
        }
        if (st === 'CANCELLED' || st === 'EXPIRED') {
            setMobilePopupState('failed');
            setMobilePopupMessage(
                resolvePaymentFailureCopy(
                    data.failureReason || (st === 'EXPIRED' ? 'expired' : 'failed'),
                    isEn,
                ).message,
            );
            return { settled: true, nextPollAfterMs: 0 };
        }
        return {
            settled: false,
            nextPollAfterMs:
                typeof data.nextPollAfterMs === 'number' ? data.nextPollAfterMs : null,
        };
    }, [mobilePendingRef, navigate, paymentMethod, refreshProfile, isEn]);

    useAdaptivePaymentPolling({
        enabled: mobilePopupOpen && mobilePopupState === 'pending' && Boolean(mobilePendingRef),
        method: paymentMethod,
        maxDurationMs: 3 * 60 * 1000,
        initialDelayMs: 3500,
        onPoll: pollMobileStatus,
        onTimeout: () => {
            setMobilePopupState('timeout');
            setMobilePopupMessage(
                isEn
                    ? 'Confirmation timeout reached. If you authorized the PIN, check your billing history or try again.'
                    : 'Tempo limite atingido. Se já digitou o PIN, verifique o histórico de pagamentos ou tente novamente.',
            );
        },
    });

    // Live demand-aware polling for active pending Crypto payment
    const syncCryptoNow = useCallback(
        async (manual = false) => {
            if (!activeCryptoPayment?.reference) {
                return { settled: true, nextPollAfterMs: 0 };
            }
            if (manual) {
                setCheckingCryptoStatus(true);
                setCryptoError(null);
            }
            try {
                if (manual) {
                    await api
                        .post(
                            `/subscription/check-status/${encodeURIComponent(activeCryptoPayment.reference)}`,
                            { force: true },
                        )
                        .catch(() => {});
                }
                const res = await api.get(
                    `/subscription/crypto/active?reference=${encodeURIComponent(activeCryptoPayment.reference)}`,
                );
                const data = res.data;
                if (data?.subscriptionStatus === 'ACTIVE') {
                    saveStoredCryptoSession(user?.id, null);
                    setActiveCryptoPayment(null);
                    await refreshProfile().catch(() => {});
                    navigate('/subscription/success', { state: { method: 'crypto', success: true } });
                    return { settled: true, nextPollAfterMs: 0 };
                }
                if (data?.session) {
                    const updated = data.session as ActiveCryptoPayment;
                    const pst = String(updated.providerStatus || '').toLowerCase();
                    if (
                        ['failed', 'expired', 'cancelled', 'refunded'].includes(pst) ||
                        data?.subscriptionStatus === 'CANCELLED' ||
                        data?.subscriptionStatus === 'EXPIRED'
                    ) {
                        saveStoredCryptoSession(user?.id, null);
                        setActiveCryptoPayment(null);
                        openFailureModal({
                            reason: pst === 'expired' ? 'expired' : 'failed',
                            method: 'crypto',
                            reference: activeCryptoPayment.reference,
                        });
                        return { settled: true, nextPollAfterMs: 0 };
                    }
                    setActiveCryptoPayment(updated);
                    saveStoredCryptoSession(user?.id, updated);
                }
                return {
                    settled: false,
                    nextPollAfterMs:
                        typeof data?.nextPollAfterMs === 'number'
                            ? data.nextPollAfterMs
                            : null,
                };
            } catch (err: any) {
                if (manual) {
                    setCryptoError(
                        err?.response?.data?.message ||
                            (isEn
                                ? 'Could not check status right now.'
                                : 'Não foi possível verificar o status agora.'),
                    );
                    return { settled: false, nextPollAfterMs: null };
                }
                throw err;
            } finally {
                if (manual) setCheckingCryptoStatus(false);
            }
        },
        [activeCryptoPayment?.reference, user?.id, refreshProfile, navigate, isEn, openFailureModal],
    );

    useAdaptivePaymentPolling({
        enabled:
            Boolean(activeCryptoPayment?.reference) &&
            ['waiting', 'confirming', 'partially_paid'].includes(
                (activeCryptoPayment?.providerStatus || 'waiting').toLowerCase(),
            ),
        method: 'crypto',
        maxDurationMs: 65 * 60 * 1000,
        onPoll: () => syncCryptoNow(false),
    });

    // Live demand-aware polling for active pending PIX payment
    const syncPixNow = useCallback(
        async (manual = false) => {
            if (!activePixPayment?.reference) {
                return { settled: true, nextPollAfterMs: 0 };
            }
            if (manual) {
                setCheckingPixStatus(true);
                setPixError(null);
            }
            try {
                if (manual) {
                    await api
                        .post(
                            `/subscription/check-status/${encodeURIComponent(activePixPayment.reference)}`,
                            { force: true },
                        )
                        .catch(() => {});
                }
                const res = await api.get(
                    `/subscription/pix/active?reference=${encodeURIComponent(activePixPayment.reference)}`,
                );
                const data = res.data;
                if (data?.subscriptionStatus === 'ACTIVE') {
                    saveStoredPixSession(user?.id, null);
                    setActivePixPayment(null);
                    await refreshProfile().catch(() => {});
                    navigate('/subscription/success', { state: { method: 'pix', success: true } });
                    return { settled: true, nextPollAfterMs: 0 };
                }
                if (data?.session) {
                    const updated = data.session as ActivePixPayment;
                    const pst = String(updated.providerStatus || '').toLowerCase();
                    if (
                        ['failed', 'expired', 'cancelled', 'canceled', 'refunded'].includes(pst) ||
                        data?.subscriptionStatus === 'CANCELLED' ||
                        data?.subscriptionStatus === 'EXPIRED'
                    ) {
                        saveStoredPixSession(user?.id, null);
                        setActivePixPayment(null);
                        openFailureModal({
                            reason: pst === 'expired' ? 'expired' : 'failed',
                            method: 'pix',
                            reference: activePixPayment.reference,
                        });
                        return { settled: true, nextPollAfterMs: 0 };
                    }
                    setActivePixPayment(updated);
                    saveStoredPixSession(user?.id, updated);
                }
                return {
                    settled: false,
                    nextPollAfterMs:
                        typeof data?.nextPollAfterMs === 'number'
                            ? data.nextPollAfterMs
                            : null,
                };
            } catch (err: any) {
                if (manual) {
                    setPixError(
                        err?.response?.data?.message ||
                            (isEn
                                ? 'Could not check status right now.'
                                : 'Não foi possível verificar o status agora.'),
                    );
                    return { settled: false, nextPollAfterMs: null };
                }
                throw err;
            } finally {
                if (manual) setCheckingPixStatus(false);
            }
        },
        [activePixPayment?.reference, user?.id, refreshProfile, navigate, isEn, openFailureModal],
    );

    useAdaptivePaymentPolling({
        enabled:
            Boolean(activePixPayment?.reference) &&
            ['pending', 'waiting', 'created'].includes(
                (activePixPayment?.providerStatus || 'pending').toLowerCase(),
            ),
        method: 'pix',
        maxDurationMs: 35 * 60 * 1000,
        onPoll: () => syncPixNow(false),
    });

    if (hydratingCheckout && (!plan || !billingCycle)) {
        return (
            <div className="theme-light min-h-screen bg-white flex items-center justify-center p-6">
                <div className="flex flex-col items-center gap-3 text-slate-500">
                    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                    <span className="text-xs font-bold uppercase tracking-widest">
                        {isEn ? 'Loading Checkout...' : 'Carregando Checkout...'}
                    </span>
                </div>
            </div>
        );
    }

    if (!plan || !billingCycle) {
        return <Navigate to="/dashboard?plans=1" replace />;
    }

    const normalizedCycle = normalizeBillingCycle(billingCycle, 'YEARLY');
    const cyclePricing = calculatePlanCyclePricing(plan, normalizedCycle);
    const baseTotalUSD = cyclePricing.totalUsd;
    const appliedCreditUSD = useReferralCredits
        ? Number(Math.min(referralCreditsUsd, baseTotalUSD).toFixed(2))
        : 0;
    const payableTotalUSD = Number(Math.max(0, baseTotalUSD - appliedCreditUSD).toFixed(2));

    const handleChangeBillingCycle = (nextCycle: WorkspaceBillingCycle) => {
        if (nextCycle === normalizedCycle) return;
        setBillingCycle(nextCycle);
        setMethodError(null);
        setCryptoError(null);
        setPixError(null);
        if (plan) {
            saveStoredSelection(user?.id, plan, nextCycle);
        }
        const nextParams = new URLSearchParams(searchParams);
        if (plan?.tier) nextParams.set('tier', String(plan.tier).toUpperCase());
        nextParams.set('cycle', nextCycle);
        setSearchParams(nextParams, { replace: true });
    };

    const summaryMatchesActiveCrypto =
        paymentMethod === 'crypto' &&
        activeCryptoPayment &&
        activeCryptoPayment.tier === plan.tier &&
        activeCryptoPayment.cycle === billingCycle;
    const summaryMatchesActivePix =
        paymentMethod === 'pix' &&
        activePixPayment &&
        activePixPayment.tier === plan.tier &&
        activePixPayment.cycle === billingCycle;
    const activeSessionTotalUSD = summaryMatchesActiveCrypto
        ? Number(activeCryptoPayment.fiatAmountUsd)
        : summaryMatchesActivePix
          ? Number(activePixPayment.amountUsd)
          : payableTotalUSD;
    const summaryTotalUSD =
        Number.isFinite(activeSessionTotalUSD) && activeSessionTotalUSD > 0
            ? activeSessionTotalUSD
            : payableTotalUSD;
    const summaryCreditUSD =
        summaryTotalUSD < baseTotalUSD
            ? Number((baseTotalUSD - summaryTotalUSD).toFixed(2))
            : appliedCreditUSD;

    const handleRedeemCredits = async () => {
        if (redeemingCredits || referralCreditsUsd < baseTotalUSD) return;
        setRedeemingCredits(true);
        trackButtonClick({
            ctaTag: 'checkout_redeem_credits',
            intent: `pay_${String(plan.tier || '').toLowerCase()}`,
            label: 'Activate with Affiliate Credits',
            metadata: { tier: plan.tier, billingCycle, amountUSD: baseTotalUSD },
        });
        try {
            await api.post('/subscription/redeem-credits', {
                tier: plan.tier,
                cycle: billingCycle,
            });
            saveStoredCryptoSession(user?.id, null);
            saveStoredPixSession(user?.id, null);
            await refreshProfile().catch(() => {});
            navigate('/subscription/success', { state: { method: 'credits', success: true } });
        } catch (error) {
            console.error(error);
            alert(
                isEn
                    ? 'Could not activate plan with referral credits right now.'
                    : 'Não foi possível ativar o plano com créditos de afiliado agora.',
            );
        } finally {
            setRedeemingCredits(false);
        }
    };

    const handleMobileMoneySubmit = async () => {
        if (!phoneNumber || phoneNumber.length !== 9) return;
        setProcessing(true);
        setMethodError(null);
        setMobilePopupOpen(true);
        setMobilePopupState('processing');
        setMobilePopupMessage('');
        setMobilePendingRef(null);

        trackButtonClick({
            ctaTag: `checkout_submit_${paymentMethod}`,
            intent: `pay_${String(plan.tier || '').toLowerCase()}`,
            label: `Pay ${paymentMethod}`,
            metadata: { tier: plan.tier, billingCycle, amountUSD: payableTotalUSD },
        });

        try {
            const res = await api.post('/subscription/subscribe/mobile', {
                tier: plan.tier,
                cycle: billingCycle,
                paymentMethod: paymentMethod as 'mpesa' | 'emola',
                phoneNumber,
                savePreference,
                useReferralCredits,
            });

            if (res.data?.status === 'ACTIVE') {
                setMobilePopupState('success');
                await refreshProfile().catch(() => {});
                window.setTimeout(() => {
                    navigate('/subscription/success', {
                        state: { method: paymentMethod, success: true },
                    });
                }, 900);
                return;
            }

            setMobilePendingRef(res.data?.reference || null);
            setMobilePopupState('pending');
        } catch (error: any) {
            const msg =
                error?.response?.data?.message ||
                (isEn
                    ? 'Failed to initiate payment. Please check the number and try again.'
                    : 'Erro ao iniciar pagamento. Verifique o número e tente novamente.');
            const text = Array.isArray(msg) ? msg.join(' ') : String(msg);
            setMobilePopupState('failed');
            setMobilePopupMessage(text);
        } finally {
            setProcessing(false);
        }
    };

    const handleCardSubmit = async () => {
        setProcessing(true);
        setMethodError(null);
        trackButtonClick({
            ctaTag: 'checkout_submit_card',
            intent: `pay_${String(plan.tier || '').toLowerCase()}`,
            label: 'Pay card',
            metadata: { tier: plan.tier, billingCycle, amountUSD: payableTotalUSD },
        });
        try {
            const res = await api.post('/subscription/subscribe/card', {
                tier: plan.tier,
                cycle: billingCycle,
                returnUrl: `${window.location.origin}${localizeBrowserPath('/subscription/success')}`,
                cancelUrl: `${window.location.origin}${buildCheckoutFailureUrl({
                    localizePath: localizeBrowserPath,
                    method: 'card',
                    tier: plan.tier,
                    cycle: billingCycle,
                    reason: 'cancelled',
                })}`,
                phoneNumber: (cardPhoneNumber || phoneNumber) || undefined,
                paymentMethod: 'card',
                useReferralCredits,
            });

            if (res.data?.checkoutUrl) {
                window.location.href = res.data.checkoutUrl;
                return;
            }
            setMethodError(
                isEn
                    ? 'Unable to open secure payment page right now.'
                    : 'Não foi possível abrir a página de pagamento seguro agora.',
            );
        } catch (error: any) {
            const msg =
                error?.response?.data?.message ||
                (isEn ? 'Failed to initiate card payment.' : 'Erro ao iniciar pagamento com cartão.');
            setMethodError(Array.isArray(msg) ? msg.join(' ') : String(msg));
        } finally {
            setProcessing(false);
        }
    };

    const handlePayFastSubmit = async () => {
        setProcessing(true);
        setMethodError(null);
        trackButtonClick({
            ctaTag: 'checkout_submit_payfast',
            intent: `pay_${String(plan.tier || '').toLowerCase()}`,
            label: 'Pay PayFast',
            metadata: { tier: plan.tier, billingCycle, amountUSD: payableTotalUSD },
        });
        try {
            const formattedZaPhone = phoneNumber.trim() ? `+27${phoneNumber.replace(/^0+/, '')}` : undefined;
            const res = await api.post('/subscription/subscribe/payfast', {
                tier: plan.tier,
                cycle: billingCycle,
                returnUrl: `${window.location.origin}${localizeBrowserPath('/subscription/success')}`,
                phoneNumber: formattedZaPhone,
                useReferralCredits,
            });

            if (res.data?.checkoutUrl) {
                window.location.href = res.data.checkoutUrl;
                return;
            }
            setMethodError('Unable to open secure payment page right now.');
        } catch (error: any) {
            const msg = error?.response?.data?.message || 'Failed to initiate PayFast payment.';
            setMethodError(Array.isArray(msg) ? msg.join(' ') : String(msg));
        } finally {
            setProcessing(false);
        }
    };

    const handleGenerateCryptoWallet = async (forceNew = false) => {
        if (!selectedCrypto) return;
        setProcessing(true);
        setCryptoError(null);
        setAutoCopiedBanner(false);
        trackButtonClick({
            ctaTag: 'checkout_submit_crypto',
            intent: `pay_${String(plan.tier || '').toLowerCase()}`,
            label: `Pay Crypto ${selectedCrypto}`,
            metadata: {
                tier: plan.tier,
                billingCycle,
                cryptocurrency: selectedCrypto,
                amountUSD: payableTotalUSD,
            },
        });
        try {
            const res = await api.post('/subscription/subscribe/crypto', {
                tier: plan.tier,
                cycle: billingCycle,
                cryptocurrency: selectedCrypto,
                useReferralCredits,
                forceNew,
            });

            if (res.data?.subscriptionStatus === 'ACTIVE') {
                saveStoredCryptoSession(user?.id, null);
                await refreshProfile().catch(() => {});
                navigate('/subscription/success', { state: { method: 'crypto', success: true } });
                return;
            }

            if (res.data?.session) {
                const session = res.data.session as ActiveCryptoPayment;
                setActiveCryptoPayment(session);
                setSelectedCrypto(session.cryptoCurrency);
                saveStoredCryptoSession(user?.id, session);
                saveStoredSelection(user?.id, res.data.plan || plan, billingCycle);
            }
        } catch (error: any) {
            const msg =
                error?.response?.data?.message ||
                (isEn
                    ? 'Unable to generate crypto wallet right now.'
                    : 'Não foi possível gerar a carteira cripto agora.');
            setCryptoError(Array.isArray(msg) ? msg.join(' ') : String(msg));
        } finally {
            setProcessing(false);
        }
    };

    const handleChangeCryptoCoin = async () => {
        if (!activeCryptoPayment?.reference) {
            setActiveCryptoPayment(null);
            saveStoredCryptoSession(user?.id, null);
            return;
        }
        setCancellingCrypto(true);
        setCryptoError(null);
        try {
            await api.post(
                `/subscription/crypto/${encodeURIComponent(activeCryptoPayment.reference)}/cancel`,
            );
            setActiveCryptoPayment(null);
            setAutoCopiedBanner(false);
            saveStoredCryptoSession(user?.id, null);
        } catch (error: any) {
            setCryptoError(String(error?.response?.data?.message || 'Erro ao trocar moeda.'));
        } finally {
            setCancellingCrypto(false);
        }
    };

    const handleGeneratePix = async (forceNew = false) => {
        if (!pixPayerDocument.trim()) return;
        setProcessing(true);
        setPixError(null);
        trackButtonClick({
            ctaTag: 'checkout_submit_pix',
            intent: `pay_${String(plan.tier || '').toLowerCase()}`,
            label: 'Pay PIX',
            metadata: { tier: plan.tier, billingCycle, amountUSD: payableTotalUSD },
        });
        try {
            const res = await api.post('/subscription/subscribe/pix', {
                tier: plan.tier,
                cycle: billingCycle,
                payerDocument: pixPayerDocument,
                useReferralCredits,
                forceNew,
            });

            if (res.data?.subscriptionStatus === 'ACTIVE') {
                saveStoredPixSession(user?.id, null);
                await refreshProfile().catch(() => {});
                navigate('/subscription/success', { state: { method: 'pix', success: true } });
                return;
            }

            if (res.data?.session) {
                const session = res.data.session as ActivePixPayment;
                setActivePixPayment(session);
                saveStoredPixSession(user?.id, session);
                saveStoredSelection(user?.id, res.data.plan || plan, billingCycle);
            }
        } catch (error: any) {
            const msg =
                error?.response?.data?.message ||
                (isEn
                    ? 'Unable to generate PIX QR Code right now.'
                    : 'Não foi possível gerar o QR Code PIX agora.');
            setPixError(Array.isArray(msg) ? msg.join(' ') : String(msg));
        } finally {
            setProcessing(false);
        }
    };

    const handleResetPix = async () => {
        if (!activePixPayment?.reference) {
            setActivePixPayment(null);
            saveStoredPixSession(user?.id, null);
            return;
        }
        setCancellingPix(true);
        setPixError(null);
        try {
            await api.post(
                `/subscription/pix/${encodeURIComponent(activePixPayment.reference)}/cancel`,
            );
            setActivePixPayment(null);
            saveStoredPixSession(user?.id, null);
        } catch (error: any) {
            setPixError(String(error?.response?.data?.message || 'Erro ao cancelar cobrança.'));
        } finally {
            setCancellingPix(false);
        }
    };

    const methodGridClass = getPaymentMethodGridClass(availableMethods.length);

    const renderMethodBadge = (methodId: CheckoutMethodId) => {
        const commonSelect = () => {
            setPaymentMethod(methodId);
            setMethodError(null);
        };

        switch (methodId) {
            case 'mpesa':
                return (
                    <PaymentMethodBadge
                        key="mpesa"
                        id="mpesa"
                        label="M-Pesa"
                        icon={MpesaIcon}
                        active={paymentMethod === 'mpesa'}
                        onClick={commonSelect}
                    />
                );
            case 'emola':
                return (
                    <PaymentMethodBadge
                        key="emola"
                        id="emola"
                        label="e-Mola"
                        icon={EmolaIcon}
                        active={paymentMethod === 'emola'}
                        onClick={commonSelect}
                    />
                );
            case 'pix':
                return (
                    <PaymentMethodBadge
                        key="pix"
                        id="pix"
                        label="PIX"
                        icon={PixIcon}
                        active={paymentMethod === 'pix'}
                        hasActiveBadge={Boolean(activePixPayment)}
                        onClick={commonSelect}
                    />
                );
            case 'payfast':
                return (
                    <PaymentMethodBadge
                        key="payfast"
                        id="payfast"
                        label="PayFast"
                        icon={PayFastIcon}
                        active={paymentMethod === 'payfast'}
                        onClick={commonSelect}
                    />
                );
            case 'crypto':
                return (
                    <PaymentMethodBadge
                        key="crypto"
                        id="crypto"
                        label={isEn ? 'Cryptocurrency' : 'Criptomoeda'}
                        mobileLabel={isEn ? 'Crypto' : 'Cripto'}
                        icon={CryptoMethodIcon}
                        active={paymentMethod === 'crypto'}
                        hasActiveBadge={Boolean(activeCryptoPayment)}
                        onClick={commonSelect}
                    />
                );
            case 'card':
            default:
                return (
                    <PaymentMethodBadge
                        key="card"
                        id="card"
                        label="Visa / Mastercard"
                        mobileLabel={isEn ? 'Card' : 'Cartão'}
                        icon={CardBrandsIcon}
                        active={paymentMethod === 'card'}
                        onClick={commonSelect}
                    />
                );
        }
    };

    return (
        <div className="theme-light min-h-screen bg-white text-slate-900 selection:bg-indigo-500/20 overflow-x-hidden relative">
            {/* Subtle White-Mode Ambient Highlights */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-100/50 blur-[140px] rounded-full" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-sky-100/50 blur-[140px] rounded-full" />
            </div>

            <div className="relative z-10 container mx-auto px-4 sm:px-6 pt-3 pb-8 sm:pt-5 sm:pb-10 max-w-6xl">
                {/* Top Navigation + Country Flag Dropdown */}
                <div className="flex items-center justify-between gap-2.5 mb-4 sm:mb-6">
                    <motion.button
                        type="button"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        onClick={() => navigate('/dashboard?plans=1')}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors group cursor-pointer shrink-0"
                    >
                        <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center group-hover:bg-slate-50 transition-colors shadow-sm">
                            <ChevronLeft size={16} />
                        </div>
                        <span className="font-bold uppercase tracking-widest text-[10px]">
                            {isEn ? 'Back to Plans' : 'Voltar aos Planos'}
                        </span>
                    </motion.button>

                    <CheckoutLocationSwitcher
                        currentCode={countryCode}
                        onSelectLocation={handleSelectLocationFlag}
                        isEn={isEn}
                    />
                </div>

                <div className="grid lg:grid-cols-12 gap-5 lg:gap-10 items-start">
                    {/* Left: Plan Summary (Strictly USD) */}
                    <div className="lg:col-span-4">
                        <PlanSummary
                            plan={plan}
                            billingCycle={normalizedCycle}
                            total={summaryTotalUSD}
                            baseTotal={baseTotalUSD}
                            appliedCredit={summaryCreditUSD}
                            isEn={isEn}
                            onChangeBillingCycle={handleChangeBillingCycle}
                        />
                    </div>

                    {/* Right: Compact Adaptive Payment Center */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, delay: 0.08 }}
                        className="lg:col-span-8"
                    >
                        <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-[32px] p-4 sm:p-7 lg:p-8 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.08)] relative">
                            <div className="relative z-10">
                                <header className="mb-4 sm:mb-6">
                                    <h2 className="text-xl sm:text-3xl font-black text-slate-900 mb-1 sm:mb-2 tracking-tight uppercase">
                                        Checkout
                                    </h2>
                                    <p className="text-slate-600 text-xs sm:text-sm">
                                        {isEn
                                            ? 'Choose your payment method to activate your plan.'
                                            : 'Escolha seu método de pagamento para ativar seu plano.'}
                                    </p>
                                </header>

                                {(referralCreditsUsd > 0 || pendingCreditsUsd > 0) && (
                                    <div className="mb-5 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3.5 sm:p-4 space-y-2.5">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 text-xs font-bold text-indigo-700 uppercase tracking-wider">
                                                <Gift size={15} />
                                                <span>
                                                    {isEn ? 'Affiliate Credits' : 'Créditos de Afiliado'}
                                                </span>
                                            </div>
                                            <span className="text-xs font-mono font-black text-slate-900">
                                                ${referralCreditsUsd.toFixed(2)} USD
                                            </span>
                                        </div>

                                        {referralCreditsUsd >= baseTotalUSD ? (
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <p className="text-xs text-slate-600">
                                                    {isEn
                                                        ? `Your balance covers the full plan ($${baseTotalUSD.toFixed(2)} USD).`
                                                        : `O seu saldo cobre o plano completo ($${baseTotalUSD.toFixed(2)} USD).`}
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={handleRedeemCredits}
                                                    disabled={redeemingCredits}
                                                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                                                >
                                                    <Sparkles size={14} />
                                                    <span>
                                                        {redeemingCredits
                                                            ? isEn
                                                                ? 'Activating...'
                                                                : 'Ativando...'
                                                            : isEn
                                                              ? 'Activate with Credits'
                                                              : 'Ativar com Créditos'}
                                                    </span>
                                                </button>
                                            </div>
                                        ) : referralCreditsUsd > 0 ? (
                                            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-800">
                                                <input
                                                    type="checkbox"
                                                    checked={useReferralCredits}
                                                    onChange={(e) =>
                                                        setUseReferralCredits(e.target.checked)
                                                    }
                                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <span>
                                                    {isEn
                                                        ? `Apply $${referralCreditsUsd.toFixed(2)} USD credits (total $${payableTotalUSD.toFixed(2)} USD)`
                                                        : `Usar $${referralCreditsUsd.toFixed(2)} USD em créditos (resta $${payableTotalUSD.toFixed(2)} USD)`}
                                                </span>
                                            </label>
                                        ) : null}
                                    </div>
                                )}

                                {/* GeoIP-Adaptive Method Selector */}
                                <div className={`grid ${methodGridClass} mb-5 sm:mb-6`}>
                                    {availableMethods.map((m) => renderMethodBadge(m))}
                                </div>

                                {/* Compact Payment Form */}
                                <div className="min-h-[170px]">
                                    <AnimatePresence mode="wait">
                                        <motion.div
                                            key={paymentMethod}
                                            initial={{ opacity: 0, x: 10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -10 }}
                                            transition={{ duration: 0.18 }}
                                        >
                                            {(paymentMethod === 'mpesa' || paymentMethod === 'emola') && (
                                                <MobileMoneyForm
                                                    method={paymentMethod}
                                                    isEn={isEn}
                                                    phoneNumber={phoneNumber}
                                                    setPhoneNumber={setPhoneNumber}
                                                    selectedIso2={countryCode}
                                                    onCountryChange={handlePhoneCountrySync}
                                                    savePreference={savePreference}
                                                    setSavePreference={setSavePreference}
                                                    onSubmit={handleMobileMoneySubmit}
                                                    processing={processing}
                                                    payableTotalUSD={payableTotalUSD}
                                                    errorMessage={methodError}
                                                />
                                            )}

                                            {paymentMethod === 'card' && (
                                                <CardPaymentView
                                                    onSubmit={handleCardSubmit}
                                                    processing={processing}
                                                    isEn={isEn}
                                                    onPhoneChange={setCardPhoneNumber}
                                                    nationalPhone={phoneNumber}
                                                    onNationalPhoneChange={setPhoneNumber}
                                                    selectedIso2={countryCode}
                                                    onCountryChange={handlePhoneCountrySync}
                                                    payableTotalUSD={payableTotalUSD}
                                                    errorMessage={methodError}
                                                />
                                            )}

                                            {paymentMethod === 'payfast' && (
                                                <PayFastPaymentView
                                                    phoneNumber={phoneNumber}
                                                    setPhoneNumber={setPhoneNumber}
                                                    selectedIso2={countryCode}
                                                    onCountryChange={handlePhoneCountrySync}
                                                    onSubmit={handlePayFastSubmit}
                                                    processing={processing}
                                                    payableTotalUSD={payableTotalUSD}
                                                    errorMessage={methodError}
                                                    isEn={isEn}
                                                />
                                            )}

                                            {paymentMethod === 'pix' && (
                                                <PixPaymentView
                                                    payerDocument={pixPayerDocument}
                                                    setPayerDocument={(v) => {
                                                        setPixPayerDocument(v);
                                                        setPixError(null);
                                                    }}
                                                    activePixPayment={activePixPayment}
                                                    payableTotalUSD={payableTotalUSD}
                                                    processing={processing}
                                                    checkingStatus={checkingPixStatus}
                                                    cancelling={cancellingPix}
                                                    errorMessage={pixError}
                                                    onGeneratePix={handleGeneratePix}
                                                    onCheckStatus={() => void syncPixNow(true)}
                                                    onResetPix={() => void handleResetPix()}
                                                    isEn={isEn}
                                                />
                                            )}

                                            {paymentMethod === 'crypto' && (
                                                <CryptoPaymentView
                                                    currencies={cryptoCurrencies}
                                                    selectedCrypto={selectedCrypto}
                                                    setSelectedCrypto={(sym) => {
                                                        setSelectedCrypto(sym);
                                                        setCryptoError(null);
                                                    }}
                                                    activePayment={activeCryptoPayment}
                                                    payableTotalUSD={payableTotalUSD}
                                                    processing={processing}
                                                    checkingStatus={checkingCryptoStatus}
                                                    cancelling={cancellingCrypto}
                                                    errorMessage={cryptoError}
                                                    autoCopiedBanner={autoCopiedBanner}
                                                    onGenerateWallet={handleGenerateCryptoWallet}
                                                    onCheckStatus={() => void syncCryptoNow(true)}
                                                    onChangeCoin={() => void handleChangeCryptoCoin()}
                                                    isEn={isEn}
                                                />
                                            )}
                                        </motion.div>
                                    </AnimatePresence>
                                </div>

                                <footer className="mt-5 pt-4 border-t border-slate-200 flex items-center justify-between gap-4 opacity-80">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck
                                            className="text-indigo-600"
                                            size={15}
                                        />
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                                            {isEn ? 'Encrypted Checkout' : 'Pagamento Seguro'}
                                        </span>
                                    </div>
                                    <span className="text-[10px] font-mono font-bold text-slate-500">
                                        USD
                                    </span>
                                </footer>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* M-Pesa / e-Mola C2B Confirmation Popup (No external redirect) */}
            <AnimatePresence>
                {mobilePopupOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/45"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white border border-slate-200 rounded-[32px] p-8 max-w-sm w-full text-center relative overflow-hidden shadow-2xl"
                        >
                            <div className="relative z-10 space-y-5">
                                <div className="flex justify-center">
                                    <div className="relative">
                                        <div
                                            className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                                                mobilePopupState === 'success'
                                                    ? 'bg-emerald-50 text-emerald-600'
                                                    : mobilePopupState === 'failed'
                                                      ? 'bg-rose-50 text-rose-600'
                                                      : mobilePopupState === 'timeout'
                                                        ? 'bg-amber-50 text-amber-600'
                                                        : 'bg-indigo-50 text-indigo-600'
                                            }`}
                                        >
                                            {mobilePopupState === 'success' ? (
                                                <CheckCircle2 size={30} />
                                            ) : mobilePopupState === 'failed' ? (
                                                <XCircle size={30} />
                                            ) : mobilePopupState === 'timeout' ? (
                                                <AlertCircle size={30} />
                                            ) : (
                                                <Smartphone size={28} className="animate-bounce" />
                                            )}
                                        </div>
                                        {(mobilePopupState === 'processing' ||
                                            mobilePopupState === 'pending') && (
                                            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center">
                                                <Loader2 className="animate-spin text-white" size={10} />
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                                        {mobilePopupState === 'processing'
                                            ? isEn
                                                ? 'Sending Request...'
                                                : 'Enviando Pedido...'
                                            : mobilePopupState === 'pending'
                                              ? isEn
                                                  ? 'Awaiting Confirmation'
                                                  : 'Aguardando Confirmação'
                                              : mobilePopupState === 'success'
                                                ? isEn
                                                    ? 'Payment Confirmed!'
                                                    : 'Pagamento Confirmado!'
                                                : mobilePopupState === 'timeout'
                                                  ? isEn
                                                      ? 'Confirmation Timeout'
                                                      : 'Tempo Limite Atingido'
                                                  : isEn
                                                    ? 'Payment Failed'
                                                    : 'Pagamento Não Concluído'}
                                    </h3>

                                    <p className="text-slate-600 text-xs leading-relaxed">
                                        {mobilePopupState === 'processing' ? (
                                            isEn ? (
                                                <>
                                                    Starting{' '}
                                                    <span className="font-bold uppercase">
                                                        {paymentMethod}
                                                    </span>{' '}
                                                    request for{' '}
                                                    <span className="font-mono font-bold text-slate-900">
                                                        ${payableTotalUSD.toFixed(2)} USD
                                                    </span>
                                                    ...
                                                </>
                                            ) : (
                                                <>
                                                    A iniciar pedido{' '}
                                                    <span className="font-bold uppercase">
                                                        {paymentMethod}
                                                    </span>{' '}
                                                    de{' '}
                                                    <span className="font-mono font-bold text-slate-900">
                                                        ${payableTotalUSD.toFixed(2)} USD
                                                    </span>
                                                    ...
                                                </>
                                            )
                                        ) : mobilePopupState === 'pending' ? (
                                            isEn ? (
                                                <>
                                                    Enter your PIN on{' '}
                                                    <span className="font-mono font-bold text-slate-900">
                                                        +258 {phoneNumber}
                                                    </span>{' '}
                                                    to authorize{' '}
                                                    <span className="font-mono font-bold text-slate-900">
                                                        ${payableTotalUSD.toFixed(2)} USD
                                                    </span>
                                                    .
                                                </>
                                            ) : (
                                                <>
                                                    Introduza o seu PIN em{' '}
                                                    <span className="font-mono font-bold text-slate-900">
                                                        +258 {phoneNumber}
                                                    </span>{' '}
                                                    para autorizar{' '}
                                                    <span className="font-mono font-bold text-slate-900">
                                                        ${payableTotalUSD.toFixed(2)} USD
                                                    </span>
                                                    .
                                                </>
                                            )
                                        ) : mobilePopupState === 'success' ? (
                                            isEn
                                                ? 'Your plan is now active. Redirecting...'
                                                : 'Seu plano foi ativado com sucesso. Redirecionando...'
                                        ) : (
                                            mobilePopupMessage
                                        )}
                                    </p>
                                </div>

                                {mobilePopupState === 'pending' && (
                                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-[10px] text-slate-500 text-left space-y-1.5">
                                        <div className="flex items-center justify-between text-indigo-600 font-bold uppercase tracking-wider">
                                            <span>{isEn ? 'Status' : 'Estado'}</span>
                                            <span className="flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                {isEn ? 'Pending' : 'Pendente'}
                                            </span>
                                        </div>
                                        {mobilePendingRef && (
                                            <div className="font-mono text-[10px]">
                                                Ref: {mobilePendingRef}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {mobilePopupState !== 'processing' &&
                                    mobilePopupState !== 'success' && (
                                        <div className="space-y-2">
                                            {(mobilePopupState === 'failed' ||
                                                mobilePopupState === 'timeout') && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setMobilePopupOpen(false);
                                                        setMobilePendingRef(null);
                                                        setMobilePopupMessage('');
                                                    }}
                                                    className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer shadow-md shadow-indigo-500/20"
                                                >
                                                    {isEn ? 'Try Again' : 'Tentar Novamente'}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setMobilePopupOpen(false);
                                                    setMobilePendingRef(null);
                                                }}
                                                className="w-full px-6 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[11px] text-slate-800 font-bold uppercase tracking-wider transition-colors cursor-pointer"
                                            >
                                                {mobilePopupState === 'failed' ||
                                                mobilePopupState === 'timeout'
                                                    ? isEn
                                                        ? 'Choose Another Method'
                                                        : 'Escolher Outro Método'
                                                    : isEn
                                                      ? 'Close'
                                                      : 'Fechar'}
                                            </button>
                                        </div>
                                    )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

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
