import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist-electron',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/main/index.ts'),
        preload: path.resolve(__dirname, 'src/preload/index.ts'),
      },
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
      },
    },
  },
});
