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
  // Qualité, format, rythme — et la reprise des morceaux effacés, qui exige une
  // option que cette vieille version n'a pas.
  assert.equal(nonAppliqués.length, 4);
  assert.ok(nonAppliqués.some((m) => m.includes('qualité')));
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
