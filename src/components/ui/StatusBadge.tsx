import React from 'react';

export type BadgeStatus = 'overdue' | 'due-soon' | 'done' | 'pending' | 'info';

export interface StatusBadgeProps {
  /**
   * The status determining the semantic color
   */
  status: BadgeStatus;
  /**
   * Label text to display inside badge. If omitted, children is used.
   */
  label?: string;
  /**
   * Optional custom children if not using label prop
   */
  children?: React.ReactNode;
  /**
   * Optional icon to render inside the badge
   */
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode;
  /**
   * Show a colored status dot indicator. Defaults to true.
   */
  dot?: boolean;
  /**
   * Size variant. Defaults to 'sm'.
   */
  size?: 'sm' | 'md';
  /**
   * Optional extra className
   */
  className?: string;
  /**
   * Optional HTML id
   */
  id?: string;
}

const STATUS_CONFIG: Record<
  BadgeStatus,
  {
    bg: string;
    text: string;
    border: string;
    dot: string;
    defaultLabel: string;
  }
> = {
  overdue: {
    bg: 'bg-red-50 dark:bg-red-950/40',
    text: 'text-red-800 dark:text-red-300',
    border: 'border-red-200 dark:border-red-900/60',
    dot: 'bg-red-600 dark:bg-red-400',
    defaultLabel: 'Overdue',
  },
  'due-soon': {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-800 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-900/60',
    dot: 'bg-amber-500 dark:bg-amber-400',
    defaultLabel: 'Due Soon',
  },
  done: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-[#14532D] dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-900/60',
    dot: 'bg-[#1E5128] dark:bg-emerald-400',
    defaultLabel: 'Done',
  },
  pending: {
    bg: 'bg-orange-50 dark:bg-orange-950/40',
    text: 'text-orange-800 dark:text-orange-300',
    border: 'border-orange-200 dark:border-orange-900/60',
    dot: 'bg-orange-500 dark:bg-orange-400',
    defaultLabel: 'Pending',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    text: 'text-blue-800 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-900/60',
    dot: 'bg-blue-600 dark:bg-blue-400',
    defaultLabel: 'Info',
  },
};

/**
 * Small reusable pill-shaped badge component for status indication.
 * Renders consistent semantic colors for overdue, due-soon, done, pending, and info.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  children,
  icon,
  dot = true,
  size = 'sm',
  className = '',
  id,
}) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.info;
  const displayText = label ?? children ?? config.defaultLabel;

  const sizeClasses =
    size === 'md'
      ? 'px-3 py-1 text-[13px] gap-1.5'
      : 'px-2.5 py-0.5 text-xs gap-1.5';

  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) {
      return icon;
    }
    const IconComponent = icon as React.ComponentType<{ className?: string }>;
    return <IconComponent className={size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />;
  };

  return (
    <span
      id={id}
      className={`inline-flex items-center font-medium rounded-full border whitespace-nowrap select-none transition-colors ${config.bg} ${config.text} ${config.border} ${sizeClasses} ${className}`}
    >
      {dot && !icon && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot}`}
          aria-hidden="true"
        />
      )}
      {renderIcon()}
      <span>{displayText}</span>
    </span>
  );
};

export default StatusBadge;
