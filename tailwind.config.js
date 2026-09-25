/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic design system palette
        danger: {
          DEFAULT: '#DC2626', // Red - for overdue, critical alerts, errors
          soft: '#FEF2F2',    // Very light red tint for badges/cards
          light: '#FEE2E2',   // Light red for borders/highlights
          border: '#FECACA',  // Border red
          text: '#991B1B',    // Accessible dark red text
          dark: '#B91C1C',
        },
        warning: {
          DEFAULT: '#D97706', // Amber - for due-soon, pending attention
          soft: '#FFFBEB',    // Very light amber tint for badges/cards
          light: '#FEF3C7',   // Light amber for borders/highlights
          border: '#FDE68A',  // Border amber
          text: '#92400E',    // Accessible dark amber text
          dark: '#B45309',
        },
        success: {
          DEFAULT: '#1E5128', // Brand moss green - for done, complete, active
          soft: '#F0FDF4',    // Very light green tint for badges/cards
          light: '#DCFCE7',   // Light green for borders/highlights
          border: '#BBF7D0',  // Border green
          text: '#14532D',    // Accessible dark green text
          dark: '#143C1D',
        },
        info: {
          DEFAULT: '#2563EB', // Blue - for neutral information, status notes
          soft: '#EFF6FF',    // Very light blue tint for badges/cards
          light: '#DBEAFE',   // Light blue for borders/highlights
          border: '#BFDBFE',  // Border blue
          text: '#1E40AF',    // Accessible dark blue text
          dark: '#1D4ED8',
        },
        purple: {
          DEFAULT: '#7C3AED', // Purple - for reports, analytics, analytical info
          soft: '#FAF5FF',    // Very light purple tint for badges/cards
          light: '#F3E8FF',   // Light purple for borders/highlights
          border: '#E9D5FF',  // Border purple
          text: '#6B21A8',    // Accessible dark purple text
          dark: '#581C87',
        },
      },
    },
  },
  plugins: [],
};
