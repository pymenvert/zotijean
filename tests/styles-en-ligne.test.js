// Garde-fou : aucun style en ligne dans ce que le navigateur reçoit.
//
// La politique de sécurité du contenu (src/securite.js) pose « style-src 'self' »
// sans « unsafe-inline ». Le navigateur ignore donc SILENCIEUSEMENT trois choses :
// les attributs « style="…" », les blocs « <style>…</style> », et les appels
// « setAttribute('style', …) ». Rien n'échoue côté serveur, rien ne remonte à
// l'utilisateur : la mise en page se défait, c'est tout. Ça s'est produit deux
// fois — la notice s'est affichée en texte brut, et la rangée des heures calmes
// a débordé de sa carte parce que ses trois largeurs étaient posées en ligne.
//
// Noter ce qui n'est PAS visé : « élément.style.width = … » passe par le CSSOM,
// que la politique n'a jamais couvert. C'est la façon correcte d'animer une
// jauge, et le scanner doit la laisser tranquille.
//
// Ce fichier commence par se prouver à lui-même qu'il sait détecter. Un scanner
// muet ressemble trait pour trait à un code propre : deux balayages de ce projet
// sont déjà revenus vides à cause d'un outillage qui mangeait les antislashs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sansCommentaires, listerFichiers, sousDossiers } from './aide-analyse-source.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Un attribut « style= » dans du balisage.
//
// Le caractère qui précède doit être un blanc ou une ouverture de chaîne : sans
// cette borne, « data-style= » ou le « .style = » du CSSOM déclencheraient.
// L'exclusion de « const/let/var » écarte une déclaration JavaScript nommée
// `style`, qui n'a rien à voir avec du balisage.
// La valeur peut être NUE : « <div style=color:red> » est du HTML5 valide, et
// le navigateur l'applique — donc la politique le bloque.
// Le drapeau « i » n'est pas cosmétique : un nom d'attribut HTML est insensible
// à la casse, « STYLE= » s'applique comme « style= ».
const ATTRIBUT_STYLE =
  /(?:^|[\s'"`])(?<!\b(?:const|let|var) )style\s*=\s*(?:["'`]|[^\s"'`=<>])/i;

// Une balise « <style> », quelle que soit sa casse. La borne finale accepte
// « <style/> » — le parseur HTML ignore la barre oblique sur une balise non
// vide — tout en écartant « <link rel="stylesheet"> », où rien ne suit « < ».
const BLOC_STYLE = /<style[\s>\/]/i;

// Les équivalents JavaScript de l'attribut : la politique les bloque exactement
// pareil, contrairement à « élément.style.propriété = … ».
// Le groupe autour de « NS » n'est pas décoratif : « setAttributeNS? » signifie
// « setAttributeN » suivi d'un « S » facultatif, donc EXIGE le N et ne reconnaît
// plus setAttribute. Les cas positifs de ce fichier ont attrapé la faute.
const ATTRIBUT_POSÉ = /setAttribute(?:NS)?\(\s*(?:null\s*,\s*)?["'`]style["'`]/i;

const MOTIFS = [
  ['attribut style=', ATTRIBUT_STYLE],
  ['bloc <style>', BLOC_STYLE],
  ["setAttribute('style')", ATTRIBUT_POSÉ],
];

/** Relève les styles en ligne d'un texte, avec numéro de ligne. */
function relever(texte, étiquette = '') {
  const trouvés = [];
  const lignesRéelles = texte.split(/\r?\n/);

  sansCommentaires(texte).split(/\r?\n/).forEach((ligne, index) => {
    for (const [nom, motif] of MOTIFS) {
      if (motif.test(ligne)) {
        trouvés.push({
          fichier: étiquette,
          ligne: index + 1,
          motif: nom,
          // L'extrait vient du texte d'origine : un rapport qui montrerait la
          // ligne blanchie n'aiderait personne à retrouver le défaut.
          extrait: (lignesRéelles[index] ?? ligne).trim().slice(0, 120),
        });
      }
    }
  });
  return trouvés;
}

/** Les fichiers qui produisent du balisage destiné au navigateur. */
function fichiersDeBalisage() {
  const listés = ['public', 'src'].flatMap((dossier) =>
    listerFichiers(RACINE, dossier, /\.(html|js)$/i),
  );
  // server.js fabrique du HTML à la main : la page de retour de Spotify, celle
  // qui portait justement le bloc <style> à l'origine de ce test.
  listés.push('server.js');
  return listés;
}

// ---------------------------------------------------------------------------
// Cas positifs — le scanner prouve qu'il détecte AVANT qu'on lui fasse confiance
// ---------------------------------------------------------------------------

test('le scanner reconnaît un attribut style= en ligne', () => {
  const trouvés = relever('<div class="x" style="color:red">a</div>');
  assert.equal(trouvés.length, 1);
  assert.equal(trouvés[0].motif, 'attribut style=');
});

test('le scanner reconnaît un bloc <style>, même en capitales', () => {
  assert.equal(relever('<style>body{margin:0}</style>').length, 1);
  assert.equal(relever('<STYLE type="text/css">').length, 1);
});

test("le scanner reconnaît un setAttribute('style')", () => {
  assert.equal(relever("el.setAttribute('style', 'color:red')").length, 1);
  assert.equal(relever('el.setAttribute("style", x)').length, 1);
});

test('le scanner voit un attribut style= posé dans un gabarit JavaScript', () => {
  // C'est la forme réelle du défaut dans public/app.js : du balisage injecté par
  // innerHTML depuis un littéral gabarit. Le scanner doit le voir là aussi.
  const source = 'zone.innerHTML = `<ol class="aide" style="padding-left:20px">`;';
  assert.equal(relever(source).length, 1);
});

test('le scanner reconnaît un attribut style= quelle que soit sa casse', () => {
  // Un nom d'attribut HTML est insensible à la casse : le navigateur applique
  // « STYLE= » comme « style= », et la politique le bloque à l'identique.
  assert.equal(relever('<div STYLE="color:red">').length, 1);
  assert.equal(relever('<td Style="width:9px">').length, 1);
});

test('le scanner reconnaît un attribut style= sans guillemets', () => {
  // HTML5 accepte une valeur nue tant qu'elle ne contient ni espace ni « > ».
  // « color:red » remplit la condition, et le navigateur l'applique.
  assert.equal(relever('<div style=color:red>').length, 1);
  assert.equal(relever('<div style=color:red;font-weight:bold>').length, 1);
});

test('le scanner reconnaît une balise <style> auto-fermante', () => {
  // Le parseur HTML ignore la barre oblique sur une balise non vide : c'est une
  // balise ouvrante, et son contenu s'applique.
  assert.equal(relever('<style/>body{margin:0}</style>').length, 1);
});

test('le scanner reconnaît setAttributeNS, bloqué à l’identique', () => {
  assert.equal(relever("el.setAttributeNS(null, 'style', 'color:red')").length, 1);
});

// ---------------------------------------------------------------------------
// Cas négatifs — ce que le scanner ne doit PAS confondre avec un défaut
// ---------------------------------------------------------------------------

test('le scanner laisse passer le CSSOM, que la politique autorise', () => {
  // « élément.style.propriété = … » n'est pas un attribut : la politique de
  // sécurité ne l'a jamais bloqué — vérifié dans un vrai navigateur, un élément
  // neuf recevant `style.width = '321px'` mesure bien 321 px sous la politique
  // stricte, alors que `setAttribute('style', …)` sur le même élément ne prend
  // pas. Confondre les deux condamnerait la seule façon correcte de faire
  // avancer la jauge de progression, et ce test existe pour l'interdire.
  assert.deepEqual(relever('jauge.style.width = `${p}%`;'), []);
  assert.deepEqual(relever("$('#onb-jauge').style.width = '50%';"), []);
  assert.deepEqual(relever("el.style.cssText = 'color:red';"), []);
  assert.deepEqual(relever('Object.assign(el.style, { color: "red" });'), []);
});

test('le scanner laisse passer une variable nommée « style »', () => {
  // Aucun identifiant de ce nom n'existe aujourd'hui dans le code balayé, mais
  // le motif le dénonçait : le message aurait annoncé un blocage par la
  // politique de sécurité, ce qui aurait envoyé chercher un défaut inexistant.
  assert.deepEqual(relever("const style = 'sombre';"), []);
  assert.deepEqual(relever('let style = "clair";'), []);
  assert.deepEqual(relever('var style = `auto`;'), []);
});

test('le scanner laisse passer une feuille de style externe', () => {
  assert.deepEqual(relever('<link rel="stylesheet" href="app.css">'), []);
});

test('le scanner laisse passer la directive style-src de la politique', () => {
  assert.deepEqual(relever(`    "style-src 'self'",`), []);
});

test('le scanner laisse passer le mot « style » en français', () => {
  assert.deepEqual(relever('// Zotijean — feuille de style unique, sans dépendance.'), []);
  assert.deepEqual(relever('  // le style se lit dans le texte d’aide : argparse'), []);
});

test('le scanner ignore un style cité dans un commentaire', () => {
  // Les commentaires qui expliquent ce défaut le CITENT forcément. Les compter
  // rendrait le projet incapable de documenter sa propre correction.
  assert.deepEqual(relever('/* les attributs style="…" sont ignorés du navigateur */'), []);
  assert.deepEqual(relever('  // un bloc <style> ne passe pas la politique'), []);
  assert.deepEqual(relever('<!-- exemple : <div style="color:red"> -->'), []);
});

test('un commentaire ne masque pas un vrai défaut posé sur la même ligne', () => {
  // Le contraire ouvrirait une porte dérobée : il suffirait d'ajouter un
  // commentaire à côté pour faire taire le scanner.
  assert.equal(relever('<div style="color:red"> <!-- rouge -->').length, 1);
  assert.equal(relever('/* voir plus bas */ <div style="color:red">').length, 1);
  assert.equal(relever('const u = "https://x"; el.setAttribute("style", s);').length, 1);
});

test('un « /* » écrit dans une chaîne ne rend pas le scanner aveugle', () => {
  // Le défaut le plus dangereux que ce fichier puisse avoir. Un blanchiment qui
  // accepte un ouvreur n'importe où se laisse ouvrir par ce qui n'est pas un
  // commentaire — ici un glob — et efface tout jusqu'au prochain « */ ». Le
  // scanner rend alors le même verdict sur un fichier vide que sur un fichier
  // propre. C'est le mode de panne que le dépôt a déjà payé deux fois.
  const source = [
    'const glob = "**/*.js";',
    'zone.innerHTML = `<div style="color:red">`;',
    'const fin = "*/";',
  ].join('\n');
  const trouvés = relever(source, 'exemple.js');
  assert.equal(trouvés.length, 1, 'le défaut a été avalé par un faux commentaire');
  assert.equal(trouvés[0].ligne, 2);
});

test('un « <!-- » écrit dans une chaîne ne rend pas le scanner aveugle', () => {
  const source = ['const a = "<!--";', '<div style="color:red">', 'const b = "-->";'].join('\n');
  assert.equal(relever(source).length, 1);
});

test('le blanchiment des commentaires ne décale pas les numéros de ligne', () => {
  // Un rapport qui désigne la mauvaise ligne fait perdre plus de temps qu'il
  // n'en fait gagner. Le commentaire ci-dessous couvre trois lignes.
  const source = ['/* un', 'commentaire', 'sur trois lignes */', '<p style="x">'].join('\n');
  const trouvés = relever(source, 'exemple.html');
  assert.equal(trouvés.length, 1);
  assert.equal(trouvés[0].ligne, 4);
  assert.equal(trouvés[0].extrait, '<p style="x">');
});

// ---------------------------------------------------------------------------
// Le balayage réel
// ---------------------------------------------------------------------------

test('le balayage lit bien les fichiers du projet', () => {
  // Un scanner qui ne lit rien passe au vert sans rien vérifier. On exige donc
  // qu'il ait trouvé les fichiers, et parmi eux ceux qu'on sait exister.
  // `path.join` construit les séparateurs de la plateforme courante des deux
  // côtés de la comparaison : le test dit la même chose ici et sur le Mac.
  const fichiers = fichiersDeBalisage();
  // Compter par dossier, pas en bloc : `src/` fournit à lui seul une vingtaine
  // de fichiers, donc un seuil global serait atteint même si `public/` avait
  // entièrement disparu du balayage. Un seuil qui ne peut pas échouer ne
  // vérifie rien.
  const dans = (dossier) => fichiers.filter((f) => f.startsWith(dossier + path.sep)).length;
  assert.ok(dans('public') >= 3, `trop peu de fichiers balayés dans public/ : ${dans('public')}`);
  assert.ok(dans('src') >= 8, `trop peu de fichiers balayés dans src/ : ${dans('src')}`);
  for (const attendu of [
    path.join('public', 'index.html'),
    path.join('public', 'notice.html'),
    path.join('public', 'app.js'),
    'server.js',
  ]) {
    assert.ok(
      fichiers.includes(attendu),
      `fichier absent du balayage : ${attendu} (vus : ${fichiers.join(', ')})`,
    );
  }
});

test('le balayage plat suffit : aucun sous-dossier ne lui échappe', () => {
  // Le listage n'est pas récursif. Tant que public/ et src/ restent plats, il
  // couvre tout ; le jour où quelqu'un crée public/vues/, le balayage cesserait
  // de le voir SANS RIEN DIRE. Ce test transforme ce rétrécissement silencieux
  // en échec explicite, avec la marche à suivre.
  for (const dossier of ['public', 'src']) {
    assert.deepEqual(
      sousDossiers(RACINE, dossier),
      [],
      `${dossier}/ contient désormais un sous-dossier : rendre le listage récursif ` +
        `dans tests/aide-analyse-source.js, sinon son contenu n’est plus balayé.`,
    );
  }
});

test('aucun style en ligne dans les fichiers servis au navigateur', () => {
  const trouvés = [];
  for (const relatif of fichiersDeBalisage()) {
    const texte = fs.readFileSync(path.join(RACINE, relatif), 'utf8');
    trouvés.push(...relever(texte, relatif));
  }

  const rapport = trouvés
    .map((t) => `  ${t.fichier}:${t.ligne} — ${t.motif} — ${t.extrait}`)
    .join('\n');

  assert.equal(
    trouvés.length,
    0,
    `La politique de sécurité du contenu bloque ces styles : le navigateur les ` +
      `ignore sans le dire, et la mise en page se défait.\n${rapport}\n` +
      `Les déplacer dans app.css, notice.css ou retour.css.`,
  );
});

test('aucune ligne des fichiers balayés n’est aveugle au scanner', () => {
  // LE test qui empêche tous les autres de mentir.
  //
  // Les tests ci-dessus prouvent que le scanner détecte sur des chaînes écrites
  // à la main. Celui-ci prouve qu'il détecte sur les VRAIS fichiers, ligne par
  // ligne : on colle un défaut connu au bout de chaque ligne et on exige de le
  // revoir, à la bonne ligne. Les lignes que le blanchiment efface entièrement
  // sont des commentaires — angle mort assumé et vérifié comme tel. Toutes les
  // autres doivent parler.
  //
  // Sans ça, n'importe quelle évolution du blanchiment peut rendre des pans
  // entiers de fichier invisibles, et la suite resterait verte en ayant regardé
  // du vide. Le dépôt a déjà connu deux scanners muets.
  // Le canari est collé à TOUTES les lignes en une seule passe. C'est correct
  // parce qu'il ne contient aucune borne de commentaire — ni « /* », ni « */ »,
  // ni « <!-- », ni « // » — et qu'il s'ajoute en FIN de ligne : il ne peut donc
  // ni ouvrir, ni fermer, ni déplacer un commentaire. Une mutation par ligne
  // donnerait le même résultat en relisant chaque fichier des centaines de fois.
  const CANARI = '<div style="canari">';
  const aveugles = [];
  let vérifiées = 0;

  for (const relatif of fichiersDeBalisage()) {
    const lignes = fs.readFileSync(path.join(RACINE, relatif), 'utf8').split(/\r?\n/);
    const blanchies = sansCommentaires(lignes.join('\n')).split(/\r?\n/);

    const attendues = [];
    const muté = lignes.map((ligne, i) => {
      // Une ligne entièrement blanchie est un commentaire : angle mort assumé.
      if (!blanchies[i] || !blanchies[i].trim()) return ligne;
      attendues.push(i + 1);
      return ligne + CANARI;
    });

    vérifiées += attendues.length;
    const vues = new Set(relever(muté.join('\n')).map((t) => t.ligne));
    for (const numéro of attendues) {
      if (!vues.has(numéro)) {
        aveugles.push(`  ${relatif}:${numéro} — ${lignes[numéro - 1].trim().slice(0, 80)}`);
      }
    }
  }

  // Sans ce compte, le test se saborde lui-même : un blanchiment qui effacerait
  // TOUT ne laisserait aucune ligne à contrôler, la liste des aveugles resterait
  // vide, et le vert annoncerait une couverture totale sur un balayage nul.
  assert.ok(
    vérifiées > 2000,
    `trop peu de lignes réellement contrôlées (${vérifiées}) : le blanchiment en efface trop.`,
  );
  assert.deepEqual(
    aveugles,
    [],
    `Le scanner ne verrait pas un style en ligne posé sur ces lignes :\n${aveugles.join('\n')}`,
  );
});
