// Faux zotify, pour tester la chaîne complète sans dépendre du vrai.
//
// zotify n'est pas installable sur un serveur d'intégration continue, et le
// poste de développement tourne sous Windows. Sans ce leurre, le module qui
// orchestre TOUT — diagnostic, téléchargement, vérification disque, conversion,
// listes de lecture, nommage — resterait le seul à n'avoir aucun test.
//
// Il imite ce qui compte pour l'app :
//   - répond à --version et --help comme le vrai,
//   - écrit de vrais fichiers selon le modèle --output,
//   - émet sa progression avec des RETOURS CHARIOT et non des sauts de ligne,
//     puisque c'est précisément ce piège que le découpeur doit encaisser,
//   - renvoie le code de sortie 0 même quand une piste échoue, comme le vrai.

import fs from 'node:fs';
import path from 'node:path';

const arguments_ = process.argv.slice(2);

function valeur(nom, secours = null) {
  const index = arguments_.indexOf(`--${nom}`);
  return index === -1 ? secours : arguments_[index + 1];
}

// --- Interrogations du diagnostic -----------------------------------------

if (arguments_.includes('--version')) {
  process.stdout.write('Zotify 0.17.4\n');
  process.exit(0);
}

if (arguments_.includes('--help')) {
  process.stdout.write(`usage: zotify [-h] [--root-path ROOT_PATH] [--output OUTPUT]
                     [--download-quality {normal,high,very_high}]
                     [--audio-format {copy,mp3,flac,aiff,aac}]
                     [--bulk-wait-time N] [--skip-existing]
                     urls [urls ...]

options:
  -h, --help            show this help message and exit
  --root-path           where to save the music
  --output              output template
  --download-quality    audio quality
  --audio-format        output format
  --bulk-wait-time      seconds between downloads
  --skip-existing       do not re-download existing files
`);
  process.exit(0);
}

// --- Téléchargement simulé -------------------------------------------------

const racine = valeur('root-path', process.cwd());
const modèle = valeur('output', '{playlist}/{playlist_num} - {artist} - {song_name}');
const format = valeur('audio-format', 'copy');
const url = arguments_[arguments_.length - 1];

// Le scénario est piloté par une variable d'environnement, ce qui permet à
// chaque test de décider ce que « zotify » va faire.
const scénario = process.env.FAUX_ZOTIFY_SCENARIO || 'normal';
const nomPlaylist = process.env.FAUX_ZOTIFY_PLAYLIST || 'Été 2026';

const EXTENSIONS = { copy: 'ogg', mp3: 'mp3', flac: 'flac', aiff: 'aiff', aac: 'm4a' };
const extension = EXTENSIONS[format] || 'ogg';

/** Quelques titres avec des pièges volontaires : accents, apostrophe, barre oblique. */
const PISTES = [
  { artist: 'Étienne de Crécy', song_name: 'Prix Choc', album: 'Super Discount' },
  { artist: 'AC/DC', song_name: 'Who Made Who ? (12" Mix)', album: 'Who Made Who' },
  { artist: 'Édith Piaf', song_name: "Non, je ne regrette rien", album: 'À l’Olympia' },
];

/**
 * Nettoie une VALEUR avant de l'insérer dans le gabarit.
 *
 * L'ordre compte : nettoyer après substitution laisserait la barre oblique de
 * « AC/DC » découper le chemin et créer un dossier parasite. Le vrai zotify
 * nettoie chaque valeur, pas le résultat — le leurre doit faire pareil, sinon
 * il teste un comportement qui n'existe pas.
 */
function nettoyerValeur(valeur) {
  return String(valeur).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
}

function rendre(gabarit, piste, index) {
  const valeurs = {
    playlist: nomPlaylist,
    playlist_num: String(index + 1).padStart(3, '0'),
    artist: piste.artist,
    song_name: piste.song_name,
    album: piste.album,
    album_artist: piste.artist,
    track_number: String(index + 1).padStart(2, '0'),
    disc_number: '1',
    release_year: '1996',
    genre: 'French House',
  };

  let résultat = gabarit;
  for (const [nom, valeur] of Object.entries(valeurs)) {
    résultat = résultat.replaceAll(`{${nom}}`, nettoyerValeur(valeur));
  }
  return résultat;
}

/** Dernier filet sur un segment de chemin déjà découpé. */
function assainir(segment) {
  return segment.replace(/[<>:"\\|?*\x00-\x1f]/g, '_').replace(/[.\s]+$/, '').trim();
}

if (scénario === 'echec-total') {
  process.stderr.write('Failed fetching audio key!\r');
  process.stderr.write('ERROR: Rate limit exceeded\n');
  // Le vrai zotify renvoie 0 malgré tout : c'est LA raison pour laquelle l'app
  // ne se fie qu'au disque.
  process.exit(0);
}

// Les paroles manquantes : le scénario qui a coûté le plus cher.
//
// Le vrai zotify, le 19 août 2026, a écrit exactement ces lignes pendant que
// les trois titres arrivaient sur le disque, entiers. Elles contiennent
// « failed » sans qu'aucun morceau ne soit perdu. Le leurre les émet donc AVANT
// d'écrire les fichiers, comme le vrai.
const parolesManquantes = scénario === 'paroles-manquantes';

let écrits = 0;

for (const [index, piste] of PISTES.entries()) {
  const relatif = rendre(modèle, piste, index)
    .split('/')
    .map(assainir)
    .filter(Boolean)
    .join(path.sep);

  const destination = path.join(racine, `${relatif}.${extension}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  // Progression réécrite sur la même ligne, sans saut de ligne.
  for (const pourcentage of [0, 45, 100]) {
    process.stdout.write(`Downloading ${piste.song_name}  ${pourcentage}%\r`);
  }

  if (parolesManquantes) {
    // Ligne recopiee telle quelle du journal du 19 aout 2026.
    process.stderr.write(
      `###   SKIPPING:  LYRICS FOR "${piste.artist} - ${piste.song_name}" (FAILED TO FETCH)   ###\r`,
    );
  }

  if (scénario === 'fichiers-tronques') {
    // Téléchargement avorté : quelques octets seulement. L'app doit l'écarter.
    fs.writeFileSync(destination, 'x'.repeat(200));
  } else if (scénario === 'une-piste-echoue' && index === 1) {
    process.stderr.write(`Failed fetching audio key for ${piste.song_name}\r`);
    continue;
  } else {
    // Taille plausible pour un morceau, pour passer le seuil de vraisemblance.
    fs.writeFileSync(destination, Buffer.alloc(5_000_000, 1));
  }
  écrits += 1;

  // Scénario « lent » : laisse le temps d'appuyer sur Arrêter au milieu d'une
  // playlist. Le vrai zotify attend une trentaine de secondes entre deux
  // titres ; on garde la forme, pas la durée.
  if (scénario === 'lent') {
    await new Promise((r) => { setTimeout(r, 700); });
  }
}

process.stdout.write(`\nDone. ${écrits} track(s).\n`);
process.exit(0);
