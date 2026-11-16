import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { getCurrentLocale } from '../../context/LocaleContext';

/* ------------------------------------------------------------------ format */

const CURRENCY_PREFIX: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    MZN: 'MT ',
};

export const fmtMoney = (v: number, opts: { sign?: boolean; decimals?: number; currency?: string } = {}) => {
    const d = opts.decimals ?? 2;
    const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const sign = v < 0 ? '−' : opts.sign && v > 0 ? '+' : '';
    const prefix = CURRENCY_PREFIX[opts.currency || 'USD'] ?? '$';
    return `${sign}${prefix}${abs}`;
};

export const fmtNum = (v: number, d = 2) =>
    v.toLocaleString(getCurrentLocale() === 'en' ? 'en-US' : 'pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** YYYY-MM-DD → dd/mm/yyyy (or MM/DD/YYYY in EN) without timezone drift. */
export const fmtIsoDate = (iso?: string) => {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    if (!(y && m && d)) return iso;
    return getCurrentLocale() === 'en' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
};

export const fmtDateTime = (ts?: number | string | null) => {
    if (ts === undefined || ts === null || ts === '') return '—';
    const d = new Date(ts);
    const isEn = getCurrentLocale() === 'en';
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleString(isEn ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const fmtRelative = (iso?: string) => {
    if (!iso) return '—';
    const isEn = getCurrentLocale() === 'en';
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.round(diff / 60000);
    if (min < 1) return isEn ? 'just now' : 'agora';
    if (min < 60) return isEn ? `${min}m ago` : `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return isEn ? `${h}h ago` : `há ${h} h`;
    const days = Math.round(h / 24);
    if (isEn) return days === 1 ? 'yesterday' : `${days}d ago`;
    return days === 1 ? 'ontem' : `há ${days} dias`;
};

export const fmtDuration = (seconds: number) => {
    const m = Math.round((seconds || 0) / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h} h ${m % 60} min`;
};

/** Text color for a signed value. Always paired with a sign, never color alone. */
export const pnlTone = (v: number, muted = false) =>
    v > 0 ? 'text-accent-fg' : v < 0 ? 'text-danger-fg' : muted ? 'text-fg-muted' : 'text-fg';

/* --------------------------------------------------------------- controls */

export const inputCls =
    'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50';

export const Field = ({
    label,
    hint,
    htmlFor,
    children,
    className,
}: {
    label: string;
    hint?: React.ReactNode;
    htmlFor?: string;
    children: React.ReactNode;
    className?: string;
}) => (
    <div className={cn('space-y-1.5', className)}>
        <label htmlFor={htmlFor} className="block text-xs font-semibold text-fg">
            {label}
        </label>
        {children}
        {hint && <p className="text-[11px] leading-relaxed text-fg-subtle">{hint}</p>}
    </div>
);

export const Toggle = ({
    checked,
    onChange,
    label,
    description,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    description?: string;
}) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-2/50 p-3 transition-colors hover:bg-surface-2">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span
            aria-hidden
            className={cn(
                'relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50',
                checked ? 'bg-accent' : 'bg-surface-3'
            )}
        >
            <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', checked ? 'left-3.5' : 'left-0.5')} />
        </span>
        <span className="min-w-0">
            <span className="block text-xs font-semibold text-fg">{label}</span>
            {description && <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-muted">{description}</span>}
        </span>
    </label>
);

/** Pill filter group (single choice). */
export const ChipGroup = <T extends string>({
    value,
    onChange,
    options,
    label,
}: {
    value: T;
    onChange: (v: T) => void;
    options: { value: T; label: string; count?: number }[];
    label: string;
}) => (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
        {options.map((o) => (
            <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={value === o.value}
                onClick={() => onChange(o.value)}
                className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                    value === o.value
                        ? 'border-fg bg-fg text-canvas'
                        : 'border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg'
                )}
            >
                <span className="max-w-[16rem] truncate">{o.label}</span>
                {o.count !== undefined && (
                    <span className={cn('tabular-nums text-[10px]', value === o.value ? 'opacity-70' : 'text-fg-subtle')}>{o.count}</span>
                )}
            </button>
        ))}
    </div>
);

/** Underlined sub-navigation (in-page views). */
export const SubTabs = <T extends string>({
    value,
    onChange,
    options,
    label,
}: {
    value: T;
    onChange: (v: T) => void;
    options: { value: T; label: string; icon?: React.ReactNode; count?: number }[];
    label: string;
}) => (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
        {options.map((o) => (
            <button
                key={o.value}
                type="button"
                role="tab"
                aria-selected={value === o.value}
                onClick={() => onChange(o.value)}
                className={cn(
                    '-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50',
                    value === o.value ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'
                )}
            >
                {o.icon && <span aria-hidden className={value === o.value ? 'text-accent-fg' : 'text-fg-subtle'}>{o.icon}</span>}
                {o.label}
                {o.count !== undefined && <span className="rounded-full bg-surface-3 px-1.5 text-[10px] tabular-nums text-fg-muted">{o.count}</span>}
            </button>
        ))}
    </div>
);

/** Delete with an inline second click instead of a browser confirm(). */
export const ConfirmDeleteButton = ({ onConfirm, label }: { onConfirm: () => void; label?: string }) => {
    const isEn = getCurrentLocale() === 'en';
    const resolvedLabel = label || (isEn ? 'Delete' : 'Excluir');
    const [armed, setArmed] = useState(false);
    return armed ? (
        <span className="inline-flex items-center gap-1">
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onConfirm();
                }}
                className="rounded-lg bg-data-neg px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-data-neg/90"
            >
                {isEn ? 'Confirm' : 'Confirmar'}
            </button>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    setArmed(false);
                }}
                className="rounded-lg px-2 py-1.5 text-xs font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
                {isEn ? 'Cancel' : 'Cancelar'}
            </button>
        </span>
    ) : (
        <button
            type="button"
            title={resolvedLabel}
            aria-label={resolvedLabel}
            onClick={(e) => {
                e.stopPropagation();
                setArmed(true);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-fg-muted transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger-fg"
        >
            <Trash2 size={14} />
        </button>
    );
};

/* ---------------------------------------------------------------- layout */

export const Panel = ({
    title,
    subtitle,
    actions,
    children,
    className,
    bodyClassName,
}: {
    title?: React.ReactNode;
    subtitle?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    bodyClassName?: string;
}) => (
    <section className={cn('min-w-0 rounded-xl border border-line bg-surface', className)}>
        {(title || actions) && (
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
                <div className="min-w-0">
                    {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
                    {subtitle && <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>}
                </div>
                {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
            </header>
        )}
        <div className={cn('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
);

export const KpiCard = ({
    label,
    value,
    hint,
    tone,
    className,
}: {
    label: string;
    value: React.ReactNode;
    hint?: React.ReactNode;
    tone?: string;
    className?: string;
}) => (
    <div className={cn('min-w-0 rounded-xl border border-line bg-surface p-4', className)}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</p>
        <p
            title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
            className={cn('mt-1.5 truncate text-lg xl:text-xl font-bold tabular-nums', tone || 'text-fg')}
        >
            {value}
        </p>
        {hint && <p className="mt-1 truncate text-[11px] text-fg-muted">{hint}</p>}
    </div>
);

export const EmptyState = ({
    icon,
    title,
    description,
    action,
    className,
}: {
    icon?: React.ReactNode;
    title: string;
    description?: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
}) => (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center', className)}>
        {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-fg">{icon}</div>}
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mt-1 max-w-md text-xs leading-relaxed text-fg-muted">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
    </div>
);

export const Badge = ({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'danger'; className?: string }) => (
    <span
        className={cn(
            'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            tone === 'accent' && 'border-accent/30 bg-accent/10 text-accent-fg',
            tone === 'warn' && 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
            tone === 'danger' && 'border-danger/30 bg-danger/10 text-danger-fg',
            tone === 'neutral' && 'border-line bg-surface-2 text-fg-muted',
            className
        )}
    >
        {children}
    </span>
);

export const Breadcrumbs = ({ items }: { items: { label: string; to?: string }[] }) => (
    <nav aria-label={getCurrentLocale() === 'en' ? 'Breadcrumb navigation' : 'Navegação estrutural'} className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
        {items.map((it, i) => (
            <React.Fragment key={i}>
                {i > 0 && <span aria-hidden className="text-fg-subtle">/</span>}
                {it.to ? (
                    <Link to={it.to} className="hover:text-fg hover:underline">
                        {it.label}
                    </Link>
                ) : (
                    <span aria-current="page" className="max-w-[20rem] truncate font-semibold text-fg">
                        {it.label}
                    </span>
                )}
            </React.Fragment>
        ))}
    </nav>
);

/** Small labelled value used in definition lists. */
export const Stat = ({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) => (
    <div className={cn('min-w-0', className)}>
        <dt className="text-[11px] text-fg-subtle">{label}</dt>
        <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-fg">{value}</dd>
    </div>
);
