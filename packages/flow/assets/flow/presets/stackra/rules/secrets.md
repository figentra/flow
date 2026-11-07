---
title: Secrets
always: true
description: Secret management and environment configuration
---

# Secrets

Stackra keeps every secret value as a SOPS file in the private repository `figentra/secrets`, encrypted with Google
Cloud KMS (ADR 0525, which replaces Infisical; ADR 0173's runway sync stands). Runway syncs production values into the
runtimes on deploy. Secret names are in git; values never are, except as ciphertext in `figentra/secrets`.

**Invariant: nobody reads a value.** A value is set by a human, generated, or written by the secret-manager flow
(section 3, ADR 0257), without anyone, the agent included, ever seeing it.

## 1. App Secrets (Encore, generated app)

Services are plain TypeScript and hold no Encore files. The Encore application is generated into the
gitignored `.stackra/encore` (ADR 0091), and app secrets reach it through Encore `secret()` there:

```typescript
import { secret } from "encore.dev/config";

const stripeSecretKey = secret("STRIPE_SECRET_KEY");
```

- A product's runtime secrets live in its scope `products/<product>/<dev|staging|production>`. Runway syncs them into
  Encore, Cloudflare Workers and EAS on deploy, from the CI job that decrypted the scope (ADR 0173, ADR 0525)
- A human sets each value per environment, or `pnpm secrets:generate` makes a random one; an agent only names the
  secret (ADR 0257)
- Never in git as plain text
- Every name is declared once in code (ADR 0173 amendment 2026-11-04): `Config({ schema, env })` or `@Secret`, never
  a raw `process.env.X` (`stackra/no-raw-env`). `runway env check` fails on a name with no declaration or no home in
  `figentra/secrets`; `runway env sync` pushes values to the runtimes; no command prints a value

## 2. Dev/CI Secrets

### Layout (`figentra/secrets`, ADR 0525)

One file per secret, `<scope>/<NAME>.enc.yaml`; `catalog.yaml` lists every name with its owner, purpose, kind and
rotation (`pnpm secrets:catalog`). Each scope has its own KMS key:

- `agents` - developer and agent tokens (the root scripts, MCP servers); only the owner's Google login decrypts it
- `ci/build[/folder]` - read-only build tokens (every CI job, PR checks, testbed), e.g. `ci/build/registry`
- `ci/deploy[/folder]` - deploy and release credentials for dev and staging
- `ci/production[/folder]` - production credentials, granted only to a `production` environment job on main
- `ci/flow[/folder]` - the Flow gate App (`ci/flow/gate`)
- `products/<product>/<dev|staging|production>` - a product's runtime secrets, synced by runway

Who may decrypt which scope is figentra/infra's `estate/secret-callers.mjs`, never a repository secret.

### How to Use

**Local development:**

A token reaches a process only through the pnpm script that needs it (`pnpm bot:gh`, `pnpm linear`, `pnpm bot:git`).
Each runs `node tools/scripts/secrets-exec.mjs --names A,B -- <command>` in core, which decrypts only the names it lists
from a local clone of `figentra/secrets` (`~/.stackra/secrets`) in memory, puts them in the child's environment only
and prints nothing. A tool in another repository reads its values from its own environment and leaves it to the caller
to provide them. A new flow that needs a token gets its own pnpm script that names its secrets.

**CI/CD:**

A job decrypts one scope with core's action, after its Toolchain (mise) step, and needs `permissions: id-token: write`:

```yaml
- name: Registry token (sops)
  uses: figentra/stackra/.github/actions/secrets-decrypt@<sha> # @stackra/runway@<version>
  with:
    scope: ci/build/registry
    names: STACKRA_REGISTRY_TOKEN
```

It signs in to Google Cloud as the job itself (Workload Identity, no stored key) and puts the named values, masked,
into the job's environment. Workers deploy from CI with `CLOUDFLARE_API_TOKEN` from `ci/deploy` (or `ci/production`)
(ADR 0284, ADR 0289). A workstation `encore deploy` stays denied (`guard-bash` and settings): Encore deploys run from a
CI workflow, staging on a merge to main and production behind the owner's Environment approval, once a repository ships
an Encore app (ADR 0468 decision 6).

**MCP servers:**
Token-based MCP servers launch through `tools/scripts/mcp.sh`, which runs `secrets-exec.mjs` with only the names the
server needs. This is a convention; no hook enforces it.

### Required Secrets

In `agents` (local):

- `GITHUB_PERSONAL_ACCESS_TOKEN` - GitHub MCP
- `STRIPE_SECRET_KEY` - Stripe MCP (optional)
- `CONTEXT7_API_KEY` - Context7 MCP
- `RESEND_API_KEY` - Resend MCP (optional)

In `ci/build`, `ci/deploy` and `ci/production` (CI/CD):

- `TURBO_TOKEN` - Turborepo remote cache
- `UNIWIND_AUTH_TOKEN` - Uniwind Pro CI/CD licence for the Quality Gate install (ADR 0310)
- `CLOUDFLARE_API_TOKEN` - Cloudflare Worker deploys from CI (ADR 0284, ADR 0289)
- `ENCORE_API_KEY` - Encore deployment from CI, once a repository ships an Encore app (ADR 0468)
- `SENTRY_AUTH_TOKEN` - Sentry releases (optional)

## 3. Writing a value (secret-manager flow, ADR 0257)

Every write goes through core's scripts, never by hand: each opens a pull request in `figentra/secrets` that merges
itself, hands the value to sops on stdin and appends a names-only line to `~/.stackra/secrets-audit.log`.

- `pnpm secrets:put NAME --scope <scope>` - one human value (an API key, a store key), from
  `~/Secrets-inbox/<NAME>[.ext]` or the owner's hidden prompt.
- `pnpm secrets:import --scope <scope> [FILE…] | --tree | --list` (each with `--dry-run`) - several inbox files.
- `pnpm secrets:generate NAME --scope <scope>` and `pnpm secrets:rotate NAME --scope <scope>` - a random machine
  secret, made in memory; `--missing` fills every generated catalog name that has no file.

The owner drops one file per secret into `~/Secrets-inbox/` (outside every repo, never synced). The file name is the
secret name (`SCREAMING_SNAKE`, one extension stripped: `STACKRA_REVIEWER_PRIVATE_KEY.pem`), or files go in
scope-shaped folders (`agents/`, `ci/deploy/`, `products/<product>/<env>/`). A non-file value (an App ID) is a file
holding just that value; there is no `--value` flag.

- An agent never writes `ci/flow`, `ci/infra` or any `registry` folder; the scripts refuse, and the owner runs those.
- A production scope is written only after the owner's yes in the conversation.
- Any agent may run the scripts: hooks cannot tell agents apart, and the scripts never output a value. The
  `secret-manager` and `vault-keeper` agents are the ones that are told to.
- No agent reads, lists, copies or moves anything in `~/Secrets-inbox/`. The hooks below catch the obvious attempts;
  they are an accident guard, not a security boundary.

## Forbidden Patterns

1. **No `.env` files** - Use the pnpm script that runs `secrets-exec.mjs`, or the CI decrypt step
2. **No hardcoded secrets** - Not in code, not in git
3. **No secret values in configs** - Only secret references
4. **No decrypting by hand** - An agent never runs `sops -d`, `sops decrypt`, `sops exec-env` or `sops exec-file`, and
   never runs `secrets-exec.mjs` itself or for names its task did not give it: either hands a value to a command the
   agent chose

### Blocked by Hooks

- `guard-bash.mjs` (rules in `.agents/hooks/_rules.mjs`, shared with the OpenCode guard, ADR 0293): blocks
  `env`/`printenv`, process-environment listings (`ps -E`, `ps eww`, `launchctl procinfo`) and running `bot-token.mjs`
  or `figentra bot token`, also behind `pnpm exec`, `npx` and `mise exec --`; it still carries the Infisical rules
  (`infisical export`, `infisical secrets …`, raw `infisical run`) until no workflow uses the CLI.
  `secrets:import … --confirm` (or `figentra secrets import … --confirm`) asks the owner.
- Not yet (the owner's hook change, STA-2146): a deny of `sops -d`, `sops decrypt`, `sops exec-env`, `sops exec-file`
  and of a direct `secrets-exec.mjs`, also behind `pnpm exec`, `npx` and `mise exec --`. Rule 4 above holds until then.
- `guard-bash.mjs` (matcher `.agents/hooks/_inbox.mjs`, shared with the OpenCode guard): blocks any command in which
  a word, after unquoting, names `Secrets-inbox` (any case) or the import confirm key. Two kinds of word are exempt: a
  grep/rg/ag pattern, and a `--title`/`--body`/`--message`/`-m` value with no `$(` or backtick. Program text
  (`perl -e`, awk, sed) and command-running prose are still checked. Also blocked: a path token (pattern and script
  files, `x=…` assignments, `@file` values and `file://` URLs included) whose glob, rooted at home (`~`, `$HOME`,
  `/Users/<you>`, or relative while the shell's cwd is home, following `cd`), could match the inbox; and a recursive
  read (`grep -r`, `rg`, `find`, `du`, `cp -a/-r`, `tar`, `rsync`, `zip`) of home or above, including no path operand
  from home. `pnpm secrets:import` never needs to do any of these.
- `guard-paths.mjs`: Blocks writes to `.env`, `.env.*`, `.dev.vars`, `.ci-env` and `.sentryclirc`, reads of secret
  files (`.env*` except `.env.example`, `.dev.vars`, `*.pem`, `*.key`, `.secrets.local.*`), and every
  Read/Grep/Glob/Write/Edit under `~/Secrets-inbox/`
- `.claude/settings.json` and `opencode.jsonc`: the same denies as prefix rules, the floor in every mode
- `.gitleaks.toml`: Scans for accidental secret commits

## Enforcement

Each article below is bound to a check:

1. **Secrets never in git** → `gitleaks` pre-commit + CI scan; `figentra/secrets` holds ciphertext only
2. **No .env files** → `guard-paths` hook
3. **CI secrets from OIDC** → the `secrets-decrypt` action (Workload Identity), grants in `estate/secret-callers.mjs`
4. **Production values reach runtimes by runway sync** (ADR 0173, decision 1) from the decrypted scope, and values are
   written only through `pnpm secrets:put`, `secrets:import`, `secrets:generate` and `secrets:rotate` (ADR 0257,
   ADR 0525). Review checks the sync, not a manual copy.
5. **Nobody reads a value; writes are blind** → the scripts' tests, which assert no canary value reaches output, audit
   log or argv; `guard-bash` / `guard-paths` inbox rules

## Setup

1. Install sops: `mise install` (pinned in `mise.toml`, ADR 0027)
2. Sign in once as the owner's Google account: `gcloud auth application-default login`
3. Clone `figentra/secrets` to `~/.stackra/secrets`; it holds only encrypted files
4. Add a token with `pnpm secrets:put NAME --scope agents`, never by hand
5. Run the pnpm script that names it (`pnpm bot:gh`, `pnpm linear`); `pnpm doctor` checks steps 1 to 3

## See Also

- Constitution: secrets (laws)
- ADR-0525: SOPS files keyed by Cloud KMS replace Infisical
- ADR-0173: runway syncs production secrets into the runtimes (supersedes ADR-0009)
- Runbook: secrets (scopes, rotation)
