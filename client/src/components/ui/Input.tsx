import React, { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    icon?: React.ReactNode;
    variant?: 'dark' | 'light';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, icon, variant = 'dark', className = '', ...props }, ref) => {
    const variants = {
        dark: 'bg-slate-900/50 border-slate-800 text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/50 focus:ring-emerald-500/50',
        light: 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:ring-emerald-500/20'
    };

    const labelColor = variant === 'dark' ? 'text-slate-400' : 'text-gray-700';

    return (
        <div className="space-y-1">
            {label && <label className={`text-xs font-semibold uppercase tracking-wider ${labelColor}`}>{label}</label>}
            <div className="relative">
                {icon && (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
                        {icon}
                    </div>
                )}
                <input
                    ref={ref}
                    className={`
                        w-full border rounded-lg py-2.5 
                        focus:outline-none focus:ring-1 transition-all
                        ${icon ? 'pl-10' : 'px-4'}
                        ${variants[variant]}
                        ${error ? 'border-rose-500/50 focus:border-rose-500/50 focus:ring-rose-500/50' : ''}
                        ${className}
                    `}
                    {...props}
                />
            </div>
            {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
    );
});
Input.displayName = 'Input';
