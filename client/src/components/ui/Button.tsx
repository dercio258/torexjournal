import React, { ButtonHTMLAttributes, forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
    [
        'relative inline-flex items-center justify-center gap-2 border font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        'disabled:cursor-not-allowed disabled:opacity-50',
    ],
    {
        variants: {
            variant: {
                // Design system v2 (token-based, theme-aware)
                brand: 'border-transparent bg-accent font-semibold text-accent-on hover:bg-accent-hover hover:shadow-glow active:scale-[0.98] disabled:hover:bg-accent disabled:hover:shadow-none',
                outline: 'border-line bg-surface text-fg-muted hover:border-accent/30 hover:bg-surface-2 hover:text-fg active:scale-[0.98]',
                subtle: 'border-accent/30 bg-accent/15 font-semibold text-accent-fg hover:bg-accent/25 active:scale-[0.98] disabled:border-line disabled:bg-surface disabled:text-fg-subtle disabled:opacity-100',
                link: 'h-auto border-transparent p-0 font-semibold text-accent-fg hover:text-accent-hover hover:underline disabled:text-fg-subtle disabled:no-underline disabled:opacity-100',

                // Legacy v1 (kept so existing screens look identical)
                primary: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/20',
                solid: 'border-transparent bg-[#10B981] font-semibold text-[#04110C] shadow-[0_0_20px_rgba(16,185,129,0.25)] hover:bg-[#059669]',
                secondary: 'border-white/[0.08] bg-[#161822] text-slate-200 hover:bg-[#1C1F2C]',
                danger: 'border-rose-500/20 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20',
                ghost: 'border-transparent text-slate-400 hover:bg-[#161822] hover:text-slate-100',
                gradient: 'border-none bg-gradient-to-r from-emerald-500 to-emerald-600 font-semibold text-[#04110C] shadow-lg shadow-emerald-500/30 hover:from-emerald-600 hover:to-emerald-700',
            },
            size: {
                sm: 'h-8 rounded-lg px-3 text-xs',
                md: 'rounded-xl px-4 py-2 text-sm',
                lg: 'h-12 rounded-control px-5 text-sm',
            },
            fullWidth: { true: 'w-full' },
        },
        compoundVariants: [{ variant: 'link', className: 'h-auto px-0 py-0' }],
        defaultVariants: { variant: 'primary', size: 'md' },
    }
);

export interface ButtonProps
    extends ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    isLoading?: boolean;
    /** Leading icon (hidden while loading). */
    icon?: React.ReactNode;
    /** Trailing icon (hidden while loading). */
    iconRight?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ children, variant, size, fullWidth, isLoading, icon, iconRight, className, disabled, ...props }, ref) => (
        <button
            ref={ref}
            className={cn(buttonVariants({ variant, size, fullWidth }), className)}
            disabled={isLoading || disabled}
            aria-busy={isLoading || undefined}
            {...props}
        >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
            {children}
            {!isLoading && iconRight}
        </button>
    )
);
Button.displayName = 'Button';

export { buttonVariants };
