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
import { DOSSIER_INCOMPLETS } from './zotify.js';
import { assurerZotify, étatOutils } from './outils.js';
import { volumeMonté, espaceLibre, assurerDossier, version } from './chemins.js';
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

  // Le zotify EMBARQUÉ passe devant celui du système : c'est celui dont on
  // connaît la version et les options. Il est monté au premier lancement à
  // partir des roues du paquet, hors ligne.
  const embarqué = await assurerZotify();
  if (embarqué.chemin) candidats.push(embarqué.chemin);

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

  // Message adapté selon qu'un paquet autonome était censé le fournir ou non :
  // dire « installez zotify » à quelqu'un qui vient de double-cliquer une app
  // supposée tout contenir serait incompréhensible.
  const messageAutonome = embarqué.raison && embarqué.raison !== 'aucun outil embarqué'
    ? `${embarqué.raison} Relancez l’application ; si le problème persiste, ` +
      'consultez le journal dans cet onglet.'
    : 'zotify est introuvable. Vérifiez qu’il fonctionne en tapant ' +
      '« zotify --version » dans le Terminal, puis indiquez son chemin dans les réglages.';

  return contrôle(
    'zotify',
    'zotify',
    GRAVITÉ.BLOQUANT,
    messageAutonome,
    { chemin: null, version: null, options: [], embarqué: embarqué.prêt },
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

/**
 * Signale les téléchargements coupés en pleine écriture, mis de côté.
 *
 * Ils sont retéléchargés d'eux-mêmes : l'utilisateur n'a rien à faire. Mais les
 * laisser s'accumuler sans jamais les nommer serait un dossier qui grossit en
 * silence sur son disque, sans qu'il sache d'où il vient ni s'il peut le vider.
 * On le dit, et on dit qu'il peut le supprimer.
 */
function contrôlerIncomplets(dossierMusique) {
  const abri = path.join(dossierMusique, DOSSIER_INCOMPLETS);

  let fichiers = [];
  try {
    fichiers = fs.readdirSync(abri).filter((n) => !n.startsWith('.'));
  } catch {
    // Le dossier n'existe pas : c'est le cas normal.
  }

  if (!fichiers.length) return null;

  let octets = 0;
  for (const nom of fichiers) {
    try {
      octets += fs.statSync(path.join(abri, nom)).size;
    } catch {
      // Disparu entre-temps : sans importance.
    }
  }

  const Mo = (octets / 1024 ** 2).toFixed(0);
  return contrôle(
    'incomplets',
    'Téléchargements interrompus',
    GRAVITÉ.OK,
    `${fichiers.length} morceau(x) coupé(s) en pleine écriture ont été mis de côté ` +
      `(${Mo} Mo). Ils sont retéléchargés automatiquement, vous n'avez rien à faire. ` +
      'Vous pouvez supprimer ce dossier quand vous voulez.',
    { chemin: abri },
  );
}

/**
 * Les emplacements que macOS protège, et le nom du réglage correspondant.
 *
 * Depuis macOS Catalina, écrire dans le Bureau, les Documents ou les
 * Téléchargements exige une autorisation explicite ; depuis Ventura, les
 * volumes amovibles aussi. Une application qui n'est pas passée par une fenêtre
 * de sélection de fichiers se voit simplement refuser l'accès.
 */
const EMPLACEMENTS_PROTÉGÉS = [
  { dossier: 'Desktop', libellé: 'Bureau', réglage: 'Dossiers Bureau' },
  { dossier: 'Documents', libellé: 'Documents', réglage: 'Dossiers Documents' },
  { dossier: 'Downloads', libellé: 'Téléchargements', réglage: 'Dossiers Téléchargements' },
];

/**
 * Le message d'un refus d'écriture, adapté à ce qui s'est réellement passé.
 *
 * POURQUOI CE N'EST PAS UN DÉTAIL DE FORMULATION. Le conseil précédent était
 * « choisissez un autre dossier », ce qui est FAUX dans le cas le plus courant
 * sur un Mac : le dossier est le bon, c'est le système qui bloque l'accès tant
 * qu'on ne l'a pas autorisé. Envoyer l'utilisateur changer de dossier lui fait
 * abandonner l'organisation qu'il voulait, pour un problème qui se règle en
 * deux clics.
 */
export function messageÉcritureRefusée(dossier, erreur) {
  const refus = erreur?.code === 'EACCES' || erreur?.code === 'EPERM';

  if (refus && process.platform === 'darwin') {
    const protégé = EMPLACEMENTS_PROTÉGÉS.find((e) =>
      dossier.includes(`/${e.dossier}/`) || dossier.endsWith(`/${e.dossier}`));

    if (protégé) {
      return (
        `macOS protège le dossier ${protégé.libellé} et refuse l'accès à Zotijean. ` +
        `Le dossier n'a rien d'anormal : allez dans Réglages Système → ` +
        `Confidentialité et sécurité → ${protégé.réglage}, et autorisez Zotijean. ` +
        'Vous pouvez aussi choisir un dossier dans Musique, qui n’est pas protégé.'
      );
    }

    if (dossier.startsWith('/Volumes/')) {
      return (
        'macOS refuse l’accès à ce disque externe. Allez dans Réglages Système → ' +
        'Confidentialité et sécurité → Volumes amovibles, et autorisez Zotijean. ' +
        'Le disque est bien branché : c’est l’autorisation qui manque.'
      );
    }

    return (
      `macOS refuse l’écriture dans « ${dossier} ». Vérifiez l’autorisation de ` +
      'Zotijean dans Réglages Système → Confidentialité et sécurité → Accès complet ' +
      'au disque, ou choisissez un dossier dans Musique.'
    );
  }

  if (refus) {
    return (
      `Les droits d’écriture manquent sur « ${dossier} ». Vérifiez que le dossier ` +
      'vous appartient et qu’il n’est pas en lecture seule.'
    );
  }

  return (
    `Impossible d'écrire dans « ${dossier} » : ${erreur?.message || 'raison inconnue'}. ` +
    'Choisissez un autre dossier dans les réglages.'
  );
}

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
    // Surtout pas `fs.mkdirSync(..., { recursive: true })` : voir le commentaire
    // d'assurerDossier. C'est précisément ici que le blocage se produisait,
    // puisque cette fonction reçoit un chemin choisi par l'utilisateur.
    assurerDossier(dossierMusique);
    const témoin = path.join(dossierMusique, '.zotijean-test-ecriture');
    fs.writeFileSync(témoin, 'ok');
    fs.unlinkSync(témoin);
  } catch (erreur) {
    return contrôle(
      'destination',
      'Dossier de musique',
      GRAVITÉ.BLOQUANT,
      messageÉcritureRefusée(dossierMusique, erreur),
      { chemin: dossierMusique, code: erreur.code },
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
// Ne pas retélécharger ce qui est déjà là
// ---------------------------------------------------------------------------

/**
 * Vérifie que zotify sait sauter les morceaux déjà présents.
 *
 * C'est ce qui distingue une synchronisation de quelques minutes d'un
 * rattrapage complet de dix-sept heures — à chaque fois. Sans cette option,
 * l'app fonctionne mais retélécharge tout, indéfiniment, et le seul symptôme
 * visible est une lenteur inexplicable.
 */
function contrôlerReprise(zotify) {
  const options = new Set(zotify.options || []);
  const connues = ['skip-existing', 'skip-previously-downloaded', 'no-overwrite'];
  const trouvée = connues.find((o) => options.has(o));

  if (!zotify.chemin) {
    return contrôle(
      'reprise', 'Éviter les retéléchargements', GRAVITÉ.AVERTISSEMENT,
      'Impossible à vérifier tant que zotify n’est pas trouvé.',
    );
  }

  if (trouvée) {
    return contrôle(
      'reprise', 'Éviter les retéléchargements', GRAVITÉ.OK,
      `Votre version de zotify sait ignorer les morceaux déjà téléchargés ` +
        `(option « --${trouvée} »). Les synchronisations suivantes ne prendront ` +
        'que quelques minutes.',
      { option: trouvée },
    );
  }

  return contrôle(
    'reprise', 'Éviter les retéléchargements', GRAVITÉ.AVERTISSEMENT,
    'Votre version de zotify n’expose aucune option permettant d’ignorer les ' +
      'morceaux déjà téléchargés. Chaque synchronisation reprendra donc toute la ' +
      'playlist depuis le début, ce qui peut représenter des heures et augmente le ' +
      'risque pour votre compte Spotify. Mettre zotify à jour résoudrait le problème.',
  );
}

// ---------------------------------------------------------------------------
// Rapport complet
// ---------------------------------------------------------------------------

/**
 * Dernier rapport établi, gardé en mémoire.
 *
 * Le tableau de bord doit pouvoir annoncer « l'app ne peut pas fonctionner »
 * sans relancer un diagnostic complet à chaque rafraîchissement — celui-ci
 * lance des sous-processus et lit le disque.
 */
let dernierRapport = null;

/** Ce que le tableau de bord a besoin de savoir, sans rien relancer. */
export function étatConnu() {
  if (!dernierRapport) return null;
  const bloquants = dernierRapport.contrôles.filter((c) => c.gravité === GRAVITÉ.BLOQUANT);
  return {
    prêt: bloquants.length === 0,
    date: dernierRapport.date,
    bloquants: bloquants.map((b) => ({ titre: b.titre, message: b.message })),
  };
}

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
    contrôlerReprise(zotify),
    ffmpeg,
    contrôlerIdentifiants(),
    contrôlerDestination(config.général.dossierMusique, config.gardes),
    contrôlerIncomplets(config.général.dossierMusique),
  ].filter(Boolean);

  const bloquants = contrôles.filter((c) => c.gravité === GRAVITÉ.BLOQUANT);
  const avertissements = contrôles.filter((c) => c.gravité === GRAVITÉ.AVERTISSEMENT);

  const rapport = {
    date: new Date().toISOString(),
    // Un rapport de problème sans numéro de version oblige à deviner de quoi il
    // parle. Il voyage avec le diagnostic exporté.
    version: version(),
    duréeMs: Date.now() - début,
    contrôles,
    prêt: bloquants.length === 0,
    résumé: bloquants.length > 0
      ? `${bloquants.length} problème${bloquants.length > 1 ? 's' : ''} à régler avant de pouvoir synchroniser.`
      : avertissements.length > 0
        ? `Prêt à synchroniser, avec ${avertissements.length} point${avertissements.length > 1 ? 's' : ''} de vigilance.`
        : 'Tout est en ordre.',
  };

  dernierRapport = rapport;
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
