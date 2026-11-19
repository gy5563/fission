import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// `pnpm dev` needs a real Chromium: branded Google Chrome (>=137) blocks
// --load-extension, so web-ext's default binary resolution cannot load the
// unpacked extension. Install once with:
//   npx @puppeteer/browsers install chromium@latest --path ~/.hermes/browsers
//   ln -sfn mac_arm-<build> ~/.hermes/browsers/chromium/current
const CHROMIUM = `${homedir()}/.hermes/browsers/chromium/current/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  manifest: {
    name: 'Fission',
    description:
      'Nested to-do lists that float on top — break tasks down 10 levels, check them off, export the tree as PDF or Markdown.',
    permissions: ['storage'],
  },
  // Persistent dev profile: web-ext otherwise runs Chrome in a throwaway temp
  // profile, wiping chrome.storage.local (topics, progress) on every dev restart.
  webExt: {
    chromiumProfile: '.dev-profile',
    keepProfileChanges: true,
    ...(existsSync(CHROMIUM) ? { binaries: { chrome: CHROMIUM } } : {}),
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
