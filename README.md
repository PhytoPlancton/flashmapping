# Pharma P2 Account Mapper

Outil de mapping des comptes pharma P2 pour muchbetter.ai × TechToMed.
Produit un XLSX Pipedrive-ready (feuilles **Organizations** + **People** + **Légende**).

## Résultat actuel

`out/mapping_P2_2026-04-20.xlsx` — 13 comptes P2, 236 contacts mappés & classifiés.

## Workflow

```bash
# 1. Prépare la liste des comptes depuis le CSV CRM
python3 account_mapper.py prepare "/path/to/CRM muchbetter.ai x TechToMed - Entreprises.csv"
# → data/accounts.json + liste des slugs à enrichir

# 2. (via Claude Code) enrichir chaque compte via MCP
#    → Claude appelle find-and-enrich-contacts-at-company avec un filtre
#      targeted ICP, puis écrit data/enrichment/<slug>.json

# 3. Produire le XLSX final (classification + dédup + tri par ICP score)
python3 account_mapper.py process
# → out/mapping_P2_YYYY-MM-DD.xlsx
```

## Architecture

| Fichier | Rôle |
|---|---|
| `account_mapper.py` | orchestrateur CLI (prepare / process) |
| `parse_crm_csv.py` | lit le CSV, extrait contacts TechToMed de la col. Commentaires |
| `roles_taxonomy.py` | classifie un job title → séniorité, catégories, aire thérapeutique, C-Level/BU/MoM flags, score ICP |
| `build_xlsx.py` | écrit le XLSX avec feuilles Orgs, People, Légende (style Pipedrive) |
| `ingest_mcp.py` | helper pour transformer une réponse MCP raw → schéma enrichment |
| `companies.yaml` | mapping manuel compte → domain (nécessaire pour `find-and-enrich-*`) |

## Priority Score (0-100)

Favorise l'ICP muchbetter.ai: **Digital/Data/AI + C-Level + BU Head** en haut.

| Bonus | Points |
|---|---|
| C-Level flag | +40 |
| Digital / Transformation | +30 |
| Data / AI | +25 |
| Commercial Excellence | +20 |
| IT / IS, BU Head, VP séniorité | +15 |
| Medical Affairs, Market Access | +10 |
| Head / Director séniorité | +10 |
| Senior Director | +5 |
| Manager | +2 |

## Import Pipedrive

- **Feuille Organizations** → Pipedrive > Import > Organizations.
  Colonnes standard (Name, Website, Label, Address, Phone) + custom fields (CRM_ID, Priorité, Statut CRM, PIC, Next Step, Aires thérapeutiques, etc.) à mapper à l'import.
- **Feuille People** → Pipedrive > Import > People.
  Colonnes standard (Name, Email, Phone, Organization, Job Title, Label) + custom fields (Séniorité, Catégorie rôle, Aire thérapeutique, flags C-Level / BU Head / MoM, Priority Score, Source TechToMed/MCP, Déjà connu).
- Label sur Org = Priorité (P1/P2/P3). Label sur People = Catégorie rôle + "TechToMed" si déjà connu.
- Colonne **Décideur ou Influenceur** volontairement vide — à remplir sur le terrain.

## Légende des flags

- **Flag C-Level** : CEO, Chief X, Président (hors "Vice President"), DG France/Country Manager/General Manager.
- **Flag Manager-de-managers (MoM)** : heuristique VP+ ou Senior Director + ou Head of (Global/EMEA). *À valider sur le terrain*.
- **Flag BU Head** : responsable d'une Business Unit thérapeutique (oncologie, obésité, etc.), détecté via titre.

## À ajouter si besoin

- Enrichir avec emails via `dataPoints: [{type: "Email"}]` dans find-and-enrich-contacts-at-company (coût supplémentaire).
- Ajouter P3 ou comptes non-priorisés: `python3 account_mapper.py prepare <csv> --priority P2 P3`.
- Re-générer un compte: supprimer son JSON dans `data/enrichment/` et relancer l'enrichissement.
