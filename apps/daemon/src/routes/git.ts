import type { GitInitRequest, GitStatusResponse } from "@orquester/api";
import type { FastifyInstance } from "fastify";
import { resolve, sep } from "node:path";
import type { Broadcaster } from "../broadcaster";
import { initializeGit, readGitStatus, type GitProjectWatcher } from "../integrations/git";

interface GitRoutesOptions {
  workspacesDir: string;
  broadcaster: Broadcaster;
  gitWatcher: GitProjectWatcher;
}

function projectPathFor(workspacesDir: string, path: string): string {
  const root = resolve(workspacesDir);
  const projectPath = resolve(path);
  if (projectPath !== root && !projectPath.startsWith(`${root}${sep}`)) {
    throw new Error("Project is outside the workspaces directory.");
  }
  return projectPath;
}

export function registerGitRoutes(app: FastifyInstance, options: GitRoutesOptions): void {
  app.get<{ Querystring: { path?: string } }>(
    "/api/git/status",
    async (request, reply): Promise<GitStatusResponse | void> => {
      const path = request.query.path;
      if (!path) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path required." });
      }
      try {
        return await readGitStatus(projectPathFor(options.workspacesDir, path));
      } catch (error) {
        return reply.code(error instanceof Error && error.message.startsWith("Project is outside") ? 403 : 400).send({
          code: error instanceof Error && error.message.startsWith("Project is outside") ? "FORBIDDEN" : "GIT_ERROR",
          message: error instanceof Error ? error.message : "Cannot read git status."
        });
      }
    }
  );

  app.post<{ Body: Partial<GitInitRequest> }>(
    "/api/git/init",
    async (request, reply): Promise<GitStatusResponse | void> => {
      const path = request.body?.path;
      if (!path) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path required." });
      }
      try {
        const projectPath = projectPathFor(options.workspacesDir, path);
        const status = await initializeGit(projectPath);
        options.gitWatcher.watch(projectPath);
        options.broadcaster.publish("projects", "project.git.changed", status);
        return status;
      } catch (error) {
        const forbidden = error instanceof Error && error.message.startsWith("Project is outside");
        return reply.code(forbidden ? 403 : 400).send({
          code: forbidden ? "FORBIDDEN" : "GIT_ERROR",
          message: error instanceof Error ? error.message : "Cannot initialize git repository."
        });
      }
    }
  );
}
