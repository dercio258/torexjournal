import React from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, Loader2, X } from 'lucide-react';
import { cn } from '../../../lib/cn';

interface AdminPageHeaderProps {
    badge?: string;
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
}

export const AdminPageHeader = ({
    badge,
    title,
    subtitle,
    icon,
    actions,
    className,
}: AdminPageHeaderProps) => (
    <div
        className={cn(
            'flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-center lg:justify-between',
            className,
        )}
    >
        <div className="space-y-1.5 min-w-0">
            {badge && (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-accent-fg">
                    {badge}
                </div>
            )}
            <div className="flex items-center gap-3">
                {icon && (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface-2 text-accent-fg">
                        {icon}
                    </div>
                )}
                <div className="min-w-0">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg truncate">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-sm text-fg-muted mt-0.5 max-w-2xl">
                            {subtitle}
                        </p>
                    )}
                </div>
            </div>
        </div>
        {actions && (
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {actions}
            </div>
        )}
    </div>
);

type StatTone = 'default' | 'accent' | 'warning' | 'danger' | 'info';

const statToneClasses: Record<StatTone, string> = {
    default: 'bg-surface-2 text-fg-muted border-line',
    accent: 'bg-emerald-500/10 text-accent-fg border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    danger: 'bg-rose-500/10 text-danger-fg border-rose-500/20',
    info: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
};

interface AdminStatCardProps {
    label: string;
    value: React.ReactNode;
    hint?: React.ReactNode;
    icon?: React.ReactNode;
    tone?: StatTone;
    onClick?: () => void;
    className?: string;
}

export const AdminStatCard = ({
    label,
    value,
    hint,
    icon,
    tone = 'default',
    onClick,
    className,
}: AdminStatCardProps) => {
    const Wrapper: React.ElementType = onClick ? 'button' : 'div';
    return (
        <Wrapper
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            className={cn(
                'rounded-xl border border-line bg-surface p-4 sm:p-5 text-left transition-all',
                onClick && 'cursor-pointer hover:border-line-strong hover:bg-surface-2/60 active:scale-[0.99]',
                className,
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    {label}
                </span>
                {icon && (
                    <span
                        className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                            statToneClasses[tone],
                        )}
                    >
                        {icon}
                    </span>
                )}
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-fg tabular-nums">
                {value}
            </div>
            {hint && (
                <div className="mt-1.5 text-xs text-fg-subtle flex items-center gap-1.5">
                    {hint}
                </div>
            )}
        </Wrapper>
    );
};

interface AdminSectionCardProps {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    noPadding?: boolean;
}

export const AdminSectionCard = ({
    title,
    subtitle,
    icon,
    actions,
    children,
    className,
    noPadding = false,
}: AdminSectionCardProps) => (
    <section
        className={cn(
            'rounded-xl border border-line bg-surface overflow-hidden',
            className,
        )}
    >
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between bg-surface-2/40">
            <div className="flex items-start gap-2.5 min-w-0">
                {icon && <span className="mt-0.5 text-accent-fg shrink-0">{icon}</span>}
                <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-bold text-fg truncate">{title}</h2>
                    {subtitle && <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>}
                </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </div>
        <div className={noPadding ? '' : 'p-5'}>{children}</div>
    </section>
);

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const badgeToneClasses: Record<BadgeTone, string> = {
    neutral: 'bg-surface-2 text-fg-muted border-line-strong',
    success: 'bg-emerald-500/10 text-accent-fg border-emerald-500/25',
    accent: 'bg-accent/15 text-accent-fg border-accent/30',
    warning: 'bg-amber-500/10 text-amber-500 border-amber-500/25',
    danger: 'bg-rose-500/10 text-danger-fg border-rose-500/25',
    info: 'bg-sky-500/10 text-sky-500 border-sky-500/25',
};

const badgeDotClasses: Record<BadgeTone, string> = {
    neutral: 'bg-fg-subtle',
    success: 'bg-emerald-500',
    accent: 'bg-accent',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    info: 'bg-sky-500',
};

export const AdminBadge = ({
    children,
    tone = 'neutral',
    dot = false,
    className,
}: {
    children: React.ReactNode;
    tone?: BadgeTone;
    dot?: boolean;
    className?: string;
}) => (
    <span
        className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
            badgeToneClasses[tone],
            className,
        )}
    >
        {dot && <span className={cn('h-1.5 w-1.5 rounded-full', badgeDotClasses[tone])} />}
        {children}
    </span>
);

type BannerTone = 'success' | 'warning' | 'danger' | 'info';

const bannerClasses: Record<BannerTone, string> = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-accent-fg',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
    danger: 'border-rose-500/30 bg-rose-500/10 text-danger-fg',
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-500',
};

const bannerIcons: Record<BannerTone, React.ReactNode> = {
    success: <CheckCircle2 className="h-4 w-4 shrink-0" />,
    warning: <AlertTriangle className="h-4 w-4 shrink-0" />,
    danger: <AlertCircle className="h-4 w-4 shrink-0" />,
    info: <Info className="h-4 w-4 shrink-0" />,
};

export const AdminBanner = ({
    tone,
    title,
    message,
    onDismiss,
    action,
    className,
}: {
    tone: BannerTone;
    title?: string;
    message: React.ReactNode;
    onDismiss?: () => void;
    action?: React.ReactNode;
    className?: string;
}) => (
    <div
        role="status"
        className={cn(
            'flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm',
            bannerClasses[tone],
            className,
        )}
    >
        <div className="flex items-start gap-2.5 min-w-0">
            <span className="mt-0.5">{bannerIcons[tone]}</span>
            <div className="min-w-0">
                {title && <div className="font-semibold text-fg">{title}</div>}
                <div className="text-xs sm:text-sm leading-relaxed">{message}</div>
            </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
            {action}
            {onDismiss && (
                <button
                    type="button"
                    onClick={onDismiss}
                    className="rounded-lg p-1 text-fg-muted hover:bg-surface-2 hover:text-fg transition-colors"
                    aria-label="Fechar aviso"
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    </div>
);

export const AdminLoadingState = ({ label = 'Carregando dados administrativos...' }: { label?: string }) => (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface p-12 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent-fg" />
        <p className="text-sm text-fg-muted">{label}</p>
    </div>
);

export const AdminEmptyState = ({
    icon,
    title,
    description,
    action,
}: {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    action?: React.ReactNode;
}) => (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center">
        {icon && (
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-fg-muted">
                {icon}
            </div>
        )}
        <h3 className="text-sm font-semibold text-fg mt-1">{title}</h3>
        {description && <p className="text-xs text-fg-muted max-w-md">{description}</p>}
        {action && <div className="mt-3">{action}</div>}
    </div>
);
