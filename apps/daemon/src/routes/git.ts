import type {
  GitBranchesResponse,
  GitCheckoutRequest,
  GitCommitDetail,
  GitCommitRequest,
  GitFilesRequest,
  GitInitRequest,
  GitLogResponse,
  GitStashActionRequest,
  GitStashCreateRequest,
  GitStashListResponse,
  GitStatusResponse,
  GitWorkingDiffResponse
} from "@orquester/api";
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolve, sep } from "node:path";
import type { Broadcaster } from "../broadcaster";
import {
  applyStash,
  checkoutRef,
  commitChanges,
  createStash,
  discardFiles,
  dropStash,
  initializeGit,
  listBranches,
  listStashes,
  popStash,
  readCommit,
  readGitStatus,
  readLog,
  readWorkingDiff,
  stageFiles,
  unstageFiles,
  type GitProjectWatcher
} from "../integrations/git";

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

function gitErrorReply(reply: FastifyReply, error: unknown, fallback: string) {
  const forbidden = error instanceof Error && error.message.startsWith("Project is outside");
  return reply.code(forbidden ? 403 : 400).send({
    code: forbidden ? "FORBIDDEN" : "GIT_ERROR",
    message: error instanceof Error ? error.message : fallback
  });
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
        return gitErrorReply(reply, error, "Cannot read git status.");
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
        return gitErrorReply(reply, error, "Cannot initialize git repository.");
      }
    }
  );

  app.get<{ Querystring: { path?: string } }>(
    "/api/git/branches",
    async (request, reply): Promise<GitBranchesResponse | void> => {
      const path = request.query.path;
      if (!path) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path required." });
      }
      try {
        return await listBranches(projectPathFor(options.workspacesDir, path));
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot read branches.");
      }
    }
  );

  app.get<{ Querystring: { path?: string; branch?: string; limit?: string; skip?: string } }>(
    "/api/git/log",
    async (request, reply): Promise<GitLogResponse | void> => {
      const path = request.query.path;
      if (!path) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path required." });
      }
      const limit = Math.min(500, Math.max(1, Number(request.query.limit) || 100));
      const skip = Math.max(0, Number(request.query.skip) || 0);
      try {
        return await readLog(projectPathFor(options.workspacesDir, path), {
          branch: request.query.branch,
          limit,
          skip
        });
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot read commit log.");
      }
    }
  );

  app.get<{ Querystring: { path?: string; hash?: string } }>(
    "/api/git/commit",
    async (request, reply): Promise<GitCommitDetail | void> => {
      const path = request.query.path;
      const hash = request.query.hash;
      if (!path || !hash) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path and hash required." });
      }
      try {
        return await readCommit(projectPathFor(options.workspacesDir, path), hash);
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot read commit.");
      }
    }
  );

  app.post<{ Body: Partial<GitCheckoutRequest> }>(
    "/api/git/checkout",
    async (request, reply): Promise<GitStatusResponse | void> => {
      const path = request.body?.path;
      const ref = request.body?.ref;
      if (!path || !ref) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path and ref required." });
      }
      try {
        const projectPath = projectPathFor(options.workspacesDir, path);
        const status = await checkoutRef(projectPath, ref);
        options.broadcaster.publish("projects", "project.git.changed", status);
        return status;
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot check out ref.");
      }
    }
  );

  app.get<{ Querystring: { path?: string } }>(
    "/api/git/stash",
    async (request, reply): Promise<GitStashListResponse | void> => {
      const path = request.query.path;
      if (!path) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path required." });
      }
      try {
        const stashes = await listStashes(projectPathFor(options.workspacesDir, path));
        return { stashes };
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot read stashes.");
      }
    }
  );

  app.post<{ Body: Partial<GitStashCreateRequest> }>(
    "/api/git/stash",
    async (request, reply): Promise<GitStatusResponse | void> => {
      const path = request.body?.path;
      if (!path) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path required." });
      }
      try {
        const projectPath = projectPathFor(options.workspacesDir, path);
        await createStash(projectPath, request.body?.message, request.body?.includeUntracked);
        const status = await readGitStatus(projectPath);
        options.broadcaster.publish("projects", "project.git.changed", status);
        return status;
      } catch (error) {
        return gitErrorReply(reply, error, "Nothing to stash.");
      }
    }
  );

  app.post<{ Body: Partial<GitStashActionRequest> }>(
    "/api/git/stash/apply",
    async (request, reply): Promise<GitStatusResponse | void> => {
      const path = request.body?.path;
      const ref = request.body?.ref;
      if (!path || !ref) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path and ref required." });
      }
      try {
        const projectPath = projectPathFor(options.workspacesDir, path);
        await applyStash(projectPath, ref);
        const status = await readGitStatus(projectPath);
        options.broadcaster.publish("projects", "project.git.changed", status);
        return status;
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot apply stash.");
      }
    }
  );

  app.post<{ Body: Partial<GitStashActionRequest> }>(
    "/api/git/stash/pop",
    async (request, reply): Promise<GitStatusResponse | void> => {
      const path = request.body?.path;
      const ref = request.body?.ref;
      if (!path || !ref) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path and ref required." });
      }
      try {
        const projectPath = projectPathFor(options.workspacesDir, path);
        await popStash(projectPath, ref);
        const status = await readGitStatus(projectPath);
        options.broadcaster.publish("projects", "project.git.changed", status);
        return status;
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot pop stash.");
      }
    }
  );

  app.delete<{ Body: Partial<GitStashActionRequest> }>(
    "/api/git/stash",
    async (request, reply): Promise<{ ok: true } | void> => {
      const path = request.body?.path;
      const ref = request.body?.ref;
      if (!path || !ref) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path and ref required." });
      }
      try {
        await dropStash(projectPathFor(options.workspacesDir, path), ref);
        return { ok: true };
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot drop stash.");
      }
    }
  );

  app.get<{ Querystring: { path?: string; file?: string; staged?: string } }>(
    "/api/git/diff",
    async (request, reply): Promise<GitWorkingDiffResponse | void> => {
      const path = request.query.path;
      const file = request.query.file;
      if (!path || !file) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path and file required." });
      }
      try {
        const diff = await readWorkingDiff(projectPathFor(options.workspacesDir, path), file, request.query.staged === "true");
        return { diff };
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot read diff.");
      }
    }
  );

  app.post<{ Body: Partial<GitFilesRequest> }>(
    "/api/git/stage",
    async (request, reply): Promise<GitStatusResponse | void> => {
      const path = request.body?.path;
      const files = request.body?.files;
      if (!path || !files?.length) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path and files required." });
      }
      try {
        const projectPath = projectPathFor(options.workspacesDir, path);
        await stageFiles(projectPath, files);
        const status = await readGitStatus(projectPath);
        options.broadcaster.publish("projects", "project.git.changed", status);
        return status;
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot stage files.");
      }
    }
  );

  app.post<{ Body: Partial<GitFilesRequest> }>(
    "/api/git/unstage",
    async (request, reply): Promise<GitStatusResponse | void> => {
      const path = request.body?.path;
      const files = request.body?.files;
      if (!path || !files?.length) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path and files required." });
      }
      try {
        const projectPath = projectPathFor(options.workspacesDir, path);
        await unstageFiles(projectPath, files);
        const status = await readGitStatus(projectPath);
        options.broadcaster.publish("projects", "project.git.changed", status);
        return status;
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot unstage files.");
      }
    }
  );

  app.post<{ Body: Partial<GitFilesRequest> }>(
    "/api/git/discard",
    async (request, reply): Promise<GitStatusResponse | void> => {
      const path = request.body?.path;
      const files = request.body?.files;
      if (!path || !files?.length) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path and files required." });
      }
      try {
        const projectPath = projectPathFor(options.workspacesDir, path);
        await discardFiles(projectPath, files);
        const status = await readGitStatus(projectPath);
        options.broadcaster.publish("projects", "project.git.changed", status);
        return status;
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot discard changes.");
      }
    }
  );

  app.post<{ Body: Partial<GitCommitRequest> }>(
    "/api/git/commit",
    async (request, reply): Promise<GitStatusResponse | void> => {
      const path = request.body?.path;
      const message = request.body?.message?.trim();
      if (!path || !message) {
        return reply.code(400).send({ code: "INVALID_REQUEST", message: "path and a non-empty message are required." });
      }
      try {
        const projectPath = projectPathFor(options.workspacesDir, path);
        const status = await commitChanges(projectPath, message);
        options.broadcaster.publish("projects", "project.git.changed", status);
        return status;
      } catch (error) {
        return gitErrorReply(reply, error, "Cannot commit.");
      }
    }
  );
}
