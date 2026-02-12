import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'danger' | 'secondary' | 'ghost';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:ring-indigo-500 shadow-sm shadow-indigo-500/20',
  danger:
    'bg-red-600/80 text-white hover:bg-red-600 focus-visible:ring-red-500 shadow-sm',
  secondary:
    'bg-surface-2 text-text-secondary ring-1 ring-inset ring-border hover:bg-surface-3 hover:text-text-primary focus-visible:ring-indigo-500',
  ghost:
    'text-text-tertiary hover:text-text-primary hover:bg-surface-2 focus-visible:ring-indigo-500',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'xs' | 'sm' | 'md';
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
        VARIANT_CLASSES[variant],
        size === 'xs' && 'px-2 py-1 text-[11px]',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2 text-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
