---
title: Secrets
always: true
description: Secret management and environment configuration
---

# Secrets

Stackra keeps production secret values in Infisical. Infisical is the source, and runway syncs them into the runtimes on deploy
(ADR 0173, which supersedes ADR 0009). Secret names are in git; values never are.

**Invariant: nobody reads a value.** A value is set by a human, or by the secret-manager flow (section 3,
ADR 0257), which writes it without anyone, the agent included, ever seeing it.

## 1. App Secrets (Encore, generated app)

Services are plain TypeScript and hold no Encore files. The Encore application is generated into the
gitignored `.stackra/encore` (ADR 0091), and app secrets reach it through Encore `secret()` there:

```typescript
import { secret } from "encore.dev/config";

const stripeSecretKey = secret("STRIPE_SECRET_KEY");
```

- Infisical is the source of production secrets. Runway syncs them into Encore, Cloudflare Workers and EAS on deploy (ADR 0173,
  which supersedes ADR 0009)
- A human sets each value per environment; an agent only names the secret (the secret-manager flow covers the
  runtime store once a tool for it exists; ADR 0257)
- Never in git

## 2. Dev/CI Secrets (Infisical)

All other secrets through Infisical:

### Vault Layout (ADR 0512: one project per reader)

- `agents` dev `/agents` - Developer and agent tokens (local dev, MCP servers); every repo's `.infisical.yaml`
- `ci-build` prod `/ci`, `/ci/turbo`, `/ci/registry` - read-only build tokens (every CI job, PR checks, testbed)
- `ci-deploy` prod `/ci`, `/ci/release`, `/ci/store`, `/ci/observability` - deploy and release credentials
- `registry` prod `/ci`, `/ci/registry` and `flow` prod `/ci/gate` - one reader each
- `<product>` `/runtime/<member>` - a product's runtime secrets, synced by runway; no shared token is copied there

### How to Use

**Local development:**

A token reaches a process only through the pnpm script that needs it (`pnpm bot:gh`, `pnpm linear`, `pnpm bot:git`),
which wraps `infisical run` itself. Raw `infisical run` hands every `/agents` value to the process it starts, so an
agent's raw `infisical run` asks the owner (ADR 0293). A new flow that needs a token gets its own pnpm script.

**CI/CD:**

A CI job logs in to Infisical by GitHub OIDC for one step and reads `/ci` only (ADR 0009 D2); no token is a repository
secret. Workers deploy from CI with a Cloudflare token read from Infisical `/ci` over GitHub OIDC (ADR 0284, ADR 0289). A workstation `encore deploy` stays denied (`guard-bash` and settings): Encore deploys run from a CI workflow, staging on a merge to main and production behind the owner's Environment approval, once a repository ships an Encore app (ADR 0468 decision 6).

**MCP servers:**
Token-based MCP servers launch through the `tools/scripts/mcp.sh` vault wrapper (reads from `/agents`). This is a
convention; no hook enforces it.

### Required Secrets

In Infisical `/agents` (local):

- `GITHUB_PERSONAL_ACCESS_TOKEN` - GitHub MCP
- `STRIPE_SECRET_KEY` - Stripe MCP (optional)
- `CONTEXT7_API_KEY` - Context7 MCP
- `RESEND_API_KEY` - Resend MCP (optional)

In Infisical `/ci` (CI/CD):

- `TURBO_TOKEN` - Turborepo remote cache
- `UNIWIND_AUTH_TOKEN` - Uniwind Pro CI/CD licence for the Quality Gate install (ADR 0310)
- `CLOUDFLARE_API_TOKEN` - Cloudflare Worker deploys from CI (ADR 0284, ADR 0289)
- `ENCORE_API_KEY` - Encore deployment from CI, once a repository ships an Encore app (ADR 0468)
- `SENTRY_AUTH_TOKEN` - Sentry releases (optional)

## 3. The secrets inbox (secret-manager flow, ADR 0257)

The owner drops one file per secret into `~/Secrets-inbox/` (outside every repo, never synced). The file name is
the secret name (`SCREAMING_SNAKE`, one extension stripped: `STACKRA_REVIEWER_PRIVATE_KEY.pem`); an optional
`<NAME>.target.yaml` sets `project`, `env` (default `dev`) and `path` (default `/agents`, in `agents`); a `/ci`
path must name its project (ADR 0512). A non-file value (an App ID) is a
file holding just that value; there is no `--value` flag.

- `pnpm secrets:import --list | --dry-run | <import>` is the only way in. It never prints, logs or passes a value
  on argv, verifies by SHA-256 read-back in-process, deletes the inbox file on success and appends a names-only
  line to `~/.stackra/secrets-audit.log`.
- Production (`--env prod`): the dry run prints a one-time `--confirm <token>` (30 min). That token is a process rule,
  not an enforced yes (the same caller sees it): ask the owner, wait for yes, only then use it. The enforced yes is
  the local request page (STA-187), where the owner's own submit is the yes.
- Any agent may run the script: hooks cannot tell agents apart, and the script never outputs a value. The
  `secret-manager` agent is the one that is told to.
- No agent reads, lists, copies or moves anything in `~/Secrets-inbox/`. The hooks below catch the obvious attempts;
  they are an accident guard, not a security boundary.

## Forbidden Patterns

1. **No `.env` files** - Use Infisical injection
2. **No hardcoded secrets** - Not in code, not in git
3. **No secret values in configs** - Only secret references

### Blocked by Hooks

- `guard-bash.mjs` (rules in `.agents/hooks/_rules.mjs`, shared with the OpenCode guard, ADR 0293): blocks
  `infisical export`, `infisical secrets get` in every form (`--silent` still prints the value), `infisical secrets set`,
  a bare `infisical secrets` (lists values), `infisical run -- env|printenv`, `env`/`printenv`, process-environment
  listings (`ps -E`, `ps eww`, `launchctl procinfo`) and running `bot-token.mjs` or `figentra bot token`, also behind
  `pnpm exec`, `npx` and `mise exec --`. Raw `infisical run`, `infisical secrets delete` and `secrets:import … --confirm`
  (or `figentra secrets import … --confirm`) ask the owner.
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

1. **Secrets never in git** → `gitleaks` pre-commit + CI scan
2. **No .env files** → `guard-paths` hook
3. **CI secrets from OIDC** → GitHub Actions OIDC (Phase 2)
4. **Production values reach runtimes by Infisical sync** (ADR 0173, decision 1), and only the `secret-manager` agent writes values through `pnpm secrets:import` (ADR 0173, decision 7; ADR 0257). Review checks the sync, not a manual copy.
5. **Nobody reads a value; the inbox flow writes blind** → `figentra secrets import` (`@figentra/cli`, + its test, which
   asserts no canary value reaches output, audit log or argv), `guard-bash` / `guard-paths` inbox rules

## Setup

1. Install the Infisical CLI: `mise install` (pinned in `mise.toml`, ADR 0027; Homebrew is not supported)
2. Create workspace: `infisical init`
3. `.infisical.yaml` is tracked (workspace id and domain, no secret)
4. Add secrets to `/agents` folder
5. Run the pnpm script that wraps the command (`pnpm bot:gh`, `pnpm linear`); the owner runs raw `infisical run`

## See Also

- Constitution: secrets (laws)
- ADR-0173: Infisical is the source of production secrets (supersedes ADR-0009)
- Runbook: secrets (vault layout, rotation)
