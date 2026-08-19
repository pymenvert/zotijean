// Tests de la taxonomie d'erreurs.
//
// L'enjeu n'est pas cosmétique : c'est le seul endroit où une ligne technique
// anglaise devient une phrase qui dit à un non-développeur quoi faire. Une
// reconnaissance ratée renvoie l'utilisateur à un message qu'il ne peut pas
// exploiter, et il abandonne.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reconnaître, synthétiser, phraseBilan, compterTitresPerdus, CATALOGUE, GRAVITÉ,
} from '../src/erreurs.js';

// ---------------------------------------------------------------------------
// Reconnaissance
// ---------------------------------------------------------------------------

test('les erreurs réelles de zotify sont reconnues', () => {
  // Formulations relevées dans les rapports d'incidents de zotify et librespot.
  const cas = [
    ['Failed fetching audio key!', 'cle_audio'],
    ['ERROR: Rate limit exceeded', 'limite_debit'],
    ['429 Too Many Requests', 'limite_debit'],
    ['This track requires a Premium subscription', 'premium_requis'],
    ['Track is unavailable in your market', 'indisponible'],
    ['ffmpeg not found in PATH', 'ffmpeg'],
    ['OSError: [Errno 28] No space left on device', 'disque_plein'],
    ['ConnectionError: Network is unreachable', 'reseau'],
    ['PermissionError: [Errno 13] Permission denied', 'droits'],
  ];

  for (const [ligne, codeAttendu] of cas) {
    assert.equal(reconnaître(ligne).code, codeAttendu, `mal classé : ${ligne}`);
  }
});

test('une erreur inconnue reçoit quand même un diagnostic utilisable', () => {
  // Recracher la ligne technique telle quelle serait un aveu d'impuissance.
  const diagnostic = reconnaître('Quelque chose d’imprévu est arrivé');
  assert.equal(diagnostic.reconnu, false);
  assert.ok(diagnostic.titre.length > 5);
  assert.ok(diagnostic.explication.length > 20);
  assert.ok(diagnostic.geste, 'même inconnue, une erreur doit suggérer un geste');
});

test('reconnaître ne plante jamais, quelle que soit l’entrée', () => {
  for (const entrée of [null, undefined, '', 0, {}, []]) {
    const diagnostic = reconnaître(entrée);
    assert.ok(diagnostic.code);
    assert.ok(diagnostic.titre);
  }
});

test('chaque entrée du catalogue est complète et actionnable', () => {
  for (const entrée of CATALOGUE) {
    assert.ok(entrée.code, 'code manquant');
    assert.ok(entrée.titre?.length > 5, `titre trop court : ${entrée.code}`);
    assert.ok(entrée.explication?.length > 30, `explication trop courte : ${entrée.code}`);
    assert.ok(Object.values(GRAVITÉ).includes(entrée.gravité), `gravité invalide : ${entrée.code}`);
    // Un problème sérieux DOIT indiquer quoi faire, sinon il n'aide personne.
    if (entrée.gravité === GRAVITÉ.SÉRIEUX) {
      assert.ok(entrée.geste?.length > 10, `pas de geste pour un cas sérieux : ${entrée.code}`);
    }
  }
});

test('les titres et explications sont en français', () => {
  for (const entrée of CATALOGUE) {
    assert.ok(
      /[éèêàçùôûîï]/i.test(entrée.titre + entrée.explication),
      `pas d’accent, donc probablement pas français : ${entrée.code}`,
    );
  }
});

test('l’ordre du catalogue place le spécifique avant le général', () => {
  // « Rate limit exceeded » contient aussi le mot « exceeded » ; si une entrée
  // générique était placée avant, elle capterait le cas et le message perdrait
  // sa précision.
  const indexLimite = CATALOGUE.findIndex((e) => e.code === 'limite_debit');
  const indexRéseau = CATALOGUE.findIndex((e) => e.code === 'reseau');
  assert.ok(indexLimite < indexRéseau, 'la limitation de débit doit primer sur le réseau');
});

// ---------------------------------------------------------------------------
// Synthèse
// ---------------------------------------------------------------------------

test('synthétiser regroupe les erreurs identiques', () => {
  // « 47 erreurs » n'aide personne ; « 47 fois le même problème, voici quoi
  // faire » donne une action.
  const lignes = Array(47).fill('Failed fetching audio key!');
  const synthèse = synthétiser(lignes);

  assert.equal(synthèse.length, 1);
  assert.equal(synthèse[0].nombre, 47);
  assert.equal(synthèse[0].code, 'cle_audio');
  assert.ok(synthèse[0].geste);
});

test('synthétiser classe le sérieux avant le reste', () => {
  const synthèse = synthétiser([
    'Track is unavailable',          // info
    'Failed fetching audio key!',    // attention
    'Rate limit exceeded',           // sérieux
  ]);
  assert.equal(synthèse[0].gravité, GRAVITÉ.SÉRIEUX);
  assert.equal(synthèse.at(-1).gravité, GRAVITÉ.INFO);
});

test('synthétiser garde quelques exemples sans tout accumuler', () => {
  const synthèse = synthétiser(Array(100).fill('Failed fetching audio key!'));
  assert.ok(synthèse[0].exemples.length <= 3, 'les exemples ne doivent pas enfler');
});

test('synthétiser accepte les objets du pilote comme les chaînes', () => {
  const depuisObjets = synthétiser([{ texte: 'Rate limit exceeded', type: 'erreur' }]);
  const depuisChaînes = synthétiser(['Rate limit exceeded']);
  assert.equal(depuisObjets[0].code, depuisChaînes[0].code);
});

test('synthétiser ignore les entrées vides', () => {
  assert.deepEqual(synthétiser([null, undefined, '', { texte: '' }]), []);
});

// ---------------------------------------------------------------------------
// Phrase de bilan
// ---------------------------------------------------------------------------

test('phraseBilan accorde le pluriel', () => {
  assert.equal(phraseBilan({ nbFichiers: 0 }), 'Aucune nouveauté');
  assert.equal(phraseBilan({ nbFichiers: 1 }), '1 nouveau titre');
  assert.equal(phraseBilan({ nbFichiers: 12 }), '12 nouveaux titres');
});

test('phraseBilan signale une interruption', () => {
  assert.match(phraseBilan({ nbFichiers: 5, interrompu: true }), /interrompue/);
});

test('phraseBilan met en avant le problème sérieux', () => {
  const phrase = phraseBilan({ nbFichiers: 3, erreurs: ['Rate limit exceeded'] });
  assert.match(phrase, /3 nouveaux titres/);
  assert.match(phrase, /demandes envoyées/i);
});

test('phraseBilan compte les titres repris plus tard', () => {
  const phrase = phraseBilan({
    nbFichiers: 10,
    erreurs: Array(4).fill('Failed fetching audio key!'),
  });
  assert.match(phrase, /4 repris plus tard/);
});

// ---------------------------------------------------------------------------
// Une ligne d'information n'est pas un titre perdu
// ---------------------------------------------------------------------------
//
// LA LIGNE CI-DESSOUS EST RÉELLE. Elle a été capturée le 19 août 2026 pendant
// une vraie synchronisation, dans le journal de la machine de destination. Sur
// les trois exécutions de ce jour-là, 19 des 22 « erreurs » étaient celle-ci —
// alors que l'utilisateur avait explicitement décoché les paroles.
//
// Ce qu'elle coûtait, maillon par maillon : elle contient « failed », donc elle
// devenait une erreur ; aucune entrée du catalogue ne la reconnaissait, donc
// elle tombait en « non identifiée », gravité ATTENTION ; « allé au bout »
// exigeait zéro erreur, donc la playlist n'était JAMAIS marquée terminée, sa
// version Spotify jamais enregistrée, et le planificateur espaçait la
// tentative suivante. Une parole manquante déplaçait un horaire.
const LIGNE_PAROLES_RÉELLE =
  '###   SKIPPING:  LYRICS FOR "birthCenter - oak" (FAILED TO FETCH)   ###';

test('la ligne de paroles manquantes est reconnue, et seulement informative', () => {
  const diagnostic = reconnaître(LIGNE_PAROLES_RÉELLE);
  assert.notEqual(diagnostic.code, 'inconnu', 'elle tombait en « erreur non identifiée »');
  assert.equal(
    diagnostic.gravité,
    GRAVITÉ.INFO,
    'le morceau est téléchargé : rien n’est perdu, donc rien à signaler comme perte',
  );
});

test('les autres formulations de paroles absentes sont couvertes', () => {
  for (const ligne of [
    '### SKIPPING: LYRICS FOR "Walton - Zen" (LYRICS NOT AVAILABLE) ###',
    'Failed to fetch lyrics for track',
    '###   SKIPPING:  LYRICS FOR "Mr. Mitch - R U IN2 IT?" (FAILED TO FETCH)   ###',
  ]) {
    assert.equal(reconnaître(ligne).gravité, GRAVITÉ.INFO, ligne);
  }
});

// Le cas où la garde est SEULE à pouvoir refuser : quatre titres bien
// téléchargés, quatre lignes de paroles, et rien d'autre. Le compte de titres
// perdus doit être zéro. Avant le correctif il valait quatre, et l'app
// annonçait « 4 nouveaux titres, 4 repris plus tard » alors que les quatre
// étaient sur le disque, convertis, complets.
test('quatre paroles manquantes ne font perdre aucun titre', () => {
  const lignes = Array.from({ length: 4 }, () => LIGNE_PAROLES_RÉELLE);
  assert.equal(compterTitresPerdus(lignes), 0);
  assert.equal(phraseBilan({ nbFichiers: 4, erreurs: lignes }), '4 nouveaux titres');
});

test('une vraie perte, elle, compte toujours', () => {
  const lignes = [LIGNE_PAROLES_RÉELLE, 'Failed fetching audio key!'];
  assert.equal(compterTitresPerdus(lignes), 1, 'la clé audio perd bien un titre');
  assert.equal(phraseBilan({ nbFichiers: 4, erreurs: lignes }), '4 nouveaux titres, 1 repris plus tard');
});

test('compterTitresPerdus tient compte des gravités, pas du nombre de lignes', () => {
  assert.equal(compterTitresPerdus([]), 0);
  assert.equal(compterTitresPerdus(['Failed fetching audio key!']), 1);
  // Un sérieux est aussi un titre non obtenu : il ne doit pas s'évaporer.
  assert.equal(compterTitresPerdus(['429 Too Many Requests']), 1);
});

// INFO NE VEUT PAS DIRE « SANS IMPORTANCE », IL VEUT DIRE « RIEN À REPRENDRE ».
//
// Un morceau retiré du catalogue ou non distribué dans le pays n'arrivera
// jamais, quel que soit le nombre de tentatives. Le compter comme perdu
// empêcherait la playlist d'être marquée terminée, donc la ferait reprendre
// indéfiniment pour un morceau qui n'existe pas. C'est la même mécanique que les
// paroles manquantes, pour une raison opposée — et c'est pour ça que la gravité,
// et non le nombre de lignes, est le bon critère.
test('un morceau indisponible ne se reprend pas non plus', () => {
  assert.equal(compterTitresPerdus(['Track is unavailable in your market']), 0);
});
