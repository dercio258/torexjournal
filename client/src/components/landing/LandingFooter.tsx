import { Logo } from '../ui/Logo';
import { cn } from '../../lib/cn';
import { useLocale } from '../../context/LocaleContext';
import { getLandingContent, type LandingLocale } from './content';
import { SmartLink } from './primitives';
import { openCookiePreferencesModal } from '../../lib/cookieConsent';

export const LandingFooter = ({ locale = 'pt' }: { locale?: LandingLocale }) => {
    const { setLocale } = useLocale();
    const { footer, navbar } = getLandingContent(locale);

    return (
        <footer className="relative z-10 mt-auto border-t border-line bg-raised px-4 pb-12 pt-16 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-12 grid grid-cols-1 gap-10 md:grid-cols-4">
                    <div className="md:col-span-2">
                        <Logo to={navbar.homeHref} ariaLabel={navbar.logoAriaLabel} size="sm" className="mb-4" />
                        <p className="max-w-sm text-sm leading-relaxed text-fg-subtle">{footer.tagline}</p>
                        <div className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-fg-subtle">
                            <button
                                type="button"
                                data-cta-tag="lp_pt_footer_lang_pt"
                                data-intent="switch_locale_pt"
                                onClick={() => setLocale('pt')}
                                className={cn(
                                    'cursor-pointer transition-colors hover:text-accent-fg',
                                    locale === 'pt' && 'text-accent-fg'
                                )}
                            >
                                Português
                            </button>
                            <span aria-hidden>•</span>
                            <button
                                type="button"
                                data-cta-tag="lp_pt_footer_lang_en"
                                data-intent="switch_locale_en"
                                onClick={() => setLocale('en')}
                                className={cn(
                                    'cursor-pointer transition-colors hover:text-accent-fg',
                                    locale === 'en' && 'text-accent-fg'
                                )}
                            >
                                English
                            </button>
                            <span aria-hidden>•</span>
                            <button
                                type="button"
                                data-cta-tag="lp_pt_footer_cookies"
                                data-intent="cookie_preferences"
                                onClick={openCookiePreferencesModal}
                                className="cursor-pointer transition-colors hover:text-accent-fg"
                            >
                                {locale === 'en' ? 'Cookie Settings' : 'Gerir Cookies'}
                            </button>
                        </div>
                    </div>

                    {footer.columns.map((col) => (
                        <nav key={col.title} aria-label={col.title}>
                            <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-fg">{col.title}</h2>
                            <ul className="space-y-2.5 text-sm text-fg-muted">
                                {col.links.map((link) => (
                                    <li key={link.href}>
                                        <SmartLink
                                            href={link.href}
                                            ctaTag={`lp_pt_footer_${link.href.replace(/[^a-z0-9]/gi, '_')}`}
                                            intent="footer_navigation"
                                            className="transition-colors hover:text-accent-fg"
                                        >
                                            {link.label}
                                        </SmartLink>
                                    </li>
                                ))}
                            </ul>
                        </nav>
                    ))}
                </div>

                <div className="flex flex-col items-center justify-between gap-4 border-t border-line pt-8 text-xs text-fg-subtle sm:flex-row">
                    <p>
                        © {new Date().getFullYear()} TOREX JOURNAL. {footer.rightsReserved}
                    </p>
                    <p className="font-mono text-[11px]">{footer.motto}</p>
                </div>
            </div>
        </footer>
    );
};
