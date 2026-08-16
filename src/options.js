// Catalogue des options configurables.
//
// C'est la source de vérité unique : les valeurs par défaut de la configuration
// et l'interface de réglages sont toutes deux construites à partir d'ici. Ajouter
// une option se fait à un seul endroit.
//
// RÈGLE DU PROJET : chaque choix porte une ligne d'explication honnête, qui dit
// aussi l'inconvénient. Ce texte est du livrable, pas de la documentation. Il
// s'adresse à quelqu'un qui n'est pas développeur : pas de jargon, pas de sigle
// laissé nu, et jamais de promesse que le code ne tient pas.

import { dossierMusiqueParDéfaut } from './chemins.js';

/** Type d'un réglage : détermine le contrôle affiché dans l'interface. */
export const TYPE = {
  CHOIX: 'choix',       // liste d'options exclusives
  BASCULE: 'bascule',   // oui / non
  NOMBRE: 'nombre',
  TEXTE: 'texte',
  DOSSIER: 'dossier',
  HEURE: 'heure',
};

// ---------------------------------------------------------------------------
// Qualité et format
// ---------------------------------------------------------------------------

export const QUALITÉS = [
  {
    id: 'tres_elevee',
    libellé: 'Maximale — 320 kb/s',
    explication:
      "Le meilleur que Spotify livre à un outil tiers. Exige un abonnement Premium : " +
      "sans lui, Spotify redescend silencieusement à 160 kb/s sans afficher d'erreur.",
    recommandé: true,
  },
  {
    id: 'elevee',
    libellé: 'Élevée — 160 kb/s',
    explication:
      "La qualité d'un compte gratuit. Audible sur un bon casque, franchement limite " +
      "sur une sono de club.",
  },
  {
    id: 'normale',
    libellé: 'Normale — 96 kb/s',
    explication:
      "Fichiers trois fois plus petits, qualité nettement dégradée. À réserver aux " +
      "cas où la place disque est le vrai problème.",
  },
];

export const FORMATS = [
  {
    id: 'copie',
    libellé: 'Ogg d’origine — aucune conversion',
    extension: 'ogg',
    sansPerte: true,
    explication:
      "Le fichier tel que Spotify l'envoie, sans y toucher. Aucune perte ajoutée, " +
      "aucun temps de conversion. Serato, VLC, Plex et Navidrome le lisent. " +
      "Rekordbox ne le lit pas.",
    recommandé: true,
  },
  {
    id: 'flac',
    libellé: 'FLAC — pour Rekordbox, sans perte ajoutée',
    extension: 'flac',
    sansPerte: true,
    explication:
      "Convertir l'Ogg en FLAC n'ajoute aucune perte : on ré-emballe exactement le " +
      "même signal. Mais ça n'en récupère pas non plus — le fichier reste issu d'un " +
      "320 kb/s. Occupe environ 2,5 fois plus de place. C'est le bon choix si " +
      "Rekordbox est dans la boucle.",
  },
  {
    id: 'aiff',
    libellé: 'AIFF — sans perte ajoutée, métadonnées les plus riches',
    extension: 'aiff',
    sansPerte: true,
    explication:
      "Même absence de perte que le FLAC, mais quatre fois plus gros. Son seul " +
      "avantage : c'est le format dont Pioneer documente le mieux les étiquettes " +
      "(tonalité, label, remixeur). Utile pour du vieux matériel de club.",
  },
  {
    id: 'mp3_320',
    libellé: 'MP3 320 — compatible partout, une perte de plus',
    extension: 'mp3',
    sansPerte: false,
    explication:
      "Lu par absolument tout. Mais c'est une seconde compression par-dessus celle " +
      "de Spotify : ce que le premier encodeur a jugé inaudible n'est pas ce que le " +
      "second juge inaudible. En pratique on l'entend surtout sur les charleys et " +
      "l'image stéréo, précisément ce qu'une grosse sono amplifie.",
  },
  {
    id: 'aac_256',
    libellé: 'AAC 256 — pour Musique / Apple Music',
    extension: 'm4a',
    sansPerte: false,
    explication:
      "L'app Musique d'Apple ne sait importer ni Ogg ni FLAC : c'est le seul format " +
      "de cette liste qu'elle accepte vraiment. Comme le MP3, il ajoute une seconde " +
      "compression.",
  },
];

/** Texte affiché en pied de la section Qualité. Il doit rester exact. */
export const NOTE_QUALITÉ =
  "Spotify a lancé son offre sans perte en septembre 2025, et elle est incluse dans " +
  "votre abonnement Premium. Elle n'est malheureusement pas accessible ici : ce flux " +
  "est réservé aux applications officielles de Spotify. Le plafond atteignable par " +
  "zotify reste l'Ogg Vorbis à 320 kb/s. Convertir vers du FLAC ne changera rien à " +
  "cette limite — ça évite seulement d'en perdre davantage.";

// ---------------------------------------------------------------------------
// Organisation des dossiers
// ---------------------------------------------------------------------------

export const SCHÉMAS = [
  {
    id: 'par_playlist',
    libellé: 'Un dossier par playlist',
    modèle: '{playlist}/{numéro} - {artiste} - {titre}',
    explication:
      "Le plus simple et le plus lisible : chaque playlist a son dossier, les titres " +
      "sont numérotés dans l'ordre de la playlist. Un morceau présent dans trois " +
      "playlists est téléchargé trois fois.",
    recommandé: true,
    exemple: {
      playlist: 'Été 2026', numéro: '007', artiste: 'Étienne de Crécy',
      titre: 'Prix Choc', album: 'Super Discount', année: '1996', genre: 'French House',
    },
  },
  {
    id: 'bibliotheque',
    libellé: 'Bibliothèque par artiste et album',
    modèle: '{artiste}/{album}/{piste} - {titre}',
    explication:
      "L'arborescence qu'attendent Plex, Navidrome et Jellyfin. Chaque morceau n'existe " +
      "qu'une fois, où qu'il apparaisse. En contrepartie, vos playlists ne sont plus " +
      "visibles dans le Finder — elles vivent dans les fichiers .m3u générés à côté.",
    exemple: {
      artiste: 'Étienne de Crécy', album: 'Super Discount', piste: '03',
      titre: 'Prix Choc', playlist: 'Été 2026', année: '1996', genre: 'French House',
    },
  },
  {
    id: 'playlist_puis_artiste',
    libellé: 'Par playlist, puis par artiste',
    modèle: '{playlist}/{artiste}/{titre}',
    explication:
      "Un compromis : les playlists restent des dossiers séparés, mais à l'intérieur " +
      "les morceaux d'un même artiste sont regroupés. Pratique quand une playlist est " +
      "longue et qu'on cherche à l'œil.",
    exemple: {
      playlist: 'Été 2026', artiste: 'Étienne de Crécy', titre: 'Prix Choc',
      album: 'Super Discount', année: '1996', genre: 'French House',
    },
  },
  {
    id: 'par_genre',
    libellé: 'Par genre, puis par artiste',
    modèle: '{genre}/{artiste} - {titre}',
    indisponible: true,
    explication:
      "INDISPONIBLE pour l'instant, et mieux vaut le dire que de vous laisser le " +
      'découvrir sur votre disque. Le téléchargeur écrit bien le genre dans les ' +
      "étiquettes du fichier, mais il ne sait pas s'en servir pour composer un chemin " +
      '— vérifié dans son code. Si vous choisissez ce rangement, les morceaux ' +
      'atterrissent à plat, sans dossier de genre, et Zotijean vous le signale après ' +
      'la synchronisation. Les cinq autres rangements fonctionnent.',
    exemple: {
      genre: 'French House', artiste: 'Étienne de Crécy', titre: 'Prix Choc',
      playlist: 'Été 2026', album: 'Super Discount', année: '1996',
    },
  },
  {
    id: 'par_annee',
    libellé: 'Par année de sortie',
    modèle: '{année}/{artiste} - {titre}',
    explication:
      "Un dossier par année. Utile pour retrouver une époque, inutile pour retrouver " +
      "une playlist.",
    exemple: {
      année: '1996', artiste: 'Étienne de Crécy', titre: 'Prix Choc',
      playlist: 'Été 2026', album: 'Super Discount', genre: 'French House',
    },
  },
  {
    id: 'plat',
    libellé: 'Tout à plat, sans sous-dossier',
    modèle: '{artiste} - {titre}',
    explication:
      "Tous les fichiers dans un seul dossier. C'est ce que préfèrent certains DJ : " +
      "le classement se fait dans le logiciel DJ, pas dans le Finder, et un fichier " +
      "qui ne bouge jamais ne casse jamais sa bibliothèque.",
    exemple: {
      artiste: 'Étienne de Crécy', titre: 'Prix Choc', playlist: 'Été 2026',
      album: 'Super Discount', année: '1996', genre: 'French House',
    },
  },
  {
    id: 'personnalise',
    libellé: 'Modèle personnalisé',
    modèle: null, // fourni par l'utilisateur
    explication:
      "Composez votre propre arborescence avec les variables disponibles. L'aperçu " +
      "ci-dessous montre le résultat réel, y compris le nettoyage des caractères " +
      "interdits.",
    exemple: {
      playlist: 'Été 2026', numéro: '007', artiste: 'Étienne de Crécy',
      titre: 'Prix Choc', album: 'Super Discount', piste: '03', disque: '1',
      année: '1996', genre: 'French House',
    },
  },
];

/** Variables utilisables dans un modèle personnalisé, avec leur description. */
export const VARIABLES = [
  { nom: 'playlist', description: 'Nom de la playlist Spotify' },
  { nom: 'numéro', description: 'Position dans la playlist, sur 3 chiffres (007)' },
  { nom: 'artiste', description: 'Artiste principal du morceau' },
  { nom: 'titre', description: 'Titre du morceau' },
  { nom: 'album', description: 'Nom de l’album' },
  { nom: 'artiste_album', description: 'Artiste de l’album (utile pour les compilations)' },
  { nom: 'piste', description: 'Numéro de piste dans l’album, sur 2 chiffres' },
  { nom: 'disque', description: 'Numéro de disque (1 sauf album multi-disques)' },
  { nom: 'année', description: 'Année de sortie' },
  {
    nom: 'genre',
    description:
      'INDISPONIBLE pour l’instant : le téléchargeur ne sait pas s’en servir pour ' +
      'nommer un fichier. La variable est retirée du modèle et signalée.',
  },
  {
    nom: 'isrc',
    description:
      'Identifiant international du morceau (ISRC), le même sur toutes les ' +
      'plateformes. Le mettre dans le nom du fichier crée un pont fiable vers ' +
      'Rekordbox ou Serato sans jamais réécrire le fichier lui-même.',
  },
];

// ---------------------------------------------------------------------------
// Retrait d'un titre d'une playlist
// ---------------------------------------------------------------------------

export const POLITIQUES_RETRAIT = [
  {
    id: 'conserver',
    libellé: 'Ne rien faire — garder le fichier',
    explication:
      "Le fichier reste où il est. C'est le réglage sûr : un morceau retiré du " +
      "catalogue Spotify ne fait pas disparaître la seule copie que vous possédez.",
    recommandé: true,
  },
  {
    id: 'archiver',
    libellé: 'Déplacer vers un dossier d’archive',
    explication:
      "Le fichier partirait dans « _Archive/<date> ». Vous garderiez tout, mais le " +
      "dossier de la playlist refléterait son contenu actuel.",
  },
  {
    id: 'corbeille',
    libellé: 'Mettre à la corbeille',
    explication:
      "Le fichier partirait à la corbeille du système — récupérable tant que vous ne " +
      "la videz pas. Jamais de suppression définitive.",
  },
];

/** Dit franchement pourquoi les deux dernières options ne s'appliquent pas encore. */
export const NOTE_RETRAIT =
  "À ce jour, seule l'option « ne rien faire » a un effet, et c'est celle qui est " +
  "active : aucun de vos fichiers n'est jamais déplacé ni jeté. Les deux autres sont " +
  "écrites et testées, mais rien ne les déclenche encore.";

/**
 * Précision affichée juste sous la note ci-dessus.
 *
 * Séparée pour une raison de fond : la première phrase dit ce que fait l'app
 * aujourd'hui, celle-ci dit pourquoi. Le « pourquoi » a changé et se périmera
 * encore ; la promesse, elle, ne bouge pas.
 *
 * L'ancienne version affirmait que la connexion Spotify manquait. Elle existe
 * depuis, et elle donne bien la composition exacte des playlists — donc ce qui
 * bloquait n'est plus ce qu'on annonçait. Ce qui reste est un choix, pas une
 * limite technique.
 */
export const NOTE_RETRAIT_POURQUOI =
  "Ce qui manquait — savoir quels titres ont réellement quitté une playlist — est " +
  "désormais possible quand votre compte Spotify est connecté. Ce qui reste est " +
  "délibéré : déplacer ou jeter des fichiers de votre bibliothèque doit être branché " +
  "avec vous, en regardant ce que ça donne sur vos vrais morceaux, pas activé un soir " +
  "dans votre dos. Les points de repère de Serato vivent dans ces fichiers.";

// ---------------------------------------------------------------------------
// Sort des fichiers d'origine après conversion
// ---------------------------------------------------------------------------

export const SOURCES_APRÈS_CONVERSION = [
  {
    id: 'conserver',
    libellé: 'Garder les fichiers d’origine',
    explication:
      "Le fichier Ogg d'origine reste à côté du fichier converti. C'est ce qui permet " +
      "de changer de format plus tard sans retélécharger — précieux quand un rattrapage " +
      "complet prend 17 heures. Coût : environ 40 % de place en plus.",
    recommandé: true,
  },
  {
    id: 'archiver',
    libellé: 'Les déplacer dans « _Archive »',
    explication:
      "SANS EFFET pour l'instant, et mieux vaut le dire : le téléchargeur repère les " +
      "morceaux déjà pris en regardant les fichiers présents. Déplacer l'Ogg d'origine " +
      "lui ferait tout retélécharger à chaque synchronisation — 17 heures à chaque " +
      "fois. Tant que ce n'est pas résolu, les fichiers sont conservés quoi qu'il " +
      "arrive, et l'app vous le rappelle après chaque conversion.",
  },
  {
    id: 'corbeille',
    libellé: 'Les mettre à la corbeille',
    explication:
      "SANS EFFET pour l'instant, pour la même raison que l'archivage : retirer les " +
      "fichiers d'origine déclencherait leur retéléchargement complet à chaque " +
      "synchronisation. Les fichiers sont conservés quoi qu'il arrive.",
  },
];

// ---------------------------------------------------------------------------
// Rythme de téléchargement
// ---------------------------------------------------------------------------

export const RYTHMES = [
  {
    id: 'prudent',
    libellé: 'Prudent — 30 secondes entre chaque titre',
    attente: 30,
    explication:
      "Le rythme conseillé par l'auteur de zotify. C'est lent — comptez environ 17 " +
      "heures pour 2 000 titres — mais c'est ce qui évite les erreurs de clé audio et " +
      "ce qui limite le plus le risque pour votre compte Spotify.",
    recommandé: true,
  },
  {
    id: 'equilibre',
    libellé: 'Équilibré — 10 secondes',
    attente: 10,
    explication:
      "Trois fois plus rapide. Les erreurs de clé audio commencent à apparaître sur " +
      "les gros lots, et le motif de consommation devient plus visible côté Spotify.",
  },
  {
    id: 'rapide',
    libellé: 'Rapide — 3 secondes',
    attente: 3,
    explication:
      "À réserver aux petits rattrapages de quelques titres. Sur une grosse " +
      "bibliothèque, c'est le meilleur moyen de se faire limiter, voire de déclencher " +
      "une réinitialisation forcée du mot de passe Spotify.",
  },
];

// ---------------------------------------------------------------------------
// Planification
// ---------------------------------------------------------------------------

export const INTERVALLES = [
  { id: 6, libellé: 'Toutes les 6 heures' },
  { id: 12, libellé: 'Deux fois par jour' },
  { id: 24, libellé: 'Une fois par jour' },
  { id: 48, libellé: 'Tous les deux jours', recommandé: true },
  { id: 72, libellé: 'Tous les trois jours' },
  { id: 168, libellé: 'Une fois par semaine' },
];

export const NOTE_PLANIFICATION =
  "L'heure exacte n'est jamais garantie : si le Mac dort ou est éteint au moment " +
  "prévu, la vérification se déclenche au réveil. C'est voulu — un minuteur classique " +
  "se fige pendant la veille et dériverait de plusieurs heures par semaine.";

// ---------------------------------------------------------------------------
// Exports vers les logiciels DJ
// ---------------------------------------------------------------------------

export const EXPORTS_DJ = [
  {
    id: 'rekordbox',
    libellé: 'Rekordbox',
    explication:
      "Écrit un fichier « rekordbox.xml » que vous importez une fois : Préférences > " +
      "Avancé > Base de données > rekordbox xml > Ajouter une bibliothèque. Vos playlists " +
      "Spotify y apparaissent, prêtes à glisser dans votre collection. Bonus : le fichier " +
      "transporte la tonalité, le label et le remixeur, que Rekordbox ne lirait jamais " +
      "depuis les fichiers eux-mêmes.",
  },
  {
    id: 'serato',
    libellé: 'Serato DJ',
    explication:
      "Écrit directement les crates, une par playlist. Attention : Serato doit être " +
      "complètement fermé pendant l'écriture, sinon il réécrit ses propres fichiers en " +
      "quittant et efface tout. Zotijean vérifie et refuse d'écrire s'il tourne.",
  },
];

export const NOTE_EXPORTS_DJ =
  "Ni Rekordbox ni Serato n'ont de dossier surveillé : rien n'apparaît tout seul dans " +
  "leur bibliothèque, il faut importer une fois. Et sachez que Rekordbox ignore " +
  "totalement le tempo écrit dans les fichiers — il impose toujours sa propre analyse. " +
  "La tonalité, elle, passe bien.";

// ---------------------------------------------------------------------------
// Valeurs par défaut de la configuration
// ---------------------------------------------------------------------------

export function configParDéfaut() {
  return {
    version: 1,
    général: {
      dossierMusique: dossierMusiqueParDéfaut(),
      port: 8787,
      ouvrirNavigateurAuDémarrage: true,
    },
    zotify: {
      commande: 'zotify', // remplacé par un chemin absolu si le diagnostic en trouve un
      argumentsSupplémentaires: '',
    },
    // Connexion à l'API officielle de Spotify. Entièrement facultative :
    // l'application fonctionne sans, avec moins de précision.
    // Les jetons ne sont PAS ici mais dans un fichier séparé, pour qu'un
    // rapport de diagnostic — qui reprend les réglages — ne puisse pas les
    // divulguer.
    spotify: {
      actif: false,
      clientId: '',
    },
    qualité: {
      niveau: 'tres_elevee',
      format: 'copie',
      // Désactivé par défaut : dans une bibliothèque DJ, un fichier de paroles
      // à côté de chaque morceau est du bruit que personne n'a demandé. Le
      // téléchargeur, lui, les écrit d'office — c'est un choix qu'on retire à
      // l'utilisateur si on ne l'expose pas.
      paroles: false,
    },
    organisation: {
      schéma: 'par_playlist',
      modèlePersonnalisé: '{playlist}/{numéro} - {artiste} - {titre}',
      écrireM3U: true,
      // « minusculeForcée » et « remplacerEspacesPar » ont été RETIRÉS.
      // Ils n'étaient exposés nulle part, mais ils s'appliquaient au chemin que
      // Zotijean CHERCHE sans jamais être transmis à zotify, qui écrit ses
      // fichiers autrement. Activés, ils auraient fait chercher dans un dossier
      // différent de celui réellement utilisé : rien n'aurait été reconnu, et
      // toute la bibliothèque se serait retéléchargée à chaque passage.
      // La fonction d'assainissement sait toujours les appliquer ; simplement,
      // plus rien ne peut les activer.
    },
    planification: {
      actif: true,
      intervalleHeures: 48,
      heuresCalmes: { actif: false, début: '23:00', fin: '08:00' },
      uniquementSurSecteur: false,
      uniquementEnWifi: false,
    },
    rythme: {
      préréglage: 'prudent',
      attenteEntreTitres: 30,
    },
    retrait: {
      politique: 'conserver',
      sourcesAprèsConversion: 'conserver',
    },
    exportsDJ: {
      rekordbox: false,
      serato: false,
      automatique: false,
    },
    gardes: {
      espaceMinimumGo: 2,
      margeParTitreMo: 12,
    },
    playlists: [],
  };
}

/** Retrouve une entrée de catalogue par son identifiant. */
export function trouver(catalogue, id) {
  return catalogue.find((entrée) => entrée.id === id) || null;
}

/** Le catalogue complet, tel que l'interface le consomme. */
export function catalogueComplet() {
  return {
    qualités: QUALITÉS,
    formats: FORMATS,
    noteQualité: NOTE_QUALITÉ,
    schémas: SCHÉMAS,
    variables: VARIABLES,
    politiquesRetrait: POLITIQUES_RETRAIT,
    noteRetrait: NOTE_RETRAIT,
    noteRetraitPourquoi: NOTE_RETRAIT_POURQUOI,
    sourcesAprèsConversion: SOURCES_APRÈS_CONVERSION,
    rythmes: RYTHMES,
    intervalles: INTERVALLES,
    notePlanification: NOTE_PLANIFICATION,
    exportsDJ: EXPORTS_DJ,
    noteExportsDJ: NOTE_EXPORTS_DJ,
  };
}
