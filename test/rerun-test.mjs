// Per-page script re-execution, opt-in via data-sparke-rerun (#14).
// _rerunA carries three scripts inside <main>: an "always" one, a "once" one,
// and a plain (unmarked) one, each bumping a window counter. We verify which
// re-run on swap-in and which don't.
import { open, ev, sleep, check, report } from "./cdp.mjs";

const n = (c, name) => ev(c, `window.${name}||0`);

// Scenario 1: land directly on the page that carries the scripts. The initial
// parse runs all three; the "once" script is seeded so it won't re-run.
{
  const c = await open("http://localhost:8770/demo/_rerunA");
  await sleep(500);
  check("initial load: always ran once", await n(c, "__always"), 1);
  check("initial load: once ran once", await n(c, "__once"), 1);
  check("initial load: plain ran once", await n(c, "__plain"), 1);

  // Swap away and back: the marked "always" script re-runs; "once" is deduped;
  // the unmarked plain script never re-runs.
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(300);
  await ev(c, `document.getElementById('toA').click()`);
  await sleep(300);
  check("after swap back: always re-ran", await n(c, "__always"), 2);
  check("after swap back: once did NOT re-run (landing seeded)", await n(c, "__once"), 1);
  check("after swap back: plain (unmarked) did NOT re-run", await n(c, "__plain"), 1);

  // A second round trip: always keeps re-running, once stays put.
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(300);
  await ev(c, `document.getElementById('toA').click()`);
  await sleep(300);
  check("second round trip: always re-ran again", await n(c, "__always"), 3);
  check("second round trip: once still once", await n(c, "__once"), 1);
  c.close();
}

// Scenario 2: arrive at the once-page for the FIRST time via a swap (it was not
// the landing page, so it was never parsed natively). The once script runs that
// first time, then never again.
{
  const c = await open("http://localhost:8770/demo/_rerunB");
  await sleep(500);
  check("landed on B: once script absent here", await n(c, "__once"), 0);
  await ev(c, `document.getElementById('toA').click()`); // first swap into A
  await sleep(300);
  check("first swap into A: once ran", await n(c, "__once"), 1);
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(300);
  await ev(c, `document.getElementById('toA').click()`); // second arrival
  await sleep(300);
  check("second swap into A: once did NOT re-run", await n(c, "__once"), 1);
  check("second swap into A: always re-ran each time", await n(c, "__always"), 2);
  c.close();
}

report("rerun");
