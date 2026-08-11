// Tests du rapprochement entre une playlist et les fichiers du disque.
//
// C'est le module dont les erreurs coûtent le plus cher, et de façon
// asymétrique : conclure à tort qu'un morceau manque relance un téléchargement
// de plusieurs heures et fait croire à une bibliothèque incomplète ; conclure à
// tort qu'il est présent coûte un morceau non signalé. La prudence penche donc
// délibérément d'un côté, et ces tests le vérifient.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliser, noyau, empreintes, empreintesFichier, confronter,
} from '../src/correspondance.js';

const piste = (artiste, titre) => ({ artiste, titre });

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

test('normaliser efface les accents et la casse', () => {
  assert.equal(normaliser('Étienne de Crécy'), 'etienne de crecy');
  assert.equal(normaliser('ÉDITH PIAF'), 'edith piaf');
});

test('normaliser rend identiques les deux écritures d’un accent', () => {
  // macOS peut stocker « é » composé ou décomposé : sans cette normalisation,
  // le même fichier ne se reconnaîtrait pas lui-même.
  assert.equal(
    normaliser('Crécy'.normalize('NFC')),
    normaliser('Crécy'.normalize('NFD')),
  );
});

test('normaliser absorbe la ponctuation et les apostrophes', () => {
  assert.equal(normaliser("L'été, c'est fini !"), 'lete cest fini');
  assert.equal(normaliser('Rock & Roll'), 'rock roll');
  assert.equal(normaliser('AC/DC'), 'ac dc');
});

test('normaliser encaisse le vide sans broncher', () => {
  for (const entrée of [null, undefined, '', '   ', 123]) {
    assert.equal(typeof normaliser(entrée), 'string');
  }
});

// ---------------------------------------------------------------------------
// Ornements
// ---------------------------------------------------------------------------

test('noyau retire les mentions qui varient d’une source à l’autre', () => {
  // Ces mentions sont ajoutées ou retirées selon les catalogues : les garder
  // ferait conclure à tort qu'un morceau manque.
  assert.equal(noyau('Prix Choc - Remastered 2011'), 'prix choc 2011');
  assert.equal(noyau('Bruxelles je t’aime (Radio Edit)'), 'bruxelles je taime');
  assert.equal(noyau('Digital Love - Album Version'), 'digital love');
});

test('noyau ne vide pas un titre entièrement composé d’ornements', () => {
  // Cas limite : un titre réellement nommé « Edit » ne doit pas disparaître au
  // point de ne plus rien pouvoir identifier.
  assert.equal(typeof noyau('Edit'), 'string');
});

// ---------------------------------------------------------------------------
// Empreintes
// ---------------------------------------------------------------------------

test('les empreintes séparent le sûr du tolérant', () => {
  // La séparation n'est pas cosmétique : les empreintes portant l'artiste sont
  // épuisées AVANT le titre seul, sinon un rapprochement approximatif volerait
  // le fichier d'une correspondance exacte traitée plus tard.
  const e = empreintes(piste('Daft Punk', 'Digital Love'));
  assert.ok(e.sûres.includes('daft punk digital love'));
  assert.deepEqual(e.laxistes, ['digital love']);
  assert.ok(!e.sûres.includes('digital love'), 'le titre seul n’est pas une empreinte sûre');
});

test('les artistes en featuring produisent aussi des empreintes', () => {
  const e = empreintes({
    artiste: 'Justice', titre: 'Safe and Sound', artistes: ['Justice', 'Rick Rubin'],
  });
  assert.ok(e.sûres.some((f) => f.includes('rick rubin')));
});

test('un morceau sans titre ne produit aucune empreinte', () => {
  // Mieux vaut ne rien rapprocher que rapprocher n'importe quoi.
  const e = empreintes(piste('Daft Punk', ''));
  assert.deepEqual(e.sûres, []);
  assert.deepEqual(e.laxistes, []);
});

test('un titre entièrement composé d’ornements reste identifiable', () => {
  // « Edit » et « Deluxe » sont des mots retirés comme ornements : les vider
  // rendrait ces morceaux introuvables à jamais, donc éternellement manquants
  // et retéléchargés à chaque synchronisation.
  assert.equal(noyau('Edit'), 'edit');
  assert.equal(noyau('Deluxe'), 'deluxe');
  assert.ok(empreintes(piste('Artiste', 'Edit')).sûres.length > 0);
});

test('un morceau présent deux fois dans la playlist n’est pas compté manquant', () => {
  const doublon = { id: 'abc', artiste: 'A', titre: 'X' };
  const bilan = confronter([doublon, { ...doublon }], ['/m/A - X.ogg']);
  assert.equal(bilan.manquants.length, 0, 'le doublon est réclamé comme manquant');
  assert.equal(bilan.présents.length, 1);
});

test('une correspondance exacte prime sur une correspondance par titre seul', () => {
  // Piège concret : le morceau de B est traité en premier et ne colle que par
  // le titre. S'il prenait le fichier, celui de A — pourtant exact — serait
  // déclaré manquant.
  const bilan = confronter(
    [piste('B', 'Chanson'), piste('A', 'Chanson')],
    ['/m/A - Chanson.ogg'],
  );
  assert.equal(bilan.présents.length, 1);
  assert.equal(bilan.présents[0].piste.artiste, 'A', 'le fichier a été mal attribué');
  assert.equal(bilan.manquants[0].artiste, 'B');
});

test('un nom de fichier est réduit aux mêmes empreintes', () => {
  const e = empreintesFichier('/m/Été 2026/007 - Daft Punk - Digital Love.ogg');
  assert.ok(e.includes('daft punk digital love'));
  assert.ok(e.includes('digital love'));
});

test('le numéro de tête n’empêche pas la reconnaissance', () => {
  for (const nom of ['007 - A - B.ogg', '7. A - B.ogg', '07_A - B.ogg', 'A - B.ogg']) {
    assert.ok(
      empreintesFichier(`/m/${nom}`).includes('a b'),
      `non reconnu : ${nom}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Confrontation
// ---------------------------------------------------------------------------

test('les morceaux présents sont reconnus malgré les différences de nommage', () => {
  const pistes = [
    piste('Étienne de Crécy', 'Prix Choc'),
    piste('Daft Punk', 'Digital Love'),
  ];
  const fichiers = [
    '/m/001 - Etienne de Crecy - Prix Choc.ogg',      // sans accents
    '/m/002 - Daft Punk - Digital Love (Radio Edit).flac', // avec ornement
  ];

  const bilan = confronter(pistes, fichiers);
  assert.equal(bilan.manquants.length, 0, `manquants à tort : ${bilan.manquants.map((p) => p.titre)}`);
  assert.equal(bilan.présents.length, 2);
  assert.equal(bilan.nonReconnus.length, 0);
});

test('un morceau réellement absent est signalé', () => {
  const bilan = confronter(
    [piste('A', 'Présent'), piste('B', 'Absent')],
    ['/m/A - Présent.ogg'],
  );
  assert.equal(bilan.manquants.length, 1);
  assert.equal(bilan.manquants[0].titre, 'Absent');
});

test('un fichier étranger à la playlist est listé à part, jamais comme manquant', () => {
  const bilan = confronter(
    [piste('A', 'Dans la playlist')],
    ['/m/A - Dans la playlist.ogg', '/m/Depose a la main.mp3'],
  );
  assert.equal(bilan.manquants.length, 0);
  assert.deepEqual(bilan.nonReconnus, ['/m/Depose a la main.mp3']);
});

test('un dossier vide rend tous les morceaux manquants, et c’est fiable', () => {
  const bilan = confronter([piste('A', 'X'), piste('B', 'Y')], []);
  assert.equal(bilan.manquants.length, 2);
  assert.equal(bilan.fiabilité.sûre, true);
});

test('un rapprochement massivement raté est déclaré NON FIABLE', () => {
  // Le garde-fou décisif. Si presque rien ne correspond alors que le dossier
  // est plein, c'est le rapprochement qui a échoué — pas la bibliothèque qui
  // est vide. Agir sur cette base archiverait des morceaux valides.
  const pistes = Array.from({ length: 20 }, (_, i) => piste('Artiste', `Titre ${i}`));
  const fichiers = Array.from({ length: 20 }, (_, i) => `/m/xyz-illisible-${i}.ogg`);

  const bilan = confronter(pistes, fichiers);
  assert.equal(bilan.fiabilité.sûre, false);
  assert.match(bilan.fiabilité.raison, /pas fiable/);
});

test('une playlist vide n’est jamais jugée fiable', () => {
  // Sans cette garde, une lecture ratée de l'API ferait passer TOUS les
  // fichiers du dossier pour des orphelins à archiver.
  const bilan = confronter([], ['/m/a.ogg', '/m/b.ogg']);
  assert.equal(bilan.fiabilité.sûre, false);
  assert.equal(bilan.nonReconnus.length, 2);
});

test('un même fichier ne satisfait qu’un seul morceau', () => {
  // Deux morceaux au titre voisin ne doivent pas se partager le même fichier :
  // le second serait déclaré présent à tort.
  const bilan = confronter(
    [piste('A', 'Même titre'), piste('B', 'Même titre')],
    ['/m/A - Même titre.ogg'],
  );
  assert.equal(bilan.présents.length + bilan.manquants.length, 2);
  assert.equal(bilan.présents.length, 1, 'un fichier a été compté deux fois');
});
