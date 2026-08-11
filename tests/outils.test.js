// Tests du montage des outils embarqués.
//
// CE QUI EST EN JEU, ET POURQUOI C'EST LE PREMIER LANCEMENT QUI COMPTE.
//
// Le montage de zotify commence par EFFACER l'environnement pour repartir de
// zéro. Cinq endroits du code déclenchent un diagnostic, et le diagnostic
// appelle ce montage. Au tout premier démarrage, deux d'entre eux partent
// presque en même temps : le moteur diagnostique au lancement, et l'interface
// qui vient de s'ouvrir en demande un aussitôt.
//
// Sans garde, les deux constatent qu'il n'y a rien, les deux effacent, les deux
// installent — l'un dans le dossier que l'autre supprime. L'installation échoue
// ou reste à moitié faite, sur la seule opération qui DOIT réussir pour que
// l'application serve à quelque chose. Et ça n'arriverait qu'une fois : au
// moment précis où l'utilisateur découvre l'app.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Le dossier de données est détourné AVANT l'import du module, pour ne jamais
// toucher à l'installation réelle.
process.env.ZOTIJEAN_DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-outils-'));

const { assurerZotify } = await import('../src/outils.js');

test('des montages simultanés partagent un seul et même travail', async () => {
  // Cinq appels lancés dans le même tour de boucle, comme au premier démarrage.
  const résultats = await Promise.all(
    Array.from({ length: 5 }, () => assurerZotify()),
  );

  // Si chacun avait fait son propre montage, rien ne garantirait des réponses
  // identiques — et surtout, ils se seraient effacé le dossier mutuellement.
  const premier = résultats[0];
  for (const r of résultats) {
    assert.equal(r, premier, 'un appel simultané a lancé son propre montage');
  }
});

test('un appel ultérieur n’est pas collé au résultat précédent', async () => {
  // La garde doit se relâcher : sinon la toute première réponse serait servie
  // indéfiniment, et une réinstallation deviendrait impossible sans redémarrer.
  await assurerZotify();
  const après = await assurerZotify();
  assert.ok(après, 'aucun résultat après le relâchement de la garde');
  assert.equal(typeof après.prêt, 'boolean');
});

test('sans outils embarqués, le montage le dit au lieu d’échouer', async () => {
  // Cas du dépôt lancé depuis les sources : il n'y a pas de dossier d'outils.
  // Ça n'est pas une erreur, et surtout ça ne doit pas lever : le diagnostic
  // s'en sert pour choisir entre « installez zotify » et « relancez l'app ».
  const résultat = await assurerZotify();
  assert.equal(typeof résultat.prêt, 'boolean');
  assert.ok('raison' in résultat || résultat.chemin);
});

test.after(() => {
  fs.rmSync(process.env.ZOTIJEAN_DONNEES, { recursive: true, force: true });
});
