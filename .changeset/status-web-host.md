---
"@figentra-oss/flow": patch
---

`fflow status --web` answers only requests addressed to itself: a Host other than `127.0.0.1:<port>` or
`localhost:<port>` (or none) is 421, and an Origin other than `http://127.0.0.1:<port>` or `http://localhost:<port>`
is 403, so a web page that rebinds its own name to 127.0.0.1 can no longer read `/status.json` and the repositories,
pull requests, branches and sessions it names. Every response also carries `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`.
