export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'get-selection') {
        sendResponse({ text: window.getSelection()?.toString() ?? '' });
        return;
      }
      if (msg?.type === 'get-page-info') {
        sendResponse({ url: location.href, title: document.title });
        return;
      }
      if (msg?.type === 'note-saved') {
        showToast('Saved to Fission Notes ✓');
        return;
      }
      if (msg?.type === 'toast' && typeof msg.text === 'string') {
        showToast(msg.text);
        return;
      }
    });

    // Toast lives in a closed shadow root with inline styles so page CSS
    // cannot touch it (and it cannot leak styles into the page).
    let toastHost: HTMLElement | null = null;
    function showToast(text: string) {
      toastHost?.remove();
      const host = document.createElement('div');
      host.style.cssText =
        'position:fixed;bottom:20px;right:20px;z-index:2147483647;pointer-events:none;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText =
        'background:#171717;color:#fafafa;padding:8px 14px;border-radius:8px;' +
        'font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35);' +
        'opacity:0;transition:opacity .2s;';
      shadow.appendChild(el);
      document.documentElement.appendChild(host);
      toastHost = host;
      requestAnimationFrame(() => {
        el.style.opacity = '1';
      });
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => {
          host.remove();
          if (toastHost === host) toastHost = null;
        }, 250);
      }, 1800);
    }
  },
});
