// Tests du contrôle d'origine.
//
// Le serveur n'écoute que sur 127.0.0.1, mais ça ne protège pas du navigateur
// de l'utilisateur : n'importe quelle page ouverte par ailleurs peut lui envoyer
// des requêtes. Ces tests décrivent exactement ce qui doit passer et ce qui doit
// être refusé.

import test from 'node:test';
import assert from 'node:assert/strict';

import { refuser, hôteSansPort, ENTÊTES_SÉCURITÉ } from '../src/securite.js';

const PORT = 8787;

function requête({ méthode = 'GET', host = '127.0.0.1:8787', origin, marqueur } = {}) {
  const headers = {};
  if (host !== null) headers.host = host;
  if (origin) headers.origin = origin;
  if (marqueur) headers['x-zotijean'] = marqueur;
  return { method: méthode, url: '/api/test', headers };
}

// ---------------------------------------------------------------------------
// Analyse de l'en-tête Host
// ---------------------------------------------------------------------------

test('hôteSansPort retire le port', () => {
  assert.equal(hôteSansPort('127.0.0.1:8787'), '127.0.0.1');
  assert.equal(hôteSansPort('localhost:9000'), 'localhost');
  assert.equal(hôteSansPort('localhost'), 'localhost');
});

test('hôteSansPort gère la forme IPv6 entre crochets', () => {
  // Piège : les deux-points d'une adresse IPv6 ne séparent pas le port.
  assert.equal(hôteSansPort('[::1]:8787'), '[::1]');
  assert.equal(hôteSansPort('[::1]'), '[::1]');
});

test('hôteSansPort normalise la casse', () => {
  assert.equal(hôteSansPort('LocalHost:8787'), 'localhost');
});

// ---------------------------------------------------------------------------
// Réattachement DNS
// ---------------------------------------------------------------------------

test('un Host étranger est refusé', () => {
  // L'attaque : un domaine contrôlé par un tiers pointe vers 127.0.0.1 après le
  // premier chargement. Le navigateur croit être en même origine ; seul le
  // serveur peut s'en apercevoir, par l'en-tête Host.
  assert.ok(refuser(requête({ host: 'evil.example:8787' }), PORT));
  assert.ok(refuser(requête({ host: 'zotijean.attaquant.fr' }), PORT));
});

test('une requête sans Host est refusée', () => {
  assert.ok(refuser(requête({ host: null }), PORT));
});

test('les hôtes locaux légitimes sont acceptés', () => {
  for (const host of ['127.0.0.1:8787', 'localhost:8787', '[::1]:8787']) {
    assert.equal(refuser(requête({ host }), PORT), null, `refusé à tort : ${host}`);
  }
});

// ---------------------------------------------------------------------------
// Requêtes croisées
// ---------------------------------------------------------------------------

test('une requête venue d’un site tiers est refusée', () => {
  assert.ok(refuser(requête({ méthode: 'POST', origin: 'https://site-malveillant.example' }), PORT));
  assert.ok(refuser(requête({ méthode: 'GET', origin: 'http://autre.local:8787' }), PORT));
});

test('une origine sur le bon hôte mais le mauvais port est refusée', () => {
  // Un autre service local compromis ne doit pas pouvoir piloter Zotijean.
  assert.ok(refuser(requête({ méthode: 'POST', origin: 'http://127.0.0.1:3000' }), PORT));
});

test('notre propre origine est acceptée', () => {
  assert.equal(refuser(requête({ méthode: 'POST', origin: 'http://127.0.0.1:8787' }), PORT), null);
  assert.equal(refuser(requête({ méthode: 'POST', origin: 'http://localhost:8787' }), PORT), null);
});

test('une origine illisible est refusée', () => {
  assert.ok(refuser(requête({ méthode: 'POST', origin: 'pas-une-url' }), PORT));
});

// ---------------------------------------------------------------------------
// Requêtes modifiantes sans origine
// ---------------------------------------------------------------------------

test('une requête modifiante sans origine ni marqueur est refusée', () => {
  // C'est le cas d'un formulaire HTML posté depuis un site tiers : le navigateur
  // n'envoie pas toujours Origin, et la requête ne déclenche aucun contrôle
  // préalable. Sans ce refus, un site pourrait déclencher une synchronisation.
  for (const méthode of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok(refuser(requête({ méthode }), PORT), `${méthode} accepté à tort`);
  }
});

test('une requête modifiante avec le marqueur local est acceptée', () => {
  // Le marqueur est un en-tête personnalisé : un site tiers ne peut pas le poser
  // sans déclencher un contrôle préalable, que nous ne validons jamais.
  assert.equal(refuser(requête({ méthode: 'POST', marqueur: 'local' }), PORT), null);
});

test('une lecture simple sans origine reste acceptée', () => {
  // Ouvrir l'interface dans le navigateur ne pose pas d'Origin sur la navigation
  // elle-même : bloquer les GET rendrait l'app inaccessible.
  assert.equal(refuser(requête({ méthode: 'GET' }), PORT), null);
});

// ---------------------------------------------------------------------------
// En-têtes de réponse
// ---------------------------------------------------------------------------

test('la politique de sécurité du contenu interdit toute ressource externe', () => {
  const csp = ENTÊTES_SÉCURITÉ['Content-Security-Policy'];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  // L'interface n'a aucune dépendance externe : rien ne justifierait un
  // assouplissement, et surtout pas 'unsafe-inline'.
  assert.ok(!csp.includes('unsafe-inline'));
  assert.ok(!csp.includes('unsafe-eval'));
  assert.ok(!csp.includes('http://'));
});

test('les en-têtes de durcissement sont tous présents', () => {
  for (const clé of [
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Cross-Origin-Opener-Policy',
    'Cross-Origin-Resource-Policy',
  ]) {
    assert.ok(ENTÊTES_SÉCURITÉ[clé], `en-tête manquant : ${clé}`);
  }
  assert.equal(ENTÊTES_SÉCURITÉ['X-Content-Type-Options'], 'nosniff');
});
