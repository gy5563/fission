import './style.css';
import {
  type Topic,
  type TaskNode,
  type CheckState,
  MAX_DEPTH,
  loadTopics,
  sanitizeTopics,
  saveTopics,
  newTopic,
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
let savedFlashTimer: ReturnType<typeof setTimeout> | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
// Canonical-JSON snapshots of our own recent writes, so storage.onChanged can
// skip self-echoes — applying them would re-render mid-keystroke (and steal
// focus while editing in PiP, where the opener's activeElement is not the
// editor). Refcounted in case an external write interleaves two identical
// saves. lastSavedSnap skips no-op writes entirely: chrome.storage fires no
// onChanged when the value is unchanged, so registering an echo for one would
// leak an entry that could later swallow a genuine external write.
const recentSaves = new Map<string, number>();
let lastSavedSnap: string | null = null;
function consumeSnap(snap: string) {
  const n = recentSaves.get(snap);
  if (n === undefined) return;
  if (n <= 1) recentSaves.delete(snap);
  else recentSaves.set(snap, n - 1);
}
// chrome.storage canonicalizes object keys (sorted) on the way back out, so
// raw JSON.stringify of our in-memory state never matches the echo. Compare
// sorted-key serializations instead, or every self-echo looks like an external
// write and re-renders mid-typing (stealing focus in the PiP window).
function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) sorted[k] = o[k];
      return sorted;
    }
    return val;
  });
}
let pipWin: Window | null = null;
let restoreDock: (() => void) | null = null;

// UI-only state: which rows the user pinned open (full text). Survives re-renders.
const expandedIds = new Set<string>();
// UI-only: the task row the user is currently working in (a persistent "you are here" marker).
let focusedTaskId: string | null = null;
// UI-only: the task whose text the ✎ popover is editing (null = closed), the
// text it opened with (Esc restores it), and the window whose resize re-anchors
// the popover (opener or PiP — the mount moves between them).
let editTargetId: string | null = null;
let editOriginalText = '';
let editResizeWin: Window | null = null;
let fadeOn = true;
const INDENT = 18; // px per tier
const CLAMP_H = 44; // 2 lines (leading-5 = 20px) + 4px vertical padding

// Row labels are display-only spans; relayout re-measures the 2-line clamp
// after the ✎ popover changes the text in place (no re-render mid-edit).
type TaskLabel = HTMLSpanElement & { relayout?: () => void };

// Static markup only — all user text goes through .value / textContent.
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="flex h-screen bg-neutral-50 font-sans text-neutral-800">
    <aside class="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div class="flex items-center justify-between px-3 py-2">
        <span class="text-sm font-bold tracking-tight">Fission</span>
        <span id="saved" class="text-xs text-neutral-400"></span>
      </div>
      <div class="px-2 pb-2">
        <button id="new-topic" class="w-full rounded-md bg-neutral-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 shadow-sm">
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
        <header class="relative flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <input id="topic-title" title="Rename topic"
            class="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:border-neutral-200 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200" />
          <span id="topic-progress" class="shrink-0 text-xs text-neutral-500"></span>
          <button id="export-pdf" title="Export the visual tree (with checked states) as PDF"
            class="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800">↓ PDF</button>
          <button id="export-md" title="Export as a Markdown checklist"
            class="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800">↓ MD</button>
          <button id="timer" title="Set a countdown timer for the current task"
            class="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800">⏱ Timer</button>
          <div id="timer-pop"
            class="absolute right-0 top-full z-10 mt-1 hidden w-56 rounded-lg border border-neutral-200 bg-white p-2 shadow-md">
            <div class="flex gap-1">
              <button data-timer-preset="5" class="flex-1 rounded-md border border-neutral-200 bg-white px-1 py-1 text-[10px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800">5 min</button>
              <button data-timer-preset="15" class="flex-1 rounded-md border border-neutral-200 bg-white px-1 py-1 text-[10px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800">15 min</button>
              <button data-timer-preset="25" class="flex-1 rounded-md border border-neutral-200 bg-white px-1 py-1 text-[10px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800">25 min</button>
              <button data-timer-preset="45" class="flex-1 rounded-md border border-neutral-200 bg-white px-1 py-1 text-[10px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800">45 min</button>
            </div>
            <div class="mt-2 flex items-center gap-1">
              <input id="timer-custom" type="number" min="0.1" max="1440" step="0.1" value="25" title="Custom minutes"
                class="w-16 rounded-md border border-neutral-200 px-1 py-0.5 text-xs outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200" />
              <span class="text-[10px] text-neutral-400">min</span>
              <button id="timer-start" class="ml-auto rounded bg-neutral-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-neutral-700 shadow-sm">Start</button>
            </div>
            <button id="timer-cancel" class="mt-2 hidden w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] text-red-500 hover:bg-neutral-100">Cancel timer</button>
          </div>
          <button id="fade" title="Fade the floating window when the pointer leaves — the current task stays visible" aria-pressed="false"
            class="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800">◑ Fade</button>
          <button id="float" class="shrink-0 rounded-md bg-neutral-600 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700 shadow-sm">⧉ Float</button>
        </header>
        <div id="tree-scroll" class="min-h-0 flex-1 overflow-auto p-3">
          <div id="tree"></div>
          <button id="add-root"
            class="mt-1 rounded-md border border-dashed border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-700">
            + Add task
          </button>
        </div>
        <div id="edit-pop"
          class="fixed z-20 hidden w-80 rounded-lg border border-neutral-200 bg-white p-2 shadow-md">
          <textarea id="edit-text" rows="3" placeholder="Task text…"
            class="block w-full resize-none overflow-y-auto rounded-md border border-neutral-200 px-2 py-1 text-sm leading-5 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"></textarea>
          <div class="mt-1.5 flex items-center justify-between gap-2">
            <span class="text-[10px] text-neutral-400">↵ done · ⇧↵ newline · tab re-nest · esc cancel</span>
            <button id="edit-done"
              class="shrink-0 rounded bg-neutral-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-neutral-700 shadow-sm">Done</button>
          </div>
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
// Cached node reference: the mount MOVES into the PiP document while floating,
// so document.getElementById('topic-view') in the opener returns null there.
const topicViewEl = document.getElementById('topic-view')!;
const titleInput = document.getElementById('topic-title') as HTMLInputElement;
const progressEl = document.getElementById('topic-progress')!;
const savedEl = document.getElementById('saved')!;
const statusEl = document.getElementById('status')!;
const floatBtn = document.getElementById('float') as HTMLButtonElement;
const fadeBtn = document.getElementById('fade') as HTMLButtonElement;
const timerBtn = document.getElementById('timer') as HTMLButtonElement;
const timerPop = document.getElementById('timer-pop')!;
const timerCustom = document.getElementById('timer-custom') as HTMLInputElement;
const timerStartBtn = document.getElementById('timer-start') as HTMLButtonElement;
const timerCancelBtn = document.getElementById('timer-cancel') as HTMLButtonElement;
const treeScrollEl = document.getElementById('tree-scroll')!;
const editPop = document.getElementById('edit-pop')!;
const editText = document.getElementById('edit-text') as HTMLTextAreaElement;
const editDoneBtn = document.getElementById('edit-done') as HTMLButtonElement;

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
  clearTimeout(savedFlashTimer);
  savedFlashTimer = setTimeout(() => {
    savedEl.textContent = '';
  }, 1500);
}

// Write-through persistence: every mutation is saved immediately. A debounced
// save kept edits in memory until the timer fired, and close-time flushes are
// unreliable — the renderer can be torn down before the async write lands
// (and may not fire pagehide/visibilitychange at all), so closing the window
// right after typing lost the last edits.
function save() {
  const snap = canonicalJson(topics);
  if (snap === lastSavedSnap) {
    flashSaved(); // already persisted verbatim — nothing to write, no echo coming
    return;
  }
  lastSavedSnap = snap;
  recentSaves.set(snap, (recentSaves.get(snap) ?? 0) + 1);
  void saveTopics(topics)
    .then(flashSaved)
    .catch(() => {
      consumeSnap(snap);
      if (lastSavedSnap === snap) lastSavedSnap = null; // retry must not be skipped
      setStatus('Save failed — device storage may be full.');
    });
}

/** Bring an element into view within the scrolling tree pane (the "snap"). */
function snapTo(el: HTMLElement) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Highlight the active task row — a persistent "you are here" marker that
 *  follows focus/interaction and survives re-renders and horizontal scroll. */
function markActiveRow(id: string | null) {
  focusedTaskId = id;
  for (const el of treeEl.querySelectorAll<HTMLElement>('[data-id]')) {
    el.classList.toggle('row-active', el.dataset.id === id);
  }
}

function updateFadeBtn() {
  fadeBtn.className =
    'shrink-0 rounded-md border px-2 py-1 text-[10px] ' +
    (fadeOn
      ? 'border-neutral-600 bg-neutral-600 text-white shadow-sm'
      : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800');
  fadeBtn.setAttribute('aria-pressed', String(fadeOn));
}

function applyFade(idle: boolean) {
  topicViewEl.classList.toggle('fade-idle', fadeOn && pipWin !== null && idle);
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
      'rounded-md px-1 text-xs text-neutral-300 opacity-0 hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100';
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
        save();
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
      'rounded-md px-1 text-xs text-neutral-300 opacity-0 hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100';
    del.textContent = '×';
    del.title = 'Delete topic';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = countNodes(t.tasks);
      if (!confirm(`Delete topic “${t.title}”${n ? ` and its ${n} task${n === 1 ? '' : 's'}` : ''}?`)) return;
      topics = topics.filter((x) => x.id !== t.id);
      save();
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
  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none ' +
  (s === 'all'
    ? 'border-green-600 bg-green-600 text-white'
    : 'border-neutral-300 bg-white text-transparent hover:border-neutral-400');

const cbGlyph = (s: CheckState) => (s === 'all' ? '✓' : '');

// Fold chevron: Lucide-style stroke with round caps/joins (soft corners), built
// via createElementNS so no innerHTML is involved. Right = collapsed, down = open.
const chevronSvg = (collapsed: boolean | undefined) => {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'h-4 w-4');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', collapsed ? 'm9 18 6-6-6-6' : 'm6 9 6 6 6-6');
  svg.appendChild(path);
  return svg;
};

const textClass = (done: boolean) =>
  'block w-full whitespace-pre-wrap break-words rounded-md border border-transparent px-1 py-0.5 text-sm leading-5 outline-none' +
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

// Tree mutations shared by the row buttons and the ✎ editor popover.
function doIndent(id: string) {
  const t = active();
  if (!t) return;
  if (indentTask(t, id)) {
    renderTree(id);
    save();
    return;
  }
  const reason = indentBlockReason(t, id);
  if (reason === 'sibling') setStatus('Needs a sibling above to nest under.');
  else if (reason === 'height') setStatus(`Too deep — this would exceed ${MAX_DEPTH} levels.`);
  else setStatus(`Max ${MAX_DEPTH} levels — can’t indent further.`);
}

function doOutdent(id: string) {
  const t = active();
  if (!t) return;
  if (outdentTask(t, id)) {
    renderTree(id);
    save();
  }
}

function deleteTask(n: TaskNode, force = false) {
  const t = active();
  if (!t) return;
  if (!force && n.children.length) {
    const c = countNodes(n.children);
    if (!confirm(`Delete “${n.text || 'task'}” and its ${c} subtask${c === 1 ? '' : 's'}?`)) return;
  }
  const loc = locate(t.tasks, n.id);
  const focusId = loc ? (loc.list[loc.index - 1]?.id ?? loc.parent?.id ?? null) : null;
  removeTask(t, n.id);
  renderTree(focusId);
  renderTopics();
  save();
}

function renderTree(focusId?: string | null) {
  treeEl.innerHTML = '';
  const t = active();
  if (!t) return;

  const build = (nodes: TaskNode[], depth: number) => {
    for (const n of nodes) {
      const row = document.createElement('div');
      row.dataset.id = n.id;
      row.className =
        'row group flex min-w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-neutral-100' +
        (n.id === focusedTaskId ? ' row-active' : '');
      row.style.paddingLeft = `${(depth - 1) * INDENT + 4}px`;

      // Fold chevron (parents only); a same-width spacer keeps leaf rows aligned.
      let fold: HTMLElement;
      if (n.children.length) {
        const b = document.createElement('button');
        b.className =
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700';
        b.appendChild(chevronSvg(n.collapsed));
        b.title = n.collapsed ? 'Expand subtasks' : 'Collapse subtasks';
        b.dataset.fold = n.id;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          markActiveRow(n.id);
          n.collapsed = !n.collapsed;
          touch(t);
          renderTree();
          save();
        });
        fold = b;
      } else {
        const sp = document.createElement('span');
        sp.className = 'h-6 w-6 shrink-0';
        fold = sp;
      }

      // Checkbox — toggles the whole subtree (down-only); parent flag is independent of children.
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
        markActiveRow(n.id);
        toggleDone(t, n.id);
        renderTree();
        save();
      });

      // Wrapped, auto-growing text label (display-only span); clamped to 2 lines
      // unless focused/pinned open/being edited in the ✎ popover.
      const textWrap = document.createElement('div');
      textWrap.className = 'min-w-[220px] flex-1';
      const label = document.createElement('span') as TaskLabel;
      label.className = textClass(n.done);
      label.textContent = n.text;
      label.tabIndex = 0; // focusable: row click activates, Enter opens the ✎ editor
      label.dataset.label = n.id;
      label.dataset.placeholder = depth === 1 ? 'Task…' : 'Subtask…';
      textWrap.appendChild(label);

      const expandBtn = document.createElement('button');
      expandBtn.className =
        'shrink-0 rounded-md px-1 text-[10px] leading-4 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700';
      expandBtn.title = 'Expand / collapse text';
      expandBtn.style.display = 'none';

      let open = expandedIds.has(n.id);
      const layoutText = () => {
        // The span grows with its content; clamping is a max-height. scrollHeight
        // still reports the full text height while clamped (overflow:hidden).
        const overflowing = label.scrollHeight > CLAMP_H + 1;
        const clamped = !open && document.activeElement !== label && editTargetId !== n.id;
        const clamp = clamped && overflowing;
        // border-box: add the label's vertical borders so 2 lines + padding fit.
        const borderV = label.offsetHeight - label.clientHeight;
        label.style.maxHeight = clamp ? `${CLAMP_H + borderV}px` : '';
        label.style.overflow = clamp ? 'hidden' : '';
        expandBtn.style.display = overflowing ? '' : 'none';
        expandBtn.textContent = open ? '⤡' : '⤢';
      };
      label.relayout = layoutText;

      label.addEventListener('focus', () => {
        markActiveRow(n.id);
        layoutText();
        snapTo(label);
      });
      label.addEventListener('blur', () => layoutText());
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        open = !open;
        if (open) expandedIds.add(n.id);
        else expandedIds.delete(n.id);
        layoutText();
      });
      label.addEventListener('keydown', (e) => {
        // The label never edits in place; Enter opens the ✎ popover (the ✎
        // button is hover-revealed, so this keeps editing keyboard-reachable).
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          openEditPop(n.id);
        }
      });

      const badge = document.createElement('span');
      badge.dataset.badge = n.id;
      badge.className = badgeClass(progress(n));

      // Countdown chip; the 1s tick updates its text in place (no re-render).
      let timerChip: HTMLElement | null = null;
      if (n.timer) {
        const done = n.timer.endsAt <= Date.now();
        const chip = document.createElement('span');
        chip.dataset.timerId = n.id;
        chip.dataset.ends = String(n.timer.endsAt);
        chip.dataset.state = done ? 'done' : 'running';
        chip.className =
          'shrink-0 cursor-pointer rounded border border-neutral-200 px-1 text-[10px] tabular-nums text-neutral-500' +
          (done ? ' timer-done' : '');
        chip.textContent = done ? '⏰ time’s up' : `⏱ ${fmtRemaining(n.timer.endsAt)}`;
        chip.title = 'Timer — click to change or cancel';
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          markActiveRow(n.id);
          openTimerPop(n.id);
        });
        if (done) row.classList.add('row-timer-done');
        timerChip = chip;
      }

      const actions = document.createElement('span');
      actions.className = 'flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100';
      const mkBtn = (label: string, title: string, fn: () => void) => {
        const b = document.createElement('button');
        b.className = 'rounded-md px-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700';
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          fn();
        });
        actions.appendChild(b);
        return b;
      };
      const editBtn = mkBtn('✎', 'Edit task', () => {
        if (editTargetId === n.id && !editPop.classList.contains('hidden')) closeEditPop();
        else openEditPop(n.id);
      });
      editBtn.dataset.edit = n.id;
      if (depth < MAX_DEPTH) {
        mkBtn('＋', 'Add subtask', () => {
          const node = addTask(t, n.id);
          if (node) {
            renderTree(node.id);
            save();
            openEditPop(node.id);
          }
        });
      }
      if (canIndent(t, n.id)) mkBtn('→', 'Indent (Tab)', () => doIndent(n.id));
      if (canOutdent(t, n.id)) mkBtn('←', 'Outdent (Shift+Tab)', () => doOutdent(n.id));
      mkBtn('×', 'Delete task', () => deleteTask(n));

      // Clicking anywhere on the row (except its buttons) focuses its text → activates it.
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        label.focus();
      });
      row.append(fold, cb, textWrap, expandBtn, badge, ...(timerChip ? [timerChip] : []), actions);
      treeEl.appendChild(row);
      layoutText(); // measure once the label is in the DOM
      if (!n.collapsed) build(n.children, depth + 1);
    }
  };
  build(t.tasks, 1);
  updateBadges();
  if (focusId) {
    const label = labelFor(focusId);
    if (label) {
      // focusId only follows explicit actions (create/indent/outdent/delete):
      // focus the label for the active-row marker; creation flows then open
      // the ✎ editor on the new node.
      label.focus();
      snapTo(label);
    }
  }
  // Re-anchor the open editor to its (possibly rebuilt) row; close it if the
  // row is gone (deleted, topic switched).
  if (editTargetId !== null) positionEditPop();
}

function renderTopicView() {
  const t = active();
  const view = topicViewEl;
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
  // Render AFTER the view is visible: the label clamp reads scrollHeight, which
  // is 0 while display:none — measuring hidden would collapse every row to 0px.
  renderTree();
}

function selectTopic(id: string | null) {
  closeEditPop();
  activeId = id;
  focusedTaskId = null;
  renderTopics();
  renderTopicView();
}

// --- Topic-level controls -------------------------------------------------------
document.getElementById('new-topic')!.addEventListener('click', () => {
  const t = newTopic(`Topic ${topics.length + 1}`);
  topics.unshift(t);
  save();
  selectTopic(t.id);
  titleInput.focus();
  titleInput.select();
});

titleInput.addEventListener('input', () => {
  const t = active();
  if (!t) return;
  t.title = titleInput.value;
  touch(t);
  save();
});
titleInput.addEventListener('change', () => {
  const t = active();
  if (!t) return;
  t.title = titleInput.value.trim() || 'Untitled topic';
  titleInput.value = t.title;
  touch(t);
  renderTopics();
  if (pipWin && !pipWin.closed) pipWin.document.title = `Fission — ${t.title}`;
  save();
});

document.getElementById('add-root')!.addEventListener('click', () => {
  const t = active();
  if (!t) return;
  const node = addTask(t, null);
  if (node) {
    renderTree(node.id);
    save();
    openEditPop(node.id);
  }
});

fadeBtn.addEventListener('click', () => {
  fadeOn = !fadeOn;
  void browser.storage?.local.set({ fade: fadeOn });
  updateFadeBtn();
  if (!fadeOn) topicViewEl.classList.remove('fade-idle');
  setStatus(fadeOn ? 'Fade on — floating window dims when the pointer leaves' : 'Fade off');
});

// --- Task text editor (✎ popover) ---------------------------------------------------
// The row text is a read-only label; editing happens in a small popover anchored
// to the row. Commits are write-through (every keystroke saves), so closing the
// window mid-edit loses nothing; Esc is the only path that reverts.
function labelFor(id: string): TaskLabel | null {
  return treeEl.querySelector<TaskLabel>(`[data-id="${CSS.escape(id)}"] [data-label]`);
}

function editNode(): { t: Topic; n: TaskNode } | null {
  const t = active();
  const loc = t && editTargetId !== null ? locate(t.tasks, editTargetId) : null;
  return t && loc ? { t, n: loc.node } : null;
}

function autosizeEditText() {
  editText.style.height = 'auto';
  editText.style.height = `${Math.min(editText.scrollHeight, 240)}px`;
}

/** Anchor the popover below its row (above when there's no room), clamped to the
 *  viewport of whichever document hosts it — the board or the PiP window. */
function positionEditPop() {
  if (editTargetId === null) return;
  const row = treeEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(editTargetId)}"]`);
  if (!row) {
    closeEditPop();
    return;
  }
  const win = editPop.ownerDocument.defaultView;
  if (!win) return;
  if (editResizeWin !== win) {
    editResizeWin?.removeEventListener('resize', positionEditPop);
    editResizeWin = win;
    win.addEventListener('resize', positionEditPop);
  }
  const r = row.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, win.innerWidth - editPop.offsetWidth - 8));
  let top = r.bottom + 4;
  if (top + editPop.offsetHeight > win.innerHeight - 8) top = Math.max(8, r.top - editPop.offsetHeight - 4);
  editPop.style.left = `${left}px`;
  editPop.style.top = `${top}px`;
}

function openEditPop(id: string) {
  closeTimerPop(); // one popover at a time
  const t = active();
  const loc = t && locate(t.tasks, id);
  if (!t || !loc) return;
  editTargetId = id;
  editOriginalText = loc.node.text;
  markActiveRow(id);
  editText.value = loc.node.text;
  editPop.classList.remove('hidden');
  autosizeEditText();
  positionEditPop();
  labelFor(id)?.relayout?.();
  editText.focus();
  editText.setSelectionRange(editText.value.length, editText.value.length);
}

function closeEditPop() {
  const id = editTargetId;
  editPop.classList.add('hidden');
  editTargetId = null;
  editResizeWin?.removeEventListener('resize', positionEditPop);
  editResizeWin = null;
  if (id) labelFor(id)?.relayout?.();
}

/** Esc: restore the text the popover opened with, then close. */
function cancelEdit() {
  const cur = editNode();
  if (cur && cur.n.text !== editOriginalText) {
    cur.n.text = editOriginalText;
    touch(cur.t);
    const label = labelFor(cur.n.id);
    if (label) {
      label.textContent = editOriginalText;
      label.relayout?.();
    }
    save();
  }
  closeEditPop();
}

editText.addEventListener('input', () => {
  const cur = editNode();
  if (!cur) {
    closeEditPop();
    return;
  }
  cur.n.text = editText.value;
  touch(cur.t);
  const label = labelFor(cur.n.id);
  if (label) {
    label.textContent = cur.n.text;
    label.relayout?.();
  }
  autosizeEditText();
  positionEditPop();
  save();
});

editText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault(); // Shift+Enter inserts a newline instead
    closeEditPop();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const cur = editNode();
    if (!cur) return;
    if (e.shiftKey) doOutdent(cur.n.id);
    else doIndent(cur.n.id);
    editText.focus(); // renderTree focused the row label; keep typing in the editor
  }
  // No Backspace-on-empty delete here: clearing text to retype must never
  // destroy the task — deletion stays on the row's × button (with its confirm).
});

editDoneBtn.addEventListener('click', () => closeEditPop());

// Escape / outside-click close, on both the document and the topic-view mount
// (same PiP rationale as the timer popover). ✎ and add-task clicks are exempt:
// they open the editor, and the same click must not immediately close it.
const onEditEscape = (e: Event) => {
  if ((e as KeyboardEvent).key === 'Escape' && !editPop.classList.contains('hidden')) cancelEdit();
};
const onEditOutside = (e: Event) => {
  if (editPop.classList.contains('hidden')) return;
  if ((e.target as HTMLElement).closest('#edit-pop, [data-edit], #add-root')) return;
  closeEditPop();
};
for (const target of [document, topicViewEl]) {
  target.addEventListener('keydown', onEditEscape);
  target.addEventListener('click', onEditOutside);
}
// Keep the popover anchored while the tree scrolls under it.
treeScrollEl.addEventListener('scroll', positionEditPop, { passive: true });

// --- Countdown timer --------------------------------------------------------------
// UI-only: which task the open popover targets.
let timerTargetId: string | null = null;

/** mm:ss remaining (h:mm:ss past an hour), floored at zero. */
function fmtRemaining(endsAt: number): string {
  const s = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function closeTimerPop() {
  timerPop.classList.add('hidden');
  timerTargetId = null;
}

function openTimerPop(id: string) {
  closeEditPop(); // one popover at a time
  const t = active();
  const loc = t && locate(t.tasks, id);
  if (!loc) return;
  timerTargetId = id;
  timerCustom.value = '25';
  timerCancelBtn.classList.toggle('hidden', !loc.node.timer);
  timerPop.classList.remove('hidden');
}

function startTimer(minutes: number) {
  const t = active();
  const loc = t && timerTargetId !== null && locate(t.tasks, timerTargetId);
  if (!t || !loc) {
    closeTimerPop();
    return;
  }
  if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > 1440) {
    setStatus('Timer must be between 0.1 and 1440 minutes.');
    return;
  }
  loc.node.timer = { minutes, endsAt: Date.now() + minutes * 60000 };
  touch(t);
  renderTree();
  save();
  closeTimerPop();
}

timerBtn.addEventListener('click', () => {
  if (!timerPop.classList.contains('hidden')) {
    closeTimerPop();
    return;
  }
  if (focusedTaskId === null) {
    setStatus('Focus a task first — click its text.');
    return;
  }
  openTimerPop(focusedTaskId);
});
for (const b of timerPop.querySelectorAll<HTMLButtonElement>('[data-timer-preset]')) {
  b.addEventListener('click', () => startTimer(Number(b.dataset.timerPreset)));
}
timerStartBtn.addEventListener('click', () => startTimer(parseFloat(timerCustom.value)));
timerCancelBtn.addEventListener('click', () => {
  const t = active();
  const loc = t && timerTargetId !== null && locate(t.tasks, timerTargetId);
  if (t && loc && loc.node.timer) {
    delete loc.node.timer;
    touch(t);
    renderTree();
    save();
  }
  closeTimerPop();
});

// Escape / outside-click close. Listeners sit on both the document and the
// topic-view mount: while floated, PiP events never reach the opener document
// but still bubble through the mount that moved with them.
const onTimerEscape = (e: Event) => {
  if ((e as KeyboardEvent).key === 'Escape' && !timerPop.classList.contains('hidden')) closeTimerPop();
};
const onTimerOutside = (e: Event) => {
  if (timerPop.classList.contains('hidden')) return;
  if ((e.target as HTMLElement).closest('#timer-pop, #timer')) return;
  closeTimerPop();
};
for (const target of [document, document.getElementById('topic-view')!]) {
  target.addEventListener('keydown', onTimerEscape);
  target.addEventListener('click', onTimerOutside);
}

// --- Export ---------------------------------------------------------------------
const exportPdfBtn = document.getElementById('export-pdf') as HTMLButtonElement;
const exportMdBtn = document.getElementById('export-md') as HTMLButtonElement;
exportPdfBtn.addEventListener('click', async () => {
  const t = active();
  if (!t || exportPdfBtn.disabled) return;
  if (countNodes(t.tasks) === 0) { setStatus('Add some tasks first'); return; }
  exportPdfBtn.disabled = true;
  exportPdfBtn.textContent = '…';
  try {
    // Lazy-load jsPDF so the board's initial bundle stays small.
    const { exportTopicPdf } = await import('../../utils/pdf');
    await exportTopicPdf(t, exportPdfBtn.ownerDocument);
    setStatus('PDF exported ✓');
  } catch (err) {
    setStatus(`PDF failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    exportPdfBtn.disabled = false;
    exportPdfBtn.textContent = '↓ PDF';
  }
});
exportMdBtn.addEventListener('click', () => {
  const t = active();
  if (!t) return;
  if (countNodes(t.tasks) === 0) { setStatus('Add some tasks first'); return; }
  const date = new Date().toISOString().slice(0, 10);
  downloadText(
    `fission-${slugify(t.title)}-${date}.md`,
    toMarkdown(t),
    'text/markdown',
    exportMdBtn.ownerDocument,
  );
  setStatus('Markdown exported ✓');
});

// --- Cross-window sync -----------------------------------------------------------
browser.storage?.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.topics) return;
  const next = changes.topics.newValue;
  if (!Array.isArray(next)) return;
  const snap = canonicalJson(next);
  if (recentSaves.has(snap)) {
    consumeSnap(snap); // our own write — state is already current
    return;
  }
  const ae = document.activeElement;
  const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  if (typing && (ae.closest('#tree') || ae.closest('#edit-pop') || ae.id === 'topic-title')) return; // mid-keystroke
  topics = sanitizeTopics(next);
  lastSavedSnap = null; // stored value changed under us — the next save must write
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
  // A previous PiP may have died without firing pagehide (abrupt teardown);
  // recover the mount before trying to float again.
  if (pipWin?.closed) restoreDock?.();
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
    if (win.document.styleSheets.length === 0) mirrorStyles(win.document);
    win.document.body.className = 'm-0 flex h-screen flex-col bg-neutral-50 font-sans text-neutral-800';
    // Move the SAME topic view (header + tree) into the PiP window — live DOM,
    // so every edit/check/add works while floating, and docking restores it.
    const mount = document.getElementById('topic-view')!;
    const originalParent = mount.parentElement!;
    win.document.body.append(mount);
    win.document.addEventListener('mouseenter', () => applyFade(false));
    win.document.addEventListener('mouseleave', () => applyFade(true));
    mount.classList.remove('hidden');
    mount.classList.add('flex');
    document.getElementById('empty')!.classList.add('hidden');
    document.getElementById('empty')!.classList.remove('flex');
    const ph = document.getElementById('pip-placeholder')!;
    ph.classList.remove('hidden');
    ph.classList.add('flex');
    floatBtn.textContent = '⧉ Dock';
    setStatus('floating ✓ — close the PiP window to dock it back');
    const dockBack = () => {
      if (!pipWin) return; // already docked — pagehide and explicit Dock can both run
      pipWin = null;
      originalParent.append(mount);
      mount.classList.remove('fade-idle');
      ph.classList.add('hidden');
      ph.classList.remove('flex');
      floatBtn.textContent = '⧉ Float';
      statusEl.textContent = '';
      renderTopicView();
    };
    restoreDock = dockBack;
    win.addEventListener('pagehide', dockBack);
  } catch (err) {
    setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

floatBtn.addEventListener('click', () => {
  if (pipWin && !pipWin.closed) {
    pipWin.close();
    // Restore synchronously — pagehide may never fire on abrupt teardown.
    restoreDock?.();
  } else {
    void floatIntoPip();
  }
});

// --- Init -------------------------------------------------------------------------
void (async () => {
  const pref = await browser.storage?.local.get(['fade']);
  fadeOn = pref?.fade !== false;
  updateFadeBtn();
  topics = await loadTopics();
  selectTopic(topics[0]?.id ?? null);
  // One shared 1s tick: refreshes chip text/state in place — never renderTree()
  // or save(), so label identity and focus survive while typing (also in PiP,
  // where this board-window interval keeps running on the moved DOM).
  setInterval(() => {
    for (const chip of treeEl.querySelectorAll<HTMLElement>('[data-timer-id]')) {
      const ends = Number(chip.dataset.ends);
      if (!Number.isFinite(ends)) continue;
      if (ends > Date.now()) {
        chip.textContent = `⏱ ${fmtRemaining(ends)}`;
      } else if (chip.dataset.state !== 'done') {
        chip.dataset.state = 'done';
        chip.classList.add('timer-done');
        chip.textContent = '⏰ time’s up';
        chip.closest('[data-id]')?.classList.add('row-timer-done');
        const t = active();
        const loc = t && locate(t.tasks, chip.dataset.timerId!);
        setStatus(`Time’s up — ${loc?.node.text || 'task'}`);
      }
    }
  }, 1000);
})();
