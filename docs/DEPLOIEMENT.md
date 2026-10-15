# Déployer Cafet'MIAGE sur votre propre hébergeur

Ce guide installe l'application de A à Z, **indépendamment de GitHub Pages et du projet Supabase d'origine** : un site statique chez l'hébergeur de votre choix, et votre propre projet Supabase (base de données, comptes, deux petites fonctions serveur, e-mails). Comptez 30 à 45 minutes la première fois.

Cette branche (`deploy`) est un point de départ propre : le pipeline GitHub est retiré, les anciennes migrations sont remplacées par **un seul fichier SQL** (`supabase/setup.sql`), et plus aucune adresse, clé ni compte de l'installation d'origine n'est dans le code.

## Ce que vous allez mettre en place

| Brique | Rôle | Où ça se règle |
| --- | --- | --- |
| **Site** | l'interface (React, compilée en fichiers statiques dans `dist/`) | étape 7 |
| **Base de données** | équipe, stock, horaires, inscriptions aux services, indications d'agenda | étapes 3 et 4 |
| **Comptes et e-mails** | connexion par e-mail et mot de passe, invitations, mots de passe oubliés | étape 6 |
| **2 fonctions serveur** | `staff-admin` (créer des comptes) et `calendar-sync` (agendas) | étape 5 |

Le site ne contient aucun secret : il connaît seulement l'adresse de votre projet Supabase et une clé **publique**. Toute la sécurité est dans la base (voir `docs/ARCHITECTURE.md`).

## Avant de commencer

- Un compte [Supabase](https://supabase.com) (gratuit suffit pour démarrer).
- Un hébergeur de sites statiques **en HTTPS** (Netlify, Cloudflare Pages, Vercel, un serveur nginx…). HTTPS est obligatoire : l'application s'installe sur téléphone et utilise un service worker.
- Node.js 20 ou plus, npm et Git sur votre poste.
- La CLI Supabase : `npm install -g supabase` (ou préfixez chaque commande par `npx`).
- Recommandé : un compte e-mail capable d'envoyer (SMTP) pour les invitations. Voir l'étape 6.

## Étape 1. Récupérer le code

```bash
git clone --branch deploy <adresse-du-dépôt> cafet-miage
cd cafet-miage
npm install
```

## Étape 2. Créer le projet Supabase

1. Dans Supabase : **New project** (choisissez une région européenne), un mot de passe de base de données (gardez-le, mais l'application n'en a pas besoin).
2. Notez trois valeurs, dans **Project Settings → API** :
   - **Project URL** : `https://xxxxxxxxxxxxxxxxxxxx.supabase.co` ;
   - **Publishable key** (anciennement « anon ») : une clé publique commençant par `sb_publishable_` (sur un projet plus ancien, la clé `anon`, un long texte commençant par `eyJ`, convient aussi) ;
   - **Project ref** : les 20 lettres au début de l'URL (`xxxxxxxxxxxxxxxxxxxx`).

> La clé **secret** / `service_role` ne sert jamais côté site. Ne la copiez nulle part : les fonctions serveur la reçoivent automatiquement de Supabase.

## Étape 3. Installer la base de données

1. Ouvrez **SQL Editor → New query**.
2. Collez **tout** le contenu de [`supabase/setup.sql`](../supabase/setup.sql) puis **Run**. Message attendu : « Success. No rows returned ».
3. Vérifiez dans **Table Editor** : 9 tables (`staff`, `products`, `calendars`, `calendar_secrets`, `feed_tokens`, `opening_hours`, `service_days`, `service_assignments`, `service_status`), chacune avec la mention « RLS enabled ».

Le fichier ne contient ni données de test ni adresse e-mail. Il peut être relancé sans rien supprimer. À la fin, deux blocs **commentés** proposent des horaires de départ et le premier admin : l'étape 4 s'en sert.

## Étape 4. Créer le premier administrateur

Le tout premier compte ne peut pas être invité par l'application (il faut déjà être admin pour inviter). On le crée à la main, une fois.

1. **Authentication → Users → Add user → Create new user** : saisissez l'e-mail et un mot de passe d'au moins 8 caractères, **cochez « Auto Confirm User »**, puis créez.
2. **SQL Editor** : exécutez (avec **le même e-mail**, majuscules ignorées) :

   ```sql
   insert into public.staff (name, email, role)
   values ('Prénom Nom', 'prenom.nom@exemple.fr', 'admin')
   on conflict (email) do update set role = 'admin';
   ```

3. Facultatif : décommentez et exécutez le bloc « Horaires habituels » de `setup.sql` (lundi à vendredi, 12:15 à 13:30). Ils se modifient ensuite depuis l'application.

Toutes les autres personnes seront invitées depuis l'application (Admin → Équipe → Ajouter un membre).

## Étape 5. Déployer les deux fonctions serveur

Depuis le dossier du projet :

```bash
supabase login
supabase link --project-ref <votre-project-ref>
supabase functions deploy staff-admin --no-verify-jwt
supabase functions deploy calendar-sync --no-verify-jwt
supabase secrets set SITE_URL=https://votre-site.example/
```

- `supabase link` peut demander le mot de passe de la base : laissez vide (Entrée), il n'est pas nécessaire ici. Si une commande `deploy` réclame Docker et qu'il n'est pas installé, ajoutez `--use-api` à la fin.
- `--no-verify-jwt` est nécessaire : `calendar-sync` sert aussi un flux public (l'abonnement « mes services dans mon agenda »), et les deux fonctions vérifient elles-mêmes qui appelle.
- `SITE_URL` est **l'adresse finale du site** (avec `https://`, et le sous-dossier éventuel, par exemple `https://exemple.org/cafet/`). Les liens des e-mails d'invitation ne peuvent ramener que vers cette adresse. Si vous ne la connaissez pas encore, vous pourrez la définir plus tard avec la même commande : aucun redéploiement des fonctions n'est nécessaire.
- Aucune autre variable à fournir : `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont injectées par Supabase.
- `supabase link` crée un dossier `supabase/.temp/` : il est ignoré par Git, ne le versionnez pas.

## Étape 6. Authentification et e-mails

### 6.1. Réglages d'authentification

Le plus simple : le script fourni applique tout d'un coup, avec **votre** jeton personnel (Supabase → Account → Access Tokens → Generate new token ; révoquez-le après usage).

```bash
# aperçu, sans rien modifier
node scripts/configure-auth.mjs --ref <project-ref> --site https://votre-site.example/ --dry-run

# application
SUPABASE_ACCESS_TOKEN=sbp_... node scripts/configure-auth.mjs --ref <project-ref> --site https://votre-site.example/
```

À la main, dans **Authentication** (les intitulés peuvent varier selon la version du tableau de bord) :

| Réglage | Valeur |
| --- | --- |
| URL Configuration → **Site URL** | l'adresse du site, `https://votre-site.example/` |
| URL Configuration → **Redirect URLs** | `https://votre-site.example/**` (et `http://localhost:5173/**` pour le développement) |
| Sign In / Providers → Email → **Allow new users to sign up** | **désactivé** (seuls les admins créent des comptes) |
| Sign In / Providers → Email → **Confirm email** | **activé** (ne jamais le désactiver : l'accès repose sur l'e-mail du compte) |
| Sign In / Providers → Email → **Minimum password length** | 8 |
| Email Templates → **Invite user** | sujet `Bienvenue sur Cafet'MIAGE / Welcome to Cafet'MIAGE`, contenu de [`supabase/email-templates/invite.html`](../supabase/email-templates/invite.html) |
| Email Templates → **Reset password** | sujet `Réinitialiser votre mot de passe / Reset your password`, contenu de [`supabase/email-templates/recovery.html`](../supabase/email-templates/recovery.html) |

### 6.2. Envoi des e-mails (SMTP)

Le service d'e-mail intégré à Supabase est limité à très peu de messages par heure (2 observés) et, selon le plan, réservé aux adresses de l'équipe du projet : insuffisant pour inviter des collègues. Configurez votre propre SMTP dans **Authentication → SMTP Settings** (ou Project Settings → Authentication) :

| Champ | Exemple avec Google Workspace |
| --- | --- |
| Sender email | l'adresse d'envoi (la boîte, ou un alias vérifié) |
| Sender name | `Cafet'MIAGE` |
| Host / Port | `smtp.gmail.com` / `465` |
| Username | l'adresse complète |
| Password | un **mot de passe d'application** Google (compte → Sécurité → Validation en deux étapes → Mots de passe des applications) |

Brevo, Resend, Mailjet… fonctionnent de la même façon (hôte, port, identifiants fournis par le service). Saisissez le mot de passe vous-même dans le tableau de bord : il ne doit apparaître dans aucun fichier du dépôt. Après avoir enregistré, relevez la limite « emails sent per hour » (Authentication → Rate Limits) si besoin.

## Étape 7. Compiler et publier le site

Les deux variables sont lues **à la compilation** : changez-les, recompilez, republiez.

```bash
cp .env.example .env.local        # puis renseignez VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY
npm run build                     # produit le dossier dist/
```

Publiez le contenu de `dist/` chez l'hébergeur. Il peut être servi à la racine d'un domaine ou dans un sous-dossier : tous les chemins sont relatifs. Il n'y a qu'une page, donc **aucune règle de réécriture** à prévoir.

| Hébergeur | Réglages |
| --- | --- |
| **Netlify**, **Cloudflare Pages**, **Vercel** | Branche `deploy`. Build command : `npm run build`. Output directory : `dist`. Node 20. Variables d'environnement : `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. Netlify et Cloudflare lisent aussi `public/_headers` (cache du service worker). |
| **Serveur nginx / Apache** | Copiez `dist/` dans le dossier servi, en HTTPS. Voir l'exemple ci-dessous. |
| **Autre hébergeur statique** | Tout ce qui sert des fichiers en HTTPS convient. |

Exemple nginx (l'important : ne jamais mettre `sw.js` ni `index.html` en cache long, sinon une mise à jour n'arrive pas) :

```nginx
root /var/www/cafet;
index index.html;

location = /sw.js        { add_header Cache-Control "no-cache"; }
location = /index.html   { add_header Cache-Control "no-cache"; }
location /assets/        { add_header Cache-Control "public, max-age=31536000, immutable"; }
```

**Pas de pipeline fourni** : redéployer, c'est relancer `npm run build` et republier `dist/`, ou pousser sur la branche si l'hébergeur y est branché.

## Étape 8. Vérifier

Dans un navigateur, ouvrez le site :

1. Connectez-vous avec le compte de l'étape 4. L'écran d'accueil doit s'afficher (sans erreur rouge).
2. **Admin → Équipe → Ajouter un membre** avec une de vos adresses : l'e-mail d'invitation arrive, le lien ramène **sur votre site** et demande de choisir un mot de passe.
3. **Mon agenda** : collez un lien d'agenda (iCal), la synchronisation doit se faire sans message d'erreur.
4. Sur téléphone, le bouton « Installer l'application » (Android) ou Partager → « Sur l'écran d'accueil » (iPhone) doit être proposé.

Tests rapides en ligne de commande (sans aucun secret) :

```bash
# les deux fonctions répondent et refusent un appel non connecté
curl -s -X POST https://<ref>.supabase.co/functions/v1/staff-admin    -H 'Content-Type: application/json' -d '{}'
# attendu : {"error":"Admins only"}
curl -s -X POST https://<ref>.supabase.co/functions/v1/calendar-sync  -H 'Content-Type: application/json' -d '{"action":"sync"}'
# attendu : {"error":"Staff only"}

# un visiteur non connecté ne voit rien dans la base
curl -s "https://<ref>.supabase.co/rest/v1/staff?select=*" -H "apikey: <publishable key>"
# attendu : une erreur « permission denied »
```

## Dépannage

| Symptôme | Cause probable |
| --- | --- |
| Page blanche ou « Failed to fetch » | `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` absentes ou fausses au moment du `npm run build`. Corrigez et recompilez. |
| « Pas encore d'accès » après connexion | L'e-mail du compte n'est pas (exactement) dans la table `staff`. Revoyez l'étape 4. |
| Ajouter un membre : « SITE_URL is not set » | Étape 5 : `supabase secrets set SITE_URL=...`. |
| Ajouter un membre : erreur d'envoi d'e-mail | SMTP absent ou faux (étape 6.2), ou limite horaire atteinte. |
| Le lien d'invitation ramène sur la mauvaise adresse ou un « redirect URL not allowed » | Site URL / Redirect URLs de l'étape 6.1, ou `SITE_URL` de l'étape 5, ne correspondent pas à l'adresse réelle. |
| N'importe qui peut créer un compte | « Allow new users to sign up » est resté activé. Désactivez-le. |
| Une mise à jour du site n'apparaît pas | `sw.js` ou `index.html` sont servis avec un cache long (voir l'étape 7), ou le navigateur garde l'ancien service worker : rechargez deux fois. |
| Synchronisation d'agenda : « Staff only » | La fonction a été appelée sans être connecté : normal en test `curl`. Dans l'application, reconnectez-vous. |

## À adapter à votre structure

- **Fuseau horaire** (Europe/Paris) : `src/dates.js` (constante `TZ`) et `supabase/functions/calendar-sync/index.ts` (constante `TZ`). Les deux doivent rester identiques.
- **Langue** : français et anglais, textes dans `src/fr.js` (clés en anglais).
- **Nom, logo, couleurs** : `index.html`, `public/manifest.webmanifest`, `src/assets/`, `public/icons/` (si vous changez une icône, changez aussi son nom de fichier : les téléphones mettent les icônes en cache d'après leur nom).
- **Liens de drive du réassort** : `src/driveSites.js`.
- **Horaires d'ouverture** : modifiables dans l'application (compte admin).

## Récupérer les évolutions de la branche principale

`deploy` est dérivée de `main` : pour récupérer les nouveautés, faites `git merge main` sur cette branche. Les fichiers propres à `deploy` (pipeline retiré, `supabase/setup.sql`, `docs/`, `scripts/`, `.env.example`, `.gitignore`, `staff-admin`) peuvent demander une résolution de conflit à la main. Les **nouvelles migrations** de `main` (`supabase/migrations/…`) ne sont pas dans `setup.sql` : exécutez chacune une fois, dans l'ordre, dans le SQL Editor de votre projet.
