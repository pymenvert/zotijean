// Tests de la taxonomie d'erreurs.
//
// L'enjeu n'est pas cosmétique : c'est le seul endroit où une ligne technique
// anglaise devient une phrase qui dit à un non-développeur quoi faire. Une
// reconnaissance ratée renvoie l'utilisateur à un message qu'il ne peut pas
// exploiter, et il abandonne.

import test from 'node:test';
import assert from 'node:assert/strict';

import { reconnaître, synthétiser, phraseBilan, CATALOGUE, GRAVITÉ } from '../src/erreurs.js';

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
