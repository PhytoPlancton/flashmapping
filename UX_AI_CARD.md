# AI Card Redesign — "Générer un mapping IA" (Coming Soon)

## 1. Diagnostic visuel

La carte actuelle imite un CTA actif: gradient saturé, badge plein, hover qui *fonce* (signal "cliquable"). Rien ne dit "locked". Comparaisons:
- **Notion AI waitlist**: carte désaturée, badge outlined "Early access", icône locked discrète.
- **Linear Magic beta**: gradient figé + shimmer sweep ultra-lent, curseur `help`, texte "Coming to your workspace".
- **Arc "Coming soon"**: opacity globale ~0.85, dot pulsant, pas de hover fill — juste un glow.

Le signal manquant: **contraste entre "teaser vivant" (animation douce continue) et "pas actionnable" (curseur, opacity, lock icon).**

## 2. Signaux visuels "pas encore dispo" — combo retenu

Parmi 8 candidats, je garde **4 qui ne se cannibalisent pas**:

1. **`cursor: help`** (pas `not-allowed` qui est trop "erreur", pas `pointer` qui ment).
2. **Mini cadenas SVG** en overlay coin bas-droit du sparkle badge (12px, opacity 0.55) — remplace le "côté CTA" du badge.
3. **Opacity globale 0.92** + **filter: saturate(0.9)** en idle → signal "en sommeil".
4. **Dash-offset animé** sur la bordure dashed (SVG ou `background-image` linéaire) — sweep 8s, évoque "construction en cours".

Rejetés (redondants): watermark "BETA" angulaire (trop kitsch), overlay noir (ternit), shimmer + aurora ensemble (bruit visuel).

## 3. Hover effect — "Aurora sweep"

**Principe**: au hover, un **gradient conic violet/indigo/rose pâle** balaye le fond de gauche à droite sur **1.8s ease-out**, pendant qu'un **glow pulse doux** s'allume sous le sparkle icon (2.4s loop). Aucun `translateY`, aucun scale-up: la carte ne "lève" pas (elle n'est pas cliquable). Juste: **ça respire, ça brille, mais ça ne bouge pas**.

Inspirations: Claude.ai "thinking" shimmer + Stripe element focus glow.

## 4. État idle refait

- Background plus pâle/froid: `linear-gradient(95deg, #FAFAFE 0%, #F5F3FF 55%, #FAFAFE 100%)`
- Bordure dashed `#DDD6FE` (plus claire, moins saturée)
- Texte titre `#5B21B6` (était `#4C1D95` — légèrement moins opaque)
- Sous-titre `#A78BFA` (non-italique, kept ital optionnel)
- Opacity 0.92, saturate 0.92
- **Cadenas visible dès idle** (pas seulement hover) — c'est le signal fort

## 5. État `:active` (click)

Toast suffit côté info. Côté visuel, micro-shake horizontal **3px / 180ms** pour signaler "bloqué" physiquement (cf. macOS login wrong-password). **Pas** de scale-down (contredit "non-cliquable").

## 6. Code complet

### a. Markup (Sidebar.js)

```html
<div class="ai-mapping-row" role="button" aria-disabled="true"
     aria-label="Fonctionnalité IA bientôt disponible"
     title="Bientôt disponible" @click="onAiCardClick">
  <div class="ai-sparkle" aria-hidden="true">
    <span class="ai-sparkle-icon" v-html="icons.sparkles"></span>
    <span class="ai-sparkle-lock" aria-hidden="true">
      <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor">
        <path d="M4 5V3.5a2 2 0 114 0V5h.5A1.5 1.5 0 0110 6.5v3A1.5 1.5 0 018.5 11h-5A1.5 1.5 0 012 9.5v-3A1.5 1.5 0 013.5 5H4zm1 0h2V3.5a1 1 0 10-2 0V5z"/>
      </svg>
    </span>
  </div>
  <div class="ai-mapping-text">
    <div class="ai-mapping-name">Générer un mapping IA</div>
    <div class="ai-mapping-sub"><span class="ai-dot"></span>En développement</div>
  </div>
  <div class="ai-mapping-badge">BIENTÔT</div>
  <span class="ai-mapping-aurora" aria-hidden="true"></span>
</div>
```

### b. CSS (remplace bloc `.ai-mapping-row` existant)

```css
:root {
  --ai-violet: #7C3AED;
  --ai-violet-deep: #5B21B6;
  --ai-violet-soft: #A78BFA;
  --ai-violet-pale: #DDD6FE;
  --ai-bg-pale: #FAFAFE;
  --ai-bg-mid: #F5F3FF;
}

.ai-mapping-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 7px;
  margin: 1px 4px 4px 4px;
  cursor: help;
  background:
    linear-gradient(95deg, var(--ai-bg-pale) 0%, var(--ai-bg-mid) 55%, var(--ai-bg-pale) 100%);
  border: 1px dashed var(--ai-violet-pale);
  font-family: inherit;
  min-height: 48px;
  box-sizing: border-box;
  overflow: hidden;
  opacity: 0.94;
  filter: saturate(0.92);
  transition: opacity 220ms ease, filter 220ms ease, border-color 220ms ease;
  isolation: isolate;
}

/* Animated dashed border via background-image (defilement) */
.ai-mapping-row::before {
  content: "";
  position: absolute; inset: 0;
  border-radius: inherit;
  padding: 1px;
  background:
    repeating-linear-gradient(90deg, var(--ai-violet-pale) 0 6px, transparent 6px 12px);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  background-size: 24px 100%;
  animation: ai-dash-flow 8s linear infinite;
  pointer-events: none;
  opacity: 0.9;
  z-index: 1;
}
@keyframes ai-dash-flow {
  to { background-position: 24px 0; }
}

/* Aurora sweep overlay (hover) */
.ai-mapping-aurora {
  position: absolute; inset: 0;
  border-radius: inherit;
  background:
    linear-gradient(110deg,
      transparent 0%,
      rgba(196,181,253,0.0) 30%,
      rgba(196,181,253,0.55) 50%,
      rgba(244,114,182,0.25) 60%,
      transparent 80%);
  background-size: 220% 100%;
  background-position: -60% 0;
  opacity: 0;
  transition: opacity 280ms ease;
  pointer-events: none;
  z-index: 0;
  will-change: background-position, opacity;
}
.ai-mapping-row:hover {
  opacity: 1;
  filter: saturate(1);
  border-color: transparent; /* pseudo handles it */
}
.ai-mapping-row:hover .ai-mapping-aurora {
  opacity: 1;
  animation: ai-aurora-sweep 1.8s cubic-bezier(.22,.61,.36,1) forwards;
}
@keyframes ai-aurora-sweep {
  0%   { background-position: -60% 0; }
  100% { background-position: 160% 0; }
}

/* Sparkle badge + nested lock */
.ai-mapping-row .ai-sparkle {
  position: relative;
  width: 22px; height: 22px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--ai-violet) 0%, #4F46E5 100%);
  color: #fff;
  box-shadow: 0 1px 2px rgba(124,58,237,0.2);
  z-index: 2;
}
.ai-mapping-row .ai-sparkle svg { width: 13px; height: 13px; }
.ai-mapping-row .ai-sparkle-lock {
  position: absolute;
  right: -3px; bottom: -3px;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: #fff;
  color: var(--ai-violet-deep);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 1px 2px rgba(17,24,39,0.15);
  opacity: 0.9;
}
.ai-mapping-row .ai-sparkle-lock svg { width: 7px; height: 7px; }

/* Glow pulse under sparkle on hover */
.ai-mapping-row:hover .ai-sparkle {
  animation: ai-glow-pulse 2.4s ease-in-out infinite;
}
@keyframes ai-glow-pulse {
  0%, 100% { box-shadow: 0 1px 2px rgba(124,58,237,0.2), 0 0 0 0 rgba(124,58,237,0.0); }
  50%      { box-shadow: 0 1px 2px rgba(124,58,237,0.25), 0 0 10px 2px rgba(124,58,237,0.28); }
}

/* Text */
.ai-mapping-row .ai-mapping-text { min-width: 0; flex: 1; text-align: left; position: relative; z-index: 2; }
.ai-mapping-name {
  display: block; font-size: 13px; font-weight: 500;
  color: var(--ai-violet-deep); line-height: 1.25;
}
.ai-mapping-sub {
  display: flex; align-items: center; gap: 5px;
  font-size: 10.5px; color: var(--ai-violet-soft);
  letter-spacing: 0.01em;
}
.ai-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #F59E0B;
  box-shadow: 0 0 0 0 rgba(245,158,11,0.5);
  animation: ai-dot-pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes ai-dot-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.5); }
  50%      { box-shadow: 0 0 0 4px rgba(245,158,11,0); }
}

/* Badge: outlined instead of filled — reinforces "teaser" */
.ai-mapping-badge {
  position: relative; z-index: 2;
  flex-shrink: 0;
  font-size: 9px; font-weight: 700; letter-spacing: 0.06em;
  color: var(--ai-violet-deep);
  background: rgba(255,255,255,0.7);
  border: 1px solid var(--ai-violet-pale);
  padding: 2px 6px; border-radius: 4px; line-height: 1.3;
}

/* Active click — shake */
.ai-mapping-row:active { animation: ai-shake 180ms ease-in-out; }
@keyframes ai-shake {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-2px); }
  75%      { transform: translateX(2px); }
}

/* Focus-visible (keyboard) */
.ai-mapping-row:focus-visible {
  outline: 2px solid var(--ai-violet);
  outline-offset: 2px;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .ai-mapping-row::before,
  .ai-mapping-row:hover .ai-sparkle,
  .ai-dot,
  .ai-mapping-row:hover .ai-mapping-aurora,
  .ai-mapping-row:active {
    animation: none !important;
  }
  .ai-mapping-row:hover .ai-mapping-aurora { opacity: 0.5; }
}
```

## 7. Accessibilité

- `role="button"` + `aria-disabled="true"` → lecteurs d'écran annoncent "bouton désactivé".
- `aria-label` explicite: "Fonctionnalité IA bientôt disponible".
- `:focus-visible` → outline violet 2px.
- `prefers-reduced-motion` → anims coupées, aurora reste en statique léger.
- Contraste texte: `#5B21B6` sur fond `#FAFAFE` = 8.4:1 (AAA).

---

## Rapport (résumé interne)

**Signaux "bloqué" retenus**: (1) `cursor: help`, (2) mini-cadenas sur le sparkle badge, (3) opacity/saturate réduits en idle, (4) dash-offset animé + badge "BIENTÔT" outlined (au lieu de plein) + dot orange pulsant.

**Hover effect**: **Aurora Sweep** — gradient violet/rose qui balaye 1.8s ease-out + glow pulse 2.4s sur l'icône sparkle. Pas de lift/scale (la carte n'est pas cliquable). Ça respire, ça brille, ça ne ment pas.

**Prêt à implémenter**: oui. Markup = 3 éléments ajoutés (lock SVG, dot span, aurora overlay). CSS = drop-in replacement du bloc `.ai-mapping-row`. Zéro JS, zéro dépendance, a11y couverte (reduced-motion, focus-visible, aria-disabled).
