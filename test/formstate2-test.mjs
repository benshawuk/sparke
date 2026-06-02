// Group P - Form-state restore on Back/Forward (cases 101-105).
// (The original formstate-test.mjs covers the demo search form; this adds the
// full matrix incl. fresh-forward, file/password exclusion, and the mismatch
// guard via the test hook.)
import { open, ev, sleep, check, report } from "./cdp.mjs";

// 101/102/104. Fill -> leave -> Back restores text/select/checkbox/radio, but
// NOT password or file.
{
  const c = await open(`http://localhost:8770/demo/_fstate`);
  await sleep(500);
  await ev(c, `document.getElementById('q').value='typed text';
              document.getElementById('cat').value='blog';
              document.getElementById('exact').checked=true;
              document.getElementById('rb').checked=true;
              document.getElementById('pw').value='secret';
              (()=>{const i=document.getElementById('up');const dt=new DataTransfer();dt.items.add(new File(['x'],'x.txt'));i.files=dt.files;})();`);
  await ev(c, `document.getElementById('toTwo').click()`); // leaves _fstate (captures)
  await sleep(400);
  check("setup: on FState Two", await ev(c, "document.querySelector('main h1').textContent"), "FState Two");
  await ev(c, "history.back()");
  await sleep(500);
  check("101 text restored", await ev(c, "document.getElementById('q').value"), "typed text");
  check("102 select restored", await ev(c, "document.getElementById('cat').value"), "blog");
  check("102 checkbox restored", await ev(c, "document.getElementById('exact').checked"), true);
  check("102 radio restored", await ev(c, "document.getElementById('rb').checked"), true);
  check("104 password NOT restored", await ev(c, "document.getElementById('pw').value"), "");
  check("104 file NOT restored", await ev(c, "document.getElementById('up').files.length"), 0);
  c.close();
}

// 103. A fresh forward visit shows an empty form (not restored).
{
  const c = await open(`http://localhost:8770/demo/_fstate`);
  await sleep(500);
  await ev(c, `document.getElementById('q').value='will not survive a fresh visit';`);
  await ev(c, `document.getElementById('toTwo').click()`); // leave (captures state)
  await sleep(400);
  // Fresh FORWARD navigation back to _fstate (not popstate) -> not restored.
  await ev(c, `document.getElementById('toOne').click()`);
  await sleep(400);
  check("103 fresh forward visit: form is empty", await ev(c, "document.getElementById('q').value"), "");
  c.close();
}

// 105. Structure mismatch between capture and restore -> skipped safely.
//      Exercised through the hook: capture, then change the control count.
{
  const c = await open(`http://localhost:8770/demo/_fstate`);
  await sleep(500);
  const result = await ev(c, `(()=>{
    var I = window.__sparkeInternals;
    var url = location.href;
    document.getElementById('q').value = 'captured';
    I.captureFormState(url);
    // Now change the structure: add an extra field so the count won't match.
    var extra = document.createElement('input');
    extra.type = 'text'; extra.name = 'extra';
    document.querySelector('form').appendChild(extra);
    // Wipe the typed value; a mismatched restore must NOT put it back.
    document.getElementById('q').value = '';
    try { I.restoreFormState(url); return { ok: true, q: document.getElementById('q').value }; }
    catch (e) { return { ok: false, err: String(e) }; }
  })()`);
  check("105 mismatch restore did not throw", result.ok, true);
  check("105 mismatch restore left fields untouched (skipped)", result.q, "");
  c.close();
}

report("formstate2");
