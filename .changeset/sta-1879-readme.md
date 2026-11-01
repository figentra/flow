---
"@figentra-oss/flow": minor
---

`figentra-flow readme [--check]` renders a repository's `README.md` from `.flow/readme.yml` through the preset's `readme-template` (STA-1879). The `stackra` preset ships Figentra's standard layout: banner, badges, tagline, What it is, Status, Quick start, Architecture at a glance, Development, Docs and playground, Release and changelog, Security, Licence and the footer. `sync` renders the README too, when the data file exists, and records it in `.flow/lock.json`, so `gate ci` catches a hand edit.
