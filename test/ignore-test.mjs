// data-ignore: central route opt-out (#25). A link or GET form whose path
// matches a space-separated pattern (same matcher as data-sparke-active) is
// left entirely to the browser - never preloaded or intercepted.
import { open, ev, sleep, check, report } from "./cdp.mjs";

const c = await open(`http://localhost:8770/demo/_ignore`, ["Page", "Runtime"]);
await sleep(500);

check("test hook exposed", await ev(c, "!!window.__sparkeInternals"), true);

const elig = (id) =>
  ev(c, `window.__sparkeInternals.isEligibleLink(document.getElementById(${JSON.stringify(id)}))`);
const eligForm = (id) =>
  ev(c, `window.__sparkeInternals.isEligibleForm(document.getElementById(${JSON.stringify(id)}), null)`);

// Excluded routes -> not eligible (browser handles them).
check("wildcard child /admin/users excluded", await elig("adminChild"), false);
check("exact /checkout excluded", await elig("checkout"), false);
check("/checkout.html normalises -> excluded", await elig("checkoutHtml"), false);

// Not excluded.
check("non-matching /about still eligible", await elig("about"), true);
check("sibling /checkoutx not excluded by exact /checkout", await elig("checkoutSibling"), true);
// Documented semantic: /admin/* matches children, NOT the bare /admin root.
check("bare /admin NOT covered by /admin/*", await elig("adminBare"), true);

// GET forms honour the same exclusion.
check("GET form to /checkout excluded", await eligForm("formIgnored"), false);
check("GET form to /search still eligible", await eligForm("formOk"), true);

// onClick/onSubmit gate on isEligibleLink/isEligibleForm, so the eligibility
// results above ARE the proof of non-interception. (A behavioural click here
// would trigger a real navigation and unload the page, so it isn't asserted.)

c.close();
report("ignore");
