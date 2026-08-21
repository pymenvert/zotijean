// Tests de la conversion de format.
//
// L'essentiel porte sur la construction de la commande, parce que c'est là que
// se cachent les erreurs coûteuses. Un drapeau oublié ne fait pas échouer
// ffmpeg : il produit un fichier silencieusement dégradé ou sans étiquettes —
// une perte qui n'apparaît qu'à l'import dans le logiciel DJ.
//
// DEUX TESTS EXÉCUTENT POURTANT UNE VRAIE CONVERSION, et ce n'est pas un luxe.
// « tailleplausible » était testée à fond en isolation, mais la garde qui la
// CONSOMME — celle qui jette le fichier produit — n'avait jamais tourné : les
// deux tests de « convertir » sortaient avant, et les tests d'intégration
// utilisent le format « copie », qui ne convertit rien. Inverser cette garde,
// donc mettre en place les fichiers invraisemblables et jeter les bons,
// survivait à la suite entière.
//
// C'est exactement la forme de trou qui avait fait qu'aucune version avant la
// 1.0.5 ne téléchargeait quoi que ce soit : une pièce parfaitement testée, et
// personne pour vérifier qu'on l'appelle correctement.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  PROFILS,
  nécessiteConversion,
  construireCommande,
  trouverPochette,
  tailleplausible,
  convertir,
  convertirLot,
  démarrerConversionContinue,
  estUnTemporaireDeConversion,
  nettoyerTemporairesDeConversion,
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

// La source est TOUJOURS un Ogg sorti de zotify, et l'Ogg range ses
// commentaires sur le flux, pas sur le conteneur. Ce test épinglait « 0 », ce
// qui revenait à ne rien recopier : les fichiers convertis sortaient sans
// artiste, sans titre, sans album et sans ISRC, et le test restait vert. Il
// gardait la présence du drapeau, jamais son effet.
test('tous les profils reportent les métadonnées du FLUX de la source', () => {
  for (const format of Object.keys(PROFILS)) {
    const args = construireCommande({ ...base, destination: '/m/p.x', format });
    assert.ok(at(args, '-map_metadata') !== -1, `${format} perd les métadonnées`);
    assert.equal(
      args[at(args, '-map_metadata') + 1],
      '0:s:0',
      `${format} recopie les étiquettes du conteneur, vide sur un Ogg`,
    );
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

test('un fichier minuscule est écarté même quand le rapport, lui, est bon', () => {
  // Les deux cas ci-dessus échouent pour DEUX raisons à la fois — le plancher
  // ET le rapport — ce qui laissait le plancher de 16 Ko sans garde propre.
  // Éprouvé en cassant le code exprès : le supprimer ne faisait tomber aucun
  // test. Ici, il est seul à pouvoir rejeter — 8 Ko produits depuis 1 Ko de
  // source satisfont largement tous les rapports.
  assert.equal(tailleplausible(1024, 8 * 1024, 'flac'), false);
  assert.equal(tailleplausible(1024, 8 * 1024, 'mp3_320'), false);
});

test('un sans-perte de la taille EXACTE de sa source est écarté', () => {
  // Le cas limite, celui que les bornes ratent toujours. Un FLAC obtenu depuis
  // un Ogg pèse nettement plus lourd : une taille rigoureusement identique
  // signale une copie déguisée, pas une conversion. Éprouvé : relâcher la
  // comparaison en « au moins aussi lourd » ne faisait tomber aucun test.
  assert.equal(tailleplausible(5_000_000, 5_000_000, 'flac'), false);
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

    // On passe volontairement un ffmpeg inexistant : le refus de régénérer doit
    // se décider AVANT toute dépendance externe. Sans cet ordre, une machine
    // sans ffmpeg signalerait une erreur pour chaque morceau déjà converti.
    const résultat = await convertir({
      source, format: 'flac', ffmpeg: path.join(racine, 'ffmpeg-absent'),
    });

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

// ---------------------------------------------------------------------------
// La garde qui jette un fichier invraisemblable — exécutée pour de vrai
// ---------------------------------------------------------------------------

const SAUTER_LEURRE = process.platform === 'win32'
  ? 'Node refuse de lancer un script sans shell ; ce test tourne sur macOS et Linux en intégration continue.'
  : false;

test('un fichier produit invraisemblable est jeté, jamais mis en place', { skip: SAUTER_LEURRE }, async () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-rebut-'));
  try {
    const source = path.join(racine, 'Prix Choc.ogg');
    fs.writeFileSync(source, Buffer.alloc(5_000_000));

    // Un ffmpeg qui RÉUSSIT — code de sortie 0 — mais livre un fichier d'un
    // octet. C'est précisément le cas que le code de sortie ne signale pas, et
    // la seule raison d'être de la vérification sur disque.
    const leurre = path.join(racine, 'ffmpeg-tronqueur');
    fs.writeFileSync(leurre, '#!/bin/sh\nfor a in "$@"; do dest="$a"; done\nprintf x > "$dest"\nexit 0\n');
    fs.chmodSync(leurre, 0o755);

    const résultat = await convertir({ source, format: 'flac', ffmpeg: leurre });

    assert.equal(résultat.réussi, false, 'un fichier d’un octet a été accepté');
    assert.match(résultat.raison, /invraisemblable/);
    assert.equal(
      fs.existsSync(path.join(racine, 'Prix Choc.flac')),
      false,
      'le fichier écarté a quand même pris la place de la cible',
    );
    assert.deepEqual(
      fs.readdirSync(racine).filter((f) => f.includes('.tmp')),
      [],
      'le rebut est resté sur le disque',
    );
    assert.ok(
      fs.existsSync(source),
      'la source a été supprimée : ce n’est pas à « convertir » d’en décider',
    );
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// Le seul endroit de ce projet où ffmpeg fait réellement son travail. Les
// serveurs Linux d'intégration continue en embarquent un ; ailleurs, le test se
// saute plutôt que de mentir.
const FFMPEG_RÉEL = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return null;
  }
})();

test('convertir produit vraiment un fichier et le met en place sans résidu', {
  skip: FFMPEG_RÉEL ? false : 'ffmpeg absent d’ici ; ce test tourne sur les serveurs d’intégration continue.',
  timeout: 120_000,
}, async () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-conv-reelle-'));
  try {
    const source = path.join(racine, 'Prix Choc.mp3');
    // Du BRUIT, pas un silence : un silence se comprime à quelques kilo-octets
    // et tomberait sous le plancher de 16 Ko pour une raison sans aucun rapport
    // avec ce qu'on cherche à vérifier.
    execFileSync(FFMPEG_RÉEL, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'anoisesrc=d=8:c=pink:r=44100',
      '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '320k', source]);

    const résultat = await convertir({ source, format: 'flac', ffmpeg: FFMPEG_RÉEL });

    assert.ok(résultat.réussi, `la conversion a échoué : ${résultat.raison}`);
    assert.ok(fs.existsSync(résultat.destination), 'le fichier converti n’est pas à sa place');
    assert.ok(
      fs.statSync(résultat.destination).size > fs.statSync(source).size,
      'un sans-perte issu d’un fichier avec perte doit peser nettement plus lourd',
    );
    assert.deepEqual(fs.readdirSync(racine).filter((f) => f.includes('.tmp')), []);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Un fichier déjà converti n'est pas un fichier perdu
// ---------------------------------------------------------------------------
//
// CE QUE CE TEST ATTRAPE, et qui s'est produit en vrai le 19 août 2026 : quand
// la cible existe déjà, `convertir` refuse — à raison, un fichier réanalysé par
// Serato porte des points de repère qu'il ne faut pas écraser. Mais le lot
// rangeait alors le fichier dans « ignorés » SANS sa destination. L'appelant,
// ne voyant aucune conversion, retombait sur les sources : les listes de lecture
// pointaient des .ogg que Rekordbox ne lit pas, alors que les .mp3 étaient là,
// à côté, complets.
//
// Le cas devient courant dès que la conversion tourne pendant le
// téléchargement : à la fin, TOUT est déjà converti.
test('un lot dont la cible existe déjà rend quand même le chemin converti', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-deja-'));
  try {
    const source = path.join(dossier, 'piste.ogg');
    const cible = path.join(dossier, 'piste.mp3');
    fs.writeFileSync(source, Buffer.alloc(5_000_000, 1));
    fs.writeFileSync(cible, Buffer.alloc(5_000_000, 2));

    const bilan = await convertirLot({ fichiers: [source], format: 'mp3_320' });

    assert.equal(bilan.échecs.length, 0);
    assert.equal(bilan.convertis.length, 0, 'rien n’a été reconverti, et c’est voulu');
    assert.deepEqual(
      bilan.déjàPrêts.map((p) => p.destination),
      [cible],
      'le fichier converti doit rester retrouvable, sinon la liste de lecture pointe la source',
    );
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Convertir pendant que zotify télécharge
// ---------------------------------------------------------------------------
//
// LE DÉFAUT QUE CECI FERME : deux exécutions interrompues le 19 août ont laissé
// 13 fichiers en Ogg alors que le réglage demandait du MP3. `convertirLot` sort
// à la première boucle quand l'arrêt est déjà demandé, et RIEN ne rattrapait
// jamais ces fichiers — la conversion ne regarde que les nouveautés de
// l'exécution en cours, pendant que `--skip-existing` empêche zotify de les
// reproposer.
//
// Convertir au fil de l'eau supprime la fenêtre : à l'instant de l'arrêt, tout
// ce qui est descendu est déjà converti. zotify écrit en .tmp puis renomme, donc
// un fichier portant une extension audio est complet — et les 30 s d'attente
// entre deux titres laissent tout le temps.
test('la conversion au fil de l’eau prend les fichiers dès qu’ils apparaissent', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-fil-'));
  try {
    const convertis = [];
    // Doublure : on éprouve la MOISSON, pas ffmpeg, qui a ses propres tests.
    const convertirUn = async ({ source }) => {
      const destination = `${source.slice(0, -4)}.mp3`;
      fs.writeFileSync(destination, 'x');
      convertis.push(path.basename(source));
      return { réussi: true, destination };
    };

    const moisson = démarrerConversionContinue({
      dossier, format: 'mp3_320', intervalleMs: 20, convertirUn,
    });

    // Les fichiers apparaissent l'un après l'autre, comme sous zotify.
    for (const nom of ['01 - A.ogg', '02 - B.ogg', '03 - C.ogg']) {
      fs.writeFileSync(path.join(dossier, nom), Buffer.alloc(5_000_000, 1));
      await new Promise((r) => setTimeout(r, 80));
    }

    const bilan = await moisson.arrêter();

    assert.deepEqual(convertis, ['01 - A.ogg', '02 - B.ogg', '03 - C.ogg']);
    assert.equal(bilan.convertis.length, 3);
    // Et aucun Ogg ne reste sans jumeau : c'est la propriété qui compte.
    const restants = fs.readdirSync(dossier).filter((f) => f.endsWith('.ogg'))
      .filter((f) => !fs.existsSync(path.join(dossier, f.replace(/\.ogg$/, '.mp3'))));
    assert.deepEqual(restants, []);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('la moisson ne convertit jamais deux fois le même fichier', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-fil2-'));
  try {
    let appels = 0;
    const convertirUn = async ({ source }) => {
      appels += 1;
      const destination = `${source.slice(0, -4)}.mp3`;
      fs.writeFileSync(destination, 'x');
      return { réussi: true, destination };
    };

    fs.writeFileSync(path.join(dossier, 'A.ogg'), Buffer.alloc(5_000_000, 1));
    const moisson = démarrerConversionContinue({
      dossier, format: 'mp3_320', intervalleMs: 10, convertirUn,
    });
    await new Promise((r) => setTimeout(r, 120));
    await moisson.arrêter();

    assert.equal(appels, 1, 'la boucle repasse toutes les 10 ms : sans mémoire, elle rejouerait');
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('un fichier déjà accompagné de son converti est laissé tranquille', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-fil3-'));
  try {
    let appels = 0;
    fs.writeFileSync(path.join(dossier, 'A.ogg'), Buffer.alloc(5_000_000, 1));
    fs.writeFileSync(path.join(dossier, 'A.mp3'), Buffer.alloc(5_000_000, 2));

    const moisson = démarrerConversionContinue({
      dossier, format: 'mp3_320', intervalleMs: 10,
      convertirUn: async () => { appels += 1; return { réussi: false }; },
    });
    await new Promise((r) => setTimeout(r, 60));
    await moisson.arrêter();

    assert.equal(appels, 0);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

// ÉPROUVÉ EN CASSANT LE CODE EXPRÈS, 21 août 2026. Porter le rapport minimal de
// 0,25 à 0,9 laissait toute la suite au vert : les cas déjà testés (un converti
// de même taille, un converti au dixième) tombent des deux côtés de la nouvelle
// borne comme de l'ancienne. Le relevé du 17 août avait déjà nommé cette borne ;
// elle est désormais tenue.
test('un converti légitimement plus léger que sa source reste plausible', () => {
  // L'AAC 256 tiré d'un Ogg 320 pèse environ 80 % de sa source. C'est le cas
  // NORMAL de ce format, pas un cas de coin — et c'est lui qui distingue une
  // borne réglée pour attraper une troncature d'une borne réglée au jugé.
  assert.equal(
    tailleplausible(5_000_000, 4_000_000, 'aac_256'), true,
    'un AAC 256 parfaitement valide est déclaré suspect : le fichier serait '
    + 'écarté et le morceau compté comme perdu',
  );

  // Et le sens inverse : un fichier coupé en cours de route reste refusé.
  assert.equal(tailleplausible(5_000_000, 1_000_000, 'aac_256'), false);
});

// ---------------------------------------------------------------------------
// Le ramassage des conversions inachevées
//
// La conversion écrit son travail dans « .Titre.1234.tmp.flac » et ne renomme
// qu'à la fin. Fermer l'application pendant un transcodage laisse ce fichier —
// et c'est le chemin de fermeture NORMAL, puisqu'un onglet ouvert force la
// sortie au bout de cinq secondes.
//
// CE RAMASSAGE VIT ICI, ET PAS DANS LE BALAYAGE DE ZOTIFY. Celui-là tourne à la
// fermeture de chaque processus zotify, c'est-à-dire pendant que la moisson de
// conversion travaille encore : il détruirait le fichier en cours d'écriture.
// Une première version l'avait fait, rattrapée en revue le 21 août 2026.
// ---------------------------------------------------------------------------

test('un temporaire de conversion abandonné est reconnu', () => {
  assert.equal(estUnTemporaireDeConversion('.Prix Choc.1234.tmp.flac', 9999), true);
  assert.equal(estUnTemporaireDeConversion('.Étienne de Crécy - Prix Choc.42.tmp.m4a', 9999), true);
});

test('un temporaire du processus COURANT n’est jamais touché', () => {
  // C'est le fichier que ffmpeg est peut-être en train d'écrire à l'instant.
  // On ne supprime jamais par défaut, et surtout pas ce qu'on fabrique.
  assert.equal(
    estUnTemporaireDeConversion('.Prix Choc.1234.tmp.flac', 1234), false,
    'le ramassage peut détruire une conversion en cours',
  );
});

test('la forme exigée est entière : aucun morceau légitime ne correspond', () => {
  // Le vrai risque de toute règle de suppression. Ces noms sont des morceaux,
  // pas des restes — y compris ceux qui commencent par un point, qui existent
  // dès qu'un schéma de rangement nomme le fichier d'après le titre.
  for (const nom of [
    'Prix Choc.flac',
    'A.C.A.B. (Mix).mp3',
    '...Baby One More Time.ogg',      // le titre commence par des points
    '.38 Special - Hold On Loosely.mp3',
    '.DS_Store',
    '._Prix Choc.flac',              // compagnon macOS, pas un temporaire
    'Prix Choc.1234.tmp.flac',       // sans le point de tête
    '.Prix Choc.tmp.flac',           // sans le numéro de processus
    '.Prix Choc.1234.tmp',           // c'est la forme de zotify, pas la nôtre
  ]) {
    assert.equal(
      estUnTemporaireDeConversion(nom, 9999), false,
      `« ${nom} » serait supprimé`,
    );
  }
});

test('le ramassage descend dans l’arborescence et épargne le reste', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-ramassage-'));
  try {
    const playlist = path.join(racine, 'Été 2026');
    fs.mkdirSync(playlist);

    const abandonné = path.join(playlist, '.Prix Choc.999999.tmp.flac');
    const enCours = path.join(playlist, `.Autre titre.${process.pid}.tmp.flac`);
    const morceau = path.join(playlist, 'Prix Choc.flac');
    const titrePointu = path.join(playlist, '...Baby One More Time.ogg');

    for (const f of [abandonné, enCours, morceau, titrePointu]) fs.writeFileSync(f, 'x');

    const supprimés = nettoyerTemporairesDeConversion(racine);

    assert.deepEqual(
      supprimés.map((s) => path.basename(s.chemin)), ['.Prix Choc.999999.tmp.flac'],
    );
    assert.equal(fs.existsSync(enCours), true,
      'le temporaire du processus courant a été détruit — il pouvait être en cours d’écriture');
    assert.equal(fs.existsSync(morceau), true, 'un morceau a été détruit');
    assert.equal(fs.existsSync(titrePointu), true,
      'un morceau dont le titre commence par un point a été détruit');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});
