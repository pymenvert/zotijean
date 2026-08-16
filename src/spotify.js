// Client de l'API Web officielle de Spotify — lecture seule.
//
// CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS.
//
// Il lit vos playlists : leur nom, leur contenu, leur identifiant de version, et
// le code ISRC de chaque morceau. Il ne télécharge rien, n'écrit rien chez
// Spotify, et ne demande aucune permission d'écriture.
//
// Tout est OPTIONNEL. Sans connexion, l'application fonctionne exactement comme
// avant : elle passe les liens à zotify et regarde ce qui apparaît sur le
// disque. Avec la connexion, elle sait en plus quels morceaux manquent, quelles
// playlists n'ont pas bougé, et lesquels ont été retirés.
//
// AUTHENTIFICATION. Code d'autorisation avec PKCE, sans secret client : c'est
// la méthode prévue pour les applications de bureau, qui ne peuvent garder
// aucun secret. Le jeton vit dans un fichier séparé du fichier de réglages —
// ainsi le rapport de diagnostic, qui reprend les réglages, ne peut pas le
// divulguer.

import crypto from 'node:crypto';
import path from 'node:path';

import { dossierDonnées, écrireAtomique, lireJSON, assurerDossier } from './chemins.js';
import { journal } from './journal.js';

const AUTORISATION = 'https://accounts.spotify.com/authorize';
const JETON = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

/**
 * Permissions demandées, réduites au strict nécessaire.
 * Aucune permission d'écriture : Zotijean ne modifie jamais vos playlists.
 */
const PERMISSIONS = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
].join(' ');

const fichierJetons = () => path.join(dossierDonnées(), 'spotify.json');

// ---------------------------------------------------------------------------
// Jetons
// ---------------------------------------------------------------------------

function lireJetons() {
  return lireJSON(fichierJetons(), null);
}

function écrireJetons(jetons) {
  assurerDossier(dossierDonnées());
  // Lisible et modifiable par son seul propriétaire. Le dossier par défaut de
  // macOS est déjà restreint, mais ZOTIJEAN_DONNEES peut pointer ailleurs.
  écrireAtomique(fichierJetons(), JSON.stringify(jetons, null, 2), { mode: 0o600 });
}

export function oublierJetons() {
  try {
    écrireJetons({});
  } catch {
    /* rien à faire */
  }
}

/**
 * L'utilisateur est-il connecté, et la connexion est-elle encore valable ?
 *
 * Un jeton de rafraîchissement présent ne suffit pas : Spotify peut l'avoir
 * révoqué. Répondre « oui » dans ce cas ferait afficher « connecté » à une app
 * dont toutes les fonctions Spotify échouent en silence.
 */
export function estConnecté() {
  const jetons = lireJetons();
  return !!(jetons?.refresh_token) && !jetons.reconnexionNécessaire;
}

/** Une reconnexion est-elle explicitement exigée par Spotify ? */
export function reconnexionNécessaire() {
  return !!lireJetons()?.reconnexionNécessaire;
}

// ---------------------------------------------------------------------------
// Connexion (PKCE)
// ---------------------------------------------------------------------------

/** Une demande de connexion en cours. Volatile : une seule à la fois suffit. */
let demandeEnCours = null;

const base64url = (tampon) => tampon.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Prépare l'URL de connexion.
 *
 * PKCE : on tire un secret aléatoire, on n'en envoie que l'empreinte, et on ne
 * révèle le secret qu'au moment de l'échange. Un tiers qui intercepterait le
 * code d'autorisation ne pourrait donc rien en faire.
 */
export function préparerConnexion(clientId, redirection) {
  const vérificateur = base64url(crypto.randomBytes(48));
  const défi = base64url(crypto.createHash('sha256').update(vérificateur).digest());
  const état = base64url(crypto.randomBytes(16));

  demandeEnCours = { vérificateur, état, clientId, redirection, date: Date.now() };

  const paramètres = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirection,
    scope: PERMISSIONS,
    code_challenge_method: 'S256',
    code_challenge: défi,
    state: état,
    show_dialog: 'true',
  });

  return `${AUTORISATION}?${paramètres}`;
}

/**
 * Échange le code reçu contre des jetons.
 * `état` est vérifié : sans ce contrôle, un tiers pourrait faire aboutir chez
 * vous une connexion qu'il a lui-même initiée.
 */
/** Au-delà, une demande de connexion abandonnée n'a plus lieu d'aboutir. */
const VALIDITÉ_DEMANDE_MS = 10 * 60 * 1000;

export async function terminerConnexion(code, état) {
  if (!demandeEnCours) {
    return { réussi: false, raison: 'Aucune connexion n’était en cours. Recommencez.' };
  }

  const âge = Date.now() - demandeEnCours.date;
  if (âge > VALIDITÉ_DEMANDE_MS || âge < 0) {
    demandeEnCours = null;
    return {
      réussi: false,
      raison: 'La demande de connexion a expiré. Relancez-la depuis les réglages.',
    };
  }

  if (état !== demandeEnCours.état) {
    // On efface aussi dans ce cas : une demande dont la réponse ne correspond
    // pas ne doit pas rester disponible pour une tentative suivante.
    demandeEnCours = null;
    return { réussi: false, raison: 'La réponse de Spotify ne correspond pas à la demande.' };
  }

  const { vérificateur, clientId, redirection } = demandeEnCours;
  demandeEnCours = null;

  const réponse = await fetch(JETON, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirection,
      client_id: clientId,
      code_verifier: vérificateur,
    }),
  });

  const données = await réponse.json().catch(() => ({}));

  if (!réponse.ok) {
    journal.erreur('Connexion Spotify refusée.', données.error_description || données.error);
    return {
      réussi: false,
      raison: traduireErreurConnexion(données),
    };
  }

  écrireJetons({
    ...données,
    client_id: clientId,
    expire_le: Date.now() + (données.expires_in ?? 3600) * 1000,
  });

  journal.info('Connexion à Spotify réussie.');
  return { réussi: true };
}

function traduireErreurConnexion(données) {
  const code = données.error;
  if (code === 'invalid_client') {
    return 'L’identifiant d’application est refusé par Spotify. Vérifiez-le dans les réglages.';
  }
  if (code === 'invalid_grant') {
    return 'L’adresse de retour ne correspond pas à celle enregistrée chez Spotify. ' +
      'Elle doit être recopiée à l’identique dans le tableau de bord développeur.';
  }
  return données.error_description || 'Spotify a refusé la connexion.';
}

/**
 * Rafraîchissement en cours, s'il y en a un.
 *
 * Sans ce partage, deux requêtes simultanées lancent deux rafraîchissements :
 * le second consomme le jeton du premier, et le perdant écrit un jeton déjà
 * périmé. L'utilisateur se retrouve déconnecté sans avoir rien fait.
 */
let rafraîchissementEnVol = null;

/** Un jeton d'accès valable, rafraîchi si besoin. */
async function jetonValable() {
  const jetons = lireJetons();
  if (!jetons?.refresh_token) return null;

  // Une minute de marge : un jeton qui expire pendant la requête produirait une
  // erreur incompréhensible plutôt qu'un simple rafraîchissement.
  if (jetons.access_token && jetons.expire_le > Date.now() + 60000) {
    return jetons.access_token;
  }

  if (!rafraîchissementEnVol) {
    rafraîchissementEnVol = rafraîchir().finally(() => {
      rafraîchissementEnVol = null;
    });
  }
  return rafraîchissementEnVol;
}

async function rafraîchir() {
  // On RELIT le fichier ici : entre l'appel et l'exécution, un autre
  // rafraîchissement a pu aboutir, ou l'utilisateur a pu se déconnecter — et
  // ressusciter ses identifiants serait pire qu'un échec.
  const jetons = lireJetons();
  if (!jetons?.refresh_token) return null;

  const réponse = await fetch(JETON, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: jetons.refresh_token,
      client_id: jetons.client_id,
    }),
  });

  const données = await réponse.json().catch(() => ({}));

  if (!réponse.ok) {
    // DEUX ÉCHECS TRÈS DIFFÉRENTS, QU'IL NE FAUT PAS CONFONDRE.
    //
    // Une coupure réseau ou une panne côté Spotify se répare toute seule : il
    // n'y a rien à demander à l'utilisateur, et l'inquiéter serait déplacé.
    //
    // Une autorisation révoquée — mot de passe changé, accès retiré depuis le
    // compte Spotify — ne se réparera JAMAIS sans une reconnexion. Or le jeton
    // de rafraîchissement reste dans le fichier, donc l'app continuait
    // d'afficher « connecté » pendant que plus rien ne fonctionnait. On note
    // donc le refus, sans effacer quoi que ce soit.
    const définitif = (réponse.status === 400 || réponse.status === 401)
      && données.error === 'invalid_grant';

    if (définitif) {
      écrireJetons({ ...jetons, reconnexionNécessaire: true });
      journal.erreur(
        'Spotify a révoqué l’autorisation de Zotijean. Les fonctions qui en dépendent ' +
          'sont suspendues jusqu’à une reconnexion depuis les réglages. Le téléchargement, ' +
          'lui, continue de fonctionner : il passe par zotify, pas par cette connexion.',
      );
    } else {
      journal.avertir(
        'Le jeton Spotify n’a pas pu être rafraîchi (problème passager). ' +
          'Nouvelle tentative à la prochaine requête.',
      );
    }
    return null;
  }

  écrireJetons({
    ...jetons,
    ...données,
    // Spotify ne renvoie pas toujours un nouveau jeton de rafraîchissement :
    // écraser l'ancien par « undefined » déconnecterait l'utilisateur.
    refresh_token: données.refresh_token || jetons.refresh_token,
    expire_le: Date.now() + (données.expires_in ?? 3600) * 1000,
    // Ce rafraîchissement a réussi : quoi qu'il se soit passé avant, la
    // connexion est valable. L'étalement de `jetons` ci-dessus aurait sinon
    // reconduit un drapeau de reconnexion périmé, et l'app aurait continué de
    // réclamer une reconnexion dont elle n'a plus besoin.
    reconnexionNécessaire: false,
  });

  return données.access_token;
}

// ---------------------------------------------------------------------------
// Requêtes
// ---------------------------------------------------------------------------

/**
 * L'en-tête indiquant combien de temps patienter, en secondes.
 * Il peut aussi être une date au format HTTP : la lire comme un nombre donnait
 * alors `NaN`, et quatre requêtes partaient sans la moindre pause.
 */
export function lireRetryAfter(brut) {
  // L'en-tête absent est le cas le plus fréquent, et le piège : `Number('')` et
  // `Number(null)` valent ZÉRO — finis et positifs — donc un simple test de
  // validité laisserait repartir la requête sans la moindre pause, ce qui
  // aggrave précisément la limitation qu'on cherche à respecter.
  const texte = String(brut ?? '').trim();
  if (!texte) return 2;

  // Une valeur numérique NÉGATIVE est malformée : la laisser filer vers
  // l'analyse de date donnerait zéro, donc aucune attente.
  const secondes = Number(texte);
  if (Number.isFinite(secondes)) return secondes >= 0 ? secondes : 2;

  const date = Date.parse(texte);
  if (Number.isFinite(date)) return Math.max(0, (date - Date.now()) / 1000);

  return 2;
}

export class ErreurSpotify extends Error {
  constructor(message, { reconnexion = false, statut = 0 } = {}) {
    super(message);
    this.reconnexion = reconnexion;
    this.statut = statut;
  }
}

/**
 * Une requête vers l'API, avec gestion de la limitation de débit.
 *
 * Spotify répond 429 avec un en-tête indiquant combien de temps attendre. Ne
 * pas le respecter aggrave la limitation ; on patiente donc et on réessaie,
 * dans une limite raisonnable.
 */
async function requête(chemin, { essaisRestants = 3 } = {}) {
  const jeton = await jetonValable();
  if (!jeton) {
    throw new ErreurSpotify(
      'La connexion à Spotify a expiré. Reconnectez-vous depuis les réglages.',
      { reconnexion: true },
    );
  }

  const réponse = await fetch(chemin.startsWith('http') ? chemin : `${API}${chemin}`, {
    headers: { Authorization: `Bearer ${jeton}` },
  });

  if (réponse.status === 429) {
    const attente = lireRetryAfter(réponse.headers.get('retry-after'));

    // Au-delà d'une minute, on n'attend PAS : on rend la main avec un message
    // clair. Patienter une heure figerait la synchronisation, et attendre
    // seulement soixante secondes comme avant revenait à ignorer la consigne de
    // Spotify — ce qui aggrave la limitation.
    if (attente > 60 || essaisRestants <= 0) {
      throw new ErreurSpotify(
        `Spotify limite temporairement les requêtes et demande d’attendre ` +
        `${Math.round(attente / 60)} minute(s). Réessayez plus tard.`,
        { statut: 429 },
      );
    }

    journal.avertir(`Spotify demande d’attendre ${attente} s avant de continuer.`);
    await new Promise((r) => setTimeout(r, attente * 1000));
    return requête(chemin, { essaisRestants: essaisRestants - 1 });
  }

  if (réponse.status === 401) {
    throw new ErreurSpotify(
      'Spotify a refusé la connexion. Reconnectez-vous depuis les réglages.',
      { reconnexion: true, statut: 401 },
    );
  }

  if (réponse.status === 403) {
    throw new ErreurSpotify(
      'Spotify refuse l’accès à cette ressource. Si votre application est en mode ' +
      'développement, votre compte doit être ajouté à sa liste d’utilisateurs.',
      { statut: 403 },
    );
  }

  if (!réponse.ok) {
    const corps = await réponse.json().catch(() => ({}));
    throw new ErreurSpotify(
      corps?.error?.message || `Spotify a répondu ${réponse.status}.`,
      { statut: réponse.status },
    );
  }

  try {
    return await réponse.json();
  } catch {
    // Un portail Wi-Fi captif renvoie sa propre page HTML avec un code 200 :
    // sans ce message, l'utilisateur lisait « Unexpected token '<' » et n'avait
    // aucun moyen de comprendre.
    throw new ErreurSpotify(
      'La réponse reçue n’est pas celle de Spotify. Si vous êtes sur un réseau ' +
      'public, une page de connexion Wi-Fi intercepte peut-être le trafic : ' +
      'ouvrez votre navigateur pour vous y connecter, puis réessayez.',
    );
  }
}

/** Parcourt une ressource paginée jusqu'au bout. */
async function toutesLesPages(chemin, { max = 10000 } = {}) {
  const éléments = [];
  let suivant = chemin;
  let pages = 0;

  while (suivant && éléments.length < max && pages < 200) {
    const page = await requête(suivant);
    éléments.push(...(page.items || []));
    suivant = page.next;
    pages += 1;

    // On ne suit un lien de page suivante que s'il reste chez Spotify : il
    // porte notre jeton en en-tête, et une réponse détournée l'enverrait
    // ailleurs.
    if (suivant && !String(suivant).startsWith('https://api.spotify.com/')) {
      journal.avertir('Lien de pagination inattendu, ignoré par précaution.');
      break;
    }
  }

  // Une troncature silencieuse ferait croire à une playlist plus courte
  // qu'elle n'est, donc à des morceaux absents qui n'existent pas.
  if (suivant) {
    journal.avertir(
      `Playlist tronquée à ${éléments.length} éléments : elle dépasse ce que ` +
      'Zotijean lit en une fois.',
    );
    éléments.tronquée = true;
  }

  return éléments;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function profil() {
  const moi = await requête('/me');
  return {
    nom: moi.display_name || moi.id,
    identifiant: moi.id,
    pays: moi.country,
    premium: moi.product === 'premium',
  };
}

/** Les playlists de l'utilisateur, pour le sélecteur. */
export async function mesPlaylists() {
  const brutes = await toutesLesPages('/me/playlists?limit=50');
  return brutes.filter(Boolean).map((p) => ({
    id: p.id,
    nom: p.name,
    url: `https://open.spotify.com/playlist/${p.id}`,
    nbTitres: p.tracks?.total ?? 0,
    version: p.snapshot_id,
    propriétaire: p.owner?.display_name || p.owner?.id,
    image: p.images?.[0]?.url ?? null,
    collaborative: !!p.collaborative,
  }));
}

/**
 * L'identifiant de version d'une playlist, en UNE requête.
 *
 * C'est le gain le plus net de l'API : si cet identifiant n'a pas changé depuis
 * la dernière synchronisation, la playlist est identique et on peut la sauter
 * entièrement — au lieu de lancer zotify et d'attendre qu'il vérifie titre par
 * titre, à trente secondes de patience chacun.
 */
export async function versionPlaylist(idPlaylist) {
  const p = await requête(`/playlists/${idPlaylist}?fields=snapshot_id,name,tracks(total)`);
  return { version: p.snapshot_id, nom: p.name, nbTitres: p.tracks?.total ?? 0 };
}

/**
 * Le contenu d'une playlist : un objet par morceau, avec son ISRC.
 *
 * `fields` limite la réponse à ce dont on a besoin. Sans ce filtre, Spotify
 * renvoie plusieurs centaines de kilo-octets par page — inutiles et lents.
 */
export async function contenuPlaylist(idPlaylist) {
  // « type » figure dans la liste, et ce n'est pas décoratif : le filtrage des
  // épisodes de podcast repose sur lui. Une version précédente ne le demandait
  // pas — Spotify ne renvoie QUE les champs demandés, donc le type n'arrivait
  // jamais, et le filtre « épisode » laissait tout passer en croyant filtrer.
  const champs = 'items(added_at,is_local,track(type,id,name,duration_ms,disc_number,' +
    'track_number,external_ids(isrc),artists(name),album(name,release_date,images))),next';

  const items = await toutesLesPages(
    `/playlists/${idPlaylist}/tracks?limit=100&fields=${encodeURIComponent(champs)}`,
  );

  return normaliserPistes(items);
}

/**
 * Transforme les éléments bruts d'une playlist Spotify en pistes exploitables.
 *
 * Trois familles d'éléments sont écartées, chacune vue dans de vraies
 * playlists :
 * - une piste NULLE — morceau retiré du catalogue, l'élément reste avec un
 *   trou à la place ; y lire un titre ferait tomber tout l'inventaire ;
 * - un FICHIER LOCAL — présent dans la playlist de l'utilisateur mais absent
 *   du catalogue, sans identifiant : intéléchargeable par construction ;
 * - un ÉPISODE de podcast — zotify ne les télécharge pas depuis une playlist,
 *   et les compter ferait apparaître des morceaux éternellement manquants.
 */
export function normaliserPistes(items) {
  // Un corps d'erreur de l'API à la place d'un tableau ne doit pas lever plus
  // loin que cette ligne.
  return (Array.isArray(items) ? items : [])
    .filter((i) => i?.track?.id && !i.is_local && (i.track.type ?? 'track') === 'track')
    .map((i, index) => {
      const t = i.track;
      // Le trou peut être À L'INTÉRIEUR de la liste des artistes, pas
      // seulement à la place de la piste : un « artists: [null] » plantait la
      // lecture entière, et l'analyse Spotify de la playlist restait dégradée
      // pour toujours — le rattrapage du catch en amont n'a aucun moyen de
      // guérir. Chaque maillon est donc filtré, y compris les objets sans nom
      // qui fabriqueraient des empreintes « undefined ».
      const artistes = (t.artists || [])
        .filter(Boolean)
        .map((a) => a.name)
        .filter(Boolean);
      return {
        id: t.id,
        position: index + 1,
        titre: t.name,
        artiste: artistes[0] ?? '',
        artistes,
        album: t.album?.name ?? '',
        année: (t.album?.release_date || '').slice(0, 4),
        numéroPiste: t.track_number ?? 0,
        numéroDisque: t.disc_number ?? 1,
        duréeMs: t.duration_ms ?? 0,
        // La clé de jointure vers une autre source : c'est l'identifiant
        // international de l'enregistrement, stable d'une plateforme à l'autre.
        isrc: t.external_ids?.isrc ?? null,
        ajoutéLe: i.added_at ?? null,
        pochette: t.album?.images?.[0]?.url ?? null,
      };
    });
}

/** Extrait l'identifiant d'une URL de playlist déjà validée en amont. */
export function idDepuisURL(url) {
  const correspondance = String(url).match(/playlist\/([A-Za-z0-9]+)/);
  return correspondance ? correspondance[1] : null;
}
