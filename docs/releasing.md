# Releasing runework

This repo uses `nx release` for versioning, changelog generation, and git tagging.

Why this setup:

- `runework` is the only public npm package in this workspace.
- `packages/*` are private implementation details bundled into the root package.
- Because the root package depends on those private packages through local `file:` references, release versioning needs to rewrite them to real semver versions before npm publishing.
- Nx Release is already part of the workspace, so it fits better here than layering Changesets or semantic-release on top.

## What gets released

The public root package and the private workspace packages participate in releases together.

- Version sources:
  - root [`package.json`](../package.json)
  - [`packages/core/package.json`](../packages/core/package.json)
  - [`packages/pipelines/package.json`](../packages/pipelines/package.json)
  - [`packages/cli/package.json`](../packages/cli/package.json)
- Git tag pattern: `v{version}`
- Changelog: root `CHANGELOG.md`

The private workspace packages are not independently published. They are versioned in lockstep so Nx can replace local dependency protocols with normal versions for npm-compatible publish manifests.

## Local release flow

Preview everything first:

```bash
npm run release:dry-run
```

Create a normal release locally without publishing to npm yet:

```bash
npm run release
```

Force a specific semver bump:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Each release will:

1. update the root package version
2. update or create `CHANGELOG.md`
3. create a release commit
4. create a git tag like `v0.2.0`

`npm run release` uses conventional commits to determine the bump automatically.

Default release behavior:

- `feat` -> minor
- `fix` -> patch
- `chore` -> patch
- other standard commit types do not create a release unless they contain a breaking change

Nx is configured with `automaticFromRef: true`, so the first managed release can generate a changelog even when no previous release tag exists yet.

If you want the first managed tag to match the current on-disk version instead of bumping it, run an explicit first release:

```bash
npx nx release 0.1.0 --first-release --skip-publish
```

## Later: npm publishing

When you are ready to publish to npm, keep the versioning/tagging step local and let CI handle only the publish step.

Recommended flow:

1. Run `npm run release`
2. Push the release commit and tag with `git push && git push --tags`
3. In CI, run `npx nx release publish` on `v*.*.*` tags

Recommended npm auth model:

- use npm trusted publishing with GitHub Actions
- keep `publishConfig.access: "public"` in the root `package.json`
- give the publish workflow `id-token: write`

Minimal future workflow:

```yaml
name: Publish

on:
  push:
    tags:
      - "v*.*.*"

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org/
      - run: npm ci --ignore-scripts
      - run: npx nx release publish
```

If you want to smoke-test the publish step locally before wiring CI, do it after creating a real release commit in a temporary branch or worktree, then run:

```bash
npm run release:publish -- --dry-run
```

## Automation on main

GitHub Actions runs `npm run release` automatically after the `CI` workflow succeeds on `main`.

That automation:

- creates the semver release commit and tag
- pushes them back to `main`
- does not publish to npm

The workflow skips release commits themselves to avoid loops.
