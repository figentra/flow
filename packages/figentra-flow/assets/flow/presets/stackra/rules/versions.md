---
title: Versions
always: true
description: Version pinning and catalog rules for Stackra monorepo
---

# Versions

Stackra versions come from **one of two sources**, never a third:

1. **Catalogs** in `pnpm-workspace.yaml`: the single source of truth for every package version
   - Default catalog (`catalog:`): shared dependencies
   - Named catalogs (`catalog:build`, `catalog:quality`, etc.): domain-specific versions
2. **Workspace references** (`workspace:*`): intra-repo packages

## Rules

1. **No literal versions in package.json** - always use `catalog:` or `workspace:*`
2. **No ranges in catalogs** - pin to exact versions (`1.2.3` not `^1.2.3`)
3. **No `latest` or `*`** - every version is explicit
4. **Catalog changes reviewed by the owner** - version bumps affect the entire repo
5. **Toolchain versions in `mise.toml`** - Node, pnpm, gitleaks pinned exactly

## Enforcement

- `stackra validate --repository` checks catalog references
- `pnpm install` fails on invalid catalog: entries (`catalogMode: strict`)
- Turborepo's `globalDependencies` includes `mise.toml` and `pnpm-workspace.yaml`

## Why

One bump in `pnpm-workspace.yaml` propagates to every member. Version drift is impossible because the validator blocks it.

## See Also

- Constitution: boundaries (package placement)
- Standards: dependencies (catalog usage guide)
- ADR-0003: tier dependency direction (dependency rules)
