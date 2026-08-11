// Ce qu'on sait d'une playlist AVANT de lancer zotify.
//
// Sans l'API Spotify, on ne sait rien : on lance zotify et on regarde ce qui
// apparaît. Avec elle, on peut répondre à deux questions qui changent tout :
//
//   « Cette playlist a-t-elle bougé depuis la dernière fois ? »
//       Une seule requête suffit. Si l'identifiant de version n'a pas changé et
//       que les fichiers sont là, on saute la playlist entière — au lieu de
//       lancer zotify et d'attendre qu'il vérifie titre par titre, à trente
//       secondes de patience chacun.
//
//   « Quels morceaux manquent exactement ? »
//       On confronte le contenu réel aux fichiers présents.
//
// Tout échec de ce module est SANS CONSÉQUENCE : on retombe sur le
// comportement d'origine, qui fonctionne. L'API est un supplément de précision,
// jamais une dépendance.

import path from 'node:path';

import { journal } from './journal.js';
import * as spotify from './spotify.js';
import { confronter } from './correspondance.js';
import { listerAudio } from './bibliotheque.js';
import { cheminRelatif, modèleActif } from './organisation.js';
import { trouver, FORMATS } from './options.js';
import { infosPlaylist } from './etat.js';

/** Dossier où cette playlist range ses fichiers, quand le modèle le permet. */
function dossierDeLaPlaylist(cp, nom) {
  if (!modèleActif(cp.organisation).includes('{playlist}')) return null;

  const format = trouver(FORMATS, cp.qualité.format);
  const exemple = cheminRelatif(
    cp.organisation,
    { playlist: nom, numéro: 1, artiste: 'x', titre: 'y' },
    format?.extension ?? 'ogg',
  );
  return path.join(cp.général.dossierMusique, path.dirname(exemple));
}

/**
 * Analyse une playlist avant téléchargement.
 *
 * Renvoie toujours un objet exploitable, même quand l'API est indisponible :
 * dans ce cas `disponible` vaut faux et l'appelant procède comme avant.
 */
export async function analyserPlaylist(c, playlist, { forcer = false } = {}) {
  const vide = { disponible: false, sauter: false, raison: null };

  if (!c.spotify?.actif || !spotify.estConnecté()) return vide;

  const id = spotify.idDepuisURL(playlist.url);
  if (!id) return vide; // album ou artiste : l'API playlists ne s'applique pas

  try {
    const { version, nom, nbTitres } = await spotify.versionPlaylist(id);
    const connue = infosPlaylist(playlist.id) || {};
    const dossier = dossierDeLaPlaylist(c, nom);
    const fichiers = dossier ? listerAudio(dossier) : [];

    // --- Rien n'a bougé ? ------------------------------------------------
    // On n'ose sauter que si des fichiers sont RÉELLEMENT là. Un identifiant
    // de version inchangé sur un dossier vide signifie que le téléchargement
    // précédent a échoué, pas que le travail est fait.
    // Un identifiant de version inchangé ne prouve RIEN à lui seul : il ne
    // vaut « déjà fait » que si le téléchargement précédent est allé au bout.
    // Sans le contrôle des manquants, une playlist interrompue par une veille
    // du Mac à 40 titres sur 200 serait sautée définitivement, en affichant un
    // succès à chaque fois.
    if (!forcer
      && version
      && connue.versionSpotify
      && connue.versionSpotify === version
      && fichiers.length > 0
      && connue.nbManquants === 0) {
      return {
        disponible: true,
        sauter: true,
        version,
        nom,
        nbTitres,
        raison:
          `« ${nom} » n'a pas changé depuis la dernière synchronisation ` +
          `(${fichiers.length} fichier(s) en place).`,
      };
    }

    // --- Que manque-t-il exactement ? ------------------------------------
    const pistes = await spotify.contenuPlaylist(id);
    const bilan = confronter(pistes, fichiers);

    return {
      disponible: true,
      sauter: false,
      version,
      nom,
      nbTitres: pistes.length,
      pistes,
      manquants: bilan.manquants,
      présents: bilan.présents,
      nonReconnus: bilan.nonReconnus,
      fiabilité: bilan.fiabilité,
      dossier,
      raison: bilan.manquants.length === 0 && fichiers.length > 0
        ? `Les ${pistes.length} morceaux de « ${nom} » sont déjà là.`
        : `${bilan.manquants.length} morceau(x) manquant(s) sur ${pistes.length}.`,
    };
  } catch (erreur) {
    // Un échec de l'API ne doit JAMAIS empêcher une synchronisation : on perd
    // la précision, pas la fonction.
    journal.avertir(
      `Analyse Spotify impossible pour « ${playlist.nom || playlist.url} » : ` +
        `${erreur.message} La synchronisation continue sans elle.`,
    );
    return { ...vide, erreur: erreur.message, reconnexion: !!erreur.reconnexion };
  }
}

/**
 * Résumé de tout ce que l'API sait, pour l'interface.
 * Utilisé par le bouton « Voir ce qui manque » sans rien télécharger.
 */
export async function inventaireComplet(c) {
  const résultats = [];

  for (const playlist of (c.playlists || []).filter((p) => p.actif)) {
    const analyse = await analyserPlaylist(c, playlist, { forcer: true });
    résultats.push({
      id: playlist.id,
      nom: analyse.nom || playlist.nom || playlist.url,
      disponible: analyse.disponible,
      erreur: analyse.erreur ?? null,
      nbTitres: analyse.nbTitres ?? null,
      nbPrésents: analyse.présents?.length ?? null,
      nbManquants: analyse.manquants?.length ?? null,
      fiable: analyse.fiabilité?.sûre ?? null,
      avertissement: analyse.fiabilité?.sûre === false ? analyse.fiabilité.raison : null,
      manquants: (analyse.manquants || []).slice(0, 50).map((p) => ({
        titre: p.titre, artiste: p.artiste, isrc: p.isrc,
      })),
    });
  }

  return { playlists: résultats, date: new Date().toISOString() };
}
