---
"@figentra-oss/flow": patch
---

`fflow render` opens each width at a real screen's height: 800 px from 768 px up and 844 px below, so the default widths render at 1280×800 and 390×844, as SITE's figentra.com job did (it was 900 for every width). `ci.render`'s `heights` sets the height at each width by position.
