import type { BatteryStatusResponse } from "@orquester/api";
import type { FastifyInstance } from "fastify";
import { readBatteryStatus } from "../integrations/battery";
import { readSystemResources } from "../integrations/system-resources";

export function registerSystemRoutes(app: FastifyInstance, workspacesDir: string): void {
  app.get("/api/system/battery", async (): Promise<BatteryStatusResponse> => readBatteryStatus());
  app.get("/api/system/resources", async () => readSystemResources(workspacesDir));
}
