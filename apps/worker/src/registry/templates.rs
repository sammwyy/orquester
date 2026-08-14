//! Static catalog of project scaffold commands. Not "installed" tools like
//! shells/agents/IDEs — each variant's command gets typed into a fresh
//! terminal tab once the project directory exists, so the user sees it run
//! live and can answer any interactive prompts themselves instead of the
//! daemon trying to capture headless output from a command that expects a
//! TTY.
//!
//! `icon` is an opaque id (e.g. "vite", "react") — this side has no idea what
//! it looks like, the client owns a registry mapping ids to real brand marks.
//!
//! Flags below were checked against each CLI's own `--help` (not assumed) —
//! `create-vite@7`, `create-next-app@15`, `create-astro@5`, `sv@0.9` at the
//! time this was written. Scaffolders change their flags across major
//! versions; a flag going stale here just means it happens live in the
//! terminal in front of the user, same as any other failure.

pub struct ProjectTemplateOptionDef {
    pub id: &'static str,
    pub label: &'static str,
    pub flag_on: &'static str,
    pub flag_off: &'static str,
    pub default_on: bool,
}

pub struct ProjectTemplateVariantDef {
    pub id: &'static str,
    /// e.g. "React + TS" for the Vite template.
    pub name: &'static str,
    pub icon: &'static str,
    /// The base command, before any option flags are appended.
    pub command: &'static str,
    pub options: &'static [ProjectTemplateOptionDef],
}

pub struct ProjectTemplateDef {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub icon: &'static str,
    pub requires: &'static [&'static str],
    pub variants: &'static [ProjectTemplateVariantDef],
}

const NO_OPTIONS: &[ProjectTemplateOptionDef] = &[];

const VITE_INSTALL: ProjectTemplateOptionDef = ProjectTemplateOptionDef {
    id: "install",
    label: "Install dependencies and start dev server",
    flag_on: "--immediate",
    flag_off: "--no-immediate",
    default_on: true,
};
const VITE_ESLINT: ProjectTemplateOptionDef = ProjectTemplateOptionDef {
    id: "eslint",
    label: "Use ESLint instead of Oxlint",
    flag_on: "--eslint",
    flag_off: "--no-eslint",
    default_on: false,
};
const VITE_REACT_OPTIONS: &[ProjectTemplateOptionDef] = &[VITE_INSTALL, VITE_ESLINT];
const VITE_OPTIONS: &[ProjectTemplateOptionDef] = &[VITE_INSTALL];

const VITE_VARIANTS: &[ProjectTemplateVariantDef] = &[
    ProjectTemplateVariantDef {
        id: "react",
        name: "React",
        icon: "react",
        command: "npm create vite@latest . -- --template react",
        options: VITE_REACT_OPTIONS,
    },
    ProjectTemplateVariantDef {
        id: "react-ts",
        name: "React + TS",
        icon: "typescript",
        command: "npm create vite@latest . -- --template react-ts",
        options: VITE_REACT_OPTIONS,
    },
    ProjectTemplateVariantDef {
        id: "vue",
        name: "Vue",
        icon: "vuejs",
        command: "npm create vite@latest . -- --template vue",
        options: VITE_OPTIONS,
    },
    ProjectTemplateVariantDef {
        id: "vue-ts",
        name: "Vue + TS",
        icon: "typescript",
        command: "npm create vite@latest . -- --template vue-ts",
        options: VITE_OPTIONS,
    },
    ProjectTemplateVariantDef {
        id: "svelte",
        name: "Svelte",
        icon: "svelte",
        command: "npm create vite@latest . -- --template svelte",
        options: VITE_OPTIONS,
    },
    ProjectTemplateVariantDef {
        id: "svelte-ts",
        name: "Svelte + TS",
        icon: "typescript",
        command: "npm create vite@latest . -- --template svelte-ts",
        options: VITE_OPTIONS,
    },
    ProjectTemplateVariantDef {
        id: "vanilla",
        name: "Vanilla",
        icon: "javascript",
        command: "npm create vite@latest . -- --template vanilla",
        options: VITE_OPTIONS,
    },
    ProjectTemplateVariantDef {
        id: "vanilla-ts",
        name: "Vanilla + TS",
        icon: "typescript",
        command: "npm create vite@latest . -- --template vanilla-ts",
        options: VITE_OPTIONS,
    },
];

const NEXT_INSTALL: &[ProjectTemplateOptionDef] = &[ProjectTemplateOptionDef {
    id: "install",
    label: "Install dependencies",
    flag_on: "",
    flag_off: "--skip-install",
    default_on: true,
}];

const NEXT_VARIANTS: &[ProjectTemplateVariantDef] = &[
    ProjectTemplateVariantDef {
        id: "ts",
        name: "TypeScript",
        icon: "typescript",
        command: "npx create-next-app@latest . --typescript --eslint --tailwind --app --src-dir --import-alias \"@/*\" --use-npm",
        options: NEXT_INSTALL,
    },
    ProjectTemplateVariantDef {
        id: "js",
        name: "JavaScript",
        icon: "javascript",
        command: "npx create-next-app@latest . --javascript --eslint --tailwind --app --src-dir --import-alias \"@/*\" --use-npm",
        options: NEXT_INSTALL,
    },
];

const ASTRO_INSTALL: &[ProjectTemplateOptionDef] = &[ProjectTemplateOptionDef {
    id: "install",
    label: "Install dependencies",
    flag_on: "--install",
    flag_off: "--no-install",
    default_on: true,
}];

const ASTRO_VARIANTS: &[ProjectTemplateVariantDef] = &[
    ProjectTemplateVariantDef {
        id: "minimal",
        name: "Minimal",
        icon: "astro",
        command: "npm create astro@latest . -- --template minimal --yes",
        options: ASTRO_INSTALL,
    },
    ProjectTemplateVariantDef {
        id: "blog",
        name: "Blog",
        icon: "astro",
        command: "npm create astro@latest . -- --template blog --yes",
        options: ASTRO_INSTALL,
    },
];

const SVELTEKIT_INSTALL: &[ProjectTemplateOptionDef] = &[ProjectTemplateOptionDef {
    id: "install",
    label: "Install dependencies",
    flag_on: "--install npm",
    flag_off: "--no-install",
    default_on: true,
}];

const SVELTEKIT_VARIANTS: &[ProjectTemplateVariantDef] = &[
    ProjectTemplateVariantDef {
        id: "ts",
        name: "TypeScript",
        icon: "typescript",
        command: "npx sv create . --template minimal --types ts --no-add-ons",
        options: SVELTEKIT_INSTALL,
    },
    ProjectTemplateVariantDef {
        id: "js",
        name: "JavaScript",
        icon: "javascript",
        command: "npx sv create . --template minimal --no-types --no-add-ons",
        options: SVELTEKIT_INSTALL,
    },
];

const DEFAULT_VARIANT_NODE: &[ProjectTemplateVariantDef] =
    &[ProjectTemplateVariantDef { id: "default", name: "Default", icon: "nodedotjs", command: "npm init -y", options: NO_OPTIONS }];
const DEFAULT_VARIANT_CARGO: &[ProjectTemplateVariantDef] =
    &[ProjectTemplateVariantDef { id: "default", name: "Default", icon: "rust", command: "cargo init .", options: NO_OPTIONS }];
const DEFAULT_VARIANT_UV: &[ProjectTemplateVariantDef] =
    &[ProjectTemplateVariantDef { id: "default", name: "Default", icon: "python", command: "uv init .", options: NO_OPTIONS }];
const DEFAULT_VARIANT_GO: &[ProjectTemplateVariantDef] = &[ProjectTemplateVariantDef {
    id: "default",
    name: "Default",
    icon: "go",
    command: "go mod init project",
    options: NO_OPTIONS,
}];

pub const TEMPLATES: &[ProjectTemplateDef] = &[
    ProjectTemplateDef { id: "vite", name: "Vite", category: "Frontend", icon: "vite", requires: &["npm"], variants: VITE_VARIANTS },
    ProjectTemplateDef {
        id: "next",
        name: "Next.js",
        category: "Frontend",
        icon: "nextdotjs",
        requires: &["npx"],
        variants: NEXT_VARIANTS,
    },
    ProjectTemplateDef {
        id: "astro",
        name: "Astro",
        category: "Frontend",
        icon: "astro",
        requires: &["npm"],
        variants: ASTRO_VARIANTS,
    },
    ProjectTemplateDef {
        id: "svelte",
        name: "SvelteKit",
        category: "Frontend",
        icon: "svelte",
        requires: &["npx"],
        variants: SVELTEKIT_VARIANTS,
    },
    ProjectTemplateDef {
        id: "node",
        name: "Node.js",
        category: "Backend",
        icon: "nodedotjs",
        requires: &["npm"],
        variants: DEFAULT_VARIANT_NODE,
    },
    ProjectTemplateDef {
        id: "cargo",
        name: "Rust",
        category: "Systems",
        icon: "rust",
        requires: &["cargo"],
        variants: DEFAULT_VARIANT_CARGO,
    },
    ProjectTemplateDef {
        id: "python-uv",
        name: "Python (uv)",
        category: "Backend",
        icon: "python",
        requires: &["uv"],
        variants: DEFAULT_VARIANT_UV,
    },
    ProjectTemplateDef { id: "go", name: "Go", category: "Systems", icon: "go", requires: &["go"], variants: DEFAULT_VARIANT_GO },
];
