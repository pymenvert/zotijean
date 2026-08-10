// Moteur d'organisation : transforme les métadonnées d'un morceau en chemin de
// fichier, selon le schéma choisi par l'utilisateur.
//
// C'est le module le plus piégeux du projet. Trois écueils, tous vérifiés :
//
// 1. NORMALISATION UNICODE. macOS conserve les octets d'un nom de fichier tels
//    qu'on les lui donne. Un « é » peut s'écrire soit en un seul caractère (NFC),
//    soit en « e » suivi d'un accent combinant (NFD). Les deux s'affichent
//    identiquement mais ne sont pas la même chaîne. Si un outil écrit en NFD et
//    qu'on compare en NFC, on conclut que le fichier n'existe pas et on le
//    retélécharge — indéfiniment. Dans une bibliothèque francophone, c'est la
//    panne numéro un. On normalise donc en NFC partout, à l'écriture comme à la
//    comparaison.
//
// 2. LONGUEUR EN OCTETS. La limite d'un nom de fichier est de 255 *octets*, pas
//    255 caractères. Un titre en français plein d'accents atteint la limite plus
//    vite qu'il n'y paraît, et couper au milieu d'une séquence UTF-8 produit un
//    fichier que le système refuse d'ouvrir. On tronque donc sur une frontière
//    de caractère valide.
//
// 3. CARACTÈRES INTERDITS. Ils diffèrent entre macOS et Windows. Comme le moteur
//    tourne sur les deux et que la bibliothèque peut vivre sur un disque exFAT,
//    on applique le jeu le plus strict des deux.

import path from 'node:path';
import { trouver, SCHÉMAS } from './options.js';

/** Limite prudente : 255 octets moins la place de l'extension et d'un suffixe. */
const MAX_OCTETS_SEGMENT = 240;

/** Interdits sur au moins un des systèmes visés, plus les caractères de contrôle. */
const CARACTÈRES_INTERDITS = /[<>:"/\\|?*\x00-\x1f\x7f]/g;  /**  * Reconnaissance des variables `{nom}` dans un modèle.  * Attention : `\w` ne couvre que l'ASCII en JavaScript. Les noms de variables du  * projet sont français — `numéro`, `année` — donc il faut une classe Unicode,  * sinon ces deux-là ne seraient jamais remplacées et apparaîtraient telles  * quelles dans les noms de fichiers.  */ const MOTIF_VARIABLE = /\{([\p{L}\p{N}_]+)\}/gu;

/** Noms réservés par Windows, quelle que soit l'extension. */
const NOMS_RÉSERVÉS = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Tronque une chaîne à `maxOctets` en UTF-8, sans jamais couper au milieu d'un
 * caractère. On recule tant qu'on tombe sur un octet de continuation (10xxxxxx),
 * puis on écarte l'octet de tête incomplet.
 */
export function tronquerOctets(texte, maxOctets = MAX_OCTETS_SEGMENT) {
  const octets = Buffer.from(texte, 'utf8');
  if (octets.length <= maxOctets) return texte;

  let fin = maxOctets;
  while (fin > 0 && (octets[fin] & 0xc0) === 0x80) fin--;
  return octets.subarray(0, fin).toString('utf8').trimEnd();
}

/**
 * Nettoie un segment de chemin (un nom de dossier ou de fichier).
 * Ne reçoit jamais de séparateur : ceux-ci sont gérés par `rendre`.
 */
export function assainirSegment(brut, options = {}) {
  const { minuscule = false, remplacerEspacesPar = '' } = options;

  let texte = String(brut ?? '')
    .normalize('NFC')
    .replace(CARACTÈRES_INTERDITS, '_')
    // Les espaces multiples viennent des modèles dont une variable est vide.
    .replace(/\s+/g, ' ')
    .trim();

  // macOS masque les fichiers commençant par un point, et un tiret initial est
  // interprété comme une option par beaucoup d'outils en ligne de commande.
  texte = texte.replace(/^[.\-\s]+/, '');

  // Un point ou un espace final est silencieusement supprimé par Windows, ce qui
  // désynchronise le nom qu'on croit avoir écrit de celui qui existe vraiment.
  texte = texte.replace(/[.\s]+$/, '');

  if (remplacerEspacesPar) texte = texte.split(' ').join(remplacerEspacesPar);
  if (minuscule) texte = texte.toLocaleLowerCase('fr');

  if (NOMS_RÉSERVÉS.has(texte.toUpperCase())) texte = `${texte}_`;

  texte = tronquerOctets(texte);

  // Un segment vide casserait le chemin : on met un repère explicite plutôt
  // qu'un dossier sans nom que l'utilisateur ne saurait pas interpréter.
  return texte || 'Sans titre';
}

/** Variables absentes ou vides, remplacées par un libellé lisible. */
const SECOURS = {
  playlist: 'Sans playlist',
  artiste: 'Artiste inconnu',
  titre: 'Sans titre',
  album: 'Sans album',
  artiste_album: 'Artiste inconnu',
  genre: 'Sans genre',
  année: 'Année inconnue',
  numéro: '000',
  piste: '00',
  disque: '1',
};

function valeurVariable(nom, métadonnées) {
  const brut = métadonnées[nom];
  if (brut === null || brut === undefined || String(brut).trim() === '') {
    return SECOURS[nom] ?? '';
  }

  // Les numéros sont rembourrés pour que le tri alphabétique du Finder
  // corresponde à l'ordre réel de la playlist ou de l'album.
  if (nom === 'numéro') return String(brut).padStart(3, '0');
  if (nom === 'piste') return String(brut).padStart(2, '0');

  return String(brut);
}

/**
 * Rend un modèle en chemin relatif, sans extension.
 * Les `/` du modèle séparent les dossiers ; ceux qui viendraient d'une valeur
 * sont neutralisés par `assainirSegment`.
 */
export function rendre(modèle, métadonnées, options = {}) {
  const segmentsBruts = String(modèle)
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  const segments = segmentsBruts
    .map((segment) =>
      segment.replace(MOTIF_VARIABLE, (_, nom) => valeurVariable(nom, métadonnées)),
    )
    .map((segment) => assainirSegment(segment, options))
    .filter(Boolean);

  return segments.length ? segments.join(path.sep) : 'Sans titre';
}

/** Le modèle réellement appliqué, selon le schéma choisi. */
export function modèleActif(configOrganisation) {
  if (configOrganisation.schéma === 'personnalise') {
    return configOrganisation.modèlePersonnalisé;
  }
  const schéma = trouver(SCHÉMAS, configOrganisation.schéma);
  return schéma?.modèle ?? '{playlist}/{numéro} - {artiste} - {titre}';
}

/**
 * Chemin relatif final d'un morceau, extension comprise.
 * `extension` vient du format choisi dans les réglages de qualité.
 */
export function cheminRelatif(configOrganisation, métadonnées, extension) {
  const options = {
    minuscule: configOrganisation.minusculeForcée,
    remplacerEspacesPar: configOrganisation.remplacerEspacesPar,
  };
  const sansExtension = rendre(modèleActif(configOrganisation), métadonnées, options);
  return `${sansExtension}.${extension}`;
}

/**
 * Deux morceaux différents peuvent produire le même nom (même titre, même
 * artiste, versions différentes). On désambiguïse avec les premiers caractères
 * de l'identifiant Spotify plutôt qu'avec un compteur : c'est déterministe et
 * stable, alors qu'un « (2) » se réattribue dès qu'un fichier disparaît.
 */
export function désambiguïser(cheminRel, identifiant) {
  const ext = path.extname(cheminRel);
  const base = cheminRel.slice(0, -ext.length || undefined);
  const marque = String(identifiant || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
  if (!marque) return cheminRel;
  return `${base} [${marque}]${ext}`;
}

/**
 * Normalise un chemin pour la comparaison. Toute comparaison de chemins dans le
 * projet passe par ici — c'est la seule protection contre le piège NFC/NFD.
 */
export function cléComparaison(chemin) {
  return String(chemin).normalize('NFC');
}

// ---------------------------------------------------------------------------
// Aperçu
// ---------------------------------------------------------------------------

/**
 * Cas volontairement pénibles, affichés sous l'aperçu pour que l'utilisateur
 * voie ce que le nettoyage fait vraiment avant de valider un modèle.
 */
const CAS_PIÉGEUX = [
  {
    étiquette: 'Accents et apostrophe',
    métadonnées: {
      playlist: 'Été à Ibiza', numéro: 12, artiste: 'Édith Piaf',
      titre: "Non, je ne regrette rien", album: 'À l’Olympia', piste: 4,
      disque: 1, année: '1961', genre: 'Chanson', artiste_album: 'Édith Piaf',
    },
  },
  {
    étiquette: 'Caractères interdits',
    métadonnées: {
      playlist: 'Mix 80/90', numéro: 3, artiste: 'AC/DC',
      titre: 'Who Made Who ? (12" Mix)', album: 'Who Made Who', piste: 1,
      disque: 1, année: '1986', genre: 'Rock', artiste_album: 'AC/DC',
    },
  },
  {
    étiquette: 'Titre très long',
    métadonnées: {
      playlist: 'Longs titres', numéro: 1,
      artiste: 'Fiona Apple',
      titre:
        'When the Pawn Hits the Conflicts He Thinks Like a King What He Knows ' +
        'Throws the Blows When He Goes to the Fight and He’ll Win the Whole ' +
        'Thing Fore He Enters the Ring',
      album: 'When the Pawn…', piste: 1, disque: 1, année: '1999',
      genre: 'Alternative', artiste_album: 'Fiona Apple',
    },
  },
  {
    étiquette: 'Informations manquantes',
    métadonnées: {
      playlist: 'Titres likés', numéro: 47, artiste: '', titre: 'Untitled',
      album: '', piste: '', disque: '', année: '', genre: '', artiste_album: '',
    },
  },
];

/**
 * Construit l'aperçu affiché sous le sélecteur de schéma : le cas nominal du
 * schéma choisi, puis les quatre cas piégeux.
 */
export function aperçu(configOrganisation, extension = 'ogg') {
  const schéma = trouver(SCHÉMAS, configOrganisation.schéma);
  const modèle = modèleActif(configOrganisation);

  const lignes = [];

  if (schéma?.exemple) {
    lignes.push({
      étiquette: 'Exemple',
      chemin: cheminRelatif(configOrganisation, schéma.exemple, extension),
      principal: true,
    });
  }

  for (const cas of CAS_PIÉGEUX) {
    lignes.push({
      étiquette: cas.étiquette,
      chemin: cheminRelatif(configOrganisation, cas.métadonnées, extension),
      principal: false,
    });
  }

  return { modèle, lignes };
}

/**
 * Vérifie un modèle personnalisé avant de l'enregistrer.
 * Renvoie la liste des problèmes en français, vide si tout va bien.
 */
export function validerModèle(modèle, variablesConnues) {
  const problèmes = [];
  const texte = String(modèle || '').trim();

  if (!texte) {
    problèmes.push('Le modèle est vide.');
    return problèmes;
  }

  const utilisées = [...texte.matchAll(MOTIF_VARIABLE)].map((m) => m[1]);
  const inconnues = utilisées.filter((v) => !variablesConnues.includes(v));
  for (const v of new Set(inconnues)) {
    problèmes.push(`La variable « {${v}} » n’existe pas.`);
  }

  if (utilisées.length === 0) {
    problèmes.push(
      'Le modèle ne contient aucune variable : tous les fichiers porteraient le même nom.',
    );
  }

  const sansTitreNiArtiste =
    !utilisées.includes('titre') && !utilisées.includes('numéro') && !utilisées.includes('piste');
  if (sansTitreNiArtiste) {
    problèmes.push(
      'Le modèle ne distingue pas les morceaux entre eux : ajoutez au moins {titre}, ' +
      '{numéro} ou {piste}, sinon les fichiers d’un même dossier s’écraseraient.',
    );
  }

  if (texte.startsWith('/') || /^[A-Za-z]:/.test(texte)) {
    problèmes.push(
      'Le modèle doit être relatif au dossier de musique : il ne peut pas commencer ' +
      'par « / » ni par une lettre de lecteur.',
    );
  }

  if (texte.includes('..')) {
    problèmes.push('Le modèle ne peut pas contenir « .. ».');
  }

  return problèmes;
}
