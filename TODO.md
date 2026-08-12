# TODO

## Worker distribution and setup

- Make the desktop app a client and manager for separately installed workers; do not bundle a worker executable inside the desktop package for the product flow.
- Add onboarding that asks which setup the user wants:
  - **Develop on this PC:** install and configure a local worker.
  - **Use a remote PC through this app:** configure a remote worker without installing a local one.
  - **Develop using this PC and a remote PC:** install a local worker and configure one or more remote workers.
- For flows with a local worker, ask whether tasks should keep running when the desktop app is closed.
  - Initially support a per-user background worker started at sign-in; evaluate a system service only if running without an interactive user session becomes necessary.
- For flows with local or user-managed workers, offer to enable remote access from another device (phone or another PC).
  - Explain the exposure clearly and keep remote access disabled by default.
  - Provide connection details, status, and a QR code where useful.
  - Prefer LAN/VPN or a secure tunnel; do not make direct public Internet exposure the default path.
- Publish versioned worker binaries per OS and architecture (for example, GitHub Releases) plus a signed release manifest.
  - Verify a checksum and signature before installing or updating a worker.
  - Define desktop/worker API compatibility in the shared API contract.
  - Support worker updates, rollback on failed updates, and clean uninstall.

## Single-account remote authentication

- Replace password-only HTTP authentication with a single configured username and password.
  - This is one account per worker, not multi-user accounts, roles, or authorization.
  - Require both values when connecting; do not reveal whether the username or password was wrong.
  - Store only a password hash and never log, return, or persist plaintext credentials.
- Treat the username as an additional credential component and usability identifier, not as a substitute for a strong password.
  - Require a minimum password strength and rate-limit failed authentication attempts.
  - Continue using constant-time password verification and generic authentication failures.
- Update the daemon configuration schema, API contracts, desktop onboarding/settings, remote connection UI, and migration/normalization behavior together.
