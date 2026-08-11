import React from "react";
import { CircleCheck, Code2, FileText } from "lucide-react";
import { registerStatusModule } from "./registry";

const ReadyContent: React.FC = () => (
  <>
    <p className="text-xs font-medium">Everything is up to date.</p>
    <p className="mt-1 text-[10px] text-sky-200/60">No background tasks running.</p>
  </>
);

const MarkdownContent: React.FC = () => (
  <>
    <p className="text-xs font-medium">Markdown</p>
    <p className="mt-1 text-[10px] text-neutral-400">Plain text document</p>
  </>
);

const EncodingContent: React.FC = () => (
  <>
    <p className="text-xs font-medium">UTF-8</p>
    <p className="mt-1 text-[10px] text-sky-200/60">Unicode text encoding</p>
  </>
);

registerStatusModule({
  id: "demo.ready",
  label: "Ready",
  side: "left",
  tone: "blue",
  icon: <CircleCheck size={12} />,
  content: ReadyContent
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
  tone: "blue",
  icon: <Code2 size={12} />,
  content: EncodingContent
});
