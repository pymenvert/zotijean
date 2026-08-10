// Tests du pilote zotify.
//
// On ne teste pas zotify lui-même (il n'est pas installé sur le poste de
// développement) mais tout ce qui l'entoure : le découpage de sa sortie, la
// construction de sa ligne de commande, et surtout la lecture du disque, qui est
// la seule chose à laquelle on fait confiance pour savoir ce qui a été
// téléchargé.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  créerDécoupeur,
  classerLigne,
  construireArguments,
  inventorier,
  nouveauxFichiers,
} from '../src/zotify.js';

import { optionsDéclarées, extraireVersion } from '../src/diagnostic.js';

// ---------------------------------------------------------------------------
// Découpage de la sortie
// ---------------------------------------------------------------------------

test('le découpeur rend les lignes séparées par des sauts de ligne', () => {
  const reçues = [];
  const absorber = créerDécoupeur((l) => reçues.push(l));
  absorber('première\ndeuxième\n');
  assert.deepEqual(reçues, ['première', 'deuxième']);
});

test('le découpeur rend les lignes séparées par des retours chariot', () => {
  // C'est LE test qui compte : les barres de progression réécrivent la même
  // ligne avec « \r » et n'émettent jamais de « \n ». Un découpeur qui n'attend
  // que des sauts de ligne ne recevrait rien avant la toute fin, et l'interface
  // resterait figée pendant les 17 heures d'un premier rattrapage.
  const reçues = [];
  const absorber = créerDécoupeur((l) => reçues.push(l));
  absorber('Téléchargement  10%\rTéléchargement  20%\rTéléchargement  30%\r');
  assert.deepEqual(reçues, [
    'Téléchargement  10%',
    'Téléchargement  20%',
    'Téléchargement  30%',
  ]);
});

test('le découpeur traite « \\r\\n » comme un seul séparateur', () => {
  const reçues = [];
  const absorber = créerDécoupeur((l) => reçues.push(l));
  absorber('une\r\ndeux\r\n');
  assert.deepEqual(reçues, ['une', 'deux']);
});

test('le découpeur conserve une ligne incomplète jusqu’au bloc suivant', () => {
  const reçues = [];
  const absorber = créerDécoupeur((l) => reçues.push(l));
  absorber('Téléchar');
  assert.deepEqual(reçues, []);
  absorber('gement 50%\n');
  assert.deepEqual(reçues, ['Téléchargement 50%']);
});

test('le découpeur ignore les lignes vides', () => {
  const reçues = [];
  const absorber = créerDécoupeur((l) => reçues.push(l));
  absorber('\n\n   \n\rok\r\n\n');
  assert.deepEqual(reçues, ['ok']);
});

// ---------------------------------------------------------------------------
// Classement des lignes
// ---------------------------------------------------------------------------

test('classerLigne repère les erreurs qui comptent vraiment', () => {
  for (const ligne of [
    'Failed fetching audio key!',
    'ERROR: Track is unavailable in your region',
    'Rate limit exceeded, too many requests',
    'This track requires Premium',
  ]) {
    assert.equal(classerLigne(ligne).type, 'erreur', `non repéré : ${ligne}`);
  }
});

test('classerLigne extrait le pourcentage de progression', () => {
  const classée = classerLigne('Downloading Prix Choc  42%');
  assert.equal(classée.type, 'progression');
  assert.equal(classée.pourcentage, 42);
});

test('classerLigne considère le reste comme informatif', () => {
  assert.equal(classerLigne('Preparing download of 12 tracks').type, 'info');
});

// ---------------------------------------------------------------------------
// Construction de la ligne de commande
// ---------------------------------------------------------------------------

const CONFIG = {
  qualité: { niveau: 'tres_elevee', format: 'copie' },
  zotify: { commande: 'zotify', argumentsSupplémentaires: '' },
};

test('construireArguments n’utilise que les options réellement supportées', () => {
  const capacités = {
    options: ['help', 'root-path', 'output', 'download-quality', 'audio-format', 'bulk-wait-time'],
  };
  const { arguments: args, nonAppliqués } = construireArguments({
    url: 'https://open.spotify.com/playlist/abc',
    config: CONFIG,
    attente: 30,
    capacités,
    modèle: '{playlist}/{artist} - {song_name}',
    dossierRacine: '/Musique/Zotijean',
  });

  assert.deepEqual(nonAppliqués, []);
  assert.ok(args.includes('--download-quality'));
  assert.ok(args.includes('very_high'));
  assert.ok(args.includes('--audio-format'));
  assert.ok(args.includes('copy'));
  assert.ok(args.includes('--bulk-wait-time'));
  assert.ok(args.includes('30'));
  // L'URL est toujours le dernier argument.
  assert.equal(args.at(-1), 'https://open.spotify.com/playlist/abc');
});

test('construireArguments signale les réglages qu’il n’a pas pu appliquer', () => {
  // Un fork plus ancien qui ne connaît ni le format ni le rythme : il ne faut
  // surtout pas passer l'option quand même (le téléchargement échouerait), mais
  // il faut le dire à l'utilisateur plutôt que de laisser croire que c'est actif.
  const capacités = { options: ['help', 'root-path', 'output'] };
  const { arguments: args, nonAppliqués } = construireArguments({
    url: 'https://open.spotify.com/playlist/abc',
    config: CONFIG,
    attente: 30,
    capacités,
    modèle: '{playlist}/{song_name}',
    dossierRacine: '/Musique',
  });

  assert.ok(!args.some((a) => a.includes('quality')));
  assert.ok(!args.some((a) => a.includes('format')));
  assert.equal(nonAppliqués.length, 3); // qualité, format, rythme
  assert.ok(nonAppliqués.some((m) => m.includes('qualité')));
});

test('construireArguments accepte des variantes de noms d’options', () => {
  const capacités = { options: ['help', 'output-path', 'quality', 'codec'] };
  const { arguments: args } = construireArguments({
    url: 'u', config: CONFIG, attente: 5, capacités, modèle: '{song_name}', dossierRacine: '/M',
  });
  assert.ok(args.includes('--output-path'));
  assert.ok(args.includes('--quality'));
  assert.ok(args.includes('--codec'));
});

test('construireArguments transmet les arguments supplémentaires de l’utilisateur', () => {
  const config = { ...CONFIG, zotify: { argumentsSupplémentaires: '--print-errors --lyrics' } };
  const { arguments: args } = construireArguments({
    url: 'u', config, attente: 5, capacités: { options: ['help'] },
    modèle: '{song_name}', dossierRacine: '/M',
  });
  assert.ok(args.includes('--print-errors'));
  assert.ok(args.includes('--lyrics'));
});

// ---------------------------------------------------------------------------
// Lecture de l'aide de zotify
// ---------------------------------------------------------------------------

test('optionsDéclarées extrait les options longues d’un texte d’aide', () => {
  const aide = `
    usage: zotify [-h] [--output OUTPUT] [--download-quality {normal,high,very_high}]
    options:
      -h, --help            show this help message and exit
      --bulk-wait-time N    seconds between downloads
  `;
  const options = optionsDéclarées(aide);
  assert.ok(options.has('help'));
  assert.ok(options.has('output'));
  assert.ok(options.has('download-quality'));
  assert.ok(options.has('bulk-wait-time'));
  assert.ok(!options.has('inexistante'));
});

test('extraireVersion lit un numéro de version', () => {
  assert.equal(extraireVersion('Zotify 0.17.4'), '0.17.4');
  assert.equal(extraireVersion('zotify v1.2'), '1.2');
  assert.equal(extraireVersion('aucune version ici'), null);
});

// ---------------------------------------------------------------------------
// Le disque comme seule source de vérité
// ---------------------------------------------------------------------------

function dossierTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-test-'));
}

test('inventorier trouve les fichiers audio récursivement', () => {
  const racine = dossierTemporaire();
  try {
    fs.mkdirSync(path.join(racine, 'Été 2026'), { recursive: true });
    fs.writeFileSync(path.join(racine, 'Été 2026', 'a.ogg'), 'x'.repeat(100));
    fs.writeFileSync(path.join(racine, 'b.flac'), 'y'.repeat(200));
    fs.writeFileSync(path.join(racine, 'notes.txt'), 'pas de la musique');

    const inventaire = inventorier(racine);
    assert.equal(inventaire.size, 2);
    const noms = [...inventaire.values()].map((f) => path.basename(f.chemin)).sort();
    assert.deepEqual(noms, ['a.ogg', 'b.flac']);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('inventorier ignore les dossiers techniques', () => {
  const racine = dossierTemporaire();
  try {
    fs.mkdirSync(path.join(racine, '_Archive'), { recursive: true });
    fs.mkdirSync(path.join(racine, '.cache'), { recursive: true });
    fs.writeFileSync(path.join(racine, '_Archive', 'vieux.ogg'), 'x'.repeat(100));
    fs.writeFileSync(path.join(racine, '.cache', 'temp.ogg'), 'x'.repeat(100));
    fs.writeFileSync(path.join(racine, 'actuel.ogg'), 'x'.repeat(100));

    assert.equal(inventorier(racine).size, 1);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('nouveauxFichiers ne retient que ce qui est réellement apparu', () => {
  const avant = new Map([['/m/a.ogg', { chemin: '/m/a.ogg', taille: 5_000_000 }]]);
  const après = new Map([
    ['/m/a.ogg', { chemin: '/m/a.ogg', taille: 5_000_000 }],
    ['/m/b.ogg', { chemin: '/m/b.ogg', taille: 6_000_000 }],
  ]);

  const { nouveaux, suspects } = nouveauxFichiers(avant, après);
  assert.equal(nouveaux.length, 1);
  assert.equal(nouveaux[0].chemin, '/m/b.ogg');
  assert.equal(suspects.length, 0);
});

test('nouveauxFichiers écarte les téléchargements avortés', () => {
  // zotify laisse parfois un fichier de quelques octets quand il échoue. Le
  // compter comme un succès ferait croire à l'app que le morceau est acquis, et
  // elle ne le retélécharcherait jamais.
  const avant = new Map();
  const après = new Map([
    ['/m/complet.ogg', { chemin: '/m/complet.ogg', taille: 5_000_000 }],
    ['/m/avorte.ogg', { chemin: '/m/avorte.ogg', taille: 512 }],
  ]);

  const { nouveaux, suspects } = nouveauxFichiers(avant, après);
  assert.deepEqual(nouveaux.map((f) => f.chemin), ['/m/complet.ogg']);
  assert.deepEqual(suspects.map((f) => f.chemin), ['/m/avorte.ogg']);
});

test('l’inventaire compare les accents indépendamment de leur écriture', () => {
  // Deux écritures du même « é ». Sans normalisation, le fichier paraîtrait
  // nouveau à chaque exécution et serait retéléchargé indéfiniment.
  const nfc = '/m/Crécy.ogg'.normalize('NFC');
  const nfd = '/m/Crécy.ogg'.normalize('NFD');

  const avant = inventaireFactice([nfd]);
  const après = inventaireFactice([nfc]);

  const { nouveaux } = nouveauxFichiers(avant, après);
  assert.equal(nouveaux.length, 0, 'le même fichier a été vu comme nouveau');
});

function inventaireFactice(chemins) {
  return new Map(
    chemins.map((c) => [c.normalize('NFC'), { chemin: c, taille: 5_000_000 }]),
  );
}
