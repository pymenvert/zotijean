// Lisibilité des contrôles : ce qui se coche, se saisit, se bascule, se clique.
//
// Deux choses distinctes sont gardées ici.
//
// 1. LA COCHE d'une case cochée. L'état coché est un carré rempli en « --accent »
//    sur lequel on trace une coche en « --fond ». Ces deux teintes sont
//    recalculées séparément pour chaque thème dans public/app.css : rien ne
//    garantit qu'elles restent contrastées l'une par rapport à l'autre le jour
//    où quelqu'un retouche la palette. La coche disparaîtrait dans son propre
//    remplissage, sans un mot.
//
// 2. LE CONTOUR des contrôles au repos — case décochée, puce ronde, champ de
//    texte, jeton, bascule éteinte, bouton. Il était à 1,40:1 en sombre et
//    1,42:1 en clair, moins de la moitié du seuil, parce qu'une SEULE variable
//    « --bord-vif » servait à la fois ce qui se manipule et ce qui décore.
//    La monter aurait repeint du même coup les bordures de cartes, de
//    notifications et de la fenêtre d'accueil — du décor pur, qui n'a aucun
//    seuil à tenir et n'avait rien demandé. Les deux rôles sont donc séparés :
//    « --bord-controle » pour les contrôles, « --bord-vif » pour le décor.
//
// Ces mesures partent du SÉLECTEUR, jamais du nom de la variable, et exigent le
// seuil contre TOUTES les surfaces de la palette plutôt que contre le fond
// supposé d'un élément. Deux conséquences voulues : reposer un contour pâle sur
// une case à cocher fait tomber la suite quel que soit le nom qu'on lui donne,
// et déplacer un contrôle d'une carte vers le fond de page ne peut pas le faire
// passer sous le seuil en silence.
//
// CE QUE CE FICHIER NE COUVRE PAS, et qu'il ne faut pas croire couvert :
// les couleurs de TEXTE, les anneaux de focus, les pictogrammes et les jauges,
// ainsi que les palettes indépendantes de public/notice.css et public/retour.css.
//
// Trois exclusions délibérées, à ne pas prendre pour des oublis :
//  - Le CADRE d'une ligne de réglage (« .option ») reste sur le trait de décor,
//    à 1,13:1. Ce qui identifie le contrôle est la puce qu'il contient, gardée
//    ici ; le cadre ne fait que regrouper un titre et son explication.
//  - Un bouton DÉSACTIVÉ voit son bord s'effacer avec « opacity: .45 ». WCAG
//    exclut explicitement les composants inactifs du critère 1.4.11.
//  - « --fond-2 » et « --carte » valent tous deux #ffffff en thème clair : les
//    « quatre surfaces » n'en font vraiment que trois de ce côté.
//
// Et surtout : rien ici n'a jamais été RENDU par un navigateur. Tout est calculé
// depuis la source, sur un poste Windows, pour une app dont la cible est un Mac.
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
  // Le contour des contrôles est la variable la plus exposée à l'oubli : elle
  // est neuve, et une palette de thème clair qui ne la redéclare pas hérite
  // sans bruit de la valeur sombre — un gris moyen posé sur du blanc.
  assert.notEqual(couleur('bord-controle', 'sombre'), couleur('bord-controle', 'clair'));
});

test('la mesure retrouve le défaut qu’elle a été écrite pour attraper', () => {
  // Un détecteur qui ne trouve rien ressemble trait pour trait à un code propre.
  // Voici donc le cas positif connu : la palette d'AVANT la correction, dont on
  // exige qu'elle soit toujours reconnue comme un échec. Ces quatre valeurs sont
  // historiques et figées — les relire dans app.css les rendrait circulaires.
  assert.equal(contraste('#343c48', '#1f242c').toFixed(2), '1.40'); // contour sombre
  assert.equal(contraste('#d0d5dc', '#fafbfc').toFixed(2), '1.42'); // contour clair
  assert.ok(contraste('#343c48', '#1f242c') < 3);
  assert.ok(contraste('#d0d5dc', '#fafbfc') < 3);
});

// ---------------------------------------------------------------------------
// La règle que ce fichier prétend garder
// ---------------------------------------------------------------------------

const échapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Le corps d'une règle CSS, sélecteur et accolades retirés.
 *
 * L'ancrage en DÉBUT DE LIGNE n'est pas cosmétique : « .jeton { » est une
 * sous-chaîne de « code.jeton { », qui existe bel et bien plus bas dans cette
 * feuille. Une recherche libre mesurerait la mauvaise règle le jour où l'une
 * passe devant l'autre — sans rien signaler, en rendant un rapport
 * parfaitement plausible.
 *
 * La contrepartie, à connaître avant de s'y fier : l'ancrage rend INVISIBLES
 * les sélecteurs indentés, et cette feuille en contient — ceux des requêtes de
 * média (« .coque », « .rail », « .onglet span »…). Aucun n'est mesuré
 * aujourd'hui ; le jour où il faudra en garder un, c'est cette fonction qu'il
 * faudra étendre. D'où un message d'erreur qui nomme les deux causes possibles
 * plutôt que d'accuser une disparition.
 */
function règle(sélecteur) {
  const trouvées = [...FEUILLE.matchAll(new RegExp(`^${échapper(sélecteur)}\\s*\\{`, 'gm'))];
  assert.equal(
    trouvées.length,
    1,
    `« ${sélecteur} » devrait ouvrir EXACTEMENT UNE règle en début de ligne dans ` +
      `app.css ; ${trouvées.length} trouvée(s).\n` +
      `À zéro : la règle a disparu, ou s’est fait indenter dans une requête de ` +
      `média — ce fichier mesurerait alors une palette sans rapport avec l’écran.\n` +
      `À deux : c’est la CASCADE qui décide laquelle peint, et ce fichier lirait ` +
      `la première — donc pas forcément celle-là. Vérifié sur ce dépôt : une ` +
      `bordure pâle ajoutée au SECOND bloc « .jeton » laissait toute la suite au ` +
      `vert. Fusionner les deux règles.`,
  );
  const début = trouvées[0].index;
  const ouvre = FEUILLE.indexOf('{', début);
  const ferme = FEUILLE.indexOf('}', ouvre);
  assert.notEqual(ferme, -1, `la règle « ${sélecteur} » n’est pas refermée`);
  return FEUILLE.slice(ouvre + 1, ferme);
}

/** La déclaration brute d'une propriété dans une règle. */
function déclarationDe(sélecteur, propriété) {
  const déclaration = règle(sélecteur)
    .split(';')
    .find((d) => d.trim().startsWith(propriété + ':'));
  assert.ok(déclaration, `« ${propriété} » n’est plus déclarée dans ${sélecteur}`);
  return déclaration;
}

/**
 * La même, en exigeant que la couleur soit OPAQUE et unique.
 *
 * C'est la garde la plus importante du fichier, et elle protège contre une
 * mesure FLATTEUSE, pas contre une absence de mesure — bien plus difficile à
 * repérer. Une couche translucide, un mélange ou un dégradé changent ce que
 * l'écran peint sans changer le nom de la variable : lire la variable brute
 * rendrait un chiffre confortable pour un contrôle invisible à l'écran.
 *
 * Vérifié sur ce dépôt, deux fois. La bordure du bouton d'action dangereuse
 * donne 1,88:1 une fois peinte, et 5,19:1 si on lit « --erreur » toute seule :
 * un facteur 2,8. Et poser un « color-mix(…, 30%, transparent) » sur la case à
 * cocher laissait la suite entièrement verte pour un bord réel à 1,4:1.
 *
 * Qui a besoin de mesurer une couche composée passe par « couleurMêlée », qui
 * la compose sur son fond au lieu de la supposer opaque.
 */
function déclarationOpaqueDe(sélecteur, propriété) {
  const déclaration = déclarationDe(sélecteur, propriété);
  for (const forme of ['color-mix(', 'gradient(', 'rgba(', 'hsla(']) {
    assert.ok(
      !déclaration.includes(forme),
      `« ${propriété} » de ${sélecteur} passe par ${forme}…) : la couleur peinte ` +
        `n’est pas celle de la variable, et cette lecture la SURESTIMERAIT. ` +
        `Composer la couche sur son fond avec « couleurMêlée », ou sortir ce ` +
        `contrôle de la garde en écrivant noir sur blanc pourquoi.`,
    );
  }
  assert.ok(
    déclaration.split('var(--').length <= 2,
    `« ${propriété} » de ${sélecteur} cite plusieurs variables : cette lecture ne ` +
      `sait pas laquelle l’écran montre.`,
  );
  return déclaration;
}

/** Le nom de la variable passée à var(…) par une propriété d'une règle. */
function variableDe(sélecteur, propriété) {
  const déclaration = déclarationOpaqueDe(sélecteur, propriété);
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

// ---------------------------------------------------------------------------
// Le contour des contrôles au repos
// ---------------------------------------------------------------------------

/**
 * Les surfaces sur lesquelles un contrôle peut se poser.
 *
 * Le seuil est exigé contre TOUTES, pas contre le fond supposé de chaque
 * élément. C'est plus sévère que la norme, et c'est délibéré : le contour d'un
 * champ sépare déjà deux fonds à la fois — le sien à l'intérieur, celui de la
 * carte à l'extérieur — et un contrôle déménage au fil des versions. « Ce
 * contour tient partout » est la seule formulation qui survive à un
 * déplacement dans le balisage ; « il tient sur --carte-haut » deviendrait faux
 * le jour où la même case à cocher se retrouve sur le fond de page, sans que
 * personne n'ait touché à une couleur.
 */
const SURFACES = ['fond', 'fond-2', 'carte', 'carte-haut'];

/**
 * Ce que l'écran dessine, et la propriété qui en donne la couleur.
 *
 * La liste part des SÉLECTEURS, et aucun nom de variable de contour n'y figure.
 * C'est ce qui permet à ces tests de survivre à un renommage de la palette, et
 * surtout de TOMBER si quelqu'un repose un gris pâle sur une case à cocher —
 * y compris en réutilisant « --bord-vif », qui reste dans le fichier pour le
 * décor et n'a, lui, aucun seuil à tenir.
 */
const CONTRÔLES = [
  ['.puce', 'border', 'la case à cocher et la puce ronde, décochées'],
  ['input[type="text"]', 'border', 'le contour d’un champ de texte'],
  [
    '.surcharge-ligne select, .surcharge-ligne input[type="text"]',
    'border',
    'les champs d’une surcharge de playlist',
  ],
  ['.jeton', 'border', 'un jeton de nommage'],
  ['.curseur', 'background', 'la piste d’une bascule éteinte'],
  ['.bouton', 'border', 'le contour d’un bouton'],
  ['.option:hover', 'border-color', 'la ligne d’option survolée'],
];

test('les listes gardées n’ont pas rétréci en silence', () => {
  // Une boucle sur une liste vidée passe au vert sans rien mesurer, et c'est
  // indiscernable d'une suite qui protège. Les deux listes sont donc épinglées :
  // les vider doit être un geste délibéré, jamais l'effet de bord d'un nettoyage.
  //
  // Les deux échouent différemment, et c'est pour ça qu'il en faut deux. Vider
  // CONTRÔLES ne fabrique aucun test — la disparition se voit au décompte final.
  // Vider SURFACES est bien plus sournois : les quatorze tests de contour
  // restent là, restent VERTS, et ne comparent plus une seule couleur. Vérifié.
  assert.equal(
    CONTRÔLES.length,
    7,
    'un contrôle est sorti de la garde. Geste délibéré, ou effet de bord d’un ' +
      'nettoyage ?',
  );
  assert.equal(
    SURFACES.length,
    4,
    'une surface est sortie de la garde : les tests de contour en mesureraient ' +
      'moins tout en restant verts — le pire des deux mondes.',
  );
});

for (const theme of ['sombre', 'clair']) {
  for (const [sélecteur, propriété, quoi] of CONTRÔLES) {
    test(`${quoi} — contour visible sur toutes les surfaces, thème ${theme}`, () => {
      const nom = variableDe(sélecteur, propriété);
      for (const surface of SURFACES) {
        const rapport = contraste(couleur(nom, theme), couleur(surface, theme));
        assert.ok(
          rapport >= 3,
          `${quoi} — « ${sélecteur} », qui prend sa couleur dans --${nom} — est à ` +
            `${rapport.toFixed(2)}:1 sur --${surface} en thème ${theme}. Sous 3:1, ` +
            `le contrôle n'a plus de bord visible : rien ne dit à l'utilisateur ` +
            `qu'il y a là quelque chose à cocher, à saisir ou à cliquer.`,
        );
      }
    });
  }
}

/**
 * La couleur d'une propriété, qu'elle vienne de la palette ou soit écrite en
 * clair. Le rond de la bascule est un blanc littéral : il ne passe par aucune
 * variable, et une lecture qui n'accepterait que « var(--…) » ne saurait pas le
 * mesurer — donc ne le garderait pas.
 */
function couleurDe(sélecteur, propriété, theme) {
  const déclaration = déclarationOpaqueDe(sélecteur, propriété);
  if (déclaration.includes('var(--')) return couleur(variableDe(sélecteur, propriété), theme);
  const m = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(déclaration);
  assert.ok(
    m,
    `« ${propriété} » de ${sélecteur} ne donne ni une variable de la palette ni ` +
      `un hexadécimal : ce test ne peut plus savoir quoi mesurer.`,
  );
  const brut = m[1].toLowerCase();
  return '#' + (brut.length === 3 ? [...brut].map((c) => c + c).join('') : brut);
}

for (const theme of ['sombre', 'clair']) {
  test(`le rond de la bascule se détache de sa piste ALLUMÉE en thème ${theme}`, () => {
    // L'état allumé est celui qui porte l'information « ce réglage est en
    // marche » — c'est donc le plus important des deux, et il était le seul non
    // mesuré. Un rond blanc sur l'ambre clair du thème sombre donnait 2,03:1 :
    // la bascule active devenait une pastille presque unie.
    const rond = couleurDe('.bascule input:checked + .curseur::after', 'background', theme);
    const piste = couleurDe('.bascule input:checked + .curseur', 'background', theme);
    const rapport = contraste(rond, piste);
    assert.ok(
      rapport >= 3,
      `le rond de la bascule est à ${rapport.toFixed(2)}:1 sur sa piste ALLUMÉE ` +
        `en thème ${theme} : l'état actif devient une pastille unie, et c'est ` +
        `justement l'état qui dit que le réglage est en marche.`,
    );
  });

  test(`le rond de la bascule se détache de sa piste éteinte en thème ${theme}`, () => {
    // Effet de bord direct de la correction du contour : éclaircir la piste
    // pour la rendre visible rapproche forcément le rond blanc qui glisse
    // dessus. Les deux mesures tirent en sens inverse, et rien d'autre ne
    // surveille la seconde. La bascule éteinte deviendrait une pastille unie.
    const rond = couleurDe('.curseur::after', 'background', theme);
    const piste = couleurDe('.curseur', 'background', theme);
    const rapport = contraste(rond, piste);
    assert.ok(
      rapport >= 3,
      `le rond de la bascule est à ${rapport.toFixed(2)}:1 sur sa piste éteinte ` +
        `en thème ${theme} : on ne voit plus de quel côté il est posé, donc plus ` +
        `si le réglage est actif.`,
    );
  });
}

/**
 * Une couleur écrite « color-mix(in srgb, var(--X) N%, transparent) », composée
 * sur le fond qui la reçoit.
 *
 * Ces mélanges sont le point aveugle naturel d'une garde de contraste : ils
 * ressemblent à une couleur, mais leur valeur réelle dépend de ce qu'il y a
 * DESSOUS. Une lecture qui ne les compose pas rendrait un chiffre flatteur, ou
 * refuserait de lire — les deux sont pires qu'une mesure juste.
 */
function couleurMêlée(sélecteur, propriété, theme, fond) {
  const déclaration = déclarationDe(sélecteur, propriété);
  const m = /color-mix\(\s*in srgb\s*,\s*var\(--([a-z0-9-]+)\)\s+([\d.]+)%\s*,\s*transparent\s*\)/i.exec(
    déclaration,
  );
  assert.ok(
    m,
    `« ${propriété} » de ${sélecteur} n’est plus un mélange « color-mix(…, ` +
      `transparent) » lisible : ce test ne peut plus savoir quoi composer.`,
  );
  const teinte = couleur(m[1], theme);
  const [r, v, b] = [1, 3, 5].map((i) => parseInt(teinte.slice(i, i + 2), 16));
  return composer({ r, v, b, a: Number(m[2]) / 100 }, fond);
}

/**
 * Les couleurs d'arrêt d'un dégradé.
 *
 * Un dégradé n'a pas UNE couleur. Le texte posé dessus doit rester lisible sur
 * toute sa hauteur, donc sur chacune de ses extrémités : mesurer une moyenne
 * rendrait un chiffre que personne ne voit à l'écran, et masquerait justement
 * l'extrémité qui pose problème.
 */
function arrêtsDuDégradé(sélecteur, propriété, theme) {
  const déclaration = déclarationDe(sélecteur, propriété);
  assert.match(
    déclaration,
    /gradient\(/,
    `« ${propriété} » de ${sélecteur} n’est plus un dégradé : cette lecture ne ` +
      `sait plus quoi mesurer.`,
  );
  const noms = [...déclaration.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]);
  assert.ok(
    noms.length >= 2,
    `le dégradé de ${sélecteur} ne cite plus au moins deux couleurs de la palette.`,
  );
  return noms.map((n) => couleur(n, theme));
}

for (const theme of ['sombre', 'clair']) {
  test(`un lien se lit sur toutes les surfaces en thème ${theme}`, () => {
    // Seuil 4,5 : un lien est du texte. Sans règle d'auteur, un lien prend le
    // bleu par défaut du navigateur — 1,80:1 sur une carte sombre — et aucune
    // palette au monde n'y peut rien, puisqu'elle n'est pas consultée.
    const nom = variableDe('a', 'color');
    for (const surface of SURFACES) {
      const rapport = contraste(couleur(nom, theme), couleur(surface, theme));
      assert.ok(
        rapport >= 4.5,
        `un lien est à ${rapport.toFixed(2)}:1 sur --${surface} en thème ` +
          `${theme}. Le seul lien de l'app ouvre le tableau de bord Spotify : ` +
          `c'est la première action de sa seule procédure technique.`,
      );
    }
  });

  test(`le libellé du bouton principal se lit sur son dégradé en thème ${theme}`, () => {
    // Seuil 4,5 : c'est du TEXTE, à 13 px. La graisse de 640 n'ouvre pas le
    // seuil réduit — il faudrait 18,66 px gras, ou 24 px.
    // Le survol n'est pas mesuré ici : « filter: brightness(1.07) » éclaircit le
    // fond ET le texte, et laisse le rapport au-dessus du seuil (vérifié : 6,33
    // et 4,54 en thème clair).
    const texte = couleurDe('.bouton.primaire', 'color', theme);
    for (const arrêt of arrêtsDuDégradé('.bouton.primaire', 'background', theme)) {
      const rapport = contraste(texte, arrêt);
      assert.ok(
        rapport >= 4.5,
        `le libellé du bouton principal est à ${rapport.toFixed(2)}:1 sur ` +
          `${arrêt} en thème ${theme}. C'est le bouton le plus important de ` +
          `chaque écran — « Synchroniser », « Ajouter », « Connecter » : on doit ` +
          `pouvoir lire ce qu'il fait, pas seulement voir qu'il est là.`,
      );
    }
  });

  test(`le bouton d’action dangereuse garde un contour visible en thème ${theme}`, () => {
    // Cette variante ÉCRASE la bordure de « .bouton », donc la garde générale
    // plus haut ne la voit pas : elle lit la règle de base et s'arrête là.
    // Sans ce test, la suite annoncerait « le contour d'un bouton » au vert
    // pendant qu'« Arrêter la synchronisation en cours » n'aurait pas de bord.
    for (const surface of SURFACES) {
      const fond = couleur(surface, theme);
      const rapport = contraste(couleurMêlée('.bouton.danger', 'border-color', theme, fond), fond);
      assert.ok(
        rapport >= 3,
        `le contour du bouton d’action dangereuse est à ${rapport.toFixed(2)}:1 ` +
          `sur --${surface} en thème ${theme}. C'est le bouton qu'on cherche ` +
          `quand quelque chose va mal : il doit se trouver du regard.`,
      );
    }
  });
}
