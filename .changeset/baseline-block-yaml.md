---
"@figentra-oss/flow": patch
---

`sync` writes the baseline workflow's setup steps as block YAML, not JSON flow mappings, which the Stackra YAML
standard (STA-299, `repo-checks/yaml-flow-maps`) refuses. The values are unchanged (STA-1942).
