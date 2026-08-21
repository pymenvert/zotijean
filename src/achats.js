// Où racheter un morceau en vrai sans-perte.
//
// Spotify plafonne à l'Ogg 320 kb/s avec perte. Convertir n'ajoute pas de perte
// mais ne récupère rien : le seul chemin vers un vrai FLAC est de racheter le
// morceau ailleurs. Ce module fait le travail de recherche, et rien d'autre —
// il n'achète pas, ne télécharge pas, ne remplace aucun fichier.
//
// ---------------------------------------------------------------------------
// POURQUOI DEUX SOURCES, ET DANS CET ORDRE — mesuré, pas supposé
// ---------------------------------------------------------------------------
//
// Un sondage a été mené le 19 août 2026 sur 17 morceaux réels de la
// bibliothèque, en partant des ISRC fournis par Spotify. Résultats, par chemin :
//
//   ISRC → MusicBrainz → liens de l'enregistrement ....  0 / 13   (0 %)
//   ISRC → MusicBrainz → liens des sorties ...........   2 / 13   (15 %)
//   artiste+titre → MusicBrainz → liens des sorties ...  8 / 17   (47 %)
//   artiste+titre → Bandcamp, vente confirmée .........  14 / 17  (82 %)
//   les deux réunies ..................................  15 / 17  (88 %)
//
// Trois enseignements, tous contre-intuitifs, tous coûteux à redécouvrir :
//
// 1. L'ISRC est une mauvaise clé. Non pas parce que MusicBrainz ignore ces
//    morceaux — il en connaît 9 sur 13 — mais parce qu'il n'a AUCUN ISRC
//    attaché à 7 d'entre eux. Son index ISRC est vide sur du répertoire
//    électronique. On l'essaie quand même en premier quand il existe : quand il
//    répond, il est plus sûr qu'une recherche par nom.
//
// 2. Dans MusicBrainz, les liens d'achat vivent sur les SORTIES (albums, EP),
//    jamais sur l'enregistrement. Interroger l'enregistrement seul rend zéro.
//
// 3. Bandcamp est de loin la meilleure source sur ce répertoire, et de loin la
//    plus fragile. Voir l'avertissement ci-dessous.
//
// ---------------------------------------------------------------------------
// LA FRAGILITÉ DE BANDCAMP, ÉCRITE ICI POUR QU'ELLE NE SURPRENNE PERSONNE
// ---------------------------------------------------------------------------
//
// Bandcamp n'a pas d'interface publique documentée : celle qu'il publie est
// réservée à ses labels vendeurs, pour leurs relevés de ventes. Ce module
// utilise le point d'entrée de son PROPRE champ de recherche — public, sans
// authentification, mais NON DOCUMENTÉ. Il peut changer de forme ou cesser de
// répondre du jour au lendemain, sans préavis et sans que ce soit un défaut
// d'ici.
//
// Trois conséquences, toutes tenues par le code plus bas :
//   - la source est débrayable (`sources.bandcamp`), et le rapport reste utile
//     sans elle : on retombe sur MusicBrainz, mesuré à 47 % ;
//   - une panne de Bandcamp N'INTERROMPT PAS le rapport, elle désactive la
//     source pour le reste de l'exécution et le dit une fois dans le journal ;
//   - le rythme est volontairement lent — une requête par seconde, jamais en
//     parallèle. C'est la charge d'un humain qui navigue, pas celle d'un robot.
//
// ---------------------------------------------------------------------------
// CE QUE « SANS PERTE » VEUT DIRE ICI
// ---------------------------------------------------------------------------
//
// Bandcamp propose le FLAC sur TOUT téléchargement numérique payant ou gratuit :
// une page vendable équivaut donc à un FLAC disponible, sans vérification
// supplémentaire. C'est le seul endroit où cette équivalence tient toute seule.
//
// Ailleurs il faut trancher boutique par boutique, et une erreur ici ferait
// mentir le rapport sur son unique promesse. Apple Music et Amazon MP3 vendent
// de l'AAC et du MP3 : un lien vers eux n'est PAS un lien sans perte, et il est
// classé comme tel même quand MusicBrainz l'annonce en « achat ».

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

import { journal } from './journal.js';
import { dossierDonnées, écrireAtomique, lireJSON, assurerDossier } from './chemins.js';
import { listerAudio, sansSourcesConverties } from './bibliotheque.js';
import { lireMétadonnées } from './exports-dj.js';
import { trouver, FORMATS } from './options.js';

/** Requis par MusicBrainz, et simple politesse ailleurs. Jamais d'adresse personnelle. */
export const AGENT_UTILISATEUR = 'Zotijean/1.0.7 ( https://github.com/pymenvert/zotijean )';

/** MusicBrainz plafonne à ~1 requête/seconde. La marge évite les 503. */
const RYTHME_MS = { 'musicbrainz.org': 1100, défaut: 1000 };

/**
 * Les étages, du plus sûr au moins sûr.
 *
 * L'ordre est celui de la confiance, pas celui de la commodité : un lien de
 * piste vérifié sur la page du vendeur ne se compare pas à une recherche
 * pré-remplie, et le rapport ne doit jamais laisser croire le contraire.
 */
export const ÉTAGES = {
  PISTE: 1,      // lien direct vers LE morceau, vente confirmée sur la page
  ALBUM: 2,      // lien direct vers l'album qui le porte, vente confirmée
  RÉFÉRENCÉ: 3,  // lien d'achat connu d'un catalogue, non vérifié à la source
  RECHERCHE: 4,  // rien de connu : une recherche pré-remplie, et c'est dit
};

export const LIBELLÉS_ÉTAGE = {
  1: 'Lien direct vers le morceau',
  2: 'Lien direct vers l’album',
  3: 'Lien d’achat référencé',
  4: 'Aucun lien connu — recherche à faire',
};

/**
 * Qui vend du sans-perte, qui n'en vend pas.
 *
 * Le doute profite au NON : annoncer « achetable en FLAC » sur une boutique qui
 * ne vend que de l'AAC serait la seule façon pour ce rapport de mentir sur sa
 * promesse. Une boutique inconnue est donc signalée comme telle plutôt que
 * comptée dans les sans-perte.
 */
const BOUTIQUES = {
  'bandcamp.com': { nom: 'Bandcamp', sansPerte: true },
  'beatport.com': { nom: 'Beatport', sansPerte: true },
  'junodownload.com': { nom: 'Juno Download', sansPerte: true },
  'traxsource.com': { nom: 'Traxsource', sansPerte: true },
  'boomkat.com': { nom: 'Boomkat', sansPerte: true },
  'qobuz.com': { nom: 'Qobuz', sansPerte: true },
  'bleep.com': { nom: 'Bleep', sansPerte: true },
  'hardwax.com': { nom: 'Hard Wax', sansPerte: true },
  '7digital.com': { nom: '7digital', sansPerte: true },
  'itunes.apple.com': { nom: 'Apple Music', sansPerte: false },
  'music.apple.com': { nom: 'Apple Music', sansPerte: false },
  'amazon.': { nom: 'Amazon', sansPerte: false },
  'play.google.com': { nom: 'Google Play', sansPerte: false },
};

/** Reconnaît la boutique d'une URL. Renvoie toujours un objet exploitable. */
export function boutiqueDeLURL(url) {
  let hôte;
  try {
    hôte = new URL(url).hostname.toLowerCase();
  } catch {
    return { nom: 'Boutique inconnue', sansPerte: null, clé: 'inconnue' };
  }
  for (const [motif, boutique] of Object.entries(BOUTIQUES)) {
    if (hôte.includes(motif)) return { ...boutique, clé: motif.replace(/\..*$/, '') };
  }
  return { nom: hôte.replace(/^www\./, ''), sansPerte: null, clé: 'inconnue' };
}

/**
 * Clé de comparaison entre deux titres.
 *
 * Sans elle, « R U IN2 IT? » et « r u in2 it » sont deux morceaux différents, et
 * « O$VMV$M » ne se retrouve jamais. On enlève tout ce qui n'est ni lettre ni
 * chiffre, et on rend au dollar sa lettre : c'est une graphie d'artiste
 * courante en musique électronique, pas une décoration.
 */
export function normaliserPourComparaison(texte) {
  return String(texte ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\$/g, 's')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Variantes d'un titre à essayer, de la plus précise à la plus large.
 *
 * Un titre de DJ porte presque toujours un suffixe — « - Gorge Interpretation »,
 * « (Extended Mix) » — que chaque boutique écrit à sa façon. Chercher le titre
 * nu en second rattrape ces cas sans jamais relâcher la vérification : c'est la
 * comparaison du résultat qui tranche, pas la requête.
 */
export function variantesDeTitre(titre) {
  const vues = new Set();
  const sortie = [];
  const ajouter = (v) => {
    const propre = String(v ?? '').trim();
    if (propre && !vues.has(propre.toLowerCase())) {
      vues.add(propre.toLowerCase());
      sortie.push(propre);
    }
  };
  ajouter(titre);
  for (const séparateur of [' - ', ' (', ' [']) {
    if (String(titre).includes(séparateur)) ajouter(String(titre).split(séparateur)[0]);
  }
  return sortie;
}

/** L'artiste principal : « Logos, Mumdance » se cherche sous « Logos ». */
export function artistePrincipal(artiste) {
  return String(artiste ?? '').split(/,|\bfeat\.?\b|\bft\.?\b|&/i)[0].trim();
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const dernierAppel = new Map();

function attendre(ms) {
  return new Promise((résoudre) => setTimeout(résoudre, ms));
}

/**
 * Respecte le rythme par hôte. Jamais deux requêtes en parallèle vers le même
 * service : c'est ce qui fait la différence entre un client poli et un robot
 * qu'on finit par bloquer.
 */
async function respecterLeRythme(hôte) {
  const attente = RYTHME_MS[hôte] ?? RYTHME_MS.défaut;
  const précédent = dernierAppel.get(hôte) ?? 0;
  const reste = précédent + attente - Date.now();
  if (reste > 0) await attendre(reste);
  dernierAppel.set(hôte, Date.now());
}

/**
 * Une requête HTTPS, sans dépendance.
 *
 * Renvoie toujours `{ code, corps }` — une panne réseau devient `code: 0`, pas
 * une exception : à cette échelle, un morceau qui échoue ne doit jamais faire
 * tomber un rapport de deux mille lignes.
 */
export function requêteHTTPS(url, { méthode = 'GET', corps = null, entêtes = {}, délaiMs = 30000, redirections = 3 } = {}) {
  return new Promise((résoudre) => {
    let cible;
    try {
      cible = new URL(url);
    } catch {
      résoudre({ code: 0, corps: '', erreur: 'URL invalide' });
      return;
    }

    const requête = https.request(
      cible,
      {
        method: méthode,
        headers: {
          'User-Agent': AGENT_UTILISATEUR,
          'Accept-Language': 'en',
          ...(corps ? { 'Content-Type': 'application/json' } : {}),
          ...entêtes,
        },
        timeout: délaiMs,
      },
      (réponse) => {
        const lieu = réponse.headers.location;
        if (lieu && réponse.statusCode >= 300 && réponse.statusCode < 400 && redirections > 0) {
          réponse.resume();
          résoudre(requêteHTTPS(new URL(lieu, cible).toString(), {
            méthode, corps, entêtes, délaiMs, redirections: redirections - 1,
          }));
          return;
        }
        let texte = '';
        réponse.setEncoding('utf8');
        réponse.on('data', (bloc) => { texte += bloc; });
        réponse.on('end', () => résoudre({ code: réponse.statusCode, corps: texte }));
      },
    );

    requête.on('timeout', () => requête.destroy(new Error('délai dépassé')));
    requête.on('error', (erreur) => résoudre({ code: 0, corps: '', erreur: erreur.message }));
    if (corps) requête.write(corps);
    requête.end();
  });
}

/**
 * Le transport, isolé pour pouvoir être remplacé par une doublure.
 *
 * Les tests de ce module n'ont aucun intérêt à joindre Bandcamp et MusicBrainz :
 * ce qu'il faut éprouver, c'est le CHAÎNAGE — qu'une recherche qui répond
 * n'importe quoi soit bien refusée par la vérification de page. La doublure
 * lève aussi les pauses d'une seconde, sans quoi la suite durerait des minutes.
 */
export function créerTransport({ http = requêteHTTPS, rythmer = true } = {}) {
  const hôteDe = (url) => { try { return new URL(url).hostname; } catch { return 'défaut'; } };

  async function demander(url, options = {}) {
    for (let essai = 0; essai < 4; essai += 1) {
      if (rythmer) await respecterLeRythme(hôteDe(url));
      const { code, corps } = await http(url, options);

      if (code === 200) return { code, corps };
      // 404 est une RÉPONSE, pas une panne : « ce service ne connaît pas ». La
      // confondre avec un échec réseau ferait recommencer un rapport entier pour
      // rien, et surtout mentirait sur la couverture mesurée.
      if (code === 404) return { code, corps: '' };
      if (code !== 503 && code !== 429 && code !== 0) return { code, corps: '' };
      if (rythmer) await attendre(2000 * (essai + 1));
    }
    return { code: 0, corps: '' };
  }

  return {
    async json(url, options = {}) {
      const { code, corps } = await demander(url, options);
      if (code !== 200) return { code, données: null };
      try {
        return { code, données: JSON.parse(corps) };
      } catch {
        return { code: 0, données: null };
      }
    },
    async texte(url, options = {}) {
      const { code, corps } = await demander(url, options);
      return { code, corps };
    },
  };
}

const TRANSPORT_RÉEL = créerTransport();

// ---------------------------------------------------------------------------
// Bandcamp
// ---------------------------------------------------------------------------

const RECHERCHE_BANDCAMP = 'https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic';

/** Les entités HTML des attributs, et rien d'autre : on lit un attribut, pas une page. */
export function déséchapperHTML(texte) {
  return String(texte ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Extrait la fiche que Bandcamp dépose dans sa page.
 *
 * On lit un attribut de données que la page publie pour son propre lecteur
 * audio, jamais du texte mis en forme : c'est la partie la moins susceptible de
 * bouger quand le site change d'habillage.
 */
export function extraireFicheBandcamp(html) {
  const trouvé = /data-tralbum="([^"]+)"/.exec(html ?? '');
  if (!trouvé) return null;
  try {
    return JSON.parse(déséchapperHTML(trouvé[1]));
  } catch {
    return null;
  }
}

/**
 * Ce que la page vend réellement.
 *
 * « Trouvé » ne veut pas dire « achetable » : sur les 13 morceaux retrouvés lors
 * du sondage, un était en écoute seule. Sans cette vérification le rapport
 * enverrait vers une page qui ne vend rien, ce qui est pire que ne rien
 * proposer — l'utilisateur perd le temps du clic ET la confiance dans le reste.
 */
export function lireVenteBandcamp(fiche) {
  if (!fiche) return null;
  const courant = fiche.current || {};
  const pistes = fiche.trackinfo || [];
  return {
    artiste: fiche.artist || '',
    titre: courant.title || '',
    type: courant.type || '',
    vendable: pistes.some((p) => p.is_downloadable) && !courant.killed,
    inédit: pistes.some((p) => p.unreleased_track),
    prix: typeof courant.minimum_price === 'number' ? courant.minimum_price : null,
    devise: (fiche.packages || []).find((p) => p.currency)?.currency ?? null,
    cheminAlbum: fiche.album_url || null,
    titresDeLAlbum: pistes.map((p) => p.title).filter(Boolean),
  };
}

async function chercherSurBandcamp(texte, filtre, transport) {
  const { code, données } = await transport.json(RECHERCHE_BANDCAMP, {
    méthode: 'POST',
    corps: JSON.stringify({
      search_text: texte, search_filter: filtre, full_page: false, fan_id: null,
    }),
  });
  if (code !== 200) return { panne: true, résultats: [] };
  return { panne: false, résultats: données?.auto?.results ?? [] };
}

async function ouvrirPageBandcamp(url, transport) {
  const { code, corps } = await transport.texte(url);
  if (code !== 200) return null;
  return lireVenteBandcamp(extraireFicheBandcamp(corps));
}

/**
 * Cherche un morceau sur Bandcamp, puis va lire la page pour confirmer.
 *
 * La règle qui tient tout : une recherche floue rend TOUJOURS quelque chose. On
 * ne retient un résultat que si le titre correspond après normalisation, et on
 * exige que la page elle-même confirme artiste et titre. Le nom de la boutique,
 * lui, peut légitimement différer de l'artiste : sur Bandcamp un morceau est
 * très souvent hébergé par le label.
 */
export async function résoudreSurBandcamp(piste, { transport = TRANSPORT_RÉEL } = {}) {
  const artiste = artistePrincipal(piste.artiste);
  if (!artiste && !piste.titre) return null;

  for (const titre of variantesDeTitre(piste.titre)) {
    const { panne, résultats } = await chercherSurBandcamp(`${artiste} ${titre}`, 't', transport);
    if (panne) return { panne: true };

    for (const résultat of résultats.slice(0, 5)) {
      if (normaliserPourComparaison(résultat.name) !== normaliserPourComparaison(titre)) continue;

      const vente = await ouvrirPageBandcamp(résultat.item_url_path, transport);
      if (!vente) continue;

      const titreConfirmé = variantesDeTitre(piste.titre)
        .some((v) => normaliserPourComparaison(vente.titre) === normaliserPourComparaison(v));
      const artisteConfirmé = normaliserPourComparaison(vente.artiste)
        .includes(normaliserPourComparaison(artiste));
      if (!titreConfirmé || !artisteConfirmé) continue;

      if (vente.vendable && !vente.inédit) {
        return {
          étage: ÉTAGES.PISTE,
          boutique: 'Bandcamp',
          sansPerte: true,
          url: résultat.item_url_path,
          intitulé: `${vente.artiste} — ${vente.titre}`,
          prix: vente.prix,
          devise: vente.devise,
        };
      }

      // La piste existe mais n'est pas vendue seule : l'album qui la porte l'est
      // presque toujours. Son adresse est déjà dans la page qu'on vient de lire.
      if (vente.cheminAlbum) {
        const racine = résultat.item_url_path.split('/track/')[0];
        const album = await ouvrirPageBandcamp(racine + vente.cheminAlbum, transport);
        if (album?.vendable) {
          return {
            étage: ÉTAGES.ALBUM,
            boutique: 'Bandcamp',
            sansPerte: true,
            url: racine + vente.cheminAlbum,
            intitulé: `${album.artiste} — ${album.titre}`,
            prix: album.prix,
            devise: album.devise,
            note: 'Album entier : le morceau n’est pas vendu séparément.',
          };
        }
      }
    }
  }

  // Dernier essai : le nom d'album que zotify a écrit dans l'étiquette. C'est un
  // mot-clé bien meilleur qu'un titre de piste court ou ponctué.
  if (piste.album) {
    const { panne, résultats } = await chercherSurBandcamp(`${artiste} ${piste.album}`, 'a', transport);
    if (panne) return { panne: true };

    for (const résultat of résultats.slice(0, 5)) {
      if (normaliserPourComparaison(résultat.name) !== normaliserPourComparaison(piste.album)) continue;
      const album = await ouvrirPageBandcamp(résultat.item_url_path, transport);
      if (!album?.vendable) continue;

      const contientLaPiste = album.titresDeLAlbum
        .some((t) => normaliserPourComparaison(t) === normaliserPourComparaison(piste.titre));
      return {
        étage: ÉTAGES.ALBUM,
        boutique: 'Bandcamp',
        sansPerte: true,
        url: résultat.item_url_path,
        intitulé: `${album.artiste} — ${album.titre}`,
        prix: album.prix,
        devise: album.devise,
        note: contientLaPiste
          ? 'Album entier, trouvé par son nom ; le morceau y figure bien.'
          : 'Album entier, trouvé par son nom. Le morceau N’A PAS été retrouvé dans sa liste — à vérifier avant d’acheter.',
        incertain: !contientLaPiste,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// MusicBrainz
// ---------------------------------------------------------------------------

const MB = 'https://musicbrainz.org/ws/2';
const RELATIONS_ACHAT = new Set(['purchase for download', 'purchase for mail-order']);

function échapperLucene(texte) {
  return String(texte ?? '').replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Les enregistrements candidats : par ISRC d'abord, par nom ensuite. */
async function enregistrementsCandidats(piste, transport) {
  if (piste.isrc) {
    const { données } = await transport.json(
      `${MB}/isrc/${encodeURIComponent(piste.isrc)}?inc=url-rels&fmt=json`,
    );
    const trouvés = données?.recordings ?? [];
    if (trouvés.length) return { voie: 'ISRC', enregistrements: trouvés };
  }

  const artiste = échapperLucene(artistePrincipal(piste.artiste));
  const titre = échapperLucene(piste.titre);
  if (!artiste || !titre) return { voie: null, enregistrements: [] };

  const requête = encodeURIComponent(`artist:"${artiste}" AND recording:"${titre}"`);
  const { données } = await transport.json(`${MB}/recording?query=${requête}&limit=5&fmt=json`);

  // Le score de MusicBrainz est relatif : il vaut 100 pour le meilleur résultat
  // d'une recherche même mauvaise. Seule la comparaison des noms tranche.
  const exact = (données?.recordings ?? []).find((enr) => {
    const crédits = (enr['artist-credit'] ?? []).map((c) => c.artist?.name ?? '').join(', ');
    const mêmeTitre = variantesDeTitre(piste.titre)
      .some((v) => normaliserPourComparaison(enr.title) === normaliserPourComparaison(v));
    return mêmeTitre
      && normaliserPourComparaison(crédits).includes(normaliserPourComparaison(artistePrincipal(piste.artiste)));
  });

  return { voie: exact ? 'artiste + titre' : null, enregistrements: exact ? [exact] : [] };
}

/**
 * Cherche un lien d'achat dans MusicBrainz.
 *
 * Le détour par les sorties n'est pas une optimisation, c'est la seule voie qui
 * rende quoi que ce soit : sur les 17 morceaux du sondage, les liens d'achat
 * portés par un enregistrement étaient au nombre de zéro.
 */
export async function résoudreSurMusicBrainz(piste, { transport = TRANSPORT_RÉEL } = {}) {
  const { voie, enregistrements } = await enregistrementsCandidats(piste, transport);
  if (!enregistrements.length) return null;

  const liens = [];
  for (const enregistrement of enregistrements.slice(0, 2)) {
    for (const relation of enregistrement.relations ?? []) {
      const url = relation.url?.resource;
      if (url && RELATIONS_ACHAT.has(relation.type)) liens.push({ url, sortie: enregistrement.title });
    }

    const { données } = await transport.json(
      `${MB}/release?recording=${enregistrement.id}&inc=url-rels&limit=100&fmt=json`,
    );
    for (const sortie of données?.releases ?? []) {
      for (const relation of sortie.relations ?? []) {
        const url = relation.url?.resource;
        if (url && RELATIONS_ACHAT.has(relation.type)) liens.push({ url, sortie: sortie.title });
      }
    }
  }

  if (!liens.length) return null;

  // Bandcamp d'abord, puis les autres boutiques sans-perte, puis le reste : un
  // lien Apple Music est un vrai lien d'achat, mais pas d'un fichier sans perte,
  // et le rapport doit le dire au lieu de le laisser passer pour tel.
  const classés = liens
    .map((l) => ({ ...l, boutique: boutiqueDeLURL(l.url) }))
    .sort((a, b) => rang(a.boutique) - rang(b.boutique));

  const meilleur = classés[0];
  return {
    étage: ÉTAGES.RÉFÉRENCÉ,
    boutique: meilleur.boutique.nom,
    sansPerte: meilleur.boutique.sansPerte,
    url: meilleur.url,
    intitulé: meilleur.sortie ? `« ${meilleur.sortie} »` : '',
    voie,
    autres: classés.slice(1, 4).map((l) => ({ boutique: l.boutique.nom, url: l.url })),
    note: meilleur.boutique.sansPerte === false
      ? `${meilleur.boutique.nom} ne vend pas de sans-perte : ce lien mène au morceau, pas à un FLAC.`
      : meilleur.boutique.sansPerte === null
        ? 'Boutique non reconnue : rien ne garantit qu’elle vende du sans-perte.'
        : null,
  };
}

function rang(boutique) {
  if (boutique.clé === 'bandcamp') return 0;
  if (boutique.sansPerte === true) return 1;
  if (boutique.sansPerte === null) return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// Recherches pré-remplies — l'étage 4
// ---------------------------------------------------------------------------

/** Ce qu'on propose quand on ne sait rien. Marqué comme recherche, jamais comme lien. */
export function recherchesPréRemplies(piste) {
  const requête = `${artistePrincipal(piste.artiste)} ${piste.titre}`.trim();
  const encodée = encodeURIComponent(requête);
  return [
    { boutique: 'Bandcamp', url: `https://bandcamp.com/search?q=${encodée}&item_type=t` },
    { boutique: 'Beatport', url: `https://www.beatport.com/search?q=${encodée}` },
    { boutique: 'Juno Download', url: `https://www.junodownload.com/search/?q%5Ball%5D%5B%5D=${encodée}` },
  ];
}

// ---------------------------------------------------------------------------
// Résolution d'un morceau, puis d'une bibliothèque
// ---------------------------------------------------------------------------

/** Identifie un morceau d'une exécution à l'autre, pour la reprise. */
export function cléDePiste(piste) {
  if (piste.isrc) return `isrc:${String(piste.isrc).toUpperCase()}`;
  return `nom:${normaliserPourComparaison(artistePrincipal(piste.artiste))}/${normaliserPourComparaison(piste.titre)}`;
}

/**
 * Résout un morceau. Ne lève jamais : un échec devient un étage 4 motivé.
 */
export async function résoudrePiste(piste, {
  sources = { bandcamp: true, musicbrainz: true },
  transport = TRANSPORT_RÉEL,
} = {}) {
  const base = {
    artiste: piste.artiste, titre: piste.titre, album: piste.album ?? '',
    isrc: piste.isrc ?? '', playlist: piste.playlist ?? '', fichier: piste.fichier ?? '',
  };

  if (sources.bandcamp) {
    const trouvé = await résoudreSurBandcamp(piste, { transport });
    if (trouvé?.panne) {
      return { ...base, panneBandcamp: true, ...(await parMusicBrainzOuRecherche(piste, sources, transport)) };
    }
    if (trouvé) return { ...base, ...trouvé };
  }

  return { ...base, ...(await parMusicBrainzOuRecherche(piste, sources, transport)) };
}

async function parMusicBrainzOuRecherche(piste, sources, transport) {
  if (sources.musicbrainz) {
    const trouvé = await résoudreSurMusicBrainz(piste, { transport });
    if (trouvé) return trouvé;
  }
  return {
    étage: ÉTAGES.RECHERCHE,
    sansPerte: null,
    recherches: recherchesPréRemplies(piste),
    note: piste.isrc
      ? 'Aucune boutique connue pour ce morceau.'
      : 'Aucun ISRC sur le fichier, et aucune boutique connue.',
  };
}

/** Où la reprise garde ce qui est déjà fait. */
export const fichierReprise = () => path.join(dossierDonnées(), 'achats-en-cours.json');

/**
 * Résout toute une bibliothèque.
 *
 * Trois garde-fous, tous exigés par la règle du projet sur les opérations
 * longues : la durée est calculable AVANT de commencer (`estimerDurée`),
 * l'avancement est diffusé pendant, et une interruption ne perd rien.
 */
export async function résoudreToutes(pistes, {
  surProgrès = () => {},
  sources = { bandcamp: true, musicbrainz: true },
  reprise = true,
  arrêtDemandé = () => false,
  transport = TRANSPORT_RÉEL,
  écrireAvancement = écrireReprise,
  oublierAvancement = oublierReprise,
} = {}) {
  const déjàFait = reprise ? (lireJSON(fichierReprise(), null)?.fiches ?? {}) : {};
  const fiches = { ...déjàFait };
  let sourcesActives = { ...sources };
  let traités = 0;
  let interrompu = false;

  for (const piste of pistes) {
    traités += 1;
    const clé = cléDePiste(piste);

    if (arrêtDemandé()) { interrompu = true; break; }

    if (fiches[clé]) {
      surProgrès({ traités, total: pistes.length, piste, repris: true });
      continue;
    }

    const fiche = await résoudrePiste(piste, { sources: sourcesActives, transport });

    // Bandcamp qui tombe désactive Bandcamp, pas le rapport. On le dit une fois :
    // répéter le même avertissement deux mille fois noierait le journal.
    if (fiche.panneBandcamp && sourcesActives.bandcamp) {
      sourcesActives = { ...sourcesActives, bandcamp: false };
      journal.avertir(
        'Bandcamp ne répond plus : la recherche continue avec MusicBrainz seul. '
        + 'Les morceaux déjà traités gardent leurs liens. Relancer le rapport plus '
        + 'tard reprendra là où il s’est arrêté.',
      );
    }

    fiches[clé] = fiche;
    écrireAvancement(fiches);
    surProgrès({ traités, total: pistes.length, piste, fiche });
  }

  // Une reprise sert à finir ce qui a été interrompu, PAS à figer un résultat.
  // Sans cet oubli, un rapport mené à son terme resservirait éternellement les
  // mêmes liens : les prix changent, les albums sont retirés de la vente, et
  // l'utilisateur qui relance croirait vérifier alors qu'il relit un cache.
  if (!interrompu) oublierAvancement();

  const ordonnées = pistes.map((p) => fiches[cléDePiste(p)]).filter(Boolean);
  return { fiches: ordonnées, bilan: bilanDe(ordonnées), interrompu, traités };
}

function écrireReprise(fiches) {
  try {
    assurerDossier(dossierDonnées());
    écrireAtomique(fichierReprise(), JSON.stringify({ date: new Date().toISOString(), fiches }));
  } catch (erreur) {
    journal.avertir(`Impossible d’enregistrer l’avancement du rapport : ${erreur.message}`);
  }
}

/** Efface l'avancement. Un fichier absent est le cas normal, pas une erreur. */
export function oublierReprise() {
  try {
    fs.rmSync(fichierReprise(), { force: true });
  } catch {
    // Un avancement qu'on n'arrive pas à effacer ne casse rien : la prochaine
    // exécution le relira, et au pire resservira des liens un peu vieux.
  }
}

/**
 * Durée annoncée AVANT de commencer.
 *
 * Deux requêtes par morceau pour Bandcamp (une recherche, une page), une à trois
 * pour MusicBrainz quand Bandcamp n'a rien trouvé. Le chiffre est volontairement
 * pessimiste : une estimation dépassée fait plus de dégâts qu'une estimation
 * large, parce qu'elle apprend à ne plus croire les suivantes.
 */
export function estimerDurée(nombreDePistes, { sources = { bandcamp: true, musicbrainz: true } } = {}) {
  const parPiste = (sources.bandcamp ? 2 : 0) + (sources.musicbrainz ? 1.5 : 0);
  const secondes = Math.ceil(nombreDePistes * parPiste * 1.05);
  return { requêtes: Math.ceil(nombreDePistes * parPiste), secondes };
}

/** Les comptes que le rapport doit afficher (critère 8 de la spécification). */
export function bilanDe(fiches) {
  const compte = (test) => fiches.filter(test).length;
  return {
    total: fiches.length,
    avecISRC: compte((f) => f.isrc),
    lienPiste: compte((f) => f.étage === ÉTAGES.PISTE),
    lienAlbum: compte((f) => f.étage === ÉTAGES.ALBUM),
    lienRéférencé: compte((f) => f.étage === ÉTAGES.RÉFÉRENCÉ),
    rechercheSeule: compte((f) => f.étage === ÉTAGES.RECHERCHE),
    sansPerte: compte((f) => f.sansPerte === true),
    bandcamp: compte((f) => f.boutique === 'Bandcamp'),
    àVérifier: compte((f) => f.incertain),
  };
}

// ---------------------------------------------------------------------------
// Le rapport
// ---------------------------------------------------------------------------

/** Sans ça, un titre contenant « & » ou « < » casse la page. */
export function échapperHTML(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Une cellule de tableur : les virgules et les guillemets ne doivent rien casser. */
function celluleCSV(valeur) {
  const texte = String(valeur ?? '');
  return /[",;\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

/**
 * Le CSV, pour trier et cocher ce qu'on a acheté.
 *
 * Point-virgule et BOM : c'est ce qu'attend un tableur configuré en français,
 * et sans le BOM les accents arrivent en charabia dans Excel.
 */
export function construireCSV(fiches) {
  const colonnes = ['Playlist', 'Artiste', 'Titre', 'Album', 'ISRC', 'Confiance',
    'Boutique', 'Sans perte', 'Prix', 'Lien', 'Remarque'];
  const lignes = [colonnes.join(';')];

  for (const f of fiches) {
    lignes.push([
      f.playlist, f.artiste, f.titre, f.album, f.isrc,
      LIBELLÉS_ÉTAGE[f.étage] ?? '',
      f.boutique ?? '',
      f.sansPerte === true ? 'oui' : f.sansPerte === false ? 'non' : 'inconnu',
      f.prix != null ? `${f.prix} ${f.devise ?? ''}`.trim() : '',
      f.url ?? (f.recherches ?? []).map((r) => r.url).join(' '),
      f.note ?? '',
    ].map(celluleCSV).join(';'));
  }
  return `﻿${lignes.join('\r\n')}\r\n`;
}

const STYLE_RAPPORT = `
:root{--fond:#faf8f5;--carte:#fff;--texte:#1c1a18;--texte-2:#55504a;--bord:#e2ddd6;
--accent:#b3651a;--vert:#2f6d3f;--rouge:#9c2f2f;--ombre:0 1px 2px rgba(0,0,0,.06)}
@media (prefers-color-scheme:dark){:root{--fond:#151312;--carte:#1e1b19;--texte:#f0ece7;
--texte-2:#a49c93;--bord:#332e2a;--accent:#e2933f;--vert:#7fc08f;--rouge:#e07a7a;
--ombre:0 1px 2px rgba(0,0,0,.4)}}
*{box-sizing:border-box}
body{margin:0;padding:32px 20px 64px;background:var(--fond);color:var(--texte);
font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:940px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px}
h2{font-size:17px;margin:38px 0 4px;display:flex;align-items:baseline;gap:10px}
.sous{color:var(--texte-2);font-size:13.5px;margin:0 0 18px}
.chiffres{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:22px 0 8px}
.tuile{background:var(--carte);border:1px solid var(--bord);border-radius:10px;padding:12px 14px;box-shadow:var(--ombre)}
.tuile b{display:block;font-size:24px;font-weight:600;line-height:1.15}
.tuile span{color:var(--texte-2);font-size:12.5px}
.compte{font-size:13px;font-weight:400;color:var(--texte-2)}
ul{list-style:none;margin:0;padding:0}
li{background:var(--carte);border:1px solid var(--bord);border-radius:10px;
padding:11px 14px;margin-bottom:8px;box-shadow:var(--ombre)}
.morceau{font-weight:600}
.meta{color:var(--texte-2);font-size:12.5px;margin-top:2px;
display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline}
a{color:var(--accent)}
.prix{color:var(--vert);font-weight:600}
.avert{color:var(--rouge)}
.etiquette{border:1px solid var(--bord);border-radius:99px;padding:1px 8px;font-size:11.5px;color:var(--texte-2)}
.recherches{margin-top:6px;display:flex;flex-wrap:wrap;gap:12px;font-size:13px}
.note{background:var(--carte);border:1px solid var(--bord);border-left:3px solid var(--accent);
border-radius:8px;padding:12px 14px;margin:20px 0;font-size:13.5px;color:var(--texte-2)}
footer{margin-top:44px;color:var(--texte-2);font-size:12.5px}
`;

/**
 * La page à ouvrir dans un navigateur.
 *
 * Elle est classée par confiance, pas par playlist, et chaque étage porte en
 * toutes lettres ce qu'il vaut. C'est le point sur lequel un rapport de ce genre
 * peut mentir le plus facilement : présenter une recherche pré-remplie et un
 * lien vérifié dans la même colonne laisserait croire à une couverture qui
 * n'existe pas.
 */
export function construireHTML(fiches, bilan, { date = new Date(), sources = {} } = {}) {
  const groupes = [ÉTAGES.PISTE, ÉTAGES.ALBUM, ÉTAGES.RÉFÉRENCÉ, ÉTAGES.RECHERCHE]
    .map((étage) => ({ étage, fiches: fiches.filter((f) => f.étage === étage) }));

  const explications = {
    [ÉTAGES.PISTE]: 'Le morceau lui-même, sur une page dont la vente a été vérifiée. Bandcamp propose le FLAC sur tout téléchargement : ces liens mènent bien à du sans-perte.',
    [ÉTAGES.ALBUM]: 'Le morceau n’est pas vendu seul ; c’est l’album qui le porte, et sa vente a été vérifiée.',
    [ÉTAGES.RÉFÉRENCÉ]: 'Un catalogue connaît un lien d’achat, mais la page du vendeur n’a pas été ouverte : le lien peut être périmé, et toutes ces boutiques ne vendent pas du sans-perte.',
    [ÉTAGES.RECHERCHE]: 'Rien de connu. Ce sont des recherches pré-remplies, pas des liens : il faudra chercher à la main.',
  };

  const tuile = (valeur, libellé) => `<div class="tuile"><b>${valeur}</b><span>${libellé}</span></div>`;

  const ligneFiche = (f) => {
    const morceau = `${échapperHTML(f.artiste)} — ${échapperHTML(f.titre)}`;
    const méta = [];
    if (f.playlist) méta.push(`<span class="etiquette">${échapperHTML(f.playlist)}</span>`);
    if (f.boutique) méta.push(échapperHTML(f.boutique));
    if (f.prix != null) méta.push(`<span class="prix">${f.prix} ${échapperHTML(f.devise ?? '')}</span>`);
    if (f.sansPerte === false) méta.push('<span class="avert">pas de sans-perte ici</span>');
    if (!f.isrc) méta.push('<span class="etiquette">sans ISRC</span>');
    if (f.voie) méta.push(`retrouvé par ${échapperHTML(f.voie)}`);

    const lien = f.url
      ? `<div><a href="${échapperHTML(f.url)}" target="_blank" rel="noreferrer">${échapperHTML(f.intitulé || f.url)}</a></div>`
      : '';
    const recherches = (f.recherches ?? []).length
      ? `<div class="recherches">${f.recherches.map((r) =>
          `<a href="${échapperHTML(r.url)}" target="_blank" rel="noreferrer">Chercher sur ${échapperHTML(r.boutique)}</a>`).join('')}</div>`
      : '';
    const note = f.note
      ? `<div class="meta ${f.incertain ? 'avert' : ''}">${échapperHTML(f.note)}</div>` : '';

    return `<li><div class="morceau">${morceau}</div>${lien}
<div class="meta">${méta.join('')}</div>${note}${recherches}</li>`;
  };

  const sansPerteUtile = bilan.lienPiste + bilan.lienAlbum;
  const part = bilan.total ? Math.round((sansPerteUtile / bilan.total) * 100) : 0;

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zotijean — Racheter en sans-perte</title>
<style>${STYLE_RAPPORT}</style></head><body><main>
<h1>Racheter en sans-perte</h1>
<p class="sous">${bilan.total} morceau(x) suivis · ${date.toLocaleString('fr-FR')}</p>

<div class="chiffres">
${tuile(bilan.lienPiste, 'lien direct vers le morceau')}
${tuile(bilan.lienAlbum, 'lien vers l’album qui le porte')}
${tuile(bilan.lienRéférencé, 'lien d’achat référencé ailleurs')}
${tuile(bilan.rechercheSeule, 'aucun lien — à chercher')}
</div>

<div class="note">
<strong>${sansPerteUtile} morceau(x) sur ${bilan.total} (${part} %) ont un lien d’achat vérifié en sans-perte.</strong>
Zotijean n’achète rien et ne télécharge rien : il ouvre les portes, vous décidez.
${bilan.avecISRC < bilan.total
  ? `<br>${bilan.total - bilan.avecISRC} morceau(x) n’ont pas d’ISRC — ils sont quand même traités, par leur artiste et leur titre. C’est d’ailleurs ce qui marche le mieux : sur ce répertoire, l’ISRC n’a permis de retrouver qu’un morceau sur sept.`
  : ''}
${bilan.àVérifier ? `<br><span class="avert">${bilan.àVérifier} album(s) à vérifier avant achat : le morceau n’a pas été retrouvé dans leur liste.</span>` : ''}
${sources.bandcamp === false ? '<br><span class="avert">La recherche Bandcamp était désactivée ou indisponible : ce rapport est nettement moins complet qu’il pourrait l’être.</span>' : ''}
</div>

${groupes.filter((g) => g.fiches.length).map((g) => `
<h2>${LIBELLÉS_ÉTAGE[g.étage]} <span class="compte">${g.fiches.length}</span></h2>
<p class="sous">${explications[g.étage]}</p>
<ul>${g.fiches.map(ligneFiche).join('')}</ul>`).join('')}

<footer>Liens fournis par Bandcamp et MusicBrainz. Un lien peut être périmé —
un album retiré de la vente laisse une page morte. Aucune vérification n’a été
faite que le fichier vendu est un vrai sans-perte, sauf sur Bandcamp, qui propose
le FLAC sur tous ses téléchargements.</footer>
</main></body></html>`;
}

// ---------------------------------------------------------------------------
// Ce que l'application appelle
// ---------------------------------------------------------------------------

/**
 * Les morceaux de la bibliothèque, avec leurs étiquettes.
 *
 * `listerAudio` ne descend PAS dans les sous-dossiers — elle liste un dossier.
 * Comme le rangement par défaut est « un dossier par playlist », l'appeler sur
 * la racine rend zéro et le rapport sortirait vide en annonçant un succès. On
 * parcourt donc l'arbre ici, et on écarte les Ogg d'origine quand leur converti
 * est posé à côté, sans quoi chaque morceau serait cherché deux fois.
 */
export async function pistesDeLaBibliothèque(c) {
  const racine = c.général.dossierMusique;
  const extensionCible = trouver(FORMATS, c.qualité?.format)?.extension ?? null;

  const dossiers = (depuis) => {
    let entrées = [];
    try {
      entrées = fs.readdirSync(depuis, { withFileTypes: true });
    } catch {
      return [];
    }
    return [depuis, ...entrées
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .flatMap((e) => dossiers(path.join(depuis, e.name)))];
  };

  const fichiers = dossiers(racine)
    .flatMap((d) => sansSourcesConverties(listerAudio(d), extensionCible));

  const pistes = [];
  for (const fichier of fichiers) {
    const m = await lireMétadonnées(fichier);
    pistes.push({
      artiste: m.artiste, titre: m.titre, album: m.album ?? '', isrc: m.isrc ?? '',
      playlist: path.relative(racine, path.dirname(fichier)) || '(racine)',
      fichier: path.basename(fichier),
    });
  }
  return pistes;
}

/** Où le rapport est écrit : à la racine de la bibliothèque, sous les yeux. */
export const cheminsDuRapport = (c) => ({
  html: path.join(c.général.dossierMusique, 'Racheter-en-sans-perte.html'),
  csv: path.join(c.général.dossierMusique, 'Racheter-en-sans-perte.csv'),
});

/**
 * Ce qu'on peut annoncer AVANT de lancer quoi que ce soit.
 *
 * Le critère est explicite dans la spécification, et c'est une règle du projet :
 * une opération longue annonce sa durée, sinon elle est indiscernable d'un
 * blocage et l'utilisateur force la fermeture.
 */
export async function estimerRapport(c) {
  const pistes = await pistesDeLaBibliothèque(c);
  const sources = sourcesDe(c);
  return {
    nbPistes: pistes.length,
    nbAvecISRC: pistes.filter((p) => p.isrc).length,
    sources,
    ...estimerDurée(pistes.length, { sources }),
  };
}

function sourcesDe(c) {
  return {
    bandcamp: c.achats?.bandcamp !== false,
    musicbrainz: c.achats?.musicbrainz !== false,
  };
}

/**
 * Produit le rapport complet. N'écrit rien tant qu'il n'y a rien à écrire :
 * un fichier vide serait pris pour un résultat.
 */
export async function produireRapport(c, { surProgrès = () => {}, arrêtDemandé = () => false } = {}) {
  const pistes = await pistesDeLaBibliothèque(c);
  if (!pistes.length) {
    return {
      vide: true,
      message: `Aucun fichier audio sous ${c.général.dossierMusique}. `
        + 'Lancez une synchronisation d’abord : le rapport travaille sur ce qui est déjà là.',
    };
  }

  const sources = sourcesDe(c);
  const { fiches, bilan, interrompu } = await résoudreToutes(pistes, {
    surProgrès, sources, arrêtDemandé,
  });

  const chemins = cheminsDuRapport(c);
  écrireAtomique(chemins.html, construireHTML(fiches, bilan, { sources }));
  écrireAtomique(chemins.csv, construireCSV(fiches));

  journal.info(
    `Rapport des rachats écrit — ${bilan.lienPiste + bilan.lienAlbum} morceau(x) sur `
    + `${bilan.total} ont un lien d’achat vérifié en sans-perte.`,
  );

  return { vide: false, chemins, bilan, interrompu, nbPistes: pistes.length };
}
