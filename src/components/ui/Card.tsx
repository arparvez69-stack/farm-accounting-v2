import React from 'react';

export type CardVariant = 'interactive' | 'static';

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * 'interactive': visible shadow, rounded-xl corners, hover elevation, and pressed/active state on tap.
   * 'static': flat, no shadow, light border for pure informational display.
   * Defaults to 'static'.
   */
  variant?: CardVariant;
  /**
   * Content of the card
   */
  children: React.ReactNode;
  /**
   * Optional custom HTML tag to render. Defaults to 'button' if interactive with onClick, else 'div'.
   */
  as?: 'div' | 'button' | 'article' | 'section';
  /**
   * Card internal padding preset.
   * 'none' (p-0), 'sm' (p-3), 'md' (p-4), 'lg' (p-5 sm:p-6)
   * Defaults to 'md'.
   */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /**
   * Optional click handler (automatically applies interactive styling unless explicitly set to static)
   */
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /**
   * Disabled state for interactive cards
   */
  disabled?: boolean;
  /**
   * Optional extra className
   */
  className?: string;
  /**
   * Optional HTML id
   */
  id?: string;
}

const PADDING_MAP: Record<'none' | 'sm' | 'md' | 'lg', string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5 sm:p-6',
};

/**
 * Reusable Card component with clear visual distinction:
 * - "interactive": visible shadow, hover elevation, rounded-xl, pressed/active state on tap
 * - "static": flat, no shadow, subtle light border for pure information display
 */
export const Card: React.FC<CardProps> = ({
  variant = 'static',
  children,
  as,
  padding = 'md',
  onClick,
  disabled = false,
  className = '',
  id,
  role,
  tabIndex,
  onKeyDown,
  ...rest
}) => {
  // If onClick is provided and variant wasn't explicitly passed, treat as interactive
  const effectiveVariant: CardVariant = variant;
  const isInteractive = effectiveVariant === 'interactive' || !!onClick;

  const Tag = as || (isInteractive && onClick ? 'button' : 'div');
  const paddingClass = PADDING_MAP[padding];

  const variantClasses = isInteractive
    ? 'bg-white dark:bg-slate-800 rounded-xl border border-gray-200/90 dark:border-slate-700 shadow-xs hover:shadow-md active:scale-[0.99] active:shadow-xs cursor-pointer transition-all duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#1E5128]'
    : 'bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm rounded-xl border border-gray-200/80 dark:border-slate-800/80 shadow-none cursor-default text-gray-900 dark:text-slate-100';

  const disabledClasses = disabled
    ? 'opacity-50 pointer-events-none cursor-not-allowed'
    : '';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (onKeyDown) {
      onKeyDown(e);
      return;
    }
    if (isInteractive && onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick(e as unknown as React.MouseEvent<HTMLElement>);
    }
  };

  return (
    <Tag
      id={id}
      onClick={disabled ? undefined : onClick}
      disabled={Tag === 'button' ? disabled : undefined}
      role={role ?? (isInteractive && Tag !== 'button' ? 'button' : undefined)}
      tabIndex={tabIndex ?? (isInteractive && Tag !== 'button' ? 0 : undefined)}
      onKeyDown={handleKeyDown}
      className={`${variantClasses} ${paddingClass} ${disabledClasses} ${className}`}
      {...(rest as any)}
    >
      {children}
    </Tag>
  );
};

export default Card;
