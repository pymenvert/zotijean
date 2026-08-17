// Lisibilité des listes de réglages : ce qu'on croit avoir choisi, et ce qu'on
// arrive à lire.
//
// Deux défauts vus à l'écran, tous deux invisibles depuis le code seul.
//
// 1. UN ENCADRÉ D'EXPLICATION portait exactement la peinture d'une option
//    COCHÉE : même fond, même rayon, une bordure ambre dont seule l'opacité
//    différait — et sur un trait d'un pixel, cet écart n'existe pas. Dans la
//    carte du format des fichiers, la note glissée sous les cinq options se
//    lisait comme une sixième option, cochée elle aussi.
//    Le défaut est sémantique, pas esthétique : l'ambre veut dire « vous avez
//    choisi ceci » partout ailleurs. L'employer aussi pour du texte informatif
//    retire au signal sa signification.
//
// 2. LE TITRE D'UNE OPTION RECOMMANDÉE se cassait mot par mot. « Tous les deux
//    jours » s'affichait sur quatre lignes, et toute la rangée s'alignait sur
//    cette carte : les trois voisines se retrouvaient avec un titre d'une ligne
//    et soixante pixels de vide dessous.
//
// CE QUE CE FICHIER NE PEUT PAS FAIRE, et qu'il ne faut pas croire couvert :
// il ne CALCULE aucune mise en page. Personne ici ne sait si « Tous les deux
// jours » tient sur une ligne — il faudrait un navigateur pour cela, et le seul
// verdict qui compte viendra du Mac. Ce que ces tests gardent, ce sont les deux
// propriétés SANS LESQUELLES le repli est impossible, et la distinction de
// couleur sans laquelle les deux surfaces redeviennent jumelles. C'est une garde
// contre le retour du défaut, pas une preuve que l'écran est beau.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sansCommentaires } from './aide-analyse-source.js';
import { contraste, lecteurDe } from './aide-lecture-css.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Les commentaires sont neutralisés avant lecture, par alignement sur
// tests/contraste.test.js — où cette précaution est PROUVÉE nécessaire (une
// palette cassée y redevenait verte à cause d'un commentaire citant l'ancienne
// valeur). Ici elle ne porte rien aujourd'hui : les commentaires d'app.css sont
// tous indentés, et l'ancrage en début de ligne les écarte déjà. Elle est
// conservée parce que la même feuille est lue par les deux fichiers, et qu'un
// jour un commentaire non indenté suffirait à ouvrir le trou.
const FEUILLE = sansCommentaires(fs.readFileSync(path.join(RACINE, 'public', 'app.css'), 'utf8'));

const { couleur, règle, variableDe } = lecteurDe(FEUILLE);

// ---------------------------------------------------------------------------
// Cas positif — le lecteur prouve d'abord qu'il sait échouer
// ---------------------------------------------------------------------------

test('la lecture d’une règle refuse un sélecteur qui n’existe pas', () => {
  // Un fichier qui interroge une feuille de style peut devenir muet sans rien
  // dire : il suffit qu'un sélecteur soit renommé pour que chaque question
  // porte sur du vide. On exige donc que l'absence soit une ERREUR bruyante,
  // jamais une réponse vide. Deux scanners de ce dépôt sont déjà revenus vides.
  //
  // Ce n'est pas décoratif : plusieurs assertions de ce fichier sont NÉGATIVES
  // (« cette règle ne porte pas de filet »), et une assertion négative passerait
  // tout aussi bien si la lecture rendait une chaîne vide. Elles ne valent que
  // parce que l'absence lève.
  assert.throws(() => règle('.selecteur-qui-nexiste-pas'), /EXACTEMENT UNE règle/);
  assert.doesNotThrow(() => règle('.note'));
});

test('la chaîne de lecture retrouve un défaut sur une feuille fabriquée pour ça', () => {
  // Le seul cas positif honnête pour une chaîne de lecture : la faire tourner
  // entièrement — trouver la règle, y trouver la propriété, en extraire la
  // variable, la résoudre dans le bon thème — sur une feuille dont on connaît
  // d'avance le défaut. Épingler quelques valeurs n'exercerait que le calcul.
  // Cette feuille reproduit l'état d'AVANT la correction : les deux surfaces s'y
  // peignent de la même couleur.
  const avantCorrection = [
    ':root { --carte-haut: #1f242c; --accent-doux: rgba(240, 168, 54, .13); }',
    '@media (prefers-color-scheme: light) {',
    '  :root { --carte-haut: #fafbfc; --accent-doux: rgba(154, 98, 9, .1); }',
    '}',
    '.note { background: var(--accent-doux); }',
    '.option.choisi { background: var(--accent-doux); }',
  ].join('\n');
  const vieux = lecteurDe(avantCorrection);

  // 1. Elle voit le défaut que ce lot a corrigé.
  assert.equal(
    vieux.variableDe('.note', 'background'),
    vieux.variableDe('.option.choisi', 'background'),
    'la lecture ne retrouve plus le défaut d’origine sur la feuille qui le porte',
  );

  // 2. Elle sépare vraiment les deux thèmes — un lecteur qui rendrait deux fois
  //    la même palette validerait n’importe quoi.
  assert.equal(vieux.couleur('carte-haut', 'sombre'), '#1f242c');
  assert.equal(vieux.couleur('carte-haut', 'clair'), '#fafbfc');

  // 3. Elle REFUSE de faire passer une couleur translucide pour opaque.
  assert.throws(() => vieux.couleur('accent-doux', 'sombre'), /hexadécimal à six chiffres/);
});

// ---------------------------------------------------------------------------
// L'ambre ne veut dire qu'une chose
// ---------------------------------------------------------------------------

// Les surfaces neutres de la palette — celles qui ne veulent rien dire.
const SURFACES_NEUTRES = ['fond', 'fond-2', 'carte', 'carte-haut'];

test('un encadré d’explication ne se peint pas dans la couleur de l’état choisi', () => {
  const fondNote = variableDe('.note', 'background');
  const fondChoisi = variableDe('.option.choisi', 'background');
  // La liste blanche dit la règle de conception à voix haute, là où une simple
  // inégalité se contenterait d'un autre nom. Repeindre les encadrés en ambre
  // sous une variable neuve — « --note-fond » — ramènerait exactement le défaut
  // en satisfaisant l'inégalité ci-dessous.
  assert.ok(
    SURFACES_NEUTRES.includes(fondNote),
    `un encadré d'explication se peint avec --${fondNote}, qui n'est pas une ` +
      `surface neutre de la palette. Un encadré informe : il ne doit emprunter ` +
      `la couleur d'aucun état.`,
  );
  assert.notEqual(
    fondNote,
    fondChoisi,
    `un encadré d'explication et une option cochée se remplissent tous deux de ` +
      `--${fondNote}. Ils deviennent indiscernables, et une carte qui contient ` +
      `trois explications a l'air d'avoir trois réglages cochés. La couleur de ` +
      `l'état choisi ne doit servir qu'à l'état choisi.`,
  );
});

test('un encadré d’explication se distingue aussi par sa FORME', () => {
  // Une distinction qui ne tiendrait qu'à la couleur laisserait de côté ceux qui
  // les perçoivent mal — et ils sont précisément ceux que ce lot concerne.
  // Le filet vertical est ce second signal, indépendant de toute teinte. Il est
  // même le SEUL qui sépare un encadré d'une option NON cochée : les deux
  // partagent le même fond et la même bordure.
  // « [1-9] » exige une épaisseur RÉELLE : « border-left: 0 » est une
  // déclaration parfaitement valide, et ce n'est pas un filet.
  assert.match(
    règle('.note'),
    /border-left\s*:\s*[1-9]/,
    `l'encadré d'explication n'a plus de filet vertical. Il ne se distingue ` +
      `alors d'une option cochée que par sa couleur de fond — un seul signal, ` +
      `et le plus fragile des deux — et plus DU TOUT d'une option non cochée, ` +
      `dont il partage le fond et la bordure.`,
  );
  for (const voisin of ['.option', '.option.choisi']) {
    assert.doesNotMatch(
      règle(voisin),
      /border-left\s*:/,
      `« ${voisin} » s'est mis à porter un filet vertical, comme les encadrés ` +
        `d'explication : la distinction de forme vient de disparaître.`,
    );
  }
});

test('la mention de version n’emprunte pas l’habit d’un encadré d’explication', () => {
  // Elle vit dans la MÊME carte que les contrôles du diagnostic, dont le filet
  // coloré à gauche EST le codage de gravité. Avec le filet ambre des notes,
  // « Zotijean version 1.0.7 » se lisait comme un avertissement de plus :
  // --accent et --attention ne sont qu'à 1,09:1 l'un de l'autre.
  const balisage = fs.readFileSync(path.join(RACINE, 'public', 'index.html'), 'utf8');
  const ligne = /<div[^>]*id="version-app"[^>]*>/.exec(balisage);
  assert.ok(ligne, 'la ligne de version a disparu de public/index.html');
  assert.doesNotMatch(
    ligne[0],
    /class="[^"]*\bnote\b/,
    `la mention de version porte de nouveau la classe « note ». Elle reprendrait ` +
      `le filet ambre des explications, au bas de la seule liste où un filet ` +
      `coloré signifie « quelque chose ne va pas ».`,
  );
});

for (const theme of ['sombre', 'clair']) {
  test(`le texte d’un encadré d’explication reste lisible en thème ${theme}`, () => {
    // Changer le fond d'un encadré peut le rendre illisible sans que personne
    // ne s'en aperçoive : c'est le risque direct de la correction ci-dessus.
    // Seuil 4,5 — ce sont des phrases entières, à 12,5 px.
    const texte = couleur(variableDe('.note', 'color'), theme);
    const fond = couleur(variableDe('.note', 'background'), theme);
    const rapport = contraste(texte, fond);
    assert.ok(
      rapport >= 4.5,
      `le texte d'un encadré d'explication est à ${rapport.toFixed(2)}:1 sur son ` +
        `fond en thème ${theme}. C'est la ligne qui dit franchement ce qu'on perd ` +
        `en choisissant une option : la plus importante ne peut pas être la ` +
        `moins lisible.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Le titre garde ses mots entiers
// ---------------------------------------------------------------------------

test('le titre d’une option peut renvoyer son étiquette à la ligne', () => {
  const titre = règle('.option-titre');
  // La fin de valeur « (;|$) » n'est pas une précaution de style : sans elle,
  // « wrap-reverse » passe pour « wrap » — et il fait remonter l'étiquette
  // AU-DESSUS du titre, ce qui est un autre défaut, pas une correction.
  assert.match(
    titre,
    /flex-wrap\s*:\s*wrap\s*(;|$)/,
    `le titre d'une option et son étiquette « Recommandé » sont de nouveau ` +
      `enfermés sur une seule ligne. Ils se compriment alors l'un l'autre ` +
      `jusqu'à leur plus petite largeur possible, c'est-à-dire jusqu'au MOT : ` +
      `« Tous les deux jours » se casse en quatre lignes, et toute la rangée de ` +
      `cartes s'aligne sur celle-là.`,
  );
  // « flex-wrap » ne veut rien dire hors d'un conteneur flex. Sans cette ligne,
  // retirer « display: flex » laisse la garde verte et la propriété inerte.
  assert.match(
    titre,
    /display\s*:\s*flex\s*(;|$)/,
    `le titre d'une option n'est plus un conteneur flex : « flex-wrap » n'y a ` +
      `plus aucun effet, et la garde ci-dessus ne garde plus rien.`,
  );
  // Autoriser le repli des ÉLÉMENTS ne sert à rien si le TEXTE est cloué.
  assert.doesNotMatch(
    titre,
    /white-space\s*:\s*nowrap/,
    `le titre d'une option interdit désormais au texte de se couper : il ` +
      `débordera de sa carte au lieu de se replier.`,
  );
});

test('la grille des réglages garde des rangées de même hauteur', () => {
  // Corriger le titre replié ne suffisait pas : une rangée dont un titre tient
  // sur deux lignes mesurait 79 px pendant que la suivante en faisait 50, et
  // six cartes censées former un bloc s'affichaient sur deux hauteurs. Le vide
  // sous un titre court doit être une marge assumée, pas un décalage.
  assert.match(
    règle('.choix.compact'),
    /grid-auto-rows\s*:\s*1fr\s*(;|$)/,
    `la grille des réglages laisse de nouveau ses rangées prendre des hauteurs ` +
      `différentes : une carte dont le titre se replie fera dépasser toute sa ` +
      `rangée, et la grille paraîtra bancale.`,
  );
});

test('le bandeau d’accueil peut se replier plutôt qu’élargir la page', () => {
  // Le même défaut que le titre d'option, un cran plus haut, et celui-là
  // débordait de la fenêtre : mesuré, à 375 px de large la page en réclamait
  // 430 et défilait horizontalement sur les sept onglets. Un conteneur flex
  // sans repli, dont les enfants refusent de rétrécir, ne cède jamais — c'est
  // la page qui s'élargit.
  for (const sél of ['.heros', '.heros-actions']) {
    assert.match(
      règle(sél),
      /flex-wrap\s*:\s*wrap\s*(;|$)/,
      `« ${sél} » ne peut plus se replier : sur une fenêtre étroite, la page ` +
        `s'élargira au lieu de passer à la ligne, et il faudra défiler ` +
        `horizontalement pour lire quoi que ce soit.`,
    );
  }
});

// Une propriété déclarée DEUX FOIS dans une même règle : c'est la dernière que
// l'écran applique, et toutes les lectures de ce fichier trouvent la première.
// Vérifié : ajouter « flex-wrap: nowrap » à la fin du titre d'option ramène le
// défaut d'origine sans faire tomber un seul test. La garde est posée une fois
// pour toutes les règles surveillées, plutôt que propriété par propriété.
for (const sél of [
  '.option-titre',
  '.note',
  '.option',
  '.option.choisi',
  '.etiquette-reco',
  '.etiquette-perte',
  '.etiquette-sansperte',
]) {
  test(`« ${sél} » ne déclare aucune propriété deux fois`, () => {
    const noms = règle(sél)
      .split(';')
      .map((d) => d.trim().split(':')[0].trim())
      .filter(Boolean);
    const doublons = [...new Set(noms.filter((p, i) => noms.indexOf(p) !== i))];
    assert.deepEqual(
      doublons,
      [],
      `« ${sél} » déclare deux fois : ${doublons.join(', ')}. C'est la DERNIÈRE ` +
        `déclaration que l'écran applique, et les lectures de ce fichier ` +
        `trouvent la première — elles garderaient donc une valeur que personne ` +
        `ne voit. Fusionner les déclarations.`,
    );
  });
}

// Une règle plus spécifique — ou la même dans une requête de média — l'emporte
// silencieusement sur celle qui est relue plus haut, et la lecture est ancrée en
// début de ligne : elle ne verrait ni l'une ni l'autre. Vérifié : poser
// « .choix.compact .option-titre { flex-wrap: nowrap } » reproduit le défaut
// d'origine à l'identique, sans faire tomber un seul test.
// On interdit donc que ces sélecteurs soient cités ailleurs. Le jour où une
// surcharge deviendra légitime, c'est ce test qu'il faudra rouvrir —
// délibérément, et pas par accident.
for (const sél of ['.option-titre', '.etiquette-reco', '.etiquette-perte', '.etiquette-sansperte']) {
  test(`« ${sél} » n’est surchargé nulle part ailleurs dans la feuille`, () => {
    const citations = FEUILLE.split(sél).length - 1;
    assert.equal(
      citations,
      1,
      `« ${sél} » est cité ${citations} fois dans app.css. La règle relue par ` +
        `les tests ci-dessus n'est peut-être plus celle qui peint.`,
    );
  });
}

for (const étiquette of ['.etiquette-reco', '.etiquette-perte', '.etiquette-sansperte']) {
  test(`l’étiquette « ${étiquette.replace('.etiquette-', '')} » ne se comprime pas`, () => {
    // Autoriser le repli ne suffit pas : sans cette garde, l'étiquette rétrécit
    // elle aussi avant que le repli n'ait lieu, et c'est « RECOM-MANDÉ » qu'on
    // obtient. Elle passe à la ligne entière, ou elle reste où elle est.
    // Fin de valeur exigée : « flex-shrink: 0.5 » commence par un zéro et
    // comprime encore — on obtiendrait « RECOM-MANDÉ » avec la garde au vert.
    assert.match(
      règle(étiquette),
      /flex\s*:\s*none\s*(;|$)|flex-shrink\s*:\s*0\s*(;|$)/,
      `« ${étiquette} » peut de nouveau être comprimée par la rangée qui la ` +
        `contient : elle se coupera au milieu d'un mot au lieu de passer à la ` +
        `ligne suivante.`,
    );
  });
}
