---
"@figentra-oss/flow": patch
---

`land` now accepts the AI-REVIEW verdict from the Flow App as well as the reviewer App: it reads verdicts from the
App slugs `apps.review.slug` and `apps.gate.slug`, still matched by App identity (a Bot comment posted through a
listed App), from the first line only. An unlisted App or a User still never counts, and with neither slug set no
review App is configured, as before. An edit to a listed App's comment still voids every verdict before it, except an
edit to the gate's own comment, which starts with the gate marker and is rewritten in place (STA-1945).
