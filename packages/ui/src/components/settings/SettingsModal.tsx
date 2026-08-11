import React, { useState } from "react";
import {
  AppWindow,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Globe2,
  HardDrive,
  Palette,
  Server
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Modal, ModalCloseButton } from "../ui";
import { useIsDesktop } from "../../hooks";
import { useAppStore } from "../../store/app";
import {
  AccessSettings,
  AgentsSettings,
  AppearanceSettings,
  AppSettings,
  LocalAccessSettings,
  QuotaSettings,
  RemoteWorkersSettings,
  StorageSettings
} from "./tabs";

type Section =
  | "app"
  | "appearance"
  | "local-access"
  | "workers"
  | "storage"
  | "access"
  | "agents"
  | "quota";
/** Client settings live in this window; server settings belong to the daemon. */
type SectionGroup = "client" | "server";

const GROUPS: { id: SectionGroup; label: string }[] = [
  { id: "client", label: "Client" },
  { id: "server", label: "Server" }
];

const SECTIONS: {
  id: Section;
  group: SectionGroup;
  label: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
    {
      id: "app",
      group: "client",
      label: "App",
      icon: <AppWindow size={16} />,
      desc: "Window behaviour, runtime, active server"
    },
    {
      id: "appearance",
      group: "client",
      label: "Appearance",
      icon: <Palette size={16} />,
      desc: "Titlebar and sidebar look"
    },
    {
      id: "local-access",
      group: "client",
      label: "Local Access",
      icon: <Server size={16} />,
      desc: "Let other devices reach this worker"
    },
    {
      id: "workers",
      group: "client",
      label: "Remote Workers",
      icon: <Globe2 size={16} />,
      desc: "Connect to workers on other machines"
    },
    {
      id: "storage",
      group: "server",
      label: "Storage",
      icon: <HardDrive size={16} />,
      desc: "Workspace directory"
    },
    {
      id: "access",
      group: "server",
      label: "Access",
      icon: <Globe2 size={16} />,
      desc: "How the selected worker is reached"
    },
    {
      id: "agents",
      group: "server",
      label: "Agents",
      icon: <Boxes size={16} />,
      desc: "Install, update and view harness versions"
    },
    {
      id: "quota",
      group: "server",
      label: "Quota",
      icon: <Gauge size={16} />,
      desc: "Usage windows, limits and authentication"
    }
  ];

const sectionsOf = (group: SectionGroup) => SECTIONS.filter((s) => s.group === group);

const renderSection = (id: Section, onGoToLocalAccess?: () => void) =>
  id === "app" ? (
    <AppSettings />
  ) : id === "appearance" ? (
    <AppearanceSettings />
  ) : id === "local-access" ? (
    <LocalAccessSettings />
  ) : id === "workers" ? (
    <RemoteWorkersSettings />
  ) : id === "storage" ? (
    <StorageSettings />
  ) : id === "access" ? (
    <AccessSettings onGoToLocalAccess={onGoToLocalAccess} />
  ) : id === "quota" ? (
    <QuotaSettings />
  ) : (
    <AgentsSettings />
  );
const labelOf = (id: Section) => SECTIONS.find((s) => s.id === id)?.label ?? "";

export const SettingsModal: React.FC = () => {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const isDesktop = useIsDesktop();
  const [section, setSection] = useState<Section | null>(null);

  const close = () => setOpen(false);

  // --- Desktop: persistent side nav + content ---
  if (isDesktop) {
    const current = section ?? "app";
    return (
      <Modal open={open} onClose={close} className="h-[85vh] max-w-4xl">
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-neutral-800/70 bg-neutral-950/30 p-2">
          {GROUPS.map((group) => (
            <React.Fragment key={group.id}>
              <p className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-neutral-500 first:pt-1">
                {group.label}
              </p>
              {sectionsOf(group.id).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                    current === s.id
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-400 hover:bg-neutral-800/60"
                  )}
                >
                  <span className="text-neutral-500">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800/70 px-4">
            <span className="text-sm font-medium text-neutral-100">{labelOf(current)}</span>
            <ModalCloseButton onClose={close} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {renderSection(current, () => setSection("local-access"))}
          </div>
        </div>
      </Modal>
    );
  }

  // --- Mobile: category list → detail with a back button ---
  return (
    <Modal open={open} onClose={close} className="h-[88vh]">
      <div className="flex w-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-neutral-800/70 px-2">
          {section ? (
            <button
              type="button"
              aria-label="Back"
              onClick={() => setSection(null)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-neutral-800"
            >
              <ChevronLeft size={18} />
            </button>
          ) : (
            <span className="px-2" />
          )}
          <span className="flex-1 text-sm font-medium text-neutral-100">
            {section ? labelOf(section) : "Settings"}
          </span>
          <ModalCloseButton onClose={close} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {section === null ? (
            <div className="p-2">
              {GROUPS.map((group) => (
                <div key={group.id} className="mb-2 last:mb-0">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                    {group.label}
                  </p>
                  {sectionsOf(group.id).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSection(s.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-neutral-800/60"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-800 text-neutral-300">
                        {s.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-neutral-100">{s.label}</span>
                        <span className="block truncate text-xs text-neutral-500">{s.desc}</span>
                      </span>
                      <ChevronRight size={16} className="text-neutral-600" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4">{renderSection(section, () => setSection("local-access"))}</div>
          )}
        </div>
      </div>
    </Modal>
  );
};

/** iOS-style grouped list: a small caption over a rounded card of rows. */
