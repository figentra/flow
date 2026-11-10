---
"@figentra-oss/flow": minor
---

`fflow render` and `ci.render`: the render proof of a built site, from SITE's figentra.com job. The command serves the built folder as Cloudflare Pages does and opens every page at each width in Chromium. It fails on a console error, a page error, a failed request or a 4xx/5xx, and on a page that misses the basics (one `h1`, one `main`, a title, `lang`, the right `dir`, no overflow, every image's `alt`), plus any configured redirect, status or CSP request. It saves a screenshot per page. Each `ci.render` entry renders a job that builds the site, installs Playwright at a pin outside the workspace, runs the command and uploads the screenshots, in `Quality Gate`'s needs unless `required: false`.
