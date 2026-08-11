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
  écrireAtomique(fichierJetons(), JSON.stringify(jetons, null, 2));
}

export function oublierJetons() {
  try {
    écrireJetons({});
  } catch {
    /* rien à faire */
  }
}

/** L'utilisateur est-il connecté ? Ne dit rien de la validité du jeton. */
export function estConnecté() {
  const jetons = lireJetons();
  return !!(jetons?.refresh_token);
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
export async function terminerConnexion(code, état) {
  if (!demandeEnCours) {
    return { réussi: false, raison: 'Aucune connexion n’était en cours. Recommencez.' };
  }
  if (état !== demandeEnCours.état) {
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

/** Un jeton d'accès valable, rafraîchi si besoin. */
async function jetonValable() {
  const jetons = lireJetons();
  if (!jetons?.refresh_token) return null;

  // Une minute de marge : un jeton qui expire pendant la requête produirait une
  // erreur incompréhensible plutôt qu'un simple rafraîchissement.
  if (jetons.access_token && jetons.expire_le > Date.now() + 60000) {
    return jetons.access_token;
  }

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
    journal.avertir('Le jeton Spotify n’a pas pu être rafraîchi ; reconnexion nécessaire.');
    return null;
  }

  écrireJetons({
    ...jetons,
    ...données,
    // Spotify ne renvoie pas toujours un nouveau jeton de rafraîchissement :
    // écraser l'ancien par « undefined » déconnecterait l'utilisateur.
    refresh_token: données.refresh_token || jetons.refresh_token,
    expire_le: Date.now() + (données.expires_in ?? 3600) * 1000,
  });

  return données.access_token;
}

// ---------------------------------------------------------------------------
// Requêtes
// ---------------------------------------------------------------------------

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

  if (réponse.status === 429 && essaisRestants > 0) {
    const attente = Number(réponse.headers.get('retry-after') || 2);
    journal.avertir(`Spotify demande d’attendre ${attente} s avant de continuer.`);
    await new Promise((r) => setTimeout(r, Math.min(attente, 60) * 1000));
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

  return réponse.json();
}

/** Parcourt une ressource paginée jusqu'au bout. */
async function toutesLesPages(chemin, { max = 5000 } = {}) {
  const éléments = [];
  let suivant = chemin;

  while (suivant && éléments.length < max) {
    const page = await requête(suivant);
    éléments.push(...(page.items || []));
    suivant = page.next;
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
  const champs = 'items(added_at,is_local,track(id,name,duration_ms,disc_number,' +
    'track_number,external_ids(isrc),artists(name),album(name,release_date,images))),next';

  const items = await toutesLesPages(
    `/playlists/${idPlaylist}/tracks?limit=100&fields=${encodeURIComponent(champs)}`,
  );

  return items
    .filter((i) => i?.track?.id && !i.is_local)
    .map((i, index) => {
      const t = i.track;
      return {
        id: t.id,
        position: index + 1,
        titre: t.name,
        artiste: t.artists?.[0]?.name ?? '',
        artistes: (t.artists || []).map((a) => a.name),
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
