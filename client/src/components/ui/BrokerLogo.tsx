import { useState } from 'react';
import { Mt5BrokerGroup } from '../../constants/mt5ServersCatalog';

interface BrokerLogoProps {
    broker: Pick<Mt5BrokerGroup, 'broker' | 'domain' | 'logoUrl' | 'brandColor' | 'shortMark'>;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    className?: string;
}

export const BrokerLogo = ({ broker, size = 'md', className = '' }: BrokerLogoProps) => {
    const [imgStep, setImgStep] = useState<'primary' | 'secondary' | 'fallback'>('primary');

    const sizeClasses = {
        xs: 'w-4 h-4 rounded text-[8px]',
        sm: 'w-6 h-6 rounded-md text-[10px]',
        md: 'w-8 h-8 rounded-lg text-xs',
        lg: 'w-10 h-10 rounded-xl text-sm',
    }[size];

    const imgPadding = {
        xs: 'p-0.5',
        sm: 'p-1',
        md: 'p-1',
        lg: 'p-1.5',
    }[size];

    const currentSrc =
        imgStep === 'primary'
            ? broker.logoUrl
            : imgStep === 'secondary'
                ? `https://icons.duckduckgo.com/ip3/${broker.domain}.ico`
                : null;

    if (!currentSrc) {
        return (
            <div
                className={`${sizeClasses} shrink-0 flex items-center justify-center font-extrabold tracking-tight border select-none ${className}`}
                style={{
                    backgroundColor: `${broker.brandColor}20`,
                    borderColor: `${broker.brandColor}50`,
                    color: broker.brandColor,
                }}
                title={broker.broker}
            >
                {broker.shortMark}
            </div>
        );
    }

    return (
        <div
            className={`${sizeClasses} ${imgPadding} shrink-0 flex items-center justify-center bg-[#181B24] border border-white/[0.1] overflow-hidden shadow-sm ${className}`}
            style={{
                borderColor: `${broker.brandColor}35`,
            }}
            title={broker.broker}
        >
            <img
                src={currentSrc}
                alt={broker.broker}
                loading="lazy"
                onError={() => {
                    setImgStep((prev) => (prev === 'primary' ? 'secondary' : 'fallback'));
                }}
                className="w-full h-full object-contain rounded-sm"
            />
        </div>
    );
};
