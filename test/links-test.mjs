// Group B - Link discovery & eligibility (cases 10-20). Case 20 is [F].
import { openCounting, ev, sleep, check, ok, pending, report } from "./cdp.mjs";

// openCounting registers the Sparke-fetch counter BEFORE navigating, so the
// idle preloads (which race the load event) are reliably observed. No clicks
// happen before the assertions below, so every Sparke fetch here is a preload.
const { c, reqs } = await openCounting(`http://localhost:8770/demo/_links`);
const preloaded = {
  some: (f) => reqs.some((r) => f(r.url)),
  filter: (f) => reqs.filter((r) => f(r.url)).map((r) => r.url),
};

await sleep(500);
const elig = (id) => ev(c, `window.__sparkeInternals.isEligibleLink(document.getElementById(${JSON.stringify(id)}))`);

// 10. Same-origin http(s) link is eligible (and preloaded - see below).
check("10 same-origin eligible", await elig("same"), true);

// 11. Cross-origin ignored.
check("11 cross-origin ignored", await elig("cross"), false);

// 12. target=_blank ignored; target=_self eligible.
check("12 target=_blank ignored", await elig("blank"), false);
check("12 target=_self eligible", await elig("self"), true);

// 13. download ignored.
check("13 download ignored", await elig("download"), false);

// 14. rel=external ignored.
check("14 rel=external ignored", await elig("external"), false);

// 15. hash-only (same page) ignored.
check("15 hash-only ignored", await elig("hashonly"), false);

// 16. mailto:/tel:/javascript: ignored.
check("16 mailto ignored", await elig("mailto"), false);
check("16 tel ignored", await elig("tel"), false);
check("16 javascript: ignored", await elig("js"), false);

// 17. <a> with no href ignored.
check("17 no href ignored", await elig("nohref"), false);

// 18. protocol-relative cross-origin ignored.
check("18 //other-host ignored", await elig("protorel"), false);

// Discovery list: only the eligible same-origin links, deduped.
await sleep(1500); // allow idle preloading to run
const discovered = await ev(c, "window.__sparkeInternals.discoverLinks()");
const origin = await ev(c, "location.origin");
ok("10 discovered includes same-origin target", discovered.includes(origin + "/demo/_p2"));
ok("12 discovered includes target=_self", discovered.includes(origin + "/demo/about"));
ok("11/18 discovered excludes cross-origin", !discovered.some((u) => u.includes("example.com")));

// 10. The eligible link was actually preloaded over the network.
ok("10 same-origin target was preloaded", preloaded.some((u) => u.endsWith("/demo/_p2")));

// 19. Duplicate links dedupe to ONE cache entry / one preload.
const featTimes = discovered.filter((u) => u.endsWith("/demo/features")).length;
check("19 duplicate links collapse in discovery", featTimes, 1);
const featPreloads = preloaded.filter((u) => u.endsWith("/demo/features")).length;
check("19 duplicate links -> single preload fetch", featPreloads, 1);

// 20. [F] Links present only in swapped-in content are discovered after nav
//     (re-discover-on-navigation) - depends on the locked crawl/revalidate work.
pending("20 re-discover links in swapped-in content (crawl/revalidate)");

c.close();
report("links");
