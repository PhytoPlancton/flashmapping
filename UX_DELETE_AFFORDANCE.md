# Delete Affordance — Sidebar Company Row

Owner: UX. Scope: `SwipeableCompanyItem` + `.swipe-row` / `.hover-cross` CSS. Target: Mac trackpad swipe + Windows hover parity. No auto-trigger. Refs: iOS Mail (swipe reveal, tap to confirm), Linear sidebar (hover actions outside content), Notion page row (`⋯` hover slot at stable right edge).

## 1. Diagnostic

La × n'est pas "décentrée" — elle *l'est* parce que `.hover-cross` mélange un SVG 12px dans un rond 22px sans `line-height:0` ni `svg { display:block }`, donc l'icône hérite du baseline text et glisse d'~1px bas. Surtout, `top:6px; right:6px` place le bouton **par-dessus** le chip P2 (même stacking, z-index 2) parce que le chip vit dans le flow à droite. Vrai problème : deux éléments se disputent le même slot top-right. Pas un bug de centrage — un bug de layout.

## 2. Solution — 3 options, tranche

**A. P2 à gauche sous le nom.** Libère le slot. Mais casse la hiérarchie scan (priorité = signal fort, doit rester aligné à droite comme une colonne). Reject.

**B. × à gauche du chip.** Sauve le chip mais ajoute du bruit permanent dans la row et resserre le texte tronqué. Reject.

**C. Dot-menu `⋯` qui swap le chip au hover, ouvre menu (Delete).** Extensible (Edit, Archive), pattern Notion. Overkill pour une seule action aujourd'hui, ajoute un click.

**D. Swap : au hover, P2 fade out, × prend sa place.** Zéro conflit de layout, le slot droit a un seul occupant à la fois, respecte la grille. Le coût : on perd P2 visuellement pendant le hover — acceptable car l'intent au hover = action, pas lecture.

**E. × flottante hors bounds.** Cheap sticker, clipping par `overflow:hidden` du `.swipe-row`. Reject.

**Choix : D**, avec repli C plus tard si d'autres actions s'ajoutent. Linear fait exactement ça sur ses rows.

## 3. Specs (Option D)

- Container `.hover-cross` : `position:absolute; top:50%; right:10px; transform:translateY(-50%); width:24px; height:24px; border-radius:9999px; padding:0; border:1px solid #E5E7EB; background:#FFFFFF; display:inline-flex; align-items:center; justify-content:center; z-index:3;`
- SVG : `width:12px; height:12px; display:block; stroke-width:2;` couleur `#6B7280`.
- Hover state : `background:#FEF2F2; border-color:#FCA5A5;` icône `#B91C1C`.
- Chip P2 : `transition: opacity 120ms ease;` — `.swipe-row:hover .priority-chip { opacity:0; }`, `.swipe-row:hover .hover-cross { opacity:1; }`.
- Active row (dark bg) : rond `background:#1F2937; border-color:#374151;` icône `#D1D5DB`.
- Pas de micro-confirm inline. Click = reveal `.swipe-row-action` à droite (même mécanisme que swipe).

## 4. Swipe behavior

- `REVEAL_STABLE = 60` → settle à −120px, spring `cubic-bezier(0.22,1,0.36,1)` 220ms. Révélé et figé.
- Supprimer `AUTO_DELETE`. `triggerDelete` uniquement sur click du bouton `.swipe-row-action`.
- Click ailleurs (doc listener déjà en place) ou tap sur la carte révélée = retract.
- Haptic (`navigator.vibrate(8)`) au click du bouton delete, pas au passage des 60/120px.
- `< 60px` au release : retract. Pas d'undo involontaire.

## 5. Consistency Mac ↔ Windows

Même cible, même pixel. Le click sur × (hover Windows) **ne delete pas** — il appelle `reveal()` : settle à −120px, exactement l'état post-swipe. Ensuite l'utilisateur clique le vrai bouton rouge `.swipe-row-action`. Un seul chemin de confirmation, un seul bouton rouge, quelle que soit l'entrée.

## 6. Accessibility

- Row focusable (`tabindex=0`). `Delete`/`Backspace` sur focus = `reveal()`. Second `Delete` sur le bouton révélé = trigger. `Escape` = retract.
- Bouton × : `aria-label="Afficher l'action supprimer"`. Bouton rouge : `aria-label="Supprimer {{company.name}}"`. Toast undo : `role="status"`, `aria-live="polite"`.
