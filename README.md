# Sparke

Turns a standard MPA into an instantly snappy SPA by aggressively preloading
content and atomically swapping pages from memory, upon clicking links. Just
include the JS file - no build step, no config, instant super-snappy website.

Sparke uses progressive enhancement, so it fails safely: if JavaScript is
unavailable, the browser just behaves as a normal MPA.

## Documentation

**Full docs live at [sparke.site](https://sparke.site) - the single source of
truth.** Everything (how it works, configuration, events, framework notes,
server setup, migration) is there.

## Installation

One `<script>` tag. No build step, no package.

```html
<!-- self-hosted (recommended) -->
<script src="/js/sparke.min.js" defer></script>

<!-- or via CDN -->
<script
  src="https://cdn.jsdelivr.net/gh/benshawuk/sparke@1/sparke.min.js"
  defer
></script>
```

Use `defer` and put it in the `<head>`. See [sparke.site](https://sparke.site)
for everything else.

## License

[MIT](LICENSE) © Ben Shaw
