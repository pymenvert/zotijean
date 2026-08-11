// API JSON consommée par l'interface web.
//
// Volontairement mince : elle expose l'état et déclenche des actions, sans
// contenir de logique métier. Tout ce qui décide vit dans les modules dédiés.

import crypto from 'node:crypto';

import { config, enregistrer, modifier, attenteEffective } from './config.js';
import { catalogueComplet, VARIABLES, trouver, FORMATS, RYTHMES } from './options.js';
import { aperçu, validerModèle } from './organisation.js';
import { diagnostiquer } from './diagnostic.js';
import { journal } from './journal.js';
import * as synchro from './synchronisation.js';
import * as étatModule from './etat.js';
import { évaluer, prochaineÉchéance, formaterÉchéance, duréeEnFrançais } from './planificateur.js';
import { simuler } from './simulation.js';
import { exporterDepuisConfig } from './exports-dj.js';
import { synthétiser } from './erreurs.js';
import { lireContextePlateforme } from './energie.js';

const NOMS_VARIABLES = VARIABLES.map((v) => v.nom);

/** Extrait l'identifiant Spotify et le type depuis une URL ou un URI. */
export function analyserLienSpotify(entrée) {
  const texte = String(entrée || '').trim();
  if (!texte) return null;

  // spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
  const uri = texte.match(/^spotify:(playlist|album|artist|track):([A-Za-z0-9]+)$/);
  if (uri) return { type: uri[1], id: uri[2], url: `https://open.spotify.com/${uri[1]}/${uri[2]}` };

  // https://open.spotify.com/playlist/37i9... éventuellement avec ?si=...
  const url = texte.match(
    /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(playlist|album|artist|track)\/([A-Za-z0-9]+)/,
  );
  if (url) return { type: url[1], id: url[2], url: `https://open.spotify.com/${url[1]}/${url[2]}` };

  return null;
}

/** Le tableau de bord : tout ce qu'affiche l'écran d'accueil, en un appel. */
export function tableauDeBord(contexte = {}) {
  const c = config();
  const décision = évaluer(c, { enCours: !!synchro.exécutionEnCours(), ...contexte });
  const résumé = étatModule.résumé();
  const enCours = synchro.exécutionEnCours();

  const dernier = résumé.dernierSuccès ? new Date(résumé.dernierSuccès) : null;

  return {
    enCours,
    décision,
    résumé,
    phraseHéros: phraseHéros({ enCours, décision, dernier, résumé }),
    prochaineÉchéance: c.planification.actif
      ? formaterÉchéance(prochaineÉchéance(c, dernier))
      : null,
    playlists: (c.playlists || []).map((p) => ({
      ...p,
      infos: étatModule.infosPlaylist(p.id),
    })),
    réglagesRésumé: {
      dossierMusique: c.général.dossierMusique,
      qualité: c.qualité.niveau,
      format: trouver(FORMATS, c.qualité.format)?.libellé ?? c.qualité.format,
      schéma: c.organisation.schéma,
      intervalleHeures: c.planification.intervalleHeures,
      attente: attenteEffective(c),
      planificationActive: c.planification.actif,
    },
  };
}

/**
 * La ligne unique affichée en haut du panneau.
 * Une seule métrique héros, pas un tableau de bord fourre-tout : c'est ce qui
 * distingue une app finie d'un panneau de contrôle.
 */
function phraseHéros({ enCours, décision, dernier, résumé }) {
  if (enCours) {
    const quoi = enCours.playlistActuelle ? ` — ${enCours.playlistActuelle}` : '';
    return {
      texte: `Synchronisation en cours${quoi}`,
      détail: `${enCours.fichiersTéléchargés} titre${enCours.fichiersTéléchargés > 1 ? 's' : ''} téléchargé${enCours.fichiersTéléchargés > 1 ? 's' : ''}`,
      ton: 'actif',
    };
  }

  if (décision.code === 'aucune_playlist') {
    return {
      texte: 'Aucune playlist surveillée',
      détail: 'Collez un lien Spotify pour commencer.',
      ton: 'neutre',
    };
  }

  if (!dernier) {
    return {
      texte: 'Jamais synchronisé',
      détail: décision.raison,
      ton: 'neutre',
    };
  }

  const dernièreExéc = résumé.dernièreExécution;
  if (dernièreExéc?.échec) {
    return { texte: 'La dernière synchronisation a échoué', détail: dernièreExéc.échec, ton: 'erreur' };
  }
  if (dernièreExéc?.nbErreurs > 0) {
    return {
      texte: 'Tout est à jour, avec des avertissements',
      détail: `${dernièreExéc.nbErreurs} titre${dernièreExéc.nbErreurs > 1 ? 's' : ''} en erreur il y a ${duréeEnFrançais(Date.now() - dernier)}`,
      ton: 'attention',
    };
  }

  return {
    texte: 'Tout est à jour',
    détail: `Vérifié il y a ${duréeEnFrançais(Date.now() - dernier)}`,
    ton: 'ok',
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Table des routes. Chaque entrée renvoie un objet sérialisable, ou lève une
 * `ErreurRequête` pour un message d'erreur propre côté interface.
 */
export class ErreurRequête extends Error {
  constructor(message, statut = 400) {
    super(message);
    this.statut = statut;
  }
}

export const routes = {
  // Le contexte système est passé ici aussi, sinon le panneau afficherait
  // « prêt à synchroniser » pendant que le planificateur reporte pour cause de
  // batterie ou de partage de connexion.
  'GET /api/tableau-de-bord': async () => tableauDeBord(await lireContextePlateforme()),

  'GET /api/catalogue': () => ({
    ...catalogueComplet(),
    // L'interface a besoin des variables pour l'éditeur de modèle personnalisé.
    variables: VARIABLES,
  }),

  'GET /api/config': () => config(),

  'PUT /api/config': (corps) => {
    if (corps?.organisation?.schéma === 'personnalise') {
      const problèmes = validerModèle(corps.organisation.modèlePersonnalisé, NOMS_VARIABLES);
      if (problèmes.length) throw new ErreurRequête(problèmes.join(' '));
    }

    // Le préréglage de rythme fixe l'attente : on garde les deux cohérents pour
    // que l'interface n'ait jamais à faire ce calcul elle-même.
    if (corps?.rythme?.préréglage && corps.rythme.préréglage !== 'personnalise') {
      const préréglage = trouver(RYTHMES, corps.rythme.préréglage);
      if (préréglage) corps.rythme.attenteEntreTitres = préréglage.attente;
    }

    // LA LISTE DES PLAYLISTS N'EST JAMAIS MODIFIABLE PAR CETTE ROUTE.
    //
    // L'interface envoie la configuration entière à chaque changement de
    // réglage, à partir d'un instantané pris au chargement de la page. Si cet
    // instantané est antérieur à l'ajout d'une playlist, il ne la contient pas —
    // et comme la fusion REMPLACE les tableaux, enregistrer écraserait la liste
    // du disque. Concrètement : ajouter une playlist puis cliquer sur « FLAC »
    // effaçait la playlist, sans le moindre message.
    //
    // Les playlists ont leurs propres routes (POST, PATCH, DELETE). Elles sont
    // donc reprises ici depuis l'état courant, quoi que le client ait envoyé.
    return enregistrer({ ...corps, playlists: config().playlists });
  },

  'POST /api/apercu': (corps) => {
    const organisation = corps?.organisation ?? config().organisation;
    const format = trouver(FORMATS, corps?.format ?? config().qualité.format);
    const problèmes = organisation.schéma === 'personnalise'
      ? validerModèle(organisation.modèlePersonnalisé, NOMS_VARIABLES)
      : [];

    return {
      problèmes,
      ...(problèmes.length ? { lignes: [], modèle: organisation.modèlePersonnalisé } : aperçu(organisation, format?.extension ?? 'ogg')),
    };
  },

  'POST /api/playlists': (corps) => {
    const analysé = analyserLienSpotify(corps?.url);
    if (!analysé) {
      throw new ErreurRequête(
        'Ce lien n’est pas reconnu. Copiez le lien depuis Spotify : clic droit sur la ' +
        'playlist, puis Partager, puis Copier le lien.',
      );
    }
    if (analysé.type === 'track') {
      throw new ErreurRequête(
        'Ce lien pointe vers un morceau seul. Zotijean surveille des playlists, des ' +
        'albums ou des artistes — collez plutôt le lien de la playlist qui le contient.',
      );
    }

    const c = config();
    if (c.playlists.some((p) => p.url === analysé.url)) {
      throw new ErreurRequête('Cette playlist est déjà surveillée.');
    }

    const nouvelle = {
      id: crypto.randomUUID(),
      url: analysé.url,
      nom: String(corps?.nom || '').trim() || null,
      type: analysé.type,
      actif: true,
      remplacements: {},
    };

    modifier({ playlists: [...c.playlists, nouvelle] });
    journal.info(`Playlist ajoutée : ${nouvelle.nom || nouvelle.url}`);
    return nouvelle;
  },

  'PATCH /api/playlists': (corps) => {
    const c = config();
    const playlists = c.playlists.map((p) =>
      p.id === corps?.id ? { ...p, ...corps.modifications } : p,
    );
    modifier({ playlists });
    return playlists.find((p) => p.id === corps?.id) ?? null;
  },

  'DELETE /api/playlists': (corps) => {
    const c = config();
    const restantes = c.playlists.filter((p) => p.id !== corps?.id);
    if (restantes.length === c.playlists.length) {
      throw new ErreurRequête('Playlist introuvable.', 404);
    }
    modifier({ playlists: restantes });
    étatModule.oublierPlaylist(corps.id);
    journal.info('Playlist retirée de la surveillance.');
    return { supprimé: true };
  },

  'GET /api/diagnostic': async () => diagnostiquer(config()),

  'GET /api/simulation': async () => simuler(),

  'POST /api/export-dj': async () => {
    const résultat = await exporterDepuisConfig(config());
    if (!résultat.rekordbox && !résultat.serato && résultat.avertissements.length) {
      throw new ErreurRequête(résultat.avertissements.join(' '));
    }
    return résultat;
  },

  'POST /api/synchroniser': async (corps) => {
    const résultat = await synchro.synchroniser('manuelle', {
      playlistsCiblées: corps?.playlists ?? null,
    });
    return résultat;
  },

  'POST /api/arreter': () => ({ arrêté: synchro.demanderArrêt() }),

  'GET /api/journal': () => ({ entrées: journal.récent(300) }),

  'GET /api/historique': () => ({
    exécutions: étatModule.état().exécutions.slice(0, 20).map((e) => ({
      ...e,
      // Les lignes techniques de zotify sont regroupées et traduites : « 47
      // erreurs » n'aide personne, « 47 fois : Spotify a refusé de livrer un
      // morceau — passez le rythme sur Prudent » donne une action.
      diagnostics: synthétiser(e.lignesErreur || []),
    })),
  }),

  'POST /api/ouvrir-dossier': () => {
    synchro.ouvrirDossierMusique();
    return { ouvert: true };
  },
};
