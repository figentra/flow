# Running Flow locally

How to run Figentra Flow from a checkout, end to end, the way CI does. Flow is a command-line tool with no server,
frontend or database, so "runs locally" means this: the `fflow` built from this checkout installs into a fresh
repository and drives it through `init`, `sync`, `check`, `doctor` and `mcp`. There is no `stackra dev` step, and there
is no browser page to render.

## 1. Toolchain

```sh
mise install
```

This installs what `mise.toml` pins: Node 24.22.0, pnpm 12.16.1, and the oxfmt and oxlint the git hooks use.

## 2. Install

```sh
pnpm install --frozen-lockfile
```

The `@stackra` and `@figentra-oss` scopes resolve from `npm.stackra.figentra.com` (`.npmrc`) and are read anonymously.
No token is needed.

## 3. The gate

```sh
pnpm verify
```

This runs format, lint, typecheck, test and build: the same checks as CI's `verify` and `test` jobs.

## 4. End to end

```sh
pnpm --filter @figentra-oss/flow test:e2e
```

This is the outsider's path, and CI's `e2e` job runs the same command (`src/__tests__/packed.e2e.mjs`):

1. `pnpm pack` builds the tarball that would be published.
2. npm installs it into a new git repository. Only the public registry scopes are configured there, and no workspace
   link or local npm setting is used.
3. The installed `fflow` runs `--version`, `init` (neutral preset), `sync`, `check`, `doctor --offline --json` and
   `mcp` (`initialize` and `tools/list` over stdio). It asserts each exit code and the key output.
4. A hand edit to a rendered file must make `check` fail and name the file.

The test needs the network to reach the registries. It cleans up its temporary folders.

## 5. By hand, in a scratch repository

To try a change on a repository of your own without packing:

```sh
flow="$PWD/packages/flow/bin/fflow.mjs"
repo=$(mktemp -d) && cd "$repo" && git init -q -b main
node "$flow" init
node "$flow" sync
git add -A && git commit -qm flow
node "$flow" check
node "$flow" doctor --offline
```

`init` writes `.flow/` and a starter `flow.config.json` on the `neutral` preset, then renders the `flow-*` skills.
`sync` renders the rest and writes `.flow/lock.json`. `check` exits 0 on a clean render. Edit a rendered file and
`check` exits 1, naming it.

To see the standard CI workflow (`fflow-ci.yml`), add a `ci` block to `flow.config.json` (`{ "ci": {} }` takes the
defaults) and run `sync` again.

## What counts as done

A change to Flow is done when `pnpm verify` and the `e2e` job pass on CI at its merged head. On a workstation, steps
1 to 4 pass with no setting beyond `mise.toml` and `.npmrc`.
