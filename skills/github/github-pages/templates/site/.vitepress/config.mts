import { defineConfig } from 'vitepress';

// `/<repository>/` on GitHub Pages; the workflow sets SITE_BASE.
const base = process.env['SITE_BASE'] ?? '/';

export default defineConfig({
  title: 'My project',
  description: 'Documentation of my project.',
  lang: 'en',
  base,
  cleanUrls: true,
  // A link that leads nowhere fails the build.
  ignoreDeadLinks: false,
});
