import type { Rarity } from "../types";

export const RARITY_STYLE: Record<Rarity, { label: string; card: string; text: string }> = {
  common: { label: "Common", card: "border-white/15 bg-surface-2", text: "text-white/60" },
  rare: { label: "Rare", card: "border-sky-400/50 bg-sky-500/10", text: "text-sky-300" },
  epic: { label: "Epic", card: "border-violet-400/60 bg-violet-500/15", text: "text-violet-300" },
  legendary: { label: "Legendary", card: "border-amber-400/70 bg-amber-500/15", text: "text-amber-300" },
  mythic: { label: "MYTHIC", card: "border-fuchsia-400 bg-fuchsia-500/20 anim-glow", text: "text-fuchsia-300" },
};
