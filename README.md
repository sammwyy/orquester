# Orquester

Monorepo skeleton for a local-first coding orchestrator.

## Workspace layout

- `apps/daemon`: Node.js daemon exposing HTTP/WebSocket APIs and local Unix socket transport.
- `apps/desktop`: Electron desktop shell that starts the local daemon and hosts the shared UI.
- `apps/web`: Vite web client for remote HTTP deployments.
- `packages/config`: shared configuration schemas, defaults, and validation.
- `packages/api`: shared API contracts and HTTP client.
- `packages/ui`: shared React UI used by desktop and web.

## Commands

```sh
pnpm install
pnpm dev:daemon
pnpm dev:web
pnpm dev:desktop
pnpm check
```

Runtime data defaults to `~/.orquester`.
