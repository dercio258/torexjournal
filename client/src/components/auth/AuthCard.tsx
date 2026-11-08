import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '../ui/Logo';

interface AuthCardProps {
    title: string;
    description?: React.ReactNode;
    /** Header visual. Defaults to the brand mark. */
    icon?: React.ReactNode;
    /** Optional "back" link shown above the header. */
    back?: { to: string; label: string };
    children: React.ReactNode;
    /** Content under the card body (e.g. "Já tem conta?"). */
    footer?: React.ReactNode;
    /** Terms/privacy note under the card. Hide when the form has its own consent checkbox. */
    showLegalNote?: boolean;
}

/** Icon-in-a-tile used for secondary auth steps (recovery, 2FA). */
export const AuthIcon = ({ children }: { children: React.ReactNode }) => (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent-fg">
        {children}
    </div>
);

export const AuthCard = ({ title, description, icon, back, children, footer, showLegalNote = true }: AuthCardProps) => (
    <>
        <section
            aria-labelledby="auth-card-title"
            className="relative rounded-panel border border-line bg-raised/85 p-8 shadow-panel backdrop-blur-2xl md:p-10"
        >
            <div aria-hidden className="pointer-events-none absolute -inset-0.5 -z-10 rounded-panel bg-gradient-to-b from-accent/25 to-teal-500/5 opacity-60 blur-sm" />

            {back && (
                <Link
                    to={back.to}
                    className="mb-6 inline-flex items-center gap-2 rounded text-xs font-semibold text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                    <ArrowLeft size={14} aria-hidden /> {back.label}
                </Link>
            )}

            <header className="mb-8 flex flex-col items-center text-center">
                <div className="mb-4">{icon ?? <Logo withWordmark={false} size="md" />}</div>
                <h1 id="auth-card-title" className="text-2xl font-extrabold tracking-tight text-fg">
                    {title}
                </h1>
                {description && <p className="mt-2 text-sm leading-relaxed text-fg-muted">{description}</p>}
            </header>

            {children}

            {footer && <div className="mt-7 text-center text-sm text-fg-muted">{footer}</div>}
        </section>

        {showLegalNote && (
        <p className="mt-8 text-center text-xs leading-relaxed text-fg-subtle">
            Ao continuar, você concorda com os{' '}
            <Link to="/terms" className="underline-offset-2 hover:text-fg-muted hover:underline">
                Termos de Uso
            </Link>{' '}
            e a{' '}
            <Link to="/privacy" className="underline-offset-2 hover:text-fg-muted hover:underline">
                Política de Privacidade
            </Link>{' '}
            do TOREX JOURNAL.
        </p>
        )}
    </>
);
