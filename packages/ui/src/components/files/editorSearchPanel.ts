import { EditorView, StateEffect, StateField, type Extension, type Panel, type ViewUpdate } from "@uiw/react-codemirror";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  setSearchQuery
} from "@codemirror/search";

export type SearchBarMode = "find" | "replace";

const setSearchMode = StateEffect.define<SearchBarMode>();

const searchMode = StateField.define<SearchBarMode>({
  create: () => "find",
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchMode)) value = effect.value;
    }
    return value;
  }
});

function buildInput(placeholder: string, value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "orq-search-input";
  input.placeholder = placeholder;
  input.value = value;
  input.spellcheck = false;
  return input;
}

function buildButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "orq-search-btn";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

class EditorSearchPanel implements Panel {
  dom: HTMLElement;
  top = true;

  private view: EditorView;
  private query: SearchQuery;
  private findInput: HTMLInputElement;
  private replaceInput: HTMLInputElement;
  private replaceRow: HTMLElement;

  constructor(view: EditorView) {
    this.view = view;
    this.query = getSearchQuery(view.state);

    this.findInput = buildInput("Find", this.query.search);
    this.findInput.setAttribute("main-field", "true");
    this.findInput.addEventListener("input", () => this.commit());
    this.findInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        (event.shiftKey ? findPrevious : findNext)(this.view);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSearchPanel(this.view);
      }
    });

    this.replaceInput = buildInput("Replace", this.query.replace);
    this.replaceInput.addEventListener("input", () => this.commit());
    this.replaceInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        replaceNext(this.view);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSearchPanel(this.view);
      }
    });

    const findRow = document.createElement("div");
    findRow.className = "orq-search-row";
    findRow.append(
      this.findInput,
      buildButton("↑", "Previous match", () => findPrevious(this.view)),
      buildButton("↓", "Next match", () => findNext(this.view)),
      buildButton("×", "Close", () => closeSearchPanel(this.view))
    );

    this.replaceRow = document.createElement("div");
    this.replaceRow.className = "orq-search-row";
    this.replaceRow.append(
      this.replaceInput,
      buildButton("Replace", "Replace this match", () => replaceNext(this.view)),
      buildButton("All", "Replace all matches", () => replaceAll(this.view))
    );

    this.dom = document.createElement("div");
    this.dom.className = "orq-search-panel";
    this.dom.append(findRow, this.replaceRow);
    this.setMode(view.state.field(searchMode));
  }

  private commit() {
    const query = new SearchQuery({ search: this.findInput.value, replace: this.replaceInput.value });
    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
  }

  private setMode(mode: SearchBarMode) {
    this.replaceRow.style.display = mode === "replace" ? "flex" : "none";
  }

  mount() {
    this.findInput.focus();
    this.findInput.select();
  }

  update(update: ViewUpdate) {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.query = effect.value;
          this.findInput.value = this.query.search;
          this.replaceInput.value = this.query.replace;
        }
        if (effect.is(setSearchMode)) {
          this.setMode(effect.value);
        }
      }
    }
  }
}

const searchPanelTheme = EditorView.baseTheme({
  ".orq-search-panel": {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "6px 8px",
    borderBottom: "1px solid rgb(var(--n-800))",
    backgroundColor: "rgb(var(--n-900))"
  },
  ".orq-search-row": {
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  ".orq-search-input": {
    flex: "1",
    minWidth: "0",
    fontSize: "12px",
    padding: "3px 6px",
    borderRadius: "6px",
    border: "1px solid rgb(var(--n-800))",
    backgroundColor: "rgb(var(--n-950))",
    color: "rgb(var(--n-200))",
    outline: "none"
  },
  ".orq-search-input:focus": {
    borderColor: "rgb(var(--n-600))"
  },
  ".orq-search-btn": {
    flexShrink: "0",
    fontSize: "11px",
    padding: "3px 7px",
    borderRadius: "6px",
    border: "1px solid rgb(var(--n-800))",
    backgroundColor: "rgb(var(--n-800))",
    color: "rgb(var(--n-300))",
    cursor: "pointer"
  },
  ".orq-search-btn:hover": {
    backgroundColor: "rgb(var(--n-700))"
  }
});

export const editorSearchExtension: Extension = [searchMode, search({ top: true, createPanel: (view) => new EditorSearchPanel(view) }), searchPanelTheme];

function openBar(view: EditorView | null, mode: SearchBarMode) {
  if (!view) return;
  view.dispatch({ effects: setSearchMode.of(mode) });
  openSearchPanel(view);
}

export const openFindBar = (view: EditorView | null) => openBar(view, "find");
export const openReplaceBar = (view: EditorView | null) => openBar(view, "replace");
