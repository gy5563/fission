import './style.css';
import {
  type Topic,
  type TaskNode,
  type CheckState,
  MAX_DEPTH,
  loadTopics,
  saveTopics,
  newTopic,
  newNode,
  locate,
  addTask,
  removeTask,
  canIndent,
  indentBlockReason,
  indentTask,
  canOutdent,
  outdentTask,
  progress,
  topicProgress,
  countNodes,
  checkState,
  toggleDone,
  normalizeDone,
  touch,
  toMarkdown,
  slugify,
} from '../../utils/tree';
import { downloadText } from '../../utils/download';

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

let topics: Topic[] = [];
let activeId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let pipWin: Window | null = null;

// UI-only state: which rows the user pinned open (full text). Survives re-renders.
const expandedIds = new Set<string>();
const INDENT = 18; // px per tier
const CLAMP_H = 44; // 2 lines (leading-5 = 20px) + 4px vertical padding

// Static markup only — all user text goes through .value / textContent.
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="flex h-screen bg-neutral-50 font-sans text-neutral-900">
    <aside class="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div class="flex items-center justify-between px-3 py-2">
        <span class="text-sm font-bold tracking-tight">Fission</span>
        <span id="saved" class="text-xs text-neutral-400"></span>
      </div>
      <div class="px-2 pb-2">
        <button id="new-topic" class="w-full rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700">
          + New topic
        </button>
      </div>
      <div id="topics" class="min-h-0 flex-1 overflow-y-auto"></div>
    </aside>
    <main id="pane" class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div id="empty" class="flex flex-1 items-center justify-center p-6 text-center text-sm text-neutral-400">
        Create a topic to start breaking things down.
      </div>
      <div id="topic-view" class="hidden min-h-0 flex-1 flex-col">
        <header class="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <input id="topic-title" title="Rename topic"
            class="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:border-neutral-200 focus:border-neutral-400" />
          <span id="topic-progress" class="shrink-0 text-xs text-neutral-500"></span>
          <button id="export-pdf" title="Export the visual tree (with checked states) as PDF"
            class="shrink-0 rounded border border-neutral-200 px-2 py-1 text-[10px] text-neutral-500 hover:bg-neutral-100">⬇ PDF</button>
          <button id="export-md" title="Export as a Markdown checklist"
            class="shrink-0 rounded border border-neutral-200 px-2 py-1 text-[10px] text-neutral-500 hover:bg-neutral-100">⬇ MD</button>
          <button id="float" class="shrink-0 rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700">⧉ Float</button>
        </header>
        <div id="tree-scroll" class="min-h-0 flex-1 overflow-auto p-3">
          <div id="tree"></div>
          <button id="add-root"
            class="mt-1 rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-700">
            + Add task
          </button>
        </div>
        <p id="status" class="px-3 pb-2 text-xs text-neutral-500"></p>
      </div>
      <div id="pip-placeholder" class="hidden flex-1 items-center justify-center p-6 text-center text-sm text-neutral-400">
        Floating in Picture-in-Picture — close that window to dock it back here.
      </div>
    </main>
  </div>
`;

const topicsEl = document.getElementById('topics')!;
const treeEl = document.getElementById('tree')!;
const titleInput = document.getElementById('topic-title') as HTMLInputElement;
const progressEl = document.getElementById('topic-progress')!;
const savedEl = document.getElementById('saved')!;
const statusEl = document.getElementById('status')!;
const floatBtn = document.getElementById('float') as HTMLButtonElement;

function active(): Topic | undefined {
  return topics.find((t) => t.id === activeId);
}

function setStatus(msg: string) {
  statusEl.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.textContent = '';
  }, 3000);
}

function flashSaved() {
  savedEl.textContent = 'saved';
  setTimeout(() => {
    savedEl.textContent = '';
  }, 1500);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveTopics(topics).then(flashSaved);
  }, 400);
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    void saveTopics(topics);
  }
}

/** Bring an element into view within the scrolling tree pane (the "snap"). */
function snapTo(el: HTMLElement) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// --- Sidebar: topics -----------------------------------------------------------
function renderTopics() {
  topicsEl.innerHTML = '';
  if (topics.length === 0) {
    const p = document.createElement('p');
    p.className = 'px-3 py-4 text-xs text-neutral-400';
    p.textContent = 'No topics yet. A topic is a project or area you want to break down.';
    topicsEl.appendChild(p);
    return;
  }
  for (const t of topics) {
    const row = document.createElement('div');
    row.className =
      'group flex cursor-pointer items-center gap-1 border-b border-neutral-100 px-2 py-2 ' +
      (t.id === activeId ? 'bg-neutral-100' : 'hover:bg-neutral-50');

    const body = document.createElement('div');
    body.className = 'min-w-0 flex-1';
    const title = document.createElement('p');
    title.className = 'truncate text-xs font-medium';
    title.textContent = t.title;
    const meta = document.createElement('p');
    meta.className = 'truncate text-[10px] text-neutral-400';
    meta.dataset.topicMeta = t.id;
    const p = topicProgress(t);
    meta.textContent = p.total ? `${p.done}/${p.total} done` : 'empty';
    body.append(title, meta);

    const rename = document.createElement('button');
    rename.className =
      'rounded px-1 text-xs text-neutral-300 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100';
    rename.textContent = '✎';
    rename.title = 'Rename topic';
    rename.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.className = 'w-full rounded border border-neutral-300 px-1 text-xs outline-none';
      input.value = t.title;
      title.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        t.title = input.value.trim() || 'Untitled topic';
        touch(t);
        void saveTopics(topics);
        renderTopics();
        if (activeId === t.id) {
          titleInput.value = t.title;
          if (pipWin && !pipWin.closed) pipWin.document.title = `Fission — ${t.title}`;
        }
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') input.blur();
        if (ev.key === 'Escape') {
          input.value = t.title;
          input.blur();
        }
      });
    });

    const del = document.createElement('button');
    del.className =
      'rounded px-1 text-xs text-neutral-300 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100';
    del.textContent = '×';
    del.title = 'Delete topic';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = countNodes(t.tasks);
      if (!confirm(`Delete topic “${t.title}”${n ? ` and its ${n} task${n === 1 ? '' : 's'}` : ''}?`)) return;
      topics = topics.filter((x) => x.id !== t.id);
      void saveTopics(topics);
      if (activeId === t.id) selectTopic(topics[0]?.id ?? null);
      else renderTopics();
    });

    row.append(body, rename, del);
    row.addEventListener('click', () => selectTopic(t.id));
    topicsEl.appendChild(row);
  }
}

// --- Tree ----------------------------------------------------------------------
const cbClass = (s: CheckState) =>
  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none ' +
  (s === 'all'
    ? 'border-green-600 bg-green-600 text-white'
    : s === 'some'
      ? 'border-amber-500 bg-amber-50 text-amber-600'
      : 'border-neutral-300 bg-white text-transparent hover:border-neutral-400');

const cbGlyph = (s: CheckState) => (s === 'all' ? '✓' : s === 'some' ? '–' : '');

const textClass = (done: boolean) =>
  'block w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-1 py-0.5 text-sm leading-5 outline-none hover:border-neutral-200 focus:border-neutral-400' +
  (done ? ' text-neutral-400 line-through' : '');

const badgeClass = (p: { done: number; total: number }) =>
  'shrink-0 text-[10px] tabular-nums ' +
  (p.total === 0
    ? 'text-neutral-400'
    : p.done === p.total
      ? 'text-green-600'
      : p.done > 0
        ? 'text-amber-600'
        : 'text-neutral-400');

function updateBadges() {
  const t = active();
  if (!t) return;
  const tp = topicProgress(t);
  progressEl.textContent = tp.total ? `${tp.done}/${tp.total} done` : 'no tasks yet';
  for (const el of treeEl.querySelectorAll<HTMLElement>('[data-badge]')) {
    const loc = locate(t.tasks, el.dataset.badge!);
    if (!loc) continue;
    const p = progress(loc.node);
    el.textContent = p.total ? `${p.done}/${p.total}` : '';
    el.className = badgeClass(p);
  }
  for (const el of topicsEl.querySelectorAll<HTMLElement>('[data-topic-meta]')) {
    const topic = topics.find((x) => x.id === el.dataset.topicMeta);
    if (!topic) continue;
    const p = topicProgress(topic);
    el.textContent = p.total ? `${p.done}/${p.total} done` : 'empty';
  }
}

function renderTree(focusId?: string | null) {
  treeEl.innerHTML = '';
  const t = active();
  if (!t) return;
  normalizeDone(t); // keep parent done flags consistent with cascade after any edit

  const addSibling = (after: TaskNode) => {
    const loc = locate(t.tasks, after.id)!;
    const node = newNode();
    loc.list.splice(loc.index + 1, 0, node);
    touch(t);
    renderTree(node.id);
    scheduleSave();
  };

  const doIndent = (id: string) => {
    if (indentTask(t, id)) {
      renderTree(id);
      scheduleSave();
      return;
    }
    const reason = indentBlockReason(t, id);
    if (reason === 'sibling') setStatus('Needs a sibling above to nest under.');
    else if (reason === 'height') setStatus(`Too deep — this would exceed ${MAX_DEPTH} levels.`);
    else setStatus(`Max ${MAX_DEPTH} levels — can’t indent further.`);
  };

  const doOutdent = (id: string) => {
    if (outdentTask(t, id)) {
      renderTree(id);
      scheduleSave();
    }
  };

  const deleteTask = (n: TaskNode, force = false) => {
    if (!force && n.children.length) {
      const c = countNodes(n.children);
      if (!confirm(`Delete “${n.text || 'task'}” and its ${c} subtask${c === 1 ? '' : 's'}?`)) return;
    }
    const loc = locate(t.tasks, n.id);
    const focusId = loc ? (loc.list[loc.index - 1]?.id ?? loc.parent?.id ?? null) : null;
    removeTask(t, n.id);
    renderTree(focusId);
    renderTopics();
    scheduleSave();
  };

  const build = (nodes: TaskNode[], depth: number) => {
    for (const n of nodes) {
      const row = document.createElement('div');
      row.dataset.id = n.id;
      row.className =
        'group flex min-w-full items-start gap-1 rounded-md px-1 py-0.5 hover:bg-neutral-100';
      row.style.paddingLeft = `${(depth - 1) * INDENT + 4}px`;

      // Fold chevron (parents only); a same-width spacer keeps leaf rows aligned.
      let fold: HTMLElement;
      if (n.children.length) {
        const b = document.createElement('button');
        b.className =
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700';
        b.textContent = n.collapsed ? '▸' : '▾';
        b.title = n.collapsed ? 'Expand subtasks' : 'Collapse subtasks';
        b.dataset.fold = n.id;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          n.collapsed = !n.collapsed;
          touch(t);
          renderTree();
          scheduleSave();
        });
        fold = b;
      } else {
        const sp = document.createElement('span');
        sp.className = 'h-4 w-4 shrink-0';
        fold = sp;
      }

      // Tri-state checkbox — toggles the whole subtree, then re-renders.
      const state = checkState(n);
      const cb = document.createElement('button');
      cb.className = cbClass(state);
      cb.textContent = cbGlyph(state);
      cb.title = n.children.length
        ? state === 'all'
          ? 'Uncheck all subtasks'
          : 'Check all subtasks'
        : n.done
          ? 'Mark as not done'
          : 'Mark as done';
      cb.addEventListener('click', () => {
        toggleDone(t, n.id);
        renderTree();
        scheduleSave();
      });

      // Wrapped, auto-growing text; clamped to 2 lines unless focused/pinned open.
      const textWrap = document.createElement('div');
      textWrap.className = 'min-w-[220px] flex-1';
      const ta = document.createElement('textarea');
      ta.rows = 1;
      ta.className = textClass(n.done);
      ta.value = n.text;
      ta.placeholder = depth === 1 ? 'Task…' : 'Subtask…';
      textWrap.appendChild(ta);

      const expandBtn = document.createElement('button');
      expandBtn.className =
        'shrink-0 self-end rounded px-1 text-[10px] leading-4 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700';
      expandBtn.title = 'Expand / collapse text';
      expandBtn.style.display = 'none';

      let open = expandedIds.has(n.id);
      const layoutText = () => {
        ta.style.height = 'auto';
        const full = ta.scrollHeight;
        const overflowing = full > CLAMP_H + 1;
        const clamped = !open && document.activeElement !== ta;
        ta.style.height = `${clamped && overflowing ? CLAMP_H : full}px`;
        expandBtn.style.display = overflowing ? '' : 'none';
        expandBtn.textContent = open ? '⤡' : '⤢';
      };

      ta.addEventListener('input', () => {
        n.text = ta.value;
        touch(t);
        layoutText();
        scheduleSave();
      });
      ta.addEventListener('focus', () => {
        layoutText();
        snapTo(ta);
      });
      ta.addEventListener('blur', () => layoutText());
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        open = !open;
        if (open) expandedIds.add(n.id);
        else expandedIds.delete(n.id);
        layoutText();
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          addSibling(n); // Shift+Enter inserts a newline instead
        } else if (e.key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) doOutdent(n.id);
          else doIndent(n.id);
        } else if (e.key === 'Backspace' && ta.value === '') {
          e.preventDefault();
          deleteTask(n, true);
        }
      });

      const badge = document.createElement('span');
      badge.dataset.badge = n.id;
      badge.className = badgeClass(progress(n));

      const actions = document.createElement('span');
      actions.className = 'flex shrink-0 items-center gap-0.5 self-start opacity-0 group-hover:opacity-100';
      const mkBtn = (label: string, title: string, fn: () => void) => {
        const b = document.createElement('button');
        b.className = 'rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700';
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          fn();
        });
        actions.appendChild(b);
      };
      if (depth < MAX_DEPTH) {
        mkBtn('＋', 'Add subtask', () => {
          const node = addTask(t, n.id);
          if (node) {
            renderTree(node.id);
            scheduleSave();
          }
        });
      }
      if (canIndent(t, n.id)) mkBtn('→', 'Indent (Tab)', () => doIndent(n.id));
      if (canOutdent(t, n.id)) mkBtn('←', 'Outdent (Shift+Tab)', () => doOutdent(n.id));
      mkBtn('×', 'Delete task', () => deleteTask(n));

      row.append(fold, cb, textWrap, expandBtn, badge, actions);
      treeEl.appendChild(row);
      layoutText(); // measure once the textarea is in the DOM
      if (!n.collapsed) build(n.children, depth + 1);
    }
  };
  build(t.tasks, 1);
  updateBadges();
  if (focusId) {
    const ta = treeEl.querySelector<HTMLTextAreaElement>(`[data-id="${focusId}"] textarea`);
    ta?.focus();
    if (ta) snapTo(ta);
  }
}

function renderTopicView() {
  const t = active();
  const view = document.getElementById('topic-view')!;
  const empty = document.getElementById('empty')!;
  const ph = document.getElementById('pip-placeholder')!;
  const floating = !!pipWin && !pipWin.closed;
  if (!t) {
    if (floating) pipWin?.close();
    view.classList.add('hidden');
    view.classList.remove('flex');
    ph.classList.add('hidden');
    ph.classList.remove('flex');
    empty.classList.remove('hidden');
    empty.classList.add('flex');
    return;
  }
  empty.classList.add('hidden');
  empty.classList.remove('flex');
  titleInput.value = t.title;
  renderTree();
  if (floating) {
    ph.classList.remove('hidden');
    ph.classList.add('flex');
    if (pipWin) pipWin.document.title = `Fission — ${t.title}`;
  } else {
    ph.classList.add('hidden');
    ph.classList.remove('flex');
    view.classList.remove('hidden');
    view.classList.add('flex');
  }
}

function selectTopic(id: string | null) {
  flushSave();
  activeId = id;
  renderTopics();
  renderTopicView();
}

// --- Topic-level controls -------------------------------------------------------
document.getElementById('new-topic')!.addEventListener('click', () => {
  flushSave();
  const t = newTopic(`Topic ${topics.length + 1}`);
  topics.unshift(t);
  void saveTopics(topics);
  selectTopic(t.id);
  titleInput.focus();
  titleInput.select();
});

titleInput.addEventListener('input', () => {
  const t = active();
  if (!t) return;
  t.title = titleInput.value;
  touch(t);
  scheduleSave();
});
titleInput.addEventListener('change', () => {
  const t = active();
  if (!t) return;
  t.title = titleInput.value.trim() || 'Untitled topic';
  titleInput.value = t.title;
  touch(t);
  renderTopics();
  if (pipWin && !pipWin.closed) pipWin.document.title = `Fission — ${t.title}`;
  scheduleSave();
});

document.getElementById('add-root')!.addEventListener('click', () => {
  const t = active();
  if (!t) return;
  const node = addTask(t, null);
  if (node) {
    renderTree(node.id);
    scheduleSave();
  }
});

// --- Export ---------------------------------------------------------------------
document.getElementById('export-pdf')!.addEventListener('click', async () => {
  const t = active();
  if (!t) return;
  if (countNodes(t.tasks) === 0) { setStatus('Add some tasks first'); return; }
  flushSave();
  try {
    // Lazy-load jsPDF so the board's initial bundle stays small.
    const { exportTopicPdf } = await import('../../utils/pdf');
    exportTopicPdf(t);
    setStatus('PDF exported ✓');
  } catch (err) {
    setStatus(`PDF failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});
document.getElementById('export-md')!.addEventListener('click', () => {
  const t = active();
  if (!t) return;
  if (countNodes(t.tasks) === 0) { setStatus('Add some tasks first'); return; }
  flushSave();
  const date = new Date().toISOString().slice(0, 10);
  downloadText(`fission-${slugify(t.title)}-${date}.md`, toMarkdown(t), 'text/markdown');
  setStatus('Markdown exported ✓');
});

// --- Cross-window sync -----------------------------------------------------------
browser.storage?.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.topics) return;
  const next = changes.topics.newValue;
  if (!Array.isArray(next)) return;
  const ae = document.activeElement;
  const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  if (typing && (ae.closest('#tree') || ae.id === 'topic-title')) return; // mid-keystroke
  topics = next as Topic[];
  topics.forEach(normalizeDone);
  if (!active()) selectTopic(topics[0]?.id ?? null);
  else {
    renderTopics();
    renderTopicView();
  }
});

// --- Document Picture-in-Picture --------------------------------------------------
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
  const t = active();
  if (!t) return;
  const dpi = (window as Window & { documentPictureInPicture?: DocPip }).documentPictureInPicture;
  if (!dpi) {
    setStatus('Document PiP not supported here (Chrome 116+).');
    return;
  }
  if (pipWin && !pipWin.closed) {
    pipWin.focus();
    return;
  }
  try {
    const win = await dpi.requestWindow({ width: 440, height: 600, copyStyleSheets: true });
    pipWin = win;
    win.document.title = `Fission — ${t.title}`;
    mirrorStyles(win.document);
    win.document.body.className = 'm-0 flex h-screen flex-col bg-neutral-50 font-sans text-neutral-900';
    // Move the SAME topic view (header + tree) into the PiP window — live DOM,
    // so every edit/check/add works while floating, and docking restores it.
    const mount = document.getElementById('topic-view')!;
    const originalParent = mount.parentElement!;
    win.document.body.append(mount);
    mount.classList.remove('hidden');
    mount.classList.add('flex');
    document.getElementById('empty')!.classList.add('hidden');
    document.getElementById('empty')!.classList.remove('flex');
    const ph = document.getElementById('pip-placeholder')!;
    ph.classList.remove('hidden');
    ph.classList.add('flex');
    floatBtn.textContent = '⧉ Dock';
    setStatus('floating ✓ — close the PiP window to dock it back');
    win.addEventListener('pagehide', () => {
      pipWin = null;
      originalParent.append(mount);
      ph.classList.add('hidden');
      ph.classList.remove('flex');
      floatBtn.textContent = '⧉ Float';
      statusEl.textContent = '';
      renderTopicView();
    });
  } catch (err) {
    setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

floatBtn.addEventListener('click', () => {
  if (pipWin && !pipWin.closed) pipWin.close();
  else void floatIntoPip();
});

// --- Init -------------------------------------------------------------------------
void (async () => {
  topics = await loadTopics();
  topics.forEach(normalizeDone); // migrate legacy independent flags to cascade semantics
  selectTopic(topics[0]?.id ?? null);
})();

window.addEventListener('pagehide', flushSave);
