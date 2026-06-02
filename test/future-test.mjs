// Groups V, W, X - Preload crawl, freshness/revalidation, and image/asset
// preloading. Every case here depends on the LOCKED-but-unbuilt cache/crawl/
// revalidate/image system (ROADMAP §4). They are recorded as PENDING so the
// plan's coverage is visible; implement each alongside the feature it covers.
//
// The mock server (serve.py) already grew the hooks these will need:
//   - ETag / If-None-Match -> 304          (revalidation, W)
//   - Cache-Control override (?cache=)      (no-store / max-age, W)
//   - ?delay, ?status, ?type                (timing / fallbacks)
// and image preloading (X) will additionally need cacheable images (serve them
// with ?cache=max-age=... since the default is no-store).
import { pending, report } from "./cdp.mjs";

// V. Preloading scope & crawl ----------------------------------------------
pending("139 data-preload=all crawls the whole reachable site (bounded by cache size)");
pending("140 data-preload=page preloads only the current page's links (expanding per nav)");
pending("141 data-preload=none disables preloading (on-demand only)");
pending("142 crawl resolves relative links against each page's own URL");
pending("143 crawl stops at the cache-size budget (no thrashing)");
pending("144 inter-tab links get preloaded after navigating into the section (slow-3G case)");

// W. Freshness / revalidation ----------------------------------------------
pending("145 after a swap, the current page's links are re-validated in the background");
pending("146 an entry checked within data-revalidate seconds is NOT re-fetched (throttle)");
pending("147 conditional request: 304 keeps cached entry; 200 updates it");
pending("148 the page currently being viewed is never swapped by background revalidation");
pending("149 Cache-Control: no-store pages are not cached (always fresh)");
pending("150 Cache-Control: max-age governs whether revalidation hits the network");

// X. Image / asset preloading ----------------------------------------------
pending("151 data-preload-images warms <img> for preloaded pages (cache hit on later view)");
pending("152 images preloaded SECOND (after HTML, on idle, low priority)");
pending("153 loading=lazy images included when image preloading is on");
pending("154 first srcset candidate handled; CSS background images out of scope");
pending("155 image preloading does not affect the LRU doc cap (browser-cache-backed)");
pending("156 scope dial-down (page/visible) limits which pages' images are warmed");
pending("157 navigator.connection.saveData true -> image preloading off, scope reduced");

report("future");
