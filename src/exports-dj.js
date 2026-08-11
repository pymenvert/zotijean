// Exports vers les logiciels DJ.
//
// Ni Rekordbox ni Serato n'ont de dossier surveillé : rien n'apparaît tout seul
// dans leur bibliothèque. On produit donc les deux formats qu'ils savent lire,
// et l'utilisateur les importe une fois.
//
// DEUX PRUDENCES ABSOLUES.
//
// 1. On n'écrit JAMAIS dans master.db, la base de Rekordbox. Elle est chiffrée
//    et son schéma change à chaque version : une mauvaise écriture détruit la
//    bibliothèque d'un DJ. Le fichier XML est le canal documenté et réversible.
//
// 2. Serato doit être FERMÉ pendant l'écriture des crates. Il lit son dossier
//    au démarrage et réécrit son état mémoire en quittant : écrire pendant
//    qu'il tourne revient à ne rien écrire du tout.

import fs from 'node:fs';
import path from 'node:path';

import { exécuter, trouverExécutable } from './processus.js';
import { journal } from './journal.js';
import { assurerDossier, écrireAtomique } from './chemins.js';

// ---------------------------------------------------------------------------
// Lecture des métadonnées
// ---------------------------------------------------------------------------

const TYPES_REKORDBOX = {
  '.mp3': 'MP3 File', '.flac': 'FLAC File', '.aiff': 'AIFF File', '.aif': 'AIFF File',
  '.m4a': 'M4A File', '.wav': 'WAV File', '.ogg': 'OGG File',
};

/**
 * Lit les étiquettes d'un fichier avec ffprobe, s'il est disponible.
 * Sans lui, on se rabat sur le nom de fichier : Rekordbox et Serato analysent
 * de toute façon les morceaux à l'import, donc une métadonnée manquante n'est
 * pas bloquante — elle rend juste la bibliothèque moins agréable.
 */
export async function lireMétadonnées(fichier, ffprobe = null) {
  const binaire = ffprobe || trouverExécutable('ffprobe');
  const secours = depuisNomFichier(fichier);

  if (!binaire) return secours;

  const résultat = await exécuter(
    binaire,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', fichier],
    { délaiMs: 20000 },
  );

  if (résultat.code !== 0 || !résultat.stdout.trim()) return secours;

  let sonde;
  try {
    sonde = JSON.parse(résultat.stdout);
  } catch {
    return secours;
  }

  const format = sonde.format || {};
  const étiquettes = normaliserÉtiquettes(format.tags || {});
  const flux = (sonde.streams || []).find((s) => s.codec_type === 'audio') || {};

  return {
    titre: étiquettes.title || secours.titre,
    artiste: étiquettes.artist || secours.artiste,
    album: étiquettes.album || '',
    artisteAlbum: étiquettes.album_artist || '',
    genre: étiquettes.genre || '',
    année: (étiquettes.date || étiquettes.year || '').toString().slice(0, 4),
    numéroPiste: parseInt(étiquettes.track, 10) || 0,
    numéroDisque: parseInt(étiquettes.disc, 10) || 0,
    tonalité: étiquettes.initialkey || étiquettes.key || '',
    bpm: parseFloat(étiquettes.bpm || étiquettes.tempo) || 0,
    label: étiquettes.publisher || étiquettes.label || '',
    remixeur: étiquettes.remixer || '',
    isrc: étiquettes.isrc || '',
    commentaire: étiquettes.comment || '',
    duréeSecondes: parseFloat(format.duration) || 0,
    débitBits: parseInt(format.bit_rate, 10) || 0,
    échantillonnage: parseInt(flux.sample_rate, 10) || 0,
  };
}

/** Les clés d'étiquettes varient en casse selon le conteneur. */
function normaliserÉtiquettes(brutes) {
  const propre = {};
  for (const [clé, valeur] of Object.entries(brutes)) {
    propre[clé.toLowerCase().replace(/[\s-]/g, '_')] = valeur;
  }
  return propre;
}

/** Repli : « 007 - Artiste - Titre.flac » donne artiste et titre. */
export function depuisNomFichier(fichier) {
  const base = path.basename(fichier, path.extname(fichier));
  const sansNuméro = base.replace(/^\d{1,3}\s*[-.]\s*/, '');
  const morceaux = sansNuméro.split(' - ');

  return morceaux.length >= 2
    ? { titre: morceaux.slice(1).join(' - '), artiste: morceaux[0] }
    : { titre: sansNuméro, artiste: '' };
}

// ---------------------------------------------------------------------------
// Rekordbox — fichier XML
// ---------------------------------------------------------------------------

/** Échappement XML. Sans lui, un titre contenant « & » casse tout le fichier. */
export function échapperXML(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Les caractères de contrôle sont interdits en XML 1.0 : les laisser passer
    // produit un fichier que Rekordbox refuse d'ouvrir, sans dire pourquoi.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/**
 * Construit l'URI attendue par Rekordbox dans l'attribut Location.
 *
 * Forme exacte : `file://localhost/` suivi du chemin absolu percent-encodé,
 * séparateurs en barres obliques. Les accents, les espaces et les esperluettes
 * doivent être encodés, mais PAS les barres obliques de séparation — d'où
 * l'encodage segment par segment.
 */
export function uriRekordbox(cheminAbsolu) {
  const normalisé = path.resolve(cheminAbsolu).split(path.sep).join('/');
  // Sur Windows, « C:/x » doit devenir « /C:/x » pour rester une URI valide.
  const avecRacine = normalisé.startsWith('/') ? normalisé : `/${normalisé}`;

  const encodé = avecRacine
    .split('/')
    .map((segment) => encodeURIComponent(segment.normalize('NFC')))
    .join('/');

  return `file://localhost${encodé}`;
}

/**
 * Génère le contenu du fichier rekordbox.xml.
 *
 * `playlists` : [{ nom, fichiers: [{ chemin, métadonnées }] }]
 * Un même fichier présent dans plusieurs playlists n'apparaît qu'une fois dans
 * la collection ; les playlists ne portent que des références.
 */
export function construireXMLRekordbox(playlists, { nomDossier = 'Zotijean' } = {}) {
  const collection = new Map(); // chemin résolu → { id, ... }
  let prochainId = 1;

  for (const playlist of playlists) {
    for (const fichier of playlist.fichiers) {
      const clé = path.resolve(fichier.chemin);
      if (!collection.has(clé)) {
        collection.set(clé, { id: prochainId++, ...fichier });
      }
    }
  }

  const lignes = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    '  <PRODUCT Name="Zotijean" Version="1.0" Company="Zotijean"/>',
    `  <COLLECTION Entries="${collection.size}">`,
  ];

  for (const [chemin, entrée] of collection) {
    const m = entrée.métadonnées || {};
    let taille = 0;
    try {
      taille = fs.statSync(chemin).size;
    } catch { /* fichier disparu : on l'annonce à zéro plutôt que d'échouer */ }

    const attributs = [
      ['TrackID', entrée.id],
      ['Name', m.titre || path.basename(chemin)],
      ['Artist', m.artiste || ''],
      ['Album', m.album || ''],
      ['AlbumArtist', m.artisteAlbum || ''],
      ['Genre', m.genre || ''],
      ['Kind', TYPES_REKORDBOX[path.extname(chemin).toLowerCase()] || 'Unknown'],
      ['Size', taille],
      ['TotalTime', Math.round(m.duréeSecondes || 0)],
      ['TrackNumber', m.numéroPiste || 0],
      ['DiscNumber', m.numéroDisque || 0],
      ['Year', m.année || ''],
      ['AverageBpm', m.bpm ? m.bpm.toFixed(2) : ''],
      ['BitRate', m.débitBits ? Math.round(m.débitBits / 1000) : ''],
      ['SampleRate', m.échantillonnage || ''],
      ['Tonality', m.tonalité || ''],
      ['Label', m.label || ''],
      ['Remixer', m.remixeur || ''],
      ['Comments', m.commentaire || ''],
      ['Location', uriRekordbox(chemin)],
    ];

    const rendus = attributs
      .filter(([, valeur]) => valeur !== '' && valeur !== null && valeur !== undefined)
      .map(([nom, valeur]) => `${nom}="${échapperXML(valeur)}"`)
      .join(' ');

    lignes.push(`    <TRACK ${rendus}/>`);
  }

  lignes.push('  </COLLECTION>', '  <PLAYLISTS>');
  lignes.push('    <NODE Type="0" Name="ROOT" Count="1">');
  lignes.push(`      <NODE Type="0" Name="${échapperXML(nomDossier)}" Count="${playlists.length}">`);

  for (const playlist of playlists) {
    const ids = playlist.fichiers
      .map((f) => collection.get(path.resolve(f.chemin))?.id)
      .filter(Boolean);

    lignes.push(
      `        <NODE Name="${échapperXML(playlist.nom)}" Type="1" KeyType="0" Entries="${ids.length}">`,
    );
    for (const id of ids) lignes.push(`          <TRACK Key="${id}"/>`);
    lignes.push('        </NODE>');
  }

  lignes.push('      </NODE>', '    </NODE>', '  </PLAYLISTS>', '</DJ_PLAYLISTS>');
  return `${lignes.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Serato — fichiers .crate
// ---------------------------------------------------------------------------

/**
 * Un enregistrement Serato : 4 octets d'étiquette ASCII, 4 octets de longueur
 * en gros-boutiste, puis la charge utile. Les champs texte sont en UTF-16
 * gros-boutiste, sans marque d'ordre des octets.
 */
export function enregistrementSerato(étiquette, charge) {
  const entête = Buffer.alloc(8);
  entête.write(étiquette, 0, 4, 'ascii');
  entête.writeUInt32BE(charge.length, 4);
  return Buffer.concat([entête, charge]);
}

export function texteSerato(valeur) {
  // « utf16le » puis permutation : Node n'expose pas d'encodage gros-boutiste.
  const petitBoutiste = Buffer.from(String(valeur), 'utf16le');
  return petitBoutiste.swap16();
}

/**
 * Construit le contenu binaire d'une crate.
 *
 * `chemins` doivent être RELATIFS à la racine du disque qui porte `_Serato_`.
 * C'est le piège numéro un : des chemins absolus, ou relatifs à autre chose,
 * donnent des crates parfaitement valides et entièrement vides.
 */
export function construireCrate(cheminsRelatifs) {
  const morceaux = [
    enregistrementSerato('vrsn', texteSerato('81.0/Serato ScratchLive Crate')),
  ];

  for (const relatif of cheminsRelatifs) {
    const chemin = relatif.split(path.sep).join('/').normalize('NFC');
    const ptrk = enregistrementSerato('ptrk', texteSerato(chemin));
    morceaux.push(enregistrementSerato('otrk', ptrk));
  }

  return Buffer.concat(morceaux);
}

/**
 * Racine du disque qui porte un chemin. Le dossier `_Serato_` doit s'y trouver,
 * et les chemins des crates lui sont relatifs.
 */
export function racineDuDisque(cheminAbsolu) {
  const résolu = path.resolve(cheminAbsolu);

  if (process.platform === 'darwin') {
    // Un volume externe est monté sous /Volumes/<nom> ; sinon c'est le disque
    // de démarrage, dont la racine est /.
    const segments = résolu.split('/').filter(Boolean);
    if (segments[0] === 'Volumes' && segments[1]) return `/Volumes/${segments[1]}`;
    return '/';
  }

  return path.parse(résolu).root;
}

/** Le nom de fichier d'une crate. L'imbrication s'exprime par « %% ». */
export function nomFichierCrate(nomPlaylist, dossierParent = 'Zotijean') {
  // Le nom d'affichage vient UNIQUEMENT du nom de fichier : il n'est stocké
  // nulle part dans le contenu.
  const propre = (texte) => String(texte).replace(/[/\\%]/g, '_').trim();
  return `${propre(dossierParent)}%%${propre(nomPlaylist)}.crate`;
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

/** Serato est-il en train de tourner ? Écrire pendant ce temps ne sert à rien. */
export async function seratoOuvert() {
  if (process.platform === 'darwin') {
    const résultat = await exécuter('pgrep', ['-x', 'Serato DJ Pro'], { délaiMs: 8000 });
    return résultat.code === 0;
  }
  if (process.platform === 'win32') {
    const résultat = await exécuter(
      'tasklist', ['/FI', 'IMAGENAME eq Serato DJ Pro.exe'], { délaiMs: 8000 },
    );
    return /Serato DJ Pro\.exe/i.test(résultat.stdout || '');
  }
  return false;
}

/**
 * Rassemble les fichiers de chaque playlist et lance les exports demandés.
 *
 * On repart du DISQUE et non de l'état interne : ce que le DJ veut dans sa
 * bibliothèque, c'est ce qui existe réellement, y compris ce qu'il aurait ajouté
 * lui-même dans les dossiers.
 */
export async function exporterDepuisConfig(c, { surProgrès = () => {} } = {}) {
  const { configPourPlaylist } = await import('./config.js');
  const { listerAudio, dossierCommun } = await import('./bibliotheque.js');
  const { cheminRelatif } = await import('./organisation.js');
  const { trouver, FORMATS } = await import('./options.js');

  const { modèleActif } = await import('./organisation.js');
  const { inventorier } = await import('./zotify.js');
  const { sansSourcesConverties } = await import('./bibliotheque.js');

  const actives = (c.playlists || []).filter((p) => p.actif);
  const playlists = [];
  let examinés = 0;

  const avecMétadonnéesDe = async (fichiers, nom) => {
    const résultat = [];
    for (const fichier of fichiers) {
      surProgrès({ nom, examinés: ++examinés, fichier: path.basename(fichier) });
      résultat.push({ chemin: fichier, métadonnées: await lireMétadonnées(fichier) });
    }
    return résultat;
  };

  for (const playlist of actives) {
    const cp = configPourPlaylist(c, playlist);
    const format = trouver(FORMATS, cp.qualité.format);
    const nom = playlist.nom || playlist.url.split('/').pop();

    // Un rangement par artiste, par genre ou par année ne crée AUCUN dossier de
    // playlist : les morceaux d'une même playlist sont dispersés. Dans ce cas on
    // ne peut pas reconstituer la playlist à partir du disque, et prétendre le
    // contraire produirait des crates vides.
    if (!modèleActif(cp.organisation).includes('{playlist}')) continue;

    const exemple = cheminRelatif(
      cp.organisation,
      { playlist: nom, numéro: 1, artiste: 'x', titre: 'y' },
      format?.extension ?? 'ogg',
    );
    const dossier = path.join(cp.général.dossierMusique, path.dirname(exemple));
    // Sans ce filtre, l'export proposerait deux pistes par morceau, dont une en
    // Ogg — que Rekordbox refuse d'ouvrir. Une ligne sur deux en rouge, sans
    // moyen de savoir laquelle supprimer.
    const fichiers = sansSourcesConverties(
      listerAudio(dossier),
      cp.qualité.format === 'copie' ? null : format?.extension,
    );

    if (!fichiers.length) continue;

    playlists.push({ nom, dossier, fichiers: await avecMétadonnéesDe(fichiers, nom) });
  }

  // Aucune playlist reconstituable : le rangement choisi ne les matérialise pas
  // en dossiers. Plutôt que de ne rien exporter, on envoie toute la
  // bibliothèque en une seule liste — c'est ce qui rend service, et le nom dit
  // clairement ce que c'est.
  if (playlists.length === 0 && actives.length > 0) {
    const tous = [...inventorier(c.général.dossierMusique).values()]
      .map((f) => f.chemin)
      .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));

    if (tous.length) {
      playlists.push({
        nom: 'Bibliothèque Zotijean',
        dossier: c.général.dossierMusique,
        fichiers: await avecMétadonnéesDe(tous, 'Bibliothèque Zotijean'),
      });
    }
  }

  if (!playlists.length) {
    return {
      rekordbox: null,
      serato: null,
      avertissements: [
        'Aucun fichier trouvé à exporter. Lancez d’abord une synchronisation.',
      ],
    };
  }

  return exporter({
    playlists,
    racineBibliothèque: c.général.dossierMusique,
    rekordbox: c.exportsDJ?.rekordbox !== false,
    serato: c.exportsDJ?.serato === true,
  });
}

/**
 * Écrit les deux exports.
 * `playlists` : [{ nom, fichiers: [{ chemin, métadonnées }] }]
 */
export async function exporter({ playlists, racineBibliothèque, rekordbox = true, serato = true }) {
  const bilan = { rekordbox: null, serato: null, avertissements: [] };

  if (!playlists.length) return bilan;

  if (rekordbox) {
    try {
      const destination = path.join(racineBibliothèque, '_Exports', 'rekordbox.xml');
      écrireAtomique(destination, construireXMLRekordbox(playlists));
      const total = playlists.reduce((s, p) => s + p.fichiers.length, 0);
      bilan.rekordbox = { destination, nbPlaylists: playlists.length, nbTitres: total };
      journal.info(`Export Rekordbox écrit : ${playlists.length} playlist(s), ${total} titre(s).`);
    } catch (erreur) {
      bilan.avertissements.push(`Export Rekordbox impossible : ${erreur.message}`);
    }
  }

  if (serato) {
    if (await seratoOuvert()) {
      bilan.avertissements.push(
        'Serato est ouvert : les crates n’ont pas été écrites. Serato réécrirait ses ' +
        'propres fichiers en quittant et effacerait le travail. Fermez-le puis relancez ' +
        'l’export.',
      );
    } else {
      try {
        const racine = racineDuDisque(racineBibliothèque);
        const dossier = assurerDossier(path.join(racine, '_Serato_', 'Subcrates'));
        const écrites = [];

        for (const playlist of playlists) {
          const relatifs = playlist.fichiers.map((f) =>
            path.relative(racine, path.resolve(f.chemin)),
          );
          const destination = path.join(dossier, nomFichierCrate(playlist.nom));
          fs.writeFileSync(destination, construireCrate(relatifs));
          écrites.push(destination);
        }

        bilan.serato = { dossier, nbCrates: écrites.length, racineDisque: racine };
        journal.info(`Export Serato écrit : ${écrites.length} crate(s) dans ${dossier}.`);
      } catch (erreur) {
        bilan.avertissements.push(`Export Serato impossible : ${erreur.message}`);
      }
    }
  }

  return bilan;
}
