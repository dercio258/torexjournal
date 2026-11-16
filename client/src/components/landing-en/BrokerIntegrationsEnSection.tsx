import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileSpreadsheet, Monitor } from 'lucide-react';
import { MT5_BROKERS_CATALOG, type Mt5BrokerGroup } from '../../constants/mt5ServersCatalog';
import { DERIV_LOGO_URL, MT5_LOGO_URL } from '../../pages/add-trades/icons';
import { EN_INTEGRATIONS } from './contentEn';
import { buildTaggedUrl } from '../../lib/attribution';

interface IntegrationTileItem {
    id: string;
    name: string;
    domain?: string;
    logoUrl?: string;
    brandColor: string;
    shortMark: string;
    customIcon?: React.ReactNode;
    href: string;
}

const CLEAN_BROKER_NAMES: Record<string, string> = {
    goatfunded: 'Goat Funded',
    the5ers: 'The5%ers',
    alphacapital: 'Alpha Capital',
    e8markets: 'E8 Markets',
    myfundedfx: 'MyFundedFX',
    cti: 'CTI Prop',
    hfm: 'HFM',
    xm: 'XM',
    vantage: 'Vantage',
    octafx: 'Octa',
    blackbull: 'BlackBull',
    admirals: 'Admirals',
    metaquotes: 'MetaQuotes',
};

const pickBrokerTile = (id: string): IntegrationTileItem | null => {
    const found: Mt5BrokerGroup | undefined = MT5_BROKERS_CATALOG.find((b) => b.id === id);
    if (!found) return null;
    const serverParam = found.servers[0]?.name ? `&server=${encodeURIComponent(found.servers[0].name)}` : '';
    return {
        id: found.id,
        name: CLEAN_BROKER_NAMES[found.id] || found.broker,
        domain: found.domain,
        logoUrl: found.logoUrl,
        brandColor: found.brandColor,
        shortMark: found.shortMark,
        href: `/add-trades/mt5-sync?broker=${encodeURIComponent(found.broker)}&brokerId=${encodeURIComponent(found.id)}${serverParam}`,
    };
};

/* Row 1: Native `/add-trades` connectors + Flagship Prop Firms */
const ROW_1_ITEMS: IntegrationTileItem[] = [
    {
        id: 'mt5-native',
        name: 'MetaTrader 5',
        domain: 'metatrader5.com',
        logoUrl: MT5_LOGO_URL,
        brandColor: '#38BDF8',
        shortMark: 'MT5',
        href: '/add-trades/mt5-sync',
    },
    {
        id: 'deriv-native',
        name: 'Deriv',
        domain: 'deriv.com',
        logoUrl: DERIV_LOGO_URL,
        brandColor: '#FF444F',
        shortMark: 'DV',
        href: '/add-trades/deriv-sync',
    },
    ...[
        'ftmo',
        'fundednext',
        'fundingpips',
        'the5ers',
        'goatfunded',
        'alphacapital',
        'e8markets',
        'fxify',
        'blueguardian',
        'maven',
    ]
        .map(pickBrokerTile)
        .filter((x): x is IntegrationTileItem => Boolean(x)),
    {
        id: 'pc-ea-connector',
        name: 'PC Connector',
        brandColor: '#10B981',
        shortMark: 'EA',
        customIcon: <Monitor size={20} className="text-emerald-400" />,
        href: '/add-trades/mt5-ea',
    },
    {
        id: 'file-import',
        name: 'CSV · XLSX · HTML',
        brandColor: '#34D399',
        shortMark: 'CSV',
        customIcon: <FileSpreadsheet size={20} className="text-emerald-400" />,
        href: '/add-trades/import',
    },
];

/* Row 2: Global Brokers (`Forex / ECN`) + Prop Firms */
const ROW_2_ITEMS: IntegrationTileItem[] = [
    'exness',
    'icmarkets',
    'pepperstone',
    'xm',
    'vantage',
    'hfm',
    'oanda',
    'tickmill',
    'eightcap',
    'fpmarkets',
    'blackbull',
    'myfundedfx',
    'instantfunding',
    'aquafunded',
    'brightfunded',
    'avatrade',
    'fxpro',
    'roboforex',
    'admirals',
]
    .map(pickBrokerTile)
    .filter((x): x is IntegrationTileItem => Boolean(x));

const HighlightedPlatformIcon: React.FC<{ item: IntegrationTileItem }> = ({ item }) => {
    const [imgStage, setImgStage] = useState<'primary' | 'secondary' | 'fallback'>('primary');

    if (item.customIcon) {
        return (
            <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-[#0D1322] shadow-inner transition-transform duration-300 group-hover:scale-105 sm:h-11 sm:w-11"
                style={{
                    borderColor: `${item.brandColor}45`,
                    boxShadow: `0 0 18px -6px ${item.brandColor}55`,
                }}
            >
                {item.customIcon}
            </div>
        );
    }

    const src =
        imgStage === 'primary'
            ? item.logoUrl
            : imgStage === 'secondary' && item.domain
              ? `https://icons.duckduckgo.com/ip3/${item.domain}.ico`
              : null;

    if (!src) {
        return (
            <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-extrabold tracking-tight transition-transform duration-300 group-hover:scale-105 sm:h-11 sm:w-11"
                style={{
                    backgroundColor: `${item.brandColor}1F`,
                    borderColor: `${item.brandColor}55`,
                    color: item.brandColor,
                    boxShadow: `0 0 18px -6px ${item.brandColor}55`,
                }}
            >
                {item.shortMark}
            </div>
        );
    }

    return (
        <div
            className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-[#0D1322] p-2 transition-transform duration-300 group-hover:scale-105 sm:h-11 sm:w-11"
            style={{
                borderColor: `${item.brandColor}45`,
                boxShadow: `0 0 18px -6px ${item.brandColor}50`,
            }}
        >
            <img
                src={src}
                alt={item.name}
                width={28}
                height={28}
                loading="lazy"
                decoding="async"
                onError={() => setImgStage((prev) => (prev === 'primary' ? 'secondary' : 'fallback'))}
                className="h-full w-full rounded-sm object-contain"
            />
        </div>
    );
};

const MarqueeRow: React.FC<{
    items: IntegrationTileItem[];
    reverse?: boolean;
    durationSec?: number;
    paused?: boolean;
}> = ({ items, reverse = false, durationSec = 42, paused = false }) => {
    const loopItems = [...items, ...items];

    return (
        <div className="group/track relative flex w-full overflow-hidden py-1">
            <div
                className="flex w-max shrink-0 items-center gap-3 sm:gap-3.5 group-hover/track:[animation-play-state:paused] motion-reduce:!animate-none"
                style={{
                    animation: `${reverse ? 'torexMarqueeRight' : 'torexMarqueeLeft'} ${durationSec}s linear infinite`,
                    animationPlayState: paused ? 'paused' : 'running',
                }}
            >
                {loopItems.map((item, idx) => {
                    const isDuplicate = idx >= items.length;
                    return (
                        <Link
                            key={`${item.id}-${idx}`}
                            to={buildTaggedUrl(item.href, {
                                ctaTag: `lp_en_broker_${item.id}`,
                                intent: `broker_${item.id}`,
                            })}
                            data-cta-tag={`lp_en_broker_${item.id}`}
                            data-intent={`broker_${item.id}`}
                            aria-label={isDuplicate ? undefined : item.name}
                            aria-hidden={isDuplicate || undefined}
                            tabIndex={isDuplicate ? -1 : undefined}
                            className="group flex shrink-0 items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#070B14]/95 px-3.5 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-[#0C1220] sm:px-4 sm:py-3"
                        >
                            <HighlightedPlatformIcon item={item} />
                            <span className="whitespace-nowrap text-xs font-bold tracking-tight text-slate-100 transition-colors group-hover:text-white sm:text-[13.5px]">
                                {item.name}
                            </span>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
};

export const BrokerIntegrationsEnSection: React.FC = () => {
    const sectionRef = useRef<HTMLElement>(null);
    const [isInView, setIsInView] = useState(true);

    useEffect(() => {
        const node = sectionRef.current;
        if (!node || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                setIsInView(entry.isIntersecting);
            },
            { rootMargin: '120px 0px' }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return (
        <section
            ref={sectionRef}
            id="supported-brokers"
            aria-label="80+ Trading Platform Integrations"
            className="relative z-20 mx-auto w-full max-w-7xl px-4 pb-24 pt-2 sm:px-6 lg:px-8"
        >
            <style>{`
                @keyframes torexMarqueeLeft {
                    0% { transform: translate3d(0, 0, 0); }
                    100% { transform: translate3d(-50%, 0, 0); }
                }
                @keyframes torexMarqueeRight {
                    0% { transform: translate3d(-50%, 0, 0); }
                    100% { transform: translate3d(0, 0, 0); }
                }
            `}</style>

            <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[#050811] px-5 py-8 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.85)] sm:px-8 sm:py-10 lg:px-10 lg:py-12">
                {/* Subtle left ambient glow */}
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -left-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full opacity-35 blur-3xl"
                    style={{
                        background:
                            'radial-gradient(circle, rgba(16, 185, 129, 0.28) 0%, rgba(37, 99, 235, 0.14) 55%, transparent 75%)',
                    }}
                />

                <div className="relative z-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-8">
                    {/* LEFT SIDE: 80+ Trading Platform Integrations (Minimal, No Heavy Copy) */}
                    <div className="flex flex-col items-start text-left lg:col-span-4">
                        <span className="inline-flex items-center rounded-md border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-accent-fg">
                            {EN_INTEGRATIONS.badge}
                        </span>

                        <h2 className="mt-3.5 text-2xl font-extrabold leading-[1.15] tracking-tight text-white sm:text-3xl lg:text-[34px]">
                            <span className="bg-gradient-to-r from-emerald-300 via-accent-fg to-teal-400 bg-clip-text text-transparent">
                                {EN_INTEGRATIONS.statHighlight}
                            </span>{' '}
                            {EN_INTEGRATIONS.headline}
                        </h2>

                        <Link
                            to={buildTaggedUrl(EN_INTEGRATIONS.ctaHref, {
                                ctaTag: 'lp_en_integrations_cta',
                                intent: 'broker_integrations',
                            })}
                            data-cta-tag="lp_en_integrations_cta"
                            data-intent="broker_integrations"
                            className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-xs font-bold tracking-wide text-white transition-all hover:border-accent/45 hover:bg-accent/15 hover:text-accent-fg"
                        >
                            <span>{EN_INTEGRATIONS.ctaLabel}</span>
                            <ArrowRight size={14} />
                        </Link>
                    </div>

                    {/* RIGHT SIDE: Highlighted Icon + Name Carousel (Brokers, Prop Firms & Add-Trades) */}
                    <div
                        className="relative min-w-0 space-y-3 lg:col-span-8"
                        style={{
                            maskImage:
                                'linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)',
                            WebkitMaskImage:
                                'linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)',
                        }}
                    >
                        <MarqueeRow items={ROW_1_ITEMS} durationSec={40} paused={!isInView} />
                        <MarqueeRow items={ROW_2_ITEMS} reverse durationSec={46} paused={!isInView} />
                    </div>
                </div>
            </div>
        </section>
    );
};

export default BrokerIntegrationsEnSection;
