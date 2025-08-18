import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

const isProd = process.env.NODE_ENV === 'production';

export default defineConfig({
  integrations: [tailwind(), react()],
  site: isProd
    ? 'https://escapeResearchZero.github.io/sunsetPredictor/'
    : 'http://localhost:4321/',
  base: isProd ? '/sunsetPredictor/' : '/', // 线上用子路径，本地用根路径
});

