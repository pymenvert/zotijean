// Chargement et sauvegarde de la configuration.
//
// La configuration vit dans un JSON unique, écrit de façon atomique. Elle est
// systématiquement fusionnée avec les valeurs par défaut : ajouter une option
// dans options.js la fait apparaître chez les utilisateurs existants sans
// migration, et un fichier corrompu ne bloque jamais le démarrage.

import crypto from 'node:crypto';
import {
  configParDéfaut, trouver, RYTHMES, QUALITÉS, FORMATS, SCHÉMAS,
  POLITIQUES_RETRAIT, SOURCES_APRÈS_CONVERSION,
} from './options.js';
import { fichierConfig, écrireAtomique, lireJSON } from './chemins.js';
import { journal } from './journal.js';

let cache = null;

/**
 * Fusion récursive : les clés absentes du fichier prennent la valeur par défaut.
 * Les tableaux ne sont pas fusionnés mais remplacés — sinon la liste des
 * playlists ne pourrait jamais être vidée.
 */
function fusionner(défaut, chargé) {
  if (chargé === null || chargé === undefined) return défaut;
  if (Array.isArray(défaut)) return Array.isArray(chargé) ? chargé : défaut;
  if (typeof défaut !== 'object') {
    return typeof chargé === typeof défaut ? chargé : défaut;
  }

  const résultat = {};
  for (const clé of Object.keys(défaut)) {
    résultat[clé] = fusionner(défaut[clé], chargé[clé]);
  }
  return résultat;
}

/**
 * Corrige les valeurs incohérentes plutôt que de refuser de démarrer.
 * Chaque correction est journalisée : silencieux mais traçable.
 */
function assainir(config) {
  const corriger = (chemin, valide, secours) => {
    const segments = chemin.split('.');
    const dernier = segments.pop();
    let cible = config;
    for (const s of segments) cible = cible[s];
    if (!valide(cible[dernier])) {
      journal.avertir(
        `Réglage « ${chemin} » invalide, remis à sa valeur par défaut.`,
        { reçu: cible[dernier], utilisé: secours },
      );
      cible[dernier] = secours;
    }
  };

  corriger('qualité.niveau', (v) => !!trouver(QUALITÉS, v), 'tres_elevee');
  corriger('qualité.format', (v) => !!trouver(FORMATS, v), 'copie');
  corriger('organisation.schéma', (v) => !!trouver(SCHÉMAS, v), 'par_playlist');
  corriger('retrait.politique', (v) => !!trouver(POLITIQUES_RETRAIT, v), 'conserver');
  corriger(
    'retrait.sourcesAprèsConversion',
    (v) => !!trouver(SOURCES_APRÈS_CONVERSION, v),
    'conserver',
  );
  corriger('rythme.préréglage', (v) => v === 'personnalise' || !!trouver(RYTHMES, v), 'prudent');

  corriger(
    'planification.intervalleHeures',
    (v) => Number.isFinite(v) && v >= 1 && v <= 24 * 30,
    48,
  );
  corriger(
    'rythme.attenteEntreTitres',
    (v) => Number.isFinite(v) && v >= 0 && v <= 600,
    30,
  );
  corriger('général.port', (v) => Number.isInteger(v) && v > 1023 && v < 65536, 8787);
  corriger('gardes.espaceMinimumGo', (v) => Number.isFinite(v) && v >= 0, 2);
  corriger('gardes.margeParTitreMo', (v) => Number.isFinite(v) && v >= 0, 12);

  // Un modèle personnalisé vide rendrait tous les fichiers homonymes.
  if (
    config.organisation.schéma === 'personnalise' &&
    !String(config.organisation.modèlePersonnalisé || '').trim()
  ) {
    journal.avertir('Modèle personnalisé vide : retour au schéma « un dossier par playlist ».');
    config.organisation.schéma = 'par_playlist';
  }

  // Chaque playlist doit avoir un identifiant stable : c'est la clé utilisée
  // par l'état, les journaux et les réglages par playlist.
  config.playlists = (config.playlists || []).map((p) => ({
    id: p.id || crypto.randomUUID(),
    url: String(p.url || '').trim(),
    nom: p.nom || null,
    actif: p.actif !== false,
    remplacements: p.remplacements && typeof p.remplacements === 'object' ? p.remplacements : {},
  })).filter((p) => p.url);

  return config;
}

/** La configuration courante. Lue une fois puis gardée en mémoire. */
export function config() {
  if (cache) return cache;
  const chargé = lireJSON(fichierConfig(), {});
  cache = assainir(fusionner(configParDéfaut(), chargé));
  return cache;
}

/** Écrit la configuration sur disque et met à jour le cache. */
export function enregistrer(nouvelle) {
  cache = assainir(fusionner(configParDéfaut(), nouvelle));
  écrireAtomique(fichierConfig(), JSON.stringify(cache, null, 2));
  journal.info('Réglages enregistrés.');
  return cache;
}

/** Applique une modification partielle. Utilisé par l'API de réglages. */
export function modifier(patch) {
  return enregistrer(fusionner(config(), patch));
}

/** Recharge depuis le disque (utile en test, ou après édition manuelle). */
export function recharger() {
  cache = null;
  return config();
}

/**
 * Réglages effectifs pour une playlist donnée.
 *
 * Chaque playlist peut surcharger le dossier, la qualité, le format et le
 * schéma de rangement. Tout ce qui n'est pas surchargé retombe sur les réglages
 * généraux — c'est ce qui permet d'avoir une bibliothèque cohérente par défaut
 * tout en sortant une playlist du lot (par exemple en FLAC pour Rekordbox alors
 * que le reste reste en Ogg).
 *
 * Renvoie une configuration complète, de la même forme que la globale, pour que
 * tout le code en aval n'ait jamais à savoir si une surcharge existe.
 */
export function configPourPlaylist(c, playlist) {
  const r = playlist?.remplacements;
  if (!r || Object.keys(r).length === 0) return c;

  const fusionnée = {
    ...c,
    général: { ...c.général },
    qualité: { ...c.qualité },
    organisation: { ...c.organisation },
  };

  if (r.dossierMusique) fusionnée.général.dossierMusique = r.dossierMusique;
  if (r.niveau && trouver(QUALITÉS, r.niveau)) fusionnée.qualité.niveau = r.niveau;
  if (r.format && trouver(FORMATS, r.format)) fusionnée.qualité.format = r.format;

  if (r.schéma && trouver(SCHÉMAS, r.schéma)) {
    fusionnée.organisation.schéma = r.schéma;
    // Un schéma personnalisé sans modèle produirait des fichiers homonymes :
    // on refuse la surcharge plutôt que d'écraser des morceaux.
    if (r.schéma === 'personnalise') {
      if (String(r.modèlePersonnalisé || '').trim()) {
        fusionnée.organisation.modèlePersonnalisé = r.modèlePersonnalisé;
      } else {
        fusionnée.organisation.schéma = c.organisation.schéma;
      }
    }
  }

  return fusionnée;
}

/** Les surcharges possibles, telles que l'interface les présente. */
export const CHAMPS_SURCHARGEABLES = [
  'dossierMusique', 'niveau', 'format', 'schéma', 'modèlePersonnalisé',
];

/**
 * L'attente réellement appliquée entre deux titres, en secondes.
 * Le préréglage prime, sauf s'il vaut « personnalise ».
 */
export function attenteEffective(c = config()) {
  if (c.rythme.préréglage === 'personnalise') return c.rythme.attenteEntreTitres;
  const préréglage = trouver(RYTHMES, c.rythme.préréglage);
  return préréglage ? préréglage.attente : 30;
}
