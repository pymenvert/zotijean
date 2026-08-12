// Tests du client Spotify — la partie qui se teste sans réseau.
//
// CE QUE CES TESTS PROTÈGENT. La liste des pistes d'une playlist est la base de
// tout le travail « morceaux manquants » : chaque élément mal filtré devient
// soit un plantage, soit un morceau éternellement manquant que l'app essaie de
// retélécharger à chaque passage.
//
// Les trois cas viennent de VRAIES playlists, pas d'hypothèses : une piste
// retirée du catalogue laisse un élément avec un trou à la place (`track:
// null`), un fichier local n'a pas d'identifiant, et un épisode de podcast se
// glisse dans les playlists mixtes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Le dossier de données est détourné avant l'import : le module lit ses jetons
// sur disque à l'initialisation.
process.env.ZOTIJEAN_DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-spotify-'));

const { normaliserPistes, lireRetryAfter } = await import('../src/spotify.js');

const PISTE = (id, nom, extras = {}) => ({
  added_at: '2026-08-01T10:00:00Z',
  is_local: false,
  track: {
    type: 'track',
    id,
    name: nom,
    duration_ms: 200_000,
    disc_number: 1,
    track_number: 3,
    external_ids: { isrc: 'FRXXX2600001' },
    artists: [{ name: 'Christine' }],
    album: { name: 'Été', release_date: '2025-06-01', images: [{ url: 'https://i/img' }] },
    ...extras,
  },
});

test('une piste retirée du catalogue ne fait pas tomber l’inventaire', () => {
  // L'élément reste dans la playlist, mais « track » est nul. Y lire un titre
  // planterait la lecture entière — donc toutes les fonctions Spotify.
  const pistes = normaliserPistes([
    PISTE('a1', 'Prix Choc'),
    { added_at: '2026-08-01T10:00:00Z', is_local: false, track: null },
    PISTE('a2', 'Été à Dakar'),
  ]);

  assert.deepEqual(pistes.map((p) => p.titre), ['Prix Choc', 'Été à Dakar']);
});

test('un fichier local est écarté : il n’a rien à télécharger', () => {
  const pistes = normaliserPistes([
    PISTE('a1', 'Prix Choc'),
    { is_local: true, track: { type: 'track', id: null, name: 'Mon edit perso' } },
  ]);
  assert.equal(pistes.length, 1);
});

test('un épisode de podcast est écarté, même quand le type est bien renvoyé', () => {
  // LE PIÈGE DÉJÀ TOMBÉ : le champ « type » doit être DEMANDÉ dans la requête,
  // sinon Spotify ne le renvoie pas et le filtre laisse tout passer en croyant
  // filtrer. Ce test vérifie le filtre ; le champ demandé l'est dans
  // contenuPlaylist, avec un commentaire qui dit pourquoi.
  const pistes = normaliserPistes([
    PISTE('a1', 'Prix Choc'),
    PISTE('e1', 'Épisode 42 — Interview', { type: 'episode', external_ids: undefined }),
  ]);
  assert.deepEqual(pistes.map((p) => p.titre), ['Prix Choc']);
});

test('les champs absents deviennent des valeurs sûres, jamais des trous', () => {
  // Un single sans album complet, une compilation sans ISRC : chaque champ
  // manquant doit donner une valeur exploitable par l'organisation des
  // fichiers, pas « undefined » qui finirait dans un nom de dossier.
  const [piste] = normaliserPistes([{
    is_local: false,
    track: { type: 'track', id: 'x1', name: 'Brut' },
  }]);

  assert.equal(piste.artiste, '');
  assert.equal(piste.album, '');
  assert.equal(piste.année, '');
  assert.equal(piste.isrc, null);
  assert.equal(piste.numéroDisque, 1);
});

test('lireRetryAfter refuse de rendre zéro pour un en-tête vide', () => {
  // Number('') vaut 0 : sans garde, une réponse 429 sans en-tête repartirait
  // sans la moindre pause, aggravant la limitation qu'elle signale.
  assert.equal(lireRetryAfter(''), 2);
  assert.equal(lireRetryAfter(null), 2);
  assert.equal(lireRetryAfter('7'), 7);
});

test.after(() => {
  fs.rmSync(process.env.ZOTIJEAN_DONNEES, { recursive: true, force: true });
});
