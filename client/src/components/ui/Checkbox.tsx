import React, { useId } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

interface CheckboxProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: React.ReactNode;
    error?: string;
    id?: string;
    className?: string;
}

/** Accessible custom checkbox: the native input stays focusable (visually hidden, not `display:none`). */
export const Checkbox = ({ checked, onChange, label, error, id, className }: CheckboxProps) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;

    return (
        <div className={cn('space-y-1.5', className)}>
            <label htmlFor={inputId} className="group flex cursor-pointer select-none items-start gap-3">
                <input
                    id={inputId}
                    type="checkbox"
                    className="peer sr-only"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                />
                <span
                    aria-hidden
                    className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-200',
                        'peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas',
                        checked
                            ? 'border-accent bg-accent text-accent-on'
                            : cn('bg-canvas/80 group-hover:border-accent/40', error ? 'border-danger/60' : 'border-line-strong')
                    )}
                >
                    {checked && <Check size={13} strokeWidth={3.5} />}
                </span>
                <span className={cn('text-sm leading-relaxed transition-colors', checked ? 'text-fg' : 'text-fg-muted group-hover:text-fg')}>
                    {label}
                </span>
            </label>
            {error && (
                <p id={errorId} className="pl-8 text-xs text-danger-fg animate-fade-in-up">
                    {error}
                </p>
            )}
        </div>
    );
};
