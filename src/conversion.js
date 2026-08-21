// Conversion de format.
//
// POURQUOI ON NE LAISSE PAS ZOTIFY CONVERTIR.
//
// zotify sait transcoder, mais sa commande ffmpeg se résume au codec et au
// débit. Pas de report des métadonnées, pas de pochette, pas de contrôle du
// dither, pas de version d'étiquettes ID3. Le résultat est lisible mais nu :
// une bibliothèque de lignes vides dans Rekordbox. On lui demande donc toujours
// de livrer le fichier d'origine (« copy ») et on convertit nous-mêmes.
//
// TROIS PIÈGES DE FFMPEG, VÉRIFIÉS, QUI COÛTENT CHER SI ON LES IGNORE.
//
// 1. Le multiplexeur AIFF a `write_id3v2` à 0 PAR DÉFAUT. Sans le drapeau
//    explicite, on obtient un fichier parfaitement lisible et totalement sans
//    étiquettes. La perte est silencieuse et n'apparaît qu'à l'import.
//
// 2. ffmpeg ne dithère pas par défaut. Le décodage Vorbis sort en virgule
//    flottante ; sans dither, la réduction à 16 bits est une troncature brute,
//    audible sur les fondus et les queues de réverbération.
//
// 3. `-b:a` et `-q:a` s'excluent mutuellement sur libmp3lame. Pour du 320 en
//    débit constant, `-b:a 320k` seul.
//
// Et une règle : NE JAMAIS passer `-ar`. Les flux Spotify sont déjà en
// 44,1 kHz ; rééchantillonner ne peut que dégrader.

import fs from 'node:fs';
import path from 'node:path';

import { exécuter, trouverExécutable } from './processus.js';
import { journal } from './journal.js';
import { assurerDossier } from './chemins.js';

/** Filtre de réduction à 16 bits avec dither, commun aux cibles PCM. */
const DITHER_16 = 'aresample=out_sample_fmt=s16:dither_method=triangular_hp';

/**
 * Profils de conversion.
 *
 * `arguments` reçoit un objet indiquant si une pochette externe est jointe, et
 * renvoie les arguments propres au codec. Les arguments communs (entrées,
 * mappage, métadonnées) sont ajoutés par `construireCommande`.
 */
export const PROFILS = {
  flac: {
    extension: 'flac',
    sansPerte: true,
    libellé: 'FLAC 16 bits',
    arguments: () => ['-c:a', 'flac', '-compression_level', '8', '-af', DITHER_16],
  },
  aiff: {
    extension: 'aiff',
    sansPerte: true,
    libellé: 'AIFF 16 bits',
    // Les deux drapeaux ID3 sont obligatoires : sans le premier, aucune
    // étiquette ; sans le second, ffmpeg écrit de l'ID3v2.4 alors que Pioneer
    // documente l'ID3v2.3.
    arguments: () => [
      '-c:a', 'pcm_s16be', '-af', DITHER_16,
      '-write_id3v2', '1', '-id3v2_version', '3',
    ],
  },
  mp3_320: {
    extension: 'mp3',
    sansPerte: false,
    libellé: 'MP3 320 kb/s',
    arguments: () => [
      '-c:a', 'libmp3lame', '-b:a', '320k',
      '-id3v2_version', '3', '-write_id3v1', '1',
    ],
  },
  aac_256: {
    extension: 'm4a',
    sansPerte: false,
    libellé: 'AAC 256 kb/s',
    arguments: () => ['-c:a', 'aac', '-b:a', '256k'],
  },
};

/**
 * Où atterrirait le converti d'une source. Une seule écriture de cette règle.
 *
 * Elle était recopiée à trois endroits, et l'un d'eux a fini par diverger : la
 * moisson cherchait un jumeau que le lot ne produisait pas au même chemin.
 */
export function cheminConverti(source, format) {
  const profil = PROFILS[format];
  if (!profil) return null;
  const base = path.basename(source, path.extname(source));
  return path.join(path.dirname(source), `${base}.${profil.extension}`);
}

/** Le format « copie » ne passe jamais par ici : rien à faire. */
export function nécessiteConversion(format) {
  return format !== 'copie' && Object.hasOwn(PROFILS, format);
}

/**
 * Cherche une pochette déposée à côté du fichier audio.
 * zotify écrit parfois l'image en fichier séparé plutôt que de l'incorporer :
 * une exception d'en-tête Ogg est avalée silencieusement en amont. On la
 * récupère donc pour la réinjecter à la conversion.
 */
export function trouverPochette(cheminAudio) {
  const base = cheminAudio.slice(0, -path.extname(cheminAudio).length);
  for (const candidat of [`${base}.jpg`, `${base}.jpeg`, `${base}.png`]) {
    if (fs.existsSync(candidat)) return candidat;
  }

  // zotify peut aussi déposer une pochette unique au niveau du dossier.
  const dossier = path.dirname(cheminAudio);
  for (const nom of ['cover.jpg', 'cover.png', 'folder.jpg']) {
    const candidat = path.join(dossier, nom);
    if (fs.existsSync(candidat)) return candidat;
  }
  return null;
}

/**
 * Construit la commande complète. Extraite pour être testable sans ffmpeg :
 * c'est l'ordre et la présence des drapeaux qui comptent, pas l'exécution.
 */
export function construireCommande({ source, destination, format, pochette }) {
  const profil = PROFILS[format];
  if (!profil) throw new Error(`Format de conversion inconnu : ${format}`);

  const arguments_ = ['-hide_banner', '-loglevel', 'error', '-y', '-i', source];

  // L'AAC en conteneur MP4 gère mal une pochette ajoutée de cette façon ;
  // on l'évite plutôt que de produire un fichier que certains lecteurs refusent.
  const joindrePochette = pochette && format !== 'aac_256';
  if (joindrePochette) arguments_.push('-i', pochette);

  arguments_.push('-map', '0:a:0');
  if (joindrePochette) arguments_.push('-map', '1:v:0');

  arguments_.push(...profil.arguments({ pochette: joindrePochette }));

  if (joindrePochette) {
    arguments_.push('-c:v', 'copy', '-disposition:v', 'attached_pic');
  }

  // Report des étiquettes existantes. Sans ça, un FLAC issu d'un Ogg étiqueté
  // ressort vierge.
  //
  // `0:s:0`, PAS `0`. La source est un Ogg, et l'Ogg range ses commentaires sur
  // le FLUX : au niveau du conteneur il n'y a rien à recopier. Écrit `0`, ffmpeg
  // rendait donc un fichier sans artiste, sans titre, sans album et sans ISRC —
  // exactement le vide que ce commentaire prétendait empêcher, et une clé
  // perdue pour retrouver le morceau à l'achat. Reproduit puis corrigé le
  // 19 août 2026 sur un vrai fichier.
  arguments_.push('-map_metadata', '0:s:0');

  arguments_.push(destination);
  return arguments_;
}

/**
 * Un fichier converti doit peser une fraction plausible de sa source.
 *
 * Ce que cette garde attrape : un ffmpeg qui rend 0 après n'avoir produit
 * presque rien — quelques octets, un en-tête seul. Le code de sortie ne le
 * signale pas ; seule la taille sur disque le dit.
 *
 * CE QU'ELLE N'ATTRAPE PAS, et il ne faut pas s'y fier : une troncature à
 * MI-PARCOURS. Un FLAC issu d'un Ogg de 5 Mo en pèse environ 25 ; coupé en son
 * milieu il en fait encore 12, donc bien plus que sa source, et il passe. Idem
 * pour un format avec perte, où la moitié reste au-dessus du quart exigé. Le
 * commentaire précédent annonçait le contraire — d'où cette rectification.
 *
 * Attraper une troncature partielle demanderait de comparer les DURÉES, avec
 * ffprobe : il est déjà embarqué dans le paquet, et déjà utilisé par les exports
 * Rekordbox. C'est écrit dans docs/reste-a-faire.md.
 */
export function tailleplausible(octetsSource, octetsCible, format) {
  if (octetsCible < 16 * 1024) return false;

  // Un format sans perte à partir d'un Ogg pèse toujours nettement plus lourd.
  if (PROFILS[format]?.sansPerte) return octetsCible > octetsSource;

  // Un format avec perte reste dans un rapport raisonnable.
  return octetsCible > octetsSource * 0.25;
}

/**
 * Convertit un fichier. Écriture atomique : on produit un fichier temporaire
 * voisin, on le vérifie, et seulement alors on le met en place. Une conversion
 * interrompue ne laisse jamais un fichier incomplet à la place du bon.
 *
 * La source n'est jamais supprimée ici : c'est l'appelant qui décide, une fois
 * la conversion confirmée.
 */
export async function convertir({ source, format, dossierSortie = null, ffmpeg = null }) {
  const profil = PROFILS[format];
  if (!profil) throw new Error(`Format de conversion inconnu : ${format}`);

  const base = path.basename(source, path.extname(source));
  const dossier = dossierSortie || path.dirname(source);
  assurerDossier(dossier);

  const destination = path.join(dossier, `${base}.${profil.extension}`);

  // Les cas où il n'y a RIEN à faire se traitent avant toute autre chose, et
  // notamment avant de réclamer ffmpeg. Sans cet ordre, une bibliothèque déjà
  // convertie remonterait une erreur par morceau sur une machine où ffmpeg
  // manque — alors que tout est en place et qu'aucun travail n'est nécessaire.
  if (path.resolve(destination) === path.resolve(source)) {
    return { réussi: true, destination: source, ignoré: 'source et cible identiques' };
  }
  if (fs.existsSync(destination)) {
    // Ne jamais régénérer un fichier existant : s'il a déjà été analysé par un
    // logiciel DJ, il porte des points de repère et une grille rythmique qui
    // vivent DANS le fichier. Les écraser détruirait des heures de préparation.
    return { réussi: true, destination, ignoré: 'la cible existe déjà' };
  }

  const binaire = ffmpeg || trouverExécutable('ffmpeg');
  if (!binaire) {
    return {
      réussi: false,
      raison:
        'ffmpeg est introuvable, la conversion est impossible. Le fichier d’origine ' +
        'est conservé intact.',
    };
  }

  const temporaire = path.join(dossier, `.${base}.${process.pid}.tmp.${profil.extension}`);
  const pochette = trouverPochette(source);
  const arguments_ = construireCommande({ source, destination: temporaire, format, pochette });

  const début = Date.now();
  const résultat = await exécuter(binaire, arguments_, { délaiMs: 300000 });

  const nettoyer = () => {
    try {
      fs.unlinkSync(temporaire);
    } catch {
      /* déjà absent */
    }
  };

  if (résultat.erreur || résultat.expiré || résultat.code !== 0) {
    nettoyer();
    const détail = (résultat.stderr || résultat.erreur?.message || '').trim().split('\n')[0];
    journal.avertir(`Conversion échouée pour « ${path.basename(source)} »`, détail);
    return {
      réussi: false,
      raison: résultat.expiré
        ? 'La conversion a dépassé le temps imparti.'
        : `ffmpeg a refusé le fichier${détail ? ` : ${détail}` : '.'}`,
    };
  }

  let statSource;
  let statCible;
  try {
    statSource = fs.statSync(source);
    statCible = fs.statSync(temporaire);
  } catch {
    nettoyer();
    return { réussi: false, raison: 'Le fichier converti est introuvable après la conversion.' };
  }

  if (!tailleplausible(statSource.size, statCible.size, format)) {
    nettoyer();
    journal.avertir(
      `Conversion écartée pour « ${path.basename(source)} » : taille invraisemblable ` +
        `(${statCible.size} octets pour une source de ${statSource.size}).`,
    );
    return {
      réussi: false,
      raison: 'Le fichier produit avait une taille invraisemblable ; il a été écarté.',
    };
  }

  fs.renameSync(temporaire, destination);

  return {
    réussi: true,
    destination,
    octets: statCible.size,
    duréeMs: Date.now() - début,
    pochetteJointe: !!pochette,
  };
}

/**
 * Convertit un lot, en série.
 *
 * En série volontairement : les encodeurs audio de ffmpeg sont mono-thread, mais
 * lancer plusieurs conversions en parallèle pendant qu'un téléchargement tourne
 * ferait grimper la charge disque et la température sur un portable, pour un
 * gain nul face aux 30 secondes d'attente entre deux titres. Le transcodage
 * n'est jamais le goulot d'étranglement.
 */
export async function convertirLot({ fichiers, format, surProgrès = () => {}, signalArrêt = null }) {
  const bilan = { convertis: [], échecs: [], ignorés: [], déjàPrêts: [] };

  for (const [index, fichier] of fichiers.entries()) {
    // L'ÉTAT « DÉJÀ CONVERTI » SE CONSTATE MÊME APRÈS UN ARRÊT, et il le faut :
    // depuis que la moisson tourne pendant le téléchargement, tout est déjà
    // converti quand on arrive ici. Couper avant de le constater ferait croire
    // qu'aucune conversion n'existe, et les listes de lecture repartiraient sur
    // les sources — le défaut même que la moisson supprime.
    const attendue = cheminConverti(fichier, format);
    if (attendue && fs.existsSync(attendue) && path.resolve(attendue) !== path.resolve(fichier)) {
      bilan.ignorés.push({ fichier, raison: 'la cible existe déjà' });
      bilan.déjàPrêts.push({ source: fichier, destination: attendue });
      continue;
    }

    if (signalArrêt?.aborted) break;

    surProgrès({
      index: index + 1,
      total: fichiers.length,
      nom: path.basename(fichier),
    });

    const résultat = await convertir({ source: fichier, format });

    if (!résultat.réussi) {
      bilan.échecs.push({ fichier, raison: résultat.raison });
    } else if (résultat.ignoré) {
      bilan.ignorés.push({ fichier, raison: résultat.ignoré });
      // « DÉJÀ CONVERTI » N'EST PAS « PERDU ».
      //
      // Quand la cible existe, on refuse de la réécrire — un fichier réanalysé
      // par Serato porte des points de repère qui vivent dedans. Mais le chemin
      // de cette cible doit remonter, sinon l'appelant croit n'avoir rien
      // converti et retombe sur les sources : les listes de lecture pointaient
      // des .ogg que Rekordbox ne lit pas, alors que les .mp3 étaient à côté.
      //
      // Ce cas est devenu le cas NORMAL depuis que la conversion tourne pendant
      // le téléchargement : à la fin, tout est déjà converti.
      if (résultat.destination) {
        bilan.déjàPrêts.push({ source: fichier, destination: résultat.destination });
      }
    } else {
      bilan.convertis.push({ source: fichier, destination: résultat.destination });
    }
  }

  if (bilan.convertis.length) {
    journal.info(
      `Conversion : ${bilan.convertis.length} fichier(s) en ${PROFILS[format].libellé}` +
        `${bilan.échecs.length ? `, ${bilan.échecs.length} échec(s)` : ''}.`,
    );
  }

  return bilan;
}

// ---------------------------------------------------------------------------
// Convertir PENDANT que zotify télécharge
// ---------------------------------------------------------------------------
//
// CE QUE CETTE FONCTION RÉPARE, constaté sur le disque le 19 août 2026 : treize
// fichiers restés en Ogg alors que le réglage demandait du MP3.
//
// L'ancienne chaîne était : inventaire avant, zotify jusqu'au bout, inventaire
// après, conversion du lot. Deux exécutions arrêtées en cours de route ont donc
// téléchargé sans rien convertir — `convertirLot` sort à la première boucle
// quand l'arrêt est déjà demandé. Et RIEN ne les rattrapait ensuite : la
// conversion ne regarde que les nouveautés de l'exécution en cours, pendant que
// `--skip-existing` empêche zotify de reproposer des fichiers déjà présents. Les
// listes de lecture pointaient des .ogg que Rekordbox ne lit pas — exactement ce
// que le choix du format devait éviter.
//
// Convertir au fil de l'eau supprime la fenêtre : à l'instant de l'arrêt, tout
// ce qui est descendu est déjà converti.
//
// POURQUOI C'EST SÛR. zotify écrit dans un fichier temporaire puis le renomme :
// un fichier portant une extension audio est complet, jamais en cours
// d'écriture. Et il attend une trentaine de secondes entre deux titres, ce qui
// laisse à ffmpeg tout le temps qu'il lui faut.
//
// UNE SEULE CONVERSION À LA FOIS, volontairement : les encodeurs de ffmpeg sont
// mono-thread, mais en lancer plusieurs pendant que zotify télécharge ferait se
// disputer le disque au pire moment.

/** Extension des fichiers que zotify livre. Il télécharge toujours en « copy ». */
export const EXTENSION_SOURCE = 'ogg';

/**
 * Convertit au fil de l'eau les fichiers qui apparaissent dans un dossier.
 *
 * `convertirUn` est injectable pour que les tests éprouvent la MOISSON — quand
 * un fichier est vu, quand il est passé, quand il est ignoré — sans dépendre de
 * ffmpeg, qui a ses propres tests.
 *
 * Renvoie de quoi l'arrêter ; `arrêter()` attend la conversion en cours, fait un
 * dernier passage pour ne rien laisser derrière, et rend le bilan.
 */
export function démarrerConversionContinue({
  dossier,
  format,
  intervalleMs = 4000,
  convertirUn = convertir,
  surProgrès = () => {},
  signalArrêt = null,
}) {
  const profil = PROFILS[format];
  const bilan = { convertis: [], échecs: [] };
  const vus = new Set();

  let enCours = Promise.resolve();
  let minuterie = null;
  let arrêté = false;

  /** Les sources complètes qui n'ont pas encore leur jumeau converti. */
  const àPrendre = () => {
    let entrées;
    try {
      entrées = fs.readdirSync(dossier, { withFileTypes: true, recursive: true });
    } catch {
      return []; // le dossier n'existe pas encore : zotify ne l'a pas créé
    }

    const attendus = [];
    for (const entrée of entrées) {
      if (!entrée.isFile()) continue;
      if (path.extname(entrée.name).toLowerCase() !== `.${EXTENSION_SOURCE}`) continue;

      const complet = path.join(entrée.parentPath ?? entrée.path ?? dossier, entrée.name);
      if (vus.has(complet)) continue;

      // Un jumeau déjà là : rien à faire, et surtout rien à écraser.
      if (fs.existsSync(cheminConverti(complet, format))) {
        vus.add(complet);
        continue;
      }
      attendus.push(complet);
    }
    // Dans l'ordre du disque, qui est celui de la playlist : la progression
    // affichée suit alors ce que l'utilisateur voit descendre.
    return attendus.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  };

  // UN ARRÊT NE DOIT PAS LAISSER D'ORPHELINS, et c'est délibéré.
  //
  // On pourrait croire qu'appuyer sur « Arrêter » doit tout couper, conversion
  // comprise. C'est précisément ce que faisait l'ancienne chaîne, et le résultat
  // était treize fichiers coincés en Ogg que plus rien ne reprenait. Les
  // morceaux sont déjà sur le disque : les laisser inutilisables serait la pire
  // des deux options. La conversion des fichiers déjà descendus va donc jusqu'au
  // bout, et le journal le dit plutôt que de faire attendre sans explication.
  let annoncéAprèsArrêt = false;

  const passer = async () => {
    for (const source of àPrendre()) {
      if (signalArrêt?.aborted && !annoncéAprèsArrêt) {
        annoncéAprèsArrêt = true;
        journal.info(
          'Arrêt demandé : les titres déjà téléchargés sont convertis avant de rendre '
          + 'la main, sinon ils resteraient dans un format que votre logiciel DJ ne lit pas.',
        );
      }
      vus.add(source);

      surProgrès({ nom: path.basename(source), convertis: bilan.convertis.length + 1 });
      const résultat = await convertirUn({ source, format });

      if (résultat?.réussi && résultat.destination) {
        bilan.convertis.push({ source, destination: résultat.destination });
      } else if (résultat && !résultat.réussi) {
        bilan.échecs.push({ fichier: source, raison: résultat.raison });
      }
    }
  };

  const battre = () => {
    if (arrêté) return;
    enCours = enCours.then(passer).catch((erreur) => {
      // Une conversion qui explose ne doit pas emporter le téléchargement en
      // cours : on le note et on continue. Le fichier source reste intact.
      journal.avertir(`Conversion au fil de l’eau interrompue : ${erreur.message}`);
    });
    minuterie = setTimeout(battre, intervalleMs);
    minuterie.unref?.();
  };

  if (profil) battre();

  return {
    async arrêter() {
      arrêté = true;
      clearTimeout(minuterie);
      await enCours;
      // Un dernier passage APRÈS la fin de zotify : le ou les derniers fichiers
      // renommés pendant le dernier battement seraient sinon oubliés, et c'est
      // précisément eux que l'ancienne chaîne laissait en Ogg.
      if (profil) await passer().catch(() => {});
      return bilan;
    },
    bilan,
  };
}

/**
 * Un passage unique sur toute une bibliothèque, pour rattraper le passé.
 *
 * CE QU'IL RÉPARE : les fichiers laissés dans le mauvais format par une
 * exécution interrompue. Rien ne les reprenait — la conversion ne regarde que
 * les nouveautés de l'exécution en cours, et `--skip-existing` empêche zotify de
 * les reproposer. Ils restaient en Ogg indéfiniment, dans des listes de lecture
 * que Rekordbox ne sait pas lire.
 *
 * C'est la même moisson que pendant le téléchargement, jouée une fois : une
 * seule mécanique, donc une seule à comprendre et à garder juste.
 */
export async function rattraperConversions(options) {
  const moisson = démarrerConversionContinue({ ...options, intervalleMs: 3_600_000 });
  return moisson.arrêter();
}
