// Moteur de synchronisation : orchestre une exécution complète.
//
// Une exécution = diagnostic, puis chaque playlist active passée à zotify l'une
// après l'autre, puis bilan établi à partir du disque.
//
// DEUX GARANTIES STRUCTURELLES.
//
// 1. UNE SEULE EXÉCUTION À LA FOIS. Garantie par un fichier verrou, pas
//    seulement par une variable en mémoire : le verrou protège aussi contre une
//    seconde instance de l'app, et contre l'utilisateur qui lancerait zotify à
//    la main dans les mêmes dossiers pendant qu'une synchronisation tourne.
//    Deux processus zotify en parallèle, c'est le chemin le plus court vers la
//    limitation de débit de Spotify.
//
// 2. LE DISQUE FAIT FOI. On ne croit ni le code de sortie de zotify, ni ce qu'il
//    écrit sur sa sortie standard. On compte les fichiers.

import fs from 'node:fs';
import path from 'node:path';

import { config, attenteEffective, modifier as modifierConfig } from './config.js';
import { fichierVerrou, assurerDossier, dossierDonnées, volumeMonté } from './chemins.js';
import { journal } from './journal.js';
import { diagnostiquer, GRAVITÉ } from './diagnostic.js';
import { construireArguments, télécharger } from './zotify.js';
import { modèleActif } from './organisation.js';
import { nécessiteConversion, convertirLot, PROFILS } from './conversion.js';
import {
  écrireListeLecture, listerAudio, dossierCommun, déduireNomPlaylist,
} from './bibliotheque.js';
import * as étatModule from './etat.js';

// ---------------------------------------------------------------------------
// Verrou d'exécution
// ---------------------------------------------------------------------------

/** Un processus de ce PID tourne-t-il encore ? */
function processusVivant(pid) {
  try {
    process.kill(pid, 0); // le signal 0 ne tue rien : il teste l'existence
    return true;
  } catch (erreur) {
    return erreur.code === 'EPERM'; // existe mais appartient à quelqu'un d'autre
  }
}

export function prendreVerrou() {
  const chemin = fichierVerrou();
  assurerDossier(dossierDonnées());

  try {
    // « wx » échoue si le fichier existe : c'est ce qui rend la prise atomique.
    fs.writeFileSync(chemin, JSON.stringify({ pid: process.pid, date: new Date().toISOString() }), {
      flag: 'wx',
    });
    return true;
  } catch (erreur) {
    if (erreur.code !== 'EEXIST') throw erreur;
  }

  // Un verrou existe. S'il appartient à un processus mort (app tuée, panne de
  // courant), il est périmé et on le reprend — sinon l'app resterait bloquée
  // définitivement après un simple plantage.
  try {
    const contenu = JSON.parse(fs.readFileSync(chemin, 'utf8'));
    if (contenu.pid && processusVivant(contenu.pid) && contenu.pid !== process.pid) {
      return false;
    }
    journal.avertir('Verrou d’exécution périmé trouvé et repris (l’app avait été interrompue).');
    fs.writeFileSync(chemin, JSON.stringify({ pid: process.pid, date: new Date().toISOString() }));
    return true;
  } catch {
    fs.writeFileSync(chemin, JSON.stringify({ pid: process.pid, date: new Date().toISOString() }));
    return true;
  }
}

export function rendreVerrou() {
  try {
    fs.unlinkSync(fichierVerrou());
  } catch {
    // Déjà rendu : sans importance.
  }
}

// ---------------------------------------------------------------------------
// État en mémoire de l'exécution en cours
// ---------------------------------------------------------------------------

let courante = null;
const abonnés = new Set();

function diffuser(événement) {
  for (const abonné of abonnés) {
    try {
      abonné(événement);
    } catch {
      // Une connexion web fermée ne doit rien interrompre.
    }
  }
}

export function abonner(rappel) {
  abonnés.add(rappel);
  return () => abonnés.delete(rappel);
}

export function exécutionEnCours() {
  if (!courante) return null;
  return {
    déclencheur: courante.déclencheur,
    début: courante.début,
    playlistActuelle: courante.playlistActuelle,
    indexPlaylist: courante.indexPlaylist,
    totalPlaylists: courante.totalPlaylists,
    fichiersTéléchargés: courante.fichiersTéléchargés,
    dernièreLigne: courante.dernièreLigne,
    pourcentage: courante.pourcentage,
  };
}

export function demanderArrêt() {
  if (!courante) return false;
  courante.contrôleur.abort();
  return true;
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

/**
 * Lance une synchronisation complète.
 * `déclencheur` vaut « planifiée » ou « manuelle » — il change le message
 * affiché et, plus tard, la politique d'assertion d'énergie côté macOS.
 */
export async function synchroniser(déclencheur = 'manuelle', options = {}) {
  const { playlistsCiblées = null } = options;

  if (courante) {
    return { lancé: false, raison: 'Une synchronisation est déjà en cours.' };
  }

  if (!prendreVerrou()) {
    return {
      lancé: false,
      raison:
        'Une autre instance de Zotijean semble déjà en train de synchroniser. ' +
        'Si ce n’est pas le cas, fermez l’app et relancez-la.',
    };
  }

  const c = config();
  const début = new Date();

  courante = {
    déclencheur,
    début: début.toISOString(),
    contrôleur: new AbortController(),
    playlistActuelle: null,
    indexPlaylist: 0,
    totalPlaylists: 0,
    fichiersTéléchargés: 0,
    dernièreLigne: null,
    pourcentage: null,
  };

  étatModule.marquerTentative(début);
  diffuser({ type: 'synchro-début', déclencheur, début: courante.début });
  journal.info(`Synchronisation ${déclencheur} démarrée.`);

  const bilan = {
    déclencheur,
    début: début.toISOString(),
    playlists: [],
    nbFichiers: 0,
    nbConvertis: 0,
    nbErreurs: 0,
    interrompu: false,
    réglagesNonAppliqués: [],
  };

  try {
    // --- Diagnostic préalable -------------------------------------------
    const rapport = await diagnostiquer(c);
    const bloquants = rapport.contrôles.filter((x) => x.gravité === GRAVITÉ.BLOQUANT);

    if (bloquants.length > 0) {
      bilan.échec = bloquants.map((b) => `${b.titre} : ${b.message}`).join(' ');
      journal.erreur('Synchronisation annulée par le diagnostic.', bilan.échec);
      diffuser({ type: 'synchro-echec', message: bilan.échec, contrôles: bloquants });
      return { lancé: false, raison: bilan.échec, diagnostic: rapport };
    }

    const capacités = rapport.contrôles.find((x) => x.id === 'zotify');
    const racine = c.général.dossierMusique;
    const modèle = modèleZotify(c);
    const attente = attenteEffective(c);

    const playlists = (c.playlists || []).filter(
      (p) => p.actif && (!playlistsCiblées || playlistsCiblées.includes(p.id)),
    );
    courante.totalPlaylists = playlists.length;

    // --- Une playlist après l'autre --------------------------------------
    for (const [index, playlist] of playlists.entries()) {
      if (courante.contrôleur.signal.aborted) {
        bilan.interrompu = true;
        break;
      }

      // Le disque peut être débranché en cours d'exécution.
      if (!volumeMonté(racine)) {
        bilan.échec = 'Le disque de destination a été débranché pendant la synchronisation.';
        journal.erreur(bilan.échec);
        break;
      }

      courante.playlistActuelle = playlist.nom || playlist.url;
      courante.indexPlaylist = index + 1;
      courante.pourcentage = null;
      diffuser({
        type: 'playlist-début',
        nom: courante.playlistActuelle,
        index: index + 1,
        total: playlists.length,
      });

      // On demande TOUJOURS le fichier d'origine à zotify, et on convertit
      // nous-mêmes ensuite. Sa commande ffmpeg ne reporte ni les métadonnées, ni
      // la pochette, et ne contrôle pas le dither : elle produit des fichiers
      // lisibles mais nus. Voir src/conversion.js.
      const configPourZotify = nécessiteConversion(c.qualité.format)
        ? { ...c, qualité: { ...c.qualité, format: 'copie' } }
        : c;

      const { arguments: args, nonAppliqués } = construireArguments({
        url: playlist.url,
        config: configPourZotify,
        attente,
        capacités,
        modèle,
        dossierRacine: racine,
      });

      for (const message of nonAppliqués) {
        if (!bilan.réglagesNonAppliqués.includes(message)) {
          bilan.réglagesNonAppliqués.push(message);
        }
      }

      const résultat = await télécharger({
        commande: capacités.chemin,
        arguments: args,
        dossierRacine: racine,
        signalArrêt: courante.contrôleur.signal,
        surÉvénement: (événement) => {
          if (événement.type === 'ligne') {
            courante.dernièreLigne = événement.texte;
            if (typeof événement.pourcentage === 'number') {
              courante.pourcentage = événement.pourcentage;
            }
          }
          diffuser({ ...événement, playlist: courante.playlistActuelle });
        },
      });

      const nbNouveaux = résultat.nouveaux?.length ?? 0;
      courante.fichiersTéléchargés += nbNouveaux;
      bilan.nbFichiers += nbNouveaux;
      bilan.nbErreurs += résultat.erreurs?.length ?? 0;
      if (résultat.interrompu) bilan.interrompu = true;

      const aprèsTéléchargement = await finaliserPlaylist({
        config: c,
        playlist,
        racine,
        nouveaux: (résultat.nouveaux ?? []).map((f) => f.chemin),
        signalArrêt: courante.contrôleur.signal,
        surProgrès: (progrès) => {
          courante.dernièreLigne =
            `Conversion ${progrès.index}/${progrès.total} — ${progrès.nom}`;
          diffuser({ type: 'ligne', texte: courante.dernièreLigne, playlist: courante.playlistActuelle });
        },
      });

      bilan.nbConvertis += aprèsTéléchargement.nbConvertis;
      bilan.nbErreurs += aprèsTéléchargement.échecsConversion.length;

      bilan.playlists.push({
        id: playlist.id,
        nom: aprèsTéléchargement.nom || courante.playlistActuelle,
        nbFichiers: nbNouveaux,
        nbConvertis: aprèsTéléchargement.nbConvertis,
        nbSuspects: résultat.suspects?.length ?? 0,
        nbErreurs: résultat.erreurs?.length ?? 0,
        duréeMs: résultat.duréeMs,
        échec: résultat.lancé ? null : résultat.erreur,
      });

      // Le nom déduit du dossier créé est le seul vrai nom de playlist dont on
      // dispose sans l'API Web de Spotify : on le mémorise pour l'afficher à la
      // place du fragment d'URL.
      if (aprèsTéléchargement.nom && !playlist.nom) {
        const àJour = config().playlists.map((p) =>
          p.id === playlist.id ? { ...p, nom: aprèsTéléchargement.nom } : p,
        );
        modifierConfig({ playlists: àJour });
      }

      const infos = étatModule.infosPlaylist(playlist.id) || {};
      étatModule.majPlaylist(playlist.id, {
        dernierSuccès: new Date().toISOString(),
        nbFichiers: (infos.nbFichiers || 0) + nbNouveaux,
        dernièreErreur: résultat.erreurs?.[0]?.texte ?? null,
      });

      diffuser({
        type: 'playlist-fin',
        nom: courante.playlistActuelle,
        nbFichiers: nbNouveaux,
      });
    }

    bilan.fin = new Date().toISOString();
    bilan.duréeMs = Date.now() - début.getTime();

    // On n'avance la date de référence que si l'exécution est allée au bout :
    // une synchronisation interrompue doit repartir à la prochaine occasion,
    // pas attendre 48 h de plus.
    if (!bilan.interrompu && !bilan.échec) étatModule.marquerSuccès(new Date());

    étatModule.enregistrerExécution(bilan);

    journal.info(
      `Synchronisation terminée — ${bilan.nbFichiers} nouveau(x) titre(s), ` +
        `${bilan.nbErreurs} erreur(s)${bilan.interrompu ? ', interrompue' : ''}.`,
    );
    diffuser({ type: 'synchro-fin', bilan });

    return { lancé: true, bilan };
  } catch (erreur) {
    journal.erreur('Erreur inattendue pendant la synchronisation.', erreur.stack || erreur.message);
    bilan.échec = erreur.message;
    étatModule.enregistrerExécution(bilan);
    diffuser({ type: 'synchro-echec', message: erreur.message });
    return { lancé: false, raison: erreur.message };
  } finally {
    courante = null;
    rendreVerrou();
  }
}

/**
 * Travail d'après-téléchargement pour une playlist : conversion de format,
 * liste de lecture, et déduction du vrai nom.
 *
 * Isolée pour être testable sans lancer zotify, et parce que c'est ici que se
 * concentrent les opérations qui touchent aux fichiers de l'utilisateur.
 */
export async function finaliserPlaylist({
  config: c, playlist, racine, nouveaux, signalArrêt = null, surProgrès = () => {},
}) {
  const résultat = { nom: null, nbConvertis: 0, échecsConversion: [], listeLecture: null };

  if (!nouveaux.length) return résultat;

  résultat.nom = déduireNomPlaylist(nouveaux, racine);

  // --- Conversion ------------------------------------------------------
  let fichiersFinaux = nouveaux;

  if (nécessiteConversion(c.qualité.format)) {
    const bilan = await convertirLot({
      fichiers: nouveaux,
      format: c.qualité.format,
      surProgrès,
      signalArrêt,
    });

    résultat.nbConvertis = bilan.convertis.length;
    résultat.échecsConversion = bilan.échecs;

    if (bilan.échecs.length) {
      journal.avertir(
        `${bilan.échecs.length} conversion(s) ont échoué. Les fichiers d'origine sont ` +
          'conservés intacts : rien n’est perdu.',
      );
    }

    // Les sources restent sur disque : c'est volontaire. Un Ogg d'origine permet
    // de re-dériver n'importe quelle cible plus tard sans retélécharger, ce qui
    // vaut cher quand un rattrapage complet prend 17 heures.
    fichiersFinaux = bilan.convertis.map((c2) => c2.destination);
    if (fichiersFinaux.length === 0) fichiersFinaux = nouveaux;
  }

  // --- Liste de lecture ------------------------------------------------
  if (c.organisation.écrireM3U) {
    const dossier = dossierCommun(fichiersFinaux);
    // On n'écrit une liste que si tous les fichiers partagent un dossier :
    // avec un rangement par artiste ou par genre, une liste par playlist n'aurait
    // pas de dossier évident où atterrir.
    if (dossier) {
      const nom = résultat.nom || playlist.nom || 'Playlist';
      try {
        résultat.listeLecture = écrireListeLecture({
          destination: path.join(dossier, `${nom}.m3u8`),
          fichiers: listerAudio(dossier),
          titre: nom,
        });
      } catch (erreur) {
        journal.avertir('La liste de lecture n’a pas pu être écrite.', erreur.message);
      }
    }
  }

  return résultat;
}

/**
 * Traduit le modèle de l'app vers celui de zotify.
 *
 * Les deux vocabulaires diffèrent : l'app parle français à l'utilisateur, zotify
 * attend ses propres noms de variables. Cette table est le seul endroit qui
 * connaît la correspondance — et c'est le premier endroit à corriger si une
 * version de zotify renomme ses variables.
 */
export function modèleZotify(c = config()) {
  const correspondances = {
    '{playlist}': '{playlist}',
    '{numéro}': '{playlist_num}',
    '{artiste}': '{artist}',
    '{titre}': '{song_name}',
    '{album}': '{album}',
    '{artiste_album}': '{album_artist}',
    '{piste}': '{track_number}',
    '{disque}': '{disc_number}',
    '{année}': '{release_year}',
    '{genre}': '{genre}',
  };

  let modèle = modèleActif(c.organisation);
  for (const [français, zotify] of Object.entries(correspondances)) {
    modèle = modèle.split(français).join(zotify);
  }
  return modèle;
}

/** Ouvre le dossier de musique dans le Finder ou l'Explorateur. */
export function ouvrirDossierMusique() {
  const dossier = config().général.dossierMusique;
  assurerDossier(dossier);
  const commande = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  import('node:child_process').then(({ spawn }) => {
    spawn(commande, [path.resolve(dossier)], { detached: true, stdio: 'ignore' }).unref();
  });
}
