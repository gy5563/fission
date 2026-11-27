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

const JSPDF_UNUSED_STUB = '\0jspdf-unused-stub';
const JSPDF_UNUSED_DEPS = new Set(['html2canvas', 'canvg', 'dompurify']);

// Chrome Web Store MV3 rejects remotely hosted code (Blue Sapphire). jsPDF
// bundles (a) optional dynamic imports for doc.html()/SVG (html2canvas, canvg,
// dompurify — ~379 KB, including core-js's `Function('return this')()`), and
// (b) an unused `pdfobjectnewwindow` output mode that injects a cdnjs <script>.
// Fission only uses vector primitives + `output('blob')`, so stub the unused
// deps and strip the cdnjs script-injection branch at build time.
function sanitizeJspdfForCws() {
  const pdfObjectBranch =
    /case\s*['"`]pdfobjectnewwindow['"`]\s*:[\s\S]*?throw\s+(?:new\s+)?Error\(['"`]The option pdfobjectnewwindow just works in a browser-environment\.['"`]\);/;
  return {
    name: 'sanitize-jspdf-for-cws',
    enforce: 'pre' as const,
    resolveId(id: string) {
      if (JSPDF_UNUSED_DEPS.has(id)) return JSPDF_UNUSED_STUB;
      return null;
    },
    load(id: string) {
      if (id === JSPDF_UNUSED_STUB) return 'export default undefined;';
      return null;
    },
    transform(code: string, id: string) {
      if (!id.includes('jspdf') || !code.includes('pdfobjectnewwindow')) return null;
      const next = code.replace(
        pdfObjectBranch,
        'case "pdfobjectnewwindow": throw new Error("pdfobjectnewwindow is disabled in MV3.");',
      );
      if (next.includes('cdnjs.cloudflare.com') || next.includes('pdfobject.min.js')) {
        throw new Error(`sanitize-jspdf-for-cws failed to strip remote PDFObject URL in ${id}`);
      }
      return { code: next, map: null };
    },
  };
}

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  manifest: {
    name: 'Fission',
    description:
      'Nested to-do lists that float on top — break tasks down 10 levels, check them off, export the tree as PDF or Markdown.',
    minimum_chrome_version: '116',
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
    plugins: [tailwindcss(), sanitizeJspdfForCws()],
  }),
});
