import type { BatteryStatusResponse, MediaControlRequest, MediaStatusResponse } from "@orquester/api";
import type { FastifyInstance } from "fastify";
import { readBatteryStatus } from "../integrations/battery";
import { readSystemResources } from "../integrations/system-resources";
import { controlMedia, readMediaStatus, readMediaThumbnail } from "../integrations/media";

export function registerSystemRoutes(app: FastifyInstance, workspacesDir: string): void {
  app.get("/api/system/battery", async (): Promise<BatteryStatusResponse> => readBatteryStatus());
  app.get("/api/system/resources", async () => readSystemResources(workspacesDir));
  app.get("/api/system/media", async (): Promise<MediaStatusResponse> => readMediaStatus());
  app.get("/api/system/media/thumbnail", async (_request, reply) => {
    const thumbnail = await readMediaThumbnail();
    if (!thumbnail) return reply.code(404).send({ code: "NOT_FOUND", message: "No media thumbnail available." });
    return reply.type(thumbnail.mimeType).send(thumbnail.data);
  });
  app.post<{ Body: Partial<MediaControlRequest> }>("/api/system/media/control", async (request, reply): Promise<MediaStatusResponse | void> => {
    if (!request.body?.action || !["previous", "playPause", "next", "volume"].includes(request.body.action)) {
      return reply.code(400).send({ code: "INVALID_REQUEST", message: "A valid media action is required." });
    }
    try {
      return await controlMedia(request.body as MediaControlRequest);
    } catch (error) {
      return reply.code(400).send({ code: "MEDIA_ERROR", message: error instanceof Error ? error.message : "Media control failed." });
    }
  });
}
