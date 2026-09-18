import React from 'react';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode;
  disabled?: boolean;
}

export interface EmptyStateProps {
  /**
   * The central icon representing the empty list (Lucide icon or ReactNode)
   */
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode;
  /**
   * Primary title/heading
   */
  heading: string;
  /**
   * Short supporting message explaining why the list is empty or how to populate it
   */
  message?: string;
  /**
   * Optional primary action button configuration
   */
  action?: EmptyStateAction;
  /**
   * Alternative custom action button or element
   */
  actionButton?: React.ReactNode;
  /**
   * Compact padding for smaller nested containers or cards. Defaults to false.
   */
  compact?: boolean;
  /**
   * Optional extra container class
   */
  className?: string;
  /**
   * Optional HTML id
   */
  id?: string;
}

/**
 * Reusable empty state component (icon + heading + short message + optional action button)
 * for any list or table with zero items.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  heading,
  message,
  action,
  actionButton,
  compact = false,
  className = '',
  id,
}) => {
  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) {
      return icon;
    }
    const IconComponent = icon as React.ComponentType<{ className?: string }>;
    return <IconComponent className={compact ? 'w-6 h-6' : 'w-8 h-8'} />;
  };

  const renderActionIcon = (actionIcon: EmptyStateAction['icon']) => {
    if (!actionIcon) return null;
    if (React.isValidElement(actionIcon)) {
      return actionIcon;
    }
    const IconComponent = actionIcon as React.ComponentType<{ className?: string }>;
    return <IconComponent className="w-4 h-4" />;
  };

  return (
    <div
      id={id}
      className={`flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-gray-200 dark:border-slate-700/80 bg-gray-50/50 dark:bg-slate-900/30 ${
        compact ? 'p-6' : 'p-8 sm:p-12'
      } ${className}`}
    >
      {icon && (
        <div
          className={`rounded-2xl bg-white dark:bg-slate-800 border border-gray-200/80 dark:border-slate-700 shadow-xs text-gray-400 dark:text-gray-500 flex items-center justify-center mb-3.5 ${
            compact ? 'w-12 h-12' : 'w-14 h-14'
          }`}
        >
          {renderIcon()}
        </div>
      )}

      <h3
        className={`font-semibold text-gray-900 dark:text-gray-100 ${
          compact ? 'text-sm' : 'text-base'
        }`}
      >
        {heading}
      </h3>

      {message && (
        <p
          className={`text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto leading-relaxed ${
            compact ? 'text-xs' : 'text-sm'
          }`}
        >
          {message}
        </p>
      )}

      {(action || actionButton) && (
        <div className="mt-4">
          {actionButton ? (
            actionButton
          ) : action ? (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] active:scale-98 text-white text-sm font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {renderActionIcon(action.icon)}
              <span>{action.label}</span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
