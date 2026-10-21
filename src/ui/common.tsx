import { useSyncExternalStore } from "react";
import type { Game } from "../game/game";
import type { Club } from "../state/types";

export function useGame(game: Game): number {
  return useSyncExternalStore(game.subscribe, game.getVersion, game.getVersion);
}

export function initials(name: string): string {
  const w = name.replace(/^FC\s+/i, "").split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0]![0]! + w[1]![0]! : (w[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function Crest({ club, lg }: { club: Club; lg?: boolean }) {
  return <div className={"crest" + (lg ? " lg" : "")} style={{ background: club.colors[0], color: club.colors[1], borderColor: club.colors[1] }}>{initials(club.name)}</div>;
}

export const CURSE_RULE: Record<string, string> = {
  equilibrium: "Every completed match ends level. You cannot win. You cannot lose.",
  fall: "Every completed match ends in defeat, however well you play.",
};

export const TABS = [["home", "⌂", "Home"], ["match", "⚽", "Match"], ["news", "✎", "News"], ["table", "≡", "Table"], ["career", "★", "Career"]] as const;
export type Tab = (typeof TABS)[number][0];
