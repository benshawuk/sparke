// Group C (URL normalisation & cache keys) + case 100 (form serialisation).
// These are the [U] pure-logic cases. We exercise the real functions through
// the data-test hook (window.__sparkeInternals), in-browser so the same code
// path the library uses is what's under test.
import { open, ev, sleep, check, report } from "./cdp.mjs";

const c = await open(`http://localhost:8770/demo/_unit`);
await sleep(500);

const has = await ev(c, "!!window.__sparkeInternals");
check("test hook exposed under data-test", has, true);

// Helper to call an internal and return its result by value.
const np = (p) => ev(c, `window.__sparkeInternals.normalizePath(${JSON.stringify(p)})`);
const ck = (u) => ev(c, `window.__sparkeInternals.cacheKey(${JSON.stringify(u)})`);

// 21. /about, /about/, /about.html, /about/index.html -> same route.
check("21 /about", await np("/about"), "/about");
check("21 /about/", await np("/about/"), "/about");
check("21 /about.html", await np("/about.html"), "/about");
check("21 /about/index.html", await np("/about/index.html"), "/about");

// 22. /, /index.html, /index.htm -> /.
check("22 /", await np("/"), "/");
check("22 /index.html", await np("/index.html"), "/");
check("22 /index.htm", await np("/index.htm"), "/");

// 23. nested /blog/post variants -> /blog/post.
check("23 /blog/post", await np("/blog/post"), "/blog/post");
check("23 /blog/post.html", await np("/blog/post.html"), "/blog/post");
check("23 /blog/post/", await np("/blog/post/"), "/blog/post");
check("23 /blog/post/index.html", await np("/blog/post/index.html"), "/blog/post");

// 24. cacheKey includes the query string.
const k1 = await ck("/x?a=1");
const k2 = await ck("/x?a=2");
check("24 cacheKey keeps query (a=1)", k1, "/x?a=1");
check("24 ?a=1 != ?a=2", k1 !== k2, true);

// 25. cacheKey ignores the hash fragment.
check("25 cacheKey drops hash", await ck("/x#frag"), "/x");
check("25 hash variants share a key", (await ck("/x#a")) === (await ck("/x#b")), true);

// 26. Trailing slashes collapsed; root / preserved.
check("26 trailing slash collapsed", await np("/foo/bar/"), "/foo/bar");
check("26 multiple trailing slashes", await np("/foo///"), "/foo");
check("26 root preserved", await np("/"), "/");

// 27. Uppercase extensions handled.
check("27 .HTML", await np("/About.HTML"), "/About");
check("27 /INDEX.HTML", await np("/dir/INDEX.HTML"), "/dir");

// 100. Form serialisation builds the right query string for mixed field types.
// FormData omits unchecked checkboxes (fuzzy) and the unselected radio; the
// activating submit button (go=1) is appended; password is included (a native
// GET submit carries it); empty text field is kept as empty.
const qs = await ev(
  c,
  `(()=>{const f=document.getElementById('f');const b=f.querySelector('button[type=submit]');return window.__sparkeInternals.serializeForm(f,b);})()`
);
const params = new URLSearchParams(qs);
check("100 text field", params.get("q"), "hello world");
check("100 empty text kept", params.get("empty"), "");
check("100 textarea", params.get("note"), "multi\nline");
check("100 select value", params.get("cat"), "docs");
check("100 checked checkbox", params.get("exact"), "yes");
check("100 unchecked checkbox omitted", params.has("fuzzy"), false);
check("100 checked radio only", params.get("r"), "b");
check("100 password included", params.get("pw"), "secret");
check("100 submit button name/value", params.get("go"), "1");

// Form with a file input -> serializeForm returns null (caller falls back).
const fileNull = await ev(
  c,
  `(()=>{const f=document.createElement('form');const i=document.createElement('input');i.type='file';i.name='up';f.appendChild(i);document.body.appendChild(f);
    // give it a file via DataTransfer so FormData yields a File
    const dt=new DataTransfer();dt.items.add(new File(['x'],'x.txt'));i.files=dt.files;
    return window.__sparkeInternals.serializeForm(f,null);})()`
);
check("100 file field -> null (native fallback)", fileNull, null);

// data-sparke-active pattern matching (opt-in section highlighting).
const alm = (p, cur) =>
  ev(c, `window.__sparkeInternals.activeLinkMatch(${JSON.stringify(p)}, ${JSON.stringify(cur)})`);
check("active wildcard matches child", await alm("/blog/*", "/blog/a-post"), true);
check("active wildcard matches prefix sibling", await alm("/demo/tabs-*", "/demo/tabs-dashboard"), true);
check("active wildcard no false match", await alm("/blog/*", "/about"), false);
check("active exact alias matches", await alm("/plans", "/plans"), true);
check("active exact alias normalises .html pattern", await alm("/plans.html", "/plans"), true);
check("active exact alias no prefix match", await alm("/plan", "/plans"), false);
check("active OR of space-separated patterns", await alm("/shop/* /sale", "/sale"), true);
check("active none match -> false", await alm("/shop/* /sale", "/cart"), false);

// wire:navigate deference. A link Livewire owns for its own SPA navigation is
// left to Livewire, so Sparke and wire:navigate never both intercept a click.
// Build the anchor in-page and run it through the real helpers.
const elig = (html) =>
  ev(
    c,
    `(()=>{const d=document.createElement('div');d.innerHTML=${JSON.stringify(html)};` +
      `const a=d.querySelector('a');return window.__sparkeInternals.isEligibleLink(a);})()`
  );
const hasNav = (html) =>
  ev(
    c,
    `(()=>{const d=document.createElement('div');d.innerHTML=${JSON.stringify(html)};` +
      `const a=d.querySelector('a');return window.__sparkeInternals.hasWireNavigate(a);})()`
  );

check("plain same-origin link is eligible", await elig('<a href="/about">About</a>'), true);
check("wire:navigate detected", await hasNav('<a href="/about" wire:navigate>About</a>'), true);
check("wire:navigate.hover detected", await hasNav('<a href="/about" wire:navigate.hover>About</a>'), true);
check("plain link has no wire:navigate", await hasNav('<a href="/about">About</a>'), false);
check("wire:navigate link deferred (ineligible)", await elig('<a href="/about" wire:navigate>About</a>'), false);
check("wire:navigate.hover link deferred", await elig('<a href="/about" wire:navigate.hover>About</a>'), false);

c.close();
report("unit");
