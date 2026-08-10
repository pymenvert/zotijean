// Gestion de la bibliothèque sur disque : listes de lecture, archivage,
// corbeille, et déduction du vrai nom des playlists.
//
// PRINCIPE DIRECTEUR : ON NE DÉTRUIT RIEN.
//
// Aucune fonction de ce module n'appelle `unlink` sur un fichier de musique.
// Archiver déplace, mettre à la corbeille délègue au système. Un morceau retiré
// du catalogue Spotify ne doit jamais faire disparaître la seule copie que
// l'utilisateur possède.

import fs from 'node:fs';
import path from 'node:path';

import { exécuter } from './processus.js';
import { journal } from './journal.js';
import { assurerDossier, écrireAtomique } from './chemins.js';
import { cléComparaison } from './organisation.js';

const EXTENSIONS_AUDIO = new Set(['.ogg', '.mp3', '.flac', '.aiff', '.aif', '.m4a', '.wav', '.opus']);

// ---------------------------------------------------------------------------
// Listes de lecture .m3u8
// ---------------------------------------------------------------------------

/**
 * Écrit une liste de lecture au format M3U étendu.
 *
 * Extension `.m3u8` et non `.m3u` : le premier impose l'UTF-8 par convention,
 * le second est lu en encodage local par plusieurs lecteurs, ce qui casse tous
 * les accents. Et surtout : PAS de marque d'ordre des octets en tête. VLC et
 * Rekordbox l'acceptent, mais plusieurs lecteurs la prennent pour le début du
 * premier chemin et ne trouvent aucun fichier.
 *
 * Les chemins sont relatifs au fichier de liste, pour que déplacer le dossier
 * entier ne casse rien.
 */
export function écrireListeLecture({ destination, fichiers, titre }) {
  const dossier = path.dirname(destination);
  assurerDossier(dossier);

  const lignes = ['#EXTM3U'];
  if (titre) lignes.push(`#PLAYLIST:${titre}`);

  for (const fichier of fichiers) {
    const relatif = path.relative(dossier, fichier).split(path.sep).join('/');
    lignes.push(`#EXTINF:-1,${path.basename(fichier, path.extname(fichier))}`);
    lignes.push(relatif);
  }

  écrireAtomique(destination, `${lignes.join('\n')}\n`);
  return { destination, nbEntrées: fichiers.length };
}

/** Liste les fichiers audio d'un dossier, triés comme le ferait le Finder. */
export function listerAudio(dossier) {
  let entrées;
  try {
    entrées = fs.readdirSync(dossier, { withFileTypes: true });
  } catch {
    return [];
  }

  return entrées
    .filter((e) => e.isFile() && EXTENSIONS_AUDIO.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dossier, e.name))
    .sort((a, b) =>
      path.basename(a).localeCompare(path.basename(b), 'fr', { numeric: true }),
    );
}

// ---------------------------------------------------------------------------
// Archivage
// ---------------------------------------------------------------------------

/** Dossier d'archive du jour, sous la racine de la bibliothèque. */
export function dossierArchive(racine, date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const jour = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  return path.join(racine, '_Archive', jour);
}

/**
 * Déplace un fichier vers l'archive, sans jamais écraser.
 * Un renommage entre volumes échoue avec EXDEV : on retombe alors sur une copie
 * suivie d'une suppression de la source, ce qui reste non destructif puisque la
 * copie est vérifiée d'abord.
 */
export function archiver(fichier, racine, date = new Date()) {
  const cible = dossierArchive(racine, date);
  assurerDossier(cible);

  let destination = path.join(cible, path.basename(fichier));
  let compteur = 1;
  const extension = path.extname(destination);
  const base = destination.slice(0, -extension.length || undefined);
  while (fs.existsSync(destination)) {
    destination = `${base} (${++compteur})${extension}`;
  }

  try {
    fs.renameSync(fichier, destination);
  } catch (erreur) {
    if (erreur.code !== 'EXDEV') throw erreur;
    fs.copyFileSync(fichier, destination);
    if (fs.statSync(destination).size !== fs.statSync(fichier).size) {
      fs.unlinkSync(destination);
      throw new Error('La copie vers l’archive est incomplète ; le fichier d’origine est intact.');
    }
    fs.unlinkSync(fichier);
  }

  return destination;
}

// ---------------------------------------------------------------------------
// Corbeille du système
// ---------------------------------------------------------------------------

/**
 * Met un fichier à la corbeille du système, jamais de suppression définitive.
 *
 * On délègue au système plutôt que de déplacer nous-mêmes vers ~/.Trash : le
 * Finder tient un fichier d'index qui permet le « Remettre » ; un déplacement
 * manuel produit un élément qu'on ne peut plus restaurer d'un clic.
 */
export async function mettreÀLaCorbeille(fichier) {
  const absolu = path.resolve(fichier);

  if (process.platform === 'darwin') {
    // Le chemin est injecté dans de l'AppleScript : on double les antislashs et
    // les guillemets pour qu'un titre contenant une apostrophe ou un guillemet
    // ne puisse pas modifier le script exécuté.
    const échappé = absolu.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `tell application "Finder" to delete POSIX file "${échappé}"`;
    const résultat = await exécuter('osascript', ['-e', script], { délaiMs: 20000 });
    if (résultat.code === 0) return { réussi: true, méthode: 'corbeille' };
    return { réussi: false, raison: (résultat.stderr || '').trim() };
  }

  if (process.platform === 'win32') {
    const échappé = absolu.replace(/'/g, "''");
    const script =
      'Add-Type -AssemblyName Microsoft.VisualBasic; ' +
      '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(' +
      `'${échappé}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
    const résultat = await exécuter(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { délaiMs: 20000 },
    );
    if (résultat.code === 0) return { réussi: true, méthode: 'corbeille' };
    return { réussi: false, raison: (résultat.stderr || '').trim() };
  }

  return { réussi: false, raison: 'Corbeille non prise en charge sur ce système.' };
}

// ---------------------------------------------------------------------------
// Politique de retrait
// ---------------------------------------------------------------------------

/**
 * Applique la politique choisie aux fichiers présents sur disque mais absents
 * de la liste attendue.
 *
 * `fichiersAttendus` DOIT être fiable. L'appelant ne fournit cette liste que
 * s'il a pu déterminer le contenu réel de la playlist ; dans le doute il
 * n'appelle pas cette fonction du tout. Se tromper ici, c'est archiver la
 * bibliothèque entière.
 */
export async function appliquerPolitiqueRetrait({
  dossierPlaylist,
  fichiersAttendus,
  politique,
  racine,
  simulation = false,
}) {
  const bilan = { politique, traités: [], échecs: [], simulation };

  if (politique === 'conserver') return bilan;

  const attendus = new Set(fichiersAttendus.map((f) => cléComparaison(path.resolve(f))));
  const présents = listerAudio(dossierPlaylist);
  const orphelins = présents.filter((f) => !attendus.has(cléComparaison(path.resolve(f))));

  if (orphelins.length === 0) return bilan;

  // Garde-fou : si la liste attendue est vide ou si presque tout serait
  // considéré comme orphelin, c'est que l'énumération a échoué en amont. On
  // refuse d'agir plutôt que de vider un dossier.
  if (fichiersAttendus.length === 0 || orphelins.length > présents.length * 0.5) {
    journal.avertir(
      `Politique de retrait non appliquée sur « ${path.basename(dossierPlaylist)} » : ` +
        `${orphelins.length} fichier(s) sur ${présents.length} auraient été retirés, ` +
        'ce qui indique une énumération incomplète. Aucun fichier n’a été touché.',
    );
    bilan.abandonné = 'énumération jugée peu fiable';
    return bilan;
  }

  for (const orphelin of orphelins) {
    if (simulation) {
      bilan.traités.push({ fichier: orphelin, action: `simulation (${politique})` });
      continue;
    }

    try {
      if (politique === 'archiver') {
        const destination = archiver(orphelin, racine);
        bilan.traités.push({ fichier: orphelin, action: 'archivé', destination });
      } else if (politique === 'corbeille') {
        const résultat = await mettreÀLaCorbeille(orphelin);
        if (résultat.réussi) {
          bilan.traités.push({ fichier: orphelin, action: 'corbeille' });
        } else {
          // Repli non destructif : si la corbeille refuse, on archive.
          const destination = archiver(orphelin, racine);
          bilan.traités.push({ fichier: orphelin, action: 'archivé (corbeille indisponible)', destination });
        }
      }
    } catch (erreur) {
      bilan.échecs.push({ fichier: orphelin, raison: erreur.message });
    }
  }

  if (bilan.traités.length) {
    journal.info(
      `Politique de retrait « ${politique} » : ${bilan.traités.length} fichier(s) traité(s).`,
    );
  }
  return bilan;
}

// ---------------------------------------------------------------------------
// Déduction du nom d'une playlist
// ---------------------------------------------------------------------------

/**
 * Déduit le nom affichable d'une playlist depuis les fichiers que zotify vient
 * d'écrire.
 *
 * Sans l'API Web de Spotify, on ne connaît pas le nom d'une playlist : on n'a
 * que son URL. Mais le modèle de rangement place ses fichiers dans un dossier
 * qui porte ce nom. On remonte donc au dossier commun le plus profond.
 */
export function déduireNomPlaylist(fichiers, racine) {
  if (!fichiers.length) return null;

  const segments = fichiers.map((fichier) =>
    path.relative(racine, path.dirname(fichier)).split(path.sep).filter(Boolean),
  );

  const commun = [];
  for (let index = 0; ; index++) {
    const candidat = segments[0][index];
    if (candidat === undefined) break;
    if (!segments.every((s) => s[index] === candidat)) break;
    commun.push(candidat);
  }

  // On prend le dernier segment commun : c'est le dossier qui regroupe
  // réellement les fichiers de cette exécution.
  return commun.length ? commun[commun.length - 1] : null;
}

/** Dossier qui contient les fichiers d'une playlist, s'il est unique. */
export function dossierCommun(fichiers) {
  if (!fichiers.length) return null;
  const dossiers = new Set(fichiers.map((f) => path.dirname(path.resolve(f))));
  return dossiers.size === 1 ? [...dossiers][0] : null;
}
