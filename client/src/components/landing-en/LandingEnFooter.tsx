import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Logo } from '../ui/Logo';
import { SmartLink } from '../landing/primitives';
import { useLocale } from '../../context/LocaleContext';
import { cn } from '../../lib/cn';
import { EN_FOOTER, type EnFooterLink } from './contentEn';
import { openCookiePreferencesModal } from '../../lib/cookieConsent';

const FooterLinkItem: React.FC<{ link: EnFooterLink }> = ({ link }) => {
    const baseClasses =
        'group inline-flex items-center gap-1 text-[13px] font-medium text-slate-400 transition-colors hover:text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded';

    if (link.external) {
        const isHttp = link.href.startsWith('http');
        return (
            <a
                href={link.href}
                target={isHttp ? '_blank' : undefined}
                rel={isHttp ? 'noopener noreferrer' : undefined}
                className={baseClasses}
            >
                <span>{link.label}</span>
                <ArrowUpRight
                    size={12}
                    aria-hidden="true"
                    className="opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
                />
            </a>
        );
    }

    return (
        <SmartLink
            href={link.href}
            ctaTag={`lp_en_footer_${link.href.replace(/[^a-z0-9]/gi, '_')}`}
            intent="footer_navigation"
            className={baseClasses}
        >
            <span>{link.label}</span>
        </SmartLink>
    );
};

export const LandingEnFooter: React.FC = () => {
    const { locale, setLocale } = useLocale();
    const currentYear = new Date().getFullYear();

    return (
        <footer
            id="company-footer"
            aria-label="Torex Journal Footer"
            className="relative z-20 mt-auto overflow-hidden bg-[#02040A] px-4 pb-12 pt-16 sm:px-6 lg:px-8"
        >
            {/* Luminous top hairline divider */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent sm:inset-x-6 lg:inset-x-8"
            />

            {/* Subtle bottom obsidian/emerald ambient glow */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-32 left-1/2 h-64 w-[540px] -translate-x-1/2 rounded-full opacity-20 blur-[120px]"
                style={{
                    background:
                        'radial-gradient(circle, rgba(16, 185, 129, 0.35) 0%, rgba(14, 165, 233, 0.16) 55%, transparent 78%)',
                }}
            />

            <div className="relative mx-auto max-w-7xl">
                <div className="grid grid-cols-2 gap-x-8 gap-y-10 pb-14 lg:grid-cols-12">
                    {/* Brand & Trust Column */}
                    <div className="col-span-2 flex flex-col items-start lg:col-span-4">
                        <Logo
                            to={EN_FOOTER.homeHref}
                            ariaLabel={EN_FOOTER.logoAriaLabel}
                            size="sm"
                        />

                        <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-slate-400">
                            {EN_FOOTER.tagline}
                        </p>

                        {/* Live Operational Pill */}
                        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-1 font-mono text-[10.5px] font-medium text-emerald-300/90">
                            <span
                                aria-hidden="true"
                                className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                            />
                            <span>{EN_FOOTER.statusBadge}</span>
                        </div>

                        {/* Language Switcher */}
                        <div
                            role="group"
                            aria-label="Language selection"
                            className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-slate-500"
                        >
                            <button
                                type="button"
                                data-cta-tag="lp_en_footer_lang_en"
                                data-intent="switch_locale_en"
                                onClick={() => setLocale('en')}
                                className={cn(
                                    'cursor-pointer rounded px-1 py-0.5 transition-colors hover:text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                                    locale === 'en' && 'text-accent-fg'
                                )}
                            >
                                English
                            </button>
                            <span aria-hidden="true" className="text-slate-700">
                                •
                            </span>
                            <button
                                type="button"
                                data-cta-tag="lp_en_footer_lang_pt"
                                data-intent="switch_locale_pt"
                                onClick={() => setLocale('pt')}
                                className={cn(
                                    'cursor-pointer rounded px-1 py-0.5 transition-colors hover:text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                                    locale === 'pt' && 'text-accent-fg'
                                )}
                            >
                                Português
                            </button>
                            <span aria-hidden="true" className="text-slate-700">
                                •
                            </span>
                            <button
                                type="button"
                                data-cta-tag="lp_en_footer_cookies"
                                data-intent="cookie_preferences"
                                onClick={openCookiePreferencesModal}
                                className="cursor-pointer rounded px-1 py-0.5 transition-colors hover:text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                            >
                                Cookie Settings
                            </button>
                        </div>
                    </div>

                    {/* 4 Institutional Navigation Columns */}
                    <div className="col-span-2 grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4 lg:col-span-8">
                        {EN_FOOTER.columns.map((col) => (
                            <nav
                                key={col.title}
                                id={col.id}
                                aria-label={col.title}
                                className="scroll-mt-24"
                            >
                                <h2 className="mb-4 font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-300">
                                    {col.title}
                                </h2>
                                <ul className="space-y-2.5">
                                    {col.links.map((link) => (
                                        <li key={`${col.title}-${link.label}`}>
                                            <FooterLinkItem link={link} />
                                        </li>
                                    ))}
                                </ul>
                            </nav>
                        ))}
                    </div>
                </div>

                {/* Bottom Copyright & Motto Bar */}
                <div className="flex flex-col items-center justify-between gap-3 border-t border-white/[0.07] pt-8 text-xs text-slate-500 sm:flex-row">
                    <p>
                        © {currentYear} TOREX JOURNAL. {EN_FOOTER.rightsReserved}
                    </p>
                    <p className="font-mono text-[11px] tracking-wide text-slate-400">
                        {EN_FOOTER.motto}
                    </p>
                </div>
            </div>
        </footer>
    );
};

export default LandingEnFooter;
