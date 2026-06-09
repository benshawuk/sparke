// Alpine / Livewire teardown on swap. Sparke removes whole subtrees; Alpine's
// own MutationObserver only tears down a *removed* node that was itself
// Alpine-marked, so components sitting under a plain <main> wrapper would leak
// on every navigation. Sparke snapshots the live Alpine/Livewire roots before a
// swap and destroys the ones the swap detaches (via the public
// Alpine.destroyTree), while leaving survivors (a persistent shell outside the
// swapped <main>) alone. The fixture stubs Alpine.destroyTree to record which
// roots get torn down.
import { open, ev, sleep, realClick, check, report } from "./cdp.mjs";

const c = await open(`http://localhost:8770/demo/_alpineA`);
await sleep(400);

// Stub is in place, and an initial load (no swap) tears nothing down.
check("Alpine stub present", await ev(c, "typeof window.Alpine.destroyTree"), "function");
check("nothing destroyed before navigation", await ev(c, "(window.__destroyed||[]).length"), 0);
check("component present before nav", await ev(c, "!!document.querySelector('[data-name=comp-1]')"), true);

await realClick(c, "#toB");
await sleep(400);

check("swapped to page B", await ev(c, "document.title"), "Alpine B");
// The component inside the swapped-out <main> was torn down exactly once.
check(
  "detached component destroyed exactly once",
  await ev(c, "JSON.stringify(window.__destroyed||[])"),
  JSON.stringify(["comp-1"])
);
// The persistent shell outside <main> survived and was never destroyed.
check("persistent shell still connected", await ev(c, "!!document.querySelector('[data-name=shell]')"), true);
check("persistent shell not destroyed", await ev(c, "(window.__destroyed||[]).includes('shell')"), false);

c.close();
report("alpine");
