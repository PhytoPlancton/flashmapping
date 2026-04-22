# UX Redesign — Paramètres, Onboarding & Sidebar

Design doc / IA seule. Pas de code. Inspirations : Notion (Settings), Linear (Teams switcher + Workspaces), Attio (Integrations). Audience : Nicolas (SDR, muchbetter.ai) + sa future team (Charles, Théo, Max).

---

## 1. Diagnostic rapide

L'IA actuelle mélange trois notions dans un même tab "Équipe" : **l'équipe courante** (nom, membres, invitations), **les intégrations** (Pipedrive enfoui dedans comme une sous-section), et **la danger zone** (quitter/supprimer). Nicolas n'a donc **aucun endroit pour "voir ses équipes"** — le switcher top-sidebar n'affiche qu'une liste plate, et Settings ne montre qu'une team à la fois. Résultat : créer une 2e team exige de passer par l'onboarding (qui n'a pas de retour). Les intégrations, elles, doivent scaler à 3-4 CRMs mais vivent dans une section scrollée. Bref : **pas de niveau "toutes mes équipes"**, et **pas de niveau "tous mes CRMs"**.

---

## 2. Nouvelle IA — structure des écrans

### 2.1 Sidebar principale (280px, inchangée en largeur)

```
┌─ Sidebar ────────────────────────┐
│ [TeamSwitcher]  ← team courante  │  ← clic = dropdown teams + "Gérer les équipes"
├──────────────────────────────────┤
│ COMPTES                     (23) │
│ ┌──────────────────────────────┐ │
│ │ Novo Nordisk           [P1+] │ │  ← swipe / hover = delete
│ │ Sanofi                 [P1]  │ │
│ │ … (scroll)                   │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│ [+ Ajouter compte]               │
├──────────────────────────────────┤
│ [Avatar] Nicolas           (menu)│  ← Profil, Paramètres, Logout
└──────────────────────────────────┘
```

Le switcher garde sa place (top-left). Le user menu garde sa place (bottom). Les **comptes** au milieu.

### 2.2 Hiérarchie Paramètres (tabs niveau 1)

```
Paramètres
├── Profil                  → mon compte utilisateur (indépendant des teams)
├── Équipes                 → liste de TOUTES mes teams + gestion
│    └── [Équipe X]         → détail : membres, invitations, rename, leave/delete
├── Intégrations            → liste de TOUS les CRMs de la team courante
│    └── [Pipedrive]        → détail : config, status
│    └── [+ Ajouter]        → picker (HubSpot, Salesforce, …)
└── Apparence               → thème clair/sombre, densité (optionnel, à trancher)
```

**Tabs top-level = 4** (Profil, Équipes, Intégrations, Apparence). "Apparence" peut sauter si YAGNI — je penche pour le garder plus tard, pas en V2.

### 2.3 Navigation inter-teams

Deux entrées redondantes volontaires :
- **TeamSwitcher (top sidebar)** → switch rapide (1 clic). Aussi : "Gérer les équipes" → route `#/settings/teams` (la vue liste).
- **Paramètres > Équipes** → vue management (créer, renommer, quitter, supprimer, voir qui est dedans). C'est **la** source de vérité.

L'onboarding (`#/onboarding`) reste un écran dédié sans sidebar, accessible :
- Au premier login (has_teams=false)
- Depuis le switcher → "+ Créer / rejoindre une équipe"
- Depuis Paramètres > Équipes → bouton "+ Nouvelle équipe" / "+ Rejoindre"

### 2.4 Où vivent les Intégrations

Tab top-level **propre** (plus imbriqué dans Équipe). Scope = **team courante** (parce qu'une clé API Pipedrive appartient à une team). Header du tab affiche "Intégrations de *muchbetter.ai*" pour éviter la confusion avec "mes intégrations à moi".

### 2.5 "Paramètres équipe courante" vs "Mes teams"

- **Paramètres > Équipes** (liste) = vue d'ensemble de toutes les teams dont je suis membre.
- **Paramètres > Équipes > [team]** (détail) = configuration de cette team (indépendamment de la team "courante" sélectionnée pour naviguer dans les comptes).

Subtilité : je peux éditer la team *Beta* depuis Paramètres même si ma team courante est *muchbetter.ai*. Ça évite le switch-puis-edit. Linear fait pareil (Settings > Teams > clic sur une team).

---

## 3. Wireframes textuels

### 3.1 Paramètres > Équipes (vue liste)

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Retour                                                        │
│                                                                 │
│ Paramètres                                                      │
│ ─────────────────────────────────────────────────────────────   │
│ [Profil] [Équipes●] [Intégrations] [Apparence]                  │
│                                                                 │
│ Mes équipes (2)                        [+ Rejoindre] [+ Créer]  │
│                                                                 │
│ ┌─ muchbetter.ai ────────────────────────────── ACTIVE ──────┐  │
│ │ [MB]  muchbetter.ai           Owner • 4 membres • 23 cptes │  │
│ │       muchbetter-ai                                        │  │
│ │                                         [Gérer →]          │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                 │
│ ┌─ Pharma Beta ──────────────────────────────────────────────┐  │
│ │ [PB]  Pharma Beta             Membre • 12 membres • 45 cpt │  │
│ │       pharma-beta                      [Basculer] [Gérer →]│  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                 │
│ Empty state :                                                   │
│   Illustration discrète + "Tu n'es dans aucune équipe"          │
│   + gros CTA "Créer ma première équipe"                         │
└─────────────────────────────────────────────────────────────────┘
```

- **Colonne unique centrée**, max-width 768px (comme l'actuel).
- **TeamListCard** : avatar (initiales), nom, slug gris mono, rôle chip, compteur membres, compteur comptes, CTA "Gérer". Un badge "ACTIVE" (pastille verte) sur la team courante.
- Actions : `[Basculer]` (secondaire) visible si ≠ active, `[Gérer →]` (primary ghost).
- Loading : skeleton de 2 cards grises.
- Error : toast + bouton "Réessayer" inline.

### 3.2 Paramètres > Équipes > [muchbetter.ai]

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Paramètres / Équipes / muchbetter.ai                          │
│                                                                 │
│ [MB]  muchbetter.ai   [Owner]                                   │
│ muchbetter-ai                                    [Basculer sur] │
│                                                                 │
│ ─ Informations ──────────────────────────────────────────────   │
│   Nom                       Slug                                │
│   [muchbetter.ai     ✎]     muchbetter-ai (read-only)           │
│                                                                 │
│ ─ Membres (4)                              [+ Inviter]  ─────   │
│   [N] Nicolas Monniot      nicolas@…           Owner            │
│   [C] Charles Durand       charles@…           Admin    [v] [x] │
│   [T] Théo Lambert         theo@…              Membre   [v] [x] │
│   [M] Max Reynaud          max@…               Membre   [v] [x] │
│                                                                 │
│ ─ Invitations actives (2)                  [+ Nouvelle] ─────   │
│   XKCD9A7B3F   Admin   Expire 12 mai   1/3 utilisations [Copier]│
│   9HQ2L4P8WN   Membre  Expire 30 avril  0/1              [Copier│
│                                                                 │
│ ─ Zone dangereuse (rouge pâle) ─────────────────────────────    │
│   Quitter l'équipe                              [Quitter]       │
│   (ou si owner :)                                               │
│   Supprimer l'équipe — irréversible.                            │
│   Tape le nom : [muchbetter.ai____________] [Supprimer]         │
└─────────────────────────────────────────────────────────────────┘
```

- Breadcrumb en haut cliquable.
- Edit inline du nom (stylo icon → input + save/cancel).
- Membres : rôle = select inline pour admins. Non-owner + non-self peut être retiré.
- Invitations : code en mono-font, `[Copier]` + `[Révoquer]` inline.
- Zone dangereuse : bordure `border-red-200`, fond `bg-red-50/30`. Type-to-confirm pour delete (déjà en place).

### 3.3 Paramètres > Intégrations (liste)

```
┌─────────────────────────────────────────────────────────────────┐
│ [Profil] [Équipes] [Intégrations●] [Apparence]                  │
│                                                                 │
│ Intégrations de muchbetter.ai                    [+ Ajouter]    │
│ Connecte un CRM pour synchroniser tes comptes et contacts.      │
│                                                                 │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ [PD icon]  Pipedrive            ● Connecté               │   │
│ │            muchbetter.pipedrive.com · depuis 12 avril    │   │
│ │                                            [Configurer →]│   │
│ └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│ DISPONIBLES (grisés, clic = "Bientôt disponible")               │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ [HS]  HubSpot             Bientôt                [Notif] │   │
│ │ [SF]  Salesforce          Bientôt                [Notif] │   │
│ └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

- **Section "Connectées"** en haut + **"Disponibles"** en dessous (greyed).
- Status dot : vert = connecté, gris = non configuré, rouge = erreur d'auth.
- `[+ Ajouter]` ouvre un modal picker listant les CRMs supportés (pour futur : HubSpot, Salesforce, …). Pour V2 : ne montrer que Pipedrive comme installé, les autres sous un badge "Bientôt".

### 3.4 Paramètres > Intégrations > Pipedrive

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Paramètres / Intégrations / Pipedrive                         │
│                                                                 │
│ [PD icon]  Pipedrive                            ● Connecté      │
│            Synchro de comptes et contacts                       │
│                                                                 │
│ ─ Compte connecté ──────────────────────────────────────────    │
│   Domaine        muchbetter.pipedrive.com                       │
│   Utilisateur    Nicolas Monniot (owner)                        │
│   Connecté le    12 avril 2026                                  │
│   Source         Clé API team                                   │
│                                     [Déconnecter] [Tester]      │
│                                                                 │
│ ─ Paramètres de synchronisation (futur) ────────────────────    │
│   [ ] Sync automatique tous les X…                              │
│   Mapping des champs : [Ouvrir]                                 │
│                                                                 │
│ ─ État (futur) ─────────────────────────────────────────────    │
│   Dernière synchro : il y a 2h   [Voir les logs]                │
└─────────────────────────────────────────────────────────────────┘
```

- Si non connecté : form `Clé API` + lien "Où trouver ma clé ?" + bouton `[Tester + Enregistrer]`.
- Empty state = formulaire directement visible, pas de wrapper "Connecter" supplémentaire.
- Error state : toast + inline red box sous le champ.

### 3.5 Onboarding avec back button

```
┌─────────────────────────────────────────────────────────────────┐
│  [← Retour]         Pharma Mapping            nicolas@… [Logout]│  ← header
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                  Bienvenue sur Pharma Mapping                   │
│           Rejoins une équipe ou crée la tienne                  │
│                                                                 │
│   ┌─ Créer une équipe ─────┐  ┌─ Rejoindre une équipe ─────┐    │
│   │  [+]                   │  │  [🏢]                      │    │
│   │  Nom de l'équipe       │  │  Code d'invitation         │    │
│   │  [muchbetter.ai____]   │  │  [XXXXXXXXXX______]        │    │
│   │  [Créer l'équipe]      │  │  [Rejoindre]               │    │
│   └────────────────────────┘  └────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- **Back button** en haut-gauche :
  - Si `store.teams.length > 0` → retour sur dernière team active (`#/{slug}/companies`).
  - Si `store.teams.length === 0` → bouton **caché** (c'est un blocking onboarding).
- Si arrivée depuis Paramètres → retour sur `#/settings/teams` (stocker l'origine dans sessionStorage).

### 3.6 Sidebar account card — idle / swiped / hover Windows

**État idle (trackpad ou Windows)** :
```
┌────────────────────────────────────┐
│ Novo Nordisk                 [P1+] │
│ 12 contacts · ★ 3                  │
└────────────────────────────────────┘
```

**État swiped (Mac trackpad, swipe gauche)** :
```
┌────────────────────────────────────┐
│ Novo Nordisk    [P1+]│ [🗑] [Supp] │
│ 12 contacts · ★ 3    │             │
└────────────────────────────────────┘
         ←──── carte translate-x
```
- Carte glisse de 100-120px vers la gauche, révélant une **zone rouge** `bg-red-500` contenant icône corbeille (gris clair) + label "Supprimer" (blanc, bold, 12px).
- Swipe > 60px = reste révélé (stable). Swipe > 120px = auto-confirm (confirmation modal quand même, voir décisions).
- Tap ailleurs = rétraction (spring animation, ~180ms).

**État hover Windows/desktop no-touch** :
```
┌────────────────────────────────────┐
│ Novo Nordisk                 [P1+] │
│ 12 contacts · ★ 3             [×]  │ ← croix top-right, opacity 0→1
└────────────────────────────────────┘
```
- Croix `×` 14px dans un circle 20px, `bg-white border-ink-200`, position absolute top-right avec 6px padding.
- Opacity 0 idle, 1 hover, transition 120ms.
- Click → confirmation modal identique à swipe.

**Confirmation** (modal) :
> Supprimer **Novo Nordisk** ? 12 contacts seront aussi supprimés. Cette action est irréversible.
> `[Annuler]` `[Supprimer]` (rouge)

---

## 4. Flows

### 4.1 "Je veux créer une 2e équipe"
1. Switcher top-sidebar → clic → dropdown → **"+ Créer / rejoindre une équipe"** OU Paramètres > Équipes → **[+ Créer]**.
2. Route `#/onboarding?from=settings` (source stockée).
3. Formulaire Create → POST `/api/teams` → switch auto vers la nouvelle team → redirect `#/{slug}/companies`.
4. Toast "Équipe créée". Sidebar se recharge (0 comptes, empty state).

### 4.2 "Je suis dans la mauvaise équipe, je veux switcher"
1. Clic sur TeamSwitcher (top-sidebar).
2. Dropdown affiche mes teams + "Gérer les équipes" + "+ Créer / rejoindre".
3. Clic sur une team → `store.switchTeam(slug)` → URL devient `#/{slug}/companies` → sidebar recharge comptes → toast discret "Équipe active : X".

### 4.3 "Je suis owner et je veux supprimer l'équipe"
1. Paramètres > Équipes > [team] → scroll bas → Zone dangereuse.
2. Section rouge "Supprimer l'équipe" avec input type-to-confirm.
3. Tape exactement le nom de la team → bouton `[Supprimer]` s'active.
4. Click → confirmation modale native (`confirm()`) **en plus** (double safety) avec texte "Cette action supprimera X comptes et Y contacts. Continuer ?".
5. DELETE `/api/teams/{slug}` → redirect vers :
   - Autre team si j'en ai → `#/{autre-slug}/companies`
   - Sinon `#/onboarding` (forcé, pas de back button visible)

### 4.4 "Je veux ajouter HubSpot (futur)"
1. Paramètres > Intégrations → `[+ Ajouter]`.
2. Modal picker avec grille de 3-6 cards (Pipedrive, HubSpot, Salesforce…).
3. Click HubSpot → route `#/settings/integrations/hubspot` → formulaire OAuth / API key (design identique à Pipedrive pour consistency).
4. Back to Intégrations → HubSpot apparaît dans "Connectées".

L'UI scale parce que la liste est vertical-first, chaque CRM = une card. Pas de tabs dans Intégrations.

### 4.5 "Je veux supprimer un compte de la sidebar"
- **Mac** : swipe 2 doigts gauche sur la carte → zone rouge révélée → tap sur `[Supprimer]` → modal confirm → DELETE + toast undo (5s).
- **Windows/desktop** : hover carte → croix `×` top-right → click → modal confirm → DELETE + toast undo.
- **Toast undo** : `Compte "Novo Nordisk" supprimé. [Annuler]` (5s timeout, background noir, bouton "Annuler" blanc).
- Si undo cliqué → re-POST (requires backend support : soft-delete OU optimistic re-create from cached data).

### 4.6 "Je suis bloqué sur l'onboarding, retour à mes équipes"
- Si j'ai des teams : `[← Retour]` top-left → retour sur `#/{lastTeamSlug}/companies`.
- Si je viens de Paramètres : retour sur `#/settings/teams`.
- Si 0 teams : pas de back (bloqué par design — c'est le onboarding initial).

---

## 5. Décisions UX tranchées

1. **Le switcher de teams reste top-sidebar** (muscle memory Notion/Linear). La page "Équipes" est secondaire, pour la gestion, pas le switch rapide.
2. **Tabs top-level Paramètres = 4** : Profil / Équipes / Intégrations / Apparence. Pas plus, pas de sous-tabs — Notion-style.
3. **"Équipes" est plural dans la nav**, même si l'user n'en a qu'une. Montrer l'intention de scale.
4. **Intégrations sort de Équipe** parce que le scope diffère (une intégration = team-scoped mais conceptuellement parallèle aux membres, pas en dessous).
5. **Type-to-confirm pour Delete team** (déjà en place) + double confirm natif. Parce que cascade delete = catastrophe si clic accidentel.
6. **Leave team = confirm simple** (natif), pas de type-to-confirm. Moins destructif, réversible via invite.
7. **Swipe-to-delete seuil** : 60px = révélé stable, 120px = auto-trigger (mais toujours avec confirm modal, jamais auto-destructif). Inspiration iOS Mail.
8. **Hover cross sur Windows** : opacity 0→1 en 120ms, **pas** affichée sur mobile/touch (détecter via `matchMedia('(hover: hover)')`).
9. **Toast undo 5s pour delete compte**. Standard Linear/Gmail. Meilleur UX que confirm-then-delete sans retour.
10. **Pas de breadcrumb en sidebar** mais un breadcrumb textuel dans les écrans Settings profonds (`Paramètres / Équipes / muchbetter.ai`).
11. **Back button onboarding caché si 0 teams**. Parce que sinon l'user peut se coincer dans un état invalide (app sans team).
12. **Un seul "primary" par écran** : bouton `btn-primary` noir (`bg-ink-900`). Les actions secondaires = `btn-secondary` (blanc + border). Danger = `btn-danger` (rouge). Pas de primary rouge.

---

## 6. Composants réutilisables proposés

| Composant | Rôle |
|---|---|
| `SettingsShell.js` | Layout commun : header (titre + back), row de tabs, slot pour contenu. Gère le routing entre tabs via hash `#/settings/<tab>`. |
| `SettingsTabs.js` | Les 4 tabs horizontaux (Profil, Équipes, Intégrations, Apparence), active state, keyboard nav. |
| `TeamListCard.js` | Card single team dans la liste : avatar, nom, slug, rôle, compteurs, CTA Gérer/Basculer. |
| `TeamDetailView.js` | Détail d'une team : Informations / Membres / Invitations / Danger zone. Extrait de l'actuel `Settings.js` tab "Team". |
| `MemberRow.js` | Une ligne membre (avatar, nom, email, rôle select, bouton retirer). Déjà quasi-existant. |
| `InviteRow.js` | Une ligne invite (code mono, rôle, expire, copier, révoquer). |
| `IntegrationListCard.js` | Card single intégration : logo, nom, status dot, subtitle, CTA Configurer. |
| `IntegrationPipedriveView.js` | Détail Pipedrive (extrait de l'actuel `Settings.js`). |
| `IntegrationPicker.js` | Modal de choix nouveau CRM (grille de logos). |
| `SwipeableCompanyItem.js` | Wrapper autour d'une row sidebar, gère touch/swipe + hover cross + delete action. |
| `ConfirmDangerModal.js` | Modal générique avec type-to-confirm (texte attendu en prop). |
| `UndoToast.js` | Toast avec action "Annuler" cliquable + countdown 5s. |
| `EmptyState.js` | Composant générique : illustration + titre + sous-titre + CTA primaire. Réutilisé partout (Équipes vide, Comptes vide, Intégrations vide). |
| `BackLink.js` | Flèche + label + gestion de l'historique (fallback route si `history.back()` non safe). |

---

## 7. Contraintes & TODOs dev

### Backend (nouvelles routes / modifs)

- **DELETE compte avec undo** : soit soft-delete (`deleted_at`) + endpoint `POST /api/.../companies/{id}/restore`, soit frontend cache + re-POST manuel. Je recommande soft-delete avec purge après 24h (cron).
- **GET /api/teams** : retourner déjà `members_count` et `companies_count` par team pour éviter des N+1 dans la vue liste. Sinon ajouter un endpoint d'agrégation.
- **Route `/api/integrations`** (futur) : endpoint listant les intégrations connectées de la team courante. Pour V2, on peut rester sur `/api/teams/{slug}/integrations/pipedrive/*`.
- **Onboarding origin** : pas besoin côté backend, purement front (sessionStorage ou query param `?from=settings`).
- **Leave team pour owner** : bloquer avec erreur explicite "Transférer la propriété d'abord". Pas besoin d'endpoint transfer pour V2, mais le message d'erreur doit être clair.

### Frontend (pur front)

- Router : ajouter sous-routes settings :
  - `#/settings` → redirect `#/settings/profile`
  - `#/settings/profile`
  - `#/settings/teams`
  - `#/settings/teams/{slug}`
  - `#/settings/integrations`
  - `#/settings/integrations/{key}` (key = `pipedrive`)
- Store : ajouter `store.lastVisitedTeamSlug` pour les redirects (onboarding → back, delete team → fallback).
- Swipe gesture : utiliser events `touchstart/touchmove/touchend` + `pointerdown/move/up` (covers trackpad horizontal two-finger scroll sur Mac via `wheel` avec `deltaX`). Tester sur magic trackpad.
- Media query `(hover: hover)` pour afficher/masquer la croix Windows.
- Focus management : back button = focusable, Escape key dans onboarding déclenche back si visible.
- Toast undo : stocker en mémoire le payload deleted pour le restore côté client si pas de soft-delete backend.

### Ambiguïtés à arbitrer avec Nicolas

1. **Soft-delete company vs hard-delete** ? (impacte undo toast)
2. **Tab "Apparence" en V2** ou on remet à plus tard ?
3. **Multi-CRM en même temps** ou un seul connecté par team (exclusif) ? L'UI suppose multi, le backend actuel suppose 1.
4. **Swipe auto-confirm à 120px** = supprime direct sans modal, OU garde toujours le modal ? (Je recommande : garde toujours le modal pour V2, on verra pour la V3.)
5. **Un user dans 0 team après leave/delete** : force onboarding OU propose une vue "vide" ? (Actuel code force onboarding, je garde.)

---

*Document rédigé pour orienter la V3 du front. Le dev vient après.*
