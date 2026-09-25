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
   * Optional full illustration image URL to display instead of / above the small icon
   */
  illustration?: string;
  /**
   * Alt text for the illustration image
   */
  illustrationAlt?: string;
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
  illustration,
  illustrationAlt = 'Empty state illustration',
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
    return <IconComponent className={compact ? 'w-5 h-5 text-gray-500 dark:text-slate-400' : 'w-6 h-6 text-gray-600 dark:text-slate-300'} />;
  };

  const renderActionIcon = (actionIcon: EmptyStateAction['icon']) => {
    if (!actionIcon) return null;
    if (React.isValidElement(actionIcon)) {
      return actionIcon;
    }
    const IconComponent = actionIcon as React.ComponentType<{ className?: string }>;
    return <IconComponent className="w-4 h-4 shrink-0" />;
  };

  return (
    <div
      id={id}
      className={`flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40 ${
        compact ? 'p-4 sm:p-5' : 'p-6 sm:p-7'
      } ${className}`}
    >
      {icon ? (
        <div
          className={`rounded-xl bg-white dark:bg-slate-800 border border-gray-200/90 dark:border-slate-700/80 shadow-2xs flex items-center justify-center mb-3 shrink-0 ${
            compact ? 'w-10 h-10' : 'w-12 h-12'
          }`}
        >
          {renderIcon()}
        </div>
      ) : null}

      <h3
        className={`font-bold text-gray-900 dark:text-slate-100 ${
          compact ? 'text-xs sm:text-sm' : 'text-sm sm:text-base'
        }`}
      >
        {heading}
      </h3>

      {message && (
        <p
          className={`text-gray-500 dark:text-slate-400 mt-1 max-w-md mx-auto leading-relaxed ${
            compact ? 'text-[11px] sm:text-xs' : 'text-xs sm:text-sm'
          }`}
        >
          {message}
        </p>
      )}

      {(action || actionButton) && (
        <div className="mt-3.5">
          {actionButton ? (
            actionButton
          ) : action ? (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] active:scale-98 text-white text-xs sm:text-sm font-semibold shadow-xs transition-all cursor-pointer min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
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
