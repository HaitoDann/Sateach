# Sat'each

Emploi du temps et cahier journal pour professeur des écoles — une alternative
gratuite et locale à Teetsh. Application de bureau (Tauri 2 + React), construite
sur la même base que Nilo : même ergonomie, mêmes composants, même système de
**vault**.

## Fonctionnalités

- **Emploi du temps hebdomadaire** — grille Lun → Ven (jours configurables).
  Cliquez ou glissez dans la grille pour créer une séance, glissez une séance pour
  la déplacer (y compris vers un autre jour), tirez son bord bas pour changer sa
  durée. Chaque séance a un **nom libre** (« Calcul mental ») et un **domaine**
  (Mathématiques) qui lui donne sa couleur. Une même séance peut être créée sur
  plusieurs jours en une fois. Les temps « hors domaine » (récréation, cantine,
  accueil…) sont affichés hachurés et ne sont pas comptés.
- **Pastilles de domaine** — au-dessus de la grille, glissez une pastille
  (Mathématiques, Français…, ou « Pause ») dans l'emploi du temps pour créer la
  séance instantanément (durée 30 min / 45 min / 1 h au choix).
- **Trait de l'heure actuelle** — une ligne suit la journée dans l'emploi du
  temps ; la séance en cours est encadrée, et marquée « en cours » dans le
  cahier journal.
- **Calendrier** — réunions, vacances, évènements, sur un mois, avec la liste
  « À venir ». Chaque évènement peut avoir un rappel (au début, 15 min, 1 h, la
  veille, une semaine avant) ; les rappels s'activent ou se désactivent d'un clic
  (notifications système, tant que Sat'each est ouvert).
- **Mes cours** — l'archive des cours, rangée par domaine puis par séquence :
  objectifs, déroulement, matériel, notes, niveau, et documents joints (copiés
  dans le dossier `Cours/` du vault). Une séance détaillée du cahier journal
  s'archive en un clic.
- **Domaines** — Français, Mathématiques, Questionner le monde, EPS, Arts
  plastiques, Musique, EMC, Anglais, chacun avec sa couleur. Nom et couleur
  modifiables, domaines ajoutables dans les Réglages.
- **Volume horaire** — pour chaque domaine, les heures prévues par l'emploi du
  temps face au volume de référence que vous saisissez (pré-rempli avec les
  horaires indicatifs du cycle 2). Graphique en barres, répartition de la
  semaine, et écart signalé (« +0h45 en trop », « −0h30 manquant »).
- **Cahier journal** — le « zoom » sur une journée : les séances prévues dans
  l'emploi du temps apparaissent automatiquement, et chacune se détaille pour ce
  jour-là : objectifs, déroulement, matériel, bilan. On peut aussi cocher une
  séance comme faite, l'annuler pour ce jour (sortie, absence…), modifier son
  horaire pour ce jour uniquement, ajouter une séance ponctuelle, écrire les notes
  du jour, et **imprimer** la journée (A4). Enregistrement automatique.
  Chaque séance se valide « Faite » ou « Non faite ».

## Le vault

Au premier lancement, Sat'each demande un dossier : c'est le **vault**. Toutes
les données y sont stockées dans `sateach.db` (SQLite). Rien n'est envoyé sur
Internet. Placez le vault dans un dossier synchronisé (OneDrive, Google Drive…)
pour le retrouver sur un autre ordinateur.

- Sauvegardes automatiques dans `<vault>/.sateach-backups/` (au plus une toutes
  les 6 h, les 10 dernières conservées) + bouton « Sauvegarder maintenant ».
- Si la base est abîmée, Sat'each propose de restaurer la dernière sauvegarde.
- Un verrou (`.sateach.lock`) évite d'ouvrir le même vault sur deux ordinateurs
  en même temps.

## Développement

```bash
npm install
npm run tauri dev      # application de bureau
npm run dev            # dans le navigateur (mode démo, données dans localStorage)
npm run typecheck && npm run lint && npm test
```

Prérequis pour l'application de bureau : Node 20+, Rust stable, et les
[prérequis Tauri](https://tauri.app/start/prerequisites/) de votre système.

## Obtenir l'installateur Windows

- `npm run tauri build` sur un PC Windows → `src-tauri/target/release/bundle/`.
- Ou sur GitHub : **Actions › Build Windows › Run workflow**, puis téléchargez
  l'artefact `sateach-windows` (.exe et .msi). Pousser un tag `v0.1.0` crée un
  brouillon de release avec les installateurs.

L'installateur n'est pas signé : Windows SmartScreen peut afficher « Windows a
protégé votre ordinateur » → *Informations complémentaires* → *Exécuter quand
même*.

## Structure

```
src/
  lib/          données : db.ts (SQLite, migrations), journal.ts (fusion emploi du temps ↔ cahier journal),
                domains.ts (domaines, volumes), time.ts, vault.ts (verrou, sauvegardes), store.ts (préférences)
  context/      VaultContext : domaines, séances, réglages, toasts, confirmations
  components/   Sidebar (rail d'icônes façon Nilo), WeekGrid, SessionDialog, journal/…
  pages/        TimetablePage, JournalPage, CalendarPage, ArchivePage, VolumesPage, SettingsPage, VaultSelector
src-tauri/      application Tauri (fenêtre sans bordure, verrou + sauvegardes en Rust)
```
