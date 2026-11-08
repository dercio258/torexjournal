import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from './Input';

export type PasswordInputProps = Omit<InputProps, 'type' | 'endAdornment'>;

/** Password field with an accessible show/hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(({ variant = 'field', ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
        <Input
            ref={ref}
            variant={variant}
            type={visible ? 'text' : 'password'}
            endAdornment={
                <button
                    type="button"
                    onClick={() => setVisible((v) => !v)}
                    aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
                    aria-pressed={visible}
                    className="mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                    {visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                </button>
            }
            {...props}
        />
    );
});
PasswordInput.displayName = 'PasswordInput';
