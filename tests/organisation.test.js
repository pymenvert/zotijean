// Tests du moteur d'organisation.
//
// Ce module décide du nom de chaque fichier téléchargé. Une erreur ici ne casse
// pas bruyamment : elle produit des noms légèrement différents à chaque
// exécution, et l'app retélécharge indéfiniment la même bibliothèque. D'où le
// niveau de détail de ces tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  tronquerOctets,
  assainirSegment,
  rendre,
  cheminRelatif,
  désambiguïser,
  cléComparaison,
  validerModèle,
  modèleActif,
  aperçu,
} from '../src/organisation.js';

import { VARIABLES, SCHÉMAS } from '../src/options.js';

const NOMS_VARIABLES = VARIABLES.map((v) => v.nom);
const octets = (s) => Buffer.byteLength(s, 'utf8');

// ---------------------------------------------------------------------------
// Troncature sur les octets
// ---------------------------------------------------------------------------

test('tronquerOctets laisse passer ce qui tient déjà', () => {
  assert.equal(tronquerOctets('Prix Choc', 240), 'Prix Choc');
});

test('tronquerOctets respecte la limite en octets, pas en caractères', () => {
  // « é » pèse 2 octets en UTF-8 : 100 caractères font 200 octets.
  const texte = 'é'.repeat(100);
  assert.equal(texte.length, 100);
  assert.equal(octets(texte), 200);

  const coupé = tronquerOctets(texte, 51);
  assert.ok(octets(coupé) <= 51);
  assert.equal(coupé.length, 25); // 25 caractères = 50 octets
});

test('tronquerOctets ne coupe jamais au milieu d’un caractère', () => {
  // Un emoji pèse 4 octets. Couper à 3 doit produire une chaîne vide, pas un
  // fichier que le système refuse d'ouvrir.
  for (const texte of ['🎧', 'ré🎧', 'Étienne de Crécy — Prix Choc']) {
    for (let limite = 0; limite <= octets(texte) + 2; limite++) {
      const coupé = tronquerOctets(texte, limite);
      assert.ok(octets(coupé) <= limite, `dépassement à la limite ${limite}`);
      // Un aller-retour sans perte prouve qu'aucune séquence n'est tronquée.
      assert.equal(
        Buffer.from(coupé, 'utf8').toString('utf8'),
        coupé,
        `séquence UTF-8 cassée à la limite ${limite}`,
      );
      assert.ok(!coupé.includes('\uFFFD'), `caractère de remplacement à ${limite}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Assainissement d'un segment
// ---------------------------------------------------------------------------

test('assainirSegment préserve les espaces et les tirets', () => {
  // Régression : une classe de caractères trop large les avait un temps
  // remplacés par des soulignés, ce qui déformait tous les noms.
  assert.equal(
    assainirSegment('Étienne de Crécy - Prix Choc'),
    'Étienne de Crécy - Prix Choc',
  );
});

test('assainirSegment remplace les caractères interdits', () => {
  assert.equal(assainirSegment('AC/DC'), 'AC_DC');
  assert.equal(assainirSegment('Who Made Who ? (12" Mix)'), 'Who Made Who _ (12_ Mix)');
  assert.equal(assainirSegment('a:b*c|d<e>f'), 'a_b_c_d_e_f');
});

test('assainirSegment supprime les caractères de contrôle', () => {
  assert.equal(assainirSegment('Prix\u0000 Choc\u001f'), 'Prix_ Choc_');
});

test('assainirSegment normalise en NFC', () => {
  const nfd = 'Cre\u0301cy'; // « e » + accent combinant
  const nfc = 'Crécy';
  assert.notEqual(nfd, nfc);
  assert.equal(assainirSegment(nfd), nfc);
  assert.equal(assainirSegment(nfd), assainirSegment(nfc));
});

test('assainirSegment retire les points et tirets de tête', () => {
  assert.equal(assainirSegment('.caché'), 'caché');
  assert.equal(assainirSegment('--option'), 'option');
});

test('assainirSegment retire les points et espaces de fin', () => {
  // Windows les supprime silencieusement : le nom écrit ne serait pas celui relu.
  assert.equal(assainirSegment('Intro...'), 'Intro');
  assert.equal(assainirSegment('Intro   '), 'Intro');
});

test('assainirSegment protège les noms réservés de Windows', () => {
  assert.equal(assainirSegment('CON'), 'CON_');
  assert.equal(assainirSegment('aux'), 'aux_');
  assert.equal(assainirSegment('COM1'), 'COM1_');
  assert.equal(assainirSegment('CONCERT'), 'CONCERT'); // ne doit pas se déclencher
});

test('assainirSegment ne renvoie jamais une chaîne vide', () => {
  assert.equal(assainirSegment(''), 'Sans titre');
  assert.equal(assainirSegment('...'), 'Sans titre');
  assert.equal(assainirSegment(null), 'Sans titre');
  assert.equal(assainirSegment(undefined), 'Sans titre');
});

test('assainirSegment applique les options de mise en forme', () => {
  assert.equal(
    assainirSegment('Prix Choc', { remplacerEspacesPar: '_' }),
    'Prix_Choc',
  );
  assert.equal(assainirSegment('Prix Choc', { minuscule: true }), 'prix choc');
  assert.equal(assainirSegment('ÉTIENNE', { minuscule: true }), 'étienne');
});

test('assainirSegment borne la longueur à la limite du système de fichiers', () => {
  const long = 'é'.repeat(500);
  const résultat = assainirSegment(long);
  assert.ok(octets(résultat) <= 240);
});

// ---------------------------------------------------------------------------
// Rendu des modèles
// ---------------------------------------------------------------------------

const MORCEAU = {
  playlist: 'Été 2026',
  numéro: 7,
  artiste: 'Étienne de Crécy',
  titre: 'Prix Choc',
  album: 'Super Discount',
  artiste_album: 'Étienne de Crécy',
  piste: 3,
  disque: 1,
  année: '1996',
  genre: 'French House',
};

test('rendre substitue les variables accentuées', () => {
  // Régression : `\w` étant limité à l'ASCII en JavaScript, {numéro} et {année}
  // n'étaient pas reconnus et se retrouvaient tels quels dans les noms.
  const résultat = rendre('{année}/{numéro} - {titre}', MORCEAU);
  assert.equal(résultat, path.join('1996', '007 - Prix Choc'));
  assert.ok(!résultat.includes('{'));
});

test('rendre rembourre les numéros pour que le tri du Finder soit juste', () => {
  assert.equal(rendre('{numéro}', { numéro: 7 }), '007');
  assert.equal(rendre('{numéro}', { numéro: 142 }), '142');
  assert.equal(rendre('{piste}', { piste: 3 }), '03');
});

test('rendre découpe les dossiers sur les barres obliques du modèle', () => {
  const résultat = rendre('{playlist}/{artiste}/{titre}', MORCEAU);
  assert.equal(
    résultat,
    path.join('Été 2026', 'Étienne de Crécy', 'Prix Choc'),
  );
});

test('rendre neutralise une barre oblique venue d’une valeur', () => {
  // Sans ça, un artiste nommé « AC/DC » créerait un dossier parasite.
  const résultat = rendre('{artiste}/{titre}', { artiste: 'AC/DC', titre: 'T.N.T' });
  assert.equal(résultat, path.join('AC_DC', 'T.N.T'));
  assert.equal(résultat.split(path.sep).length, 2);
});

test('rendre remplace les valeurs manquantes par un libellé lisible', () => {
  const résultat = rendre('{artiste}/{album}/{titre}', {
    artiste: '', album: null, titre: undefined,
  });
  assert.equal(
    résultat,
    path.join('Artiste inconnu', 'Sans album', 'Sans titre'),
  );
});

test('rendre ne laisse jamais de segment vide', () => {
  const résultat = rendre('{genre}//{titre}', { genre: '', titre: 'X' });
  assert.ok(!résultat.split(path.sep).some((s) => s === ''));
});

test('rendre gère un modèle sans aucune variable', () => {
  assert.equal(rendre('Musique', {}), 'Musique');
});

// ---------------------------------------------------------------------------
// Chemin final
// ---------------------------------------------------------------------------

test('cheminRelatif ajoute l’extension du format choisi', () => {
  const orga = {
    schéma: 'par_playlist',
    modèlePersonnalisé: '',
    minusculeForcée: false,
    remplacerEspacesPar: '',
  };
  assert.equal(
    cheminRelatif(orga, MORCEAU, 'ogg'),
    path.join('Été 2026', '007 - Étienne de Crécy - Prix Choc.ogg'),
  );
  assert.ok(cheminRelatif(orga, MORCEAU, 'flac').endsWith('.flac'));
});

test('cheminRelatif suit le schéma personnalisé quand il est choisi', () => {
  const orga = {
    schéma: 'personnalise',
    modèlePersonnalisé: '{genre}/{artiste} — {titre}',
    minusculeForcée: false,
    remplacerEspacesPar: '',
  };
  assert.equal(
    cheminRelatif(orga, MORCEAU, 'ogg'),
    path.join('French House', 'Étienne de Crécy — Prix Choc.ogg'),
  );
});

test('tous les schémas prédéfinis produisent un chemin valide', () => {
  for (const schéma of SCHÉMAS) {
    if (schéma.id === 'personnalise') continue;
    const orga = {
      schéma: schéma.id,
      modèlePersonnalisé: '',
      minusculeForcée: false,
      remplacerEspacesPar: '',
    };
    const chemin = cheminRelatif(orga, MORCEAU, 'ogg');

    assert.ok(chemin.endsWith('.ogg'), `${schéma.id} : extension manquante`);
    assert.ok(!chemin.includes('{'), `${schéma.id} : variable non substituée`);
    assert.ok(!path.isAbsolute(chemin), `${schéma.id} : chemin absolu`);
    assert.ok(!chemin.includes('..'), `${schéma.id} : remontée de dossier`);
    for (const segment of chemin.split(path.sep)) {
      assert.ok(segment.length > 0, `${schéma.id} : segment vide`);
      assert.ok(
        Buffer.byteLength(segment, 'utf8') <= 255,
        `${schéma.id} : segment trop long`,
      );
    }
  }
});

test('modèleActif retombe sur un modèle sûr si le schéma est inconnu', () => {
  const modèle = modèleActif({ schéma: 'inexistant', modèlePersonnalisé: '' });
  assert.ok(modèle.includes('{titre}'));
});

// ---------------------------------------------------------------------------
// Désambiguïsation et comparaison
// ---------------------------------------------------------------------------

test('désambiguïser insère une marque stable avant l’extension', () => {
  const résultat = désambiguïser('Été 2026/Prix Choc.ogg', '4cOdK2wGLETKBW3PvgPWqT');
  assert.ok(résultat.endsWith('.ogg'));
  assert.ok(résultat.includes('[4cOdK2]'));
  // Déterministe : le même identifiant donne toujours le même nom.
  assert.equal(
    résultat,
    désambiguïser('Été 2026/Prix Choc.ogg', '4cOdK2wGLETKBW3PvgPWqT'),
  );
});

test('désambiguïser rend la main si l’identifiant est absent', () => {
  assert.equal(désambiguïser('a.ogg', ''), 'a.ogg');
  assert.equal(désambiguïser('a.ogg', null), 'a.ogg');
});

test('cléComparaison rend identiques les deux écritures d’un accent', () => {
  // Le cœur du piège NFC/NFD : sans ça, l'app retélécharge à l'infini.
  const nfd = 'Cre\u0301cy/Prix Choc.ogg';
  const nfc = 'Crécy/Prix Choc.ogg';
  assert.notEqual(nfd, nfc);
  assert.equal(cléComparaison(nfd), cléComparaison(nfc));
});

// ---------------------------------------------------------------------------
// Validation d'un modèle personnalisé
// ---------------------------------------------------------------------------

test('validerModèle accepte un modèle correct', () => {
  assert.deepEqual(
    validerModèle('{playlist}/{numéro} - {artiste} - {titre}', NOMS_VARIABLES),
    [],
  );
});

test('validerModèle refuse un modèle vide', () => {
  assert.equal(validerModèle('', NOMS_VARIABLES).length, 1);
  assert.equal(validerModèle('   ', NOMS_VARIABLES).length, 1);
});

test('validerModèle signale une variable inconnue', () => {
  const problèmes = validerModèle('{bpm}/{titre}', NOMS_VARIABLES);
  assert.ok(problèmes.some((p) => p.includes('{bpm}')));
});

test('validerModèle refuse un modèle qui ne distingue pas les morceaux', () => {
  const problèmes = validerModèle('{artiste}/{album}', NOMS_VARIABLES);
  assert.ok(problèmes.some((p) => p.includes('écraseraient')));
});

test('validerModèle refuse un chemin absolu ou une remontée', () => {
  assert.ok(validerModèle('/Musique/{titre}', NOMS_VARIABLES).length > 0);
  assert.ok(validerModèle('C:/Musique/{titre}', NOMS_VARIABLES).length > 0);
  assert.ok(validerModèle('../{titre}', NOMS_VARIABLES).length > 0);
});

test('toutes les variables du catalogue sont réellement substituées', () => {
  // Garde-fou : ajouter une variable à options.js sans la gérer dans
  // organisation.js produirait des « {machin} » dans les noms de fichiers.
  for (const nom of NOMS_VARIABLES) {
    const rendu = rendre(`{${nom}}`, MORCEAU);
    assert.ok(
      !rendu.includes('{'),
      `la variable {${nom}} n’est pas substituée (rendu : ${rendu})`,
    );
  }
});

// ---------------------------------------------------------------------------
// Aperçu
// ---------------------------------------------------------------------------

test('aperçu produit une ligne principale et les cas piégeux', () => {
  const résultat = aperçu({
    schéma: 'par_playlist',
    modèlePersonnalisé: '',
    minusculeForcée: false,
    remplacerEspacesPar: '',
  });

  assert.ok(résultat.lignes.length >= 5);
  assert.equal(résultat.lignes.filter((l) => l.principal).length, 1);
  for (const ligne of résultat.lignes) {
    assert.ok(ligne.chemin.endsWith('.ogg'));
    assert.ok(!ligne.chemin.includes('{'));
  }
});

test('aperçu montre le nettoyage sur le cas des caractères interdits', () => {
  const résultat = aperçu({
    schéma: 'plat',
    modèlePersonnalisé: '',
    minusculeForcée: false,
    remplacerEspacesPar: '',
  });
  const cas = résultat.lignes.find((l) => l.étiquette === 'Caractères interdits');
  assert.ok(cas.chemin.includes('AC_DC'));
  assert.ok(!cas.chemin.includes('AC/DC'));
});

test('aperçu tronque réellement le titre très long', () => {
  const résultat = aperçu({
    schéma: 'plat',
    modèlePersonnalisé: '',
    minusculeForcée: false,
    remplacerEspacesPar: '',
  });
  const cas = résultat.lignes.find((l) => l.étiquette === 'Titre très long');
  for (const segment of cas.chemin.split(path.sep)) {
    assert.ok(Buffer.byteLength(segment, 'utf8') <= 255);
  }
});

// ---------------------------------------------------------------------------
// La règle du projet, gardée pour de bon
// ---------------------------------------------------------------------------
//
// « Tout ce qui est arbitrable est configurable, avec une ligne d'explication
// honnête sous chaque choix, incluant l'inconvénient. Ce texte fait partie du
// livrable, pas de la documentation. »
//
// Cette règle est écrite en tête d'`options.js` et dans `CLAUDE.md`, et rien ne
// la gardait. Mesuré sur l'app réelle le 19 août 2026 : 6 explications vides sur
// 32, toutes dans les intervalles de vérification. On choisissait un rythme de
// synchronisation sans qu'on vous dise ce que chacun coûte — au milieu de vingt-
// six autres options qui, elles, le disaient.
test('aucune option arbitrable ne reste sans explication', async () => {
  const options = await import('../src/options.js');

  const listes = {
    QUALITÉS: options.QUALITÉS,
    FORMATS: options.FORMATS,
    SCHÉMAS: options.SCHÉMAS,
    POLITIQUES_RETRAIT: options.POLITIQUES_RETRAIT,
    SOURCES_APRÈS_CONVERSION: options.SOURCES_APRÈS_CONVERSION,
    RYTHMES: options.RYTHMES,
    INTERVALLES: options.INTERVALLES,
    EXPORTS_DJ: options.EXPORTS_DJ,
    SOURCES_ACHATS: options.SOURCES_ACHATS,
  };

  const nues = [];
  for (const [nom, liste] of Object.entries(listes)) {
    assert.ok(Array.isArray(liste) && liste.length, `${nom} est vide ou absente`);
    for (const entrée of liste) {
      if (!String(entrée.explication ?? '').trim()) nues.push(`${nom} → ${entrée.libellé}`);
    }
  }

  assert.deepEqual(nues, [], `des choix sans explication :\n  ${nues.join('\n  ')}`);
});

// Une explication qui ne dit que du bien n'est pas une explication honnête :
// c'est un argumentaire. La règle exige l'inconvénient.
test('une explication n’est pas un slogan', async () => {
  const { INTERVALLES } = await import('../src/options.js');
  for (const intervalle of INTERVALLES) {
    assert.ok(
      intervalle.explication.length >= 80,
      `« ${intervalle.libellé} » : ${intervalle.explication.length} caractères, trop court `
      + 'pour dire à la fois ce qu’on y gagne et ce qu’on y perd.',
    );
  }
});

// ET LE GARDE QUI COMPTE VRAIMENT, parce que le premier ne suffisait pas.
//
// Les six intervalles étaient muets à l'écran, et le relevé accusait
// `options.js`. Le catalogue n'était que la moitié de l'histoire :
// `public/app.js` écrivait `explication: ''` EN DUR au moment de fabriquer ces
// options. Le texte aurait pu être parfaitement rédigé dans le catalogue, il
// n'aurait jamais atteint l'écran.
//
// Encore la même forme de défaut : deux pièces justes, un assemblage qui ment.
// Un test sur le catalogue seul serait resté vert sur une app muette.
test('l’interface ne vide l’explication d’aucune option', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const source = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'public', 'app.js'), 'utf8',
  );

  // Cas positif d'abord : le scanner doit prouver qu'il détecte. Un scanner qui
  // ne trouve rien parce qu'il cherche mal a déjà coûté deux balayages à ce dépôt.
  const MOTIF = /explication\s*:\s*(''|""|`\s*`)/g;
  assert.equal(
    ("      explication: '',").match(MOTIF)?.length,
    1,
    'le scanner ne reconnaît même pas le défaut qu’il est écrit pour attraper',
  );

  const trouvés = source.match(MOTIF) || [];
  assert.deepEqual(
    trouvés, [],
    'public/app.js vide une explication au lieu de passer celle du catalogue : '
    + 'le réglage sera muet à l’écran quoi qu’on écrive dans options.js.',
  );
});
