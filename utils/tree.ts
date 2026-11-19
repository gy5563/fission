// Fission data model: topics containing checklists nested up to MAX_DEPTH tiers.
// Pure helpers + storage persistence; UI lives in entrypoints/board.

export interface TaskNode {
  id: string;
  text: string;
  done: boolean;
  children: TaskNode[];
  /** UI fold state: when true, children are hidden in the board (persisted). */
  collapsed?: boolean;
}
export interface Topic {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  tasks: TaskNode[];
}

export const MAX_DEPTH = 10;
const KEY = 'topics';

function area() {
  return browser.storage?.local;
}

// Storage is private to this extension, but treat it as untrusted anyway:
// corruption, manual devtools edits, or a future migration bug must not crash
// the board. Coerce types, regenerate bad/duplicate ids, and clamp nesting to
// MAX_DEPTH. Iterative walk so a depth bomb in stored JSON can't overflow the
// stack (the recursive helpers below assume sanitized input).
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function sanitizeTopics(v: unknown): Topic[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const fixId = (id: unknown): string => {
    let s = typeof id === 'string' && ID_RE.test(id) ? id : uid();
    while (seen.has(s)) s = uid();
    seen.add(s);
    return s;
  };
  const out: Topic[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const tasks: TaskNode[] = [];
    const stack: Array<{ src: unknown; dest: TaskNode[]; depth: number }> = [
      { src: r.tasks, dest: tasks, depth: 1 },
    ];
    while (stack.length) {
      const { src, dest, depth } = stack.pop()!;
      if (!Array.isArray(src) || depth > MAX_DEPTH) continue;
      for (const item of src) {
        if (!item || typeof item !== 'object') continue;
        const n = item as Record<string, unknown>;
        const node: TaskNode = {
          id: fixId(n.id),
          text: typeof n.text === 'string' ? n.text : '',
          done: n.done === true,
          children: [],
        };
        if (n.collapsed === true) node.collapsed = true;
        dest.push(node);
        if (Array.isArray(n.children) && n.children.length && depth < MAX_DEPTH) {
          stack.push({ src: n.children, dest: node.children, depth: depth + 1 });
        }
      }
    }
    const now = Date.now();
    const num = (x: unknown): number =>
      typeof x === 'number' && Number.isFinite(x) ? x : now;
    out.push({
      id: fixId(r.id),
      title: typeof r.title === 'string' ? r.title : 'Untitled topic',
      createdAt: num(r.createdAt),
      updatedAt: num(r.updatedAt),
      tasks,
    });
  }
  return out;
}

export async function loadTopics(): Promise<Topic[]> {
  const a = area();
  if (!a) return [];
  const got = await a.get(KEY);
  return sanitizeTopics(got[KEY]);
}
export async function saveTopics(topics: Topic[]): Promise<void> {
  const a = area();
  // Fail loudly rather than resolving without writing — callers flash "saved"
  // on success, which must never appear when nothing was persisted.
  if (!a) throw new Error('Extension storage is unavailable.');
  await a.set({ [KEY]: topics });
}

export const uid = (): string => crypto.randomUUID();
export function newTopic(title = 'Untitled topic'): Topic {
  const now = Date.now();
  return { id: uid(), title, createdAt: now, updatedAt: now, tasks: [] };
}
export function newNode(text = ''): TaskNode {
  return { id: uid(), text, done: false, children: [] };
}
export interface Located {
  node: TaskNode;
  list: TaskNode[]; // the array that contains node
  index: number;
  parent: TaskNode | null;
  depth: number; // 1-based
}

export function locate(
  tasks: TaskNode[],
  id: string,
  depth = 1,
  parent: TaskNode | null = null,
): Located | null {
  for (let i = 0; i < tasks.length; i++) {
    const node = tasks[i]!;
    if (node.id === id) return { node, list: tasks, index: i, parent, depth };
    const hit = locate(node.children, id, depth + 1, node);
    if (hit) return hit;
  }
  return null;
}
export function subtreeHeight(node: TaskNode): number {
  if (!node.children.length) return 1;
  return 1 + Math.max(...node.children.map(subtreeHeight));
}
export function countNodes(nodes: TaskNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}
export interface Progress {
  done: number;
  total: number;
}

function tally(nodes: TaskNode[]): Progress {
  let done = 0;
  let total = 0;
  const walk = (ns: TaskNode[]) => {
    for (const n of ns) {
      total++;
      if (n.done) done++;
      walk(n.children);
    }
  };
  walk(nodes);
  return { done, total };
}

/** Progress over ALL descendants of a node (not the node itself). */
export function progress(node: TaskNode): Progress {
  return tally(node.children);
}
/** Progress over every task in a topic. */
export function topicProgress(topic: Topic): Progress {
  return tally(topic.tasks);
}

// --- Cascade checking (down-only) ------------------------------------------------
// Checking/unchecking a PARENT cascades to every descendant. Checking a CHILD
// affects only that child — ancestors keep their own independent `done` flag.
// A parent's checkbox shows its own flag (✓ done / empty not done); the progress
// badge separately reports how many descendants are done.
export type CheckState = 'all' | 'none';

/** A node's own checkbox state, independent of its children. */
export function checkState(n: TaskNode): CheckState {
  return n.done ? 'all' : 'none';
}
/** Set done on a node and every descendant (cascade down). */
export function setSubtreeDone(n: TaskNode, done: boolean): void {
  n.done = done;
  for (const c of n.children) setSubtreeDone(c, done);
}
/** Toggle a node and its whole subtree; ancestors are left untouched. */
export function toggleDone(topic: Topic, id: string): void {
  const loc = locate(topic.tasks, id);
  if (!loc) return;
  setSubtreeDone(loc.node, !loc.node.done);
  touch(topic);
}

export function touch(topic: Topic): void {
  topic.updatedAt = Date.now();
}

/** Add a task under parentId (null = root level). Returns null if depth cap hit. */
export function addTask(topic: Topic, parentId: string | null, text = ''): TaskNode | null {
  const node = newNode(text);
  if (parentId === null) {
    topic.tasks.push(node);
    touch(topic);
    return node;
  }
  const loc = locate(topic.tasks, parentId);
  if (!loc || loc.depth >= MAX_DEPTH) return null;
  loc.node.children.push(node);
  touch(topic);
  return node;
}

export type IndentBlock = 'depth' | 'height' | 'sibling' | null;
/** Why a node can't indent (null = it can). Mirrors the guards in canIndent. */
export function indentBlockReason(topic: Topic, id: string): IndentBlock {
  const loc = locate(topic.tasks, id);
  if (!loc) return null;
  if (loc.depth >= MAX_DEPTH) return 'depth';
  if (loc.depth + subtreeHeight(loc.node) > MAX_DEPTH) return 'height';
  if (loc.index === 0) return 'sibling';
  return null;
}
/** Indent = become the last child of the previous sibling. */
export function canIndent(topic: Topic, id: string): boolean {
  return !!locate(topic.tasks, id) && indentBlockReason(topic, id) === null;
}
export function indentTask(topic: Topic, id: string): boolean {
  if (!canIndent(topic, id)) return false;
  const loc = locate(topic.tasks, id)!;
  const prev = loc.list[loc.index - 1]!;
  loc.list.splice(loc.index, 1);
  prev.children.push(loc.node);
  touch(topic);
  return true;
}
/** Outdent = become the next sibling of your parent. */
export function canOutdent(topic: Topic, id: string): boolean {
  const loc = locate(topic.tasks, id);
  return !!loc && loc.depth > 1;
}
export function outdentTask(topic: Topic, id: string): boolean {
  if (!canOutdent(topic, id)) return false;
  const loc = locate(topic.tasks, id)!;
  const parentLoc = locate(topic.tasks, loc.parent!.id)!;
  loc.list.splice(loc.index, 1);
  parentLoc.list.splice(parentLoc.index + 1, 0, loc.node);
  touch(topic);
  return true;
}
export function removeTask(topic: Topic, id: string): boolean {
  const loc = locate(topic.tasks, id);
  if (!loc) return false;
  loc.list.splice(loc.index, 1);
  touch(topic);
  return true;
}
export function toMarkdown(topic: Topic): string {
  const p = topicProgress(topic);
  const lines: string[] = [
    `# ${topic.title}`,
    '',
    `_${p.done}/${p.total} done · exported ${new Date().toISOString().slice(0, 10)}_`,
    '',
  ];
  const walk = (nodes: TaskNode[], depth: number) => {
    for (const n of nodes) {
      lines.push(`${'  '.repeat(depth - 1)}- [${n.done ? 'x' : ' '}] ${n.text || '(untitled)'}`);
      walk(n.children, depth + 1);
    }
  };
  walk(topic.tasks, 1);
  return lines.join('\n') + '\n';
}
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'topic'
  );
}
