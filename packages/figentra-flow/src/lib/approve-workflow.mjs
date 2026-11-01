/**
 * Figentra Flow file contract:
 * Purpose: the approval workflow `sync` renders into a repository (STA-1856 FR-4): dispatched with `pr` and `head`, it
 *   approves the PR as a GitHub App at that head after re-checking in code what an author could get around: the PR is
 *   open and not a draft, its head is in this repository and equals `head`, its author is not the approving App, no
 *   changed path (a rename's old one too) is owner-only (`ownerOnlyPattern`), and every required check passed or was
 *   skipped, with one passing. A refused PR gets one comment with the reasons and the run fails.
 * Boundary: returns text; writes nothing. The workflow never checks out or runs the PR's code and never merges (auto
 *   merge does, after every required check).
 * Runtime: node
 * Governing contract: STA-1856 FR-4.
 * Secrets: names the App id and key secrets the preset gives, held by the `APPROVE_ENVIRONMENT` environment (default
 *   branch only, so a branch cannot mint the token); holds no value.
 */
import { ownerOnlyPattern } from "./owner-only.mjs";
import { APPROVE_ENVIRONMENT, NAME } from "./product.mjs";

const APP_TOKEN =
  "actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0";

/**
 * The workflow's YAML.
 * @param {{ appId: string, privateKey: string }} secrets the names of the App id and key secrets
 */
export function approveWorkflow({ appId, privateKey }) {
  return `# Written by \`${NAME} sync\`; \`${NAME} land\` dispatches it when the ruleset requires a review (STA-1856).
# Change the owner-only list in ${NAME}, not here: \`${NAME} gate ci\` fails on a hand edit.
name: ${NAME} approve
run-name: ${NAME} approve PR \${{ inputs.pr }} at \${{ inputs.head }}

on:
  workflow_dispatch:
    inputs:
      pr:
        description: Pull request number
        required: true
        type: number
      head:
        description: The head SHA the caller checked; the approval is refused if the PR moved since
        required: true
        type: string

permissions: {}

concurrency:
  group: ${NAME}-approve-\${{ inputs.pr }}
  cancel-in-progress: false

jobs:
  approve:
    # The App's key is only in this environment, which allows the default branch only.
    environment: ${APPROVE_ENVIRONMENT}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: read
      checks: read
      statuses: read
    steps:
      - name: App token
        id: app
        uses: ${APP_TOKEN}
        with:
          app-id: \${{ secrets.${appId} }}
          private-key: \${{ secrets.${privateKey} }}
          permission-pull-requests: write

      - name: Check and approve
        env:
          GH_TOKEN: \${{ github.token }}
          APP_TOKEN: \${{ steps.app.outputs.token }}
          APPROVER: \${{ steps.app.outputs.app-slug }}[bot]
          REPO: \${{ github.repository }}
          PR: \${{ inputs.pr }}
          EXPECTED_HEAD: \${{ inputs.head }}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
          OWNER_ONLY: '${ownerOnlyPattern()}'
        run: |
          set -euo pipefail
          refuse=()
          [[ $EXPECTED_HEAD =~ ^[0-9a-f]{40}$ ]] || refuse+=("\\\`head\\\` is not a 40-hex SHA")

          pr=$(gh api "repos/$REPO/pulls/$PR")
          sha=$(jq -r .head.sha <<<"$pr")
          [ "$(jq -r .state <<<"$pr")" = open ] || refuse+=("the PR is not open")
          [ "$(jq -r .draft <<<"$pr")" = false ] || refuse+=("the PR is a draft")
          [ "$(jq -r .head.repo.full_name <<<"$pr")" = "$REPO" ] || refuse+=("the head is not in $REPO")
          [ "$sha" = "$EXPECTED_HEAD" ] || refuse+=("the head is $sha, not the $EXPECTED_HEAD that was checked")
          [ "$(jq -r .user.login <<<"$pr")" != "$APPROVER" ] || refuse+=("the author is $APPROVER, the approving App")

          # A rename counts from both sides: moving a file out of an owner-only path is owner-only too.
          files=$(gh api --paginate "repos/$REPO/pulls/$PR/files?per_page=100" \\
            --jq '.[] | .filename, (.previous_filename // empty)' | sort -u)
          listed=$(gh api --paginate "repos/$REPO/pulls/$PR/files?per_page=100" --jq '.[].filename' | wc -l)
          [ "$listed" -ge "$(jq -r .changed_files <<<"$pr")" ] || refuse+=("GitHub lists only $listed changed files")
          owned=$(grep -P "$OWNER_ONLY" <<<"$files" || true)
          [ -z "$owned" ] || refuse+=("owner-only paths: $(head -20 <<<"$owned" | paste -sd, | sed 's/,/, /g')")

          checks=$(gh pr checks "$PR" --repo "$REPO" --required --json name,bucket 2>/dev/null) || true
          if ! jq -e 'type == "array" and length > 0' <<<"$checks" >/dev/null 2>&1; then
            refuse+=("no required check is reported")
          else
            red=$(jq -r '.[] | select(.bucket != "pass" and .bucket != "skipping") | "\\(.name) (\\(.bucket))"' <<<"$checks")
            [ -z "$red" ] || refuse+=("required checks not green: $(paste -sd, <<<"$red" | sed 's/,/, /g')")
            jq -e 'any(.[]; .bucket == "pass")' <<<"$checks" >/dev/null || refuse+=("no required check passed")
          fi

          if ((\${#refuse[@]})); then
            body=$(printf '${NAME} approve refused ([run](%s)):\\n\\n' "$RUN_URL"; printf -- '- %s\\n' "\${refuse[@]}")
            GH_TOKEN=$APP_TOKEN gh pr comment "$PR" --repo "$REPO" --body "$body"
            printf '::error::%s\\n' "\${refuse[@]}"
            exit 1
          fi
          GH_TOKEN=$APP_TOKEN gh api -X POST "repos/$REPO/pulls/$PR/reviews" -f commit_id="$sha" -f event=APPROVE \\
            -f body="Approved at $sha by ${NAME} approve: no owner-only path, required checks green ([run]($RUN_URL))." >/dev/null
          echo "Approved $REPO#$PR at $sha as $APPROVER"
`;
}
