# Fission

Fission is a Chrome extension for **nested
to-do lists that float on top**. Unlike a normal checklist, Fission lets you
break every task down into more detailed tasks — up to **10 levels deep** — and
keep the whole tree in a Picture-in-Picture window while you work.

## MVP flow

1. Click the toolbar icon → **Open Fission**
2. Create a **topic** (a project or area to break down)
3. Build the checklist: tasks → subtasks → sub-subtasks
4. **⧉ Float** — the topic opens in a floating [Document PiP](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)
   window that stays on top of everything; check off and edit tasks right there
5. Export the tree with its checked states: **PDF** (visual diagram) or
   **Markdown** (`- [x]` checklist)

## Features

- **Topics** — rename, delete, progress at a glance (`4/9 done`)
- **10-tier nesting** — `＋` adds a subtask; `→`/`←` buttons or `Tab` /
  `Shift+Tab` indent/outdent. Depth *and* subtree height are enforced, so
  nothing can exceed level 10
- **Cascade checking (down-only)** — checking or unchecking a parent applies to
  its whole subtree; checking a child affects only that child and never changes
  its parent. Each checkbox shows the task's own state (✓ done / empty), plus a
  live progress badge (`2/5` — green when all descendants are done, amber when
  partial)
- **Wrapped, expandable text** — task text wraps and auto-grows; long tasks clamp
  to two lines with a `⤢` toggle (and auto-expand while focused) so the full list
  stays scannable. `Shift+Enter` inserts a newline
- **Collapsible subtrees** — fold any parent (`▾`/`▸`) to hide its branch; the
  progress badge stays visible and the fold state is saved
- **Deep-tree scrolling** — text keeps a readable minimum width, so wide trees
  scroll horizontally and the active row snaps into view
- **Click-safe editing** — task text is read-only until you hit the row's `✎`
  button (new tasks open ready to type), so stray clicks select a task but
  can't change it
- **Active-row highlight** — the task you're working in gets a soft green tint + border
  ("you are here"); it follows focus and clicks, persists after you click away,
  and survives re-renders, horizontal scroll, and the PiP window
- **Per-task timers** — focus a task, hit `⏱ Timer`, pick a preset
  (5 / 15 / 25 / 45 min) or a custom length. A live `⏱ mm:ss` chip counts down
  on the row and turns into an amber `⏰ time's up` when it ends. Timers keep
  their end time across reloads and restarts, and work in the floating window
- **Fade on leave** — with the `◑ Fade` toggle on (the default), the floating
  window dims to ≈40% when your pointer leaves it — except the highlighted
  task, which stays fully visible. Moving back in restores everything, and the
  preference is saved
- **Keyboard flow** — `Enter` adds the next sibling, `Backspace` on an empty
  task deletes it, `Tab`/`Shift+Tab` re-nest
- **Full editing while floating** — the PiP window hosts the same live DOM
  (check, add, rename, re-nest); closing it docks the tree back into the board
- **Export**
  - **PDF** — a horizontal (left-to-right) tree diagram: boxes, smooth curved
    connectors, green checkmarks for done tasks, progress badges on parents,
    strikethrough text
  - **Markdown** — nested `- [x]` / `- [ ]` with a progress header
- **Always saved** — every edit is written to storage immediately, so lists,
  progress, timers and preferences survive closing the window or restarting
  Chrome
- **Local-only** — everything lives in `chrome.storage.local`; no network, no
  telemetry, no account
- **Shadcn-style grey design** — soft grey palette, rounded controls, subtle
  shadows and focus rings across the board, popup and floating window

## Architecture

| Piece | Role |
| --- | --- |
| `utils/tree.ts` | Topic/task model (incl. timers), tree ops (locate/add/indent/outdent/remove), depth rules, down-only cascade, progress, Markdown |
| `utils/pdf.ts` | jsPDF visual-tree renderer (horizontal leaf-cursor layout, curved Bézier links, scaled to one A4 landscape page); lazy-loaded on export |
| `entrypoints/background.ts` | Opens/focuses the single persistent board window |
| `entrypoints/board/` | Topic sidebar + checklist tree + Document PiP host + exports |
| `entrypoints/popup/` | Launcher (a popup can't host PiP — it unloads on focus loss) |

## Install (load unpacked)

```sh
pnpm install
pnpm build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → select `.output/chrome-mv3`.

Requires Chrome 116+ for Document Picture-in-Picture.

## Development

```sh
pnpm dev        # WXT dev server with HMR
pnpm compile    # typecheck (run `pnpm exec wxt prepare` first if WXT types are missing)
pnpm build      # production build → .output/chrome-mv3
```

## License

See [LICENSE](./LICENSE).
