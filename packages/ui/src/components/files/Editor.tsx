import React, { useEffect, useRef, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { LanguageDescription } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

export interface EditorProps {
  filename: string;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave?: () => void;
  line?: number | null;
}

// Reads the app's theme CSS variables (packages/ui/src/styles/globals.css) rather than
// hardcoding a palette, so the editor's background always matches `bg-neutral-950` (and
// the active file tab) regardless of which colour scheme/mode is active — the same
// approach xterm uses via --term-*, since neither can consume Tailwind classes.
const editorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "rgb(var(--n-950))",
      color: "rgb(var(--n-300))",
      fontSize: "13px"
    },
    ".cm-editor": {
      height: "100%",
      backgroundColor: "rgb(var(--n-950))",
      outline: "none"
    },
    ".cm-editor.cm-focused": {
      outline: "none"
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      lineHeight: "1.55",
      overflow: "auto"
    },
    ".cm-content": {
      minHeight: "100%",
      padding: "10px 12px 20px"
    },
    ".cm-line": {
      padding: "0 2px"
    },
    ".cm-gutters": {
      backgroundColor: "rgb(var(--n-950))",
      border: "none",
      color: "rgb(var(--n-600))",
      paddingLeft: "8px",
      paddingRight: "6px"
    },
    ".cm-activeLine": {
      backgroundColor: "rgb(var(--n-900))"
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgb(var(--n-900))",
      color: "rgb(var(--n-400))"
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "rgb(var(--n-700)) !important"
    },
    ".cm-cursor": {
      borderLeftColor: "rgb(var(--n-200))"
    },
    ".cm-tooltip": {
      backgroundColor: "rgb(var(--n-900))",
      border: "1px solid rgb(var(--n-800))",
      color: "rgb(var(--n-300))"
    }
  },
  { dark: true }
);

/** CodeMirror 6 editor with syntax highlighting (language inferred from name). */
export const Editor: React.FC<EditorProps> = ({ filename, value, readOnly, onChange, onSave, line }) => {
  const [langExtension, setLangExtension] = useState<Extension[]>([]);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    let active = true;
    const description = LanguageDescription.matchFilename(languages, filename);
    if (!description) {
      setLangExtension([]);
      return;
    }
    description
      .load()
      .then((support) => {
        if (active) {
          setLangExtension([support]);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [filename]);

  useEffect(() => {
    if (!viewRef.current || !line || line < 1) return;
    const target = Math.min(line, viewRef.current.state.doc.lines);
    const position = viewRef.current.state.doc.line(target).from;
    viewRef.current.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) });
  }, [line]);

  return (
    <div
      className="h-full min-h-0 overflow-hidden text-[13px]"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          onSave?.();
        }
      }}
    >
      <CodeMirror
        value={value}
        height="100%"
        style={{ height: "100%" }}
        theme="none"
        readOnly={readOnly}
        editable={!readOnly}
        extensions={[editorTheme, syntaxHighlighting(defaultHighlightStyle), ...langExtension]}
        onCreateEditor={(view) => { viewRef.current = view; }}
        onChange={onChange}
        basicSetup={{
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          foldGutter: true,
          lineNumbers: true,
          autocompletion: true
        }}
      />
    </div>
  );
};
