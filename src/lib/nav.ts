/** One-shot focus passed along with a navigation (e.g. open this fiche).
 *  The target page reads it on mount and clears it. */
export const navFocus: { prepId: string | null; sequenceId: string | null } = { prepId: null, sequenceId: null };

/** Séance being dragged from the cahier journal (copy onto another day). */
export const sessionDrag: { key: string | null } = { key: null };

/** « Copier » (clic droit) in the cahier journal: the séance waiting to be pasted. */
export const sessionClipboard: { current: { date: string; key: string; title: string } | null } = { current: null };
