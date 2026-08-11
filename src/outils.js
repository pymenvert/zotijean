// Outils embarqués : Node, Python, ffmpeg et zotify livrés dans le paquet.
//
// POURQUOI. Pour qu'un double-clic suffise, l'application ne peut rien exiger de
// la machine. Tout ce dont elle a besoin voyage avec elle, dans
// Zotijean.app/Contents/Resources/outils/.
//
// Le cas particulier, c'est zotify : un programme Python ne s'exécute pas
// depuis un dossier de roues. Il faut monter un environnement une fois. On le
// fait au premier lancement, HORS LIGNE, à partir des roues embarquées — sans
// réseau, sans git, et sans les outils de développement d'Apple, dont
// l'installation ouvre une fenêtre système que personne ne comprend.
//
// Quand rien n'est embarqué (exécution depuis le dépôt, ou paquet incomplet),
// chaque fonction rend la main proprement et l'app retombe sur les outils du
// système. C'est ce qui permet de développer sans construire un paquet.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { exécuter } from './processus.js';
import { journal } from './journal.js';
import {
  dossierDonnées, dossierOutils, assurerDossier, écrireAtomique, lireJSON,
} from './chemins.js';

export { dossierOutils };

/** Chemin d'un exécutable embarqué, ou null s'il n'y en a pas. */
export function outilEmbarqué(nom) {
  const racine = dossierOutils();
  if (!racine) return null;

  const emplacements = {
    node: ['node/node'],
    python3: ['python/bin/python3'],
    ffmpeg: ['ffmpeg/ffmpeg'],
    ffprobe: ['ffmpeg/ffprobe'],
  };

  for (const relatif of emplacements[nom] || []) {
    const complet = path.join(racine, relatif);
    try {
      fs.accessSync(complet, fs.constants.X_OK);
      return complet;
    } catch {
      // Pas exécutable ou absent : on essaie le suivant.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Environnement zotify
// ---------------------------------------------------------------------------

const dossierVenv = () => path.join(dossierDonnées(), 'outils', 'venv');
const fichierManifeste = () => path.join(dossierDonnées(), 'outils', 'manifeste.json');

/** L'exécutable zotify de l'environnement monté, s'il existe. */
export function zotifyEmbarqué() {
  const candidat = path.join(dossierVenv(), 'bin', 'zotify');
  try {
    fs.accessSync(candidat, fs.constants.X_OK);
    return candidat;
  } catch {
    return null;
  }
}

/** Empreinte des roues embarquées : elle change quand on livre une autre version. */
function empreinteRoues(dossierRoues) {
  try {
    return fs.readdirSync(dossierRoues).sort().join('|');
  } catch {
    return null;
  }
}

/**
 * Monte l'environnement zotify si nécessaire.
 *
 * Idempotent : un manifeste enregistre l'empreinte des roues installées, donc
 * un lancement normal ne fait rien. L'installation ne se refait que si le
 * paquet a été mis à jour.
 *
 * Ne lève jamais : un échec renvoie un message en français, et l'app retombe
 * sur le zotify du système s'il existe.
 */
export async function assurerZotify({ surProgrès = () => {} } = {}) {
  const racine = dossierOutils();
  const python = outilEmbarqué('python3');
  const roues = racine ? path.join(racine, 'roues') : null;

  if (!racine || !python || !roues || !fs.existsSync(roues)) {
    return { prêt: false, raison: 'aucun outil embarqué', chemin: null };
  }

  const empreinte = empreinteRoues(roues);
  const manifeste = lireJSON(fichierManifeste(), null);
  const déjàMonté = zotifyEmbarqué();

  if (déjàMonté && manifeste?.empreinte === empreinte) {
    return { prêt: true, chemin: déjàMonté, déjàInstallé: true };
  }

  journal.info('Préparation de zotify — cette étape n’a lieu qu’une fois.');
  surProgrès({ étape: 'venv', message: 'Préparation de l’environnement…' });

  assurerDossier(path.dirname(dossierVenv()));

  // Un environnement à moitié monté vaut pire que pas d'environnement : on
  // repart de zéro plutôt que de réparer.
  fs.rmSync(dossierVenv(), { recursive: true, force: true });

  const création = await exécuter(python, ['-m', 'venv', dossierVenv()], { délaiMs: 120000 });
  if (création.code !== 0) {
    const détail = (création.stderr || '').trim().split('\n').pop();
    journal.erreur('Création de l’environnement Python impossible.', détail);
    return {
      prêt: false,
      chemin: null,
      raison:
        'L’environnement de téléchargement n’a pas pu être préparé. ' +
        'Consultez le journal, onglet Diagnostic.',
    };
  }

  surProgrès({ étape: 'installation', message: 'Installation de zotify…' });

  const pip = path.join(dossierVenv(), 'bin', 'pip');
  // « --no-index » interdit tout accès réseau : l'installation se fait
  // uniquement depuis les roues du paquet, donc elle marche hors ligne et ne
  // peut pas casser parce qu'un dépôt distant a changé.
  const installation = await exécuter(
    pip,
    ['install', '--no-index', '--find-links', roues, '--quiet', 'zotify'],
    { délaiMs: 300000 },
  );

  if (installation.code !== 0 || !zotifyEmbarqué()) {
    const détail = (installation.stderr || '').trim().split('\n').slice(-3).join(' ');
    journal.erreur('Installation de zotify impossible.', détail);
    return {
      prêt: false,
      chemin: null,
      raison:
        'zotify n’a pas pu être installé depuis les fichiers du paquet. ' +
        'Si vous avez déjà zotify sur cette machine, Zotijean va l’utiliser.',
    };
  }

  écrireAtomique(fichierManifeste(), JSON.stringify({
    empreinte,
    date: new Date().toISOString(),
    python: python.replace(os.homedir(), '~'),
  }, null, 2));

  journal.info('zotify est prêt.');
  return { prêt: true, chemin: zotifyEmbarqué(), déjàInstallé: false };
}

/** Résumé pour le panneau Diagnostic. */
export function étatOutils() {
  const racine = dossierOutils();
  return {
    embarqués: !!racine,
    dossier: racine,
    node: outilEmbarqué('node'),
    python: outilEmbarqué('python3'),
    ffmpeg: outilEmbarqué('ffmpeg'),
    zotify: zotifyEmbarqué(),
  };
}
