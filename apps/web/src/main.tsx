import { OrquesterApp, createLocalStorageAppConfigAdapter } from "@orquester/ui";
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

// When served by the daemon itself the API is same-origin; in standalone dev
// VITE_ORQUESTER_API_URL points at the daemon. A password-protected daemon
// triggers an in-app prompt (the bearer is a stored bcrypt hash).
const endpoint = import.meta.env.VITE_ORQUESTER_API_URL ?? window.location.origin;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OrquesterApp
      runtime="web"
      clientVersion={import.meta.env.VITE_ORQUESTER_CLIENT_VERSION}
      appConfigAdapter={createLocalStorageAppConfigAdapter()}
      initialConnection={{
        id: "remote",
        name: "Remote server",
        kind: "remote",
        endpoint,
        status: "disconnected"
      }}
    />
  </React.StrictMode>
);
