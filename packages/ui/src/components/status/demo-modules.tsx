import React from "react";
import { Code2, FileDiff, FileText, GitBranch, GitBranchPlus, GitCommitHorizontal } from "lucide-react";
import { registerStatusModule } from "./registry";
import { useAppStore } from "../../store/app";

const GitLabel: React.FC = () => {
  const status = useAppStore((state) => state.gitStatus);
  return (
    <>
      <span>{status?.branch ?? "Git"}</span>
      {status && (status.additions > 0 || status.deletions > 0) && (
        <span>(+{status.additions} -{status.deletions})</span>
      )}
    </>
  );
};

const GitContent: React.FC = () => {
  const status = useAppStore((state) => state.gitStatus);
  const loading = useAppStore((state) => state.gitStatusLoading);
  const initializeGit = useAppStore((state) => state.initializeGit);
  const [tab, setTab] = React.useState<"origin" | "commits" | "files">("origin");
  if (!status) {
    return (
      <div className="min-w-64">
        <p className="text-xs font-medium">No Git repository</p>
        <p className="mt-1 text-[10px] text-current/60">Initialize this project to start tracking changes.</p>
        <button
          type="button"
          className="mt-3 flex items-center gap-1.5 rounded-md border border-current/15 px-2 py-1.5 text-[10px] text-current/80 hover:bg-current/10 hover:text-current disabled:opacity-50"
          disabled={loading}
          onClick={() => void initializeGit()}
        >
          <GitBranchPlus size={12} />
          {loading ? "Initializing…" : "Initialize repository"}
        </button>
      </div>
    );
  }
  return (
    <div className="min-w-64">
      <div className="mb-2 flex gap-1 border-b border-white/10 pb-1">
        {(["origin", "commits", "files"] as const).map((item) => (
          <button key={item} type="button" className="rounded px-1.5 py-1 text-[10px] capitalize text-current/70 hover:bg-white/10 hover:text-current" onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>
      {tab === "origin" && <p className="max-w-72 break-all text-[11px]">{status.origin ?? "No origin configured"}</p>}
      {tab === "commits" && <div className="space-y-1.5">{status.commits.map((commit) => <div key={commit.hash} className="flex gap-1.5 text-[10px]"><GitCommitHorizontal size={12} className="mt-0.5 shrink-0" /><span className="truncate">{commit.subject}</span></div>)}</div>}
      {tab === "files" && <div className="space-y-1.5">{status.files.length === 0 ? <p className="text-[10px] opacity-60">Working tree clean</p> : status.files.map((file) => <div key={`${file.status}-${file.path}`} className="flex gap-1.5 text-[10px]"><FileDiff size={12} className="mt-0.5 shrink-0" /><span className="truncate">{file.status} {file.path}</span></div>)}</div>}
    </div>
  );
};

const MarkdownContent: React.FC = () => (
  <>
    <p className="text-xs font-medium">Markdown</p>
    <p className="mt-1 text-[10px] text-neutral-400">Plain text document</p>
  </>
);

const EncodingContent: React.FC = () => (
  <>
    <p className="text-xs font-medium">UTF-8</p>
    <p className="mt-1 text-[10px] text-current/60">Unicode text encoding</p>
  </>
);

registerStatusModule({
  id: "project.git",
  label: <GitLabel />,
  side: "left",
  icon: <GitBranch size={12} />,
  enabledOn: ["project"],
  content: GitContent
});

registerStatusModule({
  id: "demo.markdown",
  label: "Markdown",
  side: "right",
  icon: <FileText size={12} />,
  content: MarkdownContent
});

registerStatusModule({
  id: "demo.encoding",
  label: "UTF-8",
  side: "right",
  icon: <Code2 size={12} />,
  content: EncodingContent
});
