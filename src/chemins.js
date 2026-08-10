// Emplacements des fichiers, selon le système d'exploitation.
//
// Le moteur tourne à l'identique sur macOS (cible) et Windows (poste de
// développement) : c'est tout l'intérêt du choix Node.js. Ce module est le seul
// endroit qui connaît les différences entre les deux.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const NOM_APP = 'Zotijean';

/** Dossier où vivent la configuration, l'état et les journaux. */
export function dossierDonnées() {
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

export const fichierConfig = () => path.join(dossierDonnées(), 'config.json');
export const fichierÉtat = () => path.join(dossierDonnées(), 'etat.json');
export const fichierVerrou = () => path.join(dossierDonnées(), 'execution.lock');
export const dossierJournaux = () => path.join(dossierDonnées(), 'journaux');

/** Crée un dossier et ses parents. Ne se plaint pas s'il existe déjà. */
export function assurerDossier(chemin) {
  fs.mkdirSync(chemin, { recursive: true });
  return chemin;
}

/**
 * Écriture atomique : on écrit dans un fichier temporaire voisin, puis on
 * renomme. Un renommage dans le même système de fichiers est atomique, donc une
 * coupure de courant laisse soit l'ancien contenu, soit le nouveau — jamais un
 * fichier tronqué. Sans ça, une coupure pendant l'écriture de la configuration
 * la rendrait illisible au prochain démarrage.
 */
export function écrireAtomique(chemin, contenu) {
  assurerDossier(path.dirname(chemin));
  const temporaire = `${chemin}.${process.pid}.tmp`;
  fs.writeFileSync(temporaire, contenu, 'utf8');
  fs.renameSync(temporaire, chemin);
}

/** Lit un JSON, ou renvoie `secours` si le fichier est absent ou illisible. */
export function lireJSON(chemin, secours = null) {
  try {
    return JSON.parse(fs.readFileSync(chemin, 'utf8'));
  } catch {
    return secours;
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
