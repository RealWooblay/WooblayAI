import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://wooblay-alb-1564688078.us-east-1.elb.amazonaws.com',
      '/health': 'http://wooblay-alb-1564688078.us-east-1.elb.amazonaws.com',
    },
  },
});
