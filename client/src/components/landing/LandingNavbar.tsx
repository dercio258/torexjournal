import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Menu, X } from 'lucide-react';
import { Logo } from '../ui/Logo';
import { buttonVariants } from '../ui/Button';
import { cn } from '../../lib/cn';
import { NAV_LINKS } from './content';
import { SmartLink } from './primitives';

const NavBadge = ({ children }: { children: string }) => (
    <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-fg">
        {children}
    </span>
);

export const LandingNavbar = () => {
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        if (!menuOpen) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
        const onResize = () => window.innerWidth >= 768 && setMenuOpen(false);
        window.addEventListener('keydown', onKey);
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onResize);
        };
    }, [menuOpen]);

    const close = () => setMenuOpen(false);
    const solid = scrolled || menuOpen;

    return (
        <nav
            aria-label="Principal"
            className={cn(
                'fixed inset-x-0 top-0 z-50 transition-all duration-300',
                solid ? 'border-b border-line bg-canvas/90 py-3 shadow-panel backdrop-blur-xl' : 'bg-transparent py-5'
            )}
        >
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                <Logo to="/" size="sm" />

                <ul className="hidden items-center gap-8 text-sm font-medium text-fg-muted md:flex">
                    {NAV_LINKS.map((link) => (
                        <li key={link.href}>
                            <SmartLink href={link.href} className="flex items-center gap-1.5 transition-colors hover:text-accent-fg">
                                {link.label}
                                {link.badge && <NavBadge>{link.badge}</NavBadge>}
                            </SmartLink>
                        </li>
                    ))}
                </ul>

                <div className="hidden items-center gap-3 md:flex">
                    <Link to="/login" className={buttonVariants({ variant: 'ghost', className: 'font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg' })}>
                        Entrar
                    </Link>
                    <Link to="/register" className={buttonVariants({ variant: 'brand', pill: true, className: 'px-5' })}>
                        Começar agora <ChevronRight size={15} strokeWidth={2.5} aria-hidden />
                    </Link>
                </div>

                <button
                    type="button"
                    className="rounded-lg border border-line bg-surface p-2 text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 md:hidden"
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-expanded={menuOpen}
                    aria-controls="landing-mobile-menu"
                    aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
                >
                    {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
                </button>
            </div>

            {menuOpen && (
                <div
                    id="landing-mobile-menu"
                    className="absolute left-0 top-full flex w-full flex-col gap-1 border-b border-line bg-raised p-5 shadow-panel animate-fade-in-up md:hidden"
                >
                    {NAV_LINKS.map((link) => (
                        <SmartLink
                            key={link.href}
                            href={link.href}
                            onClick={close}
                            className="flex items-center justify-between rounded-lg px-2 py-2.5 text-sm font-medium text-fg-muted hover:bg-surface hover:text-accent-fg"
                        >
                            {link.label}
                            {link.badge && <NavBadge>{link.badge}</NavBadge>}
                        </SmartLink>
                    ))}
                    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-4">
                        <Link to="/login" onClick={close} className={buttonVariants({ variant: 'outline', fullWidth: true, className: 'font-semibold text-fg' })}>
                            Entrar
                        </Link>
                        <Link to="/register" onClick={close} className={buttonVariants({ variant: 'brand', pill: true, fullWidth: true, className: 'py-2.5' })}>
                            Começar grátis
                        </Link>
                    </div>
                </div>
            )}
        </nav>
    );
};
