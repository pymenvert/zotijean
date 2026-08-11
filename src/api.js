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
import { étatOutils } from './outils.js';
import { modèleActif } from './organisation.js';
import { exporterDepuisConfig } from './exports-dj.js';
import { synthétiser } from './erreurs.js';
import { lireContextePlateforme } from './energie.js';
import * as spotify from './spotify.js';

/**
 * L'adresse que Spotify appellera après autorisation.
 *
 * Elle doit être recopiée à l'identique dans le tableau de bord développeur :
 * Spotify refuse toute redirection qui ne correspond pas exactement, port
 * compris. C'est la cause d'échec la plus fréquente, d'où son affichage dans
 * l'interface plutôt que sa dissimulation dans le code.
 */
export function adresseRetourSpotify(c = config()) {
  return `http://127.0.0.1:${c.général.port}/api/spotify/retour`;
}

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

  // ------------------------------------------------------------ Spotify

  'GET /api/spotify/etat': async () => {
    const c = config();
    const base = {
      actif: !!c.spotify?.actif,
      clientIdRenseigné: !!c.spotify?.clientId,
      connecté: spotify.estConnecté(),
      redirection: adresseRetourSpotify(c),
    };

    if (!base.connecté) return base;

    try {
      return { ...base, profil: await spotify.profil() };
    } catch (erreur) {
      return { ...base, erreur: erreur.message, reconnexion: !!erreur.reconnexion };
    }
  },

  'POST /api/spotify/connexion': (corps) => {
    const clientId = String(corps?.clientId || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) {
      throw new ErreurRequête(
        'L’identifiant d’application attendu est une suite de 32 caractères, ' +
        'copiée depuis le tableau de bord développeur de Spotify.',
      );
    }

    modifier({ spotify: { ...config().spotify, clientId, actif: true } });
    return { url: spotify.préparerConnexion(clientId, adresseRetourSpotify(config())) };
  },

  'POST /api/spotify/deconnexion': () => {
    spotify.oublierJetons();
    modifier({ spotify: { ...config().spotify, actif: false } });
    journal.info('Déconnexion de Spotify.');
    return { déconnecté: true };
  },

  'GET /api/spotify/playlists': async () => {
    if (!spotify.estConnecté()) {
      throw new ErreurRequête('Connectez d’abord votre compte Spotify.', 409);
    }
    const suivies = new Set(config().playlists.map((p) => p.url));
    const toutes = await spotify.mesPlaylists();
    return { playlists: toutes.map((p) => ({ ...p, suivie: suivies.has(p.url) })) };
  },

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

  /**
   * Rapport de diagnostic complet, en un seul fichier texte.
   *
   * Sans lui, signaler un problème obligeait à aller chercher un fichier dans
   * une bibliothèque système cachée. Tout ce qu'il faut pour comprendre une
   * panne tient ici : version, système, état des outils, réglages, dernières
   * exécutions et journal.
   */
  'GET /api/rapport': async () => {
    const c = config();
    const rapport = await diagnostiquer(c);
    const é = étatModule.état();

    const ligne = (clé, valeur) => `${clé.padEnd(26)} ${valeur}`;
    const section = (titre) => `\n${'─'.repeat(70)}\n${titre}\n${'─'.repeat(70)}`;

    const morceaux = [
      'RAPPORT DE DIAGNOSTIC ZOTIJEAN',
      `Établi le ${new Date().toLocaleString('fr-FR')}`,
      section('SYSTÈME'),
      ligne('Plateforme', `${process.platform} ${process.arch}`),
      ligne('Node.js', process.version),
      ligne('Outils embarqués', étatOutils().embarqués ? 'oui' : 'non'),
      section('INSTALLATION'),
      ...rapport.contrôles.map((x) =>
        `[${x.gravité.toUpperCase().padEnd(13)}] ${x.titre}\n    ${x.message}` +
        (x.chemin ? `\n    → ${x.chemin}` : '') +
        (x.version ? `\n    → version ${x.version}` : '')),
      section('RÉGLAGES'),
      ligne('Dossier de musique', c.général.dossierMusique),
      ligne('Qualité', c.qualité.niveau),
      ligne('Format', c.qualité.format),
      ligne('Rangement', c.organisation.schéma),
      ligne('Modèle', modèleActif(c.organisation)),
      ligne('Intervalle', `${c.planification.intervalleHeures} h`),
      ligne('Planification active', c.planification.actif ? 'oui' : 'non'),
      ligne('Attente entre titres', `${attenteEffective(c)} s`),
      ligne('Playlists surveillées', `${c.playlists.filter((p) => p.actif).length} active(s) sur ${c.playlists.length}`),
      section('DERNIÈRES EXÉCUTIONS'),
      ...(é.exécutions.slice(0, 10).map((e) =>
        `${new Date(e.date).toLocaleString('fr-FR')} — ${e.déclencheur} — ` +
        `${e.nbFichiers} titre(s), ${e.nbErreurs} erreur(s)` +
        (e.échec ? `\n    ÉCHEC : ${e.échec}` : '')) || ['aucune']),
      section('PROBLÈMES RENCONTRÉS'),
      ...(synthétiser(é.exécutions.flatMap((e) => e.lignesErreur || [])).map((s) =>
        `${s.nombre}× ${s.titre}\n    ${s.explication}` +
        (s.geste ? `\n    À FAIRE : ${s.geste}` : '')) || ['aucun']),
      section('JOURNAL (200 dernières lignes)'),
      ...journal.récent(200).map((e) =>
        `${new Date(e.date).toLocaleTimeString('fr-FR')} [${e.niveau}] ${e.message}` +
        (e.détails ? ` — ${typeof e.détails === 'string' ? e.détails : JSON.stringify(e.détails)}` : '')),
      '',
      'Ce rapport ne contient aucun identifiant : Zotijean n’en manipule pas,',
      'ils appartiennent à zotify. Il contient en revanche vos chemins de',
      'dossiers et vos liens de playlists.',
    ];

    return { texte: morceaux.join('\n'), nom: `zotijean-diagnostic-${new Date().toISOString().slice(0, 10)}.txt` };
  },

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
