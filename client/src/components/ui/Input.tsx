import React, { InputHTMLAttributes, forwardRef, useId } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: React.ReactNode;
    error?: string;
    /** Helper text shown under the field when there is no error. */
    hint?: React.ReactNode;
    icon?: React.ReactNode;
    /** Element rendered inside the field, after the input (e.g. a toggle button). */
    endAdornment?: React.ReactNode;
    /**
     * `field` = design system v2 (token-based, theme-aware, accessible).
     * `dark` / `light` = legacy v1 styles, kept for existing screens.
     */
    variant?: 'field' | 'dark' | 'light';
    /** Extra classes for the outer wrapper (`className` targets the <input>). */
    wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ label, error, hint, icon, endAdornment, variant = 'dark', className, wrapperClassName, id, ...props }, ref) => {
        const autoId = useId();
        const inputId = id ?? autoId;
        const hintId = `${inputId}-hint`;
        const errorId = `${inputId}-error`;
        const describedBy = [error ? errorId : hint ? hintId : null, props['aria-describedby']].filter(Boolean).join(' ') || undefined;

        if (variant === 'field') {
            return (
                <div className={cn('group space-y-1.5', wrapperClassName)}>
                    {label && (
                        <label
                            htmlFor={inputId}
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
                            'relative flex items-center rounded-control border bg-canvas/80 transition-[border-color,box-shadow] duration-200',
                            error
                                ? 'border-danger/60 focus-within:shadow-focus-danger'
                                : 'border-line hover:border-line-strong focus-within:border-accent/60 focus-within:shadow-focus-accent',
                            props.disabled && 'opacity-60 hover:border-line'
                        )}
                    >
                        {icon && (
                            <span
                                aria-hidden
                                className={cn(
                                    'pointer-events-none flex pl-4 pr-3 text-fg-subtle transition-colors group-focus-within:text-accent-fg',
                                    error && 'text-danger-fg'
                                )}
                            >
                                {icon}
                            </span>
                        )}
                        <input
                            ref={ref}
                            id={inputId}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={describedBy}
                            className={cn(
                                'ds-control w-full min-w-0 bg-transparent py-3.5 pr-4 text-sm font-medium text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed',
                                icon ? 'pl-0' : 'pl-4',
                                className
                            )}
                            {...props}
                        />
                        {endAdornment}
                    </div>
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
        }

        // ---- Legacy v1 rendering (unchanged look) ----
        const variants = {
            dark: 'bg-[#08090C] border-white/[0.08] text-slate-100 placeholder:text-slate-500 focus:border-[#10B981] focus:ring-[#10B981]/20',
            light: 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:ring-emerald-500/20',
        };
        const labelColor = variant === 'dark' ? 'text-slate-400' : 'text-gray-700';

        return (
            <div className={cn('space-y-1', wrapperClassName)}>
                {label && (
                    <label htmlFor={inputId} className={`text-xs font-semibold uppercase tracking-wider ${labelColor}`}>
                        {label}
                    </label>
                )}
                <div className="relative">
                    {icon && (
                        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">{icon}</div>
                    )}
                    <input
                        ref={ref}
                        id={inputId}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={describedBy}
                        className={cn(
                            'w-full rounded-xl border py-2.5 transition-all focus:outline-none focus:ring-1',
                            icon ? 'pl-10' : 'px-4',
                            variants[variant],
                            error && 'border-rose-500/50 focus:border-rose-500/50 focus:ring-rose-500/50',
                            className
                        )}
                        {...props}
                    />
                    {endAdornment}
                </div>
                {error ? (
                    <p id={errorId} className="text-xs text-rose-400">
                        {error}
                    </p>
                ) : (
                    hint && (
                        <p id={hintId} className="text-xs text-slate-500">
                            {hint}
                        </p>
                    )
                )}
            </div>
        );
    }
);
Input.displayName = 'Input';
