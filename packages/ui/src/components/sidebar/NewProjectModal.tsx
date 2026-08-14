import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, GitBranch, LoaderCircle, Search } from "lucide-react";
import type { ProjectTemplateSummary, ProjectTemplateVariantSummary } from "@orquester/api";
import { cn } from "../../lib/cn";
import { Button, Input, Modal, ModalCloseButton, SegmentedControl, Switch } from "../ui";
import { getTemplateIcon } from "../../icons";
import { useAppStore } from "../../store/app";

type Tab = "blank" | "git" | "template";
type TemplateStep = "browse" | "variant" | "review";

/** Derives a project-directory-safe name from the last path segment of a git URL. */
function nameFromRepoUrl(url: string): string {
  const trimmed = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const last = trimmed.split(/[/:]/).pop() ?? "";
  return last.replace(/[^a-zA-Z0-9._-]/g, "-");
}

const CategoryChip: React.FC<{ label: string; selected: boolean; onClick: () => void }> = ({ label, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "rounded-full border px-2.5 py-1 text-xs transition-colors",
      selected
        ? "border-neutral-500 bg-neutral-700 text-neutral-100"
        : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
    )}
  >
    {label}
  </button>
);

const TemplateCard: React.FC<{
  name: string;
  iconId: string;
  subtitle?: string;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}> = ({ name, iconId, subtitle, disabled, disabledReason, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    title={disabledReason}
    className={cn(
      "flex flex-col items-center gap-2 rounded-xl border border-neutral-800 px-2 py-4 text-center transition-colors",
      disabled ? "cursor-not-allowed opacity-40" : "hover:border-neutral-600 hover:bg-neutral-800/40"
    )}
  >
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-800/80">
      {getTemplateIcon(iconId, 22)}
    </span>
    <span className="text-sm text-neutral-100">{name}</span>
    {subtitle && <span className="text-[11px] text-neutral-500">{subtitle}</span>}
  </button>
);

/**
 * Blank creates a directory only; Git and Template both create the directory
 * then run their command live in a fresh terminal tab, so the user sees it
 * happen and can answer any interactive prompts themselves. Template is a
 * three-step flow (browse -> pick a variant when there's more than one ->
 * review the exact assembled command) so nothing runs as a surprise.
 */
export const NewProjectModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const createProject = useAppStore((s) => s.createProject);
  const createProjectWithCommand = useAppStore((s) => s.createProjectWithCommand);
  const loadProjectTemplates = useAppStore((s) => s.loadProjectTemplates);
  const templates = useAppStore((s) => s.projectTemplates);
  const templatesLoaded = useAppStore((s) => s.projectTemplatesLoaded);

  const [tab, setTab] = useState<Tab>("blank");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [templateStep, setTemplateStep] = useState<TemplateStep>("browse");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [optionOverrides, setOptionOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setTab("blank");
    setName("");
    setNameTouched(false);
    setRepoUrl("");
    setBusy(false);
    setError(null);
    setTemplateStep("browse");
    setSearch("");
    setCategory("all");
    setTemplateId(null);
    setVariantId(null);
    setOptionOverrides({});
  }, [open]);

  useEffect(() => {
    if (open && tab === "template") void loadProjectTemplates();
  }, [open, tab, loadProjectTemplates]);

  const categories = useMemo(() => Array.from(new Set(templates.map((t) => t.category))).sort(), [templates]);

  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (category !== "all" && t.category !== category) return false;
      if (!query) return true;
      return (
        t.name.toLowerCase().includes(query) ||
        t.category.toLowerCase().includes(query) ||
        t.variants.some((v) => v.name.toLowerCase().includes(query))
      );
    });
  }, [templates, search, category]);

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;
  const selectedVariant = selectedTemplate?.variants.find((v) => v.id === variantId) ?? null;

  const assembledCommand = useMemo(() => {
    if (!selectedVariant) return "";
    const flags = selectedVariant.options.map((opt) => (optionOverrides[opt.id] ?? opt.defaultOn) ? opt.flagOn : opt.flagOff).filter(Boolean);
    return [selectedVariant.command, ...flags].join(" ");
  }, [selectedVariant, optionOverrides]);

  const pickTemplate = (template: ProjectTemplateSummary) => {
    if (!template.available || template.variants.length === 0) return;
    setTemplateId(template.id);
    setOptionOverrides({});
    if (template.variants.length > 1) {
      setTemplateStep("variant");
    } else {
      setVariantId(template.variants[0]?.id ?? null);
      setTemplateStep("review");
    }
  };

  const pickVariant = (variant: ProjectTemplateVariantSummary) => {
    setVariantId(variant.id);
    setOptionOverrides({});
    setTemplateStep("review");
  };

  const goBack = () => {
    if (templateStep === "review") {
      setTemplateStep(selectedTemplate && selectedTemplate.variants.length > 1 ? "variant" : "browse");
    } else if (templateStep === "variant") {
      setTemplateStep("browse");
      setTemplateId(null);
    }
  };

  const canSubmit =
    tab === "blank"
      ? name.trim().length > 0
      : tab === "git"
        ? repoUrl.trim().length > 0 && name.trim().length > 0
        : templateStep === "review" && name.trim().length > 0 && !!selectedVariant;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (tab === "blank") {
        await createProject(name.trim());
      } else if (tab === "git") {
        await createProjectWithCommand(name.trim(), `git clone ${repoUrl.trim()} .`);
      } else if (selectedVariant) {
        await createProjectWithCommand(name.trim(), assembledCommand);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the project.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      className={tab === "template" && templateStep !== "review" ? "max-h-[78vh] max-w-2xl" : "max-w-md"}
    >

      <div className="flex w-full flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800/70 px-4">
          <span className="text-sm font-medium text-neutral-100">New Project</span>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <SegmentedControl
            value={tab}
            onChange={(next) => {
              setTab(next);
              setTemplateStep("browse");
            }}
            block
            options={[
              { id: "blank", label: "Blank" },
              { id: "git", label: "Git Repository" },
              { id: "template", label: "Template" }
            ]}
          />

          {tab === "blank" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-400">Project name</span>
              <Input
                autoFocus
                placeholder="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}

          {tab === "git" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-400">Repository URL</span>
                <Input
                  autoFocus
                  placeholder="https://github.com/user/repo.git"
                  value={repoUrl}
                  onChange={(e) => {
                    const value = e.target.value;
                    setRepoUrl(value);
                    if (!nameTouched) setName(nameFromRepoUrl(value));
                  }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-400">Project name</span>
                <Input
                  placeholder="project-name"
                  value={name}
                  onChange={(e) => {
                    setNameTouched(true);
                    setName(e.target.value);
                  }}
                />
              </label>
            </>
          )}

          {tab === "template" && templateStep === "browse" && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                <Input
                  autoFocus
                  placeholder="Search templates…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>

              {categories.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <CategoryChip label="All" selected={category === "all"} onClick={() => setCategory("all")} />
                  {categories.map((c) => (
                    <CategoryChip key={c} label={c} selected={category === c} onClick={() => setCategory(c)} />
                  ))}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto">
                {!templatesLoaded && (
                  <div className="flex items-center gap-2 px-1 py-3 text-xs text-neutral-500">
                    <LoaderCircle size={13} className="animate-spin" /> Loading templates…
                  </div>
                )}
                {templatesLoaded && filteredTemplates.length === 0 && (
                  <p className="px-1 py-3 text-xs text-neutral-600">No templates match.</p>
                )}
                {templatesLoaded && filteredTemplates.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {filteredTemplates.map((template) => (
                      <TemplateCard
                        key={template.id}
                        name={template.name}
                        iconId={template.icon}
                        subtitle={template.variants.length > 1 ? `${template.variants.length} variants` : undefined}
                        disabled={!template.available}
                        disabledReason={!template.available ? `Requires ${template.requires.join(", ")} on PATH` : undefined}
                        onClick={() => pickTemplate(template)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "template" && templateStep === "variant" && selectedTemplate && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1.5 self-start text-xs text-neutral-400 transition-colors hover:text-neutral-200"
              >
                <ArrowLeft size={12} /> Back to templates
              </button>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-800/80">
                  {getTemplateIcon(selectedTemplate.icon, 16)}
                </span>
                <span className="text-sm text-neutral-200">{selectedTemplate.name} — choose a flavor</span>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {selectedTemplate.variants.map((variant) => (
                  <TemplateCard
                    key={variant.id}
                    name={variant.name}
                    iconId={variant.icon}
                    onClick={() => pickVariant(variant)}
                  />
                ))}
              </div>
            </div>
          )}

          {tab === "template" && templateStep === "review" && selectedTemplate && selectedVariant && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1.5 self-start text-xs text-neutral-400 transition-colors hover:text-neutral-200"
              >
                <ArrowLeft size={12} /> Back
              </button>
              <div className="flex items-center gap-2 rounded-xl border border-neutral-800 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-800/80">
                  {getTemplateIcon(selectedVariant.icon, 18)}
                </span>
                <span className="min-w-0 flex-1 text-sm text-neutral-100">
                  {selectedTemplate.name}
                  {selectedVariant.name !== "Default" && <span className="text-neutral-400"> · {selectedVariant.name}</span>}
                </span>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-400">Project name</span>
                <Input autoFocus placeholder="project-name" value={name} onChange={(e) => setName(e.target.value)} />
              </label>

              {selectedVariant.options.length > 0 && (
                <div className="flex flex-col gap-2">
                  {selectedVariant.options.map((opt) => (
                    <label key={opt.id} className="flex items-center justify-between gap-3 text-sm text-neutral-300">
                      <span className="min-w-0 flex-1">{opt.label}</span>
                      <Switch
                        checked={optionOverrides[opt.id] ?? opt.defaultOn}
                        onChange={(checked) => setOptionOverrides((prev) => ({ ...prev, [opt.id]: checked }))}
                        label={opt.label}
                      />
                    </label>
                  ))}
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-400">Command</span>
                <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-300">
                  <code>{assembledCommand}</code>
                </pre>
              </label>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-800/70 px-4 py-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {(tab !== "template" || templateStep === "review") && (
            <Button onClick={() => void submit()} disabled={!canSubmit || busy}>
              {busy ? <LoaderCircle size={14} className="animate-spin" /> : tab === "git" ? <GitBranch size={14} /> : null}
              Create
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
