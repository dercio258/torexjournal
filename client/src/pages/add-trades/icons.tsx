import { useState } from 'react';

export const DERIV_LOGO_URL = 'https://www.google.com/s2/favicons?domain=deriv.com&sz=128';
export const MT5_LOGO_URL = 'https://www.google.com/s2/favicons?domain=metatrader5.com&sz=128';
const MT5_FALLBACK_URL = 'https://icons.duckduckgo.com/ip3/metatrader5.com.ico';

export const DerivIcon = ({ className = 'w-6 h-6' }: { className?: string }) => (
    <img
        src={DERIV_LOGO_URL}
        alt="Deriv"
        loading="lazy"
        className={`${className} object-contain rounded`}
    />
);

export const Mt5Icon = ({ className = 'w-6 h-6' }: { className?: string }) => {
    const [step, setStep] = useState<'primary' | 'secondary' | 'text'>('primary');

    if (step === 'text') {
        return (
            <span className="text-[11px] font-extrabold tracking-tight text-sky-500 select-none">
                MT5
            </span>
        );
    }

    return (
        <img
            src={step === 'primary' ? MT5_LOGO_URL : MT5_FALLBACK_URL}
            alt="MetaTrader 5"
            loading="lazy"
            onError={() => setStep((prev) => (prev === 'primary' ? 'secondary' : 'text'))}
            className={`${className} object-contain rounded`}
        />
    );
};
