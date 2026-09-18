import React from 'react';

export type TileColor =
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'emerald'
  | 'amber'
  | 'blue'
  | 'purple'
  | 'rose'
  | 'indigo'
  | 'slate'
  | 'gray';

export interface IconTileProps {
  /**
   * The icon to display. Can be a Lucide React component or a ReactNode.
   */
  icon: React.ComponentType<{ className?: string }> | React.ReactNode;
  /**
   * Semantic color name or custom color key.
   */
  color?: TileColor | string;
  /**
   * Background style variant: 'soft' (tinted background, colored icon) or 'solid' (saturated background, white icon)
   * Defaults to 'soft'.
   */
  variant?: 'soft' | 'solid';
  /**
   * Tile size preset.
   * 'sm' (36px), 'md' (44px), 'lg' (52px), 'xl' (64px)
   * Defaults to 'md'.
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Corner radius preset. Defaults to 'xl'.
   */
  rounded?: 'md' | 'lg' | 'xl' | '2xl' | 'full';
  /**
   * Optional notification count, tag, or indicator badge
   */
  badge?: string | number;
  /**
   * Optional click handler if the tile itself acts as a button
   */
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /**
   * Disabled state
   */
  disabled?: boolean;
  /**
   * Optional extra container classes
   */
  className?: string;
  /**
   * Optional HTML id
   */
  id?: string;
  /**
   * Accessible aria-label
   */
  ariaLabel?: string;
}

const COLOR_MAP: Record<
  string,
  {
    softBg: string;
    softText: string;
    softBorder: string;
    solidBg: string;
    solidText: string;
  }
> = {
  success: {
    softBg: 'bg-emerald-50 dark:bg-emerald-950/40',
    softText: 'text-[#1E5128] dark:text-emerald-300',
    softBorder: 'border-emerald-100 dark:border-emerald-900/50',
    solidBg: 'bg-[#1E5128] dark:bg-[#1E5128]',
    solidText: 'text-white',
  },
  danger: {
    softBg: 'bg-red-50 dark:bg-red-950/40',
    softText: 'text-red-600 dark:text-red-400',
    softBorder: 'border-red-100 dark:border-red-900/50',
    solidBg: 'bg-red-600 dark:bg-red-700',
    solidText: 'text-white',
  },
  warning: {
    softBg: 'bg-amber-50 dark:bg-amber-950/40',
    softText: 'text-amber-600 dark:text-amber-400',
    softBorder: 'border-amber-100 dark:border-amber-900/50',
    solidBg: 'bg-amber-500 dark:bg-amber-600',
    solidText: 'text-white',
  },
  info: {
    softBg: 'bg-blue-50 dark:bg-blue-950/40',
    softText: 'text-blue-600 dark:text-blue-400',
    softBorder: 'border-blue-100 dark:border-blue-900/50',
    solidBg: 'bg-blue-600 dark:bg-blue-700',
    solidText: 'text-white',
  },
  emerald: {
    softBg: 'bg-emerald-50 dark:bg-emerald-950/40',
    softText: 'text-emerald-600 dark:text-emerald-400',
    softBorder: 'border-emerald-100 dark:border-emerald-900/50',
    solidBg: 'bg-emerald-600 dark:bg-emerald-700',
    solidText: 'text-white',
  },
  amber: {
    softBg: 'bg-amber-50 dark:bg-amber-950/40',
    softText: 'text-amber-600 dark:text-amber-400',
    softBorder: 'border-amber-100 dark:border-amber-900/50',
    solidBg: 'bg-amber-500 dark:bg-amber-600',
    solidText: 'text-white',
  },
  blue: {
    softBg: 'bg-blue-50 dark:bg-blue-950/40',
    softText: 'text-blue-600 dark:text-blue-400',
    softBorder: 'border-blue-100 dark:border-blue-900/50',
    solidBg: 'bg-blue-600 dark:bg-blue-700',
    solidText: 'text-white',
  },
  purple: {
    softBg: 'bg-purple-50 dark:bg-purple-950/40',
    softText: 'text-purple-600 dark:text-purple-400',
    softBorder: 'border-purple-100 dark:border-purple-900/50',
    solidBg: 'bg-purple-600 dark:bg-purple-700',
    solidText: 'text-white',
  },
  rose: {
    softBg: 'bg-rose-50 dark:bg-rose-950/40',
    softText: 'text-rose-600 dark:text-rose-400',
    softBorder: 'border-rose-100 dark:border-rose-900/50',
    solidBg: 'bg-rose-600 dark:bg-rose-700',
    solidText: 'text-white',
  },
  indigo: {
    softBg: 'bg-indigo-50 dark:bg-indigo-950/40',
    softText: 'text-indigo-600 dark:text-indigo-400',
    softBorder: 'border-indigo-100 dark:border-indigo-900/50',
    solidBg: 'bg-indigo-600 dark:bg-indigo-700',
    solidText: 'text-white',
  },
  slate: {
    softBg: 'bg-slate-100 dark:bg-slate-800',
    softText: 'text-slate-700 dark:text-slate-300',
    softBorder: 'border-slate-200 dark:border-slate-700',
    solidBg: 'bg-slate-700 dark:bg-slate-600',
    solidText: 'text-white',
  },
  gray: {
    softBg: 'bg-gray-100 dark:bg-slate-800',
    softText: 'text-gray-700 dark:text-gray-300',
    softBorder: 'border-gray-200 dark:border-slate-700',
    solidBg: 'bg-gray-700 dark:bg-slate-600',
    solidText: 'text-white',
  },
};

const SIZE_MAP: Record<
  'sm' | 'md' | 'lg' | 'xl',
  { tile: string; iconClass: string }
> = {
  sm: { tile: 'w-9 h-9 min-w-[36px]', iconClass: 'w-4 h-4' },
  md: { tile: 'w-11 h-11 min-w-[44px]', iconClass: 'w-5 h-5' },
  lg: { tile: 'w-13 h-13 min-w-[52px]', iconClass: 'w-6 h-6' },
  xl: { tile: 'w-16 h-16 min-w-[64px]', iconClass: 'w-7 h-7' },
};

const ROUNDED_MAP: Record<'md' | 'lg' | 'xl' | '2xl' | 'full', string> = {
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  full: 'rounded-full',
};

/**
 * Rounded-square colored tile component for module navigation buttons,
 * matching modern mobile app colorful icon tile design.
 */
export const IconTile: React.FC<IconTileProps> = ({
  icon,
  color = 'success',
  variant = 'soft',
  size = 'md',
  rounded = 'xl',
  badge,
  onClick,
  disabled = false,
  className = '',
  id,
  ariaLabel,
}) => {
  const colorScheme = COLOR_MAP[color] || COLOR_MAP.success;
  const sizeConfig = SIZE_MAP[size] || SIZE_MAP.md;
  const roundedClass = ROUNDED_MAP[rounded] || ROUNDED_MAP.xl;

  const styleClasses =
    variant === 'solid'
      ? `${colorScheme.solidBg} ${colorScheme.solidText} shadow-xs`
      : `${colorScheme.softBg} ${colorScheme.softText} border ${colorScheme.softBorder}`;

  const interactiveClasses = onClick
    ? 'cursor-pointer active:scale-95 transition-transform hover:brightness-95'
    : 'cursor-default';

  const disabledClasses = disabled
    ? 'opacity-50 pointer-events-none cursor-not-allowed'
    : '';

  const renderIcon = () => {
    if (React.isValidElement(icon)) {
      return icon;
    }
    const IconComponent = icon as React.ComponentType<{ className?: string }>;
    return <IconComponent className={sizeConfig.iconClass} />;
  };

  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      id={id}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`relative inline-flex items-center justify-center shrink-0 aspect-square select-none ${sizeConfig.tile} ${roundedClass} ${styleClasses} ${interactiveClasses} ${disabledClasses} ${className}`}
    >
      {renderIcon()}

      {badge !== undefined && badge !== null && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs border-2 border-white dark:border-slate-900">
          {badge}
        </span>
      )}
    </Component>
  );
};

export default IconTile;
