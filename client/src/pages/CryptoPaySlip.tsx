import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    Check,
    CheckCircle2,
    Copy,
    Clock,
    Loader2,
    ShieldCheck,
    AlertTriangle,
    ArrowRight,
    QrCode,
} from 'lucide-react';
import api from '../api';
import { useLocale } from '../context/LocaleContext';
import { BitcoinIcon } from '../components/subscription/CheckoutFlow';

interface PublicCryptoSlip {
    reference: string;
    tier: string;
    cycle: string;
    fiatAmountUsd: number;
    fiatCurrency: string;
    cryptoAmount: string;
    cryptoCurrency: string;
    displayName: string;
    network: string;
    iconUrl?: string | null;
    walletAddress: string;
    payinExtraId?: string | null;
    qrCodeDataUrl: string;
    providerStatus: string;
    subscriptionStatus?: string | null;
    expiresAt?: string | null;
}

export const CryptoPaySlip = () => {
    const { reference } = useParams<{ reference: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { locale } = useLocale();
    const isEn = locale === 'en';

    const sig = searchParams.get('sig') || '';
    const autoCopyRequested = searchParams.get('copy') === '1';

    const [slip, setSlip] = useState<PublicCryptoSlip | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copiedField, setCopiedField] = useState<'wallet' | 'amount' | 'extra' | null>(null);
    const [autoCopied, setAutoCopied] = useState(false);
    const autoCopyAttempted = useRef(false);

    useEffect(() => {
        if (!reference || !sig) {
            setError(
                isEn
                    ? 'Invalid or expired crypto payment verification link.'
                    : 'Link de verificação de pagamento cripto inválido ou expirado.',
            );
            setLoading(false);
            return;
        }

        let mounted = true;
        api.get(`/payment/crypto-slip/${encodeURIComponent(reference)}`, {
            params: { sig },
        })
            .then((res) => {
                if (!mounted) return;
                setSlip(res.data);
            })
            .catch((err) => {
                if (!mounted) return;
                setError(
                    err?.response?.data?.message ||
                        (isEn
                            ? 'Could not verify this crypto payment slip.'
                            : 'Não foi possível validar os dados desta carteira de pagamento.'),
                );
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [reference, sig, isEn]);

    useEffect(() => {
        if (!autoCopyRequested || autoCopyAttempted.current || !slip?.walletAddress) return;
        autoCopyAttempted.current = true;
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            navigator.clipboard
                .writeText(slip.walletAddress)
                .then(() => {
                    setAutoCopied(true);
                    setCopiedField('wallet');
                })
                .catch(() => {});
        }
    }, [autoCopyRequested, slip?.walletAddress]);

    const handleCopy = async (value: string, field: 'wallet' | 'amount' | 'extra') => {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            const el = document.createElement('textarea');
            el.value = value;
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        }
        setCopiedField(field);
        window.setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 2500);
    };

    if (loading) {
        return (
            <div className="theme-light min-h-screen bg-white flex items-center justify-center p-6">
                <div className="flex flex-col items-center gap-3 text-slate-600">
                    <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
                    <span className="text-xs font-bold uppercase tracking-widest">
                        {isEn ? 'Verifying Wallet...' : 'Validando Carteira...'}
                    </span>
                </div>
            </div>
        );
    }

    if (error || !slip) {
        return (
            <div className="theme-light min-h-screen bg-white flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-5 shadow-xl">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-500">
                        <AlertTriangle size={28} />
                    </div>
                    <h1 className="text-lg font-black text-slate-900">
                        {isEn ? 'Invalid Payment Link' : 'Link de Pagamento Inválido'}
                    </h1>
                    <p className="text-xs text-slate-600 leading-relaxed">{error}</p>
                    <button
                        type="button"
                        onClick={() => navigate('/dashboard')}
                        className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                    >
                        {isEn ? 'Go to Dashboard' : 'Ir para o Painel'}
                    </button>
                </div>
            </div>
        );
    }

    const isPaid =
        slip.subscriptionStatus === 'ACTIVE' ||
        ['finished', 'confirmed', 'sending'].includes((slip.providerStatus || '').toLowerCase());

    return (
        <div className="theme-light min-h-screen bg-white text-slate-900 flex items-center justify-center p-4 sm:p-8">
            <div className="max-w-lg w-full bg-white border border-slate-200 rounded-[28px] p-6 sm:p-8 shadow-2xl space-y-6">
                {/* Brand Header */}
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
                    <div className="flex items-center gap-2.5">
                        <BitcoinIcon size={28} />
                        <div>
                            <div className="text-xs font-black tracking-wider uppercase text-slate-900">
                                TOREX <span className="text-emerald-600">JOURNAL</span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-semibold">
                                {isEn ? 'Verified Crypto Deposit Slip' : 'Carteira Cripto Verificada'}
                            </div>
                        </div>
                    </div>
                    <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                            isPaid
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                    >
                        {isPaid ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                        {isPaid
                            ? isEn
                                ? 'Confirmed'
                                : 'Confirmado'
                            : isEn
                              ? 'Awaiting Deposit'
                              : 'Aguardando Depósito'}
                    </span>
                </div>

                {autoCopied && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2 text-xs font-semibold text-emerald-800">
                        <CheckCircle2 size={15} className="shrink-0" />
                        <span>
                            {isEn
                                ? 'Wallet ID automatically copied to clipboard!'
                                : 'ID da carteira copiado automaticamente!'}
                        </span>
                    </div>
                )}

                {/* QR Code */}
                <div className="flex flex-col items-center text-center space-y-2.5">
                    <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-md">
                        <img
                            src={slip.qrCodeDataUrl}
                            alt={`QR Code ${slip.cryptoCurrency}`}
                            className="w-48 h-48 object-contain block"
                        />
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        <QrCode size={13} className="text-amber-500" />
                        <span>
                            {slip.displayName} · {slip.network}
                        </span>
                    </div>
                </div>

                {/* Amount */}
                <div className="flex items-center justify-between gap-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            {isEn ? 'Exact Amount to Send' : 'Valor Exato a Enviar'}
                        </div>
                        <div className="font-mono text-lg font-black text-slate-900 select-all">
                            {slip.cryptoAmount}{' '}
                            <span className="text-amber-600 text-xs">
                                {slip.cryptoCurrency}
                            </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                            ≈ ${Number(slip.fiatAmountUsd).toFixed(2)} USD · {slip.tier}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleCopy(String(slip.cryptoAmount), 'amount')}
                        className="px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-xs font-bold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                        {copiedField === 'amount' ? (
                            <Check size={13} className="text-emerald-600" />
                        ) : (
                            <Copy size={13} />
                        )}
                        <span>
                            {copiedField === 'amount'
                                ? isEn
                                    ? 'Copied'
                                    : 'Copiado'
                                : isEn
                                  ? 'Copy'
                                  : 'Copiar'}
                        </span>
                    </button>
                </div>

                {/* Wallet ID + Primary Copy Button */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-indigo-200 space-y-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {isEn ? 'Payment Wallet ID' : 'ID da Carteira de Pagamento'}
                    </div>
                    <div className="font-mono text-xs sm:text-sm font-bold text-slate-900 break-all select-all leading-relaxed bg-white p-3 rounded-xl border border-slate-200">
                        {slip.walletAddress}
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleCopy(slip.walletAddress, 'wallet')}
                        className={`w-full h-12 rounded-xl font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-all cursor-pointer ${
                            copiedField === 'wallet'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white shadow-lg shadow-amber-500/20'
                        }`}
                    >
                        {copiedField === 'wallet' ? <Check size={16} /> : <Copy size={16} />}
                        <span>
                            {copiedField === 'wallet'
                                ? isEn
                                    ? 'Wallet ID Copied!'
                                    : 'ID da Carteira Copiado!'
                                : isEn
                                  ? 'Copy Wallet ID'
                                  : 'Copiar ID da Carteira'}
                        </span>
                    </button>
                </div>

                {slip.payinExtraId && (
                    <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-wider text-amber-700">
                                Memo / Destination Tag
                            </div>
                            <div className="font-mono text-xs font-bold text-slate-900 break-all select-all">
                                {slip.payinExtraId}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => void handleCopy(slip.payinExtraId || '', 'extra')}
                            className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                            {copiedField === 'extra' ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copiedField === 'extra' ? 'OK' : isEn ? 'Copy' : 'Copiar'}</span>
                        </button>
                    </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck size={14} className="text-emerald-600" />
                        <span>Ref: {slip.reference}</span>
                    </span>
                    <button
                        type="button"
                        onClick={() =>
                            navigate(`/checkout?cryptoRef=${encodeURIComponent(slip.reference)}`)
                        }
                        className="inline-flex items-center gap-1 font-bold text-indigo-600 hover:underline cursor-pointer"
                    >
                        <span>{isEn ? 'Open Full Checkout' : 'Abrir no Checkout'}</span>
                        <ArrowRight size={13} />
                    </button>
                </div>
            </div>
        </div>
    );
};
