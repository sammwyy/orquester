import React from "react";
import Astro from "./templates/astro.svg?react";
import Go from "./templates/go.svg?react";
import JavaScript from "./templates/javascript.svg?react";
import NextDotJs from "./templates/nextdotjs.svg?react";
import NodeDotJs from "./templates/nodedotjs.svg?react";
import Python from "./templates/python.svg?react";
import React_ from "./templates/react.svg?react";
import Rust from "./templates/rust.svg?react";
import Svelte from "./templates/svelte.svg?react";
import TypeScript from "./templates/typescript.svg?react";
import Vite from "./templates/vite.svg?react";
import VueDotJs from "./templates/vuejs.svg?react";

/**
 * Project-template icons. The daemon only ever sends an opaque id (e.g.
 * "vite") — it has no idea what a Vite logo looks like — so this is the
 * client-side registry mapping those ids to real brand SVG assets,
 * mirroring `getRegistryIcon`'s split between daemon data and client assets.
 */
const ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  vite: Vite,
  react: React_,
  vuejs: VueDotJs,
  svelte: Svelte,
  nextdotjs: NextDotJs,
  astro: Astro,
  javascript: JavaScript,
  typescript: TypeScript,
  nodedotjs: NodeDotJs,
  rust: Rust,
  python: Python,
  go: Go
};

export function getTemplateIcon(iconId: string | undefined, size: number | string = 16): React.ReactNode {
  const Icon = iconId ? ICONS[iconId] : undefined;
  if (!Icon) return null;
  return <Icon width={size} height={size} />;
}
