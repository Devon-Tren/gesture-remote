const { plugins } = require('./postcss.config');

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      "./src/**/*.{js,ts,jsx,tsx}", // scan all your app files
    ],
    theme: {
      extend: {
        keyframes: {
          float: {
            "0%": { transform: "translateY(0px)" },
            "50%": { transform: "translateY(-60px)" },
            "100%": { transform: "translateY(0px)" },
          },
        },
        animation: {
          float: "float 12s ease-in-out infinite",
        },
      },
    },
    plugins: [],
  };

  