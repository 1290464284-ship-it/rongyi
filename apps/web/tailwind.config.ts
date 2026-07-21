import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#F5F7FA',
        foreground: '#2C3E50',
        muted: { DEFAULT: '#E8ECF0', foreground: '#6B7C93' },
        border: '#DCE2E8',
        primary: { DEFAULT: '#1E5AA8', foreground: '#FFFFFF' },
        primaryLight: { DEFAULT: '#3A7BC8', foreground: '#FFFFFF' },
        primaryDark: { DEFAULT: '#154A8A', foreground: '#FFFFFF' },
        secondary: { DEFAULT: '#00B3AA', foreground: '#FFFFFF' },
        destructive: { DEFAULT: '#E74C3C', foreground: '#FFFFFF' },
        success: { DEFAULT: '#27AE60', foreground: '#FFFFFF' },
        warning: { DEFAULT: '#F39C12', foreground: '#FFFFFF' },
        info: { DEFAULT: '#3498DB', foreground: '#FFFFFF' },
      },
      fontFamily: {
        sans: ['Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'WenQuanYi Micro Hei', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(0, 0, 0, 0.08)',
        'card': '0 4px 12px rgba(0, 0, 0, 0.1)',
        'dropdown': '0 6px 16px rgba(0, 0, 0, 0.12)',
      },
      fontSize: {
        'page-title': ['1.5rem', { lineHeight: '2rem', fontWeight: '700' }],
        'section-title': ['1.125rem', { lineHeight: '1.75rem', fontWeight: '600' }],
      },
      radius: { lg: '6px', md: '4px', sm: '2px' },
    },
  },
  plugins: [],
} satisfies Config;
