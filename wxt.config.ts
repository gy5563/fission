import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// `pnpm dev` needs an unbranded Chromium: branded Google Chrome (>=137) blocks
// --load-extension, so web-ext's default binary resolution cannot load the
// unpacked extension. Install once (any OS):
//   npx @puppeteer/browsers install chromium@latest --path ~/.hermes/browsers
// or point FISSION_CHROMIUM at any Chromium / Chrome-for-Testing binary.
function devChromium(): string | undefined {
  const override = process.env.FISSION_CHROMIUM;
  if (override && existsSync(override)) return override;
  const os = platform();
  const prefix = os === 'win32' ? 'win' : os === 'darwin' ? 'mac' : 'linux';
  const rel =
    os === 'win32'
      ? ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']
      : os === 'darwin'
        ? [
            'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
            'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
          ]
        : ['chrome-linux64/chrome', 'chrome-linux/chrome'];
  const root = join(homedir(), '.hermes', 'browsers', 'chromium');
  // Prefer an explicit `current` symlink; otherwise pick the newest installed
  // build dir (win64-<rev>, mac_arm-<rev>, linux-<rev>, …). No symlink needed.
  const dirs = [join(root, 'current')];
  try {
    const builds = readdirSync(root)
      .filter((d) => d.startsWith(prefix))
      .sort()
      .reverse()
      .map((d) => join(root, d));
    dirs.push(...builds);
  } catch {
    /* not installed yet — fall through to web-ext's default resolution */
  }
  for (const dir of dirs) {
    for (const r of rel) {
      const p = join(dir, r);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}
const CHROMIUM = devChromium();

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
    ...(CHROMIUM ? { binaries: { chrome: CHROMIUM } } : {}),
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
