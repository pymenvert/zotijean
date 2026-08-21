// Tests du client Spotify — la partie qui se teste sans réseau.
//
// CE QUE CES TESTS PROTÈGENT. La liste des pistes d'une playlist est la base de
// tout le travail « morceaux manquants » : chaque élément mal filtré devient
// soit un plantage, soit un morceau éternellement manquant que l'app essaie de
// retélécharger à chaque passage.
//
// Les trois cas viennent de VRAIES playlists, pas d'hypothèses : une piste
// retirée du catalogue laisse un élément avec un trou à la place (`track:
// null`), un fichier local n'a pas d'identifiant, et un épisode de podcast se
// glisse dans les playlists mixtes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Le dossier de données est détourné avant l'import : le module lit ses jetons
// sur disque à l'initialisation.
process.env.ZOTIJEAN_DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-spotify-'));

const {
  normaliserPistes, lireRetryAfter,
  préparerConnexion, terminerConnexion, estConnecté, reconnexionNécessaire, profil,
} = await import('../src/spotify.js');

// ---------------------------------------------------------------------------
// Outillage des tests d'authentification
//
// POURQUOI IL EXISTE. L'épreuve de mutation du 21 août 2026 a cassé cinq fois
// ce module — état d'autorisation non vérifié, jeton de rafraîchissement
// écrasé, révocation rendue non définitive, drapeau de reconnexion ignoré,
// marge d'expiration supprimée — et la suite est restée verte les cinq fois.
// Ces deux fonctions sont les coutures qui manquaient : le module n'en avait
// pas besoin, les tests si.
//
// `fetch` est le fetch global de Node : on le remplace le temps d'un test, et
// on le rend TOUJOURS, même si le test échoue — sans quoi un test suivant
// partirait sur le réseau réel.
// ---------------------------------------------------------------------------

const cheminJetons = () => path.join(process.env.ZOTIJEAN_DONNEES, 'spotify.json');
const poserJetons = (j) => fs.writeFileSync(cheminJetons(), JSON.stringify(j), 'utf8');
const relireJetons = () => JSON.parse(fs.readFileSync(cheminJetons(), 'utf8'));

/** Une réponse HTTP crédible : les trois choses que le module lit vraiment. */
function réponseFausse(statut, corps, entêtes = {}) {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    json: async () => corps,
    headers: { get: (n) => entêtes[String(n).toLowerCase()] ?? null },
  };
}

/** Joue `travail` avec un `fetch` scénarisé, et rend la liste des appels reçus. */
async function avecFetch(réponses, travail) {
  const vrai = globalThis.fetch;
  const appels = [];
  let index = 0;
  globalThis.fetch = async (url, options) => {
    appels.push({ url: String(url), options });
    const r = réponses[Math.min(index, réponses.length - 1)];
    index += 1;
    return r;
  };
  try {
    // Les fonctions publiques lèvent quand la connexion est morte : c'est
    // justement le cas qu'on teste, l'erreur ne doit pas faire tomber le test.
    const valeur = await travail().then((v) => v, (e) => e);
    return { valeur, appels };
  } finally {
    globalThis.fetch = vrai;
  }
}

const PISTE = (id, nom, extras = {}) => ({
  added_at: '2026-08-01T10:00:00Z',
  is_local: false,
  track: {
    type: 'track',
    id,
    name: nom,
    duration_ms: 200_000,
    disc_number: 1,
    track_number: 3,
    external_ids: { isrc: 'FRXXX2600001' },
    artists: [{ name: 'Christine' }],
    album: { name: 'Été', release_date: '2025-06-01', images: [{ url: 'https://i/img' }] },
    ...extras,
  },
});

test('une piste retirée du catalogue ne fait pas tomber l’inventaire', () => {
  // L'élément reste dans la playlist, mais « track » est nul. Y lire un titre
  // planterait la lecture entière — donc toutes les fonctions Spotify.
  const pistes = normaliserPistes([
    PISTE('a1', 'Prix Choc'),
    { added_at: '2026-08-01T10:00:00Z', is_local: false, track: null },
    PISTE('a2', 'Été à Dakar'),
  ]);

  assert.deepEqual(pistes.map((p) => p.titre), ['Prix Choc', 'Été à Dakar']);
});

test('un fichier local est écarté : il n’a rien à télécharger', () => {
  const pistes = normaliserPistes([
    PISTE('a1', 'Prix Choc'),
    { is_local: true, track: { type: 'track', id: null, name: 'Mon edit perso' } },
  ]);
  assert.equal(pistes.length, 1);
});

test('un épisode de podcast est écarté, même quand le type est bien renvoyé', () => {
  // LE PIÈGE DÉJÀ TOMBÉ : le champ « type » doit être DEMANDÉ dans la requête,
  // sinon Spotify ne le renvoie pas et le filtre laisse tout passer en croyant
  // filtrer. Ce test vérifie le filtre ; le champ demandé l'est dans
  // contenuPlaylist, avec un commentaire qui dit pourquoi.
  const pistes = normaliserPistes([
    PISTE('a1', 'Prix Choc'),
    PISTE('e1', 'Épisode 42 — Interview', { type: 'episode', external_ids: undefined }),
  ]);
  assert.deepEqual(pistes.map((p) => p.titre), ['Prix Choc']);
});

test('un trou dans la liste des artistes ne fait pas tomber l’inventaire', () => {
  // Le trou peut être À L'INTÉRIEUR de la liste, pas seulement à la place de
  // la piste. « artists: [null] » plantait la lecture entière : le catch en
  // amont absorbait l'erreur à chaque synchronisation, et l'analyse Spotify de
  // la playlist restait dégradée pour toujours, sans autre signe qu'un
  // avertissement répété dans le journal.
  const pistes = normaliserPistes([
    PISTE('a1', 'Prix Choc'),
    { is_local: false, track: { type: 'track', id: 'x1', name: 'Trouée', artists: [null] } },
    { is_local: false, track: { type: 'track', id: 'x2', name: 'Anonyme', artists: [{}] } },
  ]);

  assert.equal(pistes.length, 3, 'une piste au trou a fait tomber toute la lecture');
  assert.deepEqual(pistes[1].artistes, []);
  assert.equal(pistes[1].artiste, '');
  // Un artiste sans nom ne doit pas produire « undefined » dans les empreintes.
  assert.deepEqual(pistes[2].artistes, []);
});

test('un corps d’erreur de l’API à la place d’un tableau rend une liste vide', () => {
  assert.deepEqual(normaliserPistes({ error: { status: 500 } }), []);
  assert.deepEqual(normaliserPistes(null), []);
});

test('les champs absents deviennent des valeurs sûres, jamais des trous', () => {
  // Un single sans album complet, une compilation sans ISRC : chaque champ
  // manquant doit donner une valeur exploitable par l'organisation des
  // fichiers, pas « undefined » qui finirait dans un nom de dossier.
  const [piste] = normaliserPistes([{
    is_local: false,
    track: { type: 'track', id: 'x1', name: 'Brut' },
  }]);

  assert.equal(piste.artiste, '');
  assert.equal(piste.album, '');
  assert.equal(piste.année, '');
  assert.equal(piste.isrc, null);
  assert.equal(piste.numéroDisque, 1);
});

test('lireRetryAfter refuse de rendre zéro pour un en-tête vide', () => {
  // Number('') vaut 0 : sans garde, une réponse 429 sans en-tête repartirait
  // sans la moindre pause, aggravant la limitation qu'elle signale.
  assert.equal(lireRetryAfter(''), 2);
  assert.equal(lireRetryAfter(null), 2);
  assert.equal(lireRetryAfter('7'), 7);
});

// ---------------------------------------------------------------------------
// Authentification — les cinq trous prouvés par la mutation du 21 août 2026
// ---------------------------------------------------------------------------

test('une réponse dont l’état ne correspond pas à la demande est refusée', async () => {
  // LE SEUL CONTRÔLE DE SÉCURITÉ DE CE FLUX. Sans lui, un tiers qui a lui-même
  // lancé une connexion Spotify peut faire aboutir SA session dans l'app de
  // quelqu'un d'autre : il lui suffit de le faire cliquer sur l'adresse de
  // retour portant son propre code. L'app se retrouve connectée à un compte
  // qui n'est pas le sien, sans que rien ne le signale.
  poserJetons({});
  const url = préparerConnexion('client-abc', 'http://127.0.0.1:8787/api/spotify/retour');
  const étatDeLaDemande = new URL(url).searchParams.get('state');
  assert.ok(étatDeLaDemande, 'la demande doit porter un état, sinon il n’y a rien à vérifier');

  const { valeur } = await avecFetch(
    [réponseFausse(200, { access_token: 'volé', refresh_token: 'volé', expires_in: 3600 })],
    () => terminerConnexion('code-d-un-tiers', `${étatDeLaDemande}xxx`),
  );

  assert.equal(valeur.réussi, false,
    'un état qui ne correspond pas a été accepté : l’app peut être connectée '
    + 'à un compte Spotify qui n’est pas celui de l’utilisateur');
  assert.equal(estConnecté(), false, 'des jetons ont été écrits malgré le refus');
});

test('un rafraîchissement qui ne renvoie pas de nouveau jeton garde l’ancien', async () => {
  // Spotify ne renvoie PAS toujours un refresh_token. Écraser l'ancien par
  // « undefined » déconnecte l'utilisateur au premier rafraîchissement — donc
  // au bout d'une heure, pour quelqu'un qui n'a rien fait de mal.
  poserJetons({ refresh_token: 'ANCIEN', client_id: 'c', access_token: 'périmé', expire_le: 0 });

  const { appels } = await avecFetch([
    réponseFausse(200, { access_token: 'frais', expires_in: 3600 }),
    réponseFausse(200, { display_name: 'Pym', id: 'pym', product: 'premium' }),
  ], () => profil());

  // D'ABORD PROUVER QUE LE RAFRAÎCHISSEMENT A EU LIEU. Sans ces deux lignes, le
  // test resterait vert si rien ne se passait du tout : il n'assertionnerait
  // qu'une valeur qu'il a lui-même écrite.
  assert.equal(appels.length, 2, 'le rafraîchissement n’a pas eu lieu');
  assert.equal(relireJetons().access_token, 'frais', 'le nouveau jeton n’a pas été gardé');

  assert.equal(relireJetons().refresh_token, 'ANCIEN',
    'le jeton de rafraîchissement a été perdu : l’utilisateur est déconnecté '
    + 'à la première heure écoulée');

  // Et la requête doit porter ce que Spotify exige : sans `client_id`, il
  // répond « invalid_client » et l'utilisateur est déconnecté pour de bon.
  const corps = new URLSearchParams(appels[0].options.body);
  assert.equal(corps.get('grant_type'), 'refresh_token');
  assert.equal(corps.get('refresh_token'), 'ANCIEN');
  assert.equal(corps.get('client_id'), 'c');
});

test('une autorisation révoquée exige une reconnexion, une panne passagère non', async () => {
  // DEUX ÉCHECS QU'IL NE FAUT PAS CONFONDRE, et c'est tout l'objet de ce test.
  // Une révocation ne se répare jamais toute seule : sans le drapeau, le jeton
  // de rafraîchissement reste dans le fichier et l'app continue d'afficher
  // « connecté » pendant que plus rien ne fonctionne.
  poserJetons({ refresh_token: 'R', client_id: 'c', access_token: 'périmé', expire_le: 0 });
  await avecFetch([réponseFausse(400, { error: 'invalid_grant' })], () => profil());

  assert.equal(reconnexionNécessaire(), true,
    'une autorisation révoquée est passée pour une panne passagère : l’app '
    + 'dira « non connecté » au lieu de « autorisation révoquée », et ne '
    + 'demandera jamais de se reconnecter');
  assert.equal(estConnecté(), false,
    'estConnecté ignore le drapeau de reconnexion : l’app affiche « connecté » '
    + 'pendant que toutes les requêtes échouent');

  // Le pendant : une panne côté Spotify ne doit RIEN exiger de l'utilisateur.
  // On repart d'un drapeau EXPLICITEMENT posé, sinon l'assertion « false »
  // serait vraie avant même l'appel et ne prouverait rien.
  poserJetons({
    refresh_token: 'R', client_id: 'c', access_token: 'périmé',
    expire_le: 0, reconnexionNécessaire: true,
  });
  assert.equal(reconnexionNécessaire(), true, 'le cas de test n’est pas posé');

  await avecFetch([réponseFausse(503, {})], () => profil());

  assert.equal(reconnexionNécessaire(), true,
    'une panne passagère a effacé un drapeau de reconnexion légitime');

  poserJetons({ refresh_token: 'R', client_id: 'c', access_token: 'périmé', expire_le: 0 });
  await avecFetch([réponseFausse(503, {})], () => profil());

  assert.equal(reconnexionNécessaire(), false,
    'une panne passagère a été traitée comme une révocation : on inquiète '
    + 'l’utilisateur et on lui fait refaire une connexion pour rien');
});

test('un jeton qui expire dans trente secondes est rafraîchi, pas réutilisé', async () => {
  // La marge d'une minute existe parce qu'un jeton valable à l'instant du
  // contrôle peut être périmé à l'instant de la requête. Sans elle, l'échec ne
  // ressemble pas à « il faut rafraîchir » mais à une erreur incompréhensible.
  poserJetons({
    refresh_token: 'R', client_id: 'c',
    access_token: 'presque-mort', expire_le: Date.now() + 30_000,
  });

  const { appels } = await avecFetch([
    réponseFausse(200, { access_token: 'frais', expires_in: 3600 }),
    réponseFausse(200, { display_name: 'Pym', id: 'pym', product: 'premium' }),
  ], () => profil());

  assert.equal(appels.length, 2,
    'le jeton presque expiré a été réutilisé tel quel : la requête partira '
    + 'avec un jeton mort et rendra une erreur que personne ne saura lire');
  assert.ok(appels[0].url.includes('accounts.spotify.com/api/token'),
    'le premier appel aurait dû être le rafraîchissement');
});

test.after(() => {
  fs.rmSync(process.env.ZOTIJEAN_DONNEES, { recursive: true, force: true });
});
