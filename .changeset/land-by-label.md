---
"@figentra-oss/flow": minor
---

`fflow land` asks main's land lane instead of merging (STA-1945, the L2 design's PR E). When the base's own
`fflow-approve.yml`, read through the contents API, takes the `fflow:land` label, `land` runs its usual checks, then
adds the label (or comments `/fflow land` once when it is already there) and waits up to `--wait` minutes (default 10) for the lane: a merge finishes as before (exit 0, or 3 on a warning), a refusal prints the lane's reasons (1), an
owner-only change exits 4, a moved head 1 and a timeout 4 (`fflow land <n>` again finishes it). It counts the
`fflow/land` status only from the gate App and only when it is newer than the head's last one. `--no-wait` returns
once asked, `--dry-run` names the path, and `--stack` waits on each PR. It never dispatches, turns on auto-merge or
merges on that path. A base without the label trigger keeps the dispatch path, with a deprecation warning. A branch
GitHub already deleted after the merge now counts as deleted.
