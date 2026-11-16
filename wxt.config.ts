import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  manifest: {
    permissions: ['storage', 'contextMenus'],
    commands: {
      'save-selection': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Save selected text to Fission Notes',
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
