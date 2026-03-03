import { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    glass?: boolean;
}

export const Card = ({ children, glass = true, className = '', ...props }: CardProps) => {
    const glassStyle = glass
        ? 'bg-slate-800/40 backdrop-blur-md border border-white/5'
        : 'bg-slate-900 border border-slate-800';

    return (
        <div
            className={`rounded-xl p-6 ${glassStyle} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
};
