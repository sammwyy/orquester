# AGENTS.md

How to work in Orquester: what the domains are, where features go, and how code
here is written. It describes intent, not file-by-file truth — read the code for
that, and prefer a better idea over a stale convention.

## The core idea

A daemon owns everything that must outlive a window: terminal sessions, the
filesystem, the catalog of installed tools. The desktop and web apps are views
onto it, rendering the same UI and differing only in how they reach the daemon
(local socket or HTTP). Nothing important lives in a client.

Design around that. If state has to survive a closed window or be visible from a
second device, it belongs to the daemon.

## Domains

**apps/worker** — the server. Owns PTY sessions, the tool registry, filesystem
access, configuration and the event bus. Routes stay thin; each domain gets its
own service module.

**apps/desktop** — Electron shell. Runs the daemon in-process, provides the
tray, the native window and the socket transport. Node-only work lives here and
crosses to the renderer through the preload bridge.

**apps/web** — browser client for remote access. Thin: a transport and a mount.

**packages/config** — configuration schemas, defaults and the on-disk layout.

**packages/api** — the wire contracts shared by daemon and clients. Anything both
sides need to agree on ends up here.

**packages/registry** — static catalog of known shells, agents, IDEs, browsers and
file managers. Pure data, no logic.

**packages/ui** — the entire interface both clients render: components grouped by
feature, a store for shared state, hooks for component-local data, services for
domain logic, and the transport/client layer that talks to the daemon.

**.stage** — a committed sandbox config dir so development never touches your real
one.

## Where features go

Follow the dependency direction: config, then api, then registry and ui; the
daemon uses all three, the apps compose them. The UI and the daemon never import
each other — when you want them to, the thing you're reaching for should become
a shared contract instead.

A typical feature threads inward to outward: a shared type, a daemon route
delegating to a service, a method on the API client, then a store action or hook,
then a component. Skipping layers (a component fetching directly, a route
carrying business logic) is what breaks the second transport or the second
client later.

Some placement heuristics:

- State several screens read goes in the store; data one component owns goes in a
  hook.
- Anything a second client could observe should be broadcast on the event bus,
  not left for the caller to refetch.
- New launchable tools are a data entry plus an icon. If adding one requires
  touching the UI, the abstraction leaked.
- Streaming is plain chunked HTTP over the transport layer, never raw fetch, so
  both transports keep working.
- Privileged operations belong behind the local socket. Remote clients read; they
  don't reconfigure the host.
- There is no database. Directories and JSON are the storage model.

## Writing code

TypeScript, ESM, strict. Named exports, barrel per folder, two-space indent,
double quotes. Match the file you're editing.

**Comments:** minimal and only where they earn it. Explain a non-obvious *why*;
never narrate what the code already says. No banner comments, no ASCII or
Unicode separator lines, no decorative section dividers.

**No backwards compatibility.** Don't write migration paths, compatibility
shims, legacy branches or deprecated aliases. When a shape changes, change it.

**Be fail-safe instead.** Compatibility comes from tolerant inputs, not from
migration code: validate and normalize at the boundary, give every config field a
default, fall back to a sane value when something is missing or unparseable, and
catch at the edges so bad state degrades instead of crashing. Old data should
either normalize cleanly or be ignored — never special-cased.

**Secrets** are never logged, stored in plaintext, or returned over the wire.

Commits: `type(scope): summary`, lowercase.

## Running it

`pnpm dev` for the desktop app against the sandbox, `pnpm dev:bare` against the
real config dir, `pnpm dev:worker` and `pnpm dev:web` for the pieces alone.

`pnpm check` typechecks everything and is the only automated gate — there are no
tests and no linter, so verify real behavior by running the app, and be explicit
about what you did and didn't confirm.

Keep this file true when the shape of the project changes.
