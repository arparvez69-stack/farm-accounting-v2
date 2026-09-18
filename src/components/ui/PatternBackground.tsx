import React from 'react';

interface PatternBackgroundProps {
  className?: string;
  opacity?: string;
}

/**
 * PatternBackground renders a low-opacity (5-8%), repeating inline SVG pattern
 * of subtle line-art farm icons (a leaf, a wheat stalk, and a small cow silhouette)
 * in the app's signature green accent color (#1E5128), creating an elegant watermark texture.
 */
export const PatternBackground: React.FC<PatternBackgroundProps> = ({
  className = '',
  opacity = 'opacity-[0.06] dark:opacity-[0.045]'
}) => {
  return (
    <svg
      id="farm-pattern-background"
      className={`fixed inset-0 w-full h-full pointer-events-none z-0 select-none text-[#1E5128] dark:text-emerald-400 ${opacity} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="farm-watermark-pattern"
          x="0"
          y="0"
          width="140"
          height="140"
          patternUnits="userSpaceOnUse"
        >
          {/* 1. Leaf motif - delicate curved outline and vein */}
          <g transform="translate(18, 18)">
            <path
              d="M 6 34 C 4 18 20 6 32 4 C 34 16 26 34 10 36 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 6 34 C 15 25 24 16 32 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
            <path
              d="M 16 24 C 18 20 22 20 23 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </g>

          {/* 2. Wheat stalk motif - slender upright stem with husks */}
          <g transform="translate(94, 16)">
            <path
              d="M 16 48 L 16 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
            <path
              d="M 16 10 C 13 7 13 4 16 2 C 19 4 19 7 16 10 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path
              d="M 16 18 C 10 16 9 11 13 9 C 15 12 16 15 16 18 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path
              d="M 16 18 C 22 16 23 11 19 9 C 17 12 16 15 16 18 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path
              d="M 16 28 C 9 26 8 20 13 18 C 15 21 16 25 16 28 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path
              d="M 16 28 C 23 26 24 20 19 18 C 17 21 16 25 16 28 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path
              d="M 16 38 C 9 36 8 30 13 28 C 15 31 16 35 16 38 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path
              d="M 16 38 C 23 36 24 30 19 28 C 17 31 16 35 16 38 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
          </g>

          {/* 3. Small cow silhouette line-art */}
          <g transform="translate(42, 82)">
            <path
              d="M 8 30 L 8 23 L 11 23 L 12 17 L 31 17 L 32 23 L 36 23 L 36 30 M 15 30 L 15 24 L 25 24 L 25 30"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 12 17 C 10 15 6 14 4 17 C 3 20 5 23 9 22 L 12 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 8 15 L 6 12 M 11 15 L 12 11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <path
              d="M 31 17 C 33 19 34 23 33 25"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#farm-watermark-pattern)" />
    </svg>
  );
};
