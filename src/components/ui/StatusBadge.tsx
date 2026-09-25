import React from 'react';

export type BadgeStatus =
  | 'overdue'
  | 'due-soon'
  | 'done'
  | 'pending'
  | 'info'
  | 'success'
  | 'danger'
  | 'error'
  | 'warning'
  | 'report'
  | 'analytics'
  | 'purple'
  | 'neutral';

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
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-800 dark:text-rose-300',
    border: 'border-rose-200 dark:border-rose-900/60',
    dot: 'bg-rose-600 dark:bg-rose-400',
    defaultLabel: 'Overdue',
  },
  danger: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-800 dark:text-rose-300',
    border: 'border-rose-200 dark:border-rose-900/60',
    dot: 'bg-rose-600 dark:bg-rose-400',
    defaultLabel: 'Critical',
  },
  error: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-800 dark:text-rose-300',
    border: 'border-rose-200 dark:border-rose-900/60',
    dot: 'bg-rose-600 dark:bg-rose-400',
    defaultLabel: 'Error',
  },
  'due-soon': {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-800 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-900/60',
    dot: 'bg-amber-500 dark:bg-amber-400',
    defaultLabel: 'Due Soon',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-800 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-900/60',
    dot: 'bg-amber-500 dark:bg-amber-400',
    defaultLabel: 'Warning',
  },
  pending: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-800 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-900/60',
    dot: 'bg-amber-500 dark:bg-amber-400',
    defaultLabel: 'Pending',
  },
  done: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-[#14532D] dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-900/60',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
    defaultLabel: 'Done',
  },
  success: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-[#14532D] dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-900/60',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
    defaultLabel: 'Success',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    text: 'text-blue-800 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-900/60',
    dot: 'bg-blue-600 dark:bg-blue-400',
    defaultLabel: 'Info',
  },
  report: {
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    text: 'text-purple-800 dark:text-purple-300',
    border: 'border-purple-200 dark:border-purple-900/60',
    dot: 'bg-purple-600 dark:bg-purple-400',
    defaultLabel: 'Report',
  },
  analytics: {
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    text: 'text-purple-800 dark:text-purple-300',
    border: 'border-purple-200 dark:border-purple-900/60',
    dot: 'bg-purple-600 dark:bg-purple-400',
    defaultLabel: 'Analytics',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    text: 'text-purple-800 dark:text-purple-300',
    border: 'border-purple-200 dark:border-purple-900/60',
    dot: 'bg-purple-600 dark:bg-purple-400',
    defaultLabel: 'Report',
  },
  neutral: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-200 dark:border-slate-700',
    dot: 'bg-slate-500 dark:bg-slate-400',
    defaultLabel: 'Standard',
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
