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

import {
  config, attenteEffective, configPourPlaylist, modifier as modifierConfig,
} from './config.js';
import { fichierVerrou, assurerDossier, dossierDonnées, volumeMonté, espaceLibre } from './chemins.js';
import { journal } from './journal.js';
import { diagnostiquer, GRAVITÉ } from './diagnostic.js';
import {
  construireArguments, télécharger, saitReprendreSansLeFichier, échecDeLancement,
  assurerJournalTéléchargements, cheminsDéjàTéléchargés, sauvegarderJournalTéléchargements,
} from './zotify.js';
import { modèleActif, cléComparaison } from './organisation.js';
import {
  nécessiteConversion, convertirLot, PROFILS,
  démarrerConversionContinue, rattraperConversions,
} from './conversion.js';
import { exporterDepuisConfig } from './exports-dj.js';
import { analyserPlaylist } from './analyse.js';
import {
  écrireListeLecture, listerAudio, dossierCommun, déduireNomPlaylist,
  archiver, mettreÀLaCorbeille, sansSourcesConverties,
} from './bibliotheque.js';
import * as étatModule from './etat.js';
import { conditionToujoursRemplie, empêcherLaVeille } from './energie.js';
import { phraseBilan, compterTitresPerdus } from './erreurs.js';

/**
 * Le nom sous lequel une playlist est désignée à l'utilisateur.
 *
 * `bilan.àReprendre` contenait tantôt un nom (« Deep dive »), tantôt une URL
 * complète, selon que la playlist avait déjà été nommée. Deux formes pour la
 * même chose : illisible dans le journal, et impossible à rapprocher d'une ligne
 * à l'autre. On tranche pour le nom.
 *
 * Le repli n'est PAS l'URL entière mais son identifiant, qui est déjà ce que
 * l'accueil affiche sous chaque playlist non nommée : une seule écriture pour
 * une même chose, partout dans l'app.
 */
export function nomAffichable(playlist, nomDéduit = null) {
  if (nomDéduit) return nomDéduit;
  if (playlist?.nom) return playlist.nom;

  const url = String(playlist?.url ?? '');
  const trouvé = /(playlist|album|artist|track)[/:]([A-Za-z0-9]+)/.exec(url);
  return trouvé ? `${trouvé[1]}/${trouvé[2]}` : (url || 'playlist sans nom');
}

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

/**
 * Diffuser un événement depuis un autre module.
 *
 * Le canal des événements en direct vit ici parce que la synchronisation en est
 * la principale source, mais elle n'est pas la seule opération longue : un export
 * DJ sonde chaque fichier de la bibliothèque un par un. Sans un signe de vie, il
 * ressemble à un blocage — le même défaut que « Préparation… » affiché pendant
 * dix-sept heures.
 */
export function diffuserÉvénement(événement) {
  diffuser(événement);
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
  // `créerVeille` est injectable pour une seule raison : sans elle, le
  // BRANCHEMENT de la veille du disque n'est testable par rien. Ses sondes
  // (`volumeMonté`, `espaceLibre`) sont des liaisons de module qu'un test ne
  // peut pas remplacer, et la leçon la plus chère de ce projet est qu'une garde
  // correcte que personne n'appelle ne protège rien.
  const { playlistsCiblées = null, créerVeille = créerVeilleDuDisque } = options;

  // UNE SEULE INSTANCE POUR TOUTE L'EXÉCUTION. Construite ici, hors de la boucle
  // des playlists : sa limitation dans le temps doit courir sur l'exécution
  // entière, pas se réarmer à chaque playlist.
  const veillerSurLeDisque = créerVeille();

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
    // DEUX CHIFFRES, PAS UN. Ils étaient confondus, et cette confusion a coûté
    // au projet un horaire de synchronisation reporté pour une parole
    // manquante. `nbSignalements` compte les LIGNES que zotify a marquées ;
    // `nbErreurs` compte les TITRES réellement perdus. Une ligne d'information
    // — paroles introuvables, morceau retiré du catalogue — pèse sur le premier
    // et jamais sur le second.
    nbSignalements: 0,
    nbErreurs: 0,
    // Combien de fois zotify n'a rien prouvé. Distinct des deux chiffres
    // ci-dessus : un lancement raté ne produit AUCUNE ligne, donc il ne pesait
    // sur ni l'un ni l'autre — c'est exactement ce qui le rendait invisible.
    lancementsRatés: 0,
    interrompu: false,
    réglagesNonAppliqués: [],
    // Conservées brutes pour que l'historique puisse les regrouper et les
    // traduire plus tard, sans figer la formulation au moment de l'exécution.
    lignesErreur: [],
  };

  // Le Mac ne doit pas s'endormir pendant les heures qui viennent. Posé avant
  // le « try » pour que le « finally » le relâche quoi qu'il arrive.
  const laisserDormir = empêcherLaVeille();

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
    const attente = attenteEffective(c);

    let playlists = (c.playlists || []).filter(
      (p) => p.actif && (!playlistsCiblées || playlistsCiblées.includes(p.id)),
    );

    // --- Reprise d'une exécution interrompue ------------------------------
    // Une fermeture de l'app, une mise en veille ou une coupure de courant
    // laissent une trace. Plutôt que de tout refaire — chaque playlist coûte
    // ses trente secondes d'attente par titre — on repart des suivantes.
    const reprise = étatModule.repriseEnAttente();
    if (reprise && !playlistsCiblées) {
      const déjàFaites = new Set(reprise.playlistsTerminées);
      const restantes = playlists.filter((p) => !déjàFaites.has(p.id));

      if (restantes.length && restantes.length < playlists.length) {
        journal.info(
          `Reprise de la synchronisation interrompue : ${playlists.length - restantes.length} ` +
            `playlist(s) déjà traitée(s), ${restantes.length} restante(s).`,
        );
        bilan.reprise = { déjàTraitées: playlists.length - restantes.length };
        playlists = restantes;
      }
    }

    // --- Le journal des telechargements -----------------------------------
    //
    // Cree AVANT toute execution de zotify, et seulement si l'utilisateur a
    // demande un retrait des fichiers d'origine. Sans ce fichier, zotify tient
    // son journal pour desactive et n'y ecrit jamais rien : il resterait absent
    // pour toujours, et la politique de retrait resterait refusee en silence.
    // Verifie dans sa source (utils.py:320), et sur la machine — apres dix-sept
    // titres, le fichier n'existait pas.
    if (c.retrait?.sourcesAprèsConversion && c.retrait.sourcesAprèsConversion !== 'conserver') {
      assurerJournalTéléchargements(dossierDonnées());
    }

    // --- Rattrapage des conversions laissees en plan ----------------------
    //
    // POURQUOI CE PASSAGE EXISTE. Avant lui, une execution interrompue laissait
    // ses fichiers dans le mauvais format et RIEN ne les reprenait jamais : la
    // conversion ne regardait que les nouveautes de l'execution en cours, et
    // « --skip-existing » empeche zotify de reproposer un fichier deja present.
    // Le 19 aout 2026, treize titres sont ainsi restes en Ogg, dans des listes
    // de lecture que Rekordbox ne sait pas lire.
    //
    // Il est place APRES le diagnostic, donc apres la verification de ffmpeg :
    // sans lui, chaque fichier remonterait une erreur separee.
    if (nécessiteConversion(c.qualité.format)) {
      const rattrapage = await rattraperConversions({
        dossier: c.général.dossierMusique,
        format: c.qualité.format,
        signalArrêt: courante.contrôleur.signal,
        surProgrès: ({ nom }) => {
          courante.dernièreLigne = `Rattrapage de conversion — ${nom}`;
          diffuser({ type: 'ligne', texte: courante.dernièreLigne, sousType: 'conversion' });
        },
      });
      if (rattrapage.convertis.length) {
        bilan.nbConvertis += rattrapage.convertis.length;
        bilan.rattrapés = rattrapage.convertis.length;
        journal.info(
          `${rattrapage.convertis.length} fichier(s) restes dans le mauvais format ont ete `
          + `convertis avant de commencer.`,
        );
      }
      if (rattrapage.échecs.length) {
        bilan.nbSignalements += rattrapage.échecs.length;
        bilan.nbErreurs += rattrapage.échecs.length;
      }
    }

    étatModule.ouvrirReprise(déclencheur, début);
    courante.totalPlaylists = playlists.length;

    // Playlists dont la première tentative n'a rien donné : on les reprend
    // une fois à la fin, quand le réseau ou Spotify se sera peut-être calmé.
    const àReprendre = [];

    // --- Une playlist après l'autre --------------------------------------
    for (const [index, playlistInitiale] of playlists.entries()) {
      let playlist = playlistInitiale;

      if (courante.contrôleur.signal.aborted) {
        bilan.interrompu = true;
        break;
      }

      // Réglages effectifs de CETTE playlist : elle peut surcharger le dossier,
      // la qualité, le format et le schéma de rangement.
      const cp = configPourPlaylist(c, playlist);
      const racine = cp.général.dossierMusique;
      // Le type peut manquer sur une source ajoutée par une vieille version :
      // on le déduit alors de l'adresse, qui le porte toujours.
      const typeSource = playlist.type
        || (playlist.url?.includes('/album/') ? 'album'
          : playlist.url?.includes('/artist/') ? 'artist' : 'playlist');
      const modèle = modèleZotify(cp, typeSource);

      // Le disque peut être débranché en cours d'exécution.
      if (!volumeMonté(racine)) {
        bilan.échec = 'Le disque de destination a été débranché pendant la synchronisation.';
        journal.erreur(bilan.échec);
        break;
      }

      // Le disque se remplit AU FIL de l'exécution. Le diagnostic préalable a
      // vérifié qu'il y avait la place au départ ; dix-sept heures et deux mille
      // titres plus tard, ce n'est plus la même question. Sans cette relecture,
      // zotify continuerait d'écrire sur un disque plein — c'est-à-dire de
      // produire des fichiers tronqués à la chaîne.
      const libre = espaceLibre(racine);
      const minimum = (cp.gardes?.espaceMinimumGo ?? 2) * 1024 ** 3;
      if (libre !== null && libre < minimum) {
        bilan.interrompu = true;
        bilan.raisonInterruption =
          `il ne reste que ${(libre / 1024 ** 3).toFixed(1)} Go sur le disque de ` +
          `destination, sous le seuil de ${(minimum / 1024 ** 3).toFixed(0)} Go que vous ` +
          'avez fixé. Faites de la place : la synchronisation reprendra où elle en est.';
        journal.erreur(bilan.raisonInterruption);
        break;
      }

      // Les conditions de l'utilisateur peuvent cesser d'être remplies en cours
      // de route : on débranche, on part, on passe sur le partage de connexion.
      // C'est un REPORT, pas un échec — on n'avance pas `dernierSuccès`, donc la
      // reprise se fera d'elle-même dès que la condition redevient vraie.
      const conditionPerdue = await conditionToujoursRemplie(cp);
      if (conditionPerdue) {
        bilan.interrompu = true;
        bilan.raisonInterruption = conditionPerdue;
        journal.avertir(conditionPerdue);
        break;
      }

      // --- Ce que l'API Spotify sait avant de lancer quoi que ce soit ------
      const analyse = await analyserPlaylist(cp, playlist);

      if (analyse.sauter) {
        journal.info(analyse.raison);
        bilan.playlists.push({
          id: playlist.id, nom: analyse.nom, nbFichiers: 0, sautée: true, raison: analyse.raison,
        });
        étatModule.noterPlaylistTerminée(playlist.id);
        diffuser({ type: 'playlist-sautee', nom: analyse.nom, raison: analyse.raison });
        continue;
      }

      if (analyse.disponible) {
        journal.info(analyse.raison);
        // La version n'est PAS enregistrée ici : elle ne vaudra « déjà fait »
        // qu'une fois le téléchargement réellement terminé, plus bas.
        étatModule.majPlaylist(playlist.id, {
          nbTitresSpotify: analyse.nbTitres,
          nbManquants: analyse.manquants?.length ?? null,
        });
        if (analyse.nom && !playlist.nom) playlist = { ...playlist, nom: analyse.nom };
      }

      courante.playlistActuelle = playlist.nom || analyse.nom || playlist.url;
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
      const configPourZotify = nécessiteConversion(cp.qualité.format)
        ? { ...cp, qualité: { ...cp.qualité, format: 'copie' } }
        : cp;

      const { arguments: args, nonAppliqués, bloquant } = construireArguments({
        url: playlist.url,
        config: configPourZotify,
        attente,
        capacités,
        modèle,
        dossierRacine: racine,
        dossierJournal: dossierDonnées(),
      });

      // Un réglage bloquant arrête tout : renseigner `bilan.échec` empêche
      // `marquerSuccès`, donc l'app ne repart pas pour 48 h en croyant avoir
      // travaillé.
      if (bloquant) {
        bilan.échec = bloquant;
        journal.erreur(bloquant);
        break;
      }

      for (const message of nonAppliqués) {
        if (!bilan.réglagesNonAppliqués.includes(message)) {
          bilan.réglagesNonAppliqués.push(message);
        }
      }

      // Les variables que zotify ne sait pas remplacer passent par le même
      // canal : l'utilisateur doit apprendre que son classement par genre n'a
      // pas été appliqué, pas le déduire en fouillant son disque.
      for (const perte of variablesImpossibles(cp)) {
        if (!bilan.réglagesNonAppliqués.includes(perte)) {
          bilan.réglagesNonAppliqués.push(perte);
        }
      }

      // LA CONVERSION TOURNE PENDANT LE TÉLÉCHARGEMENT, PAS APRÈS.
      //
      // Sinon, une interruption laisse les fichiers dans le mauvais format et
      // rien ne les rattrape jamais : c'est ce qui a laissé treize Ogg sur le
      // disque le 19 août 2026, dans des listes de lecture que Rekordbox ne sait
      // pas lire. zotify écrit en .tmp puis renomme, donc tout fichier portant
      // une extension audio est complet ; et ses trente secondes d'attente entre
      // deux titres laissent tout le temps à ffmpeg.
      const moisson = nécessiteConversion(cp.qualité.format)
        ? démarrerConversionContinue({
          dossier: racine,
          format: cp.qualité.format,
          signalArrêt: courante.contrôleur.signal,
          surProgrès: ({ nom }) => {
            // L'avancement doit dire la conversion, pas seulement le
            // téléchargement : sans ça, la moitié du travail est invisible.
            courante.dernièreLigne = `Conversion — ${nom}`;
            diffuser({
              type: 'ligne', texte: courante.dernièreLigne,
              sousType: 'conversion', playlist: courante.playlistActuelle,
            });
          },
        })
        : null;

      let résultat;
      let convertisAuFilDeLEau = { convertis: [], échecs: [] };
      try {
        résultat = await télécharger({
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

            // LES GARDES DU DISQUE, RELUES PENDANT. Celles d'avant la boucle
            // ont été passées à l'instant où la playlist a commencé — et pour
            // deux mille titres à trente secondes, cet instant est seize heures
            // avant la fin.
            //
            // Un REPORT, pas un échec : on n'avance pas `dernierSuccès`, donc la
            // reprise se fera d'elle-même dès que le disque revient. On ne
            // diffuse donc PAS « synchro-echec », qui peindrait en rouge une
            // pause — les trois autres reports de cette boucle ne le font pas
            // non plus.
            const alerte = veillerSurLeDisque({
              racine,
              minimumOctets: (cp.gardes?.espaceMinimumGo ?? 2) * 1024 ** 3,
            });
            if (alerte && !bilan.interrompu) {
              bilan.interrompu = true;
              bilan.raisonInterruption = alerte;
              journal.erreur(alerte);
              courante.contrôleur.abort();
            }
          },
        });
      } finally {
        // Dans un `finally` : une exception du téléchargement ne doit pas
        // laisser une minuterie tourner sur un moteur qui croit avoir fini.
        if (moisson) convertisAuFilDeLEau = await moisson.arrêter();
      }

      // Les fichiers PRODUITS par la moisson sont apparus dans le dossier
      // pendant que zotify tournait : l'inventaire avant/après les voit comme
      // des nouveautés. Les compter ferait annoncer deux fois chaque morceau.
      const produits = new Set(convertisAuFilDeLEau.convertis.map((c2) => c2.destination));
      if (produits.size && résultat.nouveaux) {
        résultat.nouveaux = résultat.nouveaux.filter((f) => !produits.has(f.chemin));
      }

      const nbNouveaux = résultat.nouveaux?.length ?? 0;
      courante.fichiersTéléchargés += nbNouveaux;
      bilan.nbFichiers += nbNouveaux;
      const lignesSignalées = résultat.erreurs ?? [];
      const titresPerdus = compterTitresPerdus(lignesSignalées);
      bilan.nbSignalements += lignesSignalées.length;
      bilan.nbErreurs += titresPerdus;
      if (résultat.interrompu) bilan.interrompu = true;

      // UN SUCCÈS NE SE DÉDUIT PAS D'UNE ABSENCE D'ERREUR CONNUE.
      //
      // Sans cette garde, un zotify qui se lance et meurt sans écrire une ligne
      // arrivait ici avec zéro erreur, zéro titre perdu, ni « interrompu » ni
      // « expiré » — et repartait en succès : date de référence avancée,
      // compteur d'échecs remis à zéro, « Aucune nouveauté » à l'écran, et
      // 48 h d'attente avant de recommencer à l'identique. Indéfiniment.
      //
      // La décision vit dans `échecDeLancement`, à côté de la fonction dont
      // elle lit le résultat, et elle est éprouvée là-bas.
      const échecLancement = échecDeLancement(résultat);
      if (échecLancement) {
        bilan.lancementsRatés += 1;
        journal.erreur(`Playlist « ${courante.playlistActuelle} » : ${échecLancement}`);
        // La PREMIÈRE cause est conservée : c'est celle qui explique le mieux,
        // les suivantes n'étant le plus souvent que la même panne répétée.
        if (!bilan.échec) bilan.échec = échecLancement;
      }

      // zotify a demandé une connexion Spotify et rien n'est arrivé : chaque
      // playlist suivante échouerait exactement pareil, en payant à chaque fois
      // le délai du chien de garde. On annule tout de suite, en disant quoi
      // faire. Si l'utilisateur a cliqué le lien à temps, des fichiers sont
      // arrivés et on ne passe pas ici.
      if (résultat.connexionRequise && nbNouveaux === 0) {
        bilan.échec =
          'zotify n’est pas connecté à votre compte Spotify. Ouvrez l’adresse de ' +
          'connexion affichée dans le journal (onglet Journal), autorisez l’accès, ' +
          'puis relancez la synchronisation. Si le lien a expiré, lancez zotify une ' +
          'fois dans le Terminal pour vous authentifier.';
        journal.erreur(bilan.échec);
        diffuser({ type: 'synchro-echec', message: bilan.échec });
        break;
      }

      for (const erreur of résultat.erreurs ?? []) {
        // Plafonné : une playlist qui échoue en boucle ne doit pas faire enfler
        // le fichier d'état jusqu'à le rendre illisible.
        if (bilan.lignesErreur.length < 200) bilan.lignesErreur.push(erreur.texte);
      }

      const aprèsTéléchargement = await finaliserPlaylist({
        config: cp,
        playlist,
        racine,
        capacités,
        nouveaux: (résultat.nouveaux ?? []).map((f) => f.chemin),
        signalArrêt: courante.contrôleur.signal,
        surProgrès: (progrès) => {
          courante.dernièreLigne =
            `Conversion ${progrès.index}/${progrès.total} — ${progrès.nom}`;
          diffuser({ type: 'ligne', texte: courante.dernièreLigne, playlist: courante.playlistActuelle });
        },
      });

      // Un échec de conversion EST une perte : le fichier attendu n'existe pas
      // dans le format demandé. Il compte donc dans les deux chiffres.
      bilan.nbConvertis += aprèsTéléchargement.nbConvertis;
      bilan.nbSignalements += aprèsTéléchargement.échecsConversion.length;
      bilan.nbErreurs += aprèsTéléchargement.échecsConversion.length;

      bilan.playlists.push({
        id: playlist.id,
        nom: aprèsTéléchargement.nom || courante.playlistActuelle,
        nbFichiers: nbNouveaux,
        nbConvertis: aprèsTéléchargement.nbConvertis,
        nbSuspects: résultat.suspects?.length ?? 0,
        nbSignalements: lignesSignalées.length,
        nbErreurs: titresPerdus + aprèsTéléchargement.échecsConversion.length,
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
      // « Allée au bout » ne regarde QUE les titres perdus, jamais le nombre de
      // lignes. Avec l'ancienne condition, une seule parole introuvable suffisait
      // à ne jamais marquer une playlist terminée : sa version Spotify n'était
      // jamais enregistrée, elle repartait de zéro à chaque exécution, et le
      // planificateur espaçait la tentative suivante. Constaté le 19 août 2026 —
      // les trois playlists étaient sans `versionSpotify` après trois passages.
      //
      // Un morceau retiré du catalogue est de gravité INFO pour la même raison,
      // en sens inverse : il n'arrivera jamais, donc reprendre la playlist
      // indéfiniment ne servirait qu'à repayer l'attente.
      const alléAuBout = !résultat.interrompu
        && !résultat.expiré
        && !échecLancement
        && titresPerdus === 0;

      étatModule.majPlaylist(playlist.id, {
        dernierSuccès: new Date().toISOString(),
        nbFichiers: (infos.nbFichiers || 0) + nbNouveaux,
        dernièreErreur: résultat.erreurs?.[0]?.texte
          ?? (résultat.expiré ? 'Arrêté après un long silence de zotify.' : null),
        // La version Spotify ne s'enregistre que si le travail est terminé.
        // L'inscrire plus tôt ferait sauter une playlist inachevée à toutes les
        // synchronisations suivantes.
        ...(alléAuBout && analyse.version ? { versionSpotify: analyse.version, nbManquants: 0 } : {}),
      });

      // Une playlist n'est « terminée » que si zotify est allé au bout. Une
      // interruption — bouton Arrêter, veille du Mac — au milieu d'une playlist
      // de 200 titres en laisse 160 non téléchargés : la marquer terminée
      // ferait sauter ces 160 titres à la reprise. Un titre réellement perdu
      // mérite la même seconde chance : une coupure réseau ou une limitation
      // temporaire de Spotify se résorbent souvent en quelques minutes.
      //
      // Le commentaire qui vivait ici parlait d'une playlist « qui n'a RIEN
      // produit » : cette règle-là n'existe plus depuis longtemps, et le message
      // affiché à l'utilisateur la répétait encore.
      const mériteReprise = !alléAuBout;

      if (mériteReprise) {
        àReprendre.push({ id: playlist.id, nom: nomAffichable(playlist, aprèsTéléchargement.nom) });
      } else {
        étatModule.noterPlaylistTerminée(playlist.id);
      }

      diffuser({
        type: 'playlist-fin',
        nom: courante.playlistActuelle,
        nbFichiers: nbNouveaux,
      });
    }

    // --- Playlists à reprendre --------------------------------------------
    //
    // Elles ne sont volontairement PAS marquées comme terminées : la trace de
    // reprise les conserve, et la prochaine exécution s'en occupera en premier.
    // On réutilise ainsi la mécanique déjà en place plutôt que d'enchaîner une
    // seconde tentative immédiate — qui échouerait de toute façon si la cause
    // est une limitation de débit, justement la plus fréquente.
    if (àReprendre.length) {
      bilan.àReprendre = àReprendre.map((p) => p.nom);
      const quelles = àReprendre.map((p) => `« ${p.nom} »`).join(', ');
      journal.avertir(
        `${àReprendre.length} playlist(s) ne sont pas allées au bout : ${quelles}. `
        + 'Elles seront reprises en priorité à la prochaine synchronisation.',
      );
    }

    // --- Exports vers les logiciels DJ -----------------------------------
    // Après la boucle, et seulement si des fichiers sont apparus : régénérer les
    // exports quand rien n'a changé ferait relire toute la bibliothèque pour
    // produire un fichier identique.
    if (c.exportsDJ?.automatique && bilan.nbFichiers > 0 && !bilan.interrompu) {
      diffuser({ type: 'ligne', texte: 'Mise à jour des exports DJ…' });
      try {
        const exports = await exporterDepuisConfig(c);
        bilan.exportsDJ = {
          rekordbox: exports.rekordbox,
          serato: exports.serato,
          avertissements: exports.avertissements,
        };
        for (const avertissement of exports.avertissements || []) {
          journal.avertir(avertissement);
        }
      } catch (erreur) {
        journal.avertir('Les exports DJ ont échoué.', erreur.message);
        bilan.exportsDJ = { avertissements: [erreur.message] };
      }
    }

    bilan.fin = new Date().toISOString();
    bilan.duréeMs = Date.now() - début.getTime();

    // On n'avance la date de référence que si l'exécution est allée au bout :
    // une synchronisation interrompue doit repartir à la prochaine occasion,
    // pas attendre 48 h de plus.
    // Le journal des téléchargements vaut désormais la bibliothèque entière :
    // le perdre après avoir retiré les Ogg ferait tout revenir par le réseau.
    // Une copie de sûreté à chaque exécution coûte quelques kilo-octets.
    if (c.retrait?.sourcesAprèsConversion && c.retrait.sourcesAprèsConversion !== 'conserver') {
      sauvegarderJournalTéléchargements(dossierDonnées());
    }

    if (!bilan.interrompu && !bilan.échec) {
      étatModule.marquerSuccès(new Date());
      étatModule.fermerReprise();
    } else {
      // La trace de reprise SURVIT volontairement : c'est elle qui permettra à
      // la prochaine exécution de repartir des playlists non traitées.
      const échecs = étatModule.marquerÉchec();
      journal.avertir(
        `Synchronisation non menée à son terme (${échecs} échec(s) d'affilée). ` +
          'La prochaine tentative sera espacée en conséquence.',
      );
    }

    // LE RÉSUMÉ EN UNE PHRASE, CALCULÉ ICI PLUTÔT QUE DANS LE NAVIGATEUR.
    //
    // L'interface fabriquait le sien, et il perdait l'essentiel : « 1 960
    // nouveaux titres téléchargés » sans un mot des quarante qui ont échoué, ni
    // d'une interruption. Après dix-sept heures, l'utilisateur croit tout avoir.
    //
    // La fonction qui dit tout cela existait, écrite et testée — simplement
    // jamais appelée. En la calculant côté moteur, la même phrase sert à
    // l'interface, à la notification du système, à l'historique et au menu de
    // la barre des menus, au lieu d'être réécrite à chaque endroit.
    bilan.phrase = phraseBilan({
      nbFichiers: bilan.nbFichiers,
      erreurs: bilan.lignesErreur,
      interrompu: bilan.interrompu,
      échec: bilan.échec,
    });

    étatModule.enregistrerExécution(bilan);

    // On ne dit « erreur » que s'il y en a une. Le compte des lignes signalées
    // vient APRÈS, entre parenthèses, et seulement s'il diffère : c'est une
    // information de mise au point, pas un motif d'inquiétude. Le journal
    // annonçait « 4 erreur(s) au total » pour quatre paroles introuvables.
    const détail = bilan.nbErreurs > 0
      ? ` (${bilan.nbErreurs} titre(s) perdu(s))`
      : bilan.nbSignalements > 0
        ? ` (${bilan.nbSignalements} ligne(s) signalée(s), aucun titre perdu)`
        : '';
    journal.info(`Synchronisation terminée — ${bilan.phrase}${détail}.`);
    diffuser({ type: 'synchro-fin', bilan });

    return { lancé: true, bilan };
  } catch (erreur) {
    journal.erreur('Erreur inattendue pendant la synchronisation.', erreur.stack || erreur.message);
    bilan.échec = erreur.message;
    étatModule.enregistrerExécution(bilan);
    diffuser({ type: 'synchro-echec', message: erreur.message });
    return { lancé: false, raison: erreur.message };
  } finally {
    // Rendre au Mac son comportement normal, même si tout s'est mal passé :
    // laisser une machine incapable de dormir serait un dégât collatéral.
    laisserDormir();
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
  config: c, playlist, racine, nouveaux, capacités = null,
  signalArrêt = null, surProgrès = () => {},
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

    // « Déjà converti » compte comme converti : depuis que la moisson tourne
    // pendant le téléchargement, c'est même le cas NORMAL — à l'arrivée ici,
    // tout est déjà fait. Les ignorer ferait retomber les listes de lecture sur
    // les .ogg, exactement le défaut que la moisson devait supprimer.
    const réussis = [...bilan.convertis, ...(bilan.déjàPrêts ?? [])];

    résultat.nbConvertis = réussis.length;
    résultat.échecsConversion = bilan.échecs;

    if (bilan.échecs.length) {
      journal.avertir(
        `${bilan.échecs.length} conversion(s) ont échoué. Les fichiers d'origine sont ` +
          'conservés intacts : rien n’est perdu.',
      );
    }

    fichiersFinaux = réussis.map((c2) => c2.destination);
    if (fichiersFinaux.length === 0) fichiersFinaux = nouveaux;

    // Sort des fichiers d'origine. Par défaut on les garde : un Ogg permet de
    // re-dériver n'importe quelle cible plus tard sans retélécharger, ce qui vaut
    // cher quand un rattrapage complet prend 17 heures. On ne touche QUE les
    // sources effectivement converties — jamais un fichier dont la conversion a
    // échoué, sinon un échec ferait perdre le téléchargement.
    // GARDE-FOU DÉCISIF. La reprise incrémentale de zotify repose sur la
    // présence du fichier QU'IL écrirait, c'est-à-dire l'Ogg — pas le FLAC
    // converti. Retirer les Ogg ferait donc retélécharger toute la
    // bibliothèque : 17 heures, et une exposition inutile à la limitation de
    // débit de Spotify. On n'applique la politique que si zotify tient un
    // journal de ce qu'il a déjà téléchargé, indépendant des fichiers présents.
    let politiqueSources = c.retrait?.sourcesAprèsConversion ?? 'conserver';
    // La réponse vient du PILOTE, qui sait ce qu'il passe réellement à zotify.
    // L'ancienne heuristique sur les noms d'options (/previous|already|archive/)
    // était satisfaite par « disable-directory-archives » — l'option passée pour
    // DÉSACTIVER le journal ouvrait le garde-fou censé en dépendre, et le
    // retrait des Ogg aurait déclenché le retéléchargement complet qu'il devait
    // empêcher.
    const journalisePrécédents = saitReprendreSansLeFichier({
      config: c, capacités, dossierJournal: dossierDonnées(),
    });

    if (politiqueSources !== 'conserver' && !journalisePrécédents) {
      résultat.sourcesNonTraitées =
        'Les fichiers d’origine ont été conservés : votre version de zotify repère ' +
        'les morceaux déjà pris en regardant les fichiers présents, pas en tenant un ' +
        'journal. Les retirer ferait tout retélécharger à la prochaine synchronisation.';
      journal.avertir(résultat.sourcesNonTraitées);
      politiqueSources = 'conserver';
    }

    // ON NE RETIRE QUE CE QUE ZOTIFY A INSCRIT DANS SON JOURNAL.
    //
    // Le garde-fou précédent dit que le journal EXISTE ; celui-ci dit que CE
    // morceau-là y figure. Sans lui, activer la politique jetterait aussi les
    // Ogg descendus AVANT que le journal n'existe — et ceux-là seraient
    // retéléchargés, exactement ce que toute cette mécanique cherche à
    // empêcher. Le cas n'est pas théorique : dix-sept titres étaient déjà sur ce
    // disque quand le journal a été créé.
    const inscrits = politiqueSources !== 'conserver'
      ? cheminsDéjàTéléchargés(dossierDonnées())
      : new Set();
    // `cléComparaison` et non le chemin brut : l'ensemble vient d'un journal
    // écrit par Python, ces chemins-ci sortent de `readdirSync`. C'est la seule
    // comparaison du projet qui traverse cette frontière, et elle l'ignorait.
    const retirables = réussis.filter(
      ({ source }) => inscrits.has(cléComparaison(path.resolve(source))),
    );

    if (politiqueSources !== 'conserver' && réussis.length > retirables.length) {
      résultat.sourcesHorsJournal = réussis.length - retirables.length;
      journal.info(
        `${résultat.sourcesHorsJournal} fichier(s) d'origine ont été conservés : ils ont `
        + 'été téléchargés avant la mise en service du journal, et rien ne garantit '
        + 'qu’ils ne seraient pas repris. Les prochains suivront la politique choisie.',
      );
    }

    if (politiqueSources !== 'conserver' && retirables.length) {
      résultat.sourcesTraitées = 0;
      for (const { source } of retirables) {
        try {
          if (politiqueSources === 'archiver') {
            archiver(source, racine);
          } else {
            const misÀLaCorbeille = await mettreÀLaCorbeille(source);
            // Repli non destructif : si la corbeille refuse, on archive.
            if (!misÀLaCorbeille.réussi) archiver(source, racine);
          }
          résultat.sourcesTraitées += 1;
        } catch (erreur) {
          journal.avertir(
            `Le fichier d'origine « ${path.basename(source)} » n'a pas pu être déplacé.`,
            erreur.message,
          );
        }
      }
      if (résultat.sourcesTraitées) {
        journal.info(
          `${résultat.sourcesTraitées} fichier(s) d'origine ${
            politiqueSources === 'archiver' ? 'archivé(s)' : 'mis à la corbeille'
          } après conversion.`,
        );
      }
    }
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
        // Les sources d'origine restent à côté des fichiers convertis : sans ce
        // filtre, la liste compterait deux entrées par morceau, dont une dans un
        // format que le logiciel DJ ne lit pas.
        const extensionCible = PROFILS[c.qualité.format]?.extension;
        résultat.listeLecture = écrireListeLecture({
          destination: path.join(dossier, `${nom}.m3u8`),
          fichiers: sansSourcesConverties(listerAudio(dossier), extensionCible),
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
export function modèleZotify(c = config(), typeSource = 'playlist') {
  // LE TYPE DE LA SOURCE CHANGE LES VARIABLES DISPONIBLES, et l'ignorer
  // reproduirait le bug du genre sous une autre forme. Relevé dans le code
  // source de zotify : « {playlist} » et « {playlist_num} » ne sont substitués
  // QUE lorsque le morceau vient d'une playlist. Pour un album ou un artiste —
  // deux types de source que Zotijean accepte —, ces variables resteraient
  // littérales dans le chemin : tout atterrirait dans un dossier « {playlist} ».
  //
  // Pour un album, l'équivalent naturel existe : le nom de l'album et le numéro
  // de piste dans l'album. Un artiste télécharge sa discographie, donc des
  // albums : même correspondance.
  const horsPlaylist = typeSource === 'album' || typeSource === 'artist';

  const correspondances = {
    '{playlist}': horsPlaylist ? '{album}' : '{playlist}',
    '{numéro}': horsPlaylist ? '{album_num}' : '{playlist_num}',
    '{artiste}': '{artist}',
    '{titre}': '{song_name}',
    '{album}': '{album}',
    '{artiste_album}': '{album_artist}',
    '{piste}': '{track_number}',
    '{disque}': '{disc_number}',
    '{année}': '{release_year}',
    // L'ISRC est substitué sans condition par zotify — vérifié dans sa liste.
    // C'est la variable du « pont sans perte » : l'identifiant international
    // dans le NOM du fichier, sans jamais réécrire son contenu.
    '{isrc}': '{isrc}',
    // PAS DE CORRESPONDANCE POUR LE GENRE, ET CE N'EST PAS UN OUBLI.
    //
    // Relevé dans le code source de zotify : son moteur de nommage substitue
    // une trentaine de variables — titre, artiste, album, année, ISRC, numéro
    // de piste — mais AUCUNE pour le genre. Le genre existe bien dans ses
    // métadonnées, il l'écrit même dans les étiquettes du fichier ; il n'est
    // simplement pas disponible au moment de composer le chemin.
    //
    // Laisser passer « {genre} » ferait atterrir toute la bibliothèque dans un
    // dossier appelé littéralement « {genre} ». Le segment est donc retiré, et
    // l'utilisateur en est informé plutôt que de le découvrir sur son disque.
  };

  let modèle = modèleActif(c.organisation);
  for (const [français, zotify] of Object.entries(correspondances)) {
    modèle = modèle.split(français).join(zotify);
  }
  return retirerVariablesImpossibles(modèle);
}

/** Les variables que Zotijean sait ne pas pouvoir faire honorer par zotify. */
const VARIABLES_SANS_ÉQUIVALENT = {
  '{genre}': 'le classement par genre',
};

/**
 * Retire du modèle ce que zotify ne saura pas remplacer.
 *
 * On enlève la variable ET le séparateur qui l'accompagne : garder « /{artist} »
 * après avoir retiré « {genre} » laisserait un dossier vide en tête de chemin.
 *
 * Renvoie le modèle nettoyé ; la liste des pertes est lisible par
 * `variablesImpossibles()` pour être affichée.
 */
export function retirerVariablesImpossibles(modèle) {
  let sortie = modèle;
  for (const variable of Object.keys(VARIABLES_SANS_ÉQUIVALENT)) {
    if (!sortie.includes(variable)) continue;
    sortie = sortie
      .split(`${variable}/`).join('')   // segment de dossier entier
      .split(`/${variable}`).join('')
      .split(variable).join('')
      .replace(/\/{2,}/g, '/')
      .replace(/^[\s/-]+/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  // Un modèle entièrement vidé donnerait des fichiers sans nom.
  return sortie || '{artist} - {song_name}';
}

/** Ce que le modèle demandé contient d'impossible, en clair. */
export function variablesImpossibles(c = config()) {
  const modèle = modèleActif(c.organisation);
  return Object.entries(VARIABLES_SANS_ÉQUIVALENT)
    .filter(([variable]) => modèle.includes(variable))
    .map(([, libellé]) => libellé);
}

/** Ouvre le dossier de musique dans le Finder ou l'Explorateur. */
export function ouvrirDossierMusique() {
  const dossier = config().général.dossierMusique;
  assurerDossier(dossier);
  ouvrirDansLeSystème(dossier);
}

/** Ouvre un fichier avec l'application que le système lui associe. */
export function ouvrirFichier(chemin) {
  ouvrirDansLeSystème(chemin);
}

function ouvrirDansLeSystème(cible) {
  const commande = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  import('node:child_process').then(({ spawn }) => {
    const processus = spawn(commande, [path.resolve(cible)], {
      detached: true, stdio: 'ignore',
    });
    // Un exécutable absent — xdg-open n'est pas garanti sous Linux — émet
    // « error » de façon ASYNCHRONE. Sans écouteur, cet événement termine le
    // processus Node : le moteur entier s'arrêterait parce qu'on n'a pas pu
    // ouvrir un dossier dans l'explorateur de fichiers.
    processus.on('error', (erreur) => {
      journal.avertir(
        'Cet élément n’a pas pu être ouvert par le système.',
        erreur.message,
      );
    });
    processus.unref();
  });
}

/**
 * Une veille du disque, à relire PENDANT le téléchargement.
 *
 * POURQUOI ELLE EXISTE. Les trois garde-fous du disque étaient bien dans la
 * boucle des playlists — mais AVANT l'appel à zotify, et jamais ensuite. Avec
 * les chiffres du projet, deux mille titres à trente secondes tiennent dans une
 * seule playlist : le contrôle était donc fait une fois, à H+0, pour seize
 * heures et quarante minutes de travail.
 *
 * Le commentaire du code promettait pourtant une relecture « au fil de
 * l'exécution ». Elle existait, à la granularité de la playlist — ce qui, pour
 * une bibliothèque rangée en une seule liste, revient à ne pas exister.
 *
 * Le scénario que ça laissait passer est celui que CLAUDE.md nomme comme cause
 * numéro un : disque externe débranché à H+3, macOS recrée un dossier VIDE au
 * même endroit sous /Volumes/, et treize heures de musique partent sur le
 * disque de démarrage sans un mot.
 *
 * Limitée dans le temps : ce contrôle est appelé à chaque ligne de zotify,
 * c'est-à-dire plusieurs fois par seconde. Un `statfs` par ligne serait une
 * charge inutile pour un état qui bouge à l'échelle de la minute.
 *
 * Rend `null` tant que tout va bien, sinon la phrase à afficher.
 */
/**
 * À quelle cadence relire l'état du disque pendant un téléchargement.
 *
 * Nommée, comme `BATTEMENT_MS` du planificateur et `SILENCE_MAXIMAL_MS` du
 * pilote : ce sont les trois cadences du projet, et une cadence écrite en clair
 * au milieu d'une signature ne se retrouve pas.
 */
const INTERVALLE_VEILLE_MS = 5 * 60 * 1000;

export function créerVeilleDuDisque({
  intervalleMs = INTERVALLE_VEILLE_MS,
  maintenant = () => Date.now(),
  monté = volumeMonté,
  libre = espaceLibre,
} = {}) {
  // UNE SEULE VEILLE POUR TOUTE L'EXÉCUTION, et la racine se donne à l'appel.
  //
  // Une première version se construisait DANS la boucle des playlists, et
  // repartait donc de zéro à chaque tour. Pour vingt playlists de trois minutes,
  // elle ne se serait jamais déclenchée : le trou était refermé pour le cas
  // « une grosse playlist » et rouvert pour le cas « beaucoup de petites ».
  // Rattrapé en revue le 21 août 2026.
  let dernierContrôle = maintenant();

  return function veiller({ racine, minimumOctets }) {
    const t = maintenant();

    // GARDE CONTRE LE RECUL D'HORLOGE. C'est une règle du projet, et elle vaut
    // ici comme pour la planification : une correction d'horloge au réveil du
    // Mac peut faire reculer l'heure de plusieurs minutes. Sans cette ligne, la
    // veille resterait muette pendant tout ce temps — dans une fenêtre de seize
    // heures où elle est le seul filet.
    if (t < dernierContrôle) dernierContrôle = t;

    if (t - dernierContrôle < intervalleMs) return null;
    dernierContrôle = t;

    if (!monté(racine)) {
      return 'le disque de destination a été débranché pendant le téléchargement. '
        + 'Rebranchez-le : la synchronisation reprendra où elle en est.';
    }

    const place = libre(racine);
    // `null` veut dire « inconnu », pas « zéro » : on ne bloque pas sur une
    // mesure qu'on n'a pas pu prendre.
    if (place !== null && place < minimumOctets) {
      return `il ne reste que ${(place / 1024 ** 3).toFixed(1)} Go sur le disque de `
        + `destination, sous le seuil de ${(minimumOctets / 1024 ** 3).toFixed(0)} Go que `
        + 'vous avez fixé. Faites de la place : la synchronisation reprendra où elle en est.';
    }

    return null;
  };
}
