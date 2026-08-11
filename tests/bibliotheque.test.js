// Tests de la gestion de bibliothèque.
//
// Ce module touche aux fichiers de l'utilisateur : ce sont les tests les plus
// importants du projet. Une erreur ici ne dégrade pas une fonctionnalité, elle
// fait disparaître de la musique.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  écrireListeLecture,
  listerAudio,
  dossierArchive,
  archiver,
  appliquerPolitiqueRetrait,
  déduireNomPlaylist,
  dossierCommun,
  sansSourcesConverties,
} from '../src/bibliotheque.js';

function bacÀSable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-biblio-'));
}

function écrire(chemin, contenu = 'x'.repeat(5_000_000)) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, contenu);
  return chemin;
}

// ---------------------------------------------------------------------------
// Listes de lecture
// ---------------------------------------------------------------------------

test('la liste de lecture est en UTF-8 sans marque d’ordre des octets', async () => {
  // La marque en tête est prise pour le début du premier chemin par plusieurs
  // lecteurs, qui ne trouvent alors aucun fichier.
  const racine = bacÀSable();
  try {
    const fichiers = [écrire(path.join(racine, 'Été 2026', 'Étienne de Crécy.ogg'))];
    const destination = path.join(racine, 'Été 2026', 'Été 2026.m3u8');
    écrireListeLecture({ destination, fichiers, titre: 'Été 2026' });

    const octets = fs.readFileSync(destination);
    assert.notEqual(octets[0], 0xef, 'marque d’ordre des octets présente');
    assert.ok(octets.toString('utf8').includes('Étienne de Crécy'));
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('les chemins de la liste sont relatifs et en barres obliques', async () => {
  // Relatifs pour que déplacer le dossier ne casse rien ; barres obliques parce
  // que c'est ce qu'attend le format, même sur Windows.
  const racine = bacÀSable();
  try {
    const fichiers = [écrire(path.join(racine, 'Été', 'a.ogg'))];
    const destination = path.join(racine, 'Été', 'liste.m3u8');
    écrireListeLecture({ destination, fichiers, titre: 'Été' });

    const contenu = fs.readFileSync(destination, 'utf8');
    assert.ok(contenu.includes('\na.ogg'), `chemin inattendu :\n${contenu}`);
    assert.ok(!contenu.includes('\\'), 'antislash trouvé dans la liste');
    assert.ok(!path.isAbsolute('a.ogg'));
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('la liste porte l’en-tête étendu et le titre', () => {
  const racine = bacÀSable();
  try {
    const fichiers = [écrire(path.join(racine, 'a.ogg'))];
    const destination = path.join(racine, 'l.m3u8');
    écrireListeLecture({ destination, fichiers, titre: 'Ma playlist' });

    const lignes = fs.readFileSync(destination, 'utf8').split('\n');
    assert.equal(lignes[0], '#EXTM3U');
    assert.equal(lignes[1], '#PLAYLIST:Ma playlist');
    assert.ok(lignes[2].startsWith('#EXTINF:'));
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('listerAudio trie comme le Finder et ignore le reste', () => {
  const racine = bacÀSable();
  try {
    for (const nom of ['010 - c.ogg', '002 - b.ogg', '001 - a.ogg', 'notes.txt', 'cover.jpg']) {
      écrire(path.join(racine, nom), 'x');
    }
    const trouvés = listerAudio(racine).map((f) => path.basename(f));
    assert.deepEqual(trouvés, ['001 - a.ogg', '002 - b.ogg', '010 - c.ogg']);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Doublons source / converti
// ---------------------------------------------------------------------------

test('un fichier d’origine est écarté quand son converti est à côté', () => {
  // Sans ce filtre, une bibliothèque de 200 titres convertis en FLAC produit
  // une liste de 400 entrées, dont 200 en Ogg que Rekordbox refuse d'ouvrir.
  const fichiers = [
    '/m/001 - a.ogg', '/m/001 - a.flac',
    '/m/002 - b.ogg', '/m/002 - b.flac',
  ];
  assert.deepEqual(
    sansSourcesConverties(fichiers, 'flac'),
    ['/m/001 - a.flac', '/m/002 - b.flac'],
  );
});

test('un fichier sans jumeau converti reste listé', () => {
  // Cas réel : le DJ dépose lui-même un morceau dans le dossier. Un filtre
  // bête sur l'extension le ferait disparaître de sa playlist.
  const fichiers = ['/m/a.ogg', '/m/a.flac', '/m/depose-a-la-main.mp3', '/m/autre.ogg'];
  assert.deepEqual(
    sansSourcesConverties(fichiers, 'flac'),
    ['/m/a.flac', '/m/depose-a-la-main.mp3', '/m/autre.ogg'],
  );
});

test('sans conversion, rien n’est écarté', () => {
  const fichiers = ['/m/a.ogg', '/m/b.ogg'];
  assert.deepEqual(sansSourcesConverties(fichiers, null), fichiers);
});

test('le filtre compare les accents indépendamment de leur écriture', () => {
  const nfc = '/m/Crécy.ogg'.normalize('NFC');
  const nfd = '/m/Crécy.flac'.normalize('NFD');
  assert.deepEqual(sansSourcesConverties([nfc, nfd], 'flac'), [nfd]);
});

test('aucun converti présent : la liste passe intacte', () => {
  const fichiers = ['/m/a.ogg', '/m/b.ogg'];
  assert.deepEqual(sansSourcesConverties(fichiers, 'flac'), fichiers);
});

// ---------------------------------------------------------------------------
// Archivage
// ---------------------------------------------------------------------------

test('le dossier d’archive est daté du jour', () => {
  const chemin = dossierArchive('/musique', new Date(2026, 7, 9));
  assert.equal(chemin, path.join('/musique', '_Archive', '2026-08-09'));
});

test('archiver déplace sans jamais écraser', () => {
  const racine = bacÀSable();
  try {
    const date = new Date(2026, 7, 9);
    const a = écrire(path.join(racine, 'Playlist', 'piste.ogg'), 'PREMIER');
    const premier = archiver(a, racine, date);
    assert.ok(!fs.existsSync(a), 'la source n’a pas été déplacée');
    assert.equal(fs.readFileSync(premier, 'utf8'), 'PREMIER');

    // Un second fichier de même nom ne doit pas écraser le premier.
    const b = écrire(path.join(racine, 'Playlist', 'piste.ogg'), 'SECOND');
    const second = archiver(b, racine, date);
    assert.notEqual(premier, second);
    assert.equal(fs.readFileSync(premier, 'utf8'), 'PREMIER');
    assert.equal(fs.readFileSync(second, 'utf8'), 'SECOND');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Politique de retrait — le garde-fou qui compte
// ---------------------------------------------------------------------------

test('la politique « conserver » ne touche à rien', async () => {
  const racine = bacÀSable();
  try {
    const dossier = path.join(racine, 'Playlist');
    écrire(path.join(dossier, 'a.ogg'));
    écrire(path.join(dossier, 'b.ogg'));

    await appliquerPolitiqueRetrait({
      dossierPlaylist: dossier, fichiersAttendus: [], politique: 'conserver', racine,
    });

    assert.equal(listerAudio(dossier).length, 2);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('une liste attendue vide ne déclenche AUCUNE suppression', async () => {
  // Le scénario catastrophe : l'énumération de la playlist échoue en amont et
  // renvoie une liste vide. Sans ce garde-fou, la bibliothèque entière partirait
  // à l'archive.
  const racine = bacÀSable();
  try {
    const dossier = path.join(racine, 'Playlist');
    for (const nom of ['a.ogg', 'b.ogg', 'c.ogg']) écrire(path.join(dossier, nom));

    const bilan = await appliquerPolitiqueRetrait({
      dossierPlaylist: dossier, fichiersAttendus: [], politique: 'archiver', racine,
    });

    assert.equal(listerAudio(dossier).length, 3, 'des fichiers ont été retirés à tort');
    assert.equal(bilan.traités.length, 0);
    assert.ok(bilan.abandonné);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un retrait massif est refusé comme suspect', async () => {
  // Si plus de la moitié du dossier serait retirée, c'est que l'énumération est
  // incomplète — pas que l'utilisateur a vidé sa playlist.
  const racine = bacÀSable();
  try {
    const dossier = path.join(racine, 'Playlist');
    const fichiers = ['a.ogg', 'b.ogg', 'c.ogg', 'd.ogg'].map((n) => écrire(path.join(dossier, n)));

    const bilan = await appliquerPolitiqueRetrait({
      dossierPlaylist: dossier,
      fichiersAttendus: [fichiers[0]], // 3 sur 4 seraient orphelins
      politique: 'archiver',
      racine,
    });

    assert.equal(listerAudio(dossier).length, 4);
    assert.ok(bilan.abandonné);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un retrait mesuré est bien appliqué', async () => {
  const racine = bacÀSable();
  try {
    const dossier = path.join(racine, 'Playlist');
    const fichiers = ['a.ogg', 'b.ogg', 'c.ogg', 'd.ogg'].map((n) => écrire(path.join(dossier, n)));

    const bilan = await appliquerPolitiqueRetrait({
      dossierPlaylist: dossier,
      fichiersAttendus: fichiers.slice(0, 3), // un seul orphelin
      politique: 'archiver',
      racine,
    });

    assert.equal(bilan.traités.length, 1);
    assert.equal(bilan.traités[0].action, 'archivé');
    assert.equal(listerAudio(dossier).length, 3);
    // Le fichier n'est pas détruit : il est ailleurs.
    assert.ok(fs.existsSync(bilan.traités[0].destination));
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('la simulation ne touche à rien mais rend le compte', async () => {
  const racine = bacÀSable();
  try {
    const dossier = path.join(racine, 'Playlist');
    const fichiers = ['a.ogg', 'b.ogg', 'c.ogg', 'd.ogg'].map((n) => écrire(path.join(dossier, n)));

    const bilan = await appliquerPolitiqueRetrait({
      dossierPlaylist: dossier,
      fichiersAttendus: fichiers.slice(0, 3),
      politique: 'corbeille',
      racine,
      simulation: true,
    });

    assert.equal(bilan.traités.length, 1);
    assert.equal(listerAudio(dossier).length, 4, 'la simulation a modifié le disque');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('la comparaison des orphelins ignore l’écriture des accents', async () => {
  // Un fichier écrit par zotify en décomposé et attendu en composé désignerait
  // deux chaînes différentes pour le même fichier : il serait archivé à tort.
  const racine = bacÀSable();
  try {
    const dossier = path.join(racine, 'Playlist');
    const composé = écrire(path.join(dossier, 'Crécy.ogg'.normalize('NFC')));
    écrire(path.join(dossier, 'autre.ogg'));
    écrire(path.join(dossier, 'encore.ogg'));
    écrire(path.join(dossier, 'toujours.ogg'));

    const bilan = await appliquerPolitiqueRetrait({
      dossierPlaylist: dossier,
      fichiersAttendus: [
        composé.normalize('NFD'), // même fichier, autre écriture
        path.join(dossier, 'autre.ogg'),
        path.join(dossier, 'encore.ogg'),
        path.join(dossier, 'toujours.ogg'),
      ],
      politique: 'archiver',
      racine,
    });

    assert.equal(bilan.traités.length, 0, 'un accent a fait archiver un fichier valide');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Déduction du nom de playlist
// ---------------------------------------------------------------------------

test('déduireNomPlaylist retrouve le dossier commun', () => {
  // Sans l'API Web de Spotify, c'est le seul vrai nom de playlist dont on
  // dispose : celui du dossier que le modèle de rangement vient de créer.
  const racine = path.join('/musique');
  const nom = déduireNomPlaylist(
    [
      path.join(racine, 'Été 2026', '001 - a.ogg'),
      path.join(racine, 'Été 2026', '002 - b.ogg'),
    ],
    racine,
  );
  assert.equal(nom, 'Été 2026');
});

test('déduireNomPlaylist prend le dernier segment commun', () => {
  const racine = path.join('/musique');
  const nom = déduireNomPlaylist(
    [
      path.join(racine, 'Été 2026', 'Daft Punk', 'a.ogg'),
      path.join(racine, 'Été 2026', 'Justice', 'b.ogg'),
    ],
    racine,
  );
  assert.equal(nom, 'Été 2026');
});

test('déduireNomPlaylist renvoie null quand rien n’est commun', () => {
  const racine = path.join('/musique');
  assert.equal(déduireNomPlaylist([], racine), null);
  assert.equal(
    déduireNomPlaylist(
      [path.join(racine, 'A', 'x.ogg'), path.join(racine, 'B', 'y.ogg')],
      racine,
    ),
    null,
  );
});

test('dossierCommun n’accepte qu’un seul dossier', () => {
  assert.equal(dossierCommun([]), null);
  assert.equal(
    dossierCommun([path.join('/m', 'A', 'x.ogg'), path.join('/m', 'B', 'y.ogg')]),
    null,
  );
  assert.equal(
    dossierCommun([path.join('/m', 'A', 'x.ogg'), path.join('/m', 'A', 'y.ogg')]),
    path.resolve('/m/A'),
  );
});

test('les téléchargements mis de côté restent invisibles pour la bibliothèque', () => {
  // CE QUE CE TEST PROTÈGE, ET POURQUOI IL EST MOINS ÉVIDENT QU'IL N'EN A L'AIR.
  //
  // Un morceau coupé en pleine écriture est déplacé dans « _incomplets ». Tout
  // l'intérêt de l'opération est qu'il cesse d'être vu : s'il restait compté
  // comme présent, l'analyse conclurait que le titre est déjà là et ne le
  // redemanderait jamais. Le morceau serait perdu, en silence, alors même qu'on
  // croit l'avoir sauvé.
  //
  // La protection tient à un détail : `listerAudio` ne descend pas dans les
  // sous-dossiers. Rendre cette fonction récursive un jour — ce qui paraîtrait
  // une amélioration — casserait la reprise sans qu'aucun autre test ne bronche.
  const racine = bacÀSable();
  try {
    fs.writeFileSync(path.join(racine, 'Complet.ogg'), Buffer.alloc(5_000_000));
    fs.mkdirSync(path.join(racine, '_incomplets'));
    fs.writeFileSync(path.join(racine, '_incomplets', 'Tronqué.ogg'), Buffer.alloc(400_000));

    const vus = listerAudio(racine).map((f) => path.basename(f));
    assert.deepEqual(vus, ['Complet.ogg'], 'un fichier mis de côté est compté comme présent');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});
