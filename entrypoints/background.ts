export default defineBackground(() => {
  const BOARD_URL = browser.runtime.getURL('/board.html');

  // Open (or focus) the single persistent Fission board window. The action
  // popup can't host Document PiP itself — it unloads on focus loss — so the
  // board window is the PiP host.
  async function openBoardWindow(): Promise<number | undefined> {
    const wins = await browser.windows.getAll({ populate: true });
    for (const w of wins) {
      if (w.tabs?.some((t) => t.url?.startsWith(BOARD_URL))) {
        await browser.windows.update(w.id!, { focused: true });
        return w.id;
      }
    }
    const w = await browser.windows.create({
      url: BOARD_URL,
      type: 'popup',
      width: 860,
      height: 600,
    });
    return w?.id;
  }

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'open-board-window') {
      void openBoardWindow().then((windowId) => sendResponse({ ok: true, windowId }));
      return true; // keep the message channel open for the async reply
    }
  });

  // One-time cleanup of the pre-Fission notes model (replaced by topics).
  void browser.storage?.local.remove(['notes', 'pipNote']);
});
