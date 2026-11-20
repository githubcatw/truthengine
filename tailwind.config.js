/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FAF8F4',
        ink: '#23262B',
        muted: '#6B6F76',
        rule: '#E4E0D8',
        navy: '#1F3A5F',
        defender: '#1E6E78',
        prosecutor: '#A4492F',
        judge: '#2B2B2B',
        correct: '#2F6B45',
        wrong: '#A23B35',
      },
      fontFamily: {
        sans: ['"Noto Sans"', '"Noto Sans Armenian"', 'system-ui', 'sans-serif'],
        pixel: ['"Press Start 2P"', 'monospace'],
      },
    },
  },
  plugins: [],
};
