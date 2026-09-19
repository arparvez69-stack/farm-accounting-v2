import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, X, Check } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
  code?: string;
  secondaryLabel?: string;
  subtitle?: string;
}

export interface SearchableSelectProps {
  id?: string;
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  required?: boolean;
  autoFocus?: boolean;
  allowClear?: boolean;
  maxResults?: number;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  id,
  options,
  value,
  onChange,
  placeholder = 'নির্বাচন করুন বা খুঁজুন...',
  disabled = false,
  className = '',
  inputClassName = '',
  required = false,
  autoFocus = false,
  allowClear = false,
  maxResults = 8
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Find currently selected option
  const selectedOption = useMemo(() => {
    return options.find((opt) => opt.value === value);
  }, [options, value]);

  // Sync display text when value changes or when dropdown opens/closes
  useEffect(() => {
    if (!isOpen) {
      if (selectedOption) {
        setSearchQuery(selectedOption.label);
      } else {
        setSearchQuery('');
      }
    }
  }, [isOpen, selectedOption]);

  // Close dropdown on outside click or escape
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        if (selectedOption) {
          setSearchQuery(selectedOption.label);
        } else {
          setSearchQuery('');
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedOption]);

  // Filter options based on query (checks code, label, secondaryLabel)
  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || (selectedOption && searchQuery.trim() === selectedOption.label.trim())) {
      return options;
    }
    return options.filter((opt) => {
      const codeMatch = opt.code ? opt.code.toLowerCase().includes(q) : false;
      const labelMatch = opt.label ? opt.label.toLowerCase().includes(q) : false;
      const secMatch = opt.secondaryLabel ? opt.secondaryLabel.toLowerCase().includes(q) : false;
      const valMatch = opt.value ? opt.value.toLowerCase().includes(q) : false;
      return codeMatch || labelMatch || secMatch || valMatch;
    });
  }, [options, searchQuery, selectedOption]);

  // Display limited results when actively filtering, or full list with maxResults slice
  const displayedOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const isActivelyFiltering = q && (!selectedOption || q !== selectedOption.label.trim().toLowerCase());
    if (isActivelyFiltering) {
      return filteredOptions.slice(0, maxResults);
    }
    // When empty or not actively filtering, show up to maxResults or full list
    return filteredOptions.slice(0, 30);
  }, [filteredOptions, searchQuery, selectedOption, maxResults]);

  // Check positioning to avoid keyboard occlusion on mobile
  const adjustDropdownPosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    // If space below is less than 220px and space above is larger, open upward
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      setOpenUpward(true);
    } else {
      setOpenUpward(false);
    }

    // Scroll into view on mobile so input stays above on-screen keyboard
    if (window.innerWidth < 768) {
      setTimeout(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 150);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleViewportChange = () => {
      adjustDropdownPosition();
    };

    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);
    window.addEventListener('resize', handleViewportChange);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [isOpen]);

  const handleFocus = () => {
    if (disabled) return;
    setIsOpen(true);
    adjustDropdownPosition();
  };

  const handleClick = () => {
    if (disabled) return;
    if (!isOpen) {
      setIsOpen(true);
      adjustDropdownPosition();
    }
  };

  const handleSelect = (val: string) => {
    onChange(val);
    const chosen = options.find((opt) => opt.value === val);
    if (chosen) {
      setSearchQuery(chosen.label);
    }
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchQuery('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Input container */}
      <div
        className={`relative flex items-center bg-white dark:bg-slate-900 border rounded-xl transition-all ${
          isOpen
            ? 'border-blue-600 ring-2 ring-blue-600/20 dark:border-blue-500'
            : 'border-gray-300 dark:border-slate-700 hover:border-gray-400'
        } ${disabled ? 'opacity-60 bg-gray-100 cursor-not-allowed' : 'cursor-text'}`}
        onClick={handleClick}
      >
        <div className="pl-3 text-gray-400 pointer-events-none shrink-0">
          <Search className="w-4 h-4" />
        </div>

        <input
          ref={inputRef}
          id={id}
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={handleFocus}
          placeholder={placeholder}
          disabled={disabled}
          required={required && !value}
          autoFocus={autoFocus}
          autoComplete="off"
          className={`w-full bg-transparent px-2.5 py-2 text-[14px] text-gray-900 dark:text-slate-100 placeholder:text-gray-400 focus:outline-none min-h-[40px] ${inputClassName}`}
        />

        {/* Selected Code badge if present and input is not being edited */}
        {selectedOption?.code && !isOpen && (
          <span className="text-[11px] font-mono text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded mr-1.5 shrink-0">
            {selectedOption.code}
          </span>
        )}

        <div className="flex items-center pr-2.5 gap-1 shrink-0">
          {allowClear && value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
              title="মুছুন"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              if (isOpen) {
                setIsOpen(false);
              } else {
                setIsOpen(true);
                adjustDropdownPosition();
                inputRef.current?.focus();
              }
            }}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-200 ${
                isOpen ? 'rotate-180 text-blue-600' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* Floating Dropdown Results */}
      {isOpen && (
        <div
          ref={listRef}
          className={`absolute left-0 right-0 z-[70] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden max-h-64 sm:max-h-72 overflow-y-auto ${
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {displayedOptions.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-500 dark:text-slate-400">
              কোনো ফলাফল পাওয়া যায়নি
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-slate-800">
              {displayedOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <div
                    key={opt.value}
                    onMouseDown={(e) => {
                      e.preventDefault(); // prevents blur before selection
                      handleSelect(opt.value);
                    }}
                    onClick={() => handleSelect(opt.value)}
                    className={`px-3.5 py-2.5 flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200'
                        : 'hover:bg-gray-50 dark:hover:bg-slate-800/60 text-gray-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        {/* Bengali name in larger/bolder text */}
                        <span className="font-bold text-gray-900 dark:text-slate-100 text-[14px] leading-snug">
                          {opt.label}
                        </span>
                        {/* Numeric code shown small and muted beside it */}
                        {opt.code && (
                          <span className="text-xs text-gray-400 dark:text-slate-500 font-mono font-normal">
                            ({opt.code})
                          </span>
                        )}
                      </div>

                      {/* Secondary label or subtitle below */}
                      {(opt.secondaryLabel || opt.subtitle) && (
                        <div className="text-[12px] text-gray-500 dark:text-slate-400 mt-0.5 truncate">
                          {opt.secondaryLabel} {opt.subtitle ? `• ${opt.subtitle}` : ''}
                        </div>
                      )}
                    </div>

                    {isSelected && (
                      <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
