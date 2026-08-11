// État persistant : ce qui a été fait, et quand.
//
// Séparé de la configuration à dessein. La configuration, c'est ce que
// l'utilisateur décide ; l'état, c'est ce que l'app constate. Mélanger les deux
// rendrait impossible de réinitialiser l'un sans perdre l'autre.
//
// Écriture atomique systématique : une coupure pendant l'enregistrement laisse
// l'ancien état intact plutôt qu'un fichier tronqué qui ferait tout
// retélécharger.

import { fichierÉtat, écrireAtomique, lireJSON } from './chemins.js';

const MAX_EXÉCUTIONS_CONSERVÉES = 50;

function étatVide() {
  return {
    version: 1,
    dernierSuccès: null,      // ISO 8601, ou null si jamais synchronisé
    dernièreTentative: null,
    exécutions: [],           // historique, du plus récent au plus ancien
    playlists: {},            // id → { dernierSuccès, nbFichiers, dernièreErreur }

    // Trace de l'exécution en cours. Écrite au démarrage, effacée à la fin
    // normale : si elle survit, c'est que l'app a été interrompue — fermeture,
    // mise en veille, coupure de courant — et la prochaine exécution reprend
    // là où elle en était plutôt que de tout refaire.
    reprise: null,            // { début, déclencheur, playlistsTerminées: [] }

    // Échecs enchaînés, pour espacer les tentatives. Sans ce compteur, une
    // panne persistante (disque débranché, compte suspendu) relancerait une
    // synchronisation toutes les cinq minutes — le meilleur moyen d'aggraver
    // le problème auprès de Spotify.
    échecsConsécutifs: 0,
  };
}

let cache = null;

export function état() {
  if (!cache) cache = { ...étatVide(), ...(lireJSON(fichierÉtat(), {}) || {}) };
  return cache;
}

function écrire() {
  écrireAtomique(fichierÉtat(), JSON.stringify(cache, null, 2));
}

/** Recharge depuis le disque. Utilisé en test. */
export function recharger() {
  cache = null;
  return état();
}

/**
 * Date de référence du planificateur.
 *
 * Garde anti-recul d'horloge : si la date enregistrée est dans le futur (le Mac
 * a changé de fuseau, l'horloge a été corrigée, ou l'état vient d'une autre
 * machine), on la ramène à maintenant. Sans ça, une date future bloquerait
 * définitivement toute synchronisation.
 */
export function dernierSuccèsSain() {
  const brut = état().dernierSuccès;
  if (!brut) return null;

  const date = new Date(brut);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > Date.now()) {
    marquerSuccès(new Date());
    return new Date();
  }
  return date;
}

/**
 * Date de la dernière tentative, avec la MÊME garde anti-recul d'horloge.
 *
 * Elle manquait, et l'oubli était coûteux. Le recul après échecs compare
 * « maintenant » à cette date : si elle est dans le futur — horloge corrigée,
 * changement de fuseau, fichier d'état recopié depuis une autre machine —, la
 * soustraction devient négative et reste donc éternellement inférieure au
 * recul. Le planificateur diffère alors à chaque battement, et la
 * synchronisation est bloquée aussi longtemps que dure l'avance : mesuré à
 * soixante-treize heures pour une avance de trois jours.
 *
 * C'est exactement la panne que la garde sur `dernierSuccès` évite. Il n'y avait
 * aucune raison de protéger une date et pas l'autre.
 */
export function dernièreTentativeSaine() {
  const brut = état().dernièreTentative;
  if (!brut) return null;

  const date = new Date(brut);
  if (Number.isNaN(date.getTime())) return null;

  // UNE DATE FUTURE EST RENDUE NULLE, PAS RAMENÉE À MAINTENANT.
  //
  // La ramener paraît plus doux, et c'est un piège : comme rien n'est réécrit,
  // chaque évaluation la ramène à SON « maintenant ». L'écart reste donc
  // toujours nul, toujours inférieur au recul, et le report devient perpétuel —
  // exactement la panne qu'on cherchait à supprimer, en pire.
  //
  // Sans point de départ crédible, le recul n'a simplement pas lieu d'être. Le
  // compteur d'échecs, lui, reste intact : la prochaine tentative réelle
  // réinscrira une date saine et l'espacement reprendra normalement.
  if (date.getTime() > Date.now()) return null;
  return date;
}

export function marquerTentative(date = new Date()) {
  état().dernièreTentative = date.toISOString();
  écrire();
}

export function marquerSuccès(date = new Date()) {
  const e = état();
  e.dernierSuccès = date.toISOString();
  e.échecsConsécutifs = 0;
  écrire();
}

export function marquerÉchec() {
  const e = état();
  e.échecsConsécutifs = (e.échecsConsécutifs || 0) + 1;
  écrire();
  return e.échecsConsécutifs;
}

// ---------------------------------------------------------------------------
// Reprise après interruption
// ---------------------------------------------------------------------------

/** Au-delà, une reprise n'a plus de sens : on repart proprement de zéro. */
const REPRISE_VALABLE_MS = 24 * 3600 * 1000;

export function ouvrirReprise(déclencheur, date = new Date()) {
  état().reprise = {
    début: date.toISOString(),
    déclencheur,
    playlistsTerminées: [],
  };
  écrire();
}

export function noterPlaylistTerminée(id) {
  const e = état();
  if (!e.reprise) return;
  if (!e.reprise.playlistsTerminées.includes(id)) {
    e.reprise.playlistsTerminées.push(id);
    écrire();
  }
}

export function fermerReprise() {
  état().reprise = null;
  écrire();
}

/**
 * Les playlists déjà traitées par une exécution interrompue, si elle est encore
 * récente. Passé un jour, on préfère tout revérifier : la playlist a pu changer,
 * et refaire le travail coûte moins cher que de rater des nouveautés.
 */
export function repriseEnAttente(maintenant = new Date()) {
  const reprise = état().reprise;
  if (!reprise?.début) return null;

  const âge = maintenant.getTime() - new Date(reprise.début).getTime();
  if (!Number.isFinite(âge) || âge < 0 || âge > REPRISE_VALABLE_MS) return null;
  if (!reprise.playlistsTerminées?.length) return null;

  return reprise;
}

/** Enregistre le bilan d'une exécution complète. */
export function enregistrerExécution(bilan) {
  const e = état();
  e.exécutions.unshift({
    date: new Date().toISOString(),
    ...bilan,
  });
  if (e.exécutions.length > MAX_EXÉCUTIONS_CONSERVÉES) {
    e.exécutions.length = MAX_EXÉCUTIONS_CONSERVÉES;
  }
  écrire();
}

export function majPlaylist(id, données) {
  const e = état();
  e.playlists[id] = { ...(e.playlists[id] || {}), ...données };
  écrire();
}

export function infosPlaylist(id) {
  return état().playlists[id] || null;
}

export function oublierPlaylist(id) {
  delete état().playlists[id];
  écrire();
}

/** Chiffres affichés en tête du tableau de bord. */
export function résumé() {
  const e = état();
  const dernière = e.exécutions[0] || null;

  const totalFichiers = Object.values(e.playlists)
    .reduce((somme, p) => somme + (p.nbFichiers || 0), 0);

  return {
    dernierSuccès: e.dernierSuccès,
    dernièreTentative: e.dernièreTentative,
    totalFichiers,
    nbExécutions: e.exécutions.length,
    dernièreExécution: dernière,
  };
}
