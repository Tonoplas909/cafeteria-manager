#!/usr/bin/env node
// Applique à un projet Supabase les réglages d'authentification dont l'application a besoin
// (adresse du site, inscriptions fermées, e-mail confirmé, mot de passe de 8 caractères, modèles d'e-mails),
// par l'API de gestion de Supabase.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/configure-auth.mjs --ref <project-ref> --site https://votre-site.example/
//   ajoutez --dry-run pour voir ce qui serait envoyé, sans rien modifier.
//
// Le jeton est un jeton d'accès PERSONNEL (Supabase > Account > Access Tokens) : il est lu dans
// l'environnement, jamais écrit nulle part ; révoquez-le après usage. Les réglages SMTP (mot de passe)
// se font dans le tableau de bord, pas ici.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes('--dry-run');
const ref = flag('--ref');
const siteArg = flag('--site');

const fail = (message) => {
  console.error('Erreur : ' + message);
  process.exit(1);
};

if (!ref || !/^[a-z]{20}$/.test(ref)) fail('--ref doit être le « project ref » (20 lettres minuscules, début de l\'adresse xxxx.supabase.co).');
if (!siteArg) fail('--site est obligatoire, par exemple https://cafet.example.org/');

let site;
try {
  site = new URL(siteArg);
} catch {
  fail('--site n\'est pas une adresse valide.');
}
if (site.protocol !== 'https:' && site.hostname !== 'localhost') fail('--site doit être en https (sauf localhost).');
const siteUrl = site.origin + (site.pathname.endsWith('/') ? site.pathname : site.pathname + '/');

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!dryRun && !token) fail('définissez SUPABASE_ACCESS_TOKEN (jeton d\'accès personnel Supabase).');

const here = dirname(fileURLToPath(import.meta.url));
const template = (name) => readFileSync(join(here, '..', 'supabase', 'email-templates', name), 'utf8');

const payload = {
  site_url: siteUrl,
  uri_allow_list: `${siteUrl}**,http://localhost:5173/**`,
  disable_signup: true, // seuls les admins créent des comptes
  mailer_autoconfirm: false, // l'e-mail du compte doit être confirmé : l'accès en dépend
  password_min_length: 8,
  mailer_subjects_invite: "Bienvenue sur Cafet'MIAGE / Welcome to Cafet'MIAGE",
  mailer_templates_invite_content: template('invite.html'),
  mailer_subjects_recovery: 'Réinitialiser votre mot de passe / Reset your password',
  mailer_templates_recovery_content: template('recovery.html'),
};

const show = (p) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'string' && v.length > 70 ? v.slice(0, 67) + '…' : v]));

console.log(`Projet : ${ref}\nSite   : ${siteUrl}\n`);
console.log(dryRun ? 'Aperçu (rien n\'est envoyé) :' : 'Envoi des réglages :');
console.log(JSON.stringify(show(payload), null, 2));

if (dryRun) process.exit(0);

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const text = await res.text();
if (!res.ok) fail(`Supabase a répondu ${res.status} : ${text.slice(0, 300)}`);

const applied = JSON.parse(text);
console.log('\nAppliqué :');
for (const k of ['site_url', 'uri_allow_list', 'disable_signup', 'mailer_autoconfirm', 'password_min_length']) {
  console.log(`  ${k} = ${JSON.stringify(applied[k])}`);
}
console.log('\nPensez à révoquer votre jeton d\'accès, et à configurer le SMTP dans le tableau de bord (étape 6.2 du guide).');
