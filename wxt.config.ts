import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  manifest: {
    name: 'Fission',
    description:
      'Nested to-do lists that float on top — break tasks down 3 levels, check them off, export the tree as PDF or Markdown.',
    permissions: ['storage'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
