import React from 'react';
import { cn } from '../../lib/cn';

/** Shared chart card shell: consistent padding, title row and optional actions. */
export const ChartCard = ({
    title,
    icon,
    subtitle,
    actions,
    children,
    className,
}: {
    title: string;
    icon?: React.ReactNode;
    subtitle?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) => (
    <section className={cn('flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 sm:p-5', className)}>
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg">
                    {icon && <span aria-hidden className="text-fg-subtle">{icon}</span>}
                    {title}
                </h3>
                {subtitle && <p className="mt-0.5 text-[11px] text-fg-subtle">{subtitle}</p>}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
        {children}
    </section>
);

/** Compact segmented control used inside chart headers. */
export const Segmented = <T extends string>({
    value,
    onChange,
    options,
    label,
}: {
    value: T;
    onChange: (v: T) => void;
    options: { value: T; label: string }[];
    label: string;
}) => (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
        {options.map((o) => (
            <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={value === o.value}
                onClick={() => onChange(o.value)}
                className={cn(
                    'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                    value === o.value ? 'bg-surface-2 text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'
                )}
            >
                {o.label}
            </button>
        ))}
    </div>
);

/** Empty state sized like the chart it replaces (no layout jump). */
export const ChartEmpty = ({ message, hint, className }: { message: string; hint?: string; className?: string }) => (
    <div className={cn('flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-line p-6 text-center', className)}>
        <p className="text-xs font-medium text-fg-muted">{message}</p>
        {hint && <p className="mt-1 text-[11px] text-fg-subtle">{hint}</p>}
    </div>
);
