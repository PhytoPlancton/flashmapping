# Pharma Mapping App — API Contract

Local-first app for mapping pharma accounts. FastAPI + MongoDB (Atlas cloud) backend, Vue 3 SPA frontend. Multi-user with login. Run locally with `uvicorn backend.app.main:app --reload`.

## Stack

- **Backend**: Python 3.9+, FastAPI, Motor (async MongoDB), PyJWT, passlib[bcrypt], python-dotenv
- **Frontend**: Vue 3 ESM CDN, `vuedraggable`-style drag/drop (or native HTML5), Tailwind CSS via CDN
- **Database**: MongoDB Atlas (conn string in `backend/.env`)
- **Auth**: JWT bearer tokens in Authorization header, 24h expiry
- **Port**: 8000 (backend serves frontend static files from `/` too — single origin)

## MongoDB collections

### `users`
```
{
  _id: ObjectId,
  email: string (unique, lowercased),
  password_hash: string (bcrypt),
  name: string,
  role: "admin" | "user",       // admin = can seed / delete users
  created_at: ISODate,
  last_login: ISODate | null
}
```

### `companies`
```
{
  _id: ObjectId,
  name: string,
  slug: string (unique, lowercased snake_case),  // e.g. "novo_nordisk"
  domain: string,
  linkedin_url: string,
  priority: "P1+" | "P1" | "P2" | "P3" | "" ,
  crm_id: string,                 // Pipedrive ID or TechToMed id
  pic: string,                    // internal owner: Charles / Max / etc.
  crm_status: string,
  work_status: string,
  next_step: string,
  industry: string,
  headcount: number,
  hq: string,
  country: string,                // ISO code
  annual_revenue: string,
  therapeutic_areas: string[],
  comments_crm: string,
  created_at: ISODate,
  updated_at: ISODate,
  created_by: ObjectId (user ref)
}
```

### `contacts`
```
{
  _id: ObjectId,
  company_id: ObjectId (ref companies),
  name: string,
  title: string,
  email: string,
  phone: string,
  linkedin_url: string,
  location: string,
  level: 1 | 2 | 3 | 4 | 5 | 6,          // 1=PDG top, 5=Manager, 6=IC/Other
  category: "c_level" | "digital" | "data_ai" | "it_is" | "medical" |
            "market_access" | "commercial" | "rd_clinical" | "hr" |
            "marketing" | "quality" | "other",
  seniority: string,                       // "Top (C-Level/GM)" / "VP" / etc.
  flag_c_level: boolean,
  flag_bu_head: boolean,
  flag_manager_of_managers: boolean,
  therapeutic_areas: string[],
  priority_score: number,                  // 0-100
  source: "techtomed" | "mcp_enrich" | "crm" | "manual",
  is_techtomed: boolean,
  position_in_level: number,               // horizontal order within level (for drag reorder)
  notes: string,
  decision_vs_influencer: "decision" | "influencer" | "",
  created_at: ISODate,
  updated_at: ISODate,
  created_by: ObjectId
}
```

Index:
- `companies.slug` unique
- `users.email` unique
- `contacts.company_id` + `contacts.level` + `contacts.position_in_level`

## REST API

All responses JSON. Errors: `{"detail": "..."}` with appropriate HTTP status.

### Auth

| Method | Path | Body | Auth | Returns |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{email, password, name}` | open (first user), admin after | `{access_token, user}` |
| POST | `/api/auth/login` | `{email, password}` | open | `{access_token, user}` |
| GET | `/api/auth/me` | — | bearer | `{_id, email, name, role}` |
| POST | `/api/auth/logout` | — | bearer | `{ok: true}` |

### Companies

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/companies` | bearer | `[{...company, contact_count, techtomed_count}]` |
| GET | `/api/companies/{slug}` | bearer | full company + `contacts: [...]` nested |
| POST | `/api/companies` | bearer | create — body: company fields |
| PATCH | `/api/companies/{id}` | bearer | update |
| DELETE | `/api/companies/{id}` | bearer | cascade delete contacts |

### Contacts

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/companies/{slug}/contacts` | bearer | `[...contacts sorted by level, position_in_level]` |
| POST | `/api/companies/{slug}/contacts` | bearer | create — auto-classifies if level/category missing |
| PATCH | `/api/contacts/{id}` | bearer | partial update (incl. `level`, `position_in_level`) |
| POST | `/api/contacts/{id}/move` | bearer | body: `{level, position_in_level}` — reshuffles siblings, atomic |
| DELETE | `/api/contacts/{id}` | bearer | 204 |

### Admin / Seed

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/admin/seed` | admin bearer | reads `data/accounts.json` + `data/enrichment/*.json` and imports companies+contacts if DB empty. Idempotent (skips existing slugs). |
| GET | `/api/admin/export/xlsx` | bearer | returns XLSX file (current DB state) |

### Taxonomy utility

| Method | Path | Auth | Returns |
|---|---|---|---|
| POST | `/api/taxonomy/classify` | bearer | body: `{title}` → `{level, category, seniority, flag_*, priority_score}` |

Reuse the logic from `roles_taxonomy.py` (Python). Call it from the API.

## Frontend flows

### Routes (client-side, hash-based or vue-router)
- `/login` — email/password form
- `/register` — only if no users exist (first-run) OR admin
- `/companies` (default) — sidebar list + company detail view
- `/companies/:slug` — full mapping view

### Screens

#### 1. Login
- Email + password form
- "Créer le premier compte" link appears if `GET /api/auth/me` returns 401 AND no users exist (backend endpoint `GET /api/auth/bootstrap` returns `{bootstrap_needed: true/false}`)

#### 2. Companies list + detail (main screen)
- **Header**: logo, "Pharma Mapping — muchbetter.ai", user menu (logout), compteur global
- **Sidebar (left, 280px)**: list of companies sorted by priority then name. Each row: name, priority chip, nb contacts, nb TechToMed. Click → loads detail.
- **Main panel**:
  - Company header: name, domain link, HQ, headcount, aires thérapeutiques badges, PIC, statut CRM, nb contacts, "Ajouter contact" button, "Exporter XLSX" button
  - Filters row: chips catégories cliquables + toggles TechToMed only / ICP only
  - **Org tree**: 5 rows (levels 1-5), level 6 behind a toggle. Each row = horizontal flex container of cards. Drag a card to another level row → PATCH `/contacts/{id}/move`. Drag within row → reorder.
  - **Contact card**: name, title (truncated with tooltip), category badge, TechToMed ★, LinkedIn icon, location. Click → open edit modal. Trash icon → delete (confirm).
  - **Edit modal**: all fields editable (name, title, email, phone, LinkedIn, location, level, category, notes, decision_vs_influencer). Save → PATCH. Cancel.
  - **Add contact modal**: same form, POST. Auto-classify on title change (call `/api/taxonomy/classify`).

### Drag & drop
- Use native HTML5 drag/drop (simplest). On drop:
  1. Optimistically reorder in UI
  2. Call `POST /api/contacts/{id}/move`
  3. On error, revert + toast
- Card being dragged has reduced opacity + cursor grabbing.
- Drop zones: each level row highlights when hovered.

## Non-goals (MVP)
- Real-time sync between users (simple reload for now)
- Manual connection lines between cards
- Undo/redo history
- Pipedrive bidirectional sync

## Repo layout

```
/Users/nicolasmonniot/Documents/CODE/mapping/
  backend/
    .env                 # secrets (DO NOT commit — in .gitignore)
    .env.example
    requirements.txt
    app/
      main.py            # FastAPI app, mounts /api routes + static frontend
      config.py          # env loading
      db.py              # motor client singleton
      auth.py            # JWT + bcrypt helpers, get_current_user dependency
      taxonomy.py        # Python port of roles_taxonomy.py logic (reuse!)
      seed.py            # imports data/*.json to MongoDB
      models.py          # Pydantic models (request/response)
      routes/
        __init__.py
        auth.py
        companies.py
        contacts.py
        admin.py
        taxonomy.py
  frontend/
    index.html           # SPA shell
    css/
      app.css            # hand-rolled styles + uses Tailwind CDN classes
    js/
      app.js             # Vue 3 app root + router
      api.js             # fetch wrapper with auth header
      auth.js            # token storage (localStorage) + bootstrap check
      components/
        Login.js
        Register.js
        Sidebar.js
        CompanyHeader.js
        OrgTree.js
        ContactCard.js
        ContactModal.js
        FilterBar.js
  data/                  # existing, read by seed.py
  out/                   # XLSX exports
```

## Run instructions

```bash
cd /Users/nicolasmonniot/Documents/CODE/mapping
python3 -m pip install --user -r backend/requirements.txt
cd backend && python3 -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/ → frontend.
First run: register admin, then POST `/api/admin/seed` to import the 13 P2 accounts.
