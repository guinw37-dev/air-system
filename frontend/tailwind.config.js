/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Hospital theme — blue / white / green (design tokens)
        primary: {
          DEFAULT: '#1E7FC4',
          dark: '#163E5E',
          soft: '#EAF4FC',
        },
        success: { DEFAULT: '#10A56A', soft: '#EBFAF2' },
        warn:    { DEFAULT: '#E8943A', soft: '#FEF3E2' },
        danger:  { DEFAULT: '#E8503A', soft: '#FCEFEA' },
        surface: '#FFFFFF',
        page:    '#F7FAFD',
        line:    '#E3EDF5',
        ink:     { DEFAULT: '#1A2B38', muted: '#7A93A8' },
      },
      borderRadius: { card: '12px', input: '8px', pill: '20px' },
    },
  },
  plugins: [],
}
