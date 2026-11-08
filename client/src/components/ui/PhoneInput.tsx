import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, Search } from 'lucide-react';
import { COUNTRIES, CountryDial, filterCountries, findCountry } from '../../constants/countries';
import { cn } from '../../lib/cn';

interface PhoneInputProps {
    label?: React.ReactNode;
    /** National number (without dial code). */
    value: string;
    onChange: (nationalNumber: string) => void;
    /** Called on mount with the default country and on every selection. */
    onCountryChange?: (country: CountryDial) => void;
    defaultCountry?: string;
    error?: string;
    hint?: React.ReactNode;
    placeholder?: string;
    name?: string;
}

const Flag = ({ country }: { country: CountryDial }) => (
    <img
        src={country.flagUrl}
        alt=""
        loading="lazy"
        className="h-3.5 w-5 shrink-0 rounded-sm object-cover"
        onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
    />
);

/** Phone field with a searchable, keyboard-navigable country selector (v2 tokens). */
export const PhoneInput = ({
    label,
    value,
    onChange,
    onCountryChange,
    defaultCountry = 'BR',
    error,
    hint,
    placeholder = '99999-9999',
    name,
}: PhoneInputProps) => {
    const id = useId();
    const listId = `${id}-list`;
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;

    const [country, setCountry] = useState<CountryDial>(() => findCountry(defaultCountry) ?? COUNTRIES[0]);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);

    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const results = useMemo(() => filterCountries(query), [query]);

    // Report the default country once so the parent's dial code matches the UI.
    useEffect(() => {
        onCountryChange?.(country);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [open]);

    useEffect(() => setActiveIndex(0), [query]);

    useEffect(() => {
        if (!open) return;
        listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, open]);

    const close = () => {
        setOpen(false);
        setQuery('');
        triggerRef.current?.focus();
    };

    const select = (c: CountryDial) => {
        setCountry(c);
        onCountryChange?.(c);
        close();
    };

    const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (results[activeIndex]) select(results[activeIndex]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    };

    return (
        <div ref={rootRef} className="group relative space-y-1.5">
            {label && (
                <label
                    htmlFor={id}
                    className={cn(
                        'block text-xs font-semibold uppercase tracking-wider text-fg-muted transition-colors group-focus-within:text-accent-fg',
                        error && 'text-danger-fg group-focus-within:text-danger-fg'
                    )}
                >
                    {label}
                </label>
            )}

            <div
                className={cn(
                    'relative flex items-stretch rounded-control border bg-canvas/80 transition-[border-color,box-shadow] duration-200',
                    error
                        ? 'border-danger/60 focus-within:shadow-focus-danger'
                        : 'border-line hover:border-line-strong focus-within:border-accent/60 focus-within:shadow-focus-accent'
                )}
            >
                <button
                    ref={triggerRef}
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-controls={open ? listId : undefined}
                    aria-label={`País: ${country.name} (${country.dialCode}). Alterar país`}
                    className="flex min-w-[104px] shrink-0 items-center gap-2 rounded-l-control border-r border-line pl-4 pr-3 text-fg transition-colors hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                >
                    <Flag country={country} />
                    <span className="font-mono text-sm font-medium">{country.dialCode}</span>
                    <ChevronDown size={14} aria-hidden className={cn('text-fg-subtle transition-transform', open && 'rotate-180')} />
                </button>

                <input
                    id={id}
                    name={name}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    className="ds-control w-full min-w-0 bg-transparent px-4 py-3.5 text-sm font-medium text-fg outline-none placeholder:text-fg-subtle"
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value.replace(/[^\d\s()-]/g, ''))}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : hint ? hintId : undefined}
                />
            </div>

            {open && (
                <div className="absolute left-0 top-full z-50 mt-2 flex max-h-80 w-full max-w-xs flex-col overflow-hidden rounded-xl border border-line-strong bg-raised shadow-panel animate-fade-in-up">
                    <div className="border-b border-line p-2.5">
                        <div className="relative">
                            <Search size={14} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                            <input
                                type="text"
                                autoFocus
                                placeholder="Buscar país ou código..."
                                aria-label="Buscar país"
                                aria-controls={listId}
                                aria-activedescendant={results[activeIndex] ? `${id}-opt-${results[activeIndex].iso2}` : undefined}
                                className="ds-control w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/50"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={onSearchKeyDown}
                            />
                        </div>
                    </div>

                    <ul ref={listRef} id={listId} role="listbox" aria-label="Países" className="flex-1 overflow-y-auto p-1">
                        {results.map((c, i) => (
                            <li
                                key={c.iso2}
                                id={`${id}-opt-${c.iso2}`}
                                role="option"
                                aria-selected={c.iso2 === country.iso2}
                                onMouseEnter={() => setActiveIndex(i)}
                                onClick={() => select(c)}
                                className={cn(
                                    'flex cursor-pointer items-center gap-3 rounded-lg p-2 text-left transition-colors',
                                    i === activeIndex && 'bg-surface',
                                    c.iso2 === country.iso2 && 'text-accent-fg'
                                )}
                            >
                                <Flag country={c} />
                                <span className="flex-1 truncate text-sm font-medium text-fg">{c.name}</span>
                                <span className="font-mono text-xs text-accent-fg">{c.dialCode}</span>
                            </li>
                        ))}
                        {results.length === 0 && <li className="p-4 text-center text-xs text-fg-subtle">Nenhum país encontrado</li>}
                    </ul>
                </div>
            )}

            {error ? (
                <p id={errorId} className="flex items-center gap-1.5 text-xs text-danger-fg animate-fade-in-up">
                    <AlertCircle size={12} aria-hidden className="shrink-0" />
                    <span>{error}</span>
                </p>
            ) : (
                hint && (
                    <p id={hintId} className="text-xs text-fg-subtle">
                        {hint}
                    </p>
                )
            )}
        </div>
    );
};
