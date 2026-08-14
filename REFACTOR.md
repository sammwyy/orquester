You have full control of the Orquester repository.

Your task is to refactor the repository structure and release workflows so that the Rust Worker becomes a first-class root-level component with its own independent release lifecycle, while preserving the existing development experience and the existing runtime behavior of the Electron Desktop client.

This is an implementation task, not a design-only task.

Inspect the repository first, understand how the current workspace, scripts, builds, local development, Electron runtime, Worker startup, Worker downloading, and GitHub Actions currently work, then make the necessary changes.

Do not rewrite unrelated systems.

Do not introduce speculative architecture.

Do not add Android support.

Do not extract the HTTP/API testing subsystem into a separate Rust crate as part of this task.

---

# 1. Current Architecture

Orquester is a monorepo.

The relevant architecture is approximately:

```text
/
├── apps/
│   ├── desktop/
│   ├── web/
│   └── worker/
│
├── packages/
│   └── ...
│
├── package.json
├── pnpm-workspace.yaml
└── ...
```

The exact current structure may differ slightly. Inspect the repository and adapt accordingly.

The major components are:

### Desktop

An Electron application.

It is a client for the Orquester Worker.

It supports connecting to either:

* a local Worker;
* a remote Worker.

### Web

A Vite + React web client.

It connects to an Orquester Worker remotely.

### Worker

A Rust daemon/runtime.

The Worker is the actual long-running backend/runtime responsible for things such as shells, agents, projects, sessions, filesystem operations, integrations, and other runtime functionality.

The Worker is architecturally independent from the Electron application.

### Packages

Shared TypeScript/JavaScript packages used by the frontend/client applications.

---

# 2. Important Worker/Desktop Architecture

The Desktop application and Worker are already intentionally decoupled.

Do NOT redesign this relationship.

In production, the Desktop application does **not** bundle the Worker binary.

The production Desktop application does **not** depend on the Worker source tree.

Instead, when the user chooses local Worker mode, the Desktop application already downloads the appropriate Worker binary from GitHub Releases.

Conceptually:

```text
Desktop
   |
   +-- Remote mode
   |      |
   |      +--> connect to an existing Worker
   |
   +-- Local mode
          |
          +--> determine platform/architecture
          |
          +--> download Worker binary from GitHub Releases
          |
          +--> install/manage Worker locally
          |
          +--> launch Worker
          |
          +--> connect to Worker
```

This production behavior must remain intact.

Do not introduce a production build-time dependency between Desktop and Worker.

---

# 3. Important Development Behavior

There is one deliberate exception to the production decoupling:

```text
pnpm dev
```

must continue to use the Worker directly from the repository source tree.

Development should remain convenient.

When developing the monorepo locally, `pnpm dev` should be able to:

* run/build the local Worker from source;
* run the Desktop/Web development applications as currently expected;
* connect development clients to that locally-running Worker;
* reflect Worker source changes during development according to the existing development workflow.

The development workflow should NOT download a Worker GitHub Release merely to run the repository locally.

The distinction must be preserved:

```text
DEVELOPMENT

pnpm dev
    |
    +--> local repository Worker source
    |
    +--> cargo run / existing Rust dev command
    |
    +--> Desktop/Web dev clients
```

versus:

```text
PRODUCTION DESKTOP

installed Electron app
    |
    +--> GitHub Releases
    |
    +--> downloaded Worker binary
```

This distinction is intentional.

Do not accidentally replace one with the other.

---

# 4. Target Repository Structure

Move the Worker out of `apps/`.

The desired high-level structure is:

```text
/
├── apps/
│   ├── desktop/
│   └── web/
│
├── packages/
│   └── ...
│
├── worker/
│   ├── Cargo.toml
│   └── src/
│
├── .github/
│   └── workflows/
│
├── package.json
├── pnpm-workspace.yaml
└── ...
```

Adapt this to the actual repository.

The conceptual meaning should become:

```text
apps/
```

User-facing client applications.

```text
packages/
```

Shared TypeScript/JavaScript code for the client ecosystem.

```text
worker/
```

The independent Rust Worker daemon/runtime.

The Worker is not another frontend application and should no longer live under `apps/`.

---

# 5. Move the Worker

If the Worker currently exists at:

```text
apps/worker/
```

move it to:

```text
worker/
```

at repository root.

Preserve Git history as much as practical through normal file moves.

Do not rewrite Worker internals merely because the directory changed.

After moving it, search the entire repository for stale references to:

```text
apps/worker
```

or equivalent old relative paths.

Update all affected references.

Potential locations include, but are not limited to:

* root `package.json`;
* `pnpm-workspace.yaml`;
* workspace scripts;
* development scripts;
* shell scripts;
* GitHub Actions;
* Electron scripts;
* Rust scripts;
* Dockerfiles;
* Docker Compose;
* build tooling;
* test tooling;
* documentation;
* path aliases;
* environment files;
* local development helpers;
* task runners;
* CI configuration;
* release scripts;
* installer scripts;
* Worker launcher code used during development.

Do a repository-wide search rather than fixing only obvious files.

---

# 6. Preserve `pnpm dev`

This is a critical requirement.

The root development command:

```bash
pnpm dev
```

must continue to work after the Worker is moved.

If the existing development setup currently launches the Worker from:

```text
apps/worker
```

change it to launch from:

```text
worker
```

Do not replace the development Worker with a downloaded GitHub Release.

Development must use the local Worker source.

For example, if the repository currently has logic equivalent to:

```bash
cd apps/worker
cargo run
```

it should become equivalent to:

```bash
cd worker
cargo run
```

while preserving any existing flags, environment variables, profiles, watchers, logging, or startup orchestration.

If `pnpm dev` uses:

* concurrently;
* turbo;
* nx;
* custom Node scripts;
* shell scripts;
* cargo-watch;
* watchexec;
* custom process management;

preserve the existing model.

Only update paths and architecture where required.

The final result should preserve the expected developer experience.

---

# 7. Development Worker vs Production Worker

Make sure the code clearly preserves the distinction between:

## Development Worker

Source:

```text
repository/worker/
```

Used by:

```bash
pnpm dev
```

Launched from source.

May use:

```bash
cargo run
```

or whatever equivalent mechanism already exists.

## Production Worker

Source:

GitHub Releases.

Used by the installed Desktop application when local mode is configured.

Downloaded as a prebuilt executable.

Do not make Desktop production code point at:

```text
../../worker/target/...
```

or any repository-relative Worker path.

Do not make Electron production packaging copy Worker artifacts.

Do not introduce hidden coupling between the Desktop build and Worker build.

---

# 8. Keep the Worker as One Main Rust Crate

Do not split the Worker into many crates just because it contains several subsystems.

Existing Worker domains such as:

```text
src/agents/
src/integrations/
src/terminal/
src/workspaces/
src/filesystem/
src/git/
src/process/
src/config/
```

or their actual equivalents should remain Rust modules unless there is already a concrete technical reason for them to be independent crates.

Do not create micro-crates like:

```text
worker/crates/agents
worker/crates/integrations
worker/crates/filesystem
worker/crates/git
worker/crates/config
```

merely for organization.

Rust modules already provide organization and encapsulation.

Prefer:

```text
worker/
├── Cargo.toml
└── src/
    ├── main.rs
    ├── agents/
    │   ├── mod.rs
    │   └── ...
    ├── integrations/
    │   ├── mod.rs
    │   └── ...
    ├── terminal/
    ├── filesystem/
    ├── workspace/
    └── ...
```

A new crate should only be introduced if an actual boundary already justifies it.

Examples of valid reasons include:

* another binary actually consumes it;
* it has a separate platform target;
* dependency isolation is required;
* it is a true reusable library;
* it is a proc macro;
* it has independent FFI requirements;
* it needs independent fuzzing/testing/build configuration;
* Cargo-level dependency boundaries are intentionally needed.

Do not perform speculative crate extraction.

---

# 9. Do Not Extract the HTTP/API Testing Feature

The Worker contains or is developing an HTTP/API testing subsystem similar in concept to tools that can execute repository-based `.http` request files.

Do not move this subsystem into a separate crate during this task.

Do not redesign it.

Do not rename it just for architectural purity.

Leave it where it currently lives within the Worker unless moving the Worker directory itself requires path changes.

This refactor is not about that subsystem.

---

# 10. Independent Versioning

The repository should no longer treat Desktop and Worker as a single versioned release artifact.

Desktop and Worker must have independent semantic versions.

Use component-prefixed tags:

```text
desktop-v0.12.0
worker-v1.7.3
```

Examples of valid release history:

```text
worker-v1.7.0
desktop-v0.11.0
desktop-v0.11.1
desktop-v0.12.0
worker-v1.7.1
desktop-v0.12.1
worker-v1.8.0
```

A Desktop release does not imply a Worker release.

A Worker release does not imply a Desktop release.

Do not create meaningless Worker patch releases when only the Desktop changed.

Do not create meaningless Desktop releases when only Worker changed.

---

# 11. Component Versions

The Desktop version should come from the existing authoritative Desktop version source, likely something such as:

```text
apps/desktop/package.json
```

or whatever the project currently uses.

The Worker version should come from:

```text
worker/Cargo.toml
```

or the actual authoritative Worker manifest.

Do not invent duplicate version files unless necessary.

Prefer one authoritative version source per component.

For example:

```text
apps/desktop/package.json

"version": "0.12.0"
```

and:

```toml
worker/Cargo.toml

[package]
version = "1.7.3"
```

---

# 12. Release Tag Validation

Release workflows should validate that the pushed tag matches the declared component version.

For example:

```text
desktop-v0.12.0
```

should match:

```json
{
  "version": "0.12.0"
}
```

in the Desktop package.

And:

```text
worker-v1.7.3
```

should match:

```toml
version = "1.7.3"
```

in the Worker manifest.

If they disagree, fail the release early with a clear message.

Do not silently rewrite versions in CI unless the repository already deliberately uses that workflow.

---

# 13. Split GitHub Release Workflows

The current release workflow apparently reacts to a release tag and packages both Worker and Desktop.

Split this behavior.

Prefer:

```text
.github/workflows/
├── ci.yml
├── release-desktop.yml
└── release-worker.yml
```

Use the repository's existing naming style if different.

Do not duplicate large amounts of working configuration unnecessarily.

Reuse existing steps or reusable workflows where appropriate, but keep the resulting architecture understandable.

---

# 14. Desktop Release Workflow

The Desktop release workflow must trigger only for:

```text
desktop-v*
```

For example:

```yaml
on:
  push:
    tags:
      - "desktop-v*"
```

The Desktop release pipeline should:

1. Checkout the repository.
2. Set up Node/pnpm using the project's existing versions/configuration.
3. Install dependencies.
4. Build any shared TS/JS packages required by Desktop.
5. Build the Electron application.
6. Package all currently supported Desktop platforms.
7. Upload release artifacts.
8. Create/populate the GitHub Release corresponding to the Desktop tag.

Preserve currently supported targets.

For example, if the existing project produces some subset of:

```text
Windows executable/installer
macOS DMG
Linux AppImage
Linux deb
Linux rpm
```

preserve the existing targets unless there is a real reason not to.

Do not arbitrarily add new package formats.

---

# 15. Desktop Release Must Not Touch Worker

The production Desktop release workflow must have zero build-time dependency on the Worker.

A `desktop-v*` release must NOT:

* run `cargo build` for Worker;
* compile Worker;
* package Worker;
* upload Worker artifacts;
* copy Worker into the Electron application;
* download Worker merely for packaging;
* inspect the Worker source tree as part of Desktop packaging;
* require Worker and Desktop SemVer to match.

Worker acquisition happens at Desktop runtime, not during Desktop packaging.

This is different from `pnpm dev`, where using Worker source directly is required.

---

# 16. Worker Release Workflow

Create or adapt a Worker-specific release workflow triggered only by:

```text
worker-v*
```

For example:

```yaml
on:
  push:
    tags:
      - "worker-v*"
```

The Worker release pipeline should:

1. Checkout the repository.
2. Configure the required Rust toolchain.
3. Build the Worker.
4. Build all currently supported platform/architecture combinations.
5. Package/rename the binaries consistently.
6. Upload artifacts.
7. Create/populate the Worker GitHub Release.

Preserve the currently supported Worker targets.

Do not remove cross-platform targets merely because the Worker moved directories.

---

# 17. Worker Release Must Not Touch Desktop

A `worker-v*` release must NOT:

* build Electron;
* package Desktop;
* create Desktop installers;
* upload Desktop artifacts;
* update Desktop's version;
* require Desktop and Worker versions to match.

Worker releases are independent.

---

# 18. GitHub Release Naming

Use clearly identifiable GitHub Releases.

For example:

```text
Orquester Desktop v0.12.0
```

with tag:

```text
desktop-v0.12.0
```

and:

```text
Orquester Worker v1.7.3
```

with tag:

```text
worker-v1.7.3
```

Preserve current release asset naming conventions where reasonable, but make sure Worker assets can be reliably identified programmatically by the Desktop downloader.

---

# 19. Existing Worker Downloader

The Desktop already downloads Worker binaries from GitHub Releases.

Inspect this implementation carefully before changing it.

Do not replace it.

Do not redesign the local Worker manager unless required by the new release naming convention.

Preserve existing behavior such as:

* platform detection;
* architecture detection;
* release lookup;
* version resolution;
* download progress;
* installation directory;
* executable permissions;
* binary naming;
* update behavior;
* local Worker startup;
* process lifecycle;
* health checks;
* error handling;
* retries;
* local/remote selection;
* persisted configuration.

Only make changes required by the new independent Worker release scheme.

---

# 20. Adapt Worker Release Discovery

The old release system may have used generic tags such as:

```text
v0.12.0
```

and may have expected Worker assets inside those releases.

The new Worker releases use:

```text
worker-vX.Y.Z
```

Update the Worker release discovery/download logic accordingly.

For example, the Desktop should not accidentally treat:

```text
desktop-v0.13.0
```

as a Worker release.

Worker discovery should only consider Worker releases/tags.

How exactly this should be implemented depends on the existing downloader.

Inspect it first.

Prefer the smallest robust change.

---

# 21. Do Not Couple Worker Version to Desktop Version

Avoid logic such as:

```text
Desktop 0.12.0
requires
Worker 0.12.0
```

The versions are independent.

A user might legitimately run:

```text
Desktop 0.15.2
Worker 1.8.4
```

or connect the same Desktop build to a compatible remote Worker with another Worker version.

Do not introduce direct SemVer equality as compatibility logic.

---

# 22. Protocol/API Compatibility

Inspect whether the project already has an explicit Worker protocol/API version.

If something like this already exists:

```text
protocolVersion
apiVersion
workerProtocolVersion
```

preserve it.

Do not conflate it with application SemVer.

These are different concepts:

```text
Desktop version:  0.12.0
Worker version:   1.7.3
Protocol version: 4
```

If compatibility logic already exists, make sure the release refactor preserves it.

If no explicit protocol version currently exists, do not introduce a large protocol negotiation system merely for this task.

Do not scope-creep.

However, avoid writing new code that assumes Desktop SemVer and Worker SemVer must be equal.

---

# 23. Web Client

The Web client remains under:

```text
apps/web/
```

Do not introduce a separate Web release workflow unless one already exists and needs path adjustments.

Do not redesign Web deployment.

Only update it if the Worker move breaks some development path or configuration.

---

# 24. Shared Packages

Keep shared JavaScript/TypeScript packages under:

```text
packages/
```

Examples may include:

```text
packages/ui
packages/core
packages/client
packages/protocol
packages/types
packages/state
```

depending on what actually exists.

Do not reorganize these packages unnecessarily.

Do not move Rust Worker internals into `packages/`.

`packages/` belongs to the JS/TS workspace model.

The root Worker being outside `apps/` does not mean it needs to become part of the JS package hierarchy.

---

# 25. pnpm Workspace

Inspect:

```text
pnpm-workspace.yaml
```

and the root:

```text
package.json
```

If `apps/worker` is currently included in JS workspace globs unnecessarily, remove/fix that as appropriate.

However, if root pnpm scripts invoke Worker development commands, preserve that functionality.

It is valid for pnpm scripts to orchestrate a Rust process.

For example, something conceptually equivalent to:

```json
{
  "scripts": {
    "dev": "... start apps + run worker ..."
  }
}
```

may continue to orchestrate:

```text
worker/
```

even though Worker is not an npm package.

Do not force Worker to have a `package.json` merely to make the monorepo look uniform.

---

# 26. Root Development Orchestration

Inspect how root development orchestration currently works.

Preserve the current developer-facing command:

```bash
pnpm dev
```

unless the repository already intentionally has another canonical command.

After the refactor, `pnpm dev` should still be enough to enter the normal development environment.

Do not require developers to manually open another terminal and run:

```bash
cd worker
cargo run
```

unless that was already the existing workflow.

If `pnpm dev` currently starts everything, keep starting everything.

---

# 27. Worker Development Process

If useful and consistent with the existing project, the Worker process launched by `pnpm dev` may use:

```bash
cargo run
```

or:

```bash
cargo watch
```

or an existing custom command.

Do not introduce additional tooling without need.

If Worker hot restart/watch behavior already exists, preserve it.

If it does not exist, this task does not require adding it.

---

# 28. Development Environment Variables

Inspect whether development scripts depend on relative paths or environment variables such as:

```text
WORKER_PATH
WORKER_BINARY
WORKER_DEV_PATH
ORQUESTER_WORKER_PATH
```

or equivalents.

Update them appropriately.

Do not change external/public configuration contracts unless required.

Production Desktop should still resolve its downloaded Worker independently.

Development may resolve the repository Worker explicitly.

---

# 29. Avoid Accidental Runtime Fallbacks

Do not implement ambiguous behavior where production Desktop silently checks for a repository-local Worker.

Production and development should have clear behavior.

Conceptually:

```text
development build/environment
    -> repository Worker allowed/expected
```

```text
packaged production Desktop
    -> downloaded Worker release
```

If the existing application already distinguishes development using Electron/Vite environment state, preserve that mechanism.

Do not weaken it.

---

# 30. CI vs Releases

Keep normal CI conceptually separate from publishing.

A regular CI workflow may still build/test multiple parts of the monorepo.

For example:

```text
CI
├── packages
├── web
├── desktop
└── worker
```

That is fine.

The release independence requirement applies to publication.

It is completely valid for CI to verify that a Desktop change has not broken Worker integration.

Do not confuse:

```text
testing all components
```

with:

```text
publishing all components
```

---

# 31. Path-Based CI Optimization

If the existing CI already uses path filtering, update Worker paths:

```text
apps/worker/**
```

to:

```text
worker/**
```

If there is no path filtering, do not add complicated filtering unless it clearly improves the existing workflow without adding fragility.

Correctness is more important than prematurely optimizing CI minutes.

---

# 32. Cargo Configuration

Inspect all Cargo-related configuration.

Potential files include:

```text
Cargo.toml
worker/Cargo.toml
.cargo/config.toml
Cargo.lock
```

If the repository has a root Cargo workspace, update member paths.

For example:

```toml
members = [
    "apps/worker"
]
```

should become:

```toml
members = [
    "worker"
]
```

if applicable.

If the Worker is not currently in a Cargo workspace, do not introduce one unless needed.

Do not restructure Rust packaging unnecessarily.

---

# 33. Cargo Lockfile

Preserve the project's existing lockfile strategy.

If Worker currently uses:

```text
Cargo.lock
```

at repository root, preserve that model if appropriate.

If it has its own lockfile, preserve that model unless moving the path requires a change.

Do not change dependency resolution architecture merely because of the move.

---

# 34. Documentation

Update relevant documentation to reflect the architecture.

At minimum, ensure repository documentation no longer describes the Worker as a client application under `apps/`.

Explain:

```text
apps/
```

Contains user-facing clients.

```text
packages/
```

Contains shared TypeScript/JavaScript libraries.

```text
worker/
```

Contains the Rust Worker runtime/daemon.

Also document the production/development distinction:

```text
Development:
pnpm dev uses the repository Worker source.

Production Desktop:
downloads Worker binaries from GitHub Releases when local mode is selected.
```

Document release tags:

```text
desktop-vX.Y.Z
worker-vX.Y.Z
```

and explicitly state that Desktop and Worker versions evolve independently.

Remove outdated documentation claiming that:

```text
vX.Y.Z
```

releases all project binaries together, if such documentation exists.

---

# 35. Release Assets

Inspect how the current Desktop Worker downloader identifies release files.

Preserve compatible asset naming where practical.

If changing asset names is necessary, update the downloader in the same change.

Do not leave a release workflow that uploads:

```text
worker-linux-x64
```

while the Desktop searches for:

```text
orquester-worker-linux-amd64
```

or similar mismatches.

Validate the complete end-to-end naming contract.

---

# 36. Checksums / Verification

If the current Worker release system already produces:

* checksums;
* signatures;
* manifests;

preserve them.

If it does not, do not introduce a new signing infrastructure as part of this task unless extremely trivial and clearly appropriate.

Do not scope-creep.

---

# 37. GitHub Releases API

If the Worker downloader uses the GitHub Releases API, inspect how it determines the latest Worker.

Do not blindly use the repository-wide:

```text
/releases/latest
```

if that can now resolve to a Desktop release.

With independent Desktop and Worker releases, repository-wide "latest release" may be the wrong component.

Ensure the Worker downloader resolves Worker releases specifically.

Possible approaches may include:

* filtering releases by `worker-v` tag;
* requesting a known Worker tag;
* using an existing manifest/index;
* another simple mechanism consistent with the current implementation.

Choose the solution that best fits the existing code.

Do not implement a large release service unnecessarily.

---

# 38. Pre-Releases

Inspect whether the project currently supports prereleases such as:

```text
beta
alpha
rc
nightly
```

Preserve existing behavior if present.

If Worker downloader intentionally ignores prereleases, keep doing so.

If it supports release channels, preserve them.

Do not redesign channels unless necessary.

---

# 39. Error Handling

If Worker discovery fails after the release split, errors should remain understandable.

Examples of relevant failures:

* no compatible Worker release found;
* unsupported platform;
* unsupported architecture;
* download failed;
* binary missing from release;
* checksum mismatch;
* launch failure.

Do not convert clear existing errors into generic failures.

---

# 40. No Android

Do not add:

```text
apps/android/
```

Do not add Android workflows.

Do not add React Native.

Do not add Capacitor.

Do not add mobile-specific shared code.

Android may exist in the future, but it is not part of this task.

---

# 41. Do Not Over-Refactor

Avoid unrelated cleanup.

Do not rewrite:

* the Worker protocol;
* agent architecture;
* integrations;
* terminal implementation;
* shell/session lifecycle;
* filesystem APIs;
* authentication;
* state management;
* Electron UI;
* React components;
* HTTP request execution;
* API testing subsystem;
* persistence;
* database code;
* configuration formats;

unless a direct path/release dependency requires a small adjustment.

This task should result in a focused diff.

---

# 42. Expected Final Architecture

The repository should conceptually end up similar to:

```text
/
├── apps/
│   ├── desktop/
│   │   ├── package.json
│   │   └── ...
│   │
│   └── web/
│       ├── package.json
│       └── ...
│
├── packages/
│   ├── ...
│   └── ...
│
├── worker/
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs
│   │   ├── agents/
│   │   ├── integrations/
│   │   ├── terminal/
│   │   └── ...
│   └── ...
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── release-desktop.yml
│       └── release-worker.yml
│
├── package.json
├── pnpm-workspace.yaml
└── ...
```

Do not force exact names if the existing repository has good equivalents.

---

# 43. Expected Development Flow

After the migration, this must remain valid:

```bash
git clone ...
cd orquester
pnpm install
pnpm dev
```

and the development orchestration should use:

```text
./worker/
```

as the Worker source.

The developer should not need to publish or download a Worker release to develop Orquester locally.

---

# 44. Expected Production Flow

A packaged Electron application should remain independent of the Worker source.

Expected behavior:

```text
Install Orquester Desktop

Open app

Choose Remote Worker
    -> connect to remote endpoint

or

Choose Local Worker
    -> Desktop discovers Worker GitHub releases
    -> selects/downloads required Worker binary
    -> stores it locally
    -> launches it
    -> connects to it
```

No Worker binary should need to exist inside the Electron installer.

---

# 45. Expected Release Flow

Desktop:

```bash
git tag desktop-v0.12.0
git push origin desktop-v0.12.0
```

Result:

```text
GitHub Release:
Orquester Desktop v0.12.0

Assets:
Desktop installers/packages only
```

Worker:

```bash
git tag worker-v1.7.3
git push origin worker-v1.7.3
```

Result:

```text
GitHub Release:
Orquester Worker v1.7.3

Assets:
Worker binaries only
```

There should no longer be a requirement to create a global:

```text
vX.Y.Z
```

tag to publish both.

---

# 46. Verification

Before considering the task complete, verify as much of the following as the local environment permits.

## Repository

* Worker exists at `/worker`.
* Old `/apps/worker` no longer exists.
* No meaningful stale references to `apps/worker` remain.

Use repository-wide search.

## JavaScript Workspace

* `pnpm install` succeeds.
* workspace resolution succeeds.
* shared packages resolve correctly.

## Worker

From the new location:

```bash
cd worker
cargo check
```

and preferably:

```bash
cargo build
```

should succeed.

Run existing Rust tests if practical.

## Web

Run the existing Web build/check commands.

## Desktop

Run the existing Desktop build/typecheck commands.

Do not require Worker packaging for a Desktop production build.

## Development

Verify the root development orchestration configuration.

If practical, run:

```bash
pnpm dev
```

and confirm it resolves the Worker at:

```text
worker/
```

rather than the old path.

If a long-running development command cannot be fully exercised in the environment, inspect and validate the process configuration carefully and report that limitation.

## Releases

Validate the workflow syntax.

Confirm:

```text
desktop-v*
```

only triggers Desktop publishing.

Confirm:

```text
worker-v*
```

only triggers Worker publishing.

Confirm Desktop publishing does not compile Worker.

Confirm Worker publishing does not compile Desktop.

## Downloader

Inspect and validate Worker release discovery.

Make sure a Desktop release cannot accidentally be selected as a Worker release.

Make sure asset matching still corresponds to Worker release output.

---

# 47. Search for Hidden Coupling

Before finishing, explicitly search for patterns that may indicate old architecture assumptions.

Examples:

```text
apps/worker
../worker
../../worker
v${version}
releases/latest
latest release
worker version
desktop version
cargo build
target/release
```

Interpret results rather than blindly changing every match.

The purpose is to find:

* stale old paths;
* global tag assumptions;
* Worker/desktop version equality;
* production Worker source dependencies;
* release asset assumptions.

---

# 48. Implementation Quality

Follow the existing repository code style.

Keep implementation names and comments in English.

Prefer minimal, explicit changes.

Avoid generated-looking abstractions.

Do not introduce unnecessary wrappers.

Do not create duplicate configuration sources.

Do not leave dead scripts referencing the old structure.

Do not leave temporary migration compatibility unless genuinely necessary.

Do not leave TODOs for required parts of the refactor.

---

# 49. Important Architectural Rules

Keep these rules true after the migration:

```text
apps != worker
```

```text
Desktop release != Worker release
```

```text
Desktop SemVer != Worker SemVer
```

```text
production Desktop does not build Worker
```

```text
production Desktop does not bundle Worker
```

```text
production Desktop downloads Worker from GitHub Releases
```

```text
pnpm dev DOES use local Worker source
```

```text
Worker internal subsystem != automatically a separate crate
```

```text
no Android in this task
```

```text
no HTTP/API testing crate extraction in this task
```

---

# 50. Final Deliverable

Do not only describe what should be changed.

Implement the refactor.

When finished, provide a concise but technically useful report containing:

## Repository Changes

Show the relevant final repository tree.

## Worker Move

Explain:

* old path;
* new path;
* references updated.

## Development

Explain exactly how:

```bash
pnpm dev
```

now launches/uses the Worker from source.

Mention the relevant scripts/configuration that were changed.

## Production Desktop

Confirm that the packaged Desktop remains independent from Worker source.

Confirm that Worker is still downloaded from GitHub Releases when local mode is selected.

## Release Workflows

List the workflows created/modified.

Explain:

```text
desktop-vX.Y.Z
```

and:

```text
worker-vX.Y.Z
```

behavior.

## Version Validation

Explain how release tags are checked against the component's declared version.

## Worker Downloader

Explain whether any change was required to handle Worker-specific release tags.

If modified, summarize exactly what changed.

## Verification

List commands actually executed, for example:

```bash
pnpm install
pnpm typecheck
pnpm build
cargo check
cargo test
```

Only claim commands that were actually executed.

## Remaining Issues

Report anything that could not be verified in the current environment.

Do not claim success for untested parts without saying they were only statically inspected.
