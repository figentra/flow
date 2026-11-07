---
name: mobile-release
description: Cut a Stackra mobile release or over-the-air update - decide binary or OTA, the gates, the version bump, the staged OTA rollout gated on crash-free sessions, the bi-weekly phased store release, the minimum-version gate, rollback, and the steps only a human may take. Use for "release the app", "ship to TestFlight", "push an OTA", "roll back an update".
---

# Mobile release

House rules on top of the vendored `eas-app-stores`, `eas-update` and `eas-workflows` skills, implementing ADR 0180. The
agent prepares and verifies; a human submits for review, promotes tracks and approves production.

For a product, the release is `stackra build --product` then `stackra deploy --product --env <e> --mobile-only`: each
build goes to TestFlight and the Play internal track through the `eas` driver, and an Android build waits until the
manual first Play upload exists (`stackra mobile onboard` lists it).

## 1. Binary or update?

| Change                                                                  | Ships as                         |
| ----------------------------------------------------------------------- | -------------------------------- |
| Native module, config plugin, permission, native `app.json` field, SDK  | A store build; bump `expo.version` |
| JavaScript and assets only (the fingerprint is unchanged)               | An EAS Update on the channel     |

The fingerprint decides: if it changed, an update cannot reach the installed builds.

## 2. Gates (all must hold)

1. `pnpm verify` green on the commit; the Quality Gate green on the PR.
2. The end-to-end run (Maestro, iOS and Android, LTR and RTL) green **on the same commit**.
3. The backend the build talks to is already deployed to the target environment.
4. The Linear issue is In Review or later; `release-operations` returns PROPOSE.

## 3. Store release train (ADR 0180)

- Bi-weekly, phased. Builds run on EAS, started from GitHub Actions (fingerprint change, `build:mobile` label or
  release), and land in TestFlight's internal group and Play's internal track as a draft.
- Bump `expo.version` (and the store listing version) together; build numbers auto-increment on EAS.
- Apps and services deploy by SHA: no changeset is needed for the app itself.

## 4. Over-the-air updates

```bash
cd apps/mobile
eas update --channel staging --environment preview --message "<what changed> (<sha>)"
# production, after staging is verified on a device:
eas update --channel production --environment production --message "<what changed> (<sha>)" --rollout-percentage 10
```

Roll out **10 % → 100 % over 24 hours**, raising only while crash-free sessions hold (Sentry). Testers may need two cold
launches to receive an update.

## 5. Minimum version and support window

The app checks a server-side minimum version at launch and blocks below it with an update prompt. The last two store
versions are supported; raise the minimum only after the newer version is live on both stores.

## 6. Rollback

- An update: `eas update:republish` the previous good update to the channel, or roll the percentage back to 0.
- A store build: halt the phased release (human), ship the fix as an update if the fingerprint allows, else a new build.
- Open an incident for any production rollback (`incident-commander`).

## Human-only steps (the agent stops and reports)

Submit for review; promote a Play track; change the phased-release percentage in a store console; approve the production
GitHub Environment; type demo-account credentials into a console.

## Never

- A production update or submission without the gates above.
- `eas submit` from an agent session, or a build loop.
- A secret in an update, a log or the release notes.

## Check

Record the release in Linear (`pnpm linear comment STA-n "<build ids, update id, rollout %>"`). Gate:
`release-operations`.
