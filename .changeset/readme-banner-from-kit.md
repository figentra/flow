---
"@figentra-oss/flow": minor
---

A README banner names a released brand kit, `banner: { kit: "<id>@<x.y.z>", image: og-still | logo-horizontal }`.
`fflow readme` pulls the kit with the brand CLI at an exact version (`pnpm dlx @figentra/brand-cli@1.0.0 pull`, the Stackra registry with its
integrity check) and writes the light and dark image and `banner.json` into `.github/assets/brand/`, which the README
points at with the kit's product name as alt text; `readme --check` fails when they differ from the kit. figentra/brand
is private, so a README could not show its raw files. Without `STACKRA_REGISTRY_TOKEN` the command stops with a boxed
problem; `sync` and the README text need no token.
