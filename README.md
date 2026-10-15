# Cafet'MIAGE : branche `deploy`

Application de gestion d'un café associatif étudiant : planning des services, stock, équipe et agendas. React + Vite pour le site, Supabase pour la base, les comptes et deux petites fonctions serveur.

**Cette branche sert à installer l'application sur un autre hébergeur que GitHub Pages, avec un projet Supabase neuf.** Elle ne doit pas être fusionnée dans `main`. Par rapport à `main` :

- le pipeline GitHub (`.github/workflows`) est retiré ;
- les 11 migrations historiques sont remplacées par **un seul fichier à coller** : [`supabase/setup.sql`](supabase/setup.sql) ;
- plus aucune adresse, clé, compte ou e-mail de l'installation d'origine : la fonction `staff-admin` lit l'adresse du site dans le secret `SITE_URL`, et `.env.example` est vide ;
- documentation, modèles d'e-mails et script de configuration ajoutés.

## Par où commencer

1. **[`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md)** : le guide pas à pas (30 à 45 minutes).
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) : comment c'est construit, le modèle de données, la sécurité.

## En bref

```bash
npm install
cp .env.example .env.local      # VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY de VOTRE projet
npm run dev                     # développement sur http://localhost:5173
npm run build                   # produit dist/, à publier chez l'hébergeur
npm test                        # tests des calculs d'agenda
```

Ordre d'installation : projet Supabase → `supabase/setup.sql` → premier admin → fonctions Edge (`staff-admin`, `calendar-sync`) → authentification et SMTP → compilation et publication du site.

## Contenu utile

| Chemin | Rôle |
| --- | --- |
| `supabase/setup.sql` | toute la base de données, à coller dans le SQL Editor |
| `supabase/functions/` | les deux fonctions Edge à déployer |
| `supabase/email-templates/` | modèles des e-mails d'invitation et de mot de passe |
| `scripts/configure-auth.mjs` | applique les réglages d'authentification par l'API Supabase |
| `public/_headers` | en-têtes de cache pour Netlify et Cloudflare Pages |
| `docs/` | guide de déploiement et architecture |
