// Diagnostic de l'installation.
//
// POURQUOI CE MODULE EXISTE.
//
// Toute la documentation de zotify qu'on trouve en ligne décrit `zotify-dev/zotify`,
// abandonné depuis septembre 2024. Le fork vivant est `Googolplexed0/zotify`, et
// ses options ne sont pas exactement les mêmes. Plutôt que de deviner quelle
// version est installée et de construire une ligne de commande qui échouera à
// l'exécution, on interroge l'installation réelle : sa version, et surtout les
// options que son `--help` déclare réellement supporter.
//
// Ce module remplace l'après-midi de commandes à copier-coller dans le Terminal
// que la phase de recherche avait identifiée comme préalable indispensable.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { trouverExécutable, exécuter } from './processus.js';
import { volumeMonté, espaceLibre } from './chemins.js';
import { journal } from './journal.js';

export const GRAVITÉ = {
  OK: 'ok',
  AVERTISSEMENT: 'avertissement',
  BLOQUANT: 'bloquant',
};

const Go = 1024 ** 3;

function contrôle(id, titre, gravité, message, extras = {}) {
  return { id, titre, gravité, message, ...extras };
}

// ---------------------------------------------------------------------------
// zotify
// ---------------------------------------------------------------------------

/**
 * Extrait les options longues (`--quelque-chose`) déclarées par un texte d'aide.
 * On ne cherche pas à comprendre la sémantique : on veut seulement savoir si une
 * option existe avant de la passer, pour ne pas faire échouer un téléchargement
 * sur une option inconnue.
 */
export function optionsDéclarées(texteAide) {
  const trouvées = new Set();
  for (const correspondance of String(texteAide).matchAll(/--([a-z][a-z0-9-]*)/gi)) {
    trouvées.add(correspondance[1].toLowerCase());
  }
  return trouvées;
}

/** Extrait un numéro de version d'une sortie du type « Zotify 0.17.4 ». */
export function extraireVersion(texte) {
  const correspondance = String(texte).match(/(\d+\.\d+(?:\.\d+)?)/);
  return correspondance ? correspondance[1] : null;
}

async function contrôlerZotify(commandeConfigurée) {
  const candidats = [];
  if (commandeConfigurée && commandeConfigurée !== 'zotify') {
    candidats.push(commandeConfigurée);
  }
  const trouvé = trouverExécutable('zotify');
  if (trouvé) candidats.push(trouvé);
  candidats.push('zotify');

  for (const candidat of candidats) {
    const version = await exécuter(candidat, ['--version'], { délaiMs: 20000 });
    const sortie = `${version.stdout}${version.stderr}`;

    if (version.erreur || version.expiré) continue;

    const aide = await exécuter(candidat, ['--help'], { délaiMs: 20000 });
    const texteAide = `${aide.stdout}${aide.stderr}`;
    const options = optionsDéclarées(texteAide);

    // Un `--help` qui ne mentionne aucune option connue signale qu'on a trouvé
    // un autre programme du même nom.
    const plausible = options.has('help') || options.size > 3;
    if (!plausible) continue;

    return contrôle(
      'zotify',
      'zotify',
      GRAVITÉ.OK,
      `Trouvé${extraireVersion(sortie) ? ` en version ${extraireVersion(sortie)}` : ''}.`,
      {
        chemin: candidat,
        version: extraireVersion(sortie),
        options: [...options].sort(),
        aide: texteAide.slice(0, 20000),
      },
    );
  }

  return contrôle(
    'zotify',
    'zotify',
    GRAVITÉ.BLOQUANT,
    "zotify est introuvable. L'app ne télécharge rien elle-même : elle pilote " +
      "votre installation existante. Vérifiez qu'elle fonctionne en tapant " +
      '« zotify --version » dans le Terminal, puis indiquez son chemin dans les réglages.',
    { chemin: null, version: null, options: [] },
  );
}

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

async function contrôlerFfmpeg() {
  const chemin = trouverExécutable('ffmpeg');

  if (!chemin) {
    return contrôle(
      'ffmpeg',
      'ffmpeg',
      GRAVITÉ.BLOQUANT,
      "ffmpeg est introuvable. C'est plus grave qu'il n'y paraît : sans lui, zotify " +
        'renomme le fichier téléchargé avant de constater son absence, et ne le ' +
        'restaure jamais. Des morceaux sont détruits sans message d’erreur. ' +
        'Installez-le avec « brew install ffmpeg » avant toute synchronisation.',
      { chemin: null },
    );
  }

  const résultat = await exécuter(chemin, ['-version'], { délaiMs: 15000 });
  const version = extraireVersion(résultat.stdout.split('\n')[0] || '');

  return contrôle(
    'ffmpeg',
    'ffmpeg',
    GRAVITÉ.OK,
    `Trouvé${version ? ` en version ${version}` : ''}.`,
    { chemin, version },
  );
}

// ---------------------------------------------------------------------------
// Identifiants Spotify (gérés par zotify, pas par nous)
// ---------------------------------------------------------------------------

function cheminsIdentifiants() {
  const maison = os.homedir();
  const noms = ['credentials.json'];
  const dossiers = process.platform === 'darwin'
    ? [
        path.join(maison, 'Library', 'Application Support', 'Zotify'),
        path.join(maison, '.config', 'zotify'),
        path.join(maison, '.local', 'share', 'zotify'),
      ]
    : [
        path.join(process.env.APPDATA || maison, 'Zotify'),
        path.join(maison, '.config', 'zotify'),
      ];

  const trouvés = [];
  for (const dossier of dossiers) {
    for (const nom of noms) {
      const candidat = path.join(dossier, nom);
      if (fs.existsSync(candidat)) trouvés.push(candidat);
    }
  }
  return trouvés;
}

function contrôlerIdentifiants() {
  const trouvés = cheminsIdentifiants();

  if (trouvés.length === 0) {
    return contrôle(
      'identifiants',
      'Connexion Spotify',
      GRAVITÉ.AVERTISSEMENT,
      "Aucun fichier d'identifiants zotify n'a été trouvé aux emplacements habituels. " +
        "Ce n'est pas forcément un problème : votre version de zotify peut les stocker " +
        'ailleurs. Si la première synchronisation échoue sur une erreur de connexion, ' +
        'lancez zotify une fois dans le Terminal pour vous authentifier.',
      { chemins: [] },
    );
  }

  return contrôle(
    'identifiants',
    'Connexion Spotify',
    GRAVITÉ.OK,
    'Des identifiants zotify existent : vous êtes déjà authentifié.',
    { chemins: trouvés },
  );
}

// ---------------------------------------------------------------------------
// Dossier de destination
// ---------------------------------------------------------------------------

function contrôlerDestination(dossierMusique, gardes) {
  if (!volumeMonté(dossierMusique)) {
    return contrôle(
      'destination',
      'Dossier de musique',
      GRAVITÉ.BLOQUANT,
      `Le disque qui contient « ${dossierMusique} » n'est pas monté. La synchronisation ` +
        'est suspendue : sans cette vérification, macOS recréerait un dossier vide et ' +
        'toute la bibliothèque se retéléchargerait sur le disque de démarrage.',
      { chemin: dossierMusique },
    );
  }

  try {
    fs.mkdirSync(dossierMusique, { recursive: true });
    const témoin = path.join(dossierMusique, '.zotijean-test-ecriture');
    fs.writeFileSync(témoin, 'ok');
    fs.unlinkSync(témoin);
  } catch (erreur) {
    return contrôle(
      'destination',
      'Dossier de musique',
      GRAVITÉ.BLOQUANT,
      `Impossible d'écrire dans « ${dossierMusique} » : ${erreur.message}. ` +
        'Choisissez un autre dossier dans les réglages.',
      { chemin: dossierMusique },
    );
  }

  const libre = espaceLibre(dossierMusique);
  const minimum = (gardes?.espaceMinimumGo ?? 2) * Go;

  if (libre !== null && libre < minimum) {
    return contrôle(
      'destination',
      'Dossier de musique',
      GRAVITÉ.BLOQUANT,
      `Il ne reste que ${(libre / Go).toFixed(1)} Go sur ce disque, en dessous du seuil ` +
        `de ${(minimum / Go).toFixed(0)} Go que vous avez fixé. La synchronisation est ` +
        'suspendue pour ne pas saturer le disque.',
      { chemin: dossierMusique, libre },
    );
  }

  return contrôle(
    'destination',
    'Dossier de musique',
    GRAVITÉ.OK,
    libre === null
      ? 'Accessible en écriture.'
      : `Accessible en écriture, ${(libre / Go).toFixed(1)} Go disponibles.`,
    { chemin: dossierMusique, libre },
  );
}

// ---------------------------------------------------------------------------
// Rapport complet
// ---------------------------------------------------------------------------

/**
 * Lance tous les contrôles. Utilisé au démarrage, avant chaque synchronisation,
 * et par le bouton « Relancer le diagnostic » de l'interface.
 */
export async function diagnostiquer(config) {
  const début = Date.now();

  const [zotify, ffmpeg] = await Promise.all([
    contrôlerZotify(config.zotify?.commande),
    contrôlerFfmpeg(),
  ]);

  const contrôles = [
    contrôle('node', 'Node.js', GRAVITÉ.OK, `Version ${process.version}.`, {
      version: process.version,
      plateforme: `${os.type()} ${os.release()} (${process.arch})`,
    }),
    zotify,
    ffmpeg,
    contrôlerIdentifiants(),
    contrôlerDestination(config.général.dossierMusique, config.gardes),
  ];

  const bloquants = contrôles.filter((c) => c.gravité === GRAVITÉ.BLOQUANT);
  const avertissements = contrôles.filter((c) => c.gravité === GRAVITÉ.AVERTISSEMENT);

  const rapport = {
    date: new Date().toISOString(),
    duréeMs: Date.now() - début,
    contrôles,
    prêt: bloquants.length === 0,
    résumé: bloquants.length > 0
      ? `${bloquants.length} problème${bloquants.length > 1 ? 's' : ''} à régler avant de pouvoir synchroniser.`
      : avertissements.length > 0
        ? `Prêt à synchroniser, avec ${avertissements.length} point${avertissements.length > 1 ? 's' : ''} de vigilance.`
        : 'Tout est en ordre.',
  };

  journal.info(`Diagnostic : ${rapport.résumé}`);
  for (const c of [...bloquants, ...avertissements]) {
    journal.avertir(`${c.titre} — ${c.message}`);
  }

  return rapport;
}

/** Le contrôle zotify seul, pour connaître les options supportées avant un lancement. */
export async function capacitésZotify(config) {
  return contrôlerZotify(config.zotify?.commande);
}
