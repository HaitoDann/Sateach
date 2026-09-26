import type { Domain, Slot } from "./types";

/** The 8 domains seeded in every new vault, with their default color and the
 *  indicative weekly volume of cycle 2 (24h). Everything stays editable. */
export const DEFAULT_DOMAINS: { name: string; color: string; target_minutes: number }[] = [
  { name: "Français", color: "#e5484d", target_minutes: 600 },
  { name: "Mathématiques", color: "#3b82f6", target_minutes: 300 },
  { name: "Questionner le monde", color: "#2f9e5a", target_minutes: 120 },
  { name: "EPS", color: "#f08c1a", target_minutes: 180 },
  { name: "Arts plastiques", color: "#d9489b", target_minutes: 60 },
  { name: "Musique", color: "#8b5cf6", target_minutes: 60 },
  { name: "EMC", color: "#b8663a", target_minutes: 30 },
  { name: "Anglais", color: "#d4a800", target_minutes: 90 },
];

/** Palette offered when recoloring or adding a domain. */
export const DOMAIN_PALETTE = [
  "#e5484d", "#f08c1a", "#d4a800", "#2f9e5a", "#12a594", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#d9489b", "#b8663a", "#64748b",
];

/** Suggested séance names per domain (matched on the domain name). */
const SUGGESTIONS: Record<string, string[]> = {
  "français": [
    "Lecture", "Compréhension", "Écriture", "Production d'écrits", "Grammaire", "Conjugaison",
    "Orthographe", "Dictée", "Vocabulaire", "Langage oral", "Étude de la langue", "Rituels",
  ],
  "mathématiques": [
    "Calcul mental", "Numération", "Calcul", "Résolution de problèmes", "Géométrie",
    "Grandeurs et mesures", "Rituels", "Jeux mathématiques",
  ],
  "questionner le monde": [
    "Le vivant", "La matière", "Les objets", "Se situer dans l'espace", "Se situer dans le temps", "Sciences",
  ],
  "eps": ["Jeux collectifs", "Gymnastique", "Athlétisme", "Danse", "Natation", "Jeux d'opposition", "Course d'orientation"],
  "arts plastiques": ["Arts plastiques", "Dessin", "Peinture", "Histoire des arts"],
  "musique": ["Chant", "Écoute musicale", "Pratique rythmique", "Chorale"],
  "emc": ["Débat", "Conseil de classe", "Vivre ensemble"],
  "anglais": ["Anglais", "Rituels en anglais", "Comptines", "Album en anglais"],
};

export const OFF_DOMAIN_SUGGESTIONS = ["Récréation", "Pause méridienne", "Accueil", "APC", "Bibliothèque", "Sortie"];

export function suggestionsFor(domain: Domain | undefined, slots: Slot[]): string[] {
  const base = domain ? SUGGESTIONS[domain.name.trim().toLowerCase()] ?? [] : OFF_DOMAIN_SUGGESTIONS;
  const used = slots
    .filter((s) => s.domain_id === (domain?.id ?? null) && s.title.trim())
    .map((s) => s.title.trim());
  return [...new Set([...used, ...base])];
}

export interface DomainVolume {
  domain: Domain;
  planned: number;
  target: number;
  /** planned − target (minutes). */
  delta: number;
  status: "ok" | "over" | "under" | "none";
}

/** A gap of ±15 min is still "conforme" (a séance rarely lands on the minute). */
export const VOLUME_TOLERANCE = 15;

/** Weekly planned minutes per domain, from the timetable slots on active days. */
export function computeVolumes(domains: Domain[], slots: Slot[], activeDays: number[]): DomainVolume[] {
  const planned = new Map<string, number>();
  for (const s of slots) {
    if (!s.domain_id || !activeDays.includes(s.day)) continue;
    planned.set(s.domain_id, (planned.get(s.domain_id) ?? 0) + Math.max(0, s.end_min - s.start_min));
  }
  return domains.map((domain) => {
    const p = planned.get(domain.id) ?? 0;
    const target = domain.target_minutes;
    const delta = p - target;
    const status: DomainVolume["status"] =
      target <= 0 ? "none" : Math.abs(delta) <= VOLUME_TOLERANCE ? "ok" : delta > 0 ? "over" : "under";
    return { domain, planned: p, target, delta, status };
  });
}
