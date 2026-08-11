import type {
  DaemonConfig
} from "@orquester/config";
import type { IntegrationsResponse, UpdateIntegrationsRequest } from "@orquester/api";
import type { FastifyInstance } from "fastify";
import { writeFile } from "node:fs/promises";
import { getIntegrationAvailability } from "../integrations/catalog";

interface IntegrationRoutesOptions {
  config: DaemonConfig;
  configPath: string;
  local: boolean;
  apply: (integrations: Record<string, boolean>) => void;
}

export function registerIntegrationRoutes(app: FastifyInstance, options: IntegrationRoutesOptions): void {
  app.get("/api/integrations", async (): Promise<IntegrationsResponse> => {
    const available = await getIntegrationAvailability();
    return {
      integrations: available.map((integration) => ({
        ...integration,
        enabled: Boolean(options.config.integrations[integration.id]) && integration.available
      }))
    };
  });

  app.put<{ Body: Partial<UpdateIntegrationsRequest> }>(
    "/api/integrations",
    async (request, reply): Promise<IntegrationsResponse | void> => {
      if (!options.local) {
        return reply.code(403).send({ code: "FORBIDDEN", message: "Integrations can only be changed locally." });
      }
      const requested = request.body?.integrations;
      if (!requested || typeof requested !== "object") {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "integrations object required." });
      }
      const available = await getIntegrationAvailability();
      const known = new Set(available.map((integration) => integration.id));
      const integrations = { ...options.config.integrations };
      for (const [id, enabled] of Object.entries(requested)) {
        if (known.has(id) && typeof enabled === "boolean") integrations[id] = enabled;
      }
      await writeFile(options.configPath, `${JSON.stringify({ ...options.config, integrations }, null, 2)}\n`, "utf8");
      options.config.integrations = integrations;
      options.apply(integrations);
      return {
        integrations: available.map((integration) => ({
          ...integration,
          enabled: Boolean(integrations[integration.id]) && integration.available
        }))
      };
    }
  );
}
