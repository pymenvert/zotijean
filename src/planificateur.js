// Planificateur.
//
// POURQUOI PAS UN SIMPLE MINUTEUR DE 48 HEURES.
//
// Un minuteur JavaScript, comme un minuteur système, compte le temps pendant
// lequel la machine est éveillée. Quand le Mac dort, il se fige. Après dix
// nuits, un minuteur réglé sur « 48 h » se déclenche à 58 h — et personne ne
// comprend pourquoi la synchronisation dérive.
//
// La seule approche qui survit à la veille : une HORLOGE MURALE. On enregistre
// la date du dernier succès, et toutes les cinq minutes on compare des dates
// absolues. Peu importe que la machine ait dormi entre les deux : au réveil, la
// comparaison donne le bon résultat immédiatement.
//
// Corollaire à assumer dans l'interface : l'heure exacte n'est jamais garantie.
// On affiche « environ demain vers 9 h — ou au réveil du Mac », jamais un compte
// à rebours.

import { dernierSuccèsSain, état } from './etat.js';
import { journal } from './journal.js';

const BATTEMENT_MS = 5 * 60 * 1000;

/**
 * Espacement croissant après des échecs enchaînés, en minutes.
 *
 * Une exécution qui échoue n'avance pas la date de référence : sans ce recul,
 * le battement de cœur relancerait donc une synchronisation toutes les cinq
 * minutes. Face à une panne durable — disque débranché, compte suspendu,
 * limitation de débit — c'est exactement le comportement à éviter : on
 * aggraverait le problème auprès de Spotify tout en noyant le journal.
 *
 * Le dernier palier plafonne : au-delà, l'intervalle normal reprend la main.
 */
const RECULS_MINUTES = [5, 15, 60, 240];

export function reculAprèsÉchecs(nombre) {
  if (!nombre || nombre < 1) return 0;
  const index = Math.min(nombre, RECULS_MINUTES.length) - 1;
  return RECULS_MINUTES[index] * 60 * 1000;
}

/** Convertit « 23:00 » en minutes depuis minuit. */
function enMinutes(heure) {
  const [h, m] = String(heure || '0:0').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Les heures calmes peuvent traverser minuit (23:00 → 08:00), auquel cas
 * l'intervalle est l'union de deux plages. Un test naïf `début <= t < fin`
 * renverrait toujours faux dans ce cas, et l'option n'aurait aucun effet.
 */
export function dansLesHeuresCalmes(config, maintenant = new Date()) {
  const calmes = config.planification.heuresCalmes;
  if (!calmes?.actif) return false;

  const début = enMinutes(calmes.début);
  const fin = enMinutes(calmes.fin);
  const t = maintenant.getHours() * 60 + maintenant.getMinutes();

  if (début === fin) return false;
  return début < fin ? t >= début && t < fin : t >= début || t < fin;
}

/** Date à laquelle la prochaine vérification devient possible. */
export function prochaineÉchéance(config, dernier = dernierSuccèsSain()) {
  if (!dernier) return new Date();
  return new Date(dernier.getTime() + config.planification.intervalleHeures * 3600 * 1000);
}

/**
 * Décide s'il faut lancer une synchronisation maintenant.
 *
 * Renvoie toujours une raison lisible : c'est ce qui s'affiche dans le panneau
 * (« En attente du Wi-Fi », « Prochaine vérification demain vers 9 h »). Un
 * planificateur qui ne fait rien sans dire pourquoi est indébogable pour
 * l'utilisateur.
 */
export function évaluer(config, contexte = {}, maintenant = new Date()) {
  const { enCours = false, réseauDisponible = true, surSecteur = true } = contexte;

  if (enCours) {
    return { lancer: false, raison: 'Une synchronisation est déjà en cours.', code: 'en_cours' };
  }

  if (!config.planification.actif) {
    return {
      lancer: false,
      raison: 'La synchronisation automatique est désactivée.',
      code: 'desactive',
    };
  }

  const actives = (config.playlists || []).filter((p) => p.actif);
  if (actives.length === 0) {
    return {
      lancer: false,
      raison: 'Aucune playlist à surveiller pour le moment.',
      code: 'aucune_playlist',
    };
  }

  const dernier = dernierSuccèsSain();
  const échéance = prochaineÉchéance(config, dernier);

  if (dernier && maintenant < échéance) {
    return {
      lancer: false,
      raison: `Prochaine vérification ${formaterÉchéance(échéance)}.`,
      code: 'pas_encore',
      échéance: échéance.toISOString(),
    };
  }

  // Recul après échecs. Une exécution ratée n'avance pas la date de référence,
  // donc sans ce garde la suivante partirait au battement suivant, soit cinq
  // minutes plus tard, indéfiniment.
  const échecs = état().échecsConsécutifs || 0;
  if (échecs > 0) {
    const dernièreTentative = état().dernièreTentative
      ? new Date(état().dernièreTentative)
      : null;
    const recul = reculAprèsÉchecs(échecs);

    if (dernièreTentative && maintenant.getTime() - dernièreTentative.getTime() < recul) {
      const reprise = new Date(dernièreTentative.getTime() + recul);
      return {
        lancer: false,
        code: 'recul_apres_echec',
        raison:
          `${échecs} tentative${échecs > 1 ? 's' : ''} sans succès. ` +
          `Nouvel essai ${formaterÉchéance(reprise, maintenant)}.`,
        échéance: reprise.toISOString(),
      };
    }
  }

  // Les garde-fous suivants REPORTENT sans consommer l'échéance : dès que la
  // condition redevient vraie, la synchronisation part immédiatement.
  if (dansLesHeuresCalmes(config, maintenant)) {
    const calmes = config.planification.heuresCalmes;
    return {
      lancer: false,
      raison: `En pause jusqu'à ${calmes.fin} (heures calmes).`,
      code: 'heures_calmes',
    };
  }

  if (config.planification.uniquementEnWifi && !réseauDisponible) {
    return {
      lancer: false,
      raison: 'En attente d’une connexion Wi-Fi ou Ethernet.',
      code: 'reseau',
    };
  }

  if (config.planification.uniquementSurSecteur && !surSecteur) {
    return {
      lancer: false,
      raison: 'En attente que le Mac soit branché sur secteur.',
      code: 'batterie',
    };
  }

  return {
    lancer: true,
    raison: dernier
      ? `Dernière vérification il y a ${duréeEnFrançais(maintenant - dernier)}.`
      : 'Première synchronisation.',
    code: 'pret',
  };
}

/** « il y a 3 heures », « il y a 2 jours » — jamais un nombre de secondes brut. */
export function duréeEnFrançais(millisecondes) {
  // Troncature et non arrondi : avec `Math.round`, 30 secondes deviendraient
  // « 1 minute », ce qui laisse croire à une précision qu'on n'a pas.
  const minutes = Math.floor(Math.abs(millisecondes) / 60000);
  if (minutes < 1) return 'moins d’une minute';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''}`;

  const heures = Math.round(minutes / 60);
  if (heures < 24) return `${heures} heure${heures > 1 ? 's' : ''}`;

  const jours = Math.round(heures / 24);
  return `${jours} jour${jours > 1 ? 's' : ''}`;
}

/**
 * Formule volontairement approximative : « demain vers 9 h ».
 * Promettre une heure précise serait mentir, puisqu'une machine endormie ne se
 * réveille pas pour respecter un rendez-vous.
 */
export function formaterÉchéance(date, maintenant = new Date()) {
  const heure = `${date.getHours()} h${date.getMinutes() >= 30 ? ' 30' : ''}`;
  const joursÉcart = Math.floor(
    (new Date(date).setHours(0, 0, 0, 0) - new Date(maintenant).setHours(0, 0, 0, 0)) / 86400000,
  );

  if (joursÉcart <= 0) return `aujourd’hui vers ${heure}`;
  if (joursÉcart === 1) return `demain vers ${heure}`;
  if (joursÉcart < 7) {
    const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    return `${jours[date.getDay()]} vers ${heure}`;
  }
  return `le ${date.toLocaleDateString('fr-FR')} vers ${heure}`;
}

/**
 * Démarre le battement de cœur.
 * `lancerSynchronisation` n'est appelé que si l'évaluation le permet ; il doit
 * lui-même être idempotent (le verrou d'exécution s'en charge).
 */
export function démarrer({ obtenirConfig, obtenirContexte, lancerSynchronisation, surÉtat }) {
  let dernièreÉvaluation = null;

  const battre = async () => {
    try {
      const décision = évaluer(obtenirConfig(), obtenirContexte());

      // On ne journalise que les changements, sinon le journal se remplit d'une
      // ligne identique toutes les cinq minutes.
      if (décision.code !== dernièreÉvaluation?.code) {
        journal.debug(`Planificateur : ${décision.raison}`);
        dernièreÉvaluation = décision;
      }

      surÉtat?.(décision);
      if (décision.lancer) await lancerSynchronisation('planifiée');
    } catch (erreur) {
      journal.erreur('Le planificateur a rencontré une erreur.', erreur.message);
    }
  };

  const minuterie = setInterval(battre, BATTEMENT_MS);
  minuterie.unref?.(); // ne doit jamais empêcher le processus de se terminer

  // Un battement immédiat au démarrage rattrape l'échéance manquée pendant que
  // la machine était éteinte.
  battre();

  return {
    arrêter: () => clearInterval(minuterie),
    battreMaintenant: battre,
    dernièreÉvaluation: () => dernièreÉvaluation,
  };
}
