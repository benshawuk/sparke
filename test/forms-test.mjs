// Group O - Forms (cases 91-99; case 100 is in unit-test.mjs).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

const URL = "http://localhost:8770/demo/_form";

// 91/92/93. GET form: swaps (no reload) and serialises mixed fields + submitter.
{
  const c = await open(URL);
  await sleep(500);
  await ev(c, `document.getElementById('q').value='hello world';
              document.getElementById('note').value='a note';
              document.getElementById('cat').value='docs';
              document.getElementById('exact').checked=true;`);
  c.clearEvents();
  await ev(c, `document.getElementById('bget').click()`);
  await sleep(500);
  check("91 GET submit swapped to results", await ev(c, "document.querySelector('main h1').textContent"), "Form Result");
  check("91 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  const search = await ev(c, "location.search");
  const p = new URLSearchParams(search);
  check("92 text serialised", p.get("q"), "hello world");
  check("92 textarea serialised", p.get("note"), "a note");
  check("92 select serialised", p.get("cat"), "docs");
  check("92 checked checkbox serialised", p.get("exact"), "yes");
  check("93 submit button name/value included", p.get("go"), "1");
  check("93 unchecked checkbox omitted", p.has("fuzzy"), false);
  c.close();
}

// 94. formaction on the submitter is honoured (not the form's wrong action).
{
  const c = await open(URL);
  await sleep(500);
  c.clearEvents();
  await ev(c, `document.getElementById('baction').click()`);
  await sleep(500);
  check("94 formaction honoured (went to results, not /wrong)", await ev(c, "location.pathname"), "/demo/_formresult");
  check("94 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 95. formmethod=get on a POST form's submitter -> intercepted & swapped.
//     formtarget=_blank submitter -> NOT eligible.
{
  const c = await open(URL);
  await sleep(500);
  // eligibility via the test hook (deterministic, no nav races)
  check("95 formmethod=get override -> eligible", await ev(c, `window.__sparkeInternals.isEligibleForm(document.getElementById('fpost'), document.getElementById('bpostget'))`), true);
  check("95 formtarget=_blank override -> ineligible", await ev(c, `window.__sparkeInternals.isEligibleForm(document.getElementById('fpost'), document.getElementById('bblanktarget'))`), false);
  // confirm the GET-override actually swaps
  c.clearEvents();
  await ev(c, `document.getElementById('bpostget').click()`);
  await sleep(500);
  check("95 GET-override submit swapped", await ev(c, "document.querySelector('main h1').textContent"), "Form Result");
  check("95 GET-override no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 96/97/98. target=_blank, POST, and hx-* forms are NOT eligible.
{
  const c = await open(URL);
  await sleep(500);
  check("96 GET form target=_blank -> ineligible", await ev(c, `window.__sparkeInternals.isEligibleForm(document.getElementById('fblank'), null)`), false);
  check("97 POST form (no override) -> ineligible", await ev(c, `window.__sparkeInternals.isEligibleForm(document.getElementById('fpost'), null)`), false);
  check("98 hx-* form -> ineligible (left to HTMX)", await ev(c, `window.__sparkeInternals.isEligibleForm(document.getElementById('fhx'), document.getElementById('bhx'))`), false);
  c.close();
}

// 99. A file input present -> Sparke falls back to a native (full) submit.
{
  const c = await open(URL);
  await sleep(500);
  // Give the file input a file so serialisation hits the File branch.
  await ev(c, `(()=>{const i=document.getElementById('up');const dt=new DataTransfer();dt.items.add(new File(['x'],'x.txt'));i.files=dt.files;})()`);
  c.clearEvents();
  await ev(c, `document.getElementById('bfile').click()`);
  await sleep(600);
  check("99 file form did a full (native) submit", c.drain("Page.loadEventFired").length > 0, true);
  check("99 native submit landed on results", await ev(c, "location.pathname"), "/demo/_formresult");
  c.close();
}

report("forms");
