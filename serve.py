#!/usr/bin/env python3
"""
Tiny static dev server with clean-URL support, for the Sparke demo - and the
"mock server" the test suite drives (the way htmx drives sinon's fake server).

Python's built-in `python3 -m http.server` returns 404 for extensionless URLs
like /demo/pricing, because no file by that exact name exists. This server adds
the one thing a production host normally provides: if the requested path has no
file and no extension, it tries "<path>.html" before giving up.

It also understands a handful of query parameters so tests can shape a response
without needing a dedicated route file. They compose (e.g. `?delay=200&status=500`):

    ?delay=<ms>        artificially slow the response (race / slow-connection)
    ?status=<code>     reply with that HTTP status + a tiny HTML body (404/500 …)
    ?type=<mime>       serve the file with this Content-Type (non-HTML fallback)
    ?redirect=<url>    302 to <url> (use a cross-origin URL to test cross-origin)
    ?etag=<token>      send ETag: <token>; honour If-None-Match -> 304 Not Modified
    ?cache=<value>     send Cache-Control: <value> instead of the default no-store

Usage (from the project root, so /demo/... and ../sparke.js both resolve):

    python3 serve.py            # http://localhost:8000
    python3 serve.py 8080       # custom port
"""
import functools
import os
import sys
import time
from urllib.parse import urlparse, parse_qs
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class CleanURLHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Dev server: never let the browser cache anything, so edits to
        # sparke.js / boot.js / pages always show up on reload. (Caching is the
        # source of "I changed it but still see the old version" confusion.)
        # A response may opt out via ?cache=... (sets self._cache_set), e.g. for
        # the freshness/image tests that need real HTTP caching.
        if not getattr(self, "_cache_set", False):
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    # Same-origin redirects, for demonstrating/testing redirect handling.
    REDIRECTS = {
        # Demo-driven (used by the demo + the edge-test bug repro).
        "/demo/old-about": "/demo/about",
        "/demo/old-about-2": "/demo/old-about",
        # Fixture-driven, so the redirect group tests don't depend on demo pages.
        "/demo/_redir-old": "/demo/_redirdest",
        "/demo/_redir-old2": "/demo/_redir-old",  # two-hop chain -> _redirdest
    }

    def do_GET(self):
        parsed = urlparse(self.path)
        q = parse_qs(parsed.query)

        # Convenience: send the bare root straight to the demo's home page,
        # instead of showing a directory listing of the project folder.
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/demo/index.html")
            self.end_headers()
            return

        # A generated large page (stress test: case 164). One <main>, a marker.
        if parsed.path == "/demo/_big":
            block = "<p>lorem ipsum dolor sit amet consectetur adipiscing elit</p>" * 20000
            body = (
                "<!doctype html><html lang=en><head><meta charset=utf-8>"
                "<title>Big</title><script src=/sparke.js></script></head>"
                "<body><main><h1 id=bigmark>Big page</h1>" + block + "</main></body></html>"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return

        # Fixed same-origin redirect routes (kept for the demo + edge tests).
        if parsed.path in self.REDIRECTS:
            self.send_response(302)
            self.send_header("Location", self.REDIRECTS[parsed.path])
            self.end_headers()
            return

        # ?delay=<ms>: artificially slow a response (race guard / slow nav).
        if "delay" in q:
            try:
                time.sleep(int(q["delay"][0]) / 1000.0)
            except ValueError:
                pass

        # ?redirect=<url>: 302 to an arbitrary (possibly cross-origin) URL.
        if "redirect" in q:
            self.send_response(302)
            self.send_header("Location", q["redirect"][0])
            self.end_headers()
            return

        # ?status=<code>: reply with a specific status code and a tiny body, so
        # tests can exercise the 404/500 -> full-navigation fallback path.
        if "status" in q:
            try:
                code = int(q["status"][0])
            except ValueError:
                code = 500
            body = ("<!doctype html><title>Status %d</title><h1>%d</h1>" % (code, code)).encode()
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return

        # ?etag / ?type / ?cache: serve the file with custom headers.
        if "etag" in q or "type" in q or "cache" in q:
            self.serve_custom(parsed.path, q)
            return

        super().do_GET()

    def serve_custom(self, path, q):
        """Serve a file with test-controlled Content-Type / ETag / Cache-Control."""
        fs = self.translate_path(path)
        if not os.path.isfile(fs):
            self.send_error(404, "File not found")
            return

        # Conditional request: honour If-None-Match against ?etag and answer 304.
        etag = q["etag"][0] if "etag" in q else None
        if etag is not None and self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            if "cache" in q:
                self._cache_set = True
                self.send_header("Cache-Control", q["cache"][0])
            self.end_headers()
            return

        with open(fs, "rb") as f:
            body = f.read()
        self.send_response(200)
        ctype = q["type"][0] if "type" in q else self.guess_type(fs)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if etag is not None:
            self.send_header("ETag", etag)
        if "cache" in q:
            self._cache_set = True
            self.send_header("Cache-Control", q["cache"][0])
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def translate_path(self, path):
        fs = super().translate_path(path)
        if os.path.exists(fs):
            return fs
        # Extensionless fallback: /demo/pricing -> /demo/pricing.html
        root, ext = os.path.splitext(fs)
        if not ext and os.path.isfile(fs + ".html"):
            return fs + ".html"
        return fs


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(CleanURLHandler, directory=directory)
    print(f"Serving {os.path.abspath(directory)} on http://localhost:{port}")
    print(f"Open the demo at  http://localhost:{port}/  (redirects to /demo/index.html)")
    print("Clean URLs: /demo/pricing resolves to /demo/pricing.html")
    try:
        ThreadingHTTPServer(("", port), handler).serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
