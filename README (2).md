# FocusDo

A Microsoft To‑Do–style task app with your personal **Focus Protocol** built in.
Static site (hosts free on GitHub Pages) + Supabase (Postgres) so your tasks sync
across your phone and desktop, private to your login.

**Features:** My Day · Important · Planned · custom lists · tasks with steps, notes,
due dates, reminders, repeat · a detail pane · the Focus Protocol view (time‑blocked
schedule, sound cues, morning checklist, "today's #1 priority" that drops into My Day).

---

## Setup (about 10 minutes, one time)

### 1. Create a Supabase project
Go to [supabase.com](https://supabase.com) → **New project**. Pick a name and a
database password (save it somewhere). Wait ~2 min for it to spin up.

### 2. Create the database
In the left menu open **SQL Editor** → **New query**. Paste the entire contents of
`schema.sql`, then click **Run**. You should see "Success."

### 3. (Recommended) Turn off email confirmation
For a personal app this lets you log in instantly.
**Authentication → Sign In / Providers → Email** → turn **Confirm email** off → save.
(If you leave it on, you'll get a confirmation email on first sign‑up.)

### 4. Get your keys
**Project Settings → API** (or **API Keys**). Copy two things:
- **Project URL** (looks like `https://abcd1234.supabase.co`)
- The **anon / publishable** key — the **public** one. *Never* use the `service_role` / secret key here.

Open `config.js` and paste them in:
```js
window.SUPABASE_URL = "https://abcd1234.supabase.co";
window.SUPABASE_KEY = "your-anon-or-publishable-key";
```
> The public key is safe to commit. Row Level Security (set up by `schema.sql`) means
> it can only ever touch **your own** rows, and only after you're logged in.

### 5. Put it on GitHub Pages
1. Create a new GitHub repo and upload these files (`index.html`, `styles.css`,
   `app.js`, `config.js`, `schema.sql`, `README.md`) to the repo **root**.
2. Repo **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`,
   folder `/ (root)` → **Save**.
3. After a minute your app is live at `https://YOUR‑USERNAME.github.io/YOUR‑REPO/`.

### 6. Use it
Open the URL, **Create an account** (any email + password), and you're in.
On your phone, use the browser's **Add to Home Screen** for an app‑like icon.

---

## Notes
- **Syncing:** changes save to Supabase immediately; the app re‑syncs whenever you
  return to the tab, so your phone and laptop stay in step.
- **My Day resets daily** (just like Microsoft To‑Do) — tasks you added to My Day
  today drop off tomorrow but stay in their list.
- **Reminders** store a date but don't send push notifications (a static site can't).
  Treat the Planned view as your reminder board.
- **Want live realtime sync** (updates appear without switching tabs)? In Supabase,
  **Database → Replication**, enable it for `tasks`, `lists`, `steps`. Optional.
- **Theme:** the ◑ button toggles light/dark; your choice is remembered per device.

## Files
| File | What it is |
|---|---|
| `index.html` | App shell |
| `styles.css` | Styling (light/dark) |
| `app.js` | All logic: auth, database, rendering, Focus Protocol |
| `config.js` | **Your** Supabase URL + key |
| `schema.sql` | Run once in Supabase to create tables + security |
