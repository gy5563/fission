import './style.css';
import {
  type Note,
  loadNotes,
  saveNotes,
  addNote,
  patchNoteText,
  removeNote,
  noteTitle,
  sourceDomain,
  relTime,
  toJSONExport,
  toMarkdownExport,
  parseImport,
  mergeNotes,
} from '../../utils/notes';

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

let notes: Note[] = [];
let activeId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

// Static markup only — all user/web-page text goes through textContent.
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="flex h-screen flex-col bg-neutral-50 font-sans text-neutral-900">
    <header class="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
      <span class="text-sm font-semibold">Fission Notes</span>
      <div class="flex items-center gap-2">
        <span id="saved" class="text-xs text-neutral-400"></span>
        <button id="float" class="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700">
          ⧉ Float on top
        </button>
      </div>
    </header>
    <div class="flex min-h-0 flex-1">
      <aside class="flex w-52 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div class="p-2">
          <button id="new" class="w-full rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700">
            + New note
          </button>
        </div>
        <div id="list" class="min-h-0 flex-1 overflow-y-auto"></div>
        <div class="flex gap-1 border-t border-neutral-200 p-2">
          <button id="export-json" title="Export all notes as JSON" class="flex-1 rounded border border-neutral-200 px-1 py-1 text-[10px] text-neutral-500 hover:bg-neutral-100">⬇ JSON</button>
          <button id="export-md" title="Export all notes as Markdown" class="flex-1 rounded border border-neutral-200 px-1 py-1 text-[10px] text-neutral-500 hover:bg-neutral-100">⬇ MD</button>
          <button id="import" title="Import notes from a JSON export" class="flex-1 rounded border border-neutral-200 px-1 py-1 text-[10px] text-neutral-500 hover:bg-neutral-100">⬆ Import</button>
          <input id="import-file" type="file" accept=".json,application/json" class="hidden" />
        </div>
      </aside>
      <main id="editor-pane" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div id="source-bar" class="hidden items-center gap-1 px-3 pt-2 text-xs text-neutral-500">
          <span class="shrink-0">Source:</span>
          <a id="source-link" class="truncate underline hover:text-neutral-900" href="#"></a>
        </div>
        <div id="local-mount" class="min-h-0 flex-1">
          <textarea id="note" placeholder="Type a note…"
            class="h-full w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none"></textarea>
        </div>
        <p id="status" class="px-3 pb-2 text-xs text-neutral-500"></p>
      </main>
    </div>
  </div>
`;

const listEl = document.getElementById('list')!;
const ta = document.getElementById('note') as HTMLTextAreaElement;
const savedEl = document.getElementById('saved')!;
const statusEl = document.getElementById('status')!;
const sourceBar = document.getElementById('source-bar')!;
const sourceLink = document.getElementById('source-link') as HTMLAnchorElement;
const editorPane = document.getElementById('editor-pane')!;
const floatBtn = document.getElementById('float') as HTMLButtonElement;

function active(): Note | undefined {
  return notes.find((n) => n.id === activeId);
}

function renderList() {
  listEl.innerHTML = '';
  if (notes.length === 0) {
    const p = document.createElement('p');
    p.className = 'px-3 py-4 text-xs text-neutral-400';
    p.textContent = 'No notes yet. Select text on any page → right-click → Save to Fission Notes.';
    listEl.appendChild(p);
    return;
  }
  for (const n of notes) {
    const item = document.createElement('div');
    item.className =
      'group flex cursor-pointer items-start gap-1 border-b border-neutral-100 px-2 py-2 ' +
      (n.id === activeId ? 'bg-neutral-100' : 'hover:bg-neutral-50');

    const body = document.createElement('div');
    body.className = 'min-w-0 flex-1';
    const title = document.createElement('p');
    title.className = 'truncate text-xs font-medium';
    title.textContent = noteTitle(n);
    const meta = document.createElement('p');
    meta.className = 'truncate text-[10px] text-neutral-400';
    const dom = sourceDomain(n.sourceUrl);
    meta.textContent = (dom ? dom + ' · ' : '') + relTime(n.updatedAt);
    body.append(title, meta);

    const del = document.createElement('button');
    del.className =
      'rounded px-1 text-xs text-neutral-300 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100';
    del.textContent = '×';
    del.title = 'Delete note';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this note?')) return;
      void (async () => {
        await removeNote(n.id);
        notes = notes.filter((x) => x.id !== n.id);
        if (activeId === n.id) selectNote(notes[0]?.id ?? null);
        else renderList();
      })();
    });

    item.append(body, del);
    item.addEventListener('click', () => selectNote(n.id));
    listEl.appendChild(item);
  }
}

function renderEditor() {
  const n = active();
  ta.disabled = !n;
  ta.value = n?.text ?? '';
  ta.placeholder = n
    ? 'Type a note…'
    : 'No note selected — hit “+ New note”, or select text on any page and right-click → Save to Fission Notes.';
  if (n?.sourceUrl) {
    sourceBar.classList.remove('hidden');
    sourceBar.classList.add('flex');
    sourceLink.textContent = n.sourceTitle || sourceDomain(n.sourceUrl);
    sourceLink.title = n.sourceUrl;
    sourceLink.href = n.sourceUrl;
  } else {
    sourceBar.classList.add('hidden');
    sourceBar.classList.remove('flex');
  }
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  const n = active();
  if (n && ta.value !== n.text) {
    n.text = ta.value;
    n.updatedAt = Date.now();
    void patchNoteText(n.id, ta.value);
  }
}

function selectNote(id: string | null) {
  flushSave(); // persist the note we're leaving before switching
  activeId = id;
  renderEditor();
  renderList();
}

function flashSaved() {
  savedEl.textContent = 'saved';
  setTimeout(() => {
    savedEl.textContent = '';
  }, 1500);
}

ta.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    const n = active();
    if (!n) return;
    n.text = ta.value;
    n.updatedAt = Date.now();
    void patchNoteText(n.id, ta.value).then(flashSaved);
    renderList();
  }, 400);
});

document.getElementById('new')!.addEventListener('click', () => {
  void (async () => {
    flushSave();
    const n = await addNote({ text: '' });
    notes.unshift(n);
    selectNote(n.id);
    ta.focus();
  })();
});

sourceLink.addEventListener('click', (e) => {
  e.preventDefault();
  const n = active();
  if (!n?.sourceUrl) return;
  // Never navigate the note window itself — open the source in a browser tab.
  if (browser.tabs?.create) void browser.tabs.create({ url: n.sourceUrl });
  else window.open(n.sourceUrl, '_blank');
});

// --- Export / import ---------------------------------------------------------
function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const today = () => new Date().toISOString().slice(0, 10);

document.getElementById('export-json')!.addEventListener('click', () => {
  flushSave();
  download(`fission-notes-${today()}.json`, toJSONExport(notes), 'application/json');
  statusEl.textContent = `Exported ${notes.length} note${notes.length === 1 ? '' : 's'} as JSON.`;
});

document.getElementById('export-md')!.addEventListener('click', () => {
  flushSave();
  download(`fission-notes-${today()}.md`, toMarkdownExport(notes), 'text/markdown');
  statusEl.textContent = `Exported ${notes.length} note${notes.length === 1 ? '' : 's'} as Markdown.`;
});

const fileInput = document.getElementById('import-file') as HTMLInputElement;
document.getElementById('import')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  void (async () => {
    try {
      const incoming = parseImport(JSON.parse(await file.text()));
      const { merged, added, updated } = mergeNotes(notes, incoming);
      await saveNotes(merged);
      notes = merged;
      if (!active()) selectNote(notes[0]?.id ?? null);
      else renderList();
      statusEl.textContent = `Imported: ${added} new, ${updated} updated.`;
    } catch (err) {
      statusEl.textContent = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  })();
});

// --- Cross-window sync (captures land here while this window is open) ---------
browser.storage?.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.notes) return;
  const next = changes.notes.newValue;
  if (!Array.isArray(next)) return;
  notes = next as Note[];
  if (!active()) {
    selectNote(notes[0]?.id ?? null);
  } else {
    renderList();
    // Adopt external edits to the open note only when not mid-keystroke.
    const n = active()!;
    if (document.activeElement !== ta && ta.value !== n.text) renderEditor();
  }
});

// --- Document Picture-in-Picture ----------------------------------------------
function mirrorStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.href) {
        target.head.appendChild(
          Object.assign(target.createElement('link'), { rel: 'stylesheet', href: sheet.href }),
        );
      } else {
        const rules = Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join('\n');
        if (rules) target.head.appendChild(target.createElement('style')).textContent = rules;
      }
    } catch {
      /* cross-origin sheet — nothing we can copy */
    }
  }
}

async function floatIntoPip() {
  const dpi = (window as Window & { documentPictureInPicture?: DocPip }).documentPictureInPicture;
  if (!dpi) {
    statusEl.textContent = 'Document PiP not supported here (Chrome 116+).';
    return;
  }
  const existing = dpi.window;
  if (existing && !existing.closed) {
    existing.focus();
    return;
  }
  try {
    const win = await dpi.requestWindow({ width: 360, height: 320, copyStyleSheets: true });
    win.document.title = 'Fission Notes';
    mirrorStyles(win.document);
    win.document.body.className = 'm-0 flex h-screen flex-col bg-neutral-50 font-sans text-neutral-900';
    // Move the SAME editor pane into the PiP window — live state rides along,
    // and picking notes in the list keeps updating the floating editor.
    const originalParent = editorPane.parentElement!;
    win.document.body.append(editorPane);
    floatBtn.textContent = '⧉ Floating…';
    statusEl.textContent = 'floating ✓ — close the PiP window to dock it back';
    win.addEventListener('pagehide', () => {
      originalParent.append(editorPane);
      floatBtn.textContent = '⧉ Float on top';
      statusEl.textContent = '';
    });
  } catch (err) {
    statusEl.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

floatBtn.addEventListener('click', () => void floatIntoPip());

// --- Init ---------------------------------------------------------------------
void (async () => {
  notes = await loadNotes();
  selectNote(notes[0]?.id ?? null);
})();

window.addEventListener('pagehide', flushSave);
