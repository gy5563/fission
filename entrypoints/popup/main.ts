import './style.css';
import { loadTopics, countNodes } from '../../utils/tree';

// The popup itself CANNOT host a Document PiP window: a PiP window never
// outlives its opener, and a popup unloads the moment it loses focus. So the
// button asks the background worker to open the persistent board window, and
// *that* window does the Document PiP floating.
async function openBoard() {
  const status = document.getElementById('status')!;
  try {
    const res = await browser.runtime.sendMessage({ type: 'open-board-window' });
    status.textContent = res?.ok
      ? 'Fission opened ✓ — pick a topic, then ⧉ Float.'
      : `Not opened: ${JSON.stringify(res)}`;
  } catch (err) {
    status.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="flex w-80 flex-col items-center gap-3 p-6 font-sans">
    <h1 class="text-2xl font-bold tracking-tight">Fission</h1>
    <p class="text-sm text-neutral-500">Break it down. Check it off. Float it on top.</p>
    <button id="open" class="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
      Open Fission
    </button>
    <p id="count" class="text-xs text-neutral-400"></p>
    <p class="text-center text-xs text-neutral-500">
      3-level nested checklists · PDF / Markdown export<br/>
      Everything stays on this device.
    </p>
    <p id="status" class="min-h-4 text-center text-xs text-neutral-500"></p>
  </div>
`;

document.getElementById('open')!.addEventListener('click', () => void openBoard());

void loadTopics().then((topics) => {
  const tasks = topics.reduce((s, t) => s + countNodes(t.tasks), 0);
  document.getElementById('count')!.textContent = topics.length
    ? `${topics.length} topic${topics.length === 1 ? '' : 's'} · ${tasks} task${tasks === 1 ? '' : 's'} saved locally`
    : 'No topics yet — open Fission to create one';
});
