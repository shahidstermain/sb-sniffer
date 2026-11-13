/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        supabase: {
          green: '#3ECF8E',
          dark: '#1C1C1C',
          darker: '#121212',
          border: '#2E2E2E',
        }
      }
    },
  },
  plugins: [],
}
