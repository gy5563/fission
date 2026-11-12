import './style.css';

// Minimal typing — TS's DOM lib may not ship DocumentPictureInPicture yet.
interface DocPip {
  readonly window: Window | null;
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    copyStyleSheets?: boolean;
  }): Promise<Window>;
}

const area = browser.storage?.local;
const note = { text: '' };
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist(text: string) {
  note.text = text;
  void area?.set({ pipNote: text });
  const saved = document.getElementById('saved');
  if (saved) {
    saved.textContent = 'saved';
    setTimeout(() => {
      saved.textContent = '';
    }, 1500);
  }
}

function mirrorStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.href) {
        target.head.appendChild(
          Object.assign(target.createElement('link'), { rel: 'stylesheet', href: sheet.href }),
        );
      } else {
        const rules = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
        if (rules) target.head.appendChild(target.createElement('style')).textContent = rules;
      }
    } catch {
      /* cross-origin sheet — nothing we can copy */
    }
  }
}

async function floatIntoPip() {
  const status = document.getElementById('status')!;
  const mount = document.getElementById('local-mount')!;
  const dpi = (window as Window & { documentPictureInPicture?: DocPip }).documentPictureInPicture;
  if (!dpi) {
    status.textContent = 'Document PiP not supported here (Chrome 116+).';
    return;
  }
  const existing = dpi.window;
  if (existing && !existing.closed) {
    existing.focus();
    return;
  }
  try {
    const win = await dpi.requestWindow({ width: 320, height: 240, copyStyleSheets: true });
    win.document.title = 'Fission Notes';
    mirrorStyles(win.document);
    win.document.body.className = 'm-0 h-screen bg-neutral-50 font-sans text-neutral-900';
    // Move the SAME editor node into the PiP window — live state rides along.
    const originalParent = mount.parentElement!;
    win.document.body.append(mount);

    status.textContent = 'floating ✓ (close the PiP window to bring it back)';
    win.addEventListener('pagehide', () => {
      originalParent.append(mount); // move the editor back, same live node
      status.textContent = '';
    });
  } catch (err) {
    status.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="flex h-screen flex-col bg-neutral-50 font-sans text-neutral-900">
    <header class="flex items-center justify-between px-3 py-2">
      <span class="text-sm font-semibold">Fission Notes</span>
      <div class="flex items-center gap-2">
        <span id="saved" class="text-xs text-neutral-400"></span>
        <button id="float" class="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700">
          ⧉ Float on top
        </button>
      </div>
    </header>
    <div id="local-mount" class="min-h-0 flex-1">
      <textarea id="note" placeholder="Type a note…"
        class="h-full w-full resize-none border-0 bg-transparent px-3 pb-3 text-sm outline-none"></textarea>
    </div>
    <p id="status" class="px-3 pb-2 text-xs text-neutral-500"></p>
  </div>
`;

const ta = document.getElementById('note') as HTMLTextAreaElement;
void area?.get('pipNote').then((res) => {
  ta.value = (res.pipNote as string | undefined) ?? '';
  note.text = ta.value;
});
ta.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(ta.value), 400);
});
document.getElementById('float')!.addEventListener('click', () => void floatIntoPip());
window.addEventListener('pagehide', () => persist(ta.value));
