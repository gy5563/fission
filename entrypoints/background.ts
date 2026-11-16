import { addNote } from '../utils/notes';

export default defineBackground(() => {
  const NOTE_URL = browser.runtime.getURL('/note.html');
  const MENU_ID = 'save-to-fission-notes';

  void browser.action.setBadgeText({ text: '' });

  // --- Note window -----------------------------------------------------------
  // Focus the existing note window, or open a persistent popup-type window.
  // A real window (unlike the action popup) survives focus loss and can host
  // Document PiP — the popup itself can never keep a PiP window alive.
  async function openNoteWindow(): Promise<number | undefined> {
    const wins = await browser.windows.getAll({ populate: true });
    for (const w of wins) {
      if (w.tabs?.some((t) => t.url?.startsWith(NOTE_URL))) {
        await browser.windows.update(w.id!, { focused: true });
        return w.id;
      }
    }
    const w = await browser.windows.create({
      url: NOTE_URL,
      type: 'popup',
      width: 760,
      height: 540,
    });
    return w?.id;
  }

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'open-note-window') {
      void openNoteWindow().then((windowId) => sendResponse({ ok: true, windowId }));
      return true; // keep the message channel open for the async reply
    }
    // Capture initiated from a page (content script) — same save path as the
    // context menu and the keyboard shortcut.
    if (msg?.type === 'capture-selection' && typeof msg.text === 'string' && msg.text.trim()) {
      const tabId = sender.tab?.id;
      if (tabId == null) {
        sendResponse({ ok: false, error: 'no sender tab' });
        return;
      }
      void saveCapture(tabId, msg.text.trim()).then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  // --- Capture: context menu + keyboard shortcut ------------------------------
  // removeAll first: defineBackground's main runs on EVERY service-worker
  // startup, and contextMenus.create with a duplicate id throws.
  void browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: 'Save to Fission Notes',
      contexts: ['selection'],
    });
  });

  async function flashBadge(text: string, color: string) {
    await browser.action.setBadgeBackgroundColor({ color });
    await browser.action.setBadgeText({ text });
    setTimeout(() => void browser.action.setBadgeText({ text: '' }), 1600);
  }

  async function saveCapture(tabId: number, selectionText: string) {
    // URL/title come from the content script (no "tabs" permission needed).
    let sourceUrl: string | undefined;
    let sourceTitle: string | undefined;
    try {
      const info = await browser.tabs.sendMessage(tabId, { type: 'get-page-info' });
      sourceUrl = info?.url;
      sourceTitle = info?.title;
    } catch {
      /* page without our content script (chrome:// etc.) — save text only */
    }
    await addNote({ text: selectionText, sourceUrl, sourceTitle });
    try {
      await browser.tabs.sendMessage(tabId, { type: 'note-saved' });
    } catch {
      /* toast is best-effort */
    }
    await flashBadge('✓', '#16a34a');
  }

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID && info.selectionText?.trim() && tab?.id != null) {
      void saveCapture(tab.id, info.selectionText.trim());
    }
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== 'save-selection') return;
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id == null) return;
      try {
        const res = await browser.tabs.sendMessage(tab.id, { type: 'get-selection' });
        if (res?.text?.trim()) {
          await saveCapture(tab.id, res.text.trim());
        } else {
          try {
            await browser.tabs.sendMessage(tab.id, {
              type: 'toast',
              text: 'Nothing selected — select text first.',
            });
          } catch {
            /* ignore */
          }
          await flashBadge('–', '#737373');
        }
      } catch {
        // No content script on this page (chrome://, web store, …).
        await flashBadge('✕', '#dc2626');
      }
    })();
  });
});
