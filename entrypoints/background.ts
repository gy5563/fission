export default defineBackground(() => {
  // Open the persistent note window (a real window — survives unlike popups).
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'open-note-window') {
      void browser.windows
        .create({
          url: browser.runtime.getURL('/note.html'),
          type: 'popup',
          width: 400,
          height: 340,
        })
        .then((win) => sendResponse({ ok: true, windowId: win?.id }));
      return true; // keep the message channel open for the async reply
    }
  });
});
