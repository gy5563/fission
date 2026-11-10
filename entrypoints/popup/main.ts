import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="flex w-80 flex-col items-center gap-4 p-6 font-sans">
    <h1 class="text-2xl font-bold tracking-tight">Fission Notes</h1>
    <p class="text-sm text-neutral-500">Tailwind v4 is wired up. Start building here.</p>
    <button class="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
      Get started
    </button>
  </div>
`;
