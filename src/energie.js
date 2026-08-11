// Lecture de l'alimentation et du type de connexion réseau.
//
// Deux réglages en dépendent : « seulement branché sur secteur » et « seulement
// en Wi-Fi ou Ethernet ». Sans ce module, ils étaient deux interrupteurs morts —
// le planificateur recevait « secteur : oui, réseau : oui » en dur, et les
// branches correspondantes étaient inatteignables.
//
// Node n'expose rien de tout cela : il faut interroger le système. On le fait
// donc avec les outils de macOS, et on l'annonce franchement ailleurs.

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
