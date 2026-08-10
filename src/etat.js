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

export function marquerTentative(date = new Date()) {
  état().dernièreTentative = date.toISOString();
  écrire();
}

export function marquerSuccès(date = new Date()) {
  état().dernierSuccès = date.toISOString();
  écrire();
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
