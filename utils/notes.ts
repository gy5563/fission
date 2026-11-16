// Shared note model + storage helpers. storage.local is the single source of
// truth; the background worker (captures) and the note window (edits) both
// read-modify-write through here and stay in sync via storage.onChanged.
export interface Note {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  sourceUrl?: string;
  sourceTitle?: string;
}

const KEY = 'notes';

function area() {
  return browser.storage?.local;
}

export async function loadNotes(): Promise<Note[]> {
  const store = area();
  if (!store) return [];
  const res = await store.get(KEY);
  if (Array.isArray(res[KEY])) return res[KEY] as Note[];
  // Migrate the legacy single scratch-pad value, if present.
  const legacy = await store.get('pipNote');
  if (typeof legacy.pipNote === 'string' && legacy.pipNote.trim()) {
    const now = Date.now();
    const migrated: Note = {
      id: crypto.randomUUID(),
      text: legacy.pipNote,
      createdAt: now,
      updatedAt: now,
    };
    await store.set({ [KEY]: [migrated] });
    return [migrated];
  }
  return [];
}

export async function saveNotes(notes: Note[]): Promise<void> {
  await area()?.set({ [KEY]: notes });
}

export async function addNote(input: {
  text: string;
  sourceUrl?: string;
  sourceTitle?: string;
}): Promise<Note> {
  const notes = await loadNotes();
  const now = Date.now();
  const note: Note = { id: crypto.randomUUID(), text: input.text, createdAt: now, updatedAt: now };
  if (input.sourceUrl) note.sourceUrl = input.sourceUrl;
  if (input.sourceTitle) note.sourceTitle = input.sourceTitle;
  notes.unshift(note);
  await saveNotes(notes);
  return note;
}

export async function patchNoteText(id: string, text: string): Promise<void> {
  const notes = await loadNotes();
  const note = notes.find((n) => n.id === id);
  if (!note || note.text === text) return;
  note.text = text;
  note.updatedAt = Date.now();
  await saveNotes(notes);
}

export async function removeNote(id: string): Promise<void> {
  const notes = await loadNotes();
  await saveNotes(notes.filter((n) => n.id !== id));
}

export function noteTitle(n: Note): string {
  const line = n.text.split('\n').find((l) => l.trim());
  if (!line) return 'Untitled';
  return line.length > 60 ? line.slice(0, 60) + '…' : line;
}

export function sourceDomain(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function relTime(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function toJSONExport(notes: Note[]): string {
  return JSON.stringify(
    { app: 'fission-notes', version: 1, exportedAt: new Date().toISOString(), notes },
    null,
    2,
  );
}

export function toMarkdownExport(notes: Note[]): string {
  const parts = [`# Fission Notes — export ${new Date().toISOString().slice(0, 10)}\n`];
  for (const n of notes) {
    parts.push(`## ${noteTitle(n)}`);
    const meta: string[] = [new Date(n.updatedAt).toLocaleString()];
    if (n.sourceUrl) meta.push(`[${n.sourceTitle || sourceDomain(n.sourceUrl)}](${n.sourceUrl})`);
    parts.push(`_${meta.join(' · ')}_\n`);
    parts.push(n.text + '\n');
    parts.push('---\n');
  }
  return parts.join('\n');
}

export function parseImport(raw: unknown): Note[] {
  const arr = Array.isArray(raw) ? raw : (raw as { notes?: unknown } | null)?.notes;
  if (!Array.isArray(arr)) throw new Error('no "notes" array found in file');
  const out: Note[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.text !== 'string') continue;
    const now = Date.now();
    const note: Note = {
      id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
      text: r.text,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
      updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
    };
    if (typeof r.sourceUrl === 'string') note.sourceUrl = r.sourceUrl;
    if (typeof r.sourceTitle === 'string') note.sourceTitle = r.sourceTitle;
    out.push(note);
  }
  return out;
}

export function mergeNotes(
  existing: Note[],
  incoming: Note[],
): { merged: Note[]; added: number; updated: number } {
  const byId = new Map(existing.map((n) => [n.id, n]));
  let added = 0;
  let updated = 0;
  for (const n of incoming) {
    const cur = byId.get(n.id);
    if (!cur) {
      byId.set(n.id, n);
      added++;
    } else if (n.updatedAt > cur.updatedAt) {
      byId.set(n.id, n);
      updated++;
    }
  }
  return { merged: [...byId.values()], added, updated };
}
