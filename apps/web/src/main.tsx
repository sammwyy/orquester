import { OrquesterApp, createLocalStorageConnectionsAdapter } from "@orquester/ui";
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OrquesterApp
      runtime="web"
      connectionsAdapter={createLocalStorageConnectionsAdapter()}
      initialConnection={{
        id: "remote",
        name: "Remote server",
        kind: "remote",
        endpoint: import.meta.env.VITE_ORQUESTER_API_URL ?? "http://127.0.0.1:47831",
        status: "disconnected"
      }}
    />
  </React.StrictMode>
);
