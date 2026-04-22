# Pharma Mapping App — V2 Delta: Teams, Settings, Per-level Add

This document **extends** `SPEC.md` with multi-tenancy and new UI screens. Read both.

## Context

Nicolas wants a **team workspace** system, Notion-style:
- Every user must belong to at least one team to see data
- Each team has its own isolated companies + contacts
- First-time user with no team → onboarding screen (create team or join by invite code)
- Support invitation via codes (no email sending)
- User profile: change email, password, name
- Migrate existing 13 P2 seeded companies → attached to a default team owned by the existing admin

## Data model delta

### New collection `teams`
```
{
  _id: ObjectId,
  name: string,                 // display name, e.g. "muchbetter.ai"
  slug: string (unique),        // url-safe, e.g. "muchbetter-ai"
  owner_id: ObjectId (user ref),
  created_at: ISODate,
  updated_at: ISODate,
  settings: {                    // optional, defaults {}
    default_currency: string,   // reserved for future
  }
}
```

### New collection `team_members`
```
{
  _id: ObjectId,
  team_id: ObjectId,
  user_id: ObjectId,
  role: "owner" | "admin" | "member",
  joined_at: ISODate,
  invited_by: ObjectId | null
}
```
Unique index: `(team_id, user_id)`.

### New collection `team_invites`
```
{
  _id: ObjectId,
  team_id: ObjectId,
  code: string (unique, 10-char random),   // the shareable token
  role: "admin" | "member",                 // role the invitee will get
  created_by: ObjectId,
  created_at: ISODate,
  expires_at: ISODate,                      // default +30 days
  used_by: ObjectId | null,
  used_at: ISODate | null,
  max_uses: number,                         // default 1
  uses: number                              // counter
}
```

### Modify `companies`
Add field: `team_id: ObjectId` (required). All queries must filter by team_id.

### Modify `contacts`
Add field: `team_id: ObjectId` (required).

## Migration (run once on startup)

Check if any companies lack `team_id`. If yes:
1. Find the first admin user (or first user in DB).
2. Create a team: `{name: "muchbetter.ai", slug: "muchbetter-ai", owner_id: that user}`
3. Create a `team_members` doc for that user with role=owner.
4. Update **all** existing companies + contacts with this `team_id`.
5. Log the migration.

Subsequent admin users who register must explicitly create a team or join one.

## API delta

### Onboarding state

| GET | `/api/auth/onboarding-state` | bearer | `{has_teams: bool, teams_count: int}` |

Frontend calls this right after login; if `has_teams=false`, route to `#/onboarding` instead of `#/companies`.

### Teams

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/teams` | bearer | list teams the current user belongs to, with role + counts |
| POST | `/api/teams` | bearer | create team — body: `{name}` → slug auto-generated, caller becomes owner + member |
| GET | `/api/teams/{slug}` | bearer (member) | team detail: name, members list, role for current user |
| PATCH | `/api/teams/{slug}` | bearer (admin+) | update name |
| DELETE | `/api/teams/{slug}` | bearer (owner only) | cascade delete companies+contacts+members+invites |

### Members

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/teams/{slug}/members` | member | list members with role + user info |
| PATCH | `/api/teams/{slug}/members/{user_id}` | admin+ | change role (owner can only be transferred via separate endpoint) |
| DELETE | `/api/teams/{slug}/members/{user_id}` | admin+ (not owner) | remove member. Member can DELETE themselves (leave team, except owner). |

### Invites

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/teams/{slug}/invites` | admin+ | list active invites |
| POST | `/api/teams/{slug}/invites` | admin+ | create invite — body: `{role, max_uses?, expires_in_days?}` → returns `{code, ...}` |
| DELETE | `/api/teams/{slug}/invites/{invite_id}` | admin+ | revoke invite |
| POST | `/api/teams/accept-invite` | bearer | body: `{code}` → joins user to team → returns `{team: {...}}` |

### Scoped routes (BREAKING change)

Existing routes become team-scoped:

- `GET /api/companies` → `GET /api/teams/{slug}/companies`
- `GET /api/companies/{slug}` → `GET /api/teams/{team_slug}/companies/{company_slug}`
- `POST /api/companies` → `POST /api/teams/{team_slug}/companies`
- `PATCH /api/companies/{id}` → `PATCH /api/teams/{team_slug}/companies/{id}`
- `DELETE /api/companies/{id}` → `DELETE /api/teams/{team_slug}/companies/{id}`
- `POST /api/companies/{slug}/contacts` → `POST /api/teams/{team_slug}/companies/{company_slug}/contacts`
- `PATCH /api/contacts/{id}` → `PATCH /api/teams/{team_slug}/contacts/{id}`
- `POST /api/contacts/{id}/move` → `POST /api/teams/{team_slug}/contacts/{id}/move`
- `DELETE /api/contacts/{id}` → `DELETE /api/teams/{team_slug}/contacts/{id}`
- `POST /api/admin/seed` → `POST /api/teams/{team_slug}/admin/seed` (seeds into the team; admin-only of that team)
- `GET /api/admin/export/xlsx` → `GET /api/teams/{team_slug}/admin/export/xlsx`
- `POST /api/taxonomy/classify` → stays unscoped (stateless utility)

Backend must verify the caller is a member of the team AND has permission for the action (admin+ for mutations, owner for delete).

### User profile

| Method | Path | Auth | Purpose |
|---|---|---|---|
| PATCH | `/api/auth/me` | bearer | body: `{name?, email?}` → update profile |
| POST | `/api/auth/change-password` | bearer | body: `{current_password, new_password}` → re-hash |

Email change: must be unique. If email already used, 409.

## Frontend delta

### New screens

#### 1. Onboarding (`#/onboarding`)
Shown when `has_teams=false` after login. Two cards side-by-side:
- **Créer une équipe**: form `{name}` → POST /api/teams → on success, navigate to `#/<slug>/companies`
- **Rejoindre une équipe**: form `{code}` → POST /api/teams/accept-invite → on success, navigate to `#/<slug>/companies`

Design: Notion-style clean page, "Bienvenue sur Pharma Mapping" headline, subtle, no sidebar yet.

#### 2. Settings (`#/settings`)
Accessible via user menu or sidebar footer. Two tabs:
- **Profil**: fields `name`, `email`, `current_password + new_password`. Two separate submit buttons.
- **Team** (only if current team has `admin+` role):
  - Team name (editable inline)
  - Members list: avatar (initials), name, email, role chip, dropdown to change role (if admin+), remove button (if admin+, not self, not owner)
  - "Inviter" button → modal `{role, expires_in_days, max_uses}` → generates code → shown with copy button
  - Active invites list with code + "Copy" + "Revoke"
  - "Quitter l'équipe" button (member only) — opens confirmation
  - "Supprimer l'équipe" button (owner only) — confirmation with type-to-confirm team name

### Team switcher (top-left sidebar header)

- Shows current team name + chevron
- Click → dropdown with list of user's teams (each: name, role chip, click to switch)
- Footer of dropdown: "+ Rejoindre/Créer une équipe" → goes to onboarding (but keeps current team's data in bg)

When switching team, the URL becomes `#/{team_slug}/companies/...`. The frontend must re-fetch.

### Routing update

All app routes now include team slug:
- `#/onboarding`
- `#/settings` (uses current team context from store)
- `#/{team_slug}/companies` (company list in sidebar)
- `#/{team_slug}/companies/{company_slug}` (detail view)

Store needs a reactive `currentTeam` that determines all API calls.

### Per-level "+ Add contact" button (EVERY level, not just empty ones)

At the **end of every level row** (to the right, after all cards), render an "add slot":
- Dashed border card, same size as a contact card, with "+ Ajouter à ce niveau" text + icon
- Click → opens ContactModal in `create` mode with `level` prefilled to that level's number
- Style: dashed #D1D5DB, bg transparent, text gray, hover: fill light gray, bg white
- Currently the empty-level CTA exists — now it must also appear at the end of non-empty rows

### User menu (in sidebar footer)

Replace the simple "logout" with a dropdown:
- Current user email (bold) + name
- Divider
- "Paramètres" → navigate to `#/settings`
- "Se déconnecter"

## Implementation priorities

1. Backend: teams/members/invites models + routes + migration
2. Backend: scoped routes (companies, contacts) — update all existing endpoints
3. Frontend: team switcher + onboarding + team-scoped API calls
4. Frontend: Settings screen (profile + team tabs)
5. Frontend: per-level add button
6. Testing: register new user → onboarding → create team → see empty app OR accept invite → see shared data

## Out of scope (V2 still)
- Email sending (SMTP)
- Workspace avatars/branding
- Audit log per team
- Private companies (visible only to some members)
- SSO / OAuth
