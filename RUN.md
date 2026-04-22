# Pharma Mapping App — Run Instructions

## One-time setup (already done)

```bash
cd /Users/nicolasmonniot/Documents/CODE/mapping
python3 -m pip install --user -r backend/requirements.txt
python3 -m pip install --user eval_type_backport   # Python 3.9 compat
```

## Daily start

```bash
cd /Users/nicolasmonniot/Documents/CODE/mapping/backend
python3 -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000/** in your browser.

## First-run

- App detects 0 users → shows "Créer le premier compte" (Register form)
- First account becomes admin automatically
- After login → sidebar is empty; click user menu → **Seed** to import the 13 P2 companies from `data/enrichment/*.json`
  - (Or via curl: `curl -X POST http://127.0.0.1:8000/api/admin/seed -H "Authorization: Bearer $TOKEN"`)

## Current state (2026-04-20)

- **Admin user**: nicolas@muchbetter.ai / muchbetter2026 *(change this!)*
- **Seeded**: 13 companies, 236 contacts, 19 TechToMed matches flagged

## Features

- **Sidebar**: 13 P2 companies sorted by priority + nb TechToMed, click to open
- **Org tree**: 5 levels (L1 PDG → L5 Manager), level 6 IC hidden behind toggle
- **Drag & drop**: drop card on another level row to reclassify, drop within row to reorder — saved via `POST /api/contacts/{id}/move`
- **CRUD contact**: click card → edit modal; trash icon → delete (2-click confirm); "+ Ajouter contact" → create modal
- **Auto-classification**: in the modal, typing a title triggers (500ms debounce) `/api/taxonomy/classify` → prefills level + category
- **Filters**: category chips (click to toggle), "TechToMed only", "ICP only" (ICP = c_level + digital + data_ai + commercial)
- **CRUD company**: "+ Ajouter compte" in sidebar, "Éditer compte" in main panel
- **Export XLSX**: button in company header → downloads a Pipedrive-ready 2-sheet workbook of the current state
- **Adding users**: admins can POST `/api/auth/register` with their token (no UI for this yet)

## Architecture

- **Backend**: FastAPI + Motor (async MongoDB) + JWT + bcrypt. Serves the frontend from `/` at the same origin → no CORS issue.
- **Database**: MongoDB Atlas (conn in `backend/.env` — DO NOT commit). Collections: `users`, `companies`, `contacts`.
- **Frontend**: Vue 3 ESM CDN, Tailwind CDN, no build step. Components in `frontend/js/components/*.js`.

## Data model quick ref

- `users`: {email, password_hash (bcrypt), name, role: admin|user, created_at, last_login}
- `companies`: {name, slug (unique), priority, pic, domain, therapeutic_areas, headcount, hq, ...}
- `contacts`: {company_id, name, title, level (1-6), category, position_in_level, flags, notes, is_techtomed, source, ...}

## Useful endpoints

```bash
TOKEN="<paste your token>"

# List companies
curl -s http://127.0.0.1:8000/api/companies -H "Authorization: Bearer $TOKEN" | jq .

# Classify a title
curl -s -X POST http://127.0.0.1:8000/api/taxonomy/classify \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Chief Data & AI Officer"}'

# Move a contact
curl -s -X POST http://127.0.0.1:8000/api/contacts/<contact_id>/move \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"level":2,"position_in_level":0}'

# Export XLSX
curl -sO http://127.0.0.1:8000/api/admin/export/xlsx -H "Authorization: Bearer $TOKEN"
```

## Troubleshooting

- **401 on every call**: token expired (24h TTL). Login again.
- **"Unable to evaluate type annotation 'X | None'"**: Python 3.9 issue. Install `eval_type_backport`.
- **Mongo connection timeout**: check `.env` MONGO_URI + that your IP is whitelisted in MongoDB Atlas.
- **Seed runs but nothing appears**: check admin role; non-admin seed returns 403.

## Security TODO (user action)

- ⚠️ **Rotate MongoDB password** — the one shared in chat is compromised. Update `backend/.env` with new conn string.
- Set `JWT_SECRET` in `.env` to a real random 32+ char string (currently placeholder).
