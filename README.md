# Cafet'MIAGE — Cafeteria Manager

Staff schedule, stock room and admin for a student-organisation café. React + Vite on the front, Supabase for the database.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and publishable key
npm run dev
```

## Database

The schema and seed data live in `supabase/migrations/`. Run them in the Supabase SQL editor (or with the Supabase CLI). Access is currently open to the anon key; tighten the `open_all` policies when login is added.

## Deploy

Pushing to `main` builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`). Set the repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` first.
