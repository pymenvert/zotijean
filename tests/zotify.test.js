// Tests du pilote zotify.
//
// On ne teste pas zotify lui-même (il n'est pas installé sur le poste de
// développement) mais tout ce qui l'entoure : le découpage de sa sortie, la
// construction de sa ligne de commande, et surtout la lecture du disque, qui est
// la seule chose à laquelle on fait confiance pour savoir ce qui a été
// téléchargé.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  créerDécoupeur,
  classerLigne,
  nettoyerLigne,
  événementDeLigne,
  construireArguments,
  inventorier,
  nouveauxFichiers,
  écarterIncomplet,
  DOSSIER_INCOMPLETS,
  saitReprendreSansLeFichier,
  assurerJournalTéléchargements,
  cheminsDéjàTéléchargés,
} from '../src/zotify.js';

import { optionsDéclarées, extraireVersion } from '../src/diagnostic.js';

// ---------------------------------------------------------------------------
// Découpage de la sortie
// ---------------------------------------------------------------------------

test('le découpeur rend les lignes séparées par des sauts de ligne', () => {
  const reçues = [];
  const absorber = créerDécoupeur((l) => reçues.push(l));
  absorber('première\ndeuxième\n');
  assert.deepEqual(reçues, ['première', 'deuxième']);
});

test('le découpeur rend les lignes séparées par des retours chariot', () => {
  // C'est LE test qui compte : les barres de progression réécrivent la même
  // ligne avec « \r » et n'émettent jamais de « \n ». Un découpeur qui n'attend
  // que des sauts de ligne ne recevrait rien avant la toute fin, et l'interface
  // resterait figée pendant les 17 heures d'un premier rattrapage.
  const reçues = [];
  const absorber = créerDécoupeur((l) => reçues.push(l));
  absorber('Téléchargement  10%\rTéléchargement  20%\rTéléchargement  30%\r');
  assert.deepEqual(reçues, [
    'Téléchargement  10%',
    'Téléchargement  20%',
    'Téléchargement  30%',
  ]);
});

test('le découpeur traite « \\r\\n » comme un seul séparateur', () => {
  const reçues = [];
  const absorber = créerDécoupeur((l) => reçues.push(l));
  absorber('une\r\ndeux\r\n');
  assert.deepEqual(reçues, ['une', 'deux']);
});

test('le découpeur conserve une ligne incomplète jusqu’au bloc suivant', () => {
  const reçues = [];
  const absorber = créerDécoupeur((l) => reçues.push(l));
  absorber('Téléchar');
  assert.deepEqual(reçues, []);
  absorber('gement 50%\n');
  assert.deepEqual(reçues, ['Téléchargement 50%']);
});

test('le découpeur ignore les lignes vides', () => {
  const reçues = [];
  const absorber = créerDécoupeur((l) => reçues.push(l));
  absorber('\n\n   \n\rok\r\n\n');
  assert.deepEqual(reçues, ['ok']);
});

// ---------------------------------------------------------------------------
// Classement des lignes
// ---------------------------------------------------------------------------

test('classerLigne repère les erreurs qui comptent vraiment', () => {
  for (const ligne of [
    'Failed fetching audio key!',
    'ERROR: Track is unavailable in your region',
    'Rate limit exceeded, too many requests',
    'This track requires Premium',
  ]) {
    assert.equal(classerLigne(ligne).type, 'erreur', `non repéré : ${ligne}`);
  }
});

test('classerLigne extrait le pourcentage de progression', () => {
  const classée = classerLigne('Downloading Prix Choc  42%');
  assert.equal(classée.type, 'progression');
  assert.equal(classée.pourcentage, 42);
});

test('classerLigne considère le reste comme informatif', () => {
  assert.equal(classerLigne('Preparing download of 12 tracks').type, 'info');
});

// ---------------------------------------------------------------------------
// Les séquences d'échappement du terminal
// ---------------------------------------------------------------------------
//
// CES CAS VIENNENT DU CODE SOURCE DE ZOTIFY, pas d'une supposition. Son module
// d'affichage définit ses propres séquences — remonter d'une ligne, effacer la
// ligne — et son tableau de bord les émet à chaque rafraîchissement. Sa barre de
// progression passe par tqdm, qui masque et rétablit le curseur.
//
// Recopiés tels quels dans une page web, ces caractères s'affichent en charabia
// au milieu du titre en cours. Après dix-sept heures à regarder cette ligne,
// autant qu'elle soit lisible.

const ÉCHAP = String.fromCharCode(27);

test('le tableau de bord de zotify ne pollue pas la ligne affichée', () => {
  const classée = classerLigne(`${ÉCHAP}[KDownloading Été à Dakar  45%${ÉCHAP}[A`);
  assert.equal(classée.texte, 'Downloading Été à Dakar  45%');
  assert.equal(classée.pourcentage, 45);
});

test('le masquage du curseur par tqdm est retiré', () => {
  const classée = classerLigne(`${ÉCHAP}[?25lTrack 12/200  73%${ÉCHAP}[?25h`);
  assert.equal(classée.texte, 'Track 12/200  73%');
  assert.equal(classée.pourcentage, 73);
});

test('une erreur en couleur reste reconnue comme une erreur', () => {
  // Le piège : si la couleur restait collée au texte, « Failed » deviendrait
  // « [1;32mFailed » et le motif d'erreur ne correspondrait plus. Une piste
  // perdue passerait alors pour une ligne d'information.
  const classée = classerLigne(`${ÉCHAP}[1;32mFailed fetching audio key!${ÉCHAP}[0m`);
  assert.equal(classée.type, 'erreur');
  assert.equal(classée.texte, 'Failed fetching audio key!');
});

// ---------------------------------------------------------------------------
// Le tableau de bord que zotify redessine en continu
// ---------------------------------------------------------------------------
//
// CES INTITULÉS SONT COPIÉS DE SON CODE SOURCE. Ce ne sont pas des événements
// mais un affichage d'état, réémis à chaque rafraîchissement.
//
// L'un d'eux est « Last Encountered Error », suivi le plus souvent de « None ».
// Le motif qui repère les erreurs cherche le mot « error » : chaque
// rafraîchissement produisait donc une fausse erreur. Sur dix-sept heures, le
// journal se remplit, la liste des erreurs sature à son plafond de 200, et le
// bilan final annonce « 1 960 nouveaux titres, 200 repris plus tard » alors que
// tout s'est parfaitement passé.
//
// Deux correctifs de cette session s'annulaient ainsi l'un l'autre : le résumé
// honnête devenait un mensonge d'un autre genre.

test('le tableau de bord de zotify ne produit aucune fausse erreur', () => {
  for (const ligne of [
    'Query Tree: [Playlist(Été 2026)]',
    'Current DLContent: Track',
    'Status: downloading',
    'Total Query Progress: 12/200',
    'Last Download Time: 4',
    'Last Conversion Time: 1',
    'Last Downloaded Item: Prix Choc',
    'Last Encountered Error: None',
  ]) {
    assert.notEqual(classerLigne(ligne).type, 'erreur', `fausse erreur sur : ${ligne}`);
  }
});

test('les vraies erreurs de zotify restent détectées', () => {
  // Le pendant indispensable du test précédent : à trop vouloir filtrer, on
  // finirait par ne plus rien voir passer. Ces formulations viennent des
  // canaux d'erreur de zotify, pas de son affichage d'état.
  for (const ligne of [
    'Failed fetching audio key!',
    'ERROR: Track is unavailable in your region',
    'SKIPPING: song is unavailable',
    'Rate limit exceeded, too many requests',
  ]) {
    assert.equal(classerLigne(ligne).type, 'erreur', `erreur ratée : ${ligne}`);
  }
});

// ---------------------------------------------------------------------------
// Les variables que zotify ne sait pas remplacer
// ---------------------------------------------------------------------------
//
// RELEVÉ DANS SON CODE SOURCE. Son moteur de nommage substitue une trentaine de
// variables — titre, artiste, album, année, ISRC, numéro de piste — mais aucune
// pour le genre. Le genre existe dans ses métadonnées, il l'écrit même dans les
// étiquettes du fichier ; il n'est simplement pas disponible au moment de
// composer le chemin.
//
// Laisser passer « {genre} » ferait atterrir toute la bibliothèque dans un
// dossier appelé littéralement « {genre} » — sur un rattrapage de 2 000 titres,
// c'est une bibliothèque entière à ranger à la main.

test('une variable que zotify ne connaît pas est retirée du modèle', async () => {
  const { retirerVariablesImpossibles } = await import('../src/synchronisation.js');

  // Le séparateur part avec la variable : sinon le chemin commencerait par un
  // dossier vide.
  assert.equal(
    retirerVariablesImpossibles('{genre}/{artist} - {song_name}'),
    '{artist} - {song_name}',
  );
  assert.equal(
    retirerVariablesImpossibles('{artist}/{genre}/{album}/{song_name}'),
    '{artist}/{album}/{song_name}',
  );
});

test('un modèle entièrement vidé retombe sur un nommage utilisable', async () => {
  const { retirerVariablesImpossibles } = await import('../src/synchronisation.js');
  // Sans ce filet, les fichiers n'auraient plus de nom du tout.
  assert.equal(retirerVariablesImpossibles('{genre}'), '{artist} - {song_name}');
});

test('les modèles sans variable impossible ne sont pas touchés', async () => {
  const { retirerVariablesImpossibles } = await import('../src/synchronisation.js');
  const intact = '{playlist}/{playlist_num} - {artist} - {song_name}';
  assert.equal(retirerVariablesImpossibles(intact), intact);
});

test('un album ou un artiste ne reçoit pas les variables réservées aux playlists', async () => {
  // RELEVÉ DANS LE CODE SOURCE DE ZOTIFY : « {playlist} » et « {playlist_num} »
  // ne sont substitués QUE lorsque le morceau vient d'une playlist. Pour un
  // album ou un artiste — deux types de source que Zotijean accepte —, ces
  // variables resteraient littérales : tout atterrirait dans un dossier
  // « {playlist} », exactement comme le bug du genre.
  //
  // L'équivalent naturel existe : le nom de l'album, et le numéro de piste dans
  // l'album. Un artiste télécharge sa discographie, donc des albums.
  const { modèleZotify } = await import('../src/synchronisation.js');
  const c = { organisation: { schéma: 'par_playlist' } };

  assert.equal(modèleZotify(c, 'playlist'), '{playlist}/{playlist_num} - {artist} - {song_name}');
  assert.equal(modèleZotify(c, 'album'), '{album}/{album_num} - {artist} - {song_name}');
  assert.equal(modèleZotify(c, 'artist'), '{album}/{album_num} - {artist} - {song_name}');

  // Sans type — vieille configuration —, on suppose une playlist : c'est le
  // type le plus courant, et celui que l'ajout d'une source a toujours accepté.
  assert.equal(modèleZotify(c), '{playlist}/{playlist_num} - {artist} - {song_name}');
});

test('la variable {isrc} traverse toute la chaîne : c’est le pont sans perte', async () => {
  // L'ISRC est l'identifiant international du morceau, le même sur toutes les
  // plateformes. zotify le substitue sans condition — vérifié dans sa liste.
  // Le mettre dans le NOM du fichier crée un repère fiable vers Rekordbox ou
  // Serato sans jamais réécrire le contenu du fichier — donc sans toucher aux
  // points de repère que Serato stocke dedans.
  const { modèleZotify } = await import('../src/synchronisation.js');
  const { rendre, validerModèle } = await import('../src/organisation.js');
  const { VARIABLES } = await import('../src/options.js');

  const modèle = '{playlist}/{numéro} - {artiste} - {titre} [{isrc}]';

  // La validation du modèle personnalisé doit l'accepter…
  assert.deepEqual(validerModèle(modèle, VARIABLES.map((v) => v.nom)), []);

  // …zotify doit le recevoir tel quel…
  const envoyé = modèleZotify({ organisation: { schéma: 'personnalise', modèlePersonnalisé: modèle } });
  assert.ok(envoyé.endsWith('[{isrc}]'), `l’isrc a été perdu en route : ${envoyé}`);

  // …et l'aperçu doit le montrer, avec un repli lisible quand il manque.
  const complet = rendre(modèle, {
    playlist: 'Été 2026', numéro: '007', artiste: 'Étienne', titre: 'Prix Choc',
    isrc: 'FRXXX2600001',
  });
  assert.ok(complet.includes('[FRXXX2600001]'));

  const sans = rendre(modèle, { playlist: 'P', numéro: '001', artiste: 'A', titre: 'T' });
  assert.ok(sans.includes('[ISRC-inconnu]'), 'un isrc absent laisserait un trou dans le nom');
});

test('la perte est nommée pour pouvoir être annoncée à l’utilisateur', async () => {
  const { variablesImpossibles } = await import('../src/synchronisation.js');
  const pertes = variablesImpossibles({ organisation: { schéma: 'par_genre' } });
  assert.equal(pertes.length, 1);
  assert.match(pertes[0], /genre/);

  assert.deepEqual(
    variablesImpossibles({ organisation: { schéma: 'par_playlist' } }),
    [],
    'un rangement qui fonctionne ne doit rien signaler',
  );
});

// ---------------------------------------------------------------------------
// Les fragments de téléchargement laissés par une interruption
// ---------------------------------------------------------------------------
//
// CE QUE LE CODE SOURCE DE ZOTIFY APPREND, et qui corrige une supposition de ce
// projet : zotify télécharge dans un fichier « .tmp » posé à côté de la
// destination, et ne le renomme qu'une fois le morceau COMPLET.
//
// Deux conséquences. D'abord, un fichier portant une extension audio est
// complet par construction — il ne faut donc pas l'écarter sous prétexte qu'une
// interruption vient d'avoir lieu. Ensuite, le vrai reste d'une interruption est
// un « .tmp », que zotify efface lui-même en fin d'exécution normale... mais pas
// quand on l'a coupé au signal.
//
// Ces fragments sont invisibles pour tout le reste de l'app, qui ne compte que
// les extensions audio. Ils s'accumuleraient en silence, plusieurs mégaoctets
// chacun, dans la bibliothèque.

test('les fragments de téléchargement sont supprimés, l’audio est épargné', async () => {
  const { nettoyerRestesTemporaires } = await import('../src/zotify.js');
  const racine = dossierTemporaire();
  try {
    fs.mkdirSync(path.join(racine, 'Été 2026'));
    fs.writeFileSync(path.join(racine, 'Été 2026', 'Prix Choc.tmp'), Buffer.alloc(3_000_000));
    fs.writeFileSync(path.join(racine, 'Été 2026', 'Été à Dakar.ogg'), Buffer.alloc(5_000_000));
    fs.writeFileSync(path.join(racine, 'reste.tmp'), Buffer.alloc(1_000_000));

    const supprimés = nettoyerRestesTemporaires(racine);

    assert.equal(supprimés.length, 2, 'tous les fragments n’ont pas été retirés');
    assert.equal(
      fs.existsSync(path.join(racine, 'Été 2026', 'Été à Dakar.ogg')), true,
      'un vrai morceau a été supprimé',
    );
    // La taille est rendue pour pouvoir dire à l'utilisateur ce qui a été libéré.
    assert.ok(supprimés.every((s) => s.taille > 0));
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('le dossier des incomplets n’est pas balayé par ce nettoyage', async () => {
  // Il contient des morceaux mis de côté volontairement : les effacer
  // reviendrait à supprimer ce qu'on avait pris soin de sauver.
  const { nettoyerRestesTemporaires } = await import('../src/zotify.js');
  const racine = dossierTemporaire();
  try {
    fs.mkdirSync(path.join(racine, DOSSIER_INCOMPLETS));
    const gardé = path.join(racine, DOSSIER_INCOMPLETS, 'ancien.tmp');
    fs.writeFileSync(gardé, Buffer.alloc(500_000));

    nettoyerRestesTemporaires(racine);
    assert.equal(fs.existsSync(gardé), true, 'le dossier des incomplets a été touché');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// La demande de connexion Spotify
// ---------------------------------------------------------------------------
//
// RELEVÉ DANS LE CODE SOURCE DE ZOTIFY. Sans identifiants enregistrés, il ne
// s'arrête pas : il affiche « Click on the following link to login: »,
// l'adresse d'autorisation sur la ligne suivante, puis attend indéfiniment un
// rappel HTTP. Son entrée standard fermée n'y change rien.
//
// Sans détection, le premier lancement d'un utilisateur jamais authentifié
// donnait quinze minutes de silence puis un message parlant de blocage. La
// vraie information — l'adresse à ouvrir — était dans le flux, noyée.
//
// Ces tests passent par un VRAI sous-processus (node joue le rôle de zotify) :
// c'est le chaînage complet qui est vérifié, pas une fonction isolée.

test('la demande de connexion est détectée et l’adresse remonte', async () => {
  const { télécharger } = await import('../src/zotify.js');
  const racine = dossierTemporaire();
  try {
    const script = [
      "console.log('Click on the following link to login:')",
      "console.log('https://accounts.spotify.com/authorize?client_id=abc')",
    ].join(';');

    const événements = [];
    const résultat = await télécharger({
      commande: process.execPath,
      arguments: ['-e', script],
      dossierRacine: racine,
      surÉvénement: (é) => événements.push(é),
    });

    assert.equal(résultat.connexionRequise, true);
    assert.match(résultat.urlConnexion, /^https:\/\/accounts\.spotify\.com/);

    // L'interface reçoit l'événement avec l'adresse : c'est lui qui devient le
    // lien cliquable.
    const émis = événements.find((é) => é.type === 'connexion-requise');
    assert.ok(émis, 'aucun événement de connexion émis');
    assert.equal(émis.url, résultat.urlConnexion);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('une sortie ordinaire ne déclenche aucune fausse demande de connexion', async () => {
  // Le pendant : un morceau dont le titre contient « login » ou une adresse
  // http ne doit pas faire surgir le bandeau de connexion.
  const { télécharger } = await import('../src/zotify.js');
  const racine = dossierTemporaire();
  try {
    const script = [
      "console.log('Downloading Login to Paradise  45%')",
      "console.log('https://open.spotify.com/track/abc')",
    ].join(';');

    const résultat = await télécharger({
      commande: process.execPath,
      arguments: ['-e', script],
      dossierRacine: racine,
      surÉvénement: () => {},
    });

    assert.equal(résultat.connexionRequise, false);
    assert.equal(résultat.urlConnexion ?? null, null);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('nettoyerLigne laisse intact ce qui n’a rien à nettoyer', () => {
  // Un nettoyage trop gourmand abîmerait les titres : accents, tirets, points
  // d'exclamation et parenthèses doivent survivre tels quels.
  const propre = 'Été à Dakar (Mix) — Christine & les Alliés !';
  assert.equal(nettoyerLigne(propre), propre);
});

// ---------------------------------------------------------------------------
// De la sortie de zotify jusqu'à l'écran
// ---------------------------------------------------------------------------
//
// CES TESTS EXISTENT PARCE QUE LES PRÉCÉDENTS NE SUFFISAIENT PAS.
//
// Chaque pièce était vérifiée isolément et fonctionnait. Leur assemblage, lui,
// perdait tout : l'événement sortait classé « progression » alors que le moteur
// et l'interface n'écoutent que « ligne ». Résultat, « Préparation… » affiché
// pendant les dix-sept heures d'un gros rattrapage, sans que rien ne soit
// détecté par une suite verte.
//
// On teste donc le CHAÎNAGE, en rejouant la condition exacte des consommateurs.

test('la sortie de zotify arrive jusqu’à l’interface sous le type qu’elle y attend', () => {
  const reçus = [];
  // Le vrai chaînage : découpage, classement, mise en forme de l'événement.
  const absorber = créerDécoupeur((ligne) => reçus.push(événementDeLigne(classerLigne(ligne))));
  absorber('Downloading Été à Dakar  45%\rDownloading Été à Dakar  90%\r');

  assert.equal(reçus.length, 2);
  for (const é of reçus) {
    // La condition écrite noir sur blanc dans src/synchronisation.js et dans
    // public/app.js. Si elle devient fausse, l'utilisateur ne voit plus rien.
    assert.equal(é.type, 'ligne', 'le moteur et l’interface ignoreraient cet événement');
  }
  assert.equal(reçus[1].pourcentage, 90);
  assert.equal(reçus[1].texte, 'Downloading Été à Dakar  90%');
});

test('l’événement conserve la nature de la ligne pour distinguer une erreur', () => {
  const erreur = événementDeLigne(classerLigne('Failed fetching audio key!'));
  assert.equal(erreur.type, 'ligne');
  assert.equal(erreur.sousType, 'erreur');

  const avancement = événementDeLigne(classerLigne('Downloading Prix Choc  42%'));
  assert.equal(avancement.sousType, 'progression');
});

// ---------------------------------------------------------------------------
// Construction de la ligne de commande
// ---------------------------------------------------------------------------

const CONFIG = {
  qualité: { niveau: 'tres_elevee', format: 'copie' },
  zotify: { commande: 'zotify', argumentsSupplémentaires: '' },
};

test('construireArguments n’utilise que les options réellement supportées', () => {
  // « disable-directory-archives » figure ici parce qu'une version à jour de
  // zotify la propose, et que Zotijean en a besoin : sans elle, zotify décide
  // qu'un morceau est déjà là d'après sa propre liste plutôt que d'après le
  // disque. Voir le test dédié plus bas.
  const capacités = {
    options: [
      'help', 'root-path', 'output', 'download-quality', 'audio-format',
      'bulk-wait-time', 'skip-existing', 'disable-directory-archives',
    ],
  };
  const { arguments: args, nonAppliqués } = construireArguments({
    url: 'https://open.spotify.com/playlist/abc',
    config: CONFIG,
    attente: 30,
    capacités,
    modèle: '{playlist}/{artist} - {song_name}',
    dossierRacine: '/Musique/Zotijean',
  });

  assert.deepEqual(nonAppliqués, []);
  assert.ok(args.includes('--download-quality'));
  assert.ok(args.includes('very_high'));
  assert.ok(args.includes('--audio-format'));
  assert.ok(args.includes('copy'));
  assert.ok(args.includes('--bulk-wait-time'));
  assert.ok(args.includes('30'));
  // L'URL est toujours le dernier argument.
  assert.equal(args.at(-1), 'https://open.spotify.com/playlist/abc');
});

test('construireArguments signale les réglages qu’il n’a pas pu appliquer', () => {
  // Un fork plus ancien qui ne connaît ni le format ni le rythme : il ne faut
  // surtout pas passer l'option quand même (le téléchargement échouerait), mais
  // il faut le dire à l'utilisateur plutôt que de laisser croire que c'est actif.
  const capacités = { options: ['help', 'root-path', 'output'] };
  const { arguments: args, nonAppliqués } = construireArguments({
    url: 'https://open.spotify.com/playlist/abc',
    config: CONFIG,
    attente: 30,
    capacités,
    modèle: '{playlist}/{song_name}',
    dossierRacine: '/Musique',
  });

  assert.ok(!args.some((a) => a.includes('quality')));
  assert.ok(!args.some((a) => a.includes('format')));
  // Qualité, rythme, et la reprise des morceaux effacés — mais PAS le format :
  // la conversion n'est plus déléguée à zotify du tout, donc l'absence de son
  // option de codec ne prive l'utilisateur de rien.
  assert.equal(nonAppliqués.length, 3);
  assert.ok(nonAppliqués.some((m) => m.includes('qualité')));
  assert.ok(!nonAppliqués.some((m) => m.includes('format')));
});

test('la conversion n’est jamais déléguée à zotify, quel que soit le format choisi', () => {
  // RELEVÉ DANS SON CODE SOURCE : sa table d'extensions ne connaît ni flac ni
  // aiff — « --codec flac » produirait un fichier incohérent, extension « ogg »
  // par défaut. Et même pour les formats qu'il connaît, sa conversion est
  // naïve : pas de dither, pas d'étiquettes AIFF, et l'Ogg d'origine disparaît,
  // ce qui rendrait inapplicable la politique « conserver la source pour
  // changer de format plus tard sans retélécharger ».
  //
  // zotify livre l'Ogg (« copy ») ; le module de conversion fait le reste.
  const capacités = { options: ['help', 'root-path', 'output', 'codec'] };
  for (const format of ['copie', 'flac', 'aiff', 'mp3_320']) {
    const { arguments: args } = construireArguments({
      url: 'u', attente: 30, capacités, modèle: '{song_name}', dossierRacine: '/M',
      config: { ...CONFIG, qualité: { niveau: 'tres_elevee', format } },
    });
    assert.equal(args[args.indexOf('--codec') + 1], 'copy',
      `le format « ${format} » a été délégué à zotify`);
  }
});

test('les options booléennes reçoivent une valeur, sinon l’URL se fait avaler', () => {
  // LE BUG LE PLUS GRAVE DU PROJET, reproduit contre le vrai argparse de
  // Python. Le fork vivant déclare TOUTES ses options de configuration comme
  // attendant une valeur, y compris les booléennes. « --skip-existing » passé
  // en drapeau nu consommait donc l'argument suivant — l'URL de la playlist.
  // La liste des adresses devenait vide, zotify se terminait sans rien tenter,
  // et l'app annonçait « aucune nouveauté » à chaque synchronisation, pour
  // toujours. Aucune doublure de test ne pouvait le voir.
  //
  // Le style se lit dans le texte d'aide : argparse affiche le nom en
  // majuscules après l'option quand une valeur est attendue.
  const aideFork = '-ie SKIP_EXISTING, --skip-existing SKIP_EXISTING\n'
    + '--disable-directory-archives DISABLE_DIRECTORY_ARCHIVES';
  const capacités = {
    options: ['help', 'root-path', 'output', 'skip-existing', 'disable-directory-archives'],
    aide: aideFork,
  };
  const { arguments: args } = construireArguments({
    url: 'https://open.spotify.com/playlist/abc', config: CONFIG, attente: 30,
    capacités, modèle: '{song_name}', dossierRacine: '/M',
  });

  assert.equal(args[args.indexOf('--skip-existing') + 1], 'true',
    'l’option booléenne est restée un drapeau nu : l’URL sera avalée');
  assert.equal(args[args.indexOf('--disable-directory-archives') + 1], 'true');
  assert.equal(args.at(-1), 'https://open.spotify.com/playlist/abc',
    'l’URL doit rester le dernier argument, jamais la valeur d’une option');
});

test('les paroles suivent le choix de l’utilisateur, jamais le défaut de zotify', () => {
  // zotify écrit d'office un fichier .lrc à côté de chaque morceau. C'est un
  // choix arbitrable, donc un réglage — et la valeur part EXPLICITEMENT dans
  // les deux sens : s'appuyer sur son défaut reviendrait à l'imposer.
  const AIDE = '--lyrics-to-file LYRICS_TO_FILE';
  const capacités = { options: ['root-path', 'output', 'lyrics-to-file'], aide: AIDE };
  const config = (paroles) => ({
    ...CONFIG, qualité: { niveau: 'tres_elevee', format: 'copie', paroles },
  });

  const sans = construireArguments({
    url: 'U', attente: 30, capacités, modèle: '{song_name}', dossierRacine: '/M',
    config: config(false),
  });
  assert.equal(sans.arguments[sans.arguments.indexOf('--lyrics-to-file') + 1], 'false');

  const avec = construireArguments({
    url: 'U', attente: 30, capacités, modèle: '{song_name}', dossierRacine: '/M',
    config: config(true),
  });
  assert.equal(avec.arguments[avec.arguments.indexOf('--lyrics-to-file') + 1], 'true');

  // Vieux fork à drapeau nu : il ne sait pas dire « non », donc on ne pousse le
  // drapeau que pour dire « oui » — l'absence vaut refus.
  const vieux = { options: ['root-path', 'output', 'lyrics-to-file'], aide: '--lyrics-to-file    Save lyrics' };
  const refus = construireArguments({
    url: 'U', attente: 30, capacités: vieux, modèle: '{song_name}', dossierRacine: '/M',
    config: config(false),
  });
  assert.equal(refus.arguments.includes('--lyrics-to-file'), false);
});

// COUPER LES PAROLES DEMANDE DEUX OPTIONS, PAS UNE.
//
// Vérifié dans la source de zotify 0.17.4 : `fetch_lyrics` (api.py) ne renonce
// que si `lyrics_to_file` ET `lyrics_to_metadata` sont faux, et le second vaut
// True par défaut (config.py:93). Passer la première seule laissait zotify
// interroger les paroles de CHAQUE titre, échouer, et écrire une ligne
// contenant « failed » — 19 des 22 « erreurs » du 19 août 2026.
test('refuser les paroles coupe AUSSI leur écriture dans les etiquettes', () => {
  const capacités = {
    options: ['root-path', 'output', 'lyrics-to-file', 'lyrics-to-metadata'],
    aide: '--lyrics-to-file LYRICS_TO_FILE --lyrics-to-metadata LYRICS_TO_METADATA',
  };
  const config = (paroles) => ({
    ...CONFIG, qualité: { niveau: 'tres_elevee', format: 'copie', paroles },
  });

  const sans = construireArguments({
    url: 'U', attente: 30, capacités, modèle: '{song_name}', dossierRacine: '/M',
    config: config(false),
  }).arguments;
  assert.equal(sans[sans.indexOf('--lyrics-to-metadata') + 1], 'false',
    'sans cette option, zotify va chercher les paroles quand même');

  // Et l'inverse doit rester vrai : qui veut les paroles les veut partout.
  const avec = construireArguments({
    url: 'U', attente: 30, capacités, modèle: '{song_name}', dossierRacine: '/M',
    config: config(true),
  }).arguments;
  assert.equal(avec[avec.indexOf('--lyrics-to-metadata') + 1], 'true');
});

// Un fork qui ne connaît pas l'option ne doit pas la recevoir : une option
// inconnue fait échouer zotify au lancement, et emporte toute la playlist.
test('un zotify sans lyrics-to-metadata ne reçoit pas l’option', () => {
  const capacités = {
    options: ['root-path', 'output', 'lyrics-to-file'],
    aide: '--lyrics-to-file LYRICS_TO_FILE',
  };
  const { arguments: args, nonAppliqués } = construireArguments({
    url: 'U', attente: 30, capacités, modèle: '{song_name}', dossierRacine: '/M',
    config: { ...CONFIG, qualité: { niveau: 'tres_elevee', format: 'copie', paroles: false } },
  });
  assert.equal(args.includes('--lyrics-to-metadata'), false);
  // Et on ne s'en plaint pas : refuser les paroles reste satisfait par la
  // première option. Ce n'est un réglage non appliqué que si l'utilisateur les
  // VOULAIT et que rien ne sait les écrire.
  assert.equal(nonAppliqués.some((n) => /parole/i.test(n)), false, nonAppliqués.join(' | '));
});

test('chaque option retombe sur SON style par défaut, pas sur un style unique', () => {
  // Le fork embarqué mélange les deux styles : ses options de configuration
  // attendent une valeur, ses drapeaux déclarés à la main (« --no-splash »)
  // sont de purs drapeaux. Un défaut unique se tromperait forcément d'un côté —
  // et les deux erreurs sont destructrices : un drapeau nu avale l'URL, une
  // valeur collée à un pur drapeau devient une adresse à télécharger.
  const capacités = { options: ['root-path', 'output', 'no-splash', 'skip-existing'] };
  const { arguments: args } = construireArguments({
    url: 'URL', config: CONFIG, attente: 30,
    capacités, modèle: '{song_name}', dossierRacine: '/M',
  });

  assert.equal(args[args.indexOf('--skip-existing') + 1], 'true');
  assert.notEqual(args[args.indexOf('--no-splash') + 1], 'true',
    'une valeur collée à --no-splash serait téléchargée comme une adresse');
  assert.equal(args.at(-1), 'URL');
});

test('un metavar sans capitales ne fait pas revenir le drapeau nu', () => {
  // argparse affiche les « choices » entre accolades (« --skip-existing
  // {true,false} ») et un metavar personnalisé peut être « <bool> » : aucune
  // capitale. Conclure « pur drapeau » sur cette simple absence pousserait
  // l'option nue — et l'URL serait avalée. L'ambiguïté doit retomber sur le
  // style du fork embarqué, jamais sur le sens destructeur.
  for (const aide of [
    '--root-path ROOT_PATH\n--skip-existing {true,false}',
    '--root-path ROOT_PATH\n--skip-existing <bool>',
  ]) {
    const { arguments: args } = construireArguments({
      url: 'URL', config: CONFIG, attente: 30,
      capacités: { options: ['root-path', 'skip-existing'], aide },
      modèle: '{song_name}', dossierRacine: '/M',
    });
    assert.equal(args[args.indexOf('--skip-existing') + 1], 'true',
      `drapeau nu conclu sur : ${aide}`);
    assert.equal(args.at(-1), 'URL');
  }
});

test('une aide coupée en pleine déclaration ne fait pas revenir le drapeau nu', () => {
  // Le diagnostic coupe l'aide sur une fin de ligne, mais la liste des options
  // lit le texte COMPLET : une option peut donc être « déclarée » sans que son
  // style soit lisible. « includes » la trouve, le metavar manque — et
  // l'ancienne logique concluait « drapeau nu », URL avalée, en silence.
  const capacités = {
    options: ['root-path', 'skip-existing'],
    aide: '--root-path ROOT_PATH\n--skip-existing', // metavar emporté par la coupure
  };
  const { arguments: args } = construireArguments({
    url: 'URL', config: CONFIG, attente: 30,
    capacités, modèle: '{song_name}', dossierRacine: '/M',
  });
  assert.equal(args[args.indexOf('--skip-existing') + 1], 'true');
  assert.equal(args.at(-1), 'URL');
});

test('« -- » sépare toujours les options de l’URL : l’avalement devient une erreur visible', () => {
  // Vérifié contre le même analyseur d'arguments que le fork : tout ce qui suit
  // « -- » est un positionnel. Si une option à valeur arrive nue juste avant —
  // style mal lu, aide tronquée, ou argument supplémentaire saisi par
  // l'utilisateur — argparse échoue avec une ERREUR VISIBLE au lieu d'avaler
  // l'URL en silence. La différence : « aucune nouveauté » affiché pour
  // toujours, contre un message d'erreur dès la première synchronisation.
  const capacités = { options: ['root-path', 'output', 'skip-existing'] };

  const nominal = construireArguments({
    url: 'URL', config: CONFIG, attente: 30,
    capacités, modèle: '{song_name}', dossierRacine: '/M',
  });
  assert.equal(nominal.arguments.at(-1), 'URL');
  assert.equal(nominal.arguments.at(-2), '--', 'la ceinture de sécurité manque');

  // Un « -- » isolé saisi par l'utilisateur deviendrait un positionnel après le
  // nôtre — donc une adresse à télécharger. Il est écarté.
  const avecTiret = construireArguments({
    url: 'URL', attente: 30, capacités, modèle: '{song_name}', dossierRacine: '/M',
    config: { ...CONFIG, zotify: { commande: 'zotify', argumentsSupplémentaires: '--print-errors true --' } },
  });
  const tirets = avecTiret.arguments.filter((a) => a === '--');
  assert.equal(tirets.length, 1, 'le « -- » de l’utilisateur a survécu et deviendrait une adresse');
});

test('une aide tronquée avant l’option ne fait pas revenir le drapeau nu', () => {
  // Le texte d'aide est tronqué par le diagnostic, et le fork vivant déclare
  // une centaine d'options : la coupure peut tomber avant « --skip-existing ».
  // Une option ABSENTE du texte ne dit rien de son style — conclure « drapeau
  // nu » sur une absence ferait revenir le bug de l'URL avalée. Dans le doute,
  // c'est le style du fork embarqué qui s'applique : à valeur.
  const capacités = {
    options: ['help', 'root-path', 'output', 'skip-existing'],
    aide: '--root-path ROOT_PATH\n--output OUTPUT\n(texte coupé ici…)',
  };
  const { arguments: args } = construireArguments({
    url: 'URL', config: CONFIG, attente: 30,
    capacités, modèle: '{song_name}', dossierRacine: '/M',
  });
  assert.equal(args[args.indexOf('--skip-existing') + 1], 'true');
  assert.equal(args.at(-1), 'URL');
});

test('le vieux fork garde ses drapeaux nus : une valeur serait prise pour une adresse', () => {
  // Symétrique du test précédent. L'ancien fork déclarait ces options comme de
  // purs drapeaux : leur coller « true » ferait prendre ce mot pour une adresse
  // à télécharger. Le texte d'aide, sans nom en majuscules, révèle ce style.
  const capacités = {
    options: ['help', 'root-path', 'output', 'skip-existing'],
    aide: '-ie, --skip-existing    Skip songs already downloaded',
  };
  const { arguments: args } = construireArguments({
    url: 'URL', config: CONFIG, attente: 30,
    capacités, modèle: '{song_name}', dossierRacine: '/M',
  });

  const position = args.indexOf('--skip-existing');
  assert.notEqual(position, -1);
  assert.notEqual(args[position + 1], 'true', 'une valeur a été collée à un pur drapeau');
});

test('sans l’option d’archive, l’utilisateur est prévenu que la reprise ne marchera pas', () => {
  // RELEVÉ DANS LE CODE SOURCE DE ZOTIFY. Par défaut, il tient un fichier
  // d'archive par dossier et décide d'après LUI qu'un morceau est déjà là — pas
  // d'après la présence du fichier.
  //
  // Ça casse le principe fondateur de Zotijean, « le disque fait foi ». Un
  // morceau écarté parce qu'il était tronqué, ou effacé à la main, reste inscrit
  // dans l'archive : zotify le saute indéfiniment et le titre ne revient jamais.
  //
  // Quand l'option existe, on la passe. Quand elle manque, on le dit plutôt que
  // de laisser croire à une reprise qui n'aura pas lieu.
  const àJour = {
    options: ['help', 'root-path', 'output', 'skip-existing', 'disable-directory-archives'],
  };
  const { arguments: args, nonAppliqués } = construireArguments({
    url: 'u', config: CONFIG, attente: 30, capacités: àJour,
    modèle: '{song_name}', dossierRacine: '/M',
  });
  assert.ok(args.includes('--disable-directory-archives'), 'option non passée');
  assert.ok(!nonAppliqués.some((m) => m.includes('effacés')), 'avertissement injustifié');

  const ancien = { options: ['help', 'root-path', 'output', 'skip-existing'] };
  const vieux = construireArguments({
    url: 'u', config: CONFIG, attente: 30, capacités: ancien,
    modèle: '{song_name}', dossierRacine: '/M',
  });
  assert.ok(
    vieux.nonAppliqués.some((m) => m.includes('effacés')),
    'la limite n’est pas signalée à l’utilisateur',
  );
});

test('construireArguments accepte des variantes de noms d’options', () => {
  const capacités = { options: ['help', 'output-path', 'quality', 'codec'] };
  const { arguments: args } = construireArguments({
    url: 'u', config: CONFIG, attente: 5, capacités, modèle: '{song_name}', dossierRacine: '/M',
  });
  assert.ok(args.includes('--output-path'));
  assert.ok(args.includes('--quality'));
  assert.ok(args.includes('--codec'));
});

test('construireArguments transmet les arguments supplémentaires de l’utilisateur', () => {
  const config = { ...CONFIG, zotify: { argumentsSupplémentaires: '--print-errors --lyrics' } };
  const { arguments: args } = construireArguments({
    url: 'u', config, attente: 5, capacités: { options: ['help', 'root-path'] },
    modèle: '{song_name}', dossierRacine: '/M',
  });
  assert.ok(args.includes('--print-errors'));
  assert.ok(args.includes('--lyrics'));
});

test('sans option de dossier de destination, rien n’est lancé', () => {
  // Ce cas ne doit SURTOUT pas être traité comme un réglage « non appliqué ».
  // zotify téléchargerait quand même, dans son dossier par défaut, sur le disque
  // de démarrage. L'inventaire ne verrait rien apparaître, l'app conclurait
  // « aucune nouveauté », marquerait l'exécution réussie et attendrait 48 h —
  // pendant que des gigaoctets s'accumulent au mauvais endroit.
  const { arguments: args, bloquant } = construireArguments({
    url: 'u',
    config: CONFIG,
    attente: 5,
    capacités: { options: ['help', 'download-quality'] }, // pas de root-path
    modèle: '{song_name}',
    dossierRacine: '/Musique',
  });

  assert.equal(args, null, 'aucune commande ne doit être construite');
  assert.ok(bloquant, 'le refus doit être explicite');
  assert.match(bloquant, /dossier de destination/);
  assert.match(bloquant, /annulée/);
});

test('les variantes du nom de l’option de destination sont acceptées', () => {
  for (const nom of ['root-path', 'output-path', 'download-path']) {
    const { arguments: args, bloquant } = construireArguments({
      url: 'u', config: CONFIG, attente: 5, capacités: { options: ['help', nom] },
      modèle: '{song_name}', dossierRacine: '/Musique',
    });
    assert.equal(bloquant, undefined, `${nom} aurait dû suffire`);
    assert.ok(args.includes(`--${nom}`));
    assert.ok(args.includes('/Musique'));
  }
});

// ---------------------------------------------------------------------------
// Lecture de l'aide de zotify
// ---------------------------------------------------------------------------

test('optionsDéclarées extrait les options longues d’un texte d’aide', () => {
  const aide = `
    usage: zotify [-h] [--output OUTPUT] [--download-quality {normal,high,very_high}]
    options:
      -h, --help            show this help message and exit
      --bulk-wait-time N    seconds between downloads
  `;
  const options = optionsDéclarées(aide);
  assert.ok(options.has('help'));
  assert.ok(options.has('output'));
  assert.ok(options.has('download-quality'));
  assert.ok(options.has('bulk-wait-time'));
  assert.ok(!options.has('inexistante'));
});

test('extraireVersion lit un numéro de version', () => {
  assert.equal(extraireVersion('Zotify 0.17.4'), '0.17.4');
  assert.equal(extraireVersion('zotify v1.2'), '1.2');
  assert.equal(extraireVersion('aucune version ici'), null);
});

// ---------------------------------------------------------------------------
// Le disque comme seule source de vérité
// ---------------------------------------------------------------------------

function dossierTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-test-'));
}

test('inventorier trouve les fichiers audio récursivement', () => {
  const racine = dossierTemporaire();
  try {
    fs.mkdirSync(path.join(racine, 'Été 2026'), { recursive: true });
    fs.writeFileSync(path.join(racine, 'Été 2026', 'a.ogg'), 'x'.repeat(100));
    fs.writeFileSync(path.join(racine, 'b.flac'), 'y'.repeat(200));
    fs.writeFileSync(path.join(racine, 'notes.txt'), 'pas de la musique');

    const inventaire = inventorier(racine);
    assert.equal(inventaire.size, 2);
    const noms = [...inventaire.values()].map((f) => path.basename(f.chemin)).sort();
    assert.deepEqual(noms, ['a.ogg', 'b.flac']);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('inventorier ignore les dossiers techniques', () => {
  const racine = dossierTemporaire();
  try {
    fs.mkdirSync(path.join(racine, '_Archive'), { recursive: true });
    fs.mkdirSync(path.join(racine, '.cache'), { recursive: true });
    fs.writeFileSync(path.join(racine, '_Archive', 'vieux.ogg'), 'x'.repeat(100));
    fs.writeFileSync(path.join(racine, '.cache', 'temp.ogg'), 'x'.repeat(100));
    fs.writeFileSync(path.join(racine, 'actuel.ogg'), 'x'.repeat(100));

    assert.equal(inventorier(racine).size, 1);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('nouveauxFichiers ne retient que ce qui est réellement apparu', () => {
  const avant = new Map([['/m/a.ogg', { chemin: '/m/a.ogg', taille: 5_000_000 }]]);
  const après = new Map([
    ['/m/a.ogg', { chemin: '/m/a.ogg', taille: 5_000_000 }],
    ['/m/b.ogg', { chemin: '/m/b.ogg', taille: 6_000_000 }],
  ]);

  const { nouveaux, suspects } = nouveauxFichiers(avant, après);
  assert.equal(nouveaux.length, 1);
  assert.equal(nouveaux[0].chemin, '/m/b.ogg');
  assert.equal(suspects.length, 0);
});

test('nouveauxFichiers écarte les téléchargements avortés', () => {
  // zotify laisse parfois un fichier de quelques octets quand il échoue. Le
  // compter comme un succès ferait croire à l'app que le morceau est acquis, et
  // elle ne le retélécharcherait jamais.
  const avant = new Map();
  const après = new Map([
    ['/m/complet.ogg', { chemin: '/m/complet.ogg', taille: 5_000_000 }],
    ['/m/avorte.ogg', { chemin: '/m/avorte.ogg', taille: 512 }],
  ]);

  const { nouveaux, suspects } = nouveauxFichiers(avant, après);
  assert.deepEqual(nouveaux.map((f) => f.chemin), ['/m/complet.ogg']);
  assert.deepEqual(suspects.map((f) => f.chemin), ['/m/avorte.ogg']);
});

// ---------------------------------------------------------------------------
// Les téléchargements coupés en pleine écriture
// ---------------------------------------------------------------------------
//
// Le scénario : la synchronisation dure dix-sept heures, l'utilisateur ferme son
// Mac à la sixième. zotify est tué au milieu d'un fichier. Ce qui reste sur le
// disque est un morceau tronqué — et comme zotify tourne avec
// « --skip-existing », il le verra à chaque fois et sautera le titre. Le morceau
// serait définitivement absent, et pire, un fichier coupé après dix secondes
// pèse assez pour passer pour un succès et finir dans Rekordbox.

test('un téléchargement interrompu est mis de côté, jamais supprimé', () => {
  const racine = dossierTemporaire();
  try {
    const tronqué = path.join(racine, 'Été à Dakar.ogg');
    fs.writeFileSync(tronqué, Buffer.alloc(400_000));

    const abri = écarterIncomplet(tronqué, racine);

    assert.ok(abri, 'le fichier n’a pas pu être mis de côté');
    assert.equal(fs.existsSync(tronqué), false, 'le fichier tronqué est resté en place');
    assert.equal(fs.existsSync(abri), true, 'le fichier a été détruit au lieu d’être déplacé');
    assert.equal(path.basename(path.dirname(abri)), DOSSIER_INCOMPLETS);

    // Il ne pèse rien de moins : on déplace, on ne tronque pas davantage.
    assert.equal(fs.statSync(abri).size, 400_000);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('le dossier des incomplets est invisible pour l’inventaire, donc le morceau est repris', () => {
  const racine = dossierTemporaire();
  try {
    const tronqué = path.join(racine, 'Prix Choc.ogg');
    fs.writeFileSync(tronqué, Buffer.alloc(400_000));
    écarterIncomplet(tronqué, racine);

    // C'est tout l'intérêt du préfixe « _ » : l'inventaire l'ignore, donc
    // zotify ne verra pas le fichier et retéléchargera le morceau.
    const vu = inventorier(racine);
    assert.equal(vu.size, 0, 'le fichier écarté est encore compté comme présent');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('deux interruptions du même morceau ne s’écrasent pas', () => {
  const racine = dossierTemporaire();
  try {
    const nom = 'Même Titre.ogg';
    fs.writeFileSync(path.join(racine, nom), Buffer.alloc(100_000));
    const premier = écarterIncomplet(path.join(racine, nom), racine);

    fs.writeFileSync(path.join(racine, nom), Buffer.alloc(200_000));
    const second = écarterIncomplet(path.join(racine, nom), racine);

    assert.ok(premier && second);
    assert.notEqual(premier, second, 'la seconde tentative a écrasé la première');
    assert.equal(fs.statSync(premier).size, 100_000);
    assert.equal(fs.statSync(second).size, 200_000);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('seul le fichier en cours d’écriture est écarté, pas ceux déjà terminés', () => {
  // On rejoue la sélection exacte du pilote : parmi les nouveaux fichiers, ne
  // retenir que celui dont la date d'écriture suit l'instant de l'arrêt.
  //
  // Ce test protège les DEUX sens. Écarter trop coûterait un retéléchargement
  // inutile à chaque interruption ; écarter trop peu laisserait un morceau
  // tronqué entrer dans la bibliothèque DJ.
  const instantArrêt = 1_000_000_000_000;
  const marge = 1000;

  const nouveaux = [
    { chemin: '/m/termine-il-y-a-longtemps.ogg', modifiéLe: instantArrêt - 600_000 },
    { chemin: '/m/termine-juste-avant.ogg', modifiéLe: instantArrêt - 30_000 },
    { chemin: '/m/coupe-en-plein-vol.ogg', modifiéLe: instantArrêt + 200 },
  ];

  const écarté = nouveaux
    .filter((f) => f.modifiéLe >= instantArrêt - marge)
    .sort((a, b) => b.modifiéLe - a.modifiéLe)[0];

  assert.equal(écarté.chemin, '/m/coupe-en-plein-vol.ogg');

  // Et surtout : les deux morceaux terminés ne sont pas concernés.
  const concernés = nouveaux.filter((f) => f.modifiéLe >= instantArrêt - marge);
  assert.equal(concernés.length, 1, 'un morceau terminé a été écarté à tort');
});

test('l’inventaire note la date d’écriture, seul moyen de reconnaître le fichier coupé', () => {
  const racine = dossierTemporaire();
  try {
    fs.writeFileSync(path.join(racine, 'a.ogg'), Buffer.alloc(5_000_000));
    const [info] = [...inventorier(racine).values()];
    assert.equal(typeof info.modifiéLe, 'number');
    assert.ok(info.modifiéLe > 0);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('l’inventaire compare les accents indépendamment de leur écriture', () => {
  // Deux écritures du même « é ». Sans normalisation, le fichier paraîtrait
  // nouveau à chaque exécution et serait retéléchargé indéfiniment.
  const nfc = '/m/Crécy.ogg'.normalize('NFC');
  const nfd = '/m/Crécy.ogg'.normalize('NFD');

  const avant = inventaireFactice([nfd]);
  const après = inventaireFactice([nfc]);

  const { nouveaux } = nouveauxFichiers(avant, après);
  assert.equal(nouveaux.length, 0, 'le même fichier a été vu comme nouveau');
});

function inventaireFactice(chemins) {
  return new Map(
    chemins.map((c) => [c.normalize('NFC'), { chemin: c, taille: 5_000_000 }]),
  );
}

// ---------------------------------------------------------------------------
// Le journal des téléchargements, celui qui rend la politique de retrait sûre
// ---------------------------------------------------------------------------
//
// CE QUE LA SOURCE DE ZOTIFY 0.17.4 DIT, et qui décide de tout ici
// (`api.py`, `check_skippable` ; `utils.py`, `SongArchive`) :
//
//   si fichier présent   ET --skip-existing         ET --disable-directory-archives → sauté
//   si id dans .song_ids ET --skip-existing         ET PAS de --disable-directory-… → sauté
//   si id dans .song_archive (global) ET --skip-prev-downloaded                     → sauté
//
// Zotijean n'empruntait que la PREMIÈRE ligne, celle qui dépend du fichier. La
// politique de retrait était donc refusée en silence à chaque synchronisation :
// retirer un Ogg aurait fait tout retélécharger.
//
// ET UN DÉTAIL DÉCIDE DE TOUT, contre-intuitif, vérifié dans `utils.py:320` :
//
//     self.disabled = not Path(self.filepath).exists() or …
//     def add_obj(self, obj, item_path): if self.disabled: return
//
// Le journal ne se crée JAMAIS tout seul. Absent, il est « désactivé », donc
// zotify n'y écrit rien, donc il reste absent — pour toujours. Vérifié sur la
// machine : après 17 titres, le fichier n'existait pas. Il faut le créer vide
// une fois, et c'est le seul geste qui débloque la troisième porte.

test('le journal des téléchargements se crée vide, une fois', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-arch-'));
  try {
    const chemin = assurerJournalTéléchargements(dossier);
    assert.equal(path.basename(chemin), '.song_archive',
      'le nom est imposé par zotify : il l’ajoute au dossier qu’on lui donne');
    assert.ok(fs.existsSync(chemin));
    assert.equal(fs.readFileSync(chemin, 'utf8'), '');

    // Rejouer ne doit RIEN écraser : ce fichier vaut la bibliothèque entière.
    fs.writeFileSync(chemin, 'abc\t2026-08-19\tArtiste\tTitre\t/m/x.ogg\n');
    assurerJournalTéléchargements(dossier);
    assert.match(fs.readFileSync(chemin, 'utf8'), /^abc\t/);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('les chemins déjà téléchargés se relisent depuis le journal', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-arch2-'));
  try {
    const chemin = assurerJournalTéléchargements(dossier);
    fs.writeFileSync(chemin,
      'id1\t2026-08-19 10:00:00\tWalton\tZen\t/Musique/Été/Zen.ogg\n'
      + 'id2\t2026-08-19 10:01:00\tIglew\tHawksworth\t/Musique/Été/Hawksworth.ogg\n'
      + '\n');

    const connus = cheminsDéjàTéléchargés(dossier);
    assert.equal(connus.size, 2);
    assert.ok(connus.has('/Musique/Été/Zen.ogg'));
    assert.ok(connus.has('/Musique/Été/Hawksworth.ogg'));
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('un journal absent ne rend pas une erreur, mais un ensemble vide', () => {
  assert.equal(cheminsDéjàTéléchargés('/dossier/qui/n/existe/pas').size, 0);
});

// LE CAS OÙ LA GARDE EST SEULE À POUVOIR REFUSER. Chacune des trois conditions
// doit pouvoir dire non toute seule : l'option déclarée par zotify, le choix de
// l'utilisateur, et l'existence du journal. Le « false » en dur d'avant ne
// distinguait rien — il refusait tout, y compris quand tout était en place.
test('savoir reprendre sans le fichier exige les trois conditions', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-arch3-'));
  try {
    const capacités = { options: ['skip-prev-downloaded', 'song-archive-location'] };
    const retire = { retrait: { sourcesAprèsConversion: 'corbeille' } };
    assurerJournalTéléchargements(dossier);

    assert.equal(
      saitReprendreSansLeFichier({ config: retire, capacités, dossierJournal: dossier }),
      true,
      'tout est en place : la politique doit pouvoir s’appliquer',
    );

    assert.equal(
      saitReprendreSansLeFichier({
        config: { retrait: { sourcesAprèsConversion: 'conserver' } }, capacités, dossierJournal: dossier,
      }),
      false,
      'sans retrait demandé, on ne touche pas au comportement de zotify',
    );

    assert.equal(
      saitReprendreSansLeFichier({
        config: retire, capacités: { options: ['skip-existing'] }, dossierJournal: dossier,
      }),
      false,
      'un zotify sans l’option ne sait pas reprendre sans le fichier',
    );

    fs.rmSync(path.join(dossier, '.song_archive'));
    assert.equal(
      saitReprendreSansLeFichier({ config: retire, capacités, dossierJournal: dossier }),
      false,
      'sans le journal, zotify le tient pour desactive et n’y ecrit jamais rien',
    );
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('le journal n’est demandé à zotify que si la politique en a besoin', () => {
  const capacités = {
    options: ['root-path', 'output', 'skip-existing', 'disable-directory-archives',
      'skip-prev-downloaded', 'song-archive-location'],
    aide: '--skip-prev-downloaded SKIP_PREVIOUSLY_DOWNLOADED --song-archive-location SONG_ARCHIVE_LOCATION',
  };
  const construire = (politique) => construireArguments({
    url: 'U', attente: 30, capacités, modèle: '{song_name}', dossierRacine: '/M',
    dossierJournal: '/D',
    config: { ...CONFIG, retrait: { sourcesAprèsConversion: politique } },
  }).arguments;

  // Par defaut on ne change rien : le DISQUE fait foi, et supprimer un fichier
  // doit continuer a le faire retelecharger.
  const conserve = construire('conserver');
  assert.equal(conserve.includes('--skip-prev-downloaded'), false);

  const retire = construire('corbeille');
  assert.equal(retire[retire.indexOf('--skip-prev-downloaded') + 1], 'true');
  assert.equal(retire[retire.indexOf('--song-archive-location') + 1], '/D',
    'le journal doit vivre avec les donnees de l’app, pas dans un coin du systeme');
});
