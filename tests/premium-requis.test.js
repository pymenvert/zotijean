// Ce que l'application dit du compte Spotify, et qui doit rester vrai.
//
// AUDIT DU 21 AOÛT 2026, bloquant désigné par Pym. Zotify exige un compte
// Spotify Premium pour télécharger — TOUJOURS, sans exception. Or cinq textes
// de l'application enseignaient, de façon cohérente entre eux, un modèle mental
// complet et faux : Premium = meilleure qualité, gratuit = qualité moindre mais
// ça marche.
//
//   src/options.js     « La qualité d'un compte gratuit »
//   public/notice.html « Premium pour la meilleure qualité »
//   README.md          idem
//   src/erreurs.js     geste conseillé : « Passez la qualité sur Élevée »
//   CLAUDE.md          « le plafond […] exige Spotify Premium »
//
// Le pire était le message d'erreur : c'est le seul qui intercepte l'échec d'un
// utilisateur sans abonnement, et il lui conseillait de baisser la qualité puis
// de relancer — ce qui ne peut pas marcher, et lui coûtait une seconde
// exécution de plusieurs heures.
//
// CE QUE CE FICHIER GARDE, et ce qu'il ne peut pas garder : il vérifie que les
// formulations fausses ne reviennent pas et que l'affirmation vraie est bien
// présente. Il ne juge pas si le texte est agréable à lire — seul un regard sur
// l'écran peut le dire.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { QUALITÉS } from '../src/options.js';
import { reconnaître } from '../src/erreurs.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

/** Les explications visibles, telles que l'utilisateur les lit. */
const TEXTES_AFFICHÉS = () => [
  ...QUALITÉS.map((q) => `${q.libellé} ${q.explication}`),
  lire('public/notice.html'),
  lire('public/app.js'),
];

test('aucun texte ne présente une qualité comme « celle d’un compte gratuit »', () => {
  for (const texte of TEXTES_AFFICHÉS()) {
    assert.doesNotMatch(
      texte, /compte gratuit/i,
      'un texte affirme qu’une qualité correspond à un compte gratuit : '
      + 'l’utilisateur en conclura qu’il peut se passer de Premium, essaiera, '
      + 'et n’aura aucun moyen de comprendre pourquoi rien ne descend',
    );
  }
});

test('aucun texte ne présente Premium comme une simple affaire de qualité', () => {
  // La formulation exacte qui traînait dans la notice et le README. Elle est
  // fausse dans le sens dangereux : elle laisse croire que le sans-Premium
  // fonctionne, en moins bien.
  for (const texte of [...TEXTES_AFFICHÉS(), lire('README.md')]) {
    assert.doesNotMatch(
      texte, /Premium pour la meilleure qualité/i,
      'Premium est présenté comme un confort, alors que c’est la condition',
    );
  }
});

test('aucun texte ne dit que le logiciel marche SANS le compte Spotify', () => {
  // GARDER L'IDÉE, PAS LA PHRASE. Les deux tests ci-dessus épinglent des
  // formulations littérales : un synonyme les contournerait. Ceux-ci visent la
  // construction dangereuse elle-même — « sans X, ça marche quand même », et
  // « sans X, la qualité redescend ». La phrase retirée de src/options.js
  // (« Exige un abonnement Premium : sans lui, Spotify redescend silencieusement
  // à 160 kb/s ») pourrait sinon revenir mot pour mot sans faire rougir un test.
  // LA FRONTIÈRE EST ÉTROITE, et une première version de ce test l'a franchie :
  // elle attrapait « Sans elle, Zotijean fonctionne » — une phrase VRAIE, qui
  // parle de l'accès en lecture aux playlists, lequel EST facultatif. Interdire
  // la construction en général rendrait l'interface incapable de dire ce qui
  // est réellement optionnel. On vise donc le seul couple dangereux : « sans
  // l'abonnement » suivi d'une promesse de dégradation ou de fonctionnement.
  const PROMESSE_FAUSSE = /(?:sans (?:premium|abonnement)|sans lui)[^.]{0,80}(?:160 ?kb|96 ?kb|plafonne|redescend|qualité inférieure|marche|fonctionne)/i;

  for (const texte of [...TEXTES_AFFICHÉS(), lire('README.md')]) {
    assert.doesNotMatch(
      texte, PROMESSE_FAUSSE,
      'un texte laisse croire que le sans-Premium fonctionne, en moins bien',
    );
    assert.doesNotMatch(
      texte, /tout marche sans/i,
      'un texte affirme que « tout marche sans » — sans dire sans QUOI, ce qui '
      + 'englobe le compte Premium',
    );
  }
});

test('le détecteur de promesse fausse trouve ce qu’il doit trouver', () => {
  // UN DÉTECTEUR QUI NE TROUVE RIEN DOIT D'ABORD PROUVER QU'IL TROUVE. Les deux
  // phrases ci-dessous sont celles qui ont réellement été retirées du code le
  // 21 août 2026 : si un jour ce motif cesse de les reconnaître, le test
  // au-dessus deviendrait vert pour la mauvaise raison.
  const MOTIF = /(?:sans (?:premium|abonnement)|sans lui)[^.]{0,80}(?:160 ?kb|96 ?kb|plafonne|redescend|qualité inférieure|marche|fonctionne)/i;

  assert.match(
    'Exige un abonnement Premium : sans lui, Spotify redescend silencieusement à 160 kb/s.',
    MOTIF,
  );
  assert.match('Sans Premium, Spotify plafonne à 160 kb/s sans le dire.', MOTIF);

  // Et le contre-exemple, qui doit rester permis : l'accès en lecture aux
  // playlists est réellement facultatif, l'interface a le droit de le dire.
  assert.doesNotMatch('Sans elle, Zotijean fonctionne : il passe vos liens à zotify.', MOTIF);
});

test('la notice annonce Premium comme obligatoire, dans ses prérequis', () => {
  const notice = lire('public/notice.html');
  assert.match(notice, /compte Spotify Premium/i, 'le prérequis ne nomme pas Premium');
  assert.match(
    notice, /[Oo]bligatoire/,
    'le prérequis n’emploie pas le mot qui lève l’ambiguïté',
  );
});

test('l’assistant de premier lancement le dit AVANT le premier téléchargement', () => {
  // Réciproque vérifiée par la revue d'interface : les cinq écrans ne
  // mentionnaient Premium qu'une fois, et pour parler de ce que l'utilisateur
  // ne peut PAS avoir (le sans-perte Spotify). La seule mention présupposait
  // donc qu'il était déjà abonné.
  const app = lire('public/app.js');
  assert.match(
    app, /Il faut un compte Spotify Premium/,
    'rien n’avertit avant le premier téléchargement : l’utilisateur ne '
    + 'découvrira la condition qu’à l’échec, s’il la découvre',
  );
});

test('la carte de connexion distingue les DEUX authentifications Spotify', () => {
  // Il y en a deux, et elles n'ont rien à voir : zotify a besoin d'un compte
  // Premium pour télécharger, l'API Web est facultative et sert seulement à
  // savoir ce qui manque. Le mot « Facultatif » posé sous un titre « Compte
  // Spotify » laissait conclure qu'aucun compte n'était nécessaire.
  const app = lire('public/app.js');
  assert.match(
    app, /Rien à voir avec le compte Premium/,
    'le mot « facultatif » n’est pas désambiguïsé : un utilisateur peut en '
    + 'conclure qu’aucun compte Spotify n’est nécessaire',
  );
  assert.match(
    app, /<strong>celui-là reste indispensable pour télécharger/,
    'le gras met en avant « facultatif » au lieu de l’exigence : la typographie '
    + 'dit alors le contraire du texte',
  );

  // Le titre de la carte compte autant que son texte : « Compte Spotify » suivi
  // du mot « facultatif » se lisait comme « le compte Spotify est facultatif ».
  assert.doesNotMatch(
    lire('public/index.html'), /<h2>Compte Spotify<\/h2>/,
    'le titre de la carte redit « Compte Spotify » tout court',
  );
});

test('le message d’erreur Premium ne conseille plus de baisser la qualité', () => {
  const traduit = reconnaître('ERROR: Premium account required for this operation');

  assert.ok(traduit, 'le motif ne reconnaît plus l’erreur Premium');
  assert.doesNotMatch(
    `${traduit.explication} ${traduit.geste}`, /Passez la qualité/i,
    'le seul message qui intercepte cet échec envoie l’utilisateur dans le mur : '
    + 'il baissera la qualité, relancera, et perdra une seconde exécution',
  );
  assert.match(
    `${traduit.explication} ${traduit.geste}`, /Premium/,
    'le message doit nommer la vraie condition',
  );
});
