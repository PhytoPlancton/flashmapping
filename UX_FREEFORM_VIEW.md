# UX — Vue Freeform (toggle Niveaux ↔ Canvas)

Design doc · 2026-04-20 · Auteur: UX/UI (senior canvas & diagramming)
Cible: ajout d'une **vue freeform** à côté de la vue `OrgTree.js` (5 rangées hiérarchiques) sur chaque compte.

---

## 1. Diagnostic rapide

La vue niveaux répond à la question **"qui est où dans la hiérarchie ?"** — elle est normative, rigide, excellente pour l'onboarding d'un compte et l'export XLSX. Elle échoue dès qu'il faut raconter **les relations réelles** : qui parraine qui, qui est l'allié interne de qui, qui est le vrai décideur même s'il est VP, qui mentore le DG-adjoint. Nicolas veut une toile de relations **latérales** pour préparer ses cold calls et ses plans d'entrée. La vue freeform est donc un **outil de storytelling et de stratégie** (à utiliser en phase "plan de compte"), pas un outil de saisie initiale. On entre toujours par Niveaux, on bascule en Freeform pour **tisser**.

---

## 2. Le toggle

### Emplacement
Dans `CompanyHeader.js`, **nouvelle ligne sous le titre**, alignée à gauche (pas dans la barre des 4 boutons à droite — celle-ci est déjà dense, et le toggle doit être à proximité du contenu qu'il change, pas à côté d'actions destructives comme "Synchroniser Pipedrive").

Alternative rejetée: mettre le toggle dans `FilterBar.js` — ça marche mais ça dilue : ce n'est pas un filtre, c'est un **changement de mode**.

### Style: segment control iOS-like (2 onglets)
```
┌────────────┬────────────┐
│  Niveaux   │  Freeform  │
└────────────┴────────────┘
```
- Pilule arrondie, ~28px de haut, fond `ink-50`, segment actif = fond blanc + shadow légère + texte `ink-900`.
- Chaque segment: icône + label.
  - Niveaux: icône "rows" (3 barres horizontales empilées)
  - Freeform: icône "scatter" (3 points reliés par des traits, style graphe)
- Pas de switch iOS (on/off) — un switch suggère "activer une fonctionnalité", alors qu'ici les deux modes sont **équivalents**. Un segment control l'exprime mieux.

### Comportement au switch
- **Transition**: fondu 180ms (crossfade du conteneur), pas de slide — les deux layouts sont trop différents pour une transition géométrique propre.
- **Reset zoom/pan**: au switch vers Freeform, on applique un `fit-to-content` automatique (toutes les cartes visibles avec 40px de padding). Le zoom/pan Freeform est ensuite persisté en `localStorage` sous `freeform:viewport:{companyId}`.
- **Conservation**: les deux vues ne partagent PAS leur état de viewport (zoom/pan n'existe pas en Niveaux).
- **Persistance de l'onglet actif**: `localStorage.setItem('viewMode:{companyId}', 'freeform'|'levels')`.

### État par défaut
**Niveaux**. Toujours. Nicolas découvre un compte par la hiérarchie, il bascule en Freeform quand il a déjà saisi les contacts.

### Éventuel badge "nouveau"
Les 2 premières semaines post-release, pastille `new` discrète (dot `ink-800` en haut-droite du segment Freeform) — retirée après premier usage enregistré.

---

## 3. Vue Freeform — wireframe détaillé

### Canvas
- **Infini** (pan dans les 4 directions, pas de bordure). Un canvas bounded rassure mais contraint les gros comptes (30+ contacts).
- Coordonnées stockées en absolu (pas relatif au viewport).

### Background
**Grille pointillée**, inspiration **tldraw / Apple Freeform**.
- Pitch: 24px
- Point: 1.5px, couleur `#D8DCE1` (cohérent avec `ink-200`).
- Sous-grille tous les 5 pts (point plus contrasté) pour ancrer l'œil au zoom arrière.
- Fond global: `#FAFAFA` (exact même teinte que le reste de l'app — cohérence). Pas de papier jauni type Freeform, ça jure.
- Grille se dilate/rétracte avec le zoom (pas un `background-image` figé).

### Toolbar
**Une seule** toolbar, **en bas-centré**, flottante, style "dock" (Figma/tldraw).
- Raisons: (a) libère le haut pour le header company existant, (b) pattern connu des outils canvas, (c) pouce naturellement proche sur trackpad.
- Hauteur 44px, radius 12px, fond blanc, shadow `0 4px 12px rgba(0,0,0,.08)`, border `ink-200`.

Contenu (gauche → droite):
1. **Select** (V) — curseur flèche, mode par défaut
2. **Hand / Pan** (H) — main, pour pan (alternative au space+drag)
3. Séparateur
4. **Add card** (A) — pose une carte vide au centre du viewport
5. **Connector** (C) — mode trait : click carte A, click carte B
6. **Sticky note / annotation libre** (N) — *Phase 2*
7. Séparateur
8. **Undo / Redo** (⌘Z / ⌘⇧Z)
9. Séparateur
10. **Zoom −** · pastille `100%` (click = fit) · **Zoom +**
11. **Fit to content** (icône expand)

### Cartes
- **Même composant** `ContactCard.js` (cohérence visuelle + 1 seule source de vérité).
- Taille: identique à la vue Niveaux (~240×80px). Pas de mode compact en phase 1 — on l'ajoute en Phase 2 si Nicolas trouve ça encombré.
- **Draggable** en x/y libres (snap optionnel à la grille de 8px, togglable via menu toolbar).
- **Pas resizable** en phase 1 (complique l'état, peu de valeur — toutes les cartes ont le même contenu).
- Sélection: click = sélectionne ; shift+click = ajoute à la sélection ; drag sur canvas vide = lasso rectangulaire.
- État sélectionné: outline 2px `ink-900`.

### Zoom / Pan
- **Pan**: trackpad à 2 doigts (natif), OU space+drag, OU hand tool sélectionné.
- **Zoom**: trackpad pinch (natif), OU ⌘+wheel, OU boutons toolbar, OU `⌘+` / `⌘−`.
- Range: 25% → 400%.
- Zoom centré sur le curseur (pas sur le viewport — Figma pattern, bien plus naturel que Miro).

### Mini-map
**Non en phase 1.** À évaluer si 50+ contacts deviennent la norme. Ajouter le toggle dans un menu "⋯" de la toolbar.

---

## 4. Les connecteurs

### Création — Miro-style
**Hover une carte → 4 petits "handles" apparaissent sur les 4 edges** (N/S/E/O) — cercles `ink-300` 8px. Drag depuis un handle → trait qui suit la souris → relâche sur une autre carte → connexion créée.

Pourquoi ça et pas un bouton "connect" dédié : c'est le pattern universel (Miro, Figma FigJam, Whimsical, Lucidchart). Courbe d'apprentissage = zéro.

Alternative pour utilisateurs clavier: sélectionner carte A, shift+sélectionner carte B, presser `L` (link) → trait créé.

### Types de connecteurs
**3 types en phase 1** (plus, on noie Nicolas ; moins, on n'exprime rien) :

| Type | Couleur | Style | Usage |
|---|---|---|---|
| **Reporting** | `ink-400` | Plein, flèche pleine | Ligne hiérarchique réelle (qui reporte à qui) |
| **Allié / Mentor** | `emerald-500` | Plein, flèche légère | Relation positive (mentor, sponsor interne, supporter de muchbetter) |
| **Influence informelle** | `amber-500` | Pointillé, pas de flèche | "Sandra écoute beaucoup Marina même si elle n'est pas sa N+1" |

Sélecteur du type: popup au moment de la création + modifiable en cliquant sur le trait. Couleur + label texte dans l'UI pour être lisible par daltoniens.

### Style des traits
- **Bezier courbes** (pas orthogonal elbow). Un org chart non-hiérarchique lu en elbow devient illisible dès 10 traits qui se croisent. Les courbes pattern-matchent mieux le cerveau humain ("cet arc relie ça").
- Épaisseur 1.5px, 2.5px en hover / sélectionné.
- Arrowhead configurable par type (cf. tableau).
- Traits passent **sous** les cartes (z-index).

### Label sur le trait
Optionnel, ajouté au double-click sur le trait → input inline au milieu du trait, fond blanc pour masquer le trait dessous. Ex: "mentor depuis 2019", "ex-collègue Sanofi".

### Suppression
- Trait sélectionné (click) → highlight + Delete/Backspace au clavier.
- Alternative: icône poubelle qui apparaît au hover du milieu du trait.

### Auto-layout des traits
Oui. Quand une carte bouge, ses traits entrants/sortants recalculent leurs ancres (point le plus proche sur l'edge de la carte cible) et la courbe. Pas d'animation — snap instantané pendant le drag.

---

## 5. Persistance — modèle de données

### Positions des cartes
**Sur le document `contact`** (pas de collection séparée). Champs optionnels :
```
freeform_position: {
  x: Number,        // coord absolue dans le canvas
  y: Number,
  updated_at: ISO
}
```
Un champ par compte suffit : un contact appartient à une seule company. Pas besoin de clé composite.

Alternative rejetée: collection `freeform_layouts` avec `{ company_id, contact_id, x, y }` — surcomplique pour aucun gain (on n'a pas de besoin multi-layout par compte en phase 1).

### Connexions (traits)
**Nouvelle collection `connections`** — pas sur le contact.

```
connections: {
  _id,
  team_slug,
  company_id,        // pour query rapide
  source_contact_id,
  target_contact_id,
  type,              // 'reporting' | 'ally' | 'influence'
  label,             // string optional
  created_by,
  created_at,
  updated_at
}
```

Pourquoi pas en array embedded sur le contact (`connections: [{ target_id, type, label }]`) :
- Un trait est **bidirectionnel en lecture** (on le voit depuis A et depuis B). Dupliquer serait cauchemar ; stocker d'un côté seulement rend la query "toutes les connexions visibles" asymétrique.
- Suppression d'un contact → il faut purger les traits entrants depuis d'autres contacts : plus propre en collection dédiée avec un index sur `target_contact_id`.
- Futur (Phase 3): on peut vouloir des traits **entre contacts de comptes différents** ("Marina connaît le DG d'Ipsen chez Sanofi") — déjà prêt.

Index MongoDB nécessaires: `(company_id)`, `(source_contact_id)`, `(target_contact_id)`.

### Gestion des conflits niveaux ↔ freeform
- Changer `level` ou `position_in_level` en vue Niveaux → **n'invalide PAS** `freeform_position`. Les positions freeform sont indépendantes et sacrées.
- Supprimer un contact → cascade: purger ses connections, son `freeform_position` disparaît avec le doc.
- Ajouter un contact (via modal, Pipedrive sync, ou inline Freeform) → cf. §7.

---

## 6. Interactions clés

| Action | Vue Niveaux | Vue Freeform |
|---|---|---|
| **Click simple sur carte** | Sélection visuelle (outline) | Sélection |
| **Double-click sur carte** | Modal `contact-edit` (existant) | Modal `contact-edit` (même comportement — ne pas diverger) |
| **Drag carte** | Change `level` / `position_in_level` | Change `freeform_position` x/y |
| **Hover carte** | Affiche actions edit/delete (existant) | Affiche handles de connexion (4 edges) + actions edit/delete en overlay compact |
| **Click-drag sur vide** | Nop | Lasso de sélection |
| **Right-click carte** | (non implémenté) | Menu contextuel: Éditer, Dupliquer, Supprimer, Envoyer au front/arrière-plan |
| **Del / Backspace** | — | Supprime sélection (cartes ET traits sélectionnés) |
| **⌘A** | — | Sélectionne toutes les cartes |
| **⌘Z / ⌘⇧Z** | (inexistant) | Undo/Redo (stack de 50 opérations en mémoire, pas persisté) |

### Empty state Freeform (premier passage)
**Auto-layout intelligent** au premier switch Niveaux → Freeform : on calcule des positions initiales **à partir des levels** (Level 1 en haut, Level 5 en bas, spread horizontal), puis on sauve ces positions comme points de départ. Nicolas réarrange ensuite à la main.

Raison: un blank canvas avec 20 cartes à placer à la main = churn immédiat. L'auto-layout donne un squelette utilisable, Nicolas n'a plus qu'à **réarranger pour raconter sa vérité**.

Option cachée dans un menu "⋯" de la toolbar: **Reset layout** (retour à l'auto-layout hiérarchique, avec confirmation — ça efface les positions manuelles).

### Empty company (0 contacts)
Illustration centrée + CTA: "Ajoute ton premier contact" → ouvre modal `contact-create`. Même traitement qu'en vue Niveaux, pour la cohérence.

---

## 7. États & edge cases

### 0 contacts
Canvas vide avec background grille visible, illustration centrale (même que Niveaux vide), CTA "Ajouter un contact".

### 50+ contacts
- **Rendu SVG unique** (un seul `<svg>` qui contient les traits) → `HTMLDivElement` absolument positionnés pour les cartes (mix SVG/HTML).
- À 100+ contacts, activer **virtual culling** : ne rendre que les cartes dont la bounding box intersecte le viewport étendu de 200px. En phase 1, on ne l'implémente pas (0 compte atteint ce volume), on le documente pour Phase 3.
- Zoom out automatique au premier affichage (fit-to-content).

### Petit écran (laptop 13")
- Toolbar bottom-center reste compacte (~440px) → tient sur 1280px sans problème.
- Sidebar escamotable (déjà le cas dans l'app ?).
- Cartes à 240px: à 3 colonnes visibles en 100% zoom → acceptable. Nicolas peut zoomer out pour voir plus.

### Nouveau contact (Pipedrive sync / modal)
Positionnement de la nouvelle carte en Freeform:
1. Si un contact vient d'un **sync Pipedrive**: on le place en **zone tampon** à droite du cluster existant (x = max(x) + 280, y = moyenne), avec un **highlight pulsé** 3s pour que Nicolas le repère et le tire où il veut.
2. Si ajout **manuel via modal** et qu'on est en Freeform: on le pose au **centre du viewport actuel** (coord visibles par Nicolas).
3. Si ajout **manuel en Niveaux** puis switch Freeform: auto-layout selon level, pulse 2s sur les nouvelles cartes.

Dans les 3 cas: **jamais** de position `(0,0)` silencieuse — toujours visible au premier regard.

### Viewport perdu
Si Nicolas pan loin du contenu et se retrouve dans le vide : bouton toolbar **Fit to content** + raccourci `⌘0` (standard Figma). Un hint "Retour au contenu" apparaît au bout de 5s de viewport vide.

---

## 8. Benchmarks — ce qu'on emprunte à qui

| Outil | Ce qu'on prend |
|---|---|
| **tldraw** | Background grille pointillée, toolbar bottom-center, undo/redo natif, ressenti léger/rapide. Code OSS si besoin de s'inspirer (MIT). |
| **Figma / FigJam** | Zoom centré sur curseur, raccourcis `V`/`H`/`A`, `⌘0` fit, lasso, handles de connexion sur hover. |
| **Miro** | Pattern "drag depuis edge de carte pour créer un trait" (universellement compris), types de connecteurs colorés. |
| **Apple Freeform** | Feel "papier" / grille subtile, contraste bas, calme visuel — on garde l'esprit, pas la palette jaune. |
| **Kumu** (org network mapping) | Idée des **types de relations colorés** (reporting vs influence vs alliance). C'est leur coeur de métier. |
| **Whimsical** | Rapidité de création, courbes bezier par défaut (pas elbow), labels inline sur traits. |

On **n'emprunte pas** à Lucidchart (trop enterprise-lourd, toolbar latérale verbeuse) ni à Excalidraw (style hand-drawn — jure avec le reste de l'app, qui est propre/neutre).

---

## 9. Décisions UX tranchées

1. **Décision: Segment control (Niveaux / Freeform), pas switch iOS** — parce que les deux vues sont équivalentes, pas un on/off.
2. **Décision: Toggle placé sous le titre, pas dans la barre d'actions** — parce que c'est un changement de mode, pas une action destructive ou épisodique.
3. **Décision: Canvas infini, pas bounded** — parce que les gros comptes (30+) ont besoin d'espace et que le pattern est bien connu.
4. **Décision: Grille pointillée 24px, fond `#FAFAFA`** — parce que cohérence avec le reste de l'app et repère visuel au zoom sans bruit.
5. **Décision: Toolbar flottante bottom-center** — parce que libère le header existant et pattern mobile-first réutilisé sur desktop.
6. **Décision: Même composant `ContactCard`, pas un variant compact** — parce que 1 source de vérité visuelle et Phase 2 si vraiment besoin.
7. **Décision: Bezier courbes, pas elbow orthogonal** — parce qu'un graphe non-hiérarchique devient spaghetti en elbow dès 10 traits.
8. **Décision: 3 types de connecteurs (reporting / allié / influence), pas 1 ni 7** — parce qu'assez pour raconter une histoire, trop peu pour noyer.
9. **Décision: Connexions dans une collection MongoDB dédiée** — parce que bidirectionnel, purge propre, et futur cross-company.
10. **Décision: Positions freeform stockées sur le doc `contact`** — parce qu'une position = une valeur scalaire par contact, pas besoin d'indirection.
11. **Décision: Auto-layout au premier switch (seed depuis niveaux), pas blank canvas** — parce que réduit la friction initiale de 90%.
12. **Décision: Drag depuis handles d'edge pour créer un trait (Miro pattern)** — parce que pattern universellement appris, pas de tutoriel nécessaire.
13. **Décision: Zoom centré sur curseur (Figma), pas sur viewport (Miro)** — parce que Nicolas zoomera sur ce qu'il regarde, pas sur son centre d'écran.
14. **Décision: Pas de mini-map en phase 1** — parce qu'overkill à 30 contacts, à rouvrir si usage réel > 50.
15. **Décision: Modifier level en Niveaux N'INVALIDE PAS la position freeform** — parce que les deux vues sont indépendantes sémantiquement.
16. **Décision: SVG unique pour les traits, DIV absolus pour les cartes** — parce que le meilleur compromis perf/DX sans lib lourde.
17. **Décision: Pas de React Flow / D3 / cytoscape.js** — parce que stack Vue 3 no-build, SVG hand-rolled suffit jusqu'à 100 cartes.

---

## 10. Roadmap

### Phase 1 — MVP (livraison cette semaine)
Strict minimum pour une feature **utile dès le premier usage** :

1. **Toggle segment control** (Niveaux / Freeform) dans CompanyHeader, persisté localStorage.
2. **Canvas freeform** : pan, zoom, grille pointillée, fit-to-content, raccourcis ⌘0/⌘+/⌘−.
3. **Cartes draggable** en x/y libres, positions persistées sur `contact.freeform_position`.
4. **Auto-layout initial** seed-depuis-niveaux au premier passage (sauvegarde immédiate).
5. **Connecteurs** : création via drag-from-edge, **1 seul type visuel** (bezier gris + flèche), suppression via Delete. Collection `connections` complète (type = `'default'` pour l'instant). Stocker le type permet d'en ajouter sans migration en Phase 2.

### Phase 2 — Nice-to-haves (semaines 2-4)
- **3 types de connecteurs** colorés (reporting / allié / influence) + sélecteur au hover d'un trait.
- **Labels texte** sur les traits (double-click).
- **Undo/Redo** (stack 50 ops).
- **Lasso de sélection** + multi-drag.
- **Sticky notes / annotations libres** (texte posé sur le canvas, non lié à une carte).
- **Raccourcis clavier complets** (V, H, A, L, C).
- **Export du canvas en PNG** (via `<canvas>` rasterisation côté client).
- **Menu "⋯"** : reset layout, toggle snap-to-grid, toggle mini-map.

### Phase 3 — Avancé
- **Mini-map** avec viewport indicator.
- **Virtual culling** pour 100+ contacts.
- **Auto-suggestion de connections** via LLM sur les bio/titles ("Marina était chez Sanofi en 2018 comme Sandra — probable alliée ?").
- **Connexions cross-company** (tracer un trait entre un contact Ipsen et un contact Sanofi, visible dans les 2 comptes).
- **Collaboration temps réel** (multi-utilisateurs, curseurs, style Figma) — seulement si Nicolas invite une équipe SDR.
- **Historique / versions** du layout (snapshot mensuel).
- **Templates de layout** : "Décideurs au centre", "Par équipe", "Par niveau".

---

# Rapport de synthèse (≤ 150 mots)

**Toggle**: segment control 2 onglets `[Niveaux | Freeform]` sous le titre dans `CompanyHeader`, persisté en `localStorage` par `companyId`. Par défaut : Niveaux.

**Canvas**: fond `#FAFAFA` + grille pointillée 24px (style tldraw/Freeform), toolbar flottante bottom-center, zoom centré-curseur 25–400%, connecteurs **bezier courbes** avec handles au hover (drag-from-edge Miro-style).

**Données**: `contact.freeform_position { x, y }` embedded sur le contact ; **nouvelle collection `connections`** avec `{ company_id, source_id, target_id, type, label }` et index `(company_id)` + `(source_id)` + `(target_id)`.

**MVP Phase 1 (5 features)** :
1. Toggle + persistance viewport.
2. Canvas pan/zoom + grille.
3. Drag cartes avec positions persistées.
4. Auto-layout seed-depuis-niveaux au 1er passage.
5. Connecteurs 1-type drag-from-edge + suppression.

**À arbitrer par Nicolas avant dev**: (a) 1 ou 3 types de connecteurs en MVP ? (b) positions freeform **partagées dans l'équipe** ou **par utilisateur** ? (c) undo/redo en phase 1 ou 2 ?
