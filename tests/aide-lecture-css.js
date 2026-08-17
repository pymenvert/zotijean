// Lecture d'une feuille de style, pour les garde-fous qui la relisent.
//
// Deux fichiers de test posent des questions à public/app.css : celui qui garde
// les contrastes, et celui qui garde la lisibilité des listes d'options. Tous
// deux ont besoin des mêmes gestes délicats — retrouver une règle, y retrouver
// une propriété, en extraire une couleur, la résoudre dans le bon thème.
//
// Cette logique vit donc ici, à un seul endroit, pour que corriger l'un corrige
// l'autre. Précédents dans le dossier : aide-analyse-source.js, aide-faux-zotify.js.
//
// Chaque garde de ce fichier a été payée par un défaut réel, et le commentaire
// qui l'accompagne dit lequel. Ce ne sont pas des précautions de principe : ce
// sont des pièges dans lesquels ce dépôt est déjà tombé.

import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Calcul de contraste — pur, sans feuille de style
// ---------------------------------------------------------------------------

const canal = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Le rapport de contraste entre deux couleurs opaques, en hexadécimal long. */
export function contraste(a, b) {
  const luminance = (hex) => {
    const [r, v, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * canal(r) + 0.7152 * canal(v) + 0.0722 * canal(bl);
  };
  const [haut, bas] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (haut + 0.05) / (bas + 0.05);
}

/** Compose une couleur translucide sur un fond opaque. */
export function composer(dessus, dessous) {
  const [r, v, b] = [1, 3, 5].map((i) => parseInt(dessous.slice(i, i + 2), 16));
  const mêler = (d, f) => Math.round(dessus.a * d + (1 - dessus.a) * f);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return `#${hex(mêler(dessus.r, r))}${hex(mêler(dessus.v, v))}${hex(mêler(dessus.b, b))}`;
}

// ---------------------------------------------------------------------------
// Lecture d'une feuille
// ---------------------------------------------------------------------------

const MARQUEUR_CLAIR = '@media (prefers-color-scheme: light)';

const échapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Les lecteurs d'une feuille de style donnée.
 *
 * La feuille est passée en paramètre plutôt que lue depuis une constante
 * globale : c'est ce qui permettra un jour de faire tourner toute cette
 * machinerie sur une feuille FACTICE dont on connaît d'avance le défaut — le
 * seul cas positif honnête pour une chaîne de lecture. Épingler quelques valeurs
 * historiques n'exerce que le calcul, jamais la lecture, et c'est précisément la
 * lecture qui a déjà rendu deux scanners muets dans ce dépôt.
 */
export function lecteurDe(feuille) {
  /**
   * Le bloc « :root » d'un thème.
   *
   * Le thème sombre est la valeur par défaut ; le thème clair la RECALCULE dans
   * une requête de média — jamais un simple éclaircissement. La lecture est
   * bornée au bloc lui-même : une tranche courant jusqu'à la fin du fichier
   * laisserait la recherche filer sur n'importe quelle autre couleur si la
   * déclaration attendue changeait de notation.
   */
  function blocRacine(theme) {
    const coupure = feuille.indexOf(MARQUEUR_CLAIR);
    assert.notEqual(
      coupure,
      -1,
      `« ${MARQUEUR_CLAIR} » est introuvable. La requête de média a changé de ` +
        `forme : le découpage par thème ne veut plus rien dire, et la lecture ` +
        `rendrait deux fois la même palette.`,
    );
    const tranche = theme === 'clair' ? feuille.slice(coupure) : feuille.slice(0, coupure);
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
      `--${nom} (thème ${theme}) vaut « ${valeur} ». Cette lecture ne sait lire ` +
        `qu'un hexadécimal à six chiffres : une notation rgb(), color-mix(), un ` +
        `hex court ou un canal alpha doivent la faire ÉCHOUER, jamais passer ` +
        `silencieusement. L'étendre, ou convertir la déclaration.`,
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

  /**
   * Le corps d'une règle, sélecteur et accolades retirés.
   *
   * L'ancrage en DÉBUT DE LIGNE n'est pas cosmétique : « .jeton { » est une
   * sous-chaîne de « code.jeton { », qui existe bel et bien dans cette feuille.
   * Une recherche libre mesurerait la mauvaise règle le jour où l'une passe
   * devant l'autre — sans rien signaler, en rendant un rapport plausible.
   *
   * La contrepartie, à connaître avant de s'y fier : l'ancrage rend INVISIBLES
   * les sélecteurs indentés, et app.css en contient — ceux des requêtes de
   * média. Aucun n'est gardé aujourd'hui ; le jour où il faudra en garder un,
   * c'est cette fonction qu'il faudra étendre.
   */
  function règle(sélecteur) {
    const trouvées = [...feuille.matchAll(new RegExp(`^${échapper(sélecteur)}\\s*\\{`, 'gm'))];
    assert.equal(
      trouvées.length,
      1,
      `« ${sélecteur} » devrait ouvrir EXACTEMENT UNE règle en début de ligne ; ` +
        `${trouvées.length} trouvée(s).\n` +
        `À zéro : la règle a disparu, ou s’est fait indenter dans une requête de ` +
        `média — la lecture porterait alors sur autre chose que l’écran.\n` +
        `À deux : c’est la CASCADE qui décide laquelle peint, et cette lecture ` +
        `rendrait la première — donc pas forcément celle-là. Vérifié sur ce ` +
        `dépôt : une bordure pâle ajoutée au SECOND bloc « .jeton » laissait ` +
        `toute la suite au vert. Fusionner les deux règles.`,
    );
    const début = trouvées[0].index;
    const ouvre = feuille.indexOf('{', début);
    const ferme = feuille.indexOf('}', ouvre);
    assert.notEqual(ferme, -1, `la règle « ${sélecteur} » n’est pas refermée`);
    return feuille.slice(ouvre + 1, ferme);
  }

  /**
   * La déclaration brute d'une propriété dans une règle — EXACTEMENT UNE.
   *
   * Quand une règle déclare deux fois la même propriété, c'est la DERNIÈRE que
   * l'écran applique, et cette lecture rendait la première. Ce n'est pas une
   * subtilité de spécification : vérifié sur ce dépôt, ajouter
   * « background: var(--accent-doux) » à la fin de « .note » ramenait le défaut
   * que ce lot venait de corriger — les encadrés d'explication redevenaient des
   * jumeaux d'options cochées — en laissant les deux fichiers de test au vert.
   *
   * C'est le même piège que celui des règles en double, un cran plus bas.
   */
  function déclarationDe(sélecteur, propriété) {
    const trouvées = règle(sélecteur)
      .split(';')
      .filter((d) => d.trim().startsWith(propriété + ':'));
    assert.equal(
      trouvées.length,
      1,
      `« ${propriété} » devrait être déclarée EXACTEMENT UNE fois dans ` +
        `${sélecteur} ; ${trouvées.length} trouvée(s).\n` +
        `À zéro : la propriété a disparu de la règle.\n` +
        `À deux : c’est la DERNIÈRE que l’écran applique, et cette lecture rend ` +
        `la première — donc pas forcément celle qui peint. Fusionner les deux.`,
    );
    return trouvées[0];
  }

  /**
   * La même, en exigeant que la couleur soit OPAQUE et unique.
   *
   * C'est la garde la plus importante du fichier, et elle protège contre une
   * mesure FLATTEUSE — bien plus difficile à repérer qu'une absence de mesure.
   * Une couche translucide, un mélange ou un dégradé changent ce que l'écran
   * peint sans changer le nom de la variable : lire la variable brute rendrait
   * un chiffre confortable pour un contrôle invisible à l'écran.
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
        `« ${propriété} » de ${sélecteur} passe par ${forme}…) : la couleur ` +
          `peinte n’est pas celle de la variable, et cette lecture la ` +
          `SURESTIMERAIT. Composer la couche sur son fond avec « couleurMêlée », ` +
          `ou sortir ce contrôle de la garde en écrivant noir sur blanc pourquoi.`,
      );
    }
    assert.ok(
      déclaration.split('var(--').length <= 2,
      `« ${propriété} » de ${sélecteur} cite plusieurs variables : cette lecture ` +
        `ne sait pas laquelle l’écran montre.`,
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
      `« ${propriété} » de ${sélecteur} ne prend plus sa couleur dans une ` +
        `variable de la palette : cette lecture ne peut plus savoir quoi mesurer.`,
    );
    return déclaration.slice(i + 6, déclaration.indexOf(')', i));
  }

  /**
   * La couleur d'une propriété, qu'elle vienne de la palette ou soit écrite en
   * clair. Le rond de la bascule est un blanc littéral : il ne passe par aucune
   * variable, et une lecture qui n'accepterait que « var(--…) » ne saurait pas
   * le mesurer — donc ne le garderait pas.
   */
  function couleurDe(sélecteur, propriété, theme) {
    const déclaration = déclarationOpaqueDe(sélecteur, propriété);
    if (déclaration.includes('var(--')) return couleur(variableDe(sélecteur, propriété), theme);
    const m = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(déclaration);
    assert.ok(
      m,
      `« ${propriété} » de ${sélecteur} ne donne ni une variable de la palette ` +
        `ni un hexadécimal : cette lecture ne peut plus savoir quoi mesurer.`,
    );
    const brut = m[1].toLowerCase();
    return '#' + (brut.length === 3 ? [...brut].map((c) => c + c).join('') : brut);
  }

  /**
   * Une couleur écrite « color-mix(in srgb, var(--X) N%, transparent) »,
   * composée sur le fond qui la reçoit.
   *
   * Ces mélanges sont le point aveugle naturel d'une garde de contraste : ils
   * ressemblent à une couleur, mais leur valeur réelle dépend de ce qu'il y a
   * DESSOUS.
   */
  function couleurMêlée(sélecteur, propriété, theme, fond) {
    const déclaration = déclarationDe(sélecteur, propriété);
    const m = /color-mix\(\s*in srgb\s*,\s*var\(--([a-z0-9-]+)\)\s+([\d.]+)%\s*,\s*transparent\s*\)/i.exec(
      déclaration,
    );
    assert.ok(
      m,
      `« ${propriété} » de ${sélecteur} n’est plus un mélange « color-mix(…, ` +
        `transparent) » lisible : cette lecture ne peut plus savoir quoi composer.`,
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

  // Seuls les lecteurs réellement consommés sortent. « blocRacine »,
  // « déclarations », « déclarationDe » et « déclarationOpaqueDe » restent
  // privés : ils servent aux autres, et une API qu'on expose « au cas où » finit
  // par être utilisée de travers — notamment « déclarationDe », qui ne vérifie
  // PAS l'opacité et rendrait donc des mesures flatteuses.
  return {
    couleur,
    couleurTransparente,
    règle,
    variableDe,
    couleurDe,
    couleurMêlée,
    arrêtsDuDégradé,
  };
}
