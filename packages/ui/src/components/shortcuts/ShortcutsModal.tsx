import React from "react";
import { Modal, ModalCloseButton } from "../ui";
import { useAppStore } from "../../store/app";

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutEntry[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "Global",
    items: [
      { keys: ["Ctrl", "K"], description: "Open the command palette to jump to a project" },
      { keys: ["Ctrl", "Shift", "A"], description: "Jump to the next session that needs attention" },
      { keys: ["Ctrl", "Shift", "S"], description: "Toggle the sidebar" },
      { keys: ["Ctrl", "Shift", "O"], description: "Open settings" },
      { keys: ["F1"], description: "Open this shortcuts menu" }
    ]
  },
  {
    title: "File Browser",
    items: [
      { keys: ["F2"], description: "Rename the selected entry" },
      { keys: ["Ctrl", "C"], description: "Copy the selected entry" },
      { keys: ["Ctrl", "X"], description: "Cut the selected entry" },
      { keys: ["Ctrl", "V"], description: "Paste into the current folder" },
      { keys: ["Delete"], description: "Delete the selected entry" }
    ]
  },
  {
    title: "Editor",
    items: [
      { keys: ["Ctrl", "S"], description: "Save the open file" },
      { keys: ["Ctrl", "F"], description: "Find in file" },
      { keys: ["Ctrl", "H"], description: "Find and replace in file" }
    ]
  }
];

const Kbd: React.FC<{ keys: string[] }> = ({ keys }) => (
  <span className="flex shrink-0 items-center gap-1">
    {keys.map((key, index) => (
      <React.Fragment key={key}>
        {index > 0 && <span className="text-neutral-600">+</span>}
        <kbd className="rounded-md border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">
          {key}
        </kbd>
      </React.Fragment>
    ))}
  </span>
);

export const ShortcutsModal: React.FC = () => {
  const open = useAppStore((state) => state.shortcutsOpen);
  const setOpen = useAppStore((state) => state.setShortcutsOpen);

  return (
    <Modal open={open} onClose={() => setOpen(false)} className="h-fit max-h-[80vh] w-full max-w-md flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800/70 px-4">
        <span className="text-sm font-medium text-neutral-100">Keyboard Shortcuts</span>
        <ModalCloseButton onClose={() => setOpen(false)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {GROUPS.map((group) => (
          <div key={group.title} className="mb-4 last:mb-0">
            <p className="mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">{group.title}</p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <div key={item.description} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-neutral-800/40">
                  <span className="text-[12.5px] text-neutral-300">{item.description}</span>
                  <Kbd keys={item.keys} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
};
