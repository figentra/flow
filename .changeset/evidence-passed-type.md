---
"@figentra-oss/flow": patch
---

`passed`, which decides whether a task's recorded attempts include a passing one, is typed by the two fields it reads
(`exit` and `clean`), so the attempts of a record, where `ms` is optional, type-check against it (STA-1945 FR-23).
