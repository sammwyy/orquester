# Mobile-ready client boundary

Orquester does not ship a mobile app yet. A future `apps/mobile` should be a
thin renderer for remote workers, not another daemon host or a fork of the web
application.

Use `@orquester/core` for worker connections, transport contracts, encrypted
credential-vault adapters, client config adapters and local-worker lifecycle
contracts. Platform implementations provide the HTTP transport and secure
storage; the core package must stay free of React, DOM, Electron and native
framework imports.

Use `@orquester/design-tokens` as the visual source of truth. Web consumes its
CSS variables and TypeScript metadata; a native renderer should map the same
palette, typography, spacing, radii, touch-target and layer tokens to native
components. Do not share DOM components or Tailwind classes with a native app.

`@orquester/ui` remains the React web renderer for desktop and browser clients.
Extract a state or service from it only after it has a platform-neutral contract;
otherwise keep it in the web package. Mobile should support remote workers by
default. Running a durable local worker on iOS or Android is a separate product
decision and is intentionally outside this boundary.
