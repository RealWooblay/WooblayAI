import clsx from 'clsx';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, hover, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'rounded-lg border border-border bg-surface-1 p-4',
        hover && 'transition-all duration-200 hover:border-border-strong hover:bg-surface-2 cursor-pointer',
        className,
      )}
    >
      {children}
    </div>
  );
}
