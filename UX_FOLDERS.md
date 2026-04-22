# UX — Dossiers pour organiser les comptes

_Design doc. Inspirations : Notion (pages nested + drag-to-reparent), Linear (projects groupés par team), Attio (lists), Airtable (bases regroupées en workspaces)._

## 1. Diagnostic + inspiration

Nicolas a 30+ comptes dans `muchbetter.ai`, triés en liste plate par priorité. Scanner "toutes les pharma" exige de relire tout le liste. **Notion** fait ça bien avec des pages nestées + chevron expand/collapse et drag-to-reparent. **Linear** regroupe par header statique (pas de création user-land). **Attio** a des "Lists" custom par user partagées à la team. On vise **mix Notion (hiérarchie visuelle, drag léger) + Attio (dossiers team-shared)** — pas des listes dynamiques à la Attio, juste des bacs.

## 2. Data model

**Nouvelle collection `folders`** :

```
{ _id, team_id, name, color?: "slate"|"blue"|..., icon?: "🧪",
  parent_folder_id?: ObjectId|null,  // V2 only
  position: int,                     // tri manuel, step 1024
  created_at, updated_at, created_by }
```

**Sur `companies`** : ajouter `folder_id: ObjectId | null` (null = racine, "Sans dossier").

**Tranches fermes** :
- **Flat pour MVP** (pas de `parent_folder_id`). Un seul niveau. 30 comptes × 3-5 dossiers = pas de besoin de nested. Le champ `parent_folder_id` reste réservé dans le schéma pour V2, jamais rempli en MVP.
- **Partagé team** (validé) : tous les membres voient les mêmes dossiers. Un workspace collaboratif n'a pas de sens avec des vues privées divergentes. Si besoin perso émerge plus tard → V3 "saved views".
- **1 dossier max par compte** (pas multi). Arborescence stricte = modèle mental simple, cohérent avec file system Mac/Notion. Multi = tags, autre feature, pas un dossier.

## 3. UX Sidebar — wireframe

```
┌─ Sidebar 280px ─────────────────────┐
│ [TeamSwitcher muchbetter.ai      ▾] │
├─────────────────────────────────────┤
│ COMPTES              (31)    [+ ⊕]  │  ← [+⊕] = "+ Nouveau dossier"
│                                     │
│ ▾ 🧪 Pharmaceutique          (8)    │  ← chevron left + emoji + nom + count
│     Aptar                    [P1]   │  ← indent 14px
│     Ipsen                    [P1+]  │
│     Novo Nordisk             [P1]   │
│     …                               │
│                                     │
│ ▸ 🧬 Biotech                 (4)    │  ← collapsed
│                                     │
│ ▾ 🏥 Medtech                 (2)    │
│     GE Healthcare            [P2]   │
│     Siemens Healthineers     [P2]   │
│                                     │
│ ─── Sans dossier ────────── (17) ── │  ← section discrète, label gris
│     Autre Compte 1           [P3]   │
│     …                               │
├─────────────────────────────────────┤
│ [+ Ajouter compte]                  │
├─────────────────────────────────────┤
│ [N] Nicolas                   (⋯)   │
└─────────────────────────────────────┘
```

**États visuels** :
- **Expanded** : chevron `▾`, enfants rendus, count en gris.
- **Collapsed** : chevron `▸`, enfants masqués, count visible (= gain de scan).
- **Actif** (compte dedans ouvert) : header dossier en `bg-ink-50`, nom légèrement plus foncé, **force expand** tant que l'enfant est actif (un compte actif caché = bug UX).
- **Vide** : dossier rendu avec `(0)` en gris pâle ; clic dessus = expand affichant "Glisser un compte ici" en `text-ink-300 italic`.
- **Dossier survolé** : révèle un bouton `+` (créer compte dedans) et `⋯` (menu rename/couleur/delete) à droite.

Bouton **"+ Nouveau dossier"** : icône discrète à droite du header "COMPTES" (pas un gros CTA — la création est rare).

## 4. Actions clés — flows

- **Créer un dossier** — **inline Notion-style**, pas de modal. Clic sur `+⊕` → une nouvelle row apparaît en haut de la liste avec input focus + placeholder "Nom du dossier". Enter = crée (POST), Escape = annule. Emoji/couleur éditables ensuite via `⋯ > Personnaliser`. Moins friction qu'un modal pour une action légère.
- **Renommer** — **double-click sur le nom** (Notion) **OU** `⋯ > Renommer` (fallback discover). Input inline, Enter/Escape pour valider/annuler.
- **Supprimer** — **déplacement auto vers racine** (safer). Les comptes ne disparaissent jamais avec le dossier. Confirm modal simple : "Supprimer le dossier 'Pharmaceutique' ? Les 8 comptes qu'il contient seront déplacés dans 'Sans dossier'." Pas de cascade — trop dangereux, et un cascade accidentel sur 30 comptes = désastre.
- **Déplacer un compte** — **les deux** :
  - **Drag & drop** natif depuis la row (handle visible au hover, icône `⋮⋮` 10px). Dépose sur header dossier = move. Cohérent avec le geste natif "déplacer un fichier".
  - **Menu contextuel** `⋯ > Déplacer vers...` → submenu avec liste dossiers + "Racine (sans dossier)". Accessibilité + Windows.
  - Le drag doit coexister avec le swipe-to-delete : **drag = grab handle gauche uniquement** (le reste de la row reste swipable). Seuil de déclenchement drag = 6px vertical, seuil swipe = 40px horizontal — pas d'ambiguïté.
- **Créer un compte dans un dossier** — **bouton `+` au hover du header dossier** (révélé avec le `⋯`). Clic ouvre le modal existant `company-create` avec `folder_id` pré-rempli. Le CTA global bottom "+ Ajouter compte" reste neutre (crée à la racine) — pas de contexte implicite, trop flou.

## 5. Affordances visuelles

- **Icône dossier** : **emoji optionnel** (`🧪`, `🏥`, input libre), fallback sur un SVG `folder-closed` 14px gris (Heroicons outline) si pas d'emoji. Pas de palette custom — les emojis sont la lingua franca de Notion/Slack.
- **Couleur** : optionnelle, **pastille 6px ronde** à gauche du chevron (slate/blue/green/amber/red/violet — 6 tons Tailwind-500 désaturés). Par défaut = pas de pastille (monochrome). Subtil, pas de fond coloré bruyant.
- **Indentation** : enfants à `padding-left: 20px` (aligné sous le nom du dossier, pas sous le chevron).
- **Chevron** : `left-before-name`, 10px, `text-ink-400`. Click-target = toute la row du header (pas seulement le chevron).
- **Drag handle** : `⋮⋮` 10px gris `opacity-0` idle → `opacity-100` hover sur la row. Curseur `grab` au hover.

## 6. Edge cases

- **30+ comptes dans un dossier** : pas de scroll interne (nested scroll = enfer UX). Continue dans le flux principal.
- **Nom long** : `truncate` avec tooltip hover ; count reste visible à droite.
- **Drag accidentel** : toast undo 5s `Compte "X" déplacé vers "Y". [Annuler]` (cohérent avec delete undo).
- **Non-admin** : membre standard peut créer/renommer/supprimer dossiers (dossiers = organisation, pas permissions). Owner-only = futur si besoin.
- **Suppression d'un dossier plein** : confirm modal avec compteur explicite des comptes impactés (voir §4).
- **0 dossier** : section "COMPTES" rendue en liste plate comme aujourd'hui + petite invite `text-ink-300` "Crée un dossier pour organiser" sous le header, avec lien cliquable qui déclenche l'input inline.
- **Dossier dupliqué** : pas de contrainte unique côté DB (normaliser par casse est fragile). UI autorise, tant pis.

## 7. Décisions UX tranchées

1. **Décision** : flat MVP (1 niveau) — parce que 30 comptes ne justifient pas une UI nested complexe, et `parent_folder_id` reste réservé pour V2.
2. **Décision** : dossiers team-shared, pas perso — parce qu'un workspace collaboratif perd son sens avec des vues divergentes.
3. **Décision** : 1 compte dans 1 seul dossier — parce qu'un dossier est une arborescence, pas un tag ; multi-folder = autre feature.
4. **Décision** : delete dossier = comptes remontent à la racine, jamais cascade — parce qu'un cascade sur 8 comptes par mégarde = perte de données réelle.
5. **Décision** : création inline (pas modal) — parce que Notion l'a normalisé, et créer un dossier doit être un geste de 2 secondes.
6. **Décision** : drag & drop + menu contextuel coexistent — parce que drag n'est pas découvrable et menu n'est pas fluide ; ensemble ça couvre tous les users.
7. **Décision** : "Sans dossier" = section fin de liste (pas un dossier spécial) — parce qu'un "Uncategorized" rendu comme un dossier normal parasite le modèle mental.
8. **Décision** : dossier actif force expand — parce qu'un compte ouvert mais masqué dans la sidebar = incohérence visible.
9. **Décision** : bouton "+ Dossier" en top-right discret, pas gros CTA — parce que la création est un événement rare (5-10 dossiers max, vs 30+ comptes).
10. **Décision** : "+ Ajouter compte" bottom reste neutre (racine) — parce que contexte implicite ("je suis dans dossier X donc crée dedans") cause plus de bugs qu'il n'en résout.

## 8. Backend routes à créer

- `GET /api/teams/{slug}/folders` → liste ordonnée par `position`
- `POST /api/teams/{slug}/folders` → `{name, color?, icon?}` → renvoie le folder
- `PATCH /api/teams/{slug}/folders/{id}` → rename, recolor, reicon, reorder (`position`)
- `DELETE /api/teams/{slug}/folders/{id}` → 204 ; side-effect : `companies.updateMany({folder_id: id}, {$set: {folder_id: null}})`
- `PATCH /api/teams/{slug}/companies/{id}` étendu : accepte `folder_id: ObjectId | null` (pas de route dédiée `move-company` — un PATCH suffit, moins de surface API)
- Index Mongo : `folders {team_id, position}`, `companies {team_id, folder_id}`

## 9. Composants Vue à créer

- `FolderRow.js` — header dossier (chevron, emoji, nom, count, hover actions +/⋯)
- `CreateFolderInline.js` — row input inline avec Enter/Escape
- `FolderMenu.js` — dropdown rename/couleur/icon/delete
- `MoveToFolderMenu.js` — submenu "Déplacer vers..." réutilisable (ActionsMenu company + drag target)
- `Sidebar.js` (modifié) — rend folders puis "Sans dossier" puis plat si 0 folder
- `SwipeableCompanyItem.js` (modifié) — expose drag handle + coexiste avec swipe

## 10. Rapport final

**Structure retenue** : **flat (1 niveau)** pour MVP, **1 compte dans 1 dossier max**, **dossiers partagés au niveau team**. Nested et multi-folders restent des options V2/V3 si la demande émerge — le schéma laisse `parent_folder_id` nullable mais non-utilisé.

**Flow création** : clic `+⊕` top-right de la section "COMPTES" → row input inline Notion-style → Enter crée. Emoji/couleur édités après via menu `⋯`.

**Flow move** : drag & drop (handle `⋮⋮` hover) OU menu contextuel `Déplacer vers...` — les deux coexistent. Toast undo 5s après move.

**Empty state** : 0 dossier = liste plate comme aujourd'hui + micro-invite `text-ink-300` "Crée un dossier pour organiser". Dossier vide = rendu normal avec `(0)` + placeholder "Glisser un compte ici" au hover.

**Ambiguïtés à arbitrer par Nicolas avant dev** :
1. **Nested V2 ou pas ?** (Pharma > Pharma FR) — si oui, prévoir le parent_folder_id + le drag de dossiers. Sinon, trancher qu'on ne le fera jamais et simplifier le schéma.
2. **Emoji ou icône SVG par défaut ?** — emoji = fun mais cross-platform inconsistent, SVG = clinique. Je penche emoji optionnel + SVG fallback, à confirmer.
3. **Drag & drop en V1 ou seulement menu contextuel ?** — drag = effort dev non-négligeable avec conflit swipe. Une V1 menu-only puis drag en V1.1 est viable.
4. **Permissions** : owner-only sur delete dossier, ou tous les membres ? Je vote tous (simplicité), mais si la team grandit à 10+ membres, restreindre aux admins fera sens.
