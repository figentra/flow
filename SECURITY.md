# Security policy

Figentra Flow (`fflow`, the npm package `@figentra-oss/flow`) writes CI workflows, git hooks and agent guard rules
into the repositories that use it. Its approval and merge lane holds a GitHub App token. A flaw in Flow can reach
every repository that runs it, so we treat reports as urgent.

## Supported versions

Flow is before 1.0. Only the latest published release gets security fixes. Upgrade with `fflow update` after bumping
the package.

| Version                       | Supported |
| ----------------------------- | --------- |
| latest release (`latest` tag) | yes       |
| anything older                | no        |

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting:
<https://github.com/figentra/flow/security/advisories/new>.

Do not open a public issue, pull request or discussion for a vulnerability, and do not post details anywhere public
until a fix is released.

Please include:

- the Flow version (`fflow --version`) and the command, workflow or hook involved;
- what an attacker controls (a pull request's branch, title or files, a comment, a label, a config file) and what
  they gain;
- the steps to reproduce, or a proof of concept against a repository you own;
- any logs, with tokens and secrets removed.

## What happens next

| Step                                           | Target                               |
| ---------------------------------------------- | ------------------------------------ |
| We confirm we received the report              | 3 business days                      |
| We confirm the issue and rate its severity     | 10 business days                     |
| A fix is released for a critical or high issue | 30 days from confirmation            |
| A fix is released for a medium or low issue    | the next planned release, or 90 days |

We work on a fix in a private advisory, ask you to check it, and publish the advisory with the release. We credit you
in the advisory unless you ask us not to.

## Scope

In scope:

- the `fflow` CLI and everything in `packages/flow`;
- the files Flow renders into a repository: `.github/workflows/fflow-*.yml`, `CODEOWNERS`, `lefthook.yml`, the agent
  guard hooks and settings, and the `.flow/` folder;
- the approval and merge lane: how it mints, narrows and revokes the GitHub App token, and every rule that decides
  whether a pull request is approved or merged;
- the built-in `neutral` preset.

Out of scope (report these to their owners):

- presets published as their own packages, such as `@stackra/flow-preset`;
- third-party skills that a preset lists by source: report them to the upstream project;
- vulnerabilities in GitHub, npm, Node.js or your CI provider.

## Security design

What Flow promises, so you can tell when it breaks a promise:

- **Privileged workflows run the default branch's copy.** The approval workflow never checks out or runs pull request
  code. It runs only the Flow package, pinned by its sha512 integrity.
- **Pull request text is data.** Titles, branch names, paths, labels and comment bodies never reach a shell.
- **Tokens are narrow and short-lived.** Flow acts through GitHub App installation tokens, never a personal token. Its
  in-process minter (`src/lib/app-token.mjs`) narrows each token to one repository and a fixed set of permissions,
  checks the grant and revokes the token when the job ends. The App key stays in that one process and is never
  written to the environment, a file or a log.
- **Humans approve policy, not instances.** Changes to workflows, release, deploy and other owner-only paths are never
  approved by Flow. They need the repository owner's review.
