---
"@figentra-oss/flow": patch
---

The AI review reader now accepts one reviewer App slug or a list of them: a verdict counts only from the first line of
a Bot comment posted through a listed App, an unlisted App or a User still never counts, and an empty list (or one
holding only unset slugs) means no review App is configured, as before. An edit to a listed App's comment still voids
every verdict before it, except an edit to the gate's own comment, which starts with the gate marker and is rewritten
in place. `land` still reads only `apps.review.slug`; the Flow App's slug joins the list once its key is reachable
only from main's OIDC workflow (STA-1945).
