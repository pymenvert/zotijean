// Pilotage de zotify en sous-processus.
//
// TROIS RÈGLES, TIRÉES DE LA RECHERCHE ET NON NÉGOCIABLES.
//
// 1. LE CODE DE SORTIE NE VEUT RIEN DIRE. zotify renvoie 0 même quand des pistes
//    ont échoué. La seule vérité, c'est le disque : on inventorie le dossier
//    avant et après, et ce sont les fichiers réellement apparus qui font foi.
//
// 2. LA SORTIE UTILISE DES RETOURS CHARIOT. Les barres de progression réécrivent
//    la même ligne avec « \r » et n'émettent jamais de « \n ». Un découpeur qui
//    n'attend que des sauts de ligne ne reçoit rien jusqu'à la fin du processus,
//    et l'interface reste figée pendant des heures.
//
// 3. LES OPTIONS VARIENT SELON LE FORK. On ne passe une option que si le
//    `--help` de l'installation réelle la déclare. Une option inconnue ferait
//    échouer tout le téléchargement.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { environnement } from './processus.js';
import { journal } from './journal.js';
import { cléComparaison } from './organisation.js';

/**
 * Correspondance entre un réglage de l'app et les noms d'options possibles chez
 * zotify, par ordre de préférence. On retient la première que l'installation
 * déclare supporter.
 *
 * Les forks n'ont pas harmonisé leurs noms : `zotify-dev` (abandonné) et
 * `Googolplexed0` (vivant) diffèrent, et les versions intermédiaires aussi.
 * Deviner produirait une erreur au premier téléchargement ; sonder ne coûte rien.
 */
const OPTIONS_CANDIDATES = {
  dossierRacine: ['root-path', 'output-path', 'download-path'],
  modèleSortie: ['output', 'output-template'],
  qualité: ['download-quality', 'quality', 'audio-quality'],
  format: ['audio-format', 'codec', 'download-format', 'format'],
  attente: ['bulk-wait-time', 'download-delay', 'wait-time'],
  ignorerExistants: ['skip-existing', 'skip-previously-downloaded', 'no-overwrite'],
  interfaceSimple: ['standard-interface', 'no-interactive', 'simple-output'],
  sansArchiveDossier: ['disable-directory-archives'],
};

/** Valeurs de qualité, telles que zotify les attend. */
const VALEURS_QUALITÉ = {
  normale: 'normal',
  elevee: 'high',
  tres_elevee: 'very_high',
};

/** Valeurs de format. « copie » signifie : ne rien réencoder. */
const VALEURS_FORMAT = {
  copie: 'copy',
  flac: 'flac',
  aiff: 'aiff',
  mp3_320: 'mp3',
  aac_256: 'aac',
};

/** Choisit le nom d'option réellement supporté, ou null. */
function optionSupportée(clé, optionsDéclarées) {
  for (const candidat of OPTIONS_CANDIDATES[clé] || []) {
    if (optionsDéclarées.has(candidat)) return candidat;
  }
  return null;
}

/**
 * Construit la ligne de commande.
 * Renvoie aussi la liste des réglages qui n'ont pas pu être appliqués, pour que
 * l'interface le dise franchement plutôt que de laisser croire qu'ils le sont.
 */
export function construireArguments({ url, config, attente, capacités, modèle, dossierRacine }) {
  const déclarées = new Set(capacités.options || []);
  const arguments_ = [];
  const nonAppliqués = [];

  const ajouter = (clé, valeur, libellé) => {
    const nom = optionSupportée(clé, déclarées);
    if (!nom) {
      nonAppliqués.push(libellé);
      return;
    }
    arguments_.push(`--${nom}`, String(valeur));
  };

  // LE DOSSIER DE DESTINATION EST BLOQUANT, pas « non appliqué ».
  //
  // Sans lui, zotify télécharge quand même — dans SON dossier par défaut, sur le
  // disque de démarrage. L'inventaire ne voit alors rien apparaître, l'app
  // conclut « aucune nouveauté », marque l'exécution réussie et attend 48 h.
  // Toute la protection de volume monté est contournée, et l'utilisateur
  // découvre des gigaoctets au mauvais endroit des semaines plus tard.
  const nomRacine = optionSupportée('dossierRacine', déclarées);
  if (!nomRacine) {
    return {
      arguments: null,
      nonAppliqués,
      bloquant:
        'Votre version de zotify n’expose aucune option de dossier de destination ' +
        '(--root-path, --output-path ou --download-path). Lancer le téléchargement ' +
        'écrirait la musique ailleurs que dans le dossier choisi. Synchronisation annulée.',
    };
  }
  arguments_.push(`--${nomRacine}`, String(dossierRacine));
  ajouter('modèleSortie', modèle, "le modèle d'organisation des dossiers");
  ajouter('qualité', VALEURS_QUALITÉ[config.qualité.niveau] ?? 'very_high', 'la qualité audio');
  ajouter('format', VALEURS_FORMAT[config.qualité.format] ?? 'copy', 'le format de fichier');
  ajouter('attente', attente, "le rythme d'attente entre les titres");

  // LES OPTIONS BOOLÉENNES EXIGENT UNE VALEUR — LES PASSER EN DRAPEAU NU
  // DÉTRUISAIT TOUTE LA LIGNE DE COMMANDE.
  //
  // Relevé dans le code source du fork vivant, et reproduit avec le même
  // argparse : ses options de configuration sont toutes déclarées comme
  // attendant une valeur, y compris les booléennes. « --skip-existing » passé
  // seul avalait donc l'argument suivant — L'URL DE LA PLAYLIST. La liste des
  // adresses à télécharger devenait vide, zotify se terminait sans rien tenter,
  // et l'app annonçait « aucune nouveauté » à chaque synchronisation, pour
  // toujours. Aucun test ne le voyait : notre doublure acceptait tout.
  //
  // L'ancien fork, lui, déclarait ces options comme de purs drapeaux — leur
  // passer une valeur la ferait prendre pour une adresse à télécharger. Le
  // style se lit dans le texte d'aide : argparse affiche « --skip-existing
  // SKIP_EXISTING » quand une valeur est attendue, le nom seul sinon. Sans
  // texte d'aide, on suppose le style à valeur : c'est celui du fork embarqué.
  const attendUneValeur = (nom) => {
    const aide = String(capacités.aide || '');
    if (!aide) return true;
    return new RegExp(`--${nom}[ =][A-Z][A-Z_]*`).test(aide);
  };

  const pousserBooléen = (clé) => {
    const nom = optionSupportée(clé, déclarées);
    if (!nom) return false;
    if (attendUneValeur(nom)) arguments_.push(`--${nom}`, 'true');
    else arguments_.push(`--${nom}`);
    return true;
  };

  pousserBooléen('ignorerExistants');

  // LE DISQUE DOIT FAIRE FOI, Y COMPRIS POUR ZOTIFY.
  //
  // Par défaut, zotify tient un fichier d'archive par dossier et décide d'après
  // LUI qu'un morceau est déjà là — pas d'après la présence du fichier. Relevé
  // dans son code source : « --skip-existing » ne consulte le disque que si les
  // archives de dossier sont désactivées.
  //
  // Cette différence casse le principe fondateur de Zotijean. Un morceau écarté
  // parce qu'il était tronqué, ou supprimé à la main par l'utilisateur, reste
  // inscrit dans l'archive : zotify le saute indéfiniment, et le titre ne
  // revient jamais. La mise à l'écart des fichiers incomplets ne servait donc à
  // rien tant que cette option n'était pas passée.
  //
  // On la désactive pour que la seule question posée soit « le fichier est-il
  // là ? » — celle à laquelle toute l'application répond déjà.
  if (!pousserBooléen('sansArchiveDossier')) {
    nonAppliqués.push(
      'la reprise des morceaux effacés ou incomplets (votre version de zotify ' +
      'garde sa propre liste et ne relit pas le dossier)',
    );
  }

  const supplémentaires = String(config.zotify?.argumentsSupplémentaires || '').trim();
  if (supplémentaires) {
    arguments_.push(...supplémentaires.split(/\s+/));
  }

  arguments_.push(url);

  return { arguments: arguments_, nonAppliqués };
}

// ---------------------------------------------------------------------------
// Découpage de la sortie
// ---------------------------------------------------------------------------

/**
 * Découpe un flux sur « \n » ET « \r ».
 * Renvoie une fonction à appeler sur chaque bloc reçu ; elle appelle `surLigne`
 * pour chaque ligne complète et conserve le reste en tampon.
 */
export function créerDécoupeur(surLigne) {
  let tampon = '';

  return function absorber(bloc) {
    tampon += bloc;

    // On découpe sur les deux, en traitant « \r\n » comme un seul séparateur.
    const morceaux = tampon.split(/\r\n|\r|\n/);
    tampon = morceaux.pop() ?? '';

    for (const morceau of morceaux) {
      const ligne = morceau.trim();
      if (ligne) surLigne(ligne);
    }
  };
}

const MOTIFS_ERREUR = [
  /failed/i,
  /error/i,
  /unable to/i,
  /not found/i,
  /audio key/i,
  /rate.?limit/i,
  /too many requests/i,
  /premium/i,
  /unavailable/i,
];

const MOTIF_POURCENTAGE = /(\d{1,3})\s?%/;

/**
 * Retire les séquences d'échappement du terminal.
 *
 * CE N'EST PAS UNE PRÉCAUTION THÉORIQUE. Le code de zotify définit ses propres
 * séquences — remonter d'une ligne, effacer la ligne — et son tableau de bord
 * les émet à chaque rafraîchissement. Sa barre de progression passe par tqdm,
 * qui en ajoute encore.
 *
 * Ces caractères n'ont de sens que pour un terminal. Recopiés tels quels dans
 * une page web, ils s'affichent en charabia au milieu du titre en cours : après
 * dix-sept heures à regarder cette ligne, autant qu'elle soit lisible.
 *
 * On enlève aussi les retours arrière et le retour chariot résiduel, qu'un
 * affichage HTML ne sait pas interpréter non plus.
 */
export function nettoyerLigne(brut) {
  return String(brut)
    // ESC [ ... lettre — déplacements du curseur, effacements, couleurs.
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    // ESC ] ... BEL — titres de fenêtre.
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // Ce qu'il reste de séquences tronquées, plus les caractères de contrôle.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim();
}

/**
 * Les intitulés du tableau de bord que zotify redessine en continu.
 *
 * Relevés dans son code source, pas devinés. Ce ne sont pas des événements mais
 * un AFFICHAGE D'ÉTAT, réémis à chaque rafraîchissement.
 *
 * LE PIÈGE, ET IL EST GROS. L'un de ces intitulés est « Last Encountered
 * Error », suivi le plus souvent de « None ». Le motif qui repère les erreurs
 * cherche le mot « error » : chaque rafraîchissement produisait donc une fausse
 * erreur. Sur un rattrapage de dix-sept heures, ça remplit le journal, ça sature
 * la liste des erreurs conservées, et surtout ça fait dire au bilan « 1 960
 * nouveaux titres, 200 repris plus tard » alors que tout s'est bien passé.
 *
 * Les vraies erreurs, elles, arrivent par leur propre canal et gardent leur
 * formulation d'origine. On peut donc écarter ces lignes-ci sans rien perdre.
 */
const INTITULÉS_TABLEAU_DE_BORD = [
  'Query Tree:',
  'Current DLContent:',
  'Status:',
  'Total Query Progress:',
  'Last Download Time:',
  'Last Conversion Time:',
  'Last Downloaded Item:',
  'Last Encountered Error:',
];

/** Classe une ligne de sortie pour l'affichage et le journal. */
export function classerLigne(brute) {
  const ligne = nettoyerLigne(brute);

  if (INTITULÉS_TABLEAU_DE_BORD.some((intitulé) => ligne.startsWith(intitulé))) {
    return { type: 'info', texte: ligne, tableauDeBord: true };
  }

  const pourcentage = ligne.match(MOTIF_POURCENTAGE);

  if (MOTIFS_ERREUR.some((motif) => motif.test(ligne))) {
    return { type: 'erreur', texte: ligne };
  }
  if (pourcentage) {
    return { type: 'progression', texte: ligne, pourcentage: Number(pourcentage[1]) };
  }
  return { type: 'info', texte: ligne };
}

/**
 * Transforme une ligne classée en événement destiné à l'interface.
 *
 * L'ORDRE DES CLÉS DÉCIDE ICI DE CE QUE VOIT L'UTILISATEUR, et il l'a déjà
 * décidé une fois dans le mauvais sens. `classerLigne` rend déjà un `type` —
 * « info », « progression » ou « erreur ». Écrire `{ type: 'ligne', ...classée }`
 * le laisse écraser par l'étalement, et l'événement ressort en « progression ».
 * Or les deux seuls consommateurs — le moteur et l'interface — testent
 * `type === 'ligne'` : ils ne recevaient jamais rien.
 *
 * Conséquence, invisible en test unitaire : ni le titre en cours ni le
 * pourcentage n'atteignaient l'écran. L'interface affichait « Préparation… »
 * pendant les dix-sept heures d'un gros rattrapage. Une application qui n'avance
 * pas de la nuit passe pour plantée, et on la force à quitter — en pleine
 * écriture d'un fichier.
 *
 * Cette fonction existe pour que ce contrat soit vérifiable, plutôt que caché
 * dans un rappel au milieu d'un pilote de sous-processus.
 */
export function événementDeLigne(classée) {
  return { ...classée, type: 'ligne', sousType: classée.type };
}

// ---------------------------------------------------------------------------
// Inventaire du disque — la seule source de vérité
// ---------------------------------------------------------------------------

const EXTENSIONS_AUDIO = new Set(['.ogg', '.mp3', '.flac', '.aiff', '.aif', '.m4a', '.wav', '.opus']);

/** Inventorie récursivement les fichiers audio d'un dossier. */
export function inventorier(dossier) {
  const fichiers = new Map(); // clé normalisée NFC → { chemin, taille }

  const parcourir = (courant) => {
    let entrées;
    try {
      entrées = fs.readdirSync(courant, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entrée of entrées) {
      const complet = path.join(courant, entrée.name);
      if (entrée.isDirectory()) {
        if (entrée.name.startsWith('.') || entrée.name.startsWith('_')) continue;
        parcourir(complet);
      } else if (EXTENSIONS_AUDIO.has(path.extname(entrée.name).toLowerCase())) {
        try {
          const stat = fs.statSync(complet);
          // La date d'écriture sert à reconnaître le fichier que zotify était en
          // train de produire quand on l'a arrêté : c'est le seul qui soit
          // presque sûrement tronqué.
          fichiers.set(cléComparaison(complet), {
            chemin: complet,
            taille: stat.size,
            modifiéLe: stat.mtimeMs,
          });
        } catch {
          // Fichier disparu entre le listing et le stat : sans importance.
        }
      }
    }
  };

  parcourir(dossier);
  return fichiers;
}

/**
 * Compare deux inventaires et renvoie les fichiers réellement apparus.
 * Un fichier de moins de 32 Ko est considéré comme un téléchargement avorté :
 * aucun morceau de musique ne pèse si peu, et zotify laisse parfois des restes.
 */
export function nouveauxFichiers(avant, après, tailleMinimale = 32 * 1024) {
  const nouveaux = [];
  const suspects = [];

  for (const [clé, info] of après) {
    if (avant.has(clé)) continue;
    if (info.taille < tailleMinimale) suspects.push(info);
    else nouveaux.push(info);
  }

  return { nouveaux, suspects };
}

/** Dossier où atterrissent les téléchargements interrompus. */
export const DOSSIER_INCOMPLETS = '_incomplets';

/**
 * Supprime les fichiers de travail que zotify laisse derrière lui.
 *
 * CE QUE SON CODE SOURCE APPREND. zotify télécharge dans un fichier « .tmp »
 * placé à côté de la destination finale, et ne le renomme qu'une fois le
 * morceau complet. Il fait le ménage de ces « .tmp » à la fin d'une exécution
 * NORMALE — mais nous le coupons parfois au signal, et ce ménage n'a alors
 * jamais lieu.
 *
 * Ces restes sont invisibles pour tout le reste de l'application : l'inventaire
 * ne compte que les extensions audio. Ils s'accumuleraient donc en silence dans
 * la bibliothèque, à raison de plusieurs mégaoctets chacun, sans que rien ne les
 * signale ni ne les efface.
 *
 * On les supprime plutôt que de les mettre à l'abri : ce ne sont pas des
 * morceaux, seulement des fragments de téléchargement inachevés, et ils portent
 * un nom qui ne désigne rien pour l'utilisateur.
 */
export function nettoyerRestesTemporaires(dossierRacine) {
  const supprimés = [];

  const parcourir = (courant) => {
    let entrées;
    try {
      entrées = fs.readdirSync(courant, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entrée of entrées) {
      const complet = path.join(courant, entrée.name);
      if (entrée.isDirectory()) {
        if (entrée.name.startsWith('.') || entrée.name.startsWith('_')) continue;
        parcourir(complet);
      } else if (entrée.name.toLowerCase().endsWith('.tmp')) {
        try {
          const taille = fs.statSync(complet).size;
          fs.unlinkSync(complet);
          supprimés.push({ chemin: complet, taille });
        } catch {
          // Occupé ou déjà disparu : sans importance.
        }
      }
    }
  };

  parcourir(dossierRacine);
  return supprimés;
}

/**
 * Écarte les fichiers d'un téléchargement interrompu, sans jamais les détruire.
 *
 * POURQUOI CE N'EST PAS UN DÉTAIL. Un fichier laissé sur place a deux effets, et
 * les deux sont graves :
 *
 * 1. zotify est lancé avec « --skip-existing ». Il voit le fichier, saute le
 *    morceau, et le fait à chaque synchronisation suivante. Le titre est
 *    définitivement absent de la bibliothèque, sans un mot.
 * 2. S'il dépasse le seuil de taille — un morceau coupé après dix secondes pèse
 *    déjà quelques centaines de kilo-octets —, il est compté comme un
 *    téléchargement RÉUSSI : converti, ajouté aux listes de lecture, exporté
 *    vers Rekordbox et Serato. L'utilisateur le découvre en le jouant.
 *
 * On DÉPLACE, on ne supprime pas : c'est la règle du projet, et un fichier
 * déplacé peut être récupéré. Le dossier commence par « _ », que l'inventaire
 * ignore — le morceau sera donc bien retéléchargé.
 */
export function écarterIncomplet(chemin, dossierRacine) {
  try {
    const abri = path.join(dossierRacine, DOSSIER_INCOMPLETS);
    fs.mkdirSync(abri, { recursive: true });

    let cible = path.join(abri, path.basename(chemin));
    // Un même morceau peut être interrompu plusieurs fois : on ne veut ni
    // écraser la tentative précédente, ni échouer.
    if (fs.existsSync(cible)) {
      const ext = path.extname(cible);
      const base = path.basename(cible, ext);
      cible = path.join(abri, `${base}-${Date.now()}${ext}`);
    }

    fs.renameSync(chemin, cible);
    return cible;
  } catch (erreur) {
    // Un échec ici ne doit pas faire tomber la synchronisation — mais il ne doit
    // pas non plus passer inaperçu. Le fichier tronqué reste en place, donc le
    // téléchargeur continuera de sauter ce morceau à chaque fois. C'est
    // exactement le genre de panne silencieuse qu'on cherche à supprimer : sans
    // cette ligne, l'utilisateur verrait un titre manquer indéfiniment sans
    // qu'aucun message n'existe pour l'expliquer.
    journal.avertir(
      `Impossible d’écarter un téléchargement interrompu (${erreur.code || erreur.message}). ` +
        `Le fichier « ${path.basename(chemin)} » reste en place, et ce morceau continuera ` +
        'd’être sauté. Supprimez-le à la main pour qu’il soit retéléchargé.',
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

/**
 * Lance zotify sur une URL et suit son déroulement.
 *
 * `surÉvénement` reçoit des objets typés au fil de l'eau. La promesse se résout
 * avec le bilan établi à partir du DISQUE, pas du code de sortie.
 */
/**
 * Silence toléré avant de conclure que zotify est bloqué.
 *
 * Surtout PAS un délai total : un rattrapage légitime dure dix-sept heures. Ce
 * qui est anormal, c'est l'absence de toute sortie pendant longtemps — zotify
 * en produit à chaque piste, et il attend au plus une trentaine de secondes
 * entre deux. Un quart d'heure de silence signifie qu'il est figé, typiquement
 * sur une invite qu'on ne voit pas.
 */
const SILENCE_MAXIMAL_MS = 15 * 60 * 1000;

export function télécharger({
  commande,
  arguments: arguments_,
  dossierRacine,
  surÉvénement = () => {},
  signalArrêt = null,
  silenceMaximalMs = SILENCE_MAXIMAL_MS,
}) {
  return new Promise((résoudre) => {
    const avant = inventorier(dossierRacine);
    const débutMs = Date.now();
    const lignes = [];

    journal.info(`Lancement de zotify`, { commande, arguments: arguments_ });
    surÉvénement({ type: 'début', commande, arguments: arguments_ });

    let processus;
    try {
      processus = spawn(commande, arguments_, {
        env: environnement(),
        windowsHide: true,
        // L'ENTRÉE STANDARD EST FERMÉE. Si zotify réclame un identifiant — ce
        // qui arrive à la première authentification — un tube ouvert le fait
        // attendre indéfiniment. Pire : son invite « Username: » ne se termine
        // ni par un saut de ligne ni par un retour chariot, donc le découpeur la
        // garde en tampon et l'interface n'affiche même pas la question. Le
        // moteur resterait figé toute la nuit sur « Préparation… ».
        // Avec « ignore », l'invite reçoit une fin de fichier, zotify sort en
        // erreur, la promesse se résout et le verrou est rendu. Rien n'écrit
        // jamais sur son entrée : aucun effet de bord.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (erreur) {
      résoudre({
        lancé: false,
        erreur: erreur.message,
        nouveaux: [],
        suspects: [],
        lignes: [],
        duréeMs: 0,
      });
      return;
    }

    // Chien de garde d'inactivité. Sans lui, un zotify bloqué — sur une invite
    // d'identifiants, sur un réseau qui ne répond plus — fige le moteur
    // indéfiniment : c'était la seule exécution du projet sans aucun délai.
    let expiré = false;
    // L'instant où l'on a coupé zotify, quelle qu'en soit la raison. Il sépare
    // les fichiers terminés de celui qui était en cours d'écriture. Déclaré ici,
    // avant le chien de garde qui s'en sert : plus bas, il serait dans sa zone
    // morte au moment où la minuterie est armée.
    let instantArrêt = null;
    let chien = null;

    // DEMANDE DE CONNEXION SPOTIFY, RELEVÉE DANS LE CODE SOURCE DE ZOTIFY.
    //
    // Sans identifiants enregistrés, zotify ne s'arrête pas : il affiche
    // « Click on the following link to login: », l'adresse d'autorisation sur
    // la ligne suivante, puis attend indéfiniment que l'utilisateur termine la
    // connexion dans un navigateur. Son entrée standard fermée n'y change rien —
    // il attend un rappel HTTP, pas une saisie.
    //
    // Sans cette détection, le premier lancement d'un utilisateur jamais
    // authentifié donnait : quinze minutes de silence, puis le chien de garde
    // qui tue zotify en parlant de blocage. La vraie information — « cliquez ici
    // pour vous connecter » — était dans le flux, mais rien ne la distinguait.
    //
    // On la fait remonter : l'adresse part vers l'interface, où elle devient un
    // lien cliquable. Si l'utilisateur clique et termine la connexion pendant
    // que zotify attend encore, celui-ci enregistre ses identifiants et le
    // téléchargement REPREND tout seul — c'est le scénario idéal, et il ne
    // demande rien d'autre que de laisser zotify vivre.
    let connexionRequise = false;
    let urlConnexion = null;

    const détecterDemandeConnexion = (texte) => {
      if (!connexionRequise && /link to login/i.test(texte)) {
        connexionRequise = true;
        journal.avertir(
          'zotify demande une connexion à votre compte Spotify. Une adresse de ' +
            'connexion va s’afficher : ouvrez-la dans votre navigateur pour ' +
            'autoriser le téléchargement.',
        );
        return;
      }
      if (connexionRequise && !urlConnexion && /^https?:\/\/\S+$/i.test(texte)) {
        urlConnexion = texte;
        journal.info(`Adresse de connexion Spotify : ${urlConnexion}`);
        surÉvénement({ type: 'connexion-requise', url: urlConnexion });
      }
    };

    const réarmerChien = () => {
      clearTimeout(chien);
      chien = setTimeout(() => {
        expiré = true;
        // Même raison que pour un arrêt demandé : ce que zotify écrivait à cet
        // instant est tronqué, et il faut pouvoir le reconnaître ensuite.
        instantArrêt = Date.now();
        if (connexionRequise) {
          journal.erreur(
            'zotify attendait une connexion à votre compte Spotify qui n’est pas ' +
              'venue : il est arrêté. Ouvrez l’adresse de connexion affichée plus ' +
              'haut dans le journal, ou lancez zotify une fois dans le Terminal, ' +
              'puis relancez la synchronisation.',
          );
        } else {
          journal.erreur(
            `zotify n’a rien produit depuis ${Math.round(silenceMaximalMs / 60000)} minutes : ` +
              'il est considéré comme bloqué et arrêté. Les morceaux déjà téléchargés ' +
              'sont conservés, les autres seront repris à la prochaine synchronisation.',
          );
        }
        surÉvénement({ type: 'expiration' });
        processus.kill('SIGTERM');
        setTimeout(() => {
          if (processus.exitCode === null && processus.signalCode === null) {
            processus.kill('SIGKILL');
          }
        }, 3000);
      }, silenceMaximalMs);
      chien.unref?.();
    };

    const enregistrer = (ligne) => {
      réarmerChien();
      const classée = classerLigne(ligne);
      lignes.push(classée);
      if (lignes.length > 2000) lignes.shift();
      surÉvénement(événementDeLigne(classée));
      if (classée.type === 'erreur') journal.avertir(`zotify : ${ligne}`);
      détecterDemandeConnexion(classée.texte);
    };

    réarmerChien();

    const découpeurSortie = créerDécoupeur(enregistrer);
    const découpeurErreur = créerDécoupeur(enregistrer);

    processus.stdout?.setEncoding('utf8');
    processus.stderr?.setEncoding('utf8');
    processus.stdout?.on('data', découpeurSortie);
    processus.stderr?.on('data', découpeurErreur);

    let arrêtDemandé = false;
    const arrêter = () => {
      if (arrêtDemandé) return;
      arrêtDemandé = true;
      instantArrêt = Date.now();
      journal.info('Arrêt de zotify demandé.');
      surÉvénement({ type: 'arrêt-demandé' });
      processus.kill('SIGTERM');
      // Laisser une chance à zotify de finir proprement le fichier en cours,
      // puis forcer. Un fichier à moitié écrit sera écarté par le seuil de
      // taille lors de la comparaison des inventaires.
      //
      // On teste la SORTIE du processus, pas `killed` : ce drapeau passe à vrai
      // dès l'ENVOI du signal, donc `if (!processus.killed)` ne se déclenche
      // jamais et le SIGKILL de secours ne partait pas. Trois secondes, pour
      // rester sous les cinq que le serveur s'accorde pour s'éteindre.
      setTimeout(() => {
        if (processus.exitCode === null && processus.signalCode === null) {
          processus.kill('SIGKILL');
        }
      }, 3000);
    };

    signalArrêt?.addEventListener?.('abort', arrêter, { once: true });

    processus.on('error', (erreur) => {
      clearTimeout(chien);
      résoudre({
        lancé: false,
        erreur: erreur.message,
        nouveaux: [],
        suspects: [],
        lignes,
        duréeMs: Date.now() - débutMs,
      });
    });

    processus.on('close', (code) => {
      clearTimeout(chien);
      signalArrêt?.removeEventListener?.('abort', arrêter);

      const après = inventorier(dossierRacine);
      const { nouveaux, suspects } = nouveauxFichiers(avant, après);

      // ------------------------------------------------------------------
      // Écarter ce qui a été coupé en pleine écriture
      // ------------------------------------------------------------------

      const écartés = [];

      // Les trop petits, toujours : aucun morceau ne pèse moins de 32 Ko.
      for (const suspect of suspects) {
        if (écarterIncomplet(suspect.chemin, dossierRacine)) écartés.push(suspect);
      }

      // ON NE TOUCHE PAS AU DERNIER FICHIER ÉCRIT, ET C'EST UNE CORRECTION.
      //
      // Une version précédente écartait, en cas d'interruption, le fichier dont
      // la date d'écriture suivait l'arrêt — en supposant que zotify écrivait
      // directement dans le fichier final. La lecture de son code source dit le
      // contraire : il télécharge dans un « .tmp » et ne renomme qu'une fois
      // terminé.
      //
      // Un fichier portant une extension audio est donc COMPLET par
      // construction. L'heuristique ne pouvait déplacer que des morceaux
      // parfaitement bons, pour les faire retélécharger ensuite. Elle est
      // retirée : le seuil de taille ci-dessus suffit, et les vrais restes
      // d'une interruption sont les « .tmp » traités juste après.
      const restes = nettoyerRestesTemporaires(dossierRacine);

      if (écartés.length) {
        journal.avertir(
          `${écartés.length} fichier(s) trop petit(s) mis de côté dans « ` +
            `${DOSSIER_INCOMPLETS} ». Ces morceaux seront repris à la prochaine ` +
            'synchronisation ; sans ça, ils resteraient tronqués et ne seraient ' +
            'jamais retéléchargés.',
        );
      }

      if (restes.length) {
        const mo = restes.reduce((somme, r) => somme + r.taille, 0) / 1024 ** 2;
        journal.info(
          `${restes.length} fichier(s) de travail inachevé(s) supprimé(s) ` +
            `(${mo.toFixed(0)} Mo). zotify les efface lui-même quand il se termine ` +
            'normalement ; ceux-ci restaient d’une interruption.',
        );
      }

      const erreurs = lignes.filter((l) => l.type === 'erreur');

      journal.info(
        `zotify terminé — ${nouveaux.length} nouveau(x) fichier(s), ` +
          `${erreurs.length} ligne(s) d'erreur, code de sortie ${code} (non fiable).`,
      );

      résoudre({
        lancé: true,
        interrompu: arrêtDemandé,
        expiré,
        codeSortie: code,
        nouveaux,
        suspects,
        erreurs,
        lignes,
        // La demande de connexion remonte jusqu'à la synchronisation : c'est
        // elle qui décide d'annuler le reste de l'exécution avec un message
        // clair, plutôt que de laisser chaque playlist échouer à l'identique.
        connexionRequise,
        urlConnexion,
        duréeMs: Date.now() - débutMs,
      });
    });
  });
}
