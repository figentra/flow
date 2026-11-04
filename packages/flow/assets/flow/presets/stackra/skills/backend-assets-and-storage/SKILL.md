---
name: backend-assets-and-storage
description: Ship and read files the Stackra way - a module's assets/ folder (public, lang, templates, stubs, data) with <module>::path keys, the Assets service and useAsset() hook, @stackra/filesystem disks injected never through facades, uploads with scanning and the public CDN, and on clients the @stackra/storage named stores. Use when a package ships images, translations, templates or seed data, or code stores or reads files or client-side data.
---

# Assets and storage

Three different things, three APIs:

| You have                                         | Use                                         | ADR        |
| ------------------------------------------------ | ------------------------------------------- | ---------- |
| Files a module ships (images, lang, templates)   | `assets/` + the `Assets` service            | 0234       |
| Files users upload or the server generates       | `@stackra/filesystem` disks (server)        | 0222, 0234 |
| Data a client keeps (prefs, cache, offline queue) | `@stackra/storage` named stores (client)    | 0256       |

Shapes follow the ADRs; package docs win once they ship.

## Module assets (ADR 0234)

Declare by location. Files sit in `assets/` beside the module file (for a package's root module, the package's
`assets/`). The namespace is the module's `name`. There is no `defineAssets`. The folder name is the kind:

```text
assets/
├── public/      anything with a URL, content-hashed and published to the CDN by `stackra build` or CI
├── lang/        i18n catalogs, registered under the namespace
├── templates/   mail, PDF and SMS templates
├── stubs/       scaffolder stubs for `pnpm new` and `stackra make`
└── data/        private seed or reference data, read with read()
```

Keys are `<module>::<path>`: `flags::public/images/eg.svg`, `billing::invoice.refund_confirm`,
`billing::mail/invoice-paid`. A package exports `./assets/*` and imports them as `#assets/*`; never `../` into
`assets/` (ADR 0233). The folder is `assets/`, not `resources/` (`@Resource` is the console declaration).

```ts
// server
constructor(private readonly assets: Assets) {} // Assets is a same-named token (ADR 0263)
const logoUrl = this.assets.url("billing::public/images/logo.svg");
const vatTable = await this.assets.read("billing::data/vat-rates.json");
```

```tsx
// react or native
const logo = useAsset("billing::public/images/logo.svg");
return <img src={logo.url} alt={t("billing::brand.logo_alt")} />;
```

## Server files (ADR 0222)

`@stackra/filesystem` is the only server storage API. Disks are injected, never reached through a facade or a static
helper:

```ts
constructor(private readonly files: Filesystem) {} // same-named token (ADR 0263)
const url = this.files.disk("public").url(path);
const signed = await this.files.disk("private").temporaryUrl(path, { expiresInSeconds: 300 });
```

- Keys are `t/<tenantId>/<fileId>/<version>`; server-side encryption with the KMS and tenant keys (ADR 0188).
- Uploads are presigned, multipart or tus; a service never streams the bytes. A malware scan runs before a file is
  available; a URL is issued only after the scan passes.
- Image variants are made by queue jobs.

## Client storage (ADR 0256)

One package, `@stackra/storage`, with an injected `Storage` service and named stores: `prefs`, `session`, `cache`,
`outbox` (the offline mutation queue), `secrets`, `files`. Drivers per platform (web `local`, `session`, `indexeddb`,
`opfs`, `webcrypto`; native `mmkv`, `sqlite`, `secure-store`, `expo-fs`; desktop `safe-storage`, `fs`), optional
encryption and TTL, values typed with Zod. No ORM ever runs on a client.

```ts
const prefs = storage.store("prefs", PrefsSchema);
await prefs.set("theme", "dark");
```

## Never

- Hard-coded CDN or bucket URLs; a `disk()` facade; a secret in `assets/`.
- Tenant files in a module's `assets/`.
- Client data in `localStorage` directly, or a separate local-store package.

## Check

`pnpm --filter <member> test typecheck build`, then `pnpm verify`. Uploads and stored secrets: `security-tenancy-reviewer`.
