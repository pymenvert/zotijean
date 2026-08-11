// Emplacements des fichiers, selon le système d'exploitation.
//
// Le moteur tourne à l'identique sur macOS (cible) et Windows (poste de
// développement) : c'est tout l'intérêt du choix Node.js. Ce module est le seul
// endroit qui connaît les différences entre les deux.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const NOM_APP = 'Zotijean';

/**
 * Dossier où vivent la configuration, l'état et les journaux.
 *
 * La variable d'environnement ZOTIJEAN_DONNEES a la priorité. Elle sert à deux
 * choses : isoler chaque test dans un dossier temporaire, et permettre une
 * installation portable où tout tient dans un seul dossier qu'on déplace.
 */
export function dossierDonnées() {
  if (process.env.ZOTIJEAN_DONNEES) return path.resolve(process.env.ZOTIJEAN_DONNEES);

  const maison = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(maison, 'Library', 'Application Support', NOM_APP);
    case 'win32':
      return path.join(
        process.env.APPDATA || path.join(maison, 'AppData', 'Roaming'),
        NOM_APP,
      );
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME || path.join(maison, '.config'),
        'zotijean',
      );
  }
}

/** Dossier de musique proposé par défaut au premier lancement. */
export function dossierMusiqueParDéfaut() {
  const maison = os.homedir();
  // Sur macOS le dossier s'appelle « Music » sur le disque même quand le Finder
  // affiche « Musique » : c'est un nom localisé par un fichier .localized.
  const musique = process.platform === 'darwin'
    ? path.join(maison, 'Music')
    : path.join(maison, 'Music');
  return path.join(musique, NOM_APP);
}

/**
 * Dossier des outils embarqués dans le paquet, ou null.
 *
 * Défini ici plutôt que dans outils.js pour éviter un cycle : processus.js en a
 * besoin pour construire le PATH, et outils.js dépend de processus.js. Ce
 * module, lui, ne dépend que de la bibliothèque standard.
 *
 * Dans un paquet, le moteur vit dans Contents/Resources/moteur/ et les outils
 * dans Contents/Resources/outils/ : ils sont voisins.
 */
export function dossierOutils() {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  for (const candidat of [
    path.resolve(ici, '..', '..', 'outils'),      // dans le paquet
    path.resolve(ici, '..', 'macos', 'outils'),   // depuis le dépôt
  ]) {
    if (fs.existsSync(candidat)) return candidat;
  }
  return null;
}

/**
 * La version de Zotijean, lue dans package.json.
 *
 * Une seule source, jamais recopiée dans le code : deux versions qui divergent
 * valent moins que pas de version du tout, parce qu'on croit la fausse. Elle
 * apparaît dans le diagnostic et dans son export, pour qu'un rapport de
 * problème dise toujours de quelle version il parle.
 */
let versionMémorisée = null;

export function version() {
  if (versionMémorisée) return versionMémorisée;

  const ici = path.dirname(fileURLToPath(import.meta.url));
  const paquet = lireJSON(path.resolve(ici, '..', 'package.json'), {});
  versionMémorisée = typeof paquet.version === 'string' ? paquet.version : 'inconnue';
  return versionMémorisée;
}

/** Les dossiers à placer EN TÊTE du PATH pour privilégier ce qui est embarqué. */
export function dossiersEmbarqués() {
  const racine = dossierOutils();
  const venv = path.join(dossierDonnées(), 'outils', 'venv', 'bin');

  const candidats = racine
    ? ['node', 'python/bin', 'ffmpeg'].map((r) => path.join(racine, r)).concat(venv)
    : [venv];

  return candidats.filter((dossier) => {
    try {
      return fs.statSync(dossier).isDirectory();
    } catch {
      return false;
    }
  });
}

export const fichierConfig = () => path.join(dossierDonnées(), 'config.json');
export const fichierÉtat = () => path.join(dossierDonnées(), 'etat.json');
export const fichierVerrou = () => path.join(dossierDonnées(), 'execution.lock');
export const dossierJournaux = () => path.join(dossierDonnées(), 'journaux');

/**
 * Crée un dossier et ses parents. Ne se plaint pas s'il existe déjà.
 *
 * ON N'UTILISE PAS `{ recursive: true }`, et ce n'est pas une préférence de
 * style.
 *
 * Sous Linux, cette option part en BOUCLE INFINIE quand un ancêtre du chemin
 * existe mais refuse toute création. Le cas type est `/proc` : mkdir y répond
 * « ENOENT » au lieu de « EACCES », Node en déduit qu'il manque un parent,
 * remonte d'un cran, trouve ce parent déjà là, redescend, obtient de nouveau
 * ENOENT — et recommence sans fin, à 100 % d'un cœur.
 *
 * L'appel étant SYNCHRONE, plus rien ne peut reprendre la main : ni une
 * minuterie, ni le délai d'un test, ni le processus lui-même. Concrètement,
 * pointer le dossier de musique sur un tel chemin figeait l'application.
 *
 * On remonte donc soi-même jusqu'au premier ancêtre existant, puis on crée les
 * niveaux manquants un par un : la première erreur est levée immédiatement.
 */
export function assurerDossier(chemin) {
  const résolu = path.resolve(chemin);
  const manquants = [];

  let courant = résolu;
  while (!fs.existsSync(courant)) {
    manquants.push(courant);
    const parent = path.dirname(courant);
    if (parent === courant) break; // remonté jusqu'à la racine
    courant = parent;
  }

  for (const dossier of manquants.reverse()) {
    try {
      fs.mkdirSync(dossier);
    } catch (erreur) {
      // Créé entre-temps par quelqu'un d'autre : c'est le résultat voulu.
      if (erreur.code !== 'EEXIST') throw erreur;
    }
  }

  return chemin;
}

/**
 * Écriture atomique : on écrit dans un fichier temporaire voisin, puis on
 * renomme. Un renommage dans le même système de fichiers est atomique, donc une
 * coupure de courant laisse soit l'ancien contenu, soit le nouveau — jamais un
 * fichier tronqué. Sans ça, une coupure pendant l'écriture de la configuration
 * la rendrait illisible au prochain démarrage.
 */
export function écrireAtomique(chemin, contenu, { mode = null } = {}) {
  assurerDossier(path.dirname(chemin));
  const temporaire = `${chemin}.${process.pid}.tmp`;

  try {
    // Le mode est posé DÈS la création, pas après : un fichier de jetons
    // brièvement lisible par tous reste un fichier lisible par tous.
    //
    // L'encodage annoncé ici est IGNORÉ par Node quand `contenu` est un tampon
    // binaire — vérifié octet pour octet. C'est ce qui permet d'écrire aussi les
    // crates Serato, qui sont de l'UTF-16BE avec des octets nuls, par le même
    // chemin sûr. Ne pas « corriger » cette ligne en croyant qu'elle corrompt du
    // binaire : elle ne le fait pas.
    fs.writeFileSync(temporaire, contenu, mode ? { encoding: 'utf8', mode } : 'utf8');
    fs.renameSync(temporaire, chemin);
    if (mode) fs.chmodSync(chemin, mode);
  } catch (erreur) {
    // Un temporaire abandonné contiendrait une copie partielle du contenu —
    // gênant pour la configuration, franchement mauvais pour des jetons.
    try {
      fs.unlinkSync(temporaire);
    } catch { /* déjà absent */ }
    throw erreur;
  }
}

/**
 * Lit un JSON, ou renvoie `secours`.
 *
 * Distingue DEUX cas que confondait la version précédente : un fichier absent
 * est normal au premier lancement, un fichier illisible est une anomalie. Les
 * confondre revenait à repartir en silence sur une configuration vide, puis à
 * écraser le fichier corrompu au premier réglage modifié — alors qu'il
 * contenait la seule copie des URL de playlists.
 *
 * `surErreur` est un rappel plutôt qu'un appel direct au journal : celui-ci
 * dépend de ce module, l'importer créerait un cycle.
 */
export function lireJSON(chemin, secours = null, surErreur = null) {
  let brut;
  try {
    brut = fs.readFileSync(chemin, 'utf8');
  } catch {
    return secours; // absent : cas normal, rien à signaler
  }

  try {
    return JSON.parse(brut);
  } catch (erreur) {
    surErreur?.(erreur, brut);
    return secours;
  }
}

/**
 * Met un fichier de côté avant de risquer de l'écraser.
 * Renvoie le chemin de la copie, ou null si elle n'a pas pu être faite.
 */
export function mettreÀLAbri(chemin, suffixe = 'corrompu') {
  const abri = `${chemin}.${suffixe}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try {
    fs.copyFileSync(chemin, abri);
    return abri;
  } catch {
    return null;
  }
}

/**
 * Vérifie qu'un chemin est réellement sur un volume monté.
 *
 * Le piège : si un disque externe est débranché, macOS recrée joyeusement un
 * dossier vide sous /Volumes/ dès qu'on écrit dedans. Tester l'existence du
 * chemin renverrait « oui » et l'app retéléchargerait toute la bibliothèque sur
 * le disque de démarrage. On teste donc que le point de montage du chemin n'est
 * pas la racine quand le chemin prétend être sur un volume externe.
 */
export function volumeMonté(chemin) {
  if (process.platform !== 'darwin') {
    // Sur Windows, on vérifie que la lettre de lecteur répond.
    const racine = path.parse(path.resolve(chemin)).root;
    try {
      fs.accessSync(racine);
      return true;
    } catch {
      return false;
    }
  }

  const résolu = path.resolve(chemin);
  if (!résolu.startsWith('/Volumes/')) return true; // disque de démarrage

  const segments = résolu.split(path.sep).filter(Boolean); // ['Volumes', 'DJ-SSD', ...]
  if (segments.length < 2) return false;
  const pointDeMontage = path.join('/', segments[0], segments[1]);

  try {
    const statVolume = fs.statSync(pointDeMontage);
    const statRacine = fs.statSync('/');
    // Un volume réellement monté a un identifiant de périphérique différent de
    // celui de la racine. Un dossier fantôme créé sous /Volumes/ partage le
    // périphérique de la racine — c'est exactement ce qu'on veut détecter.
    return statVolume.dev !== statRacine.dev;
  } catch {
    return false;
  }
}

/** Espace disponible en octets sur le volume qui contient `chemin`. */
export function espaceLibre(chemin) {
  try {
    const cible = fs.existsSync(chemin) ? chemin : path.dirname(chemin);
    const { bavail, bsize } = fs.statfsSync(cible);
    return bavail * bsize;
  } catch {
    return null; // inconnu : l'appelant décide quoi en faire
  }
}
