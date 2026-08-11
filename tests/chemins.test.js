// Tests des chemins, et surtout de la création de dossiers.
//
// Ce fichier existe à cause d'un défaut qui a coûté six heures d'intégration
// continue par exécution avant d'être compris : `fs.mkdirSync` avec l'option
// `recursive` part en boucle infinie sous Linux quand un ancêtre du chemin
// existe mais refuse toute création. L'appel étant synchrone, RIEN ne peut
// reprendre la main — ni une minuterie, ni le délai d'un test, ni le processus
// lui-même. Ces tests garantissent qu'on ne revient jamais à cette option.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assurerDossier, écrireAtomique, lireJSON, mettreÀLAbri } from '../src/chemins.js';

function bacÀSable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-chemins-'));
}

// ---------------------------------------------------------------------------
// Création de dossiers
// ---------------------------------------------------------------------------

test('assurerDossier crée toute une arborescence manquante', () => {
  const racine = bacÀSable();
  try {
    const profond = path.join(racine, 'a', 'b', 'c', 'd');
    assurerDossier(profond);
    assert.ok(fs.statSync(profond).isDirectory());
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('assurerDossier ne se plaint pas d’un dossier déjà là', () => {
  const racine = bacÀSable();
  try {
    assurerDossier(racine);
    assurerDossier(racine); // deux fois de suite
    assert.ok(fs.statSync(racine).isDirectory());
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('assurerDossier gère les accents et les espaces', () => {
  const racine = bacÀSable();
  try {
    const chemin = path.join(racine, 'Été 2026', 'Étienne de Crécy');
    assurerDossier(chemin);
    assert.ok(fs.existsSync(chemin));
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('assurerDossier échoue IMMÉDIATEMENT sur un chemin impossible', () => {
  // Le cœur du sujet : ce qui compte n'est pas seulement que l'erreur soit
  // levée, c'est qu'elle le soit tout de suite. La version précédente tournait
  // indéfiniment à 100 % d'un cœur, sans jamais lever quoi que ce soit.
  const impossible = process.platform === 'win32'
    ? 'Z:\\zotijean-inexistant\\a\\b'
    : '/proc/zotijean-interdit/a/b';

  const début = Date.now();
  assert.throws(() => assurerDossier(impossible));
  const durée = Date.now() - début;

  assert.ok(durée < 2000, `l’échec a pris ${durée} ms : il devrait être immédiat`);
});

test('assurerDossier remonte jusqu’à la racine sans boucler', () => {
  // Garde-fou contre une régression de la boucle de remontée : un chemin dont
  // aucun ancêtre n'existe ne doit pas faire tourner indéfiniment.
  const impossible = process.platform === 'win32'
    ? 'Q:\\a\\b\\c\\d\\e\\f'
    : '/proc/a/b/c/d/e/f';

  const début = Date.now();
  try {
    assurerDossier(impossible);
  } catch {
    // L'échec est le résultat attendu ; c'est sa rapidité qu'on mesure.
  }
  assert.ok(Date.now() - début < 2000);
});

// ---------------------------------------------------------------------------
// Écriture atomique et lecture
// ---------------------------------------------------------------------------

test('écrireAtomique ne laisse aucun fichier temporaire derrière lui', () => {
  const racine = bacÀSable();
  try {
    const cible = path.join(racine, 'sous-dossier', 'etat.json');
    écrireAtomique(cible, '{"a":1}');

    assert.equal(fs.readFileSync(cible, 'utf8'), '{"a":1}');
    const restes = fs.readdirSync(path.dirname(cible)).filter((f) => f.includes('.tmp'));
    assert.deepEqual(restes, []);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('lireJSON distingue un fichier absent d’un fichier illisible', () => {
  // La distinction n'est pas cosmétique : un fichier absent est normal au
  // premier lancement, un fichier corrompu doit être mis à l'abri avant qu'on
  // ne l'écrase — il contient la seule copie des URL de playlists.
  const racine = bacÀSable();
  try {
    const absent = path.join(racine, 'rien.json');
    let signalé = false;
    assert.deepEqual(lireJSON(absent, { defaut: true }, () => { signalé = true; }), { defaut: true });
    assert.equal(signalé, false, 'un fichier absent ne doit rien signaler');

    const corrompu = path.join(racine, 'casse.json');
    fs.writeFileSync(corrompu, '{ ceci n’est pas du JSON');
    assert.deepEqual(lireJSON(corrompu, { defaut: true }, () => { signalé = true; }), { defaut: true });
    assert.equal(signalé, true, 'un fichier illisible doit être signalé');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('mettreÀLAbri conserve une copie exploitable', () => {
  const racine = bacÀSable();
  try {
    const original = path.join(racine, 'config.json');
    fs.writeFileSync(original, 'contenu précieux');

    const abri = mettreÀLAbri(original);
    assert.ok(abri, 'aucune copie produite');
    assert.equal(fs.readFileSync(abri, 'utf8'), 'contenu précieux');
    assert.ok(fs.existsSync(original), 'l’original ne doit pas être déplacé');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('mettreÀLAbri rend null plutôt que d’échouer sur un fichier absent', () => {
  assert.equal(mettreÀLAbri(path.join(os.tmpdir(), 'zotijean-inexistant-xyz')), null);
});
