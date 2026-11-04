---
name: mobile-store-listing
description: Maintain App Store and Google Play listing data for Stackra apps - store.config.json metadata, privacy label and Data safety answers kept beside the feature that changes data collection, age rating, screenshots per locale including RTL, review notes and demo accounts, and account deletion. Use before a first submission, when a feature or SDK changes what data the app collects, or when store review asks for changes.
---

# Mobile store listing

Three apps exist from day one: the internal reference app, the public "Stackra Showcase" app, and per-tenant
white-label builds (Pro), all under one Figentra Apple and Google organisation (ADR 0180). Listing data is versioned and
reviewed like code.

## Rules

1. **Metadata as code.** App Store listing data lives in `apps/mobile/store.config.json` (EAS Metadata, Apple only).
   `eas metadata:lint` checks it; `eas metadata:push` is a human step (Apple ID with two-factor). After a
   `metadata:pull`, format the file and delete any `demoPassword` it contains.
2. **Privacy answers travel with the feature.** The App Store privacy label and the Play Data safety form are kept as
   docs pages; a pull request that adds data collection (a field, an SDK such as Sentry or PostHog, a permission)
   updates them in the same change. Field classification (ADR 0134) is the source for what is personal.
3. **Demo accounts** for review are synthetic (the golden tenant, ADR 0190). Their credentials live in Infisical by name
   only; a human types them into the store consoles. Never in the repository, a ticket or chat.
4. **Screenshots** come from a Maestro flow on a dedicated simulator, in a Release build, for every shipped locale
   including Arabic (RTL), at the sizes the vendored `eas-app-stores` references list.
5. **Account deletion** is available in the app before any submission that has accounts (App Store guideline 5.1.1(v)).
6. **Children**: if the audience includes children, check permissions and SDKs against the store families policies
   before submission.
7. **White-label builds** take name, icon, colours and bundle id from the tenant's brand settings; never hard-code a
   tenant in source.

## Worked example: a feature adds crash reporting

1. The PR that adds the Sentry SDK also updates the privacy docs page: "Crash data, linked to the user: no; used for app
   functionality".
2. `store.config.json` is unchanged unless the description or keywords change; run `eas metadata:lint`.
3. The release notes mention the change in user terms.

## Never

- A real customer's data in screenshots, demo accounts or review notes.
- A credential in `store.config.json`, a screenshot or a commit.
- Deleting a store app record to fix a mistake (the bundle id becomes unusable).

## Check

`eas metadata:lint`, the privacy docs page diff in the same PR, then `pnpm verify`. Gate: `release-operations`; owner
review for the first submission.
