# Fission Notes

A Chrome extension (Manifest V3, built with [WXT](https://wxt.dev)) for clipping text from any web page into a persistent, floating note window.

## Features

- **Capture from any page** — select text, then right-click → *Save to Fission Notes*, or press **Alt+Shift+S**. Each clipping becomes its own note with the source page's title and URL.
- **Multi-note window** — a persistent browser window with a note list + editor, debounced autosave, and a *saved* indicator. Open it from the toolbar popup.
- **Float on top** — the editor can detach into a [Document Picture-in-Picture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture) window that stays above other apps while you keep browsing. Closing it docks the editor back with your text intact.
- **Local-only storage** — everything lives in `chrome.storage.local`. No accounts, no network calls, no telemetry.
- **Export / import** — download all notes as JSON or Markdown; import a JSON export to merge (newer `updatedAt` wins, nothing is overwritten blindly).
- **Cross-window sync** — captures appear instantly in an open note window via `storage.onChanged`.

## Install (load unpacked)

```sh
pnpm install
pnpm build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `.output/chrome-mv3`.

For development with hot reload: `pnpm dev`.

## Usage

| Action | How |
| --- | --- |
| Save selected text | Right-click → *Save to Fission Notes*, or **Alt+Shift+S** |
| Open the note window | Click the toolbar icon → *Open note window* |
| Float the editor | *⧉ Float on top* in the note window (Chrome 116+) |
| New / delete note | *＋ New* button / × on a list item (with confirm) |
| Visit a note's source | Click the source link under the editor |
| Export | *JSON* / *Markdown* buttons in the note window footer |
| Import | *Import JSON* button — merges into existing notes |

Badge feedback after a capture: **✓** saved · **–** nothing selected · **✕** page can't be captured (e.g. `chrome://` pages).

The shortcut can be changed at `chrome://extensions/shortcuts`.

## Notes

- Notes from the earlier single-scratchpad version (`pipNote` key) are migrated automatically on first load.
- Type-check with `pnpm compile`; if tsc complains about WXT module types, run `pnpm exec wxt prepare` first.

## License

See [LICENSE](./LICENSE).
