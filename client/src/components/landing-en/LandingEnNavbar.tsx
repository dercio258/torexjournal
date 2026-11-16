import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, Menu, X } from 'lucide-react';
import { Logo } from '../ui/Logo';
import { buttonVariants } from '../ui/Button';
import { cn } from '../../lib/cn';
import { EN_NAVBAR } from './contentEn';
import { SmartLink } from '../landing/primitives';
import { buildTaggedUrl } from '../../lib/attribution';

export const LandingEnNavbar = () => {
    const [scrolled, setScrolled] = useState(false);
    const [productOpen, setProductOpen] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [mobileProductOpen, setMobileProductOpen] = useState(true);

    const dropdownRef = useRef<HTMLLIElement>(null);
    const closeTimerRef = useRef<number | null>(null);

    const clearCloseTimer = () => {
        if (closeTimerRef.current !== null) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    };

    const handleMouseEnterProduct = () => {
        clearCloseTimer();
        setProductOpen(true);
    };

    const handleMouseLeaveProduct = () => {
        clearCloseTimer();
        closeTimerRef.current = window.setTimeout(() => {
            setProductOpen(false);
        }, 140);
    };

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 16);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setProductOpen(false);
                setMobileOpen(false);
            }
        };
        const onPointerDown = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setProductOpen(false);
            }
        };
        const onResize = () => {
            if (window.innerWidth >= 1024) {
                setMobileOpen(false);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        document.addEventListener('mousedown', onPointerDown);
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('resize', onResize);
            clearCloseTimer();
        };
    }, []);

    const closeAll = () => {
        setProductOpen(false);
        setMobileOpen(false);
    };

    const solid = scrolled || mobileOpen || productOpen;

    return (
        <nav
            aria-label="Main navigation"
            className={cn(
                'fixed inset-x-0 top-0 z-50 transition-all duration-300',
                solid ? 'border-b border-line bg-canvas/90 py-3.5 shadow-panel backdrop-blur-xl' : 'bg-transparent py-5'
            )}
        >
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                {/* Brand Mark */}
                <Logo to={EN_NAVBAR.homeHref} ariaLabel={EN_NAVBAR.logoAriaLabel} size="sm" />

                {/* Navigation: Product (Dropdown), Tutorials, Company, Help Center */}
                <ul className="hidden items-center gap-8 text-sm font-medium text-fg-muted lg:flex">
                    {EN_NAVBAR.items.map((item) =>
                        item.hasProductDropdown ? (
                            <li
                                key={item.label}
                                ref={dropdownRef}
                                className="relative"
                                onMouseEnter={handleMouseEnterProduct}
                                onMouseLeave={handleMouseLeaveProduct}
                            >
                                <button
                                    type="button"
                                    aria-expanded={productOpen}
                                    aria-haspopup="true"
                                    onClick={() => setProductOpen((prev) => !prev)}
                                    className={cn(
                                        'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium transition-colors',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                                        productOpen ? 'text-accent-fg' : 'text-fg-muted hover:text-fg'
                                    )}
                                >
                                    {item.label}
                                    <ChevronDown
                                        size={15}
                                        aria-hidden
                                        className={cn('transition-transform duration-200', productOpen && 'rotate-180 text-accent-fg')}
                                    />
                                </button>

                                {/* Product Mega-Dropdown */}
                                {productOpen && (
                                    <div
                                        role="menu"
                                        aria-label="Product menu"
                                        className="absolute left-1/2 top-full mt-3 w-[600px] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-raised/95 p-2 shadow-panel backdrop-blur-2xl animate-fade-in-up"
                                    >
                                        <div className="grid grid-cols-12 gap-2">
                                            {/* Featured Product Capabilities */}
                                            <div className="col-span-7 flex flex-col gap-1 rounded-xl bg-surface/70 p-3">
                                                {EN_NAVBAR.productDropdown.featured.map((feat) => {
                                                    const Icon = feat.icon;
                                                    return (
                                                        <SmartLink
                                                            key={feat.title}
                                                            href={feat.href}
                                                            ctaTag={`lp_en_nav_feat_${feat.href.replace(/[^a-z0-9]/gi, '_')}`}
                                                            intent="explore_feature"
                                                            onClick={closeAll}
                                                            className="group flex items-start gap-3.5 rounded-xl p-2.5 transition-all hover:bg-surface-2"
                                                        >
                                                            <span
                                                                aria-hidden
                                                                className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent-fg transition-colors group-hover:border-accent/50 group-hover:bg-accent/20"
                                                            >
                                                                <Icon size={19} />
                                                            </span>
                                                            <span className="flex flex-col">
                                                                <span className="text-sm font-semibold text-fg transition-colors group-hover:text-accent-fg">
                                                                    {feat.title}
                                                                </span>
                                                                <span className="mt-0.5 text-xs leading-snug text-fg-muted">
                                                                    {feat.description}
                                                                </span>
                                                            </span>
                                                        </SmartLink>
                                                    );
                                                })}
                                            </div>

                                            {/* Quick Product Links: Pricing, Supported Brokers, What's New */}
                                            <div className="col-span-5 flex flex-col justify-center rounded-xl border border-line bg-canvas-subtle/70 p-3">
                                                <ul className="space-y-1.5">
                                                    {EN_NAVBAR.productDropdown.links.map((link) => {
                                                        const LinkIcon = link.icon;
                                                        return (
                                                            <li key={link.label}>
                                                                <SmartLink
                                                                    href={link.href}
                                                                    ctaTag={`lp_en_nav_quick_${link.href.replace(/[^a-z0-9]/gi, '_')}`}
                                                                    intent="nav_quick_link"
                                                                    onClick={closeAll}
                                                                    className="group flex items-center justify-between rounded-lg px-2.5 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg"
                                                                >
                                                                    <span className="flex items-center gap-2.5">
                                                                        <LinkIcon
                                                                            size={15}
                                                                            aria-hidden
                                                                            className="text-fg-subtle transition-colors group-hover:text-accent-fg"
                                                                        />
                                                                        {link.label}
                                                                    </span>
                                                                    {link.badge ? (
                                                                        <span className="rounded-full border border-accent/30 bg-accent/15 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-accent-fg">
                                                                            {link.badge}
                                                                        </span>
                                                                    ) : (
                                                                        <ArrowUpRight
                                                                            size={13}
                                                                            aria-hidden
                                                                            className="text-accent-fg opacity-0 transition-opacity group-hover:opacity-100"
                                                                        />
                                                                    )}
                                                                </SmartLink>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </li>
                        ) : (
                            <li key={item.label}>
                                <SmartLink
                                    href={item.href ?? '#'}
                                    ctaTag={`lp_en_nav_${(item.href ?? '#').replace(/[^a-z0-9]/gi, '_')}`}
                                    intent="nav_navigation"
                                    className="rounded-lg px-2 py-1.5 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                                >
                                    {item.label}
                                </SmartLink>
                            </li>
                        )
                    )}
                </ul>

                {/* Primary Navbar CTA */}
                <div className="hidden items-center lg:flex">
                    <Link
                        to={buildTaggedUrl(EN_NAVBAR.ctaHref, { ctaTag: 'lp_en_nav_cta', intent: 'signup' })}
                        data-cta-tag="lp_en_nav_cta"
                        data-intent="signup"
                        className={buttonVariants({
                            variant: 'brand',
                            pill: true,
                            className: 'px-6 py-2.5 text-xs font-extrabold uppercase tracking-wider',
                        })}
                    >
                        {EN_NAVBAR.ctaLabel}
                    </Link>
                </div>

                {/* Mobile Drawer Trigger */}
                <button
                    type="button"
                    className="rounded-lg border border-line bg-surface p-2 text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 lg:hidden"
                    onClick={() => setMobileOpen((o) => !o)}
                    aria-expanded={mobileOpen}
                    aria-controls="en-landing-mobile-menu"
                    aria-label={mobileOpen ? EN_NAVBAR.closeMenuAria : EN_NAVBAR.openMenuAria}
                >
                    {mobileOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
                </button>
            </div>

            {/* Mobile Responsive Menu */}
            {mobileOpen && (
                <div
                    id="en-landing-mobile-menu"
                    className="absolute left-0 top-full max-h-[calc(100vh-4rem)] w-full overflow-y-auto border-b border-line bg-raised p-5 shadow-panel animate-fade-in-up lg:hidden"
                >
                    <div className="flex flex-col gap-1.5">
                        {/* Mobile Product Accordion */}
                        <div className="rounded-xl border border-line bg-surface/60 p-2">
                            <button
                                type="button"
                                onClick={() => setMobileProductOpen((o) => !o)}
                                aria-expanded={mobileProductOpen}
                                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm font-semibold text-fg"
                            >
                                <span>Product</span>
                                <ChevronDown
                                    size={16}
                                    aria-hidden
                                    className={cn('text-fg-muted transition-transform', mobileProductOpen && 'rotate-180 text-accent-fg')}
                                />
                            </button>

                            {mobileProductOpen && (
                                <div className="mt-2 space-y-1 border-t border-line pt-2">
                                    {EN_NAVBAR.productDropdown.featured.map((feat) => {
                                        const Icon = feat.icon;
                                        return (
                                            <SmartLink
                                                key={feat.title}
                                                href={feat.href}
                                                onClick={closeAll}
                                                className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-surface-2"
                                            >
                                                <span
                                                    aria-hidden
                                                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent-fg"
                                                >
                                                    <Icon size={16} />
                                                </span>
                                                <span className="flex flex-col">
                                                    <span className="text-sm font-semibold text-fg">{feat.title}</span>
                                                    <span className="text-xs text-fg-muted">{feat.description}</span>
                                                </span>
                                            </SmartLink>
                                        );
                                    })}

                                    <div className="mt-2 grid grid-cols-1 gap-1 border-t border-line pt-2">
                                        {EN_NAVBAR.productDropdown.links.map((link) => {
                                            const LinkIcon = link.icon;
                                            return (
                                                <SmartLink
                                                    key={link.label}
                                                    href={link.href}
                                                    onClick={closeAll}
                                                    className="flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg"
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <LinkIcon size={14} aria-hidden className="text-accent-fg" />
                                                        {link.label}
                                                    </span>
                                                    {link.badge && (
                                                        <span className="rounded-full border border-accent/30 bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-accent-fg">
                                                            {link.badge}
                                                        </span>
                                                    )}
                                                </SmartLink>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        {EN_NAVBAR.items
                            .filter((i) => !i.hasProductDropdown)
                            .map((item) => (
                                <SmartLink
                                    key={item.label}
                                    href={item.href ?? '#'}
                                    ctaTag={`lp_en_mobile_nav_${(item.href ?? item.label).replace(/[^a-z0-9]/gi, '_')}`}
                                    intent="nav_navigation"
                                    onClick={closeAll}
                                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg"
                                >
                                    {item.label}
                                </SmartLink>
                            ))}

                        <div className="mt-3 border-t border-line pt-4">
                            <Link
                                to={buildTaggedUrl(EN_NAVBAR.ctaHref, { ctaTag: 'lp_en_mobile_nav_cta', intent: 'signup' })}
                                data-cta-tag="lp_en_mobile_nav_cta"
                                data-intent="signup"
                                onClick={closeAll}
                                className={buttonVariants({
                                    variant: 'brand',
                                    pill: true,
                                    fullWidth: true,
                                    className: 'py-2.5 text-xs font-extrabold uppercase tracking-wider',
                                })}
                            >
                                {EN_NAVBAR.ctaLabel}
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
};
