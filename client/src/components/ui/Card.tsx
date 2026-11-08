import { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    glass?: boolean;
}

export const Card = ({ children, glass = true, className = '', ...props }: CardProps) => {
    const glassStyle = glass
        ? 'bg-surface backdrop-blur-md border border-line shadow-xl'
        : 'bg-canvas-subtle border border-line';

    return (
        <div
            className={`rounded-2xl p-6 ${glassStyle} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
};
