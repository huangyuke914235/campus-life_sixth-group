import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FFFBF5',
        beige: '#F7F2E9',
        orange: { DEFAULT: '#FF8A4C', deep: '#E96F35', light: '#FFE7D6' },
        sage: { DEFAULT: '#78A68A', deep: '#4F7D61', light: '#E7F1EA' },
        ink: '#252923',
        muted: '#6B7167',
        line: '#EDE6DA',
      },
      borderRadius: { card: '18px', pill: '24px' },
      boxShadow: { soft: '0 8px 24px rgba(37,41,35,0.08)' },
      fontFamily: { sans: ['Noto Sans SC', 'Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
