---
name: mobile-eas-setup
description: Set up or change the EAS configuration of apps/mobile in the Stackra monorepo - build profiles, channels, EAS environments, the fingerprint runtime policy, expo-updates, EAS environment variables and secrets, .easignore, and the fingerprint-gated build trigger from GitHub Actions. Use when editing eas.json or native app.json fields, adding expo-updates, or when an EAS build fails on install or upload.
---

# Mobile EAS setup

House rules on top of the vendored `eas-app-stores`, `eas-update`, `eas-workflows` and `expo-dev-client` skills. Read
those for EAS mechanics; this skill encodes Stackra's decisions (ADR 0180) and the lessons from earlier apps. The human
steps (store accounts, keys, the first Play upload) are in `apps/docs/src/docs/runbooks/mobile-release.mdx`.

A product's app (no app member, ADR 0441) is onboarded with `stackra mobile onboard --app <key>` (ADR 0482,
`runbooks/mobile-onboarding.mdx`): it sets the ids, the EAS project, the Apple bundle id, Firebase, Sentry and push,
and the mobile job writes `eas.json` at each build. Do not hand-write a product's `eas.json` or run `eas init` for it.

## Rules

1. **Profiles** in `apps/mobile/eas.json`, each extending `base`:
   `development` (dev client, simulator), `development-device` (dev client, registered device), `preview` (internal, APK), `staging` (store distribution, `autoIncrement`),
   `production` (store, `autoIncrement`), and `e2e` (Release build for simulators) when Maestro lands.
2. **One channel per profile**, same name as the profile, and an **EAS environment** per profile: `development`,
   `preview` (also used by staging) and `production`.
3. **`base`** pins `node` and `pnpm` to the versions in `mise.toml`. Once Sign in with Apple is enabled, set
   `env.EXPO_NO_CAPABILITY_SYNC=1` in `base` **and** prefix local `eas credentials` with it: capability sync silently
   turns Sign in with Apple off.
4. **Versions**: `cli.appVersionSource: remote` (build numbers on EAS); you bump `expo.version` for each store release.
5. **Runtime policy**: `runtimeVersion: { "policy": "fingerprint" }` with `updates.url`. One policy, never mixed: a
   workflow that matches builds by another policy is a bug.
6. **Builds are fingerprint-gated** (ADR 0180): GitHub Actions starts an EAS build only when the native fingerprint
   changes, a pull request carries the `build:mobile` label, or a release is cut. Everything else ships as an update.
   The paid EAS plan has a monthly build cap with an alert; `eas build --local` is free for experiments. Never loop
   builds, never build on every push.
7. **Variables**: build-time configuration is EAS environment variables, not `env` in `eas.json`. Names are written
   here and in the runbook; a human sets values. `EXPO_PUBLIC_*` is inlined into the bundle and is public: never a
   secret. Licence tokens (Uniwind Pro, when installed) are **secret** variables in every environment, or
   installs silently get stubs.
8. **`.easignore`** replaces `.gitignore` entirely for uploads: copy `.gitignore`, then add `.claude/`, `.agents/`,
   `.notes/`, agent worktrees, `apps/docs`, `apps/console`, and every `node_modules`. Keep `packages/**` the app needs.
   Without it a monorepo upload can reach tens of gigabytes.
9. pnpm in EAS needs `babel-preset-expo` as a devDependency of the app.

## Worked example: `eas.json`

```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "base": { "node": "24", "pnpm": "12.6.0" },
    "development": { "extends": "base", "developmentClient": true, "distribution": "internal",
                     "ios": { "simulator": true }, "channel": "development", "environment": "development" },
    "development-device": { "extends": "base", "developmentClient": true, "distribution": "internal",
                            "channel": "development-device", "environment": "development" },
    "preview": { "extends": "base", "distribution": "internal", "android": { "buildType": "apk" },
                 "channel": "preview", "environment": "preview" },
    "staging": { "extends": "base", "autoIncrement": true, "channel": "staging", "environment": "preview" },
    "production": { "extends": "base", "autoIncrement": true, "channel": "production", "environment": "production" }
  },
  "submit": { "production": {} }
}
```

## Verify before any paid build

```bash
cd apps/mobile
npx expo config --type public          # resolved app config, no secrets
eas config --profile staging --platform ios
npx expo export                        # the JS bundle builds locally
```

## Never

- A file-based router; Stackra mobile is code-based React Navigation (ADR 0061).
- A secret in `eas.json`, `app.json`, an `EXPO_PUBLIC_*` variable or the repository.
- Changing `ios.bundleIdentifier` or `android.package` after the first store upload.
- `eas submit`, a store build or an OTA to production without the release flow (skill `mobile-release`).

## Check

`pnpm --filter @figentra/mobile test typecheck`, the three commands above, then `pnpm verify`. Owner: `mobile-builder`;
release gate: `release-operations`.
