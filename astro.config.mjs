import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

// Multi-target config: GitHub Pages (subpath) and Vercel (root)
const isProd = process.env.NODE_ENV === 'production';
const isVercel = !!process.env.VERCEL;              // Vercel sets this env automatically
const GH_BASE = '/sunsetPredictor/';

// If you bind a custom domain on Vercel, you may set SITE_URL to override below.
const SITE_URL = process.env.SITE_URL;

// For GitHub Pages production build we keep the subpath base.
// For Vercel production build we serve from root.
export default defineConfig({
  integrations: [tailwind(), react()],
  site: SITE_URL
    ? SITE_URL
    : (isProd
        ? (isVercel ? 'https://example-vercel-domain/' : 'https://escapeResearchZero.github.io/sunsetPredictor/')
        : 'http://localhost:4321/'),
  base: isProd
    ? (isVercel ? '/' : GH_BASE)
    : '/',
});
