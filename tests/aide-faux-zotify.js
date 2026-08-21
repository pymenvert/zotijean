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
  --skip-existing SKIP_EXISTING
                        do not re-download existing files
  --skip-prev-downloaded SKIP_PREVIOUSLY_DOWNLOADED
                        skip anything already in the global archive
  --song-archive-location SONG_ARCHIVE_LOCATION
                        where the global archive lives
  --disable-directory-archives DISABLE_DIRECTORY_ARCHIVES
                        do not keep a per-folder archive
  --lyrics-to-file LYRICS_TO_FILE
  --lyrics-to-metadata LYRICS_TO_METADATA
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

// LA MORT SILENCIEUSE, et c'est le scénario qui manquait le plus.
//
// Le contraire exact de « echec-total » : celui-ci PARLE puis rend 0, celui-là
// se TAIT puis rend 1. C'est ce que fait un environnement Python abîmé — une
// bibliothèque manquante, un paquet mis en quarantaine par macOS, l'app
// déplacée. Le lanceur répond encore à `--version` et `--help`, donc le
// diagnostic passe au vert, puis il meurt au moment du vrai appel.
//
// Sans ce scénario, aucun test ne pouvait montrer que l'app comptait ce cas
// comme un succès : elle avançait sa date de référence et attendait 48 h.
if (scénario === 'mort-silencieuse') {
  process.exit(1);
}

// Les paroles manquantes : le scénario qui a coûté le plus cher.
//
// Le vrai zotify, le 19 août 2026, a écrit exactement ces lignes pendant que
// les trois titres arrivaient sur le disque, entiers. Elles contiennent
// « failed » sans qu'aucun morceau ne soit perdu. Le leurre les émet donc AVANT
// d'écrire les fichiers, comme le vrai.
const parolesManquantes = scénario === 'paroles-manquantes';

// Le journal global des telechargements, reproduit fidelement.
//
// Le vrai zotify n'y ecrit QUE si le fichier existe deja : « disabled = not
// Path(filepath).exists() » (utils.py:320), et « add_obj » sort aussitot quand
// c'est le cas. Reproduire cette regle est le seul moyen qu'un test attrape le
// piege — sans quoi la doublure serait plus complaisante que l'original, ce qui
// est precisement ce qui a coute le plus cher a ce projet.
const dossierJournal = valeur('song-archive-location', null);
const sansJournal = process.env.FAUX_ZOTIFY_SANS_JOURNAL === '1';

function inscrireAuJournal(destination, piste, index) {
  if (!dossierJournal || sansJournal) return;
  const fichier = path.join(dossierJournal, '.song_archive');
  if (!fs.existsSync(fichier)) return;

  // EN NFD, ET C'EST TOUT L'INTÉRÊT DE CETTE LIGNE.
  //
  // Le vrai zotify écrit ce journal depuis Python, sur un Mac. Un « é » y arrive
  // couramment en NFD — « e » suivi d'un accent combinant — alors que
  // `readdirSync` rend le même nom en NFC. Les deux s'affichent à l'identique et
  // désignent le même fichier ; ce sont deux chaînes différentes. C'est ce que
  // CLAUDE.md appelle la cause numéro un de retéléchargements infinis.
  //
  // Cette doublure inscrivait jusqu'ici la MÊME chaîne JavaScript qu'elle venait
  // de passer à `writeFileSync` : les deux côtés de la comparaison étaient donc
  // identiques par construction, et aucun test d'intégration ne pouvait voir le
  // piège. Elle était plus complaisante que l'original — exactement le défaut
  // qui a coûté au projet quatre versions sans un seul téléchargement.
  //
  // Les titres de ce leurre sont tous accentués : le cas est réellement atteint.
  fs.appendFileSync(
    fichier,
    `id${index}\t2026-08-19 15:00:00\t${piste.artist}\t${piste.song_name}\t`
    + `${String(destination).normalize('NFD')}\n`,
  );
}

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
    inscrireAuJournal(destination, piste, index);
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
