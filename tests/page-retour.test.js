// Tests de la page de fin de connexion Spotify.
//
// C'est la seule page du projet que l'utilisateur voit à un moment où il ne peut
// rien vérifier ailleurs : Spotify vient de renvoyer son navigateur ici, et il
// attend de savoir si l'authentification a abouti. Elle doit donc rester lisible
// même si sa feuille de style ne se charge pas — d'où le verdict écrit en toutes
// lettres, et non porté par la seule couleur.
//
// L'import de server.js ne démarre rien : le lancement est gardé par une
// comparaison sur process.argv[1], à la fin du fichier.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pageRetour } from '../server.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const RÉUSSITE = { titre: 'Compte Spotify connecté', message: 'Vous pouvez fermer cet onglet.', réussi: true };
const ÉCHEC = { titre: 'La connexion a échoué', message: 'Réessayez depuis Zotijean.', réussi: false };

// ---------------------------------------------------------------------------
// Le verdict est lisible sans style
// ---------------------------------------------------------------------------

test('la page annonce la réussite en toutes lettres', () => {
  assert.match(pageRetour(RÉUSSITE), /Connexion réussie/);
});

test('la page annonce l’échec en toutes lettres', () => {
  assert.match(pageRetour(ÉCHEC), /Connexion non établie/);
});

test('les deux verdicts sont des phrases différentes, pas une nuance de couleur', () => {
  // Le défaut visé : deux pages identiques au mot près, distinguées seulement
  // par un vert ou un rouge. Un daltonien, ou n'importe qui dont la feuille de
  // style n'a pas chargé, n'apprend alors rien.
  const réussite = pageRetour(RÉUSSITE);
  const échec = pageRetour(ÉCHEC);
  assert.ok(!réussite.includes('Connexion non établie'));
  assert.ok(!échec.includes('Connexion réussie'));
});

test('le verdict est en gras par la balise, pas par la feuille de style', () => {
  // <strong> reste gras dans une page non stylée. Une classe CSS, non.
  assert.match(pageRetour(RÉUSSITE), /<strong>Connexion réussie<\/strong>/);
  assert.match(pageRetour(ÉCHEC), /<strong>Connexion non établie<\/strong>/);
});

test('le verdict arrive avant le titre et le message dans le corps', () => {
  // Sans feuille de style, le navigateur affiche dans l'ordre du document. Le
  // verdict doit donc être écrit en premier, pas centré par une grille.
  //
  // On découpe à partir de <body> : le titre figure aussi dans l'élément <title>
  // de l'en-tête, qui précède tout. Mesurer sur le document entier comparerait
  // le verdict à un titre qu'on ne voit jamais dans la page.
  const html = pageRetour(RÉUSSITE);
  const corps = html.slice(html.indexOf('<body'));
  const iVerdict = corps.indexOf('Connexion réussie');
  const iTitre = corps.indexOf(RÉUSSITE.titre);
  const iMessage = corps.indexOf(RÉUSSITE.message);

  // Vérifier la PRÉSENCE avant l'ordre. `indexOf` renvoie -1 quand le texte est
  // absent, et -1 est inférieur à tout : sans ces trois lignes, la disparition
  // complète du verdict du corps de la page — la propriété même que cette
  // branche installe — laissait le test au vert.
  assert.notEqual(iVerdict, -1, 'le verdict n’est pas dans le corps de la page');
  assert.notEqual(iTitre, -1, 'le titre n’est pas dans le corps de la page');
  assert.notEqual(iMessage, -1, 'le message n’est pas dans le corps de la page');
  assert.ok(iVerdict < iTitre && iTitre < iMessage);
});

test('seul un vrai booléen déclenche l’annonce de réussite', () => {
  // Le sens de l'erreur compte : dire « connecté » à quelqu'un qui ne l'est pas
  // l'envoie attendre des téléchargements qui ne viendront jamais.
  for (const valeur of ['false', 'non', 0, 1, {}, [], null, undefined]) {
    assert.match(
      pageRetour({ titre: 't', message: 'm', réussi: valeur }),
      /Connexion non établie/,
      `réussi=${JSON.stringify(valeur) ?? String(valeur)} annonce une réussite`,
    );
  }
  assert.match(pageRetour({ titre: 't', message: 'm', réussi: true }), /Connexion réussie/);
});

test('la pastille de couleur est décorative et annoncée comme telle', () => {
  // Elle répète le verdict : un lecteur d'écran qui l'énonce n'ajoute rien.
  assert.match(pageRetour(RÉUSSITE), /<span class="pastille" aria-hidden="true">/);
});

// ---------------------------------------------------------------------------
// Elle respecte la politique de sécurité commune
// ---------------------------------------------------------------------------

test('la page charge une feuille externe et ne porte aucun style en ligne', () => {
  // Le bloc <style> qu'elle avait obligeait à lui écrire une politique de
  // sécurité à part, qui rouvrait « unsafe-inline ». Voir tests/styles-en-ligne.
  for (const page of [pageRetour(RÉUSSITE), pageRetour(ÉCHEC)]) {
    assert.match(page, /<link rel="stylesheet" href="\/retour\.css">/);
    assert.ok(!/<style[\s>]/i.test(page), 'la page contient un bloc <style>');
    assert.ok(!/\sstyle\s*=\s*"/.test(page), 'la page contient un attribut style=');
  }
});

test('l’état est porté par une classe, que retour.css sait colorer', () => {
  assert.match(pageRetour(RÉUSSITE), /<body class="reussi">/);
  assert.match(pageRetour(ÉCHEC), /<body class="echec">/);
});

test('la feuille annoncée par la page existe vraiment sur le disque', () => {
  // Vérifier la chaîne « href="/retour.css" » ne prouve rien : c'est le FICHIER
  // qui manquait. Le cas n'est pas théorique — retour.css est arrivé comme
  // fichier nouveau, donc non suivi par git, et la suite entière restait verte
  // sans lui. Seule la CI l'attrapait, c'est-à-dire après le push.
  //
  // Le nom est relu depuis la page, jamais recopié : renommer la feuille sans
  // renommer le lien doit faire échouer ce test, pas le contourner.
  const lien = pageRetour(ÉCHEC).match(/<link rel="stylesheet" href="\/([^"]+)">/);
  assert.ok(lien, 'la page n’annonce aucune feuille de style externe');
  assert.ok(
    fs.existsSync(path.join(RACINE, 'public', lien[1])),
    `public/${lien[1]} est absent : la page de fin de connexion s’afficherait nue, ` +
      `au moment précis où l’utilisateur attend de savoir si sa connexion a abouti.`,
  );
});

test('les classes émises par la page sont toutes définies dans sa feuille', () => {
  // Une classe sans règle produit exactement le symptôme qu'on vient de
  // corriger : la mise en page se défait, sans message.
  const feuille = fs.readFileSync(path.join(RACINE, 'public', 'retour.css'), 'utf8');
  const html = pageRetour(RÉUSSITE) + pageRetour(ÉCHEC);
  const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  assert.ok(classes.size >= 5, `trop peu de classes relevées : ${classes.size}`);
  for (const classe of classes) {
    assert.match(
      feuille,
      new RegExp(`\\.${classe}[\\s,.:{]`),
      `.${classe} est posée par la page mais n’a aucune règle dans retour.css`,
    );
  }
});

// ---------------------------------------------------------------------------
// Échappement — le message vient parfois de l'extérieur
// ---------------------------------------------------------------------------

test('le titre et le message sont échappés', () => {
  // La raison d'un échec peut recopier un paramètre reçu de Spotify. Elle est
  // déjà bornée à l'appel, mais l'échappement reste la dernière barrière.
  const html = pageRetour({
    titre: '<script>alert(1)</script>',
    message: 'guillemet " et esperluette &',
    réussi: false,
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;/);
  assert.match(html, /esperluette &amp;/);
});

test('un titre hostile ne s’échappe pas non plus de l’élément <title>', () => {
  const html = pageRetour({ titre: '</title><script>x</script>', message: 'a', réussi: false });
  assert.ok(!html.includes('</title><script>'));
});

// ---------------------------------------------------------------------------
// Robustesse
// ---------------------------------------------------------------------------

test('un message absent ne produit pas le mot « undefined »', () => {
  // échapperHTML ramène null et undefined à une chaîne vide : la page reste
  // muette plutôt que de montrer un mot de programmeur à l'utilisateur.
  const html = pageRetour({ titre: 'Connexion', message: undefined, réussi: true });
  assert.ok(!html.includes('undefined'));
  assert.match(html, /Connexion réussie/);
});
