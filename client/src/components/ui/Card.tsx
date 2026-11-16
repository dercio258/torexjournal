import { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    glass?: boolean;
}

export const Card = ({ children, glass = true, className = '', ...props }: CardProps) => {
    const glassStyle = glass
        ? 'bg-surface border border-line'
        : 'bg-canvas-subtle border border-line-subtle';

    return (
        <div
            className={`rounded-xl p-4 sm:p-5 ${glassStyle} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
};
