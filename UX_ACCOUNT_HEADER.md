# UX — Refonte Header Page Account

_Inspirations : Attio (density + key-value rows), Linear (sobriety), Notion (toolbars sticky), HubSpot (side panels pour l'info secondaire)._

## 1. Diagnostic

Quatre problèmes majeurs :
1. **Zéro hiérarchie** : identité, actions, aires thérapeutiques, statut CRM et filtres catégories vivent tous sur le même plan visuel (chips 11–12 px partout).
2. **Actions plates** : 4 boutons de poids égal (`btn-secondary` × 3 + `btn-primary`) écrasent le CTA principal et compressent le nom.
3. **Mélange sémantique** : aires thérapeutiques (attribut factuel) et PIC / CRM status (état opérationnel) cohabitent dans la même rangée de pills — impossible à scanner.
4. **Filtres dans le header** : les 12 pills de catégories + TechToMed/ICP appartiennent à la vue arbre, pas à l'identité du compte. Le `·` orphelin devant l'industrie trahit un rendering ad-hoc.

## 2. Nouvelle hiérarchie — 3 zones

**Zone A — Identité & actions** (fond `#FFFFFF`, `px-7 pt-5 pb-4`, pas de border bas)
Avatar + nom + priorité + key-value rows compactes, actions à droite.

**Zone B — Attributs** (même fond, `px-7 pb-4`, séparée de A par spacing, pas de trait)
Aires thérapeutiques + next step + count contacts — lecture "fiche".

**Zone C — Toolbar vue** (fond `#FAFAFA`, `border-t + border-b #E5E7EB`, `px-7 py-2.5`, **sticky**)
Toggle Niveaux/Freeform + catégories + TechToMed/ICP. Sépare visuellement l'en-tête de la vue arbre.

Séparation : A↔B par spacing seul (`gap-3`), B↔C par changement de fond + bordure. Évite l'effet "sandwich" de 3 bandes blanches.

## 3. Actions — regrouper & hiérarchiser

- **Primary** : `+ Ajouter contact` (noir `#111827`, `btn-primary`, icône plus) — action quotidienne dominante.
- **Secondary** : `Synchroniser Pipedrive` (border + fond blanc, icône `arrow-path`, conserve le chip "synchronisé il y a 3 min" en dessous à droite, `text-[11px] text-ink-400`).
- **Overflow `⋯`** : menu dropdown (Linear/Attio style) contenant `Exporter XLSX`, `Éditer la company`, `Archiver`, `Copier l'URL`. Tout ce qui est rare vit là.

Ordre visuel gauche→droite : `[⋯] [Synchroniser Pipedrive] [+ Ajouter contact]`. Gap `gap-2`, actions alignées verticalement sur la baseline du nom.

## 4. Metadata (Zone A + B compactées)

**Ligne 1 (Zone A, `text-[22px] font-semibold`)**
`MG` (avatar 40px) · `Merck Group (Merck KGaA)` · `P2` (chip 11 px coloré priorité) · `merckgroup.com ↗` (lien `text-[12px] text-ink-500`).

**Ligne 2 (Zone A, `text-[12.5px] text-ink-500`, icônes 14 px mono)**
`📍 Frankfurter Str 250, Darmstadt, DE 🇩🇪` · `👥 32 595 emp.` · `🏭 Pharmaceutical Manufacturing`
Séparateurs : middot `·` *entre* items seulement, jamais en préfixe.

**Ligne 3 (Zone B, label + pills)**
`Aires thérapeutiques` (`text-[10.5px] uppercase tracking-wider text-ink-400`) + pills `text-[11px] bg-ink-50 border-ink-200 text-ink-700` (monochrome gris — la couleur est réservée aux catégories de rôle dans la Zone C pour éviter le bruit).

**Ligne 4 (Zone B, key-value Attio-style, `text-[12px]`)**
`PIC` `Charles` · `Statut CRM` `A moitié travaillé` (chip coloré ambre) · `Next step` `Relancer X`
Label `text-ink-400`, valeur `text-ink-800`. Alignement à gauche, `18 contacts` en tabular-nums à droite (`ml-auto`).

Gain : 4 lignes lisibles au lieu d'un mur de pills indifférenciées.

## 5. Zone filtres / vue — sticky, séparée du header

Les 12 catégories + TechToMed + ICP + toggle Niveaux/Freeform **appartiennent à la vue arbre**, pas à l'identité du compte. Je les sors du `CompanyHeader` dans une `AccountToolbar` dédiée :

- Sticky `top-0` avec fond `#FAFAFA` contrasté → l'utilisateur scrolle dans l'arbre de contacts et garde le contrôle des filtres.
- Le bloc identité (Zones A+B) **scrolle normalement** — quand on descend, on récupère de la hauteur.
- Résultat : header "passif" léger en haut + toolbar "active" pinée sous le scroll.

Contre : 2 zones sticky = risque de bande figée épaisse. Mitigation : Zones A+B non-sticky (~120 px), seule la toolbar (~48 px) reste collée.

## 6. Wireframe final

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ZONE A — Identité + actions     bg-white  px-7 pt-5 pb-4                    │
│                                                                              │
│  ┌────┐  Merck Group (Merck KGaA)  [P2]  merckgroup.com ↗     [⋯] [↻ Sync]  │
│  │ MG │  text-[22px] font-semibold                                [+ Add]   │
│  └────┘  📍 Darmstadt, DE 🇩🇪 · 👥 32 595 emp. · 🏭 Pharmaceutical Mfg.     │
│          text-[12.5px] text-ink-500                  Synced il y a 3 min    │
│                                                                              │
│  ZONE B — Attributs              bg-white  px-7 pb-4  gap-3                  │
│                                                                              │
│  AIRES THÉRAPEUTIQUES   [Oncology] [Neurology] [Fertility] [Life Sci] [+2]  │
│  PIC Charles   ·   Statut CRM [A moitié travaillé]   ·   Next Relancer X    │
│                                                          18 contacts        │
├──────────────────────────────────────────────────────────────────────────────┤
│  ZONE C — Toolbar (sticky)   bg-[#FAFAFA]  border-y  px-7 py-2.5            │
│                                                                              │
│  [▦ Niveaux | ◌ Freeform]  CATÉGORIES ● C-Level ● Digital ● Data ● IT ...   │
│                                                        [★ TechToMed] [ICP]  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Palette : texte `#111827`, secondaire `#6B7280`, mute `#9CA3AF`, border `#E5E7EB`, surface-2 `#FAFAFA`.

## 7. États & edge cases

- **Empty state** : pas d'aires thé. → ligne 3 masquée ; pas de PIC → `PIC —` en `text-ink-300` (pour inciter à remplir, style Attio). Pas d'industrie → item omis sans `·` orphelin.
- **Nom long** (>60 char) : `truncate` sur `h2`, tooltip au hover. Avatar et chip priorité jamais tronqués.
- **10+ aires thé.** : affiche 5 + `+N` cliquable → popover liste complète. Jamais de wrap sur 3 lignes.
- **Laptop 1440 px** : actions restent inline ; en dessous de 1280 px, `Synchroniser` se réduit à icône seule avec tooltip, le menu `⋯` absorbe l'overflow.
- **Toolbar wrap** : sur étroit, catégories passent en scroll horizontal (`overflow-x-auto`) avec fade mask à droite, pas de wrap multi-lignes.

## 8. Décisions UX tranchées

- **Décision** : 3 zones maximum (A identité, B attributs, C toolbar) — parce qu'au-delà, la hiérarchie redevient plate.
- **Décision** : 1 seul primary `+ Ajouter contact` — parce que c'est l'action quotidienne, tout le reste est opérationnel ou rare.
- **Décision** : `Exporter XLSX` + `Éditer` passent dans le menu `⋯` — parce qu'un export/édition est hebdomadaire, pas quotidien.
- **Décision** : Aires thérapeutiques monochromes gris — parce que la couleur est réservée aux catégories de rôle (Zone C) pour éviter la confusion sémantique.
- **Décision** : PIC + CRM status en key-value rows (label/valeur) — parce que c'est du métadata opérationnel, pas de la taxonomie.
- **Décision** : Toolbar sticky, identité scrollable — parce que les filtres sont l'outil actif, l'identité est contextuelle.
- **Décision** : Supprimer les `·` orphelins — parce que les séparateurs se construisent en JSX par `join`, pas en dur en préfixe.
- **Décision** : Avatar 40 px (pas 44) — parce que Linear/Attio tournent à 32–40 px, 44 est overblown pour un header dense.
- **Décision** : Toggle Niveaux/Freeform passe en Zone C — parce qu'il pilote la vue arbre, pas le compte.
- **Décision** : `18 contacts` en tabular-nums aligné droite Zone B — parce que c'est une métrique, pas un attribut.

## 9. Composants Vue à créer / modifier

- **`CompanyHeader.js`** — retirer la rangée metadata chips + toggle vue + lastSynced chip ; réduire à Zones A + B seulement. Extraire le menu `⋯` en `ActionsMenu`.
- **`ActionsMenu.vue`** (nouveau) — dropdown Notion-style avec `Exporter XLSX`, `Éditer`, `Archiver`, `Copier URL`. Piloté par `store.modal`.
- **`AccountToolbar.vue`** (nouveau) — Zone C : fusionne `FilterBar` + segment toggle Niveaux/Freeform. Reçoit `viewMode` en prop, émet `view-change`. Sticky `top-0`.
- **`FilterBar.js`** — déprécié au profit de `AccountToolbar` (ou gardé comme sous-composant des catégories).
- **`MetaRow.vue`** (nouveau, optionnel) — composant key-value réutilisable (label + valeur + optional chip) pour la ligne 4 de la Zone B. Réutilisable dans side panels futurs.
- **`TherapeuticAreasList.vue`** (nouveau) — gère le `+N` overflow avec popover.
- **`PageAccount.vue`** (ou équivalent routeur) — orchestre `CompanyHeader` (non-sticky) + `AccountToolbar` (sticky) + vue arbre.

## 10. Rapport final

**Structure 3 zones** : A (identité + actions, blanc), B (attributs + aires thé. + PIC/CRM key-value, blanc), C (toolbar filtres + toggle vue, gris sticky). A et B séparées par spacing, C séparée par fond + bordure.

**Actions** : 1 primary `+ Ajouter contact`, 1 secondary `Synchroniser Pipedrive` (avec sous-label "synced il y a X min"), le reste (`Export XLSX`, `Éditer`, archivage) dans un menu `⋯` Linear-style. Le CTA principal retrouve son poids.

**Toggle vue + filtres** sortis du header dans une toolbar dédiée sticky au scroll — les filtres sont un outil actif, pas une identité.

**Décisions majeures** : suppression des pills PIC/CRM mélangées aux aires thé., monochrome pour les aires thé., key-value rows pour PIC/CRM/Next step, fin des `·` orphelins.

**Ambiguïtés à arbitrer par Nicolas** : (a) garder `Synchroniser Pipedrive` visible ou le noyer dans `⋯` si la sync devient rare ; (b) les aires thé. restent-elles vraiment monochromes ou méritent-elles un code couleur par domaine (Onco rouge, Neuro violet…) ; (c) Zone B fusionnée avec Zone A ou gardée séparée selon densité réelle observée ; (d) `CRM status` mérite-t-il un chip coloré (ambre/vert) ou du texte neutre comme le reste des key-values.
