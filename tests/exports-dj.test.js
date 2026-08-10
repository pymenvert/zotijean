// Tests des exports vers Rekordbox et Serato.
//
// Ces deux formats sont écrits « à l'aveugle » : on ne peut pas vérifier ici que
// Rekordbox ouvre bien le XML ni que Serato lit bien la crate. Les tests portent
// donc sur ce qui est vérifiable et sur ce qui casse en silence — un caractère
// non échappé, un chemin mal encodé, un décalage d'un octet dans l'en-tête
// binaire. Ce sont exactement les erreurs qui produisent un fichier « valide »
// et entièrement vide.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  échapperXML,
  uriRekordbox,
  construireXMLRekordbox,
  enregistrementSerato,
  texteSerato,
  construireCrate,
  racineDuDisque,
  nomFichierCrate,
  depuisNomFichier,
} from '../src/exports-dj.js';

// ---------------------------------------------------------------------------
// Échappement XML
// ---------------------------------------------------------------------------

test('échapperXML neutralise les caractères qui cassent le fichier', () => {
  // Un seul « & » non échappé rend tout le XML illisible par Rekordbox, qui
  // refuse le fichier sans expliquer pourquoi.
  assert.equal(échapperXML('AC & DC'), 'AC &amp; DC');
  assert.equal(échapperXML('<balise>'), '&lt;balise&gt;');
  assert.equal(échapperXML('12" Mix'), '12&quot; Mix');
  assert.equal(échapperXML("L'été"), 'L&apos;été');
});

test('échapperXML retire les caractères de contrôle interdits', () => {
  // Interdits par la spécification XML 1.0 : leur présence produit un fichier
  // que Rekordbox rejette en bloc, sans expliquer pourquoi. On les écrit en
  // échappements plutôt qu'en octets bruts, faute de quoi le test lui-même
  // devient impossible à relire.
  const cloche = String.fromCharCode(0x07);
  const separateur = String.fromCharCode(0x1f);
  assert.equal(échapperXML(`Titre${cloche} avec${separateur} contrôles`), 'Titre avec contrôles');

  // La tabulation, le saut de ligne et le retour chariot restent licites.
  assert.equal(échapperXML('a\tb\nc'), 'a\tb\nc');
});

test('échapperXML préserve les accents', () => {
  assert.equal(échapperXML('Étienne de Crécy'), 'Étienne de Crécy');
});

// ---------------------------------------------------------------------------
// URI Rekordbox
// ---------------------------------------------------------------------------

test('uriRekordbox produit la forme attendue par Rekordbox', () => {
  const uri = uriRekordbox('/Users/pym/Music/piste.flac');
  assert.ok(uri.startsWith('file://localhost/'), uri);
});

test('uriRekordbox encode les espaces et les accents', () => {
  const uri = uriRekordbox('/Users/pym/Music/Été 2026/Étienne de Crécy.flac');
  assert.ok(!uri.includes(' '), 'un espace non encodé casse le chemin');
  assert.ok(uri.includes('%20'));
  assert.ok(uri.includes('%C3%89'), 'le É doit être encodé en UTF-8');
});

test('uriRekordbox n’encode pas les séparateurs de dossiers', () => {
  // Encoder les barres obliques transformerait toute l'arborescence en un seul
  // nom de fichier, et aucun morceau ne serait retrouvé.
  const uri = uriRekordbox('/a/b/c.flac');
  assert.ok(!uri.includes('%2F'));
  assert.equal((uri.match(/\//g) || []).length >= 4, true);
});

test('uriRekordbox encode aussi l’esperluette et le dièse', () => {
  const uri = uriRekordbox('/m/Rock & Roll #1.flac');
  assert.ok(!uri.includes('&'), 'l’esperluette casserait le XML');
  assert.ok(!uri.includes('#'), 'le dièse tronquerait l’URI');
});

// ---------------------------------------------------------------------------
// Fichier XML complet
// ---------------------------------------------------------------------------

function bacÀSable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-dj-'));
}

function playlistsExemple(racine) {
  const a = path.join(racine, 'a.flac');
  const b = path.join(racine, 'b.flac');
  fs.writeFileSync(a, 'x'.repeat(1000));
  fs.writeFileSync(b, 'y'.repeat(2000));
  return [
    {
      nom: 'Été 2026',
      fichiers: [
        { chemin: a, métadonnées: { titre: 'Prix Choc', artiste: 'Étienne de Crécy', duréeSecondes: 245 } },
        { chemin: b, métadonnées: { titre: 'AC & DC', artiste: 'Rock', duréeSecondes: 180 } },
      ],
    },
    {
      nom: 'Warm-up',
      // Le même fichier que dans l'autre playlist : il ne doit apparaître
      // qu'une fois dans la collection.
      fichiers: [{ chemin: a, métadonnées: { titre: 'Prix Choc', artiste: 'Étienne de Crécy' } }],
    },
  ];
}

test('le XML déclare une seule entrée par fichier, même partagé', () => {
  const racine = bacÀSable();
  try {
    const xml = construireXMLRekordbox(playlistsExemple(racine));
    assert.match(xml, /<COLLECTION Entries="2">/);
    assert.equal((xml.match(/<TRACK TrackID=/g) || []).length, 2);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('les playlists ne portent que des références vers la collection', () => {
  const racine = bacÀSable();
  try {
    const xml = construireXMLRekordbox(playlistsExemple(racine));
    assert.match(xml, /<NODE Name="Été 2026" Type="1" KeyType="0" Entries="2">/);
    assert.match(xml, /<NODE Name="Warm-up" Type="1" KeyType="0" Entries="1">/);
    assert.equal((xml.match(/<TRACK Key="/g) || []).length, 3);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('le XML est bien formé même avec des caractères hostiles', () => {
  const racine = bacÀSable();
  try {
    const fichier = path.join(racine, 'x.flac');
    fs.writeFileSync(fichier, 'z');
    const xml = construireXMLRekordbox([
      {
        nom: 'Mix & Match <2026>',
        fichiers: [{ chemin: fichier, métadonnées: { titre: 'A & B "test"', artiste: "L'artiste" } }],
      },
    ]);

    // Aucun caractère brut ne doit subsister hors des entités.
    const attributs = xml.match(/Name="[^"]*"/g) || [];
    for (const attribut of attributs) {
      assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(attribut), `non échappé : ${attribut}`);
    }
    assert.match(xml, /Name="Mix &amp; Match &lt;2026&gt;"/);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('le XML porte l’en-tête et la structure attendus', () => {
  const racine = bacÀSable();
  try {
    const xml = construireXMLRekordbox(playlistsExemple(racine));
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.match(xml, /<DJ_PLAYLISTS Version="1\.0\.0">/);
    assert.match(xml, /<NODE Type="0" Name="ROOT" Count="1">/);
    assert.ok(xml.trimEnd().endsWith('</DJ_PLAYLISTS>'));
    // Autant de balises ouvrantes que de fermantes pour les nœuds.
    assert.equal(
      (xml.match(/<NODE /g) || []).length,
      (xml.match(/<\/NODE>/g) || []).length,
    );
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('la taille réelle du fichier est reportée', () => {
  const racine = bacÀSable();
  try {
    const xml = construireXMLRekordbox(playlistsExemple(racine));
    assert.match(xml, /Size="1000"/);
    assert.match(xml, /Size="2000"/);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un fichier disparu ne fait pas échouer l’export', () => {
  // Cas réel : l'utilisateur supprime un morceau dans le Finder entre deux
  // synchronisations. Mieux vaut un export incomplet qu'aucun export.
  const xml = construireXMLRekordbox([
    { nom: 'X', fichiers: [{ chemin: '/inexistant/nulle-part.flac', métadonnées: {} }] },
  ]);
  assert.match(xml, /<COLLECTION Entries="1">/);
});

// ---------------------------------------------------------------------------
// Format binaire Serato
// ---------------------------------------------------------------------------

test('un enregistrement Serato a un en-tête de 8 octets', () => {
  const charge = Buffer.from([1, 2, 3, 4]);
  const enr = enregistrementSerato('otrk', charge);

  assert.equal(enr.length, 12);
  assert.equal(enr.subarray(0, 4).toString('ascii'), 'otrk');
  assert.equal(enr.readUInt32BE(4), 4, 'la longueur doit être en gros-boutiste');
  assert.deepEqual([...enr.subarray(8)], [1, 2, 3, 4]);
});

test('le texte Serato est en UTF-16 gros-boutiste', () => {
  // Petit-boutiste donnerait des crates que Serato affiche vides ou en
  // caractères chinois — le symptôme classique d'un octet inversé.
  const octets = texteSerato('AB');
  assert.deepEqual([...octets], [0x00, 0x41, 0x00, 0x42]);
});

test('le texte Serato gère les accents', () => {
  const octets = texteSerato('É');
  assert.deepEqual([...octets], [0x00, 0xc9]);
});

test('une crate contient une version puis un enregistrement par titre', () => {
  const crate = construireCrate(['Musique/a.flac', 'Musique/b.flac']);

  assert.equal(crate.subarray(0, 4).toString('ascii'), 'vrsn');

  // On parcourt les enregistrements de premier niveau.
  const étiquettes = [];
  let position = 0;
  while (position < crate.length) {
    const étiquette = crate.subarray(position, position + 4).toString('ascii');
    const longueur = crate.readUInt32BE(position + 4);
    étiquettes.push(étiquette);
    position += 8 + longueur;
  }

  assert.deepEqual(étiquettes, ['vrsn', 'otrk', 'otrk']);
  assert.equal(position, crate.length, 'les longueurs déclarées ne tombent pas juste');
});

test('chaque titre d’une crate enveloppe un chemin', () => {
  const crate = construireCrate(['Musique/Été.flac']);

  // On saute l'enregistrement de version.
  const longueurVersion = crate.readUInt32BE(4);
  const début = 8 + longueurVersion;

  assert.equal(crate.subarray(début, début + 4).toString('ascii'), 'otrk');
  assert.equal(crate.subarray(début + 8, début + 12).toString('ascii'), 'ptrk');

  const longueurChemin = crate.readUInt32BE(début + 12);
  const chemin = crate.subarray(début + 16, début + 16 + longueurChemin)
    .swap16().toString('utf16le');
  assert.equal(chemin, 'Musique/Été.flac');
});

test('les chemins d’une crate utilisent des barres obliques', () => {
  // Serato attend des barres obliques quelle que soit la plateforme.
  const crate = construireCrate([path.join('Musique', 'Été', 'a.flac')]);
  const texte = crate.swap16().toString('utf16le');
  assert.ok(!texte.includes('\\'), 'un antislash rend la crate vide sur macOS');
});

test('nomFichierCrate exprime l’imbrication par %%', () => {
  assert.equal(nomFichierCrate('Été 2026'), 'Zotijean%%Été 2026.crate');
  assert.equal(nomFichierCrate('Techno', 'Spotify'), 'Spotify%%Techno.crate');
});

test('nomFichierCrate neutralise ce qui casserait le nom', () => {
  // Le nom d'affichage vient uniquement du nom de fichier : une barre oblique
  // ou un « % » parasite y crée une fausse imbrication.
  assert.equal(nomFichierCrate('Rock/Metal'), 'Zotijean%%Rock_Metal.crate');
  assert.equal(nomFichierCrate('50%'), 'Zotijean%%50_.crate');
});

// ---------------------------------------------------------------------------
// Racine du disque
// ---------------------------------------------------------------------------

test('racineDuDisque isole le point de montage', () => {
  if (process.platform === 'darwin') {
    assert.equal(racineDuDisque('/Volumes/DJ-SSD/Musique/a.flac'), '/Volumes/DJ-SSD');
    assert.equal(racineDuDisque('/Users/pym/Music/a.flac'), '/');
  } else {
    // Sur Windows, la racine est la lettre de lecteur.
    assert.match(racineDuDisque(path.resolve('/m/a.flac')), /^[A-Za-z]:\\$|^\/$/);
  }
});

// ---------------------------------------------------------------------------
// Repli sur le nom de fichier
// ---------------------------------------------------------------------------

test('depuisNomFichier sépare l’artiste et le titre', () => {
  assert.deepEqual(
    depuisNomFichier('/m/007 - Étienne de Crécy - Prix Choc.flac'),
    { titre: 'Prix Choc', artiste: 'Étienne de Crécy' },
  );
});

test('depuisNomFichier garde les tirets du titre', () => {
  assert.deepEqual(
    depuisNomFichier('/m/Artiste - Titre - Remix.flac'),
    { titre: 'Titre - Remix', artiste: 'Artiste' },
  );
});

test('depuisNomFichier se contente du titre quand il n’y a pas de séparateur', () => {
  assert.deepEqual(
    depuisNomFichier('/m/Morceau sans artiste.flac'),
    { titre: 'Morceau sans artiste', artiste: '' },
  );
});
