<div align="center">

# Orquester

**One place to run every coding agent you use — on your machine, from any device.**

Orquester gives Claude Code, Codex, Gemini CLI, OpenCode and your plain old
shell a proper home: real terminals that keep running when you close the
window, organized by workspace and project, reachable from your desktop app or
your phone's browser.

`local-first` · `desktop + web` · `no cloud, no account, no database`

<!-- Screenshot: the desktop app with an agent running in a project tab. -->
![Orquester desktop](docs/screenshots/hero.png)

</div>

---

## Why

Coding agents live in terminals, and terminals are awkward to manage. You end up
with a dozen tabs across a dozen projects, no idea which agent is still working,
and nothing survives a closed window or a walk to the kitchen.

Orquester runs a small **daemon** on your machine that owns those terminals. The
apps are just windows onto it:

- **Close the window, keep the work.** Sessions live in the daemon, not the UI.
- **Same state everywhere.** Open the desktop app and a browser tab side by
  side — same sessions, same output, live.
- **Check in from your phone.** Enable the HTTP transport and your agents are a
  URL away on your LAN, password protected.
- **Your files stay yours.** Everything is plain directories and JSON under
  `~/.orquester`. No database, no telemetry, no sign-in.

## Features

**Agents & shells**
Auto-detects installed agents and shells and gives each one a tab. Install or
update supported agents from Settings without touching a terminal. Supported
today: Claude Code, Codex, Gemini CLI, OpenCode, DeepSeek — plus Bash, Zsh,
Fish, Nushell, PowerShell, cmd and sh.

**Workspaces & projects**
Your work is a two-level folder tree — `workspaces/<workspace>/<project>` — so
the sidebar mirrors how your disk is already organized. Create either one from
the UI.

**Real terminals**
GPU-accelerated xterm.js with a proper 256-color palette, full control-key
support, and reconnect-safe output replay. TUIs behave.

**Built-in file browser & editor**
Browse a project, open a file, edit it with syntax highlighting (CodeMirror 6),
save. Handy when the agent's diff needs a human touch.

**Open on ▾**
Launch the current project in VS Code, Cursor, Zed, Windsurf, Antigravity, any
JetBrains IDE, Sublime, your file manager or a browser — whatever Orquester
finds installed.

**Remote access, on your terms**
The HTTP transport is off by default. Turn it on, set a password, and the daemon
serves the same UI to any device on your network.

**Multi-window & tray**
Open several windows against one daemon. Enable *run in background* and the tray
keeps your agents alive with no window at all.

**Mobile-ready**
Not a shrunken desktop UI: a real off-canvas sidebar, bottom-sheet menus, and a
control-key bar that sits above the on-screen keyboard so you can send `Ctrl-C`
from a phone.

## Screenshots

<!--
Drop the captures into docs/screenshots/ with these filenames:
  workspaces.png  — sidebar with a few workspaces/projects, one project open
  files.png       — the file browser with a file open in the editor
  settings.png    — Settings → Agents, showing install/update state
  mobile.png      — narrow viewport: drawer sidebar + terminal + key bar
-->

| Workspaces & tabs | Files & editor |
| --- | --- |
| ![Workspaces](docs/screenshots/workspaces.png) | ![File browser](docs/screenshots/files.png) |
| **Agent management** | **On your phone** |
| ![Settings](docs/screenshots/settings.png) | ![Mobile](docs/screenshots/mobile.png) |

## Status

Early days — version `0.0.0`. It works and it's used daily, but interfaces move
and there are no packaged releases yet. Build from source, and expect the
occasional rough edge.

## Getting started

**Requirements:** Node.js 20+ and [pnpm](https://pnpm.io) 10+. Linux, macOS or
Windows.

```sh
git clone https://github.com/sammwyy/orquester.git
cd orquester
pnpm install
pnpm dev
```

`pnpm dev` opens the desktop app against your normal per-user Orquester config.
Use the explicit sandbox command when you need isolated development state:

```sh
pnpm dev:stage
```

`pnpm dev` uses the worker already compiled in `apps/worker/target`; it never
downloads a release worker unless `ORQUESTER_USE_RELEASE_WORKER=1` is set. Use
`pnpm dev:remoteworker` to run the desktop client without a local worker and
exercise the remote-worker onboarding flow.

### Building the desktop app

```sh
pnpm build
```

Installers land in `apps/desktop/release` — AppImage on Linux, NSIS on Windows,
DMG on macOS.

### Running the worker on its own

Useful on a headless machine you want to reach from a laptop or phone:

```sh
ORQUESTER_HTTP_ENABLED=true \
ORQUESTER_HTTP_PASSWORD='a-good-password' \
cargo run --manifest-path apps/worker/Cargo.toml
```

Then point a browser at `http://<host>:47831`.

## Using it

1. **Create a workspace** in the sidebar — it's a folder under your workspaces
   directory (`~/workspaces` by default).
2. **Create a project** inside it, then open it.
3. **Press `+`** in the top bar and pick a shell, an agent, or the file browser.
4. Work. Close the window whenever — the session is still there when you come
   back, from any client.

Missing an agent? **Settings → Agents** lists everything Orquester knows about
and installs it for you.

## Remote access & security

Remote access is opt-in and password protected. Enable it in
**Settings → Daemon**, or set `ORQUESTER_HTTP_ENABLED=true` with
`ORQUESTER_HTTP_PASSWORD`.

How it's protected:

- The daemon stores a **bcrypt hash** of your password, never the password.
- Clients derive the same hash locally and send it as a bearer token, so your
  plaintext password never crosses the network and never hits local storage.
- Daemon configuration and shutdown are reachable **only over the local socket**
  — a remote client can read the config, never change it.
- The local socket transport is unauthenticated by design and protected by
  filesystem permissions, exactly like a Docker socket.

A frank caveat: this is plain HTTP with no TLS. It is built for a trusted LAN.
Don't expose the port to the internet — put it behind a VPN, an SSH tunnel, or
a reverse proxy that terminates TLS.

## Configuration

Everything lives under `~/.orquester` (override with `ORQUESTER_APPDIR`):

```
~/.orquester/
├── app/
│   ├── app.json       # UI preferences
│   └── remotes.json   # saved remote servers
└── daemon/
    ├── daemon.json    # workspaces dir, logs, HTTP transport
    └── logs/
```

`daemon.json` in full:

```jsonc
{
  "version": 1,
  "workspacesDir": "$userhome/workspaces",
  "logsDir": "$appdir/daemon/logs",
  "transports": {
    "http": { "enabled": false, "host": "127.0.0.1", "port": 47831 }
  }
}
```

Paths accept `$userhome`, `$user`, `$cwd` and `$appdir`.

**Teaching it about a tool it doesn't know.** Drop a JSON file next to
`daemon.json` — `agents.json`, `shells.json`, `ides.json`, `browsers.json` or
`file-explorers.json`:

```json
[{ "id": "aider", "name": "Aider", "bin": ["aider"], "versionFlag": "--version" }]
```

It shows up in the menus on the next daemon start.

## How it's built

| Piece | What it is |
| --- | --- |
| `apps/worker` | Rust server owning PTYs, the filesystem and the tool catalog |
| `apps/desktop` | Electron shell that starts and connects to a local worker, plus tray |
| `apps/web` | Vite SPA for remote access |
| `packages/ui` | The React app both clients render (Tailwind, zustand, xterm.js) |
| `packages/api` | Shared wire types |
| `packages/config` | Zod schemas and the on-disk layout |
| `packages/registry` | The static catalog of known agents, shells, IDEs, browsers |

TypeScript end to end, pnpm workspaces, no build step for the shared packages.

## Contributing

Contributions are welcome. **[AGENTS.md](./AGENTS.md)** is the guide: it maps
the codebase, explains where each kind of change belongs, and walks through the
common feature recipes. It's written for both human contributors and AI coding
agents — [CLAUDE.md](./CLAUDE.md) simply points at it.

Before opening a PR:

```sh
pnpm check
```

Commits follow `type(scope): summary` — `feat(ui): …`, `fix(daemon): …`.

## License

[MIT](./LICENSE) © Sammwy
