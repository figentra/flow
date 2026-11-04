---
"@figentra-oss/flow": minor
---

A preset can be an npm package (STA-2097). `flow.config.json` `"preset"` takes a package name such as
`@acme/flow-preset`: Flow resolves it from the repository root and reads the folder its `package.json` names in
`"flow": { "preset": "./preset" }`, which must stay inside the package. A bundled name still wins, and a repository
folder by that name or path still works. A package name that is neither installed nor a folder is an error naming the
fix. The lock and the provenance headers record the package's own version. A preset declares the Flow versions it
supports in `peerDependencies["@figentra-oss/flow"]` and in `preset.yml` `requires.flow`. `fflow doctor` has a `preset`
row that fails, with the fix, when the installed Flow is outside either range, and `sync` and `update` refuse such a
preset. The new `fflow preset add <pkg> [--dry-run]` installs the package as a dev dependency with the lockfile's
package manager (pnpm, npm or yarn) and sets the config line. Nothing installs on its own: there is no postinstall. The
README's new Presets section covers using and writing a preset package.
