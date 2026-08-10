// Tests de la conversion de format.
//
// La conversion n'est pas exécutée ici (ffmpeg n'est pas garanti présent sur le
// poste de développement) : on teste la construction de la commande, parce que
// c'est là que se cachent les erreurs coûteuses. Un drapeau oublié ne fait pas
// échouer ffmpeg, il produit un fichier silencieusement dégradé ou sans
// étiquettes — une perte qui n'apparaît qu'à l'import dans le logiciel DJ.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PROFILS,
  nécessiteConversion,
  construireCommande,
  trouverPochette,
  tailleplausible,
  convertir,
} from '../src/conversion.js';

const base = { source: '/m/piste.ogg', destination: '/m/piste.flac' };

/** Position d'un drapeau dans la commande, -1 s'il est absent. */
const at = (args, drapeau) => args.indexOf(drapeau);

// ---------------------------------------------------------------------------
// Quand convertir
// ---------------------------------------------------------------------------

test('le format « copie » ne déclenche aucune conversion', () => {
  assert.equal(nécessiteConversion('copie'), false);
});

test('les formats cibles déclenchent une conversion', () => {
  for (const format of ['flac', 'aiff', 'mp3_320', 'aac_256']) {
    assert.equal(nécessiteConversion(format), true, format);
  }
});

test('un format inconnu ne déclenche rien plutôt que de planter', () => {
  assert.equal(nécessiteConversion('format_invente'), false);
});

// ---------------------------------------------------------------------------
// Les trois pièges de ffmpeg
// ---------------------------------------------------------------------------

test('AIFF force l’écriture des étiquettes ID3 en version 3', () => {
  // LE piège le plus coûteux : le multiplexeur AIFF de ffmpeg a write_id3v2 à 0
  // par défaut. Sans ce drapeau, le fichier est parfaitement lisible et
  // totalement sans étiquettes — une bibliothèque de lignes vides dans
  // Rekordbox, et la perte ne se voit qu'à l'import.
  const args = construireCommande({ ...base, destination: '/m/p.aiff', format: 'aiff' });
  assert.ok(at(args, '-write_id3v2') !== -1, 'write_id3v2 absent');
  assert.equal(args[at(args, '-write_id3v2') + 1], '1');
  // Et une fois activé, ffmpeg écrit de l'ID3v2.4 par défaut alors que Pioneer
  // documente l'ID3v2.3.
  assert.equal(args[at(args, '-id3v2_version') + 1], '3');
});

test('les cibles PCM appliquent un dither explicite', () => {
  // Le décodage Vorbis sort en virgule flottante. Sans dither, la réduction à
  // 16 bits est une troncature brute, audible sur les fondus et les queues de
  // réverbération.
  for (const format of ['flac', 'aiff']) {
    const args = construireCommande({ ...base, destination: `/m/p.x`, format });
    const filtre = args[at(args, '-af') + 1];
    assert.match(filtre, /dither_method=triangular_hp/, `dither absent pour ${format}`);
    assert.match(filtre, /out_sample_fmt=s16/, `format de sortie absent pour ${format}`);
  }
});

test('le MP3 utilise un débit constant, jamais la qualité variable', () => {
  // `-b:a` et `-q:a` s'excluent mutuellement sur libmp3lame : les passer tous
  // les deux produit un résultat imprévisible.
  const args = construireCommande({ ...base, destination: '/m/p.mp3', format: 'mp3_320' });
  assert.equal(args[at(args, '-b:a') + 1], '320k');
  assert.equal(at(args, '-q:a'), -1, '-q:a ne doit jamais coexister avec -b:a');
});

test('aucun profil ne rééchantillonne', () => {
  // Les flux Spotify sont déjà en 44,1 kHz. Rééchantillonner ne peut que
  // dégrader, jamais améliorer.
  for (const format of Object.keys(PROFILS)) {
    const args = construireCommande({ ...base, destination: '/m/p.x', format });
    assert.equal(at(args, '-ar'), -1, `${format} rééchantillonne`);
  }
});

// ---------------------------------------------------------------------------
// Métadonnées et pochette
// ---------------------------------------------------------------------------

test('tous les profils reportent les métadonnées de la source', () => {
  for (const format of Object.keys(PROFILS)) {
    const args = construireCommande({ ...base, destination: '/m/p.x', format });
    assert.ok(at(args, '-map_metadata') !== -1, `${format} perd les métadonnées`);
    assert.equal(args[at(args, '-map_metadata') + 1], '0');
  }
});

test('une pochette externe est jointe et marquée comme illustration', () => {
  const args = construireCommande({
    ...base, format: 'flac', pochette: '/m/piste.jpg',
  });
  assert.ok(args.includes('/m/piste.jpg'));
  assert.ok(args.includes('-disposition:v'));
  assert.equal(args[at(args, '-disposition:v') + 1], 'attached_pic');
  // Le flux vidéo est copié tel quel : ré-encoder une pochette n'a aucun sens.
  assert.equal(args[at(args, '-c:v') + 1], 'copy');
});

test('sans pochette, aucun mappage vidéo n’est tenté', () => {
  const args = construireCommande({ ...base, format: 'flac', pochette: null });
  assert.equal(at(args, '-map'), args.indexOf('-map'));
  assert.equal(args.filter((a) => a === '-map').length, 1);
  assert.equal(at(args, '-disposition:v'), -1);
});

test('l’AAC en conteneur MP4 n’embarque pas la pochette de cette façon', () => {
  // Certains lecteurs refusent le fichier produit ; mieux vaut un fichier lisible
  // sans pochette qu'un fichier illisible avec.
  const args = construireCommande({
    ...base, destination: '/m/p.m4a', format: 'aac_256', pochette: '/m/piste.jpg',
  });
  assert.ok(!args.includes('/m/piste.jpg'));
  assert.equal(at(args, '-disposition:v'), -1);
});

test('la source est toujours la première entrée', () => {
  const args = construireCommande({ ...base, format: 'flac', pochette: '/m/piste.jpg' });
  assert.equal(args[at(args, '-i') + 1], '/m/piste.ogg');
  // Et le flux audio vient bien de l'entrée 0.
  assert.ok(args.includes('0:a:0'));
});

test('la destination est le dernier argument', () => {
  const args = construireCommande({ ...base, format: 'flac' });
  assert.equal(args.at(-1), '/m/piste.flac');
});

test('un format inconnu lève une erreur explicite', () => {
  assert.throws(
    () => construireCommande({ ...base, format: 'invente' }),
    /Format de conversion inconnu/,
  );
});

// ---------------------------------------------------------------------------
// Vérification du résultat
// ---------------------------------------------------------------------------

test('un fichier sans perte doit peser plus lourd que sa source', () => {
  // Un FLAC issu d'un Ogg 320 est toujours nettement plus gros. S'il est plus
  // petit, ffmpeg s'est interrompu en route — et son code de sortie ne le dit pas.
  assert.equal(tailleplausible(5_000_000, 12_000_000, 'flac'), true);
  assert.equal(tailleplausible(5_000_000, 3_000_000, 'flac'), false);
});

test('un fichier avec perte reste dans un rapport raisonnable', () => {
  assert.equal(tailleplausible(5_000_000, 5_000_000, 'mp3_320'), true);
  assert.equal(tailleplausible(5_000_000, 500_000, 'mp3_320'), false);
});

test('un fichier minuscule est toujours écarté', () => {
  assert.equal(tailleplausible(5_000_000, 1024, 'flac'), false);
  assert.equal(tailleplausible(5_000_000, 1024, 'mp3_320'), false);
});

// ---------------------------------------------------------------------------
// Recherche de pochette
// ---------------------------------------------------------------------------

test('trouverPochette repère une image portant le nom du morceau', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-pochette-'));
  try {
    const audio = path.join(racine, 'Prix Choc.ogg');
    fs.writeFileSync(audio, 'x');
    fs.writeFileSync(path.join(racine, 'Prix Choc.jpg'), 'image');
    assert.equal(trouverPochette(audio), path.join(racine, 'Prix Choc.jpg'));
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('trouverPochette retombe sur une pochette de dossier', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-pochette-'));
  try {
    const audio = path.join(racine, 'Prix Choc.ogg');
    fs.writeFileSync(audio, 'x');
    fs.writeFileSync(path.join(racine, 'cover.jpg'), 'image');
    assert.equal(trouverPochette(audio), path.join(racine, 'cover.jpg'));
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('trouverPochette renvoie null quand il n’y en a pas', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-pochette-'));
  try {
    const audio = path.join(racine, 'Prix Choc.ogg');
    fs.writeFileSync(audio, 'x');
    assert.equal(trouverPochette(audio), null);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Refus de régénérer
// ---------------------------------------------------------------------------

test('convertir ne régénère jamais un fichier existant', async () => {
  // La règle la plus importante du projet : un fichier déjà présent a pu être
  // analysé par Serato ou Rekordbox, qui écrivent leurs points de repère et leur
  // grille rythmique DANS le fichier. L'écraser détruirait des heures de travail.
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-conv-'));
  try {
    const source = path.join(racine, 'piste.ogg');
    const cible = path.join(racine, 'piste.flac');
    fs.writeFileSync(source, 'x'.repeat(5_000_000));
    fs.writeFileSync(cible, 'DEJA ANALYSE PAR SERATO');

    const résultat = await convertir({ source, format: 'flac' });

    assert.equal(résultat.réussi, true);
    assert.ok(résultat.ignoré, 'le fichier existant aurait été régénéré');
    assert.equal(fs.readFileSync(cible, 'utf8'), 'DEJA ANALYSE PAR SERATO');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('convertir échoue proprement quand ffmpeg est absent', async () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-conv-'));
  try {
    const source = path.join(racine, 'piste.ogg');
    fs.writeFileSync(source, 'x'.repeat(5_000_000));

    const résultat = await convertir({
      source, format: 'flac', ffmpeg: path.join(racine, 'ffmpeg-inexistant'),
    });

    assert.equal(résultat.réussi, false);
    assert.ok(résultat.raison.length > 10);
    // La source doit être intacte : on ne perd jamais le téléchargement.
    assert.ok(fs.existsSync(source));
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});
