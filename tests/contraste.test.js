// Lisibilité de la coche des listes à choix multiple.
//
// L'état coché est un carré rempli en « --accent » sur lequel on trace une coche
// en « --fond ». Ces deux teintes sont recalculées séparément pour chaque thème
// dans public/app.css : rien ne garantit qu'elles restent contrastées l'une par
// rapport à l'autre le jour où quelqu'un retouche la palette. La coche
// disparaîtrait dans son propre remplissage, sans un mot.
//
// CE QUE CE FICHIER NE COUVRE PAS, et qu'il ne faut pas croire couvert :
// le contour de la case DÉCOCHÉE, mesuré à 1,40:1 en thème sombre et 1,43:1 en
// clair — moins de la moitié du seuil. C'est l'état par défaut de ces listes, et
// c'est un défaut réel. Il n'est pas testé ici parce qu'il est PRÉEXISTANT et
// partagé : « --bord-vif » borde aussi les puces rondes, les champs et les
// bascules. Le corriger est un arbitrage de palette, pas un réglage de ce lot.
// Écrit noir sur blanc pour que personne ne conclue de ce fichier que « les
// contrastes sont testés ».
//
// Seuil retenu : 3 pour 1, celui d'un élément d'interface non textuel
// (WCAG 2.1, critère 1.4.11). Une coche est un pictogramme d'état, pas une
// phrase : 4,5:1 serait le mauvais seuil.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sansCommentaires } from './aide-analyse-source.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Les commentaires sont neutralisés AVANT toute lecture, et ce n'est pas une
// précaution de principe : vérifié, une palette réellement cassée (coche à
// 1,04:1) redevenait verte à 9,39:1 dès qu'un commentaire citant l'ancienne
// valeur la précédait. Or app.css commente abondamment ses couleurs, juste
// au-dessus de la palette.
const FEUILLE = sansCommentaires(fs.readFileSync(path.join(RACINE, 'public', 'app.css'), 'utf8'));

const MARQUEUR_CLAIR = '@media (prefers-color-scheme: light)';

// ---------------------------------------------------------------------------
// Lecture de la palette
// ---------------------------------------------------------------------------

/**
 * Le bloc « :root » d'un thème.
 *
 * Le thème sombre est la valeur par défaut ; le thème clair la RECALCULE dans
 * une requête de média — jamais un simple éclaircissement. On borne la lecture
 * au bloc lui-même : une tranche courant jusqu'à la fin du fichier laisserait la
 * recherche filer sur n'importe quelle autre couleur si la déclaration attendue
 * changeait de notation.
 */
function blocRacine(theme) {
  const coupure = FEUILLE.indexOf(MARQUEUR_CLAIR);
  assert.notEqual(
    coupure,
    -1,
    `« ${MARQUEUR_CLAIR} » est introuvable dans app.css. La requête de média a ` +
      `changé de forme : le découpage par thème ne veut plus rien dire, et ce ` +
      `test lirait deux fois la même palette.`,
  );
  const tranche = theme === 'clair' ? FEUILLE.slice(coupure) : FEUILLE.slice(0, coupure);
  const bloc = /:root\s*\{([^}]*)\}/.exec(tranche);
  assert.ok(bloc, `aucun bloc « :root » trouvé pour le thème ${theme}`);
  return bloc[1];
}

/** Les déclarations d'une variable dans un bloc, sans interprétation. */
function déclarations(nom, theme) {
  const trouvées = [...blocRacine(theme).matchAll(new RegExp(`--${nom}\\s*:\\s*([^;]+);`, 'g'))];
  assert.equal(
    trouvées.length,
    1,
    `--${nom} devrait être déclarée exactement une fois dans le « :root » du ` +
      `thème ${theme} ; ${trouvées.length} trouvée(s). Une lecture ambiguë ` +
      `renverrait la mauvaise valeur en silence.`,
  );
  return trouvées[0][1].trim();
}

/** Une couleur opaque, en hexadécimal à six chiffres. */
function couleur(nom, theme) {
  const valeur = déclarations(nom, theme);
  assert.match(
    valeur,
    /^#[0-9a-fA-F]{6}$/,
    `--${nom} (thème ${theme}) vaut « ${valeur} ». Ce test ne sait lire qu'un ` +
      `hexadécimal à six chiffres : une notation rgb(), color-mix(), un hex court ` +
      `ou un canal alpha doivent faire ÉCHOUER la lecture, jamais passer ` +
      `silencieusement. Étendre la lecture, ou convertir la déclaration.`,
  );
  return valeur.toLowerCase();
}

/** Une couleur translucide « rgba(r, v, b, a) ». */
function couleurTransparente(nom, theme) {
  const valeur = déclarations(nom, theme);
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(valeur);
  assert.ok(m, `--${nom} (thème ${theme}) vaut « ${valeur} », attendu une notation rgba().`);
  return { r: +m[1], v: +m[2], b: +m[3], a: +m[4] };
}

// ---------------------------------------------------------------------------
// Contraste
// ---------------------------------------------------------------------------

const canal = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function contraste(a, b) {
  const luminance = (hex) => {
    const [r, v, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * canal(r) + 0.7152 * canal(v) + 0.0722 * canal(bl);
  };
  const [haut, bas] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (haut + 0.05) / (bas + 0.05);
}

/** Compose une couleur translucide sur un fond opaque. */
function composer(dessus, dessous) {
  const [r, v, b] = [1, 3, 5].map((i) => parseInt(dessous.slice(i, i + 2), 16));
  const mêler = (d, f) => Math.round(dessus.a * d + (1 - dessus.a) * f);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return `#${hex(mêler(dessus.r, r))}${hex(mêler(dessus.v, v))}${hex(mêler(dessus.b, b))}`;
}

// ---------------------------------------------------------------------------
// Cas positifs — le calcul et la lecture prouvent d'abord qu'ils fonctionnent
// ---------------------------------------------------------------------------

test('le calcul de contraste donne les repères connus', () => {
  assert.equal(Math.round(contraste('#ffffff', '#000000')), 21);
  assert.equal(Math.round(contraste('#ffffff', '#ffffff')), 1);
  // Un échange des canaux rouge et bleu passerait les deux repères ci-dessus,
  // qui sont gris. Il faut une couleur saturée pour l'attraper : le rouge pur
  // et le bleu pur n'ont pas du tout la même luminance.
  assert.equal(contraste('#ff0000', '#000000').toFixed(2), '5.25');
  assert.equal(contraste('#0000ff', '#000000').toFixed(2), '2.44');
  assert.equal(contraste('#00ff00', '#000000').toFixed(2), '15.30');
});

test('le calcul applique bien la correction gamma', () => {
  // Angle mort des repères ci-dessus : à pleine intensité, avec ou sans gamma,
  // un canal vaut 1. Une formule qui OUBLIE la correction — l'erreur la plus
  // courante sur ce calcul — leur passe donc à travers, teintes pures comprises.
  // Seule une teinte MOYENNE sépare les deux : 4,48 avec gamma, 2,03 sans.
  assert.equal(contraste('#777777', '#ffffff').toFixed(2), '4.48');
});

test('la composition d’une couche translucide donne les repères connus', () => {
  assert.equal(composer({ r: 255, v: 255, b: 255, a: 1 }, '#000000'), '#ffffff');
  assert.equal(composer({ r: 255, v: 255, b: 255, a: 0 }, '#000000'), '#000000');
  assert.equal(composer({ r: 255, v: 255, b: 255, a: 0.5 }, '#000000'), '#808080');
});

test('la relecture de la palette distingue vraiment les deux thèmes', () => {
  // Un test de contraste qui lirait deux fois la même valeur passerait sans rien
  // vérifier. On exige que les deux thèmes soient bien séparés.
  assert.notEqual(couleur('fond', 'sombre'), couleur('fond', 'clair'));
  assert.notEqual(couleur('accent', 'sombre'), couleur('accent', 'clair'));
  assert.notEqual(couleur('carte-haut', 'sombre'), couleur('carte-haut', 'clair'));
});

// ---------------------------------------------------------------------------
// La règle que ce fichier prétend garder
// ---------------------------------------------------------------------------

/** Le corps d'une règle CSS, sélecteur et accolades retirés. */
function règle(sélecteur) {
  const début = FEUILLE.indexOf(sélecteur + ' {');
  assert.notEqual(
    début,
    -1,
    `La règle « ${sélecteur} » a disparu de app.css : ce fichier mesurerait ` +
      `une palette sans rapport avec ce que l’écran dessine.`,
  );
  const ouvre = FEUILLE.indexOf('{', début);
  const ferme = FEUILLE.indexOf('}', ouvre);
  assert.notEqual(ferme, -1, `la règle « ${sélecteur} » n’est pas refermée`);
  return FEUILLE.slice(ouvre + 1, ferme);
}

/** Le nom de la variable passée à var(…) par une propriété d'une règle. */
function variableDe(sélecteur, propriété) {
  const déclaration = règle(sélecteur)
    .split(';')
    .find((d) => d.trim().startsWith(propriété + ':'));
  assert.ok(déclaration, `« ${propriété} » n’est plus déclarée dans ${sélecteur}`);
  const i = déclaration.indexOf('var(--');
  assert.notEqual(
    i,
    -1,
    `« ${propriété} » de ${sélecteur} ne prend plus sa couleur dans une variable ` +
      `de la palette : ce test ne peut plus savoir quoi mesurer.`,
  );
  return déclaration.slice(i + 6, déclaration.indexOf(')', i));
}

test('la coche a de quoi être dessinée', () => {
  // Trois invariants qui ne sont PAS esthétiques : les violer rend la coche
  // invisible, ce qui est une panne, pas un changement de goût. On ne teste en
  // revanche ni les 3,5 × 7 px, ni la rotation — épingler ces valeurs casserait
  // au premier ajustement visuel sans qu'aucun utilisateur n'ait rien perdu.
  const corps = règle('.option.choisi .puce.carree::after');
  assert.match(
    corps,
    /content\s*:/,
    'la coche ne déclare plus son propre « content » : elle redeviendrait ' +
      'dépendante de la règle de la puce ronde, et disparaîtrait si on y ajoutait ' +
      '« :not(.carree) » — un nettoyage parfaitement naturel.',
  );
  assert.match(corps, /position\s*:/, 'la coche ne déclare plus sa propre position');
});

test('la classe qui porte la coche est bien celle que le balisage pose', () => {
  // Si « carree » est renommée dans app.js, la règle CSS devient morte et ce
  // fichier continuerait de valider un dessin que plus personne ne rend.
  const script = fs.readFileSync(path.join(RACINE, 'public', 'app.js'), 'utf8');
  assert.match(
    script,
    /class="puce carree"/,
    'aucun « class="puce carree" » dans public/app.js : la règle de la coche ne ' +
      's’applique plus à rien.',
  );
});

// ---------------------------------------------------------------------------
// Les contrastes eux-mêmes
// ---------------------------------------------------------------------------

for (const theme of ['sombre', 'clair']) {
  test(`la coche se détache de son remplissage en thème ${theme}`, () => {
    // Les DEUX couleurs sont lues dans les règles, jamais codées ici. Repeindre
    // la coche ou le remplissage dans une autre variable doit déplacer ce que le
    // test mesure — sinon il continuerait de valider un couple périmé.
    const trait = variableDe('.option.choisi .puce.carree::after', 'border');
    const dessous = variableDe('.option.choisi .puce.carree::before', 'background');
    const rapport = contraste(couleur(trait, theme), couleur(dessous, theme));
    assert.ok(
      rapport >= 3,
      `la coche (--${trait}) est à ${rapport.toFixed(2)}:1 sur son remplissage ` +
        `(--${dessous}) en thème ${theme} — sous 3:1, elle se noie dedans et ` +
        `l'utilisateur ne sait plus ce qui est coché.`,
    );
  });

  test(`la case cochée se détache de la ligne qui la porte en thème ${theme}`, () => {
    // La case n'est jamais posée sur « --carte » : elle est dans une
    // « .option.choisi », dont le fond est « --accent-doux » COMPOSÉ sur le fond
    // de la ligne. Mesurer contre --carte annonçait 8,34:1 là où l'écran donne
    // près de 6 — une marge deux fois trop flatteuse.
    const support = variableDe('.option', 'background');
    const teinte = variableDe('.option.choisi', 'background');
    const surface = composer(couleurTransparente(teinte, theme), couleur(support, theme));
    const rapport = contraste(couleur(variableDe('.option.choisi .puce.carree::before', 'background'), theme), surface);
    assert.ok(
      rapport >= 3,
      `la case cochée est à ${rapport.toFixed(2)}:1 sur sa ligne en thème ${theme}.`,
    );
  });
}
