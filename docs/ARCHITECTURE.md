# Architecture

Vue d'ensemble de Cafet'MIAGE pour qui doit l'exploiter ou la faire évoluer. Pour l'installer, voir `docs/DEPLOIEMENT.md`.

## Les pièces

```
 Navigateur / téléphone (site statique, dossier dist/)
        │  clé publique (publishable)           │ appels de fonctions, avec le jeton de la personne connectée
        ▼                                       ▼
 Supabase ── Base Postgres (+ règles RLS)    Fonctions Edge : staff-admin, calendar-sync
        │    comptes (Auth) + e-mails SMTP        │ clé secrète (service_role), jamais dans le navigateur
        └──────────────────────────────────────────┘
                                            Agendas iCal des membres (lus côté serveur)
```

- **Front** : React 18 et Vite, une seule page (pas de routeur), compilée en fichiers statiques. Installable sur téléphone (PWA : `public/manifest.webmanifest`, `public/sw.js`, icônes). Français et anglais (`src/i18n.jsx`, traductions dans `src/fr.js`).
- **Base et comptes** : un projet Supabase. Les comptes de connexion sont ceux de Supabase Auth (e-mail et mot de passe).
- **Fonctions Edge** : deux petites fonctions Deno dans `supabase/functions/`, indispensables parce qu'elles utilisent des droits que le navigateur ne doit jamais avoir.

## Écrans

| Écran | Fichier | Pour qui |
| --- | --- | --- |
| Planning : calendrier des services sur deux semaines, inscription, personnes indisponibles | `src/screens/Schedule.jsx`, `Unavailable.jsx` | tous (les admins modifient) |
| Stock : niveaux, import d'un export SumUp, niveaux cibles, liste de courses | `src/screens/Inventory.jsx`, `src/importStock.js`, `src/shoppingList.js` | tous (les admins modifient) |
| Mon agenda : lien iCal, abonnement « mes services dans mon agenda » | `src/screens/MyCalendar.jsx` | tous |
| Admin : équipe, produits, agendas, horaires | `src/screens/Admin.jsx` | admins |

L'accès aux données passe par `src/api.js` (lectures groupées dans `loadAll`, écritures par action).

## Modèle de données

| Table | Contenu | Écrit par |
| --- | --- | --- |
| `staff` | une ligne par membre : nom, e-mail, rôle (`admin` ou `staff`) | création/suppression : `staff-admin` ; changement de rôle : un admin |
| `opening_hours` | horaires habituels : une ligne par jour de semaine (1 = lundi … 7 = dimanche), effectif demandé | admins |
| `service_days` | exceptions pour une date : fermé, autres horaires, autre effectif | admins |
| `service_assignments` | qui travaille quelle date | chaque membre pour lui-même, ou un admin pour tous |
| `service_status` | indications tirées des agendas, par date et par membre : occupé pendant le service ? des cours ce jour-là ? | `calendar-sync` uniquement |
| `calendars` | un agenda connecté par membre (nom, dernière synchronisation) | `calendar-sync` |
| `calendar_secrets` | le **lien iCal secret** de l'agenda | `calendar-sync` uniquement |
| `feed_tokens` | le **jeton secret** du flux d'abonnement d'un membre | `calendar-sync` uniquement |
| `products` | stock : quantité, minimum, coût, prix, catégorie, identifiant SumUp, niveau cible | admins |

**Le service d'une date** est son exception (`service_days`) s'il y en a une, sinon les horaires habituels de son jour de semaine (`opening_hours`). Un jour sans ligne n'a pas de service.

## Sécurité

Le site est public et sa clé est publique : **la sécurité est entièrement dans la base**, par des règles de sécurité au niveau des lignes (RLS) définies dans `supabase/setup.sql`.

- Un visiteur non connecté n'a **aucun** droit sur aucune table.
- Une personne connectée est « membre » si l'**e-mail vérifié de son compte** correspond à une ligne de `staff` (fonctions `is_staff()`, `current_staff_id()`), et « admin » si cette ligne a le rôle `admin` (`is_admin()`). Ajouter une ligne dans `staff` sans compte ne donne donc accès à rien, et un compte sans ligne dans `staff` non plus.
- Tout membre **lit** tout (équipe, stock, horaires, inscriptions). Seuls les admins **écrivent**, sauf une exception : un membre peut ajouter ou retirer **sa propre** inscription à un service.
- `calendar_secrets` et `feed_tokens` n'ont aucune règle ni aucun droit côté navigateur : seules les fonctions Edge, avec la clé secrète, y accèdent.
- Les inscriptions ouvertes sont désactivées (« Allow new users to sign up » à off) : seul un admin crée des comptes, via `staff-admin`, qui envoie une invitation. Personne ne voit jamais le mot de passe d'un autre.

### Où se trouve chaque secret

| Quoi | Où | Visible du navigateur ? |
| --- | --- | --- |
| Adresse du projet, clé *publishable* | variables `VITE_SUPABASE_*`, compilées dans le site | oui, c'est prévu |
| Clé *secret* (`service_role`) | injectée par Supabase dans les fonctions Edge | **non, jamais** |
| `SITE_URL` | secret des fonctions Edge | non |
| Mot de passe SMTP | tableau de bord Supabase | non |
| Liens iCal des agendas, jetons de flux | tables `calendar_secrets`, `feed_tokens` | non |
| Jeton d'accès personnel Supabase | uniquement pendant l'étape 6.1 du guide, à révoquer ensuite | non |

## Les deux fonctions Edge

**`staff-admin`** (admins uniquement, vérifié à chaque appel par `is_admin()`) :
- `create` : ajoute le membre dans `staff` puis envoie une invitation par e-mail. Si l'envoi échoue, la ligne est annulée.
- `send-link` : renvoie l'invitation (compte jamais activé) ou un lien de réinitialisation du mot de passe.
- `delete` : supprime le membre et son compte de connexion (jamais soi-même).
- Les liens des e-mails ne ramènent que vers `SITE_URL` (et `localhost:5173` en développement).

**`calendar-sync`** (membres) :
- `connect` / `disconnect` : enregistre ou retire le lien iCal d'un membre (https uniquement, adresses locales refusées, taille limitée).
- `sync` : relit les agendas des membres (au plus toutes les 10 minutes sauf demande explicite) et, pour les 14 prochains jours de service, écrit dans `service_status` si la personne est occupée pendant le service et si elle a des cours ce jour-là. **Seuls des horaires sont enregistrés, jamais le titre des événements.** Ces indications ne servent qu'à informer : elles n'empêchent jamais d'inscrire quelqu'un.
- `feed-link` / `feed-rotate` : crée ou renouvelle le jeton du flux personnel.
- `GET ?t=<jeton>` : renvoie le flux iCal public des prochains services de la personne (sans connexion : le jeton est le seul identifiant).
- Les calculs de dates et d'agendas sont dans `supabase/functions/calendar-sync/core.js`, couverts par des tests : `npm test`.

## Où chercher dans le code

| Besoin | Fichier |
| --- | --- |
| Lire/écrire en base, appeler les fonctions | `src/api.js` |
| Calcul des dates et des services affichés | `src/dates.js`, `supabase/functions/calendar-sync/core.js` |
| Couleurs, polices, formes | `src/tokens-and-components.css`, `src/layout.css`, `src/responsive.css`, `src/fonts.css` |
| Mascotte Michel | `src/Michel.jsx`, `src/assets/michel/` |
| Installation sur téléphone et mode hors ligne | `public/sw.js` (liste des fichiers écrite à la compilation par `vite.config.js`), `src/InstallApp.jsx` |
| Textes (français) | `src/fr.js` |
