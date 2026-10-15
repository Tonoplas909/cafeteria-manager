-- =============================================================================
--  Cafet'MIAGE : installation complète de la base de données
--
--  À coller UNE SEULE FOIS, en entier, dans l'éditeur SQL (SQL Editor) d'un projet
--  Supabase NEUF, puis « Run ». Il remplace les 11 migrations historiques de la
--  branche main : c'est leur état final, sans les anciennes tables ni les données
--  de test, et sans aucune adresse e-mail.
--
--  Ce que ça crée
--    * 9 tables, toutes protégées par la sécurité au niveau des lignes (RLS)
--    * 3 fonctions qui disent qui est membre / admin (d'après l'e-mail de connexion)
--    * les règles d'accès (policies) de chaque table
--
--  Ce que ça ne fait pas (voir docs/DEPLOIEMENT.md)
--    * créer le premier compte administrateur (étape 3 du guide)
--    * déployer les 2 fonctions Edge, configurer l'authentification ni l'envoi d'e-mails
--
--  Le script peut être relancé sans casser une base déjà installée : il ne supprime
--  aucune donnée.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Les membres de l'équipe
--    Le rôle 'admin' gère tout ; 'staff' consulte et s'inscrit lui-même aux services.
--    Une ligne ici ne suffit pas à se connecter : il faut aussi un compte Supabase Auth
--    avec le même e-mail (créé par la fonction Edge staff-admin, ou à la main pour le
--    tout premier admin).
-- -----------------------------------------------------------------------------
create table if not exists public.staff (
  id         bigint generated always as identity primary key,
  name       text not null,
  email      text not null unique,
  role       text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);


-- -----------------------------------------------------------------------------
-- 2. Qui est connecté ?
--    Un utilisateur est « membre » quand l'e-mail (vérifié) de sa connexion correspond à
--    une ligne de public.staff, et « admin » quand cette ligne a le rôle 'admin'.
--    Les visiteurs non connectés (rôle anon) n'ont accès à rien.
-- -----------------------------------------------------------------------------
create or replace function public.current_staff_id()
returns bigint
language sql stable security definer set search_path = ''
as $$
  select id from public.staff
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.current_staff_id() is not null $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role = 'admin'
  )
$$;

revoke all on function public.current_staff_id(), public.is_staff(), public.is_admin() from public, anon;
grant execute on function public.current_staff_id(), public.is_staff(), public.is_admin() to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Les autres tables
-- -----------------------------------------------------------------------------

-- Stock. external_id = identifiant d'article dans l'export SumUp, pour qu'un nouvel
-- import mette à jour la même ligne même si l'article est renommé.
create table if not exists public.products (
  id           bigint generated always as identity primary key,
  name         text not null,
  current      numeric not null default 0 check (current >= 0),
  min_level    numeric not null default 5 check (min_level >= 0),
  weekly_usage numeric not null default 0 check (weekly_usage >= 0),
  cost         numeric not null default 0 check (cost >= 0),
  price        numeric not null default 0 check (price >= 0),
  created_at   timestamptz not null default now(),
  category     text,
  external_id  text,
  -- niveau auquel un réassort doit ramener le produit ; null = hors liste de courses
  target_level numeric check (target_level >= 0)
);
create unique index if not exists products_external_id_key
  on public.products (external_id) where external_id is not null;

-- Agendas connectés (un par membre). Seuls le nom et la date de synchronisation sont
-- lisibles depuis le navigateur ; le lien secret est dans calendar_secrets.
create table if not exists public.calendars (
  id        bigint generated always as identity primary key,
  name      text not null,
  last_sync timestamptz,
  staff_id  bigint references public.staff(id) on delete cascade
);

-- Le lien iCal secret d'un agenda. RLS activée, aucune règle, aucun droit : inaccessible
-- depuis le navigateur, lisible uniquement par la fonction Edge calendar-sync.
create table if not exists public.calendar_secrets (
  calendar_id bigint primary key references public.calendars(id) on delete cascade,
  ical_url    text not null
);

-- Jeton secret du flux « mes services dans mon agenda » (un par membre). Il sert de seul
-- identifiant au flux public : même protection que calendar_secrets, il peut être renouvelé
-- depuis l'application.
create table if not exists public.feed_tokens (
  staff_id bigint primary key references public.staff(id) on delete cascade,
  token    text not null unique
);

-- Horaires habituels : une ligne par jour de semaine (1 = lundi … 7 = dimanche).
-- Un jour sans ligne n'a pas de service.
create table if not exists public.opening_hours (
  weekday    smallint primary key check (weekday between 1 and 7),
  time_label text not null,                       -- par ex. '12:15–13:30'
  needed     int  not null default 2 check (needed > 0)
);

-- Exceptions pour une date précise : fermé, autres horaires ou autre effectif.
-- Le service d'une date est son exception s'il y en a une, sinon les horaires habituels.
create table if not exists public.service_days (
  date       date primary key,
  closed     boolean not null default false,
  time_label text,                                -- null : les horaires habituels du jour
  needed     int check (needed > 0)               -- null : l'effectif habituel du jour
);

-- Qui travaille quel jour.
create table if not exists public.service_assignments (
  date     date   not null,
  staff_id bigint not null references public.staff(id) on delete cascade,
  primary key (date, staff_id)
);
create index if not exists service_assignments_staff on public.service_assignments (staff_id, date);

-- Indications tirées des agendas, par date et par membre : occupé pendant le service ?
-- des cours ce jour-là ? Uniquement indicatif, jamais une règle. Écrit par la fonction
-- Edge calendar-sync (jamais le titre des événements : seulement des horaires).
create table if not exists public.service_status (
  date            date    not null,
  staff_id        bigint  not null references public.staff(id) on delete cascade,
  busy            boolean not null default false,
  on_campus       boolean not null default false,
  overlap_minutes int     not null default 0,
  busy_from       timestamptz,
  busy_until      timestamptz,
  primary key (date, staff_id)
);


-- -----------------------------------------------------------------------------
-- 4. Droits et sécurité au niveau des lignes
--    Les droits sont posés explicitement (au lieu de dépendre des réglages par défaut
--    du projet) ; ce sont ensuite les règles de la section 5 qui filtrent les lignes.
-- -----------------------------------------------------------------------------
alter table public.staff               enable row level security;
alter table public.products            enable row level security;
alter table public.calendars           enable row level security;
alter table public.calendar_secrets    enable row level security;
alter table public.feed_tokens         enable row level security;
alter table public.opening_hours       enable row level security;
alter table public.service_days        enable row level security;
alter table public.service_assignments enable row level security;
alter table public.service_status      enable row level security;

-- Les visiteurs non connectés n'ont rien.
revoke all on
  public.staff, public.products, public.calendars, public.calendar_secrets, public.feed_tokens,
  public.opening_hours, public.service_days, public.service_assignments, public.service_status
from anon;

-- Les membres connectés : lecture/écriture de ce que les règles autorisent...
grant select, insert, update, delete on
  public.staff, public.products, public.calendars, public.opening_hours,
  public.service_days, public.service_assignments, public.service_status
to authenticated;

-- ...mais jamais les deux tables de secrets.
revoke all on public.calendar_secrets, public.feed_tokens from authenticated;

-- Les fonctions Edge (clé service_role) lisent et écrivent partout.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;


-- -----------------------------------------------------------------------------
-- 5. Règles d'accès
-- -----------------------------------------------------------------------------

-- Équipe : tout membre lit ; seul un admin modifie une ligne (changer un rôle).
-- Créer ou supprimer un membre passe par la fonction Edge staff-admin (clé service_role),
-- car cela crée ou supprime aussi son compte de connexion.
drop policy if exists staff_read on public.staff;
drop policy if exists admin_update on public.staff;
create policy staff_read on public.staff for select to authenticated using (public.is_staff());
create policy admin_update on public.staff for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Stock, agendas, horaires habituels, exceptions : tout membre lit, seul un admin écrit.
do $$
declare t text;
begin
  foreach t in array array['products', 'calendars', 'opening_hours', 'service_days']
  loop
    execute format('drop policy if exists staff_read on public.%I', t);
    execute format('drop policy if exists admin_write on public.%I', t);
    execute format('create policy staff_read on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('create policy admin_write on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Inscriptions aux services : tout membre lit ; un membre ajoute ou retire uniquement
-- sa propre inscription ; un admin gère celles de tout le monde.
drop policy if exists staff_read on public.service_assignments;
drop policy if exists self_or_admin_insert on public.service_assignments;
drop policy if exists self_or_admin_delete on public.service_assignments;
drop policy if exists admin_update on public.service_assignments;
create policy staff_read on public.service_assignments for select to authenticated using (public.is_staff());
create policy self_or_admin_insert on public.service_assignments for insert to authenticated
  with check (public.is_admin() or staff_id = public.current_staff_id());
create policy self_or_admin_delete on public.service_assignments for delete to authenticated
  using (public.is_admin() or staff_id = public.current_staff_id());
create policy admin_update on public.service_assignments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Indications des agendas : lecture pour les membres ; écriture réservée à calendar-sync.
drop policy if exists staff_read on public.service_status;
create policy staff_read on public.service_status for select to authenticated using (public.is_staff());

-- calendar_secrets et feed_tokens : volontairement aucune règle (RLS activée, donc tout est refusé).


-- -----------------------------------------------------------------------------
-- 6. Données de départ (FACULTATIF : décommenter ce dont vous avez besoin)
-- -----------------------------------------------------------------------------

-- Horaires habituels : du lundi au vendredi, 12:15 à 13:30, 2 personnes.
-- Ils restent modifiables ensuite depuis l'application (écran Planning, compte admin).
-- insert into public.opening_hours (weekday, time_label, needed) values
--   (1, '12:15–13:30', 2), (2, '12:15–13:30', 2), (3, '12:15–13:30', 2),
--   (4, '12:15–13:30', 2), (5, '12:15–13:30', 2)
-- on conflict (weekday) do nothing;

-- Premier administrateur : à faire APRÈS avoir créé son compte dans
-- Authentication > Users (voir docs/DEPLOIEMENT.md, étape 3). L'e-mail doit être
-- exactement celui du compte.
-- insert into public.staff (name, email, role)
-- values ('Prénom Nom', 'prenom.nom@exemple.fr', 'admin')
-- on conflict (email) do update set role = 'admin';
