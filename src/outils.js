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
/**
 * Montage en cours, partagé par tous les appelants.
 *
 * POURQUOI C'EST INDISPENSABLE, ET PRÉCISÉMENT AU PREMIER LANCEMENT.
 *
 * Le montage commence par EFFACER l'environnement pour repartir de zéro. Or
 * cinq endroits déclenchent un diagnostic, et le diagnostic appelle ce montage.
 * Au tout premier démarrage, deux d'entre eux partent presque en même temps :
 * le moteur diagnostique au lancement, et l'interface qui vient de s'ouvrir en
 * demande un aussitôt.
 *
 * Sans garde, les deux constatent qu'il n'y a rien, les deux effacent, les deux
 * installent — l'un dans le dossier que l'autre est en train de supprimer.
 * L'installation échoue ou reste à moitié faite, sur la seule opération qui
 * DOIT réussir pour que l'application serve à quelque chose.
 *
 * Les appelants suivants reçoivent donc la promesse du premier plutôt que d'en
 * lancer une seconde.
 */
let montageEnCours = null;

export async function assurerZotify(options = {}) {
  if (montageEnCours) return montageEnCours;

  montageEnCours = monterZotify(options).finally(() => {
    montageEnCours = null;
  });
  return montageEnCours;
}

async function monterZotify({ surProgrès = () => {} } = {}) {
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

  // INSTALLATION PAR NOM DE FICHIER, SANS RÉSOLUTION DE DÉPENDANCES.
  //
  // Demander « installe zotify » ne marche pas hors ligne : son paquet déclare
  // sa dépendance à librespot par une URL git directe plutôt que par un numéro
  // de version. pip IGNORE alors la roue de librespot pourtant présente,
  // re-clone le dépôt et veut le compiler — ce qui exige un réseau et une
  // chaîne de compilation, exactement ce qu'un paquet autonome doit éviter.
  //
  // On installe donc les roues telles quelles. C'est sûr parce que la
  // résolution a déjà été faite au moment de la construction, par `pip wheel` :
  // le dossier contient l'ensemble complet et cohérent des dépendances.
  const fichiersRoues = fs.readdirSync(roues)
    .filter((f) => f.endsWith('.whl'))
    .map((f) => path.join(roues, f));

  if (fichiersRoues.length === 0) {
    return { prêt: false, chemin: null, raison: 'Le paquet ne contient aucune roue installable.' };
  }

  const installation = await exécuter(
    pip,
    ['install', '--no-index', '--no-deps', '--quiet', ...fichiersRoues],
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
