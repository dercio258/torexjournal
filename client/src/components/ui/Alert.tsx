import React from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const alertVariants = cva('flex items-start gap-3 rounded-control border p-3.5 text-sm animate-fade-in-up', {
    variants: {
        tone: {
            error: 'border-danger/25 bg-danger/10 text-danger-fg',
            success: 'border-accent/25 bg-accent/10 text-accent-fg',
            info: 'border-line bg-surface text-fg-muted',
        },
    },
    defaultVariants: { tone: 'info' },
});

const ICONS = { error: AlertCircle, success: CheckCircle2, info: Info } as const;

interface AlertProps extends VariantProps<typeof alertVariants> {
    children: React.ReactNode;
    className?: string;
}

/** Inline status message. Errors are announced assertively, others politely. */
export const Alert = ({ tone = 'info', children, className }: AlertProps) => {
    const Icon = ICONS[tone ?? 'info'];
    return (
        <div role={tone === 'error' ? 'alert' : 'status'} className={cn(alertVariants({ tone }), className)}>
            <Icon size={18} aria-hidden className="mt-px shrink-0" />
            <div className="leading-relaxed">{children}</div>
        </div>
    );
};
