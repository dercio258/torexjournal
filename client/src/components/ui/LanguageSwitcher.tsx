import React from 'react';
import { Globe } from 'lucide-react';
import { AppLocale, useLocale } from '../../context/LocaleContext';
import { cn } from '../../lib/cn';

interface LanguageSwitcherProps {
    variant?: 'pill' | 'compact' | 'menu' | 'form';
    className?: string;
    ariaLabel?: string;
    onSwitched?: (next: AppLocale) => void;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
    variant = 'pill',
    className,
    ariaLabel = 'Selecionar idioma / Select language',
    onSwitched,
}) => {
    const { locale, setLocale } = useLocale();

    const handleSelect = (next: AppLocale) => {
        if (next === locale) {
            onSwitched?.(next);
            return;
        }
        setLocale(next);
        onSwitched?.(next);
    };

    if (variant === 'form') {
        const label = locale === 'en' ? 'Language' : 'Idioma';
        return (
            <div className={cn('space-y-1.5', className)}>
                <span className="block text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    {label}
                </span>
                <div
                    role="group"
                    aria-label={ariaLabel}
                    className="grid grid-cols-2 gap-1.5 rounded-control border border-line bg-canvas/80 p-1.5"
                >
                    <button
                        type="button"
                        onClick={() => handleSelect('pt')}
                        aria-pressed={locale === 'pt'}
                        className={cn(
                            'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all cursor-pointer',
                            locale === 'pt'
                                ? 'border-accent/35 bg-accent/15 text-accent-fg shadow-sm'
                                : 'border-transparent text-fg-muted hover:bg-surface/60 hover:text-fg'
                        )}
                    >
                        <Globe size={14} aria-hidden className={locale === 'pt' ? 'text-accent-fg' : 'text-fg-subtle'} />
                        <span>Português</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => handleSelect('en')}
                        aria-pressed={locale === 'en'}
                        className={cn(
                            'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all cursor-pointer',
                            locale === 'en'
                                ? 'border-accent/35 bg-accent/15 text-accent-fg shadow-sm'
                                : 'border-transparent text-fg-muted hover:bg-surface/60 hover:text-fg'
                        )}
                    >
                        <Globe size={14} aria-hidden className={locale === 'en' ? 'text-accent-fg' : 'text-fg-subtle'} />
                        <span>English</span>
                    </button>
                </div>
            </div>
        );
    }

    if (variant === 'menu') {
        return (
            <div
                role="group"
                aria-label={ariaLabel}
                className={cn(
                    'flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-fg-muted',
                    className
                )}
            >
                <span className="inline-flex items-center gap-2.5">
                    <Globe size={15} className="text-fg-subtle" />
                    <span>{locale === 'en' ? 'Language' : 'Idioma'}</span>
                </span>
                <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-canvas-subtle p-0.5 text-[11px] font-bold">
                    <button
                        type="button"
                        onClick={() => handleSelect('pt')}
                        aria-pressed={locale === 'pt'}
                        className={cn(
                            'px-2 py-0.5 rounded-md transition-colors cursor-pointer',
                            locale === 'pt'
                                ? 'bg-accent/15 text-accent-fg'
                                : 'text-fg-muted hover:text-fg'
                        )}
                    >
                        PT
                    </button>
                    <button
                        type="button"
                        onClick={() => handleSelect('en')}
                        aria-pressed={locale === 'en'}
                        className={cn(
                            'px-2 py-0.5 rounded-md transition-colors cursor-pointer',
                            locale === 'en'
                                ? 'bg-accent/15 text-accent-fg'
                                : 'text-fg-muted hover:text-fg'
                        )}
                    >
                        EN
                    </button>
                </div>
            </div>
        );
    }

    if (variant === 'compact') {
        return (
            <div
                role="group"
                aria-label={ariaLabel}
                className={cn(
                    'inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface px-1 py-0.5 text-[10px] font-bold',
                    className
                )}
            >
                <button
                    type="button"
                    onClick={() => handleSelect('pt')}
                    aria-pressed={locale === 'pt'}
                    className={cn(
                        'px-1.5 py-0.5 rounded transition-colors cursor-pointer',
                        locale === 'pt'
                            ? 'bg-accent/15 text-accent-fg'
                            : 'text-fg-subtle hover:text-fg'
                    )}
                    title="Português"
                >
                    PT
                </button>
                <button
                    type="button"
                    onClick={() => handleSelect('en')}
                    aria-pressed={locale === 'en'}
                    className={cn(
                        'px-1.5 py-0.5 rounded transition-colors cursor-pointer',
                        locale === 'en'
                            ? 'bg-accent/15 text-accent-fg'
                            : 'text-fg-subtle hover:text-fg'
                    )}
                    title="English"
                >
                    EN
                </button>
            </div>
        );
    }

    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className={cn(
                'inline-flex items-center gap-0.5 rounded-full border border-line bg-surface/80 p-0.5 text-[11px] font-bold backdrop-blur-md',
                className
            )}
        >
            <Globe size={12} aria-hidden className="ml-1.5 mr-0.5 text-fg-subtle" />
            <button
                type="button"
                onClick={() => handleSelect('pt')}
                aria-pressed={locale === 'pt'}
                className={cn(
                    'rounded-full px-2 py-0.5 transition-colors cursor-pointer',
                    locale === 'pt' ? 'bg-accent/15 text-accent-fg' : 'text-fg-muted hover:text-fg'
                )}
            >
                PT
            </button>
            <button
                type="button"
                onClick={() => handleSelect('en')}
                aria-pressed={locale === 'en'}
                className={cn(
                    'rounded-full px-2 py-0.5 transition-colors cursor-pointer',
                    locale === 'en' ? 'bg-accent/15 text-accent-fg' : 'text-fg-muted hover:text-fg'
                )}
            >
                EN
            </button>
        </div>
    );
};
