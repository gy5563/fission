import './style.css';

// The popup itself CANNOT host a Document PiP window: a PiP window never
// outlives its opener, and a popup unloads the moment it loses focus (with no
// way to veto that). So the button asks the background worker to open a
// persistent note window, and *that* window does the Document PiP floating.
async function openNoteWindow() {
  const status = document.getElementById('status')!;
  try {
    const res = await browser.runtime.sendMessage({ type: 'open-note-window' });
    status.textContent = res?.ok
      ? 'Note window opened ✓ — “Float on top” lives in there.'
      : `Not opened: ${JSON.stringify(res)}`;
  } catch (err) {
    status.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="flex w-80 flex-col items-center gap-4 p-6 font-sans">
    <h1 class="text-2xl font-bold tracking-tight">Fission Notes</h1>
    <p class="text-sm text-neutral-500">Scratch pad that floats above every window.</p>
    <button id="open" class="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
      Open note window
    </button>
    <p id="status" class="min-h-4 text-center text-xs text-neutral-500"></p>
  </div>
`;

document.getElementById('open')!.addEventListener('click', () => void openNoteWindow());
