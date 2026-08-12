// Tests des messages du diagnostic.
//
// CE QUI SE JOUE ICI. Le diagnostic est le seul endroit où l'application parle
// à quelqu'un qui n'ouvrira pas un terminal. Un message qui donne le mauvais
// conseil ne coûte pas une seconde de perdue : il fait renoncer.
//
// Le cas traité ci-dessous est celui d'un refus d'écriture. L'ancien message
// disait « choisissez un autre dossier », ce qui est FAUX dans la situation la
// plus courante sur un Mac : le dossier est le bon, c'est macOS qui bloque
// l'accès tant qu'on ne l'a pas autorisé. Depuis Catalina pour le Bureau, les
// Documents et les Téléchargements ; depuis Ventura pour les disques externes.
//
// Envoyer l'utilisateur changer de dossier lui fait abandonner l'organisation
// qu'il voulait, pour un problème qui se règle en deux clics.

import test from 'node:test';
import assert from 'node:assert/strict';

import { messageÉcritureRefusée } from '../src/diagnostic.js';

const REFUS = { code: 'EACCES', message: 'EACCES: permission denied' };
const DISQUE_PLEIN = { code: 'ENOSPC', message: 'ENOSPC: no space left on device' };

/** Fait croire au module qu'il tourne sur un Mac, le temps d'un test. */
function surUnMac(travail) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  try {
    return travail();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

test('un dossier protégé par macOS est nommé, avec le réglage exact à ouvrir', () => {
  surUnMac(() => {
    for (const [chemin, réglage] of [
      ['/Users/pym/Desktop/Sets', 'Dossiers Bureau'],
      ['/Users/pym/Documents/DJ', 'Dossiers Documents'],
      ['/Users/pym/Downloads/Zotijean', 'Dossiers Téléchargements'],
    ]) {
      const message = messageÉcritureRefusée(chemin, REFUS);
      assert.ok(message.includes(réglage), `réglage non nommé pour ${chemin} : ${message}`);
      // Le conseil trompeur ne doit surtout pas revenir.
      assert.ok(
        !/Choisissez un autre dossier/.test(message),
        'le message renvoie changer de dossier alors qu’il suffit d’autoriser',
      );
    }
  });
});

test('un disque externe refusé n’est pas confondu avec un disque débranché', () => {
  surUnMac(() => {
    const message = messageÉcritureRefusée('/Volumes/DJ-SSD/Musique', REFUS);
    assert.ok(message.includes('Volumes amovibles'));
    // La nuance qui évite de partir chercher un câble : le disque EST branché.
    assert.ok(/bien branché/.test(message), 'le message laisse croire à un problème matériel');
  });
});

test('un refus ailleurs renvoie vers l’accès complet au disque', () => {
  surUnMac(() => {
    const message = messageÉcritureRefusée('/Users/pym/Musique/Zotijean', REFUS);
    assert.ok(message.includes('Accès complet au disque'));
  });
});

test('hors macOS, on ne parle pas de Réglages Système', () => {
  // Le moteur tourne aussi depuis les sources sur Windows et Linux : lui faire
  // citer des menus qui n'existent pas serait pire que rester vague.
  const message = messageÉcritureRefusée('/mnt/musique', REFUS);
  assert.ok(!/Réglages Système/.test(message));
  assert.ok(/lecture seule|droits/.test(message));
});

test('une panne qui n’est pas une permission garde son message d’origine', () => {
  // Un disque plein n'a rien à voir avec une autorisation : là, changer de
  // dossier est bel et bien le bon conseil.
  const message = messageÉcritureRefusée('/Users/pym/Musique', DISQUE_PLEIN);
  assert.ok(message.includes('no space left'));
  assert.ok(/Choisissez un autre dossier/.test(message));
});
