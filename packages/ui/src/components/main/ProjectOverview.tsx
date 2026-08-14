import React, { useEffect, useState } from "react";
import { MessagesSquare, Plus } from "lucide-react";
import type { AgentConversationSummary } from "@orquester/api";
import { getRegistryIcon } from "../../icons";
import { useRegistry } from "../../hooks";
import { useAppStore } from "../../store/app";

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const units: [number, string][] = [
    [60, "m"],
    [24, "h"],
    [7, "d"],
    [4.345, "w"],
    [12, "mo"],
    [Number.POSITIVE_INFINITY, "y"]
  ];
  let value = seconds / 60;
  for (const [span, unit] of units) {
    if (value < span) return `${Math.floor(value)}${unit} ago`;
    value /= span;
  }
  return "";
};

const SkeletonRow: React.FC = () => (
  <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
    <div className="h-7 w-7 shrink-0 animate-pulse rounded-lg bg-neutral-800/70" />
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="h-3 w-2/5 animate-pulse rounded bg-neutral-800/70" />
      <div className="h-2.5 w-1/5 animate-pulse rounded bg-neutral-800/50" />
    </div>
  </div>
);

/**
 * Shown instead of a bare "no tabs open" message when a project has none —
 * every installed agent's past conversations for this project, newest
 * first, one click away from resuming. Fetched once and cached in the
 * store (see loadAgentConversations); a manual refresh bypasses the cache.
 */
export const ProjectOverview: React.FC<{ rootPath: string }> = ({ rootPath }) => {
  const registry = useRegistry();
  const loadAgentConversations = useAppStore((s) => s.loadAgentConversations);
  const openTab = useAppStore((s) => s.openTab);
  const [conversations, setConversations] = useState<AgentConversationSummary[] | null>(null);

  useEffect(() => {
    let active = true;
    setConversations(null);
    void loadAgentConversations(rootPath).then((result) => {
      if (active) setConversations(result);
    });
    return () => {
      active = false;
    };
  }, [rootPath, loadAgentConversations]);

  const agentName = (refId: string) => registry.agents.find((a) => a.id === refId)?.name ?? refId;

  const resume = (conversation: AgentConversationSummary) => {
    void openTab("agent", conversation.agentRefId, agentName(conversation.agentRefId), { resumeConversationId: conversation.id });
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl min-h-0 flex-col px-6 py-8">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-200">Recent conversations</p>
          <p className="text-xs text-neutral-600">Pick one up where you left off, or use the "+" button to start something new.</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {conversations === null && Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} />)}

        {conversations !== null && conversations.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
            <MessagesSquare size={32} strokeWidth={1.25} className="text-neutral-700" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-neutral-300">No conversations yet</p>
              <p className="max-w-sm text-xs text-neutral-600">Start one with the "+" button in the top bar.</p>
            </div>
          </div>
        )}

        {conversations?.map((conversation) => (
          <button
            key={`${conversation.agentRefId}:${conversation.id}`}
            type="button"
            onClick={() => resume(conversation)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-neutral-900"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-neutral-400">
              {getRegistryIcon("agent", conversation.agentRefId, 15)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-neutral-200">{conversation.title}</span>
              <span className="block text-[11px] text-neutral-600">{agentName(conversation.agentRefId)}</span>
            </span>
            <span className="shrink-0 text-[11px] text-neutral-600">{formatRelative(conversation.updatedAt)}</span>
          </button>
        ))}
      </div>

      {registry.agents.some((a) => a.enabled) && (
        <div className="mt-4 flex shrink-0 flex-wrap gap-1.5 border-t border-neutral-900 pt-4">
          {registry.agents
            .filter((a) => a.enabled)
            .map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => void openTab("agent", agent.id, agent.name)}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-800 px-2.5 py-1.5 text-[12px] text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-200"
              >
                <Plus size={12} />
                {getRegistryIcon("agent", agent.id, 13)}
                {agent.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};
