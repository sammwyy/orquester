<div align="center">

# Orquester

### Your development machine, orchestrated.

**A calm home for coding agents, terminals and projects — local-first, persistent, and reachable from any device you trust.**

`Rust worker` · `Electron desktop` · `web client` · `your files stay yours`

</div>

## The idea

Coding work does not fit neatly in a terminal tab. An agent may be planning for
twenty minutes, a dev server may be exposing a useful port, and a project may
need a quick edit, a Git action, or a request against an API. Closing a window
should not erase that context.

Orquester runs a small Worker on the machine that owns the work. It keeps PTY
sessions, workspace state, configuration and host integrations alive. The
Desktop app and browser client are two views of that same Worker.

> Close the app. Keep the work. Open another device. See the same project.

| What matters | How Orquester handles it |
| --- | --- |
| **Long-running work** | Terminals and agent sessions belong to the Worker, not a window. |
| **Many projects** | Workspaces and projects keep the sidebar aligned with real folders. |
| **Local control** | No account, cloud service, telemetry or database is required. |
| **Flexible access** | Use the native Desktop app locally or the browser UI from a trusted network. |

## What you can do

### Give every tool its own place

Open shells and installed coding agents as persistent project tabs. Orquester
detects the tools already available on the host, shows their installed version,
and can install or update supported agent harnesses from Settings.

- **Agents:** Antigravity, Claude Code, Cline, Codex, Deep Code, Grok Build,
  Kimi Code and OpenCode.
- **Shells:** Bash, Zsh, Fish, Nushell, PowerShell, Command Prompt and sh,
  according to the host platform.
- **Resume where you left off:** supported agents expose prior project
  conversations directly from the new-tab menu.
- **Keep an eye on limits:** Claude, Codex, Antigravity and Grok usage/auth
  information is surfaced in the quota view when their CLIs support it.

### Work with projects, not disconnected tabs

Projects live beneath workspaces on disk, and the sidebar mirrors that shape.
Create workspaces or projects from the app, move between active projects, and
keep terminal, file, Git and REST tabs together under the project they belong
to. The Attention Center highlights agent sessions that are active, finished,
or waiting for input.

### Edit, inspect and ship without leaving the app

Orquester includes the small pieces that are usually spread across several
windows:

- **Terminal:** full interactive PTY sessions with reconnect-safe output replay
  and mobile-friendly control keys.
- **Files:** a project-scoped browser and editor with syntax highlighting,
  search and save.
- **Git:** inspect branches, commits, stashes, diffs and working changes;
  initialize repositories, stage/unstage/discard files, commit, fetch, pull,
  check out branches and manage stashes.
- **REST Client:** keep `.http` and `.rest` requests with the repository, edit
  headers/body/variables, use `.env` values, send requests, and inspect
  formatted responses without moving secrets into a separate SaaS tool.
- **Open in:** launch the current project in a detected editor, file manager or
  browser. The catalog includes VS Code, Cursor, Windsurf, Zed, Sublime and
  JetBrains IDEs, plus common host browsers and file explorers.

### Know what the machine is doing

The status bar is more than decoration. Optional Worker integrations expose
Git state, CPU and memory, workspace disk usage, battery/power state, media
controls, keep-awake state, ports opened by child processes, and a process tree
for sessions started by the Worker. Integrations can be enabled or disabled
locally, per Worker.

### Reach the Worker from another device

The Desktop client can start a local Worker or connect to a saved remote one.
When HTTP access is enabled, the Worker can serve the browser UI on your LAN;
the responsive interface provides a drawer sidebar, adaptive menus and a
mobile control-key bar for terminal work from a phone.

Remote access is deliberately opt-in. It is useful for a trusted LAN, VPN, or
SSH tunnel — not for exposing directly to the public internet.

## A day with Orquester

1. Create a workspace and a project, or point the Worker at the workspace
   directory you already use.
2. Open a shell, agent, Git, files or REST Client tab with the **+** menu.
3. Let an agent work while you inspect its diff, test an endpoint, or open the
   project in your editor.
4. Close the window when you need to. The Worker and its sessions keep going.
5. Later, reopen Desktop or visit the Worker from another trusted device and
   continue from the same project.

## Get started

### Develop Orquester locally

Requirements: Node.js 20+, [pnpm](https://pnpm.io) 10+, and a Rust toolchain.

```sh
git clone https://github.com/sammwyy/orquester.git
cd orquester
pnpm install
pnpm dev
```

`pnpm dev` builds the repository Worker at `worker/target` and starts the
Desktop app against it. It never downloads a release Worker during normal
development.

Use a disposable configuration directory when you want isolated development
state:

```sh
pnpm dev:stage
```

Useful focused commands:

```sh
pnpm dev:worker       # Run only the Worker from source
pnpm dev:web          # Run the web client against http://127.0.0.1:47831
pnpm check            # Typecheck every JS/TS workspace package
cargo check --manifest-path worker/Cargo.toml
```

`pnpm dev:remoteworker` starts Desktop without a local Worker so the remote
Worker onboarding flow can be exercised.

### Run a Worker on a machine you want to reach

```sh
ORQUESTER_HTTP_ENABLED=true \
ORQUESTER_HTTP_PASSWORD='a-long-unique-password' \
cargo run --manifest-path worker/Cargo.toml
```

Open `http://<worker-host>:47831` from a trusted device, or add that Worker in
**Settings → Remote Workers** from Desktop.

## Security and privacy

The Worker is designed as a local authority, and remote clients have a narrower
role.

- Configuration changes, host-tool launching, agent installation and worker
  management are available only through the local transport.
- Remote HTTP clients authenticate with a bcrypt-derived bearer value; plaintext
  passwords are not stored by Orquester or sent over the wire.
- Filesystem APIs are confined to the configured workspaces directory.
- State is stored as directories and JSON under `~/.orquester` by default — no
  database or cloud account is involved.

The HTTP transport is plain HTTP, not TLS. Keep it on a trusted LAN or put it
behind a VPN, SSH tunnel or TLS-terminating reverse proxy.

## Configuration

By default, Orquester keeps its state here (override with `ORQUESTER_APPDIR`):

```text
~/.orquester/
├── app/
│   ├── app.json       # Appearance, update channel and client preferences
│   └── remotes.json   # Saved remote Workers
└── daemon/
    ├── daemon.json    # Workspaces, logs, HTTP and integration settings
    └── logs/
```

The main server settings are intentionally plain JSON. Paths accept
`$userhome`, `$user`, `$cwd` and `$appdir`:

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

## Architecture

```text
Desktop app ─┐
             ├── Worker ── PTYs, files, projects, tool registry and integrations
Web client ──┘
```

| Piece | Responsibility |
| --- | --- |
| `worker/` | Rust Worker: the persistent runtime, local/HTTP transports, sessions and host integrations. |
| `apps/desktop/` | Electron client, tray, native window behavior and local-socket transport. |
| `apps/web/` | Vite browser client for connecting to a Worker remotely. |
| `packages/ui/` | Shared React interface rendered by Desktop and Web. |
| `packages/api/` | Shared wire contracts mirrored by the Rust Worker. |
| `packages/config/` | Configuration schemas, defaults and on-disk layout. |
| `packages/registry/` | Static definitions for known tools and templates. |

## Releases

Desktop and Worker are released independently.

- `desktop-vX.Y.Z` creates a Desktop release with installers only.
- `worker-vX.Y.Z` creates a Worker release with platform binaries and checksums
  only.

Desktop is not packaged with a Worker binary. In local Worker mode, a packaged
Desktop app finds the matching platform asset from a `worker-v*` GitHub release,
verifies its checksum, installs it locally and starts it. Development remains
different by design: `pnpm dev` always uses the Worker in this repository.

## Contributing

The project is a pnpm monorepo with a Rust runtime. Read
[AGENTS.md](./AGENTS.md) before changing architecture or threading a feature
through the Worker and UI.

```sh
pnpm check
```

Commits use `type(scope): summary`, such as `feat(ui): …` or
`fix(worker): …`.

## License

[MIT](./LICENSE) © Sammwy
