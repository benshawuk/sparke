// Group J - Head synchronisation (cases 68-72).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

// 68/69/70/72. A -> B: title/description/canonical updated; head scripts &
// stylesheets neither executed nor duplicated.
{
  const c = await open(`http://localhost:8770/demo/_headA`);
  await sleep(500);
  const hsBefore = await ev(c, "window.__hs");
  const headScriptsBefore = await ev(c, "document.head.querySelectorAll('script').length");
  check("setup: A's own head script ran once", hsBefore, 1);

  await ev(c, `document.getElementById('toB').click()`);
  await sleep(400);
  check("68 <title> updated", await ev(c, "document.title"), "Head B");
  check("69 meta description replaced", await ev(c, `document.querySelector('meta[name=description]').content`), "desc B");
  ok("70 canonical replaced", (await ev(c, `document.querySelector('link[rel=canonical]').href`)).endsWith("/demo/_headB"));

  // 72. B's head <script> did NOT execute (counter unchanged), and head scripts
  //     were not duplicated by the sync.
  check("72 incoming head <script> not executed", await ev(c, "window.__hs"), 1);
  check("72 head <script> count unchanged (no dup)", await ev(c, "document.head.querySelectorAll('script').length"), headScriptsBefore);
  check("72 shared stylesheet not duplicated", await ev(c, `document.head.querySelectorAll('link[href$="style.css"]').length`), 1);
  c.close();
}

// 71. Missing description/canonical in incoming -> removed from current head.
{
  const c = await open(`http://localhost:8770/demo/_headA`);
  await sleep(500);
  ok("71 setup: A has a description", await ev(c, `!!document.querySelector('meta[name=description]')`));
  ok("71 setup: A has a canonical", await ev(c, `!!document.querySelector('link[rel=canonical]')`));
  await ev(c, `document.getElementById('toC').click()`); // C has neither
  await sleep(400);
  check("71 description removed", await ev(c, `!!document.querySelector('meta[name=description]')`), false);
  check("71 canonical removed", await ev(c, `!!document.querySelector('link[rel=canonical]')`), false);
  c.close();
}

report("head");
