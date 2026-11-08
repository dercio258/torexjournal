import { Logo } from '../ui/Logo';
import { FOOTER } from './content';
import { SmartLink } from './primitives';

export const LandingFooter = () => (
    <footer className="relative z-10 mt-auto border-t border-line bg-raised px-4 pb-12 pt-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
            <div className="mb-12 grid grid-cols-1 gap-10 md:grid-cols-4">
                <div className="md:col-span-2">
                    <Logo size="sm" className="mb-4" />
                    <p className="max-w-sm text-sm leading-relaxed text-fg-subtle">{FOOTER.tagline}</p>
                </div>

                {FOOTER.columns.map((col) => (
                    <nav key={col.title} aria-label={col.title}>
                        <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-fg">{col.title}</h2>
                        <ul className="space-y-2.5 text-sm text-fg-muted">
                            {col.links.map((link) => (
                                <li key={link.href}>
                                    <SmartLink href={link.href} className="transition-colors hover:text-accent-fg">
                                        {link.label}
                                    </SmartLink>
                                </li>
                            ))}
                        </ul>
                    </nav>
                ))}
            </div>

            <div className="flex flex-col items-center justify-between gap-4 border-t border-line pt-8 text-xs text-fg-subtle sm:flex-row">
                <p>© {new Date().getFullYear()} TOREX JOURNAL. Todos os direitos reservados.</p>
                <p className="font-mono text-[11px]">Alta Performance • Consistência • Disciplina</p>
            </div>
        </div>
    </footer>
);
