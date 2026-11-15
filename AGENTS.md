# Agent guidelines

Difflet is a VS Code extension that shows saved Git line counts in the status bar. It is CommonJS JavaScript with strict JSDoc type checking. Write simple, semantic code that is easy to understand and tweak.

## Done means

- `npm run check` (type checking and lint) and `npm test` pass.
- `npm run test:host` also passes when a change touches activation, commands, or VS Code integration.

## Architecture

- `src/extension.js` constructs dependencies and owns activation and deactivation.
- `src/core` holds the statistics model, collection workflow, and refresh queue. It imports only Node built-ins and other core modules; ESLint enforces this.
- `src/adapters` implements Git processes, file reads, and VS Code repository integration. It stays independent of `src/presentation`.
- `src/presentation` coordinates events and commands, formats output, and renders the status bar.
- Pass dependencies in explicitly, as `createCollectStats({ git, files })` in `src/core/collectStats.js` does. Workflow tests use fakes; integration tests use real Git repositories.
- Whatever creates a subscription or resource disposes of it. Keep disposal idempotent.

## Gotchas

- A new runtime file under `src/` must be added to `RUNTIME_FILES` in `scripts/verify-package.js`, or package verification fails.
- `gitWorkingTreeStats.*` setting keys and command IDs are public API. Keep them stable, including through the Difflet rename.
- `README.md` is the Marketplace and Open VSX listing page. Write it for users and use absolute URLs, because `scripts/package.js` sets `rewriteRelativeLinks: false`.
- `package.json` `version` is the only version source; the VSIX name derives from it. Every release gets a new version, so published VSIX files are never overwritten.
- Release by running `npm run package` and `npm run test:package`, then publishing that exact VSIX with `npm run publish:marketplace` and `npm run publish:openvsx`. These need `VSCE_PAT` and `OVSX_PAT`.
- `.vscodeignore` and `scripts/verify-package.js` both define the VSIX contents; change them together.
- The extension has no runtime npm dependencies. Use Node built-ins and the VS Code API.

## Branch workflow

- Create feature branches from the latest `develop` and raise PRs into `develop`. Commit to `main` and `develop` only through PRs.
- Merge once all CI checks pass and review conversations are resolved, keeping branch protection and checks enabled.
- Squash-merge feature PRs into `develop`. Release with a `develop` → `main` PR and squash merge; `main` holds released versions.
- After a release, create a temporary sync branch from the latest `develop`, merge `origin/main` into it, and raise a PR into `develop`. Merge that sync PR with a merge commit, preserving ancestry; do not squash or rebase the sync. Complete this before starting the next feature batch.
- Keep `main`, `develop`, and recovery stashes. Delete temporary branches only after verifying their work is included in a merged PR and they have no later unmerged commits.

## Code style

- Use blank lines to separate logical chunks of code, keeping closely related statements together.
- Add concise JSDoc comments to core functions, explaining their purpose and any non-obvious parameters, return values, or side effects. `tsconfig.json` enables `checkJs`, so JSDoc types are type-checked.
- Name values with domain meaning or shared behavioral significance as constants at the top of the module that owns them; shared configuration and command IDs live in `src/presentation/constants.js`. Keep ordinary display text inline.
- Put public and core functions near the top of a file, followed by helpers roughly in the order they are called. Keep imports and setup first, and preserve initialization dependencies.
