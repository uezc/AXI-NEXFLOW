/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'apple-blue': '#0A84FF',
        'apple-panel': 'rgba(28, 28, 30, 0.7)',
      },
      backdropBlur: {
        'md': '12px',
      },
      backdropSaturate: {
        '150': '150%',
      },
    },
  },
  plugins: [],
}
