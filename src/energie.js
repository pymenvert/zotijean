// Lecture de l'alimentation et du type de connexion réseau.
//
// Deux réglages en dépendent : « seulement branché sur secteur » et « seulement
// en Wi-Fi ou Ethernet ». Sans ce module, ils étaient deux interrupteurs morts —
// le planificateur recevait « secteur : oui, réseau : oui » en dur, et les
// branches correspondantes étaient inatteignables.
//
// Node n'expose rien de tout cela : il faut interroger le système. On le fait
// donc avec les outils de macOS, et on l'annonce franchement ailleurs.

import { spawn } from 'node:child_process';

import { exécuter } from './processus.js';
import { journal } from './journal.js';

// Interroger le système à chaque battement de cœur serait gratuit en pratique,
// mais lancer deux sous-processus toutes les cinq minutes pour rien reste
// inélégant. Une minute de mémoire suffit largement à l'usage.
const DURÉE_CACHE_MS = 60_000;

let cache = null;
let dateCache = 0;

/** Ce qu'on renvoie quand on ne sait pas : tout est permis, et on le dit. */
const INCONNU = {
  surSecteur: true,
  réseauDisponible: true,
  connu: false,
  détail: null,
};

/**
 * Sur secteur ou sur batterie ?
 *
 * `pmset -g batt` écrit « Now drawing from 'AC Power' » ou « 'Battery Power' ».
 * C'est la formulation stable depuis des années, et elle est localisée en
 * anglais quelle que soit la langue du système.
 */
async function lireAlimentation() {
  const résultat = await exécuter('pmset', ['-g', 'batt'], { délaiMs: 5000 });
  if (résultat.code !== 0) return null;

  const sortie = résultat.stdout || '';
  if (/AC Power/i.test(sortie)) return true;
  if (/Battery Power/i.test(sortie)) return false;
  return null;
}

/**
 * La route par défaut passe-t-elle par une interface acceptable ?
 *
 * `route -n get default` indique l'interface utilisée. Sur un Mac :
 *   en0, en1…  Wi-Fi ou Ethernet — ce qu'on veut
 *   bridge…    partage de connexion depuis un iPhone en USB
 *   pdp_ip…    données cellulaires
 *   utun…      tunnel : on ne peut rien conclure, on laisse passer
 */
async function lireInterfaceRéseau() {
  const résultat = await exécuter('route', ['-n', 'get', 'default'], { délaiMs: 5000 });
  if (résultat.code !== 0) return null;

  const correspondance = (résultat.stdout || '').match(/interface:\s*(\S+)/i);
  if (!correspondance) return null;

  const interface_ = correspondance[1];
  const facturé = /^(pdp_ip|bridge)/i.test(interface_);
  return { interface: interface_, réseauDisponible: !facturé };
}

/**
 * Le contexte à passer au planificateur.
 *
 * Ne lève jamais : si quoi que ce soit échoue, on renvoie « tout est permis »
 * plutôt que de bloquer une synchronisation sur une lecture système ratée. Un
 * réglage qu'on ne sait pas évaluer ne doit pas empêcher l'app de fonctionner.
 */
export async function lireContextePlateforme() {
  if (cache && Date.now() - dateCache < DURÉE_CACHE_MS) return cache;

  if (process.platform !== 'darwin') {
    cache = {
      ...INCONNU,
      détail:
        'L’état du secteur et du type de connexion n’est lisible que sur macOS. ' +
        'Ces conditions sont donc considérées comme remplies ici.',
    };
    dateCache = Date.now();
    return cache;
  }

  try {
    const [alimentation, réseau] = await Promise.all([
      lireAlimentation(),
      lireInterfaceRéseau(),
    ]);

    cache = {
      surSecteur: alimentation ?? true,
      réseauDisponible: réseau?.réseauDisponible ?? true,
      connu: alimentation !== null || réseau !== null,
      détail: [
        alimentation === null ? null : alimentation ? 'sur secteur' : 'sur batterie',
        réseau?.interface ? `réseau via ${réseau.interface}` : null,
      ].filter(Boolean).join(', ') || null,
    };
  } catch (erreur) {
    journal.debug('Lecture de l’alimentation impossible.', erreur.message);
    cache = { ...INCONNU };
  }

  dateCache = Date.now();
  return cache;
}

/** Force la relecture. Utile après un changement de réglage, et en test. */
export function oublierCache() {
  cache = null;
  dateCache = 0;
}

/**
 * Empêche le Mac de s'endormir par inactivité, le temps d'une synchronisation.
 *
 * CE QUE ÇA CHANGE. L'interface annonce « environ 17 heures pour 2 000 titres »
 * et l'utilisateur en conclut, raisonnablement, qu'il suffit de laisser tourner.
 * Or un Mac inactif s'endort au bout de quelques minutes : Node et zotify sont
 * gelés, la connexion Spotify de zotify meurt, et au réveil le chien de garde a
 * toutes les chances de prendre le silence de la nuit pour un blocage. Les
 * dix-sept heures annoncées s'étalaient en réalité sur des jours, avec une
 * interruption et une reprise partielle à chaque cycle de veille.
 *
 * CE QUE ÇA NE CHANGE PAS, et il faut le dire à l'utilisateur plutôt que de le
 * masquer : « -i » ne bloque que la veille d'INACTIVITÉ. Fermer le couvercle
 * endort le Mac de toute façon.
 *
 * Le « -w » de sécurité fait mourir caffeinate avec le moteur : même si l'app
 * plante sans relâcher, le Mac retrouve son comportement normal.
 *
 * Renvoie une fonction à appeler pour relâcher. Toujours sûre : hors macOS, ou
 * si caffeinate manque, elle ne fait rien et ne lève pas.
 */
export function empêcherLaVeille() {
  if (process.platform !== 'darwin') return () => {};

  let processus;
  try {
    processus = spawn('caffeinate', ['-i', '-w', String(process.pid)], {
      stdio: 'ignore',
      detached: false,
    });
  } catch {
    journal.debug('caffeinate est introuvable : la veille ne sera pas retenue.');
    return () => {};
  }

  // Un caffeinate absent ne doit pas faire tomber une synchronisation de
  // dix-sept heures pour autant.
  processus.on('error', () => {
    journal.avertir(
      'Impossible d’empêcher la veille du Mac. Si l’écran s’éteint, la ' +
        'synchronisation sera suspendue jusqu’au réveil.',
    );
  });

  journal.info('La mise en veille par inactivité est suspendue pendant la synchronisation.');

  let relâché = false;
  return () => {
    if (relâché) return;
    relâché = true;
    try {
      processus.kill();
    } catch {
      // Déjà mort : c'est le résultat recherché.
    }
  };
}

/**
 * Les conditions posées par l'utilisateur sont-elles TOUJOURS remplies ?
 *
 * POURQUOI CE N'EST PAS LA MÊME CHOSE QUE LA DÉCISION DE DÉMARRER. Le
 * planificateur vérifie « sur secteur » et « en Wi-Fi » au moment de LANCER.
 * Une fois parti, plus rien ne les relisait — alors qu'un rattrapage dure
 * dix-sept heures.
 *
 * Le scénario coûte cher, et il est banal : on lance la synchronisation chez soi,
 * branché en Wi-Fi ; trois heures plus tard on débranche, on ferme son sac, et
 * on partage la connexion de son téléphone dans le train. Le moteur continue
 * quatorze heures sur batterie et sur données cellulaires. Deux mille titres à
 * huit mégaoctets, c'est une quinzaine de gigaoctets en itinérance. La case
 * était cochée ; elle n'a protégé que la première seconde.
 *
 * Renvoie null si tout va bien, sinon la phrase à afficher et à journaliser.
 */
export async function conditionToujoursRemplie(config) {
  const planification = config?.planification || {};
  if (!planification.uniquementSurSecteur && !planification.uniquementEnWifi) return null;

  // Le cache dure quelques minutes : sans cet oubli, on relirait indéfiniment
  // l'état d'avant le débranchement.
  oublierCache();
  const contexte = await lireContextePlateforme();

  // Un état qu'on ne sait pas lire ne doit jamais interrompre une exécution en
  // cours : on ne punit pas l'utilisateur pour une commande système muette.
  if (!contexte.connu) return null;

  if (planification.uniquementEnWifi && !contexte.réseauDisponible) {
    return (
      'Passage sur une connexion facturée détecté. La synchronisation est mise ' +
      'en pause pour ne pas consommer vos données mobiles ; elle reprendra ' +
      'd’elle-même sur le Wi-Fi.'
    );
  }

  if (planification.uniquementSurSecteur && !contexte.surSecteur) {
    return (
      'Passage sur batterie détecté. La synchronisation est mise en pause pour ' +
      'ne pas vider le Mac ; elle reprendra d’elle-même une fois rebranché.'
    );
  }

  return null;
}
