import type { BatteryStatusResponse } from "@orquester/api";
import type { FastifyInstance } from "fastify";
import { readBatteryStatus } from "../integrations/battery";

export function registerSystemRoutes(app: FastifyInstance): void {
  app.get("/api/system/battery", async (): Promise<BatteryStatusResponse> => readBatteryStatus());
}
