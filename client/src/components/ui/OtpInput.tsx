import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { cn } from '../../lib/cn';

interface OtpInputProps {
    value: string[];
    onChange: (digits: string[]) => void;
    /** Fired when all digits are filled via paste. */
    onComplete?: (code: string) => void;
    length?: number;
    disabled?: boolean;
    invalid?: boolean;
    autoFocus?: boolean;
    'aria-describedby'?: string;
}

export interface OtpInputHandle {
    focus: (index?: number) => void;
}

/** Segmented numeric code input with paste, arrow and backspace navigation. */
export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(
    ({ value, onChange, onComplete, length = 6, disabled, invalid, autoFocus, ...aria }, ref) => {
        const refs = useRef<(HTMLInputElement | null)[]>([]);
        const focusAt = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

        useImperativeHandle(ref, () => ({ focus: (i = 0) => focusAt(i) }));

        const setDigit = (index: number, digit: string) => {
            const next = [...value];
            next[index] = digit;
            onChange(next);
        };

        const handleChange = (raw: string, index: number) => {
            const digit = raw.replace(/\D/g, '').slice(-1);
            setDigit(index, digit);
            if (digit && index < length - 1) focusAt(index + 1);
        };

        const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
            if (e.key === 'Backspace' && !value[index] && index > 0) {
                e.preventDefault();
                setDigit(index - 1, '');
                focusAt(index - 1);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                focusAt(index - 1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                focusAt(index + 1);
            }
        };

        const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
            e.preventDefault();
            const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
            if (!digits) return;
            const next = Array.from({ length }, (_, i) => digits[i] ?? '');
            onChange(next);
            focusAt(digits.length);
            if (digits.length === length) onComplete?.(digits);
        };

        return (
            <div role="group" aria-label={`Código de ${length} dígitos`} className="flex justify-between gap-2 md:gap-3">
                {Array.from({ length }, (_, index) => (
                    <input
                        key={index}
                        ref={(el) => (refs.current[index] = el)}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete={index === 0 ? 'one-time-code' : 'off'}
                        maxLength={1}
                        aria-label={`Dígito ${index + 1}`}
                        aria-invalid={invalid || undefined}
                        aria-describedby={aria['aria-describedby']}
                        value={value[index] ?? ''}
                        disabled={disabled}
                        autoFocus={autoFocus && index === 0}
                        onChange={(e) => handleChange(e.target.value, index)}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        onPaste={handlePaste}
                        onFocus={(e) => e.target.select()}
                        className={cn(
                            'ds-control h-14 w-12 rounded-control border bg-canvas/80 text-center font-mono text-xl font-bold text-fg outline-none transition-all md:h-16 md:w-14',
                            'focus:border-accent/60 focus:shadow-focus-accent disabled:opacity-60',
                            invalid ? 'border-danger/60' : value[index] ? 'border-accent/50' : 'border-line hover:border-line-strong'
                        )}
                    />
                ))}
            </div>
        );
    }
);
OtpInput.displayName = 'OtpInput';
