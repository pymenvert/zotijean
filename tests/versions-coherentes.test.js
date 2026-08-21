// Les numéros de version du projet doivent être identiques, partout.
//
// POURQUOI CE FICHIER EXISTE. Un numéro de version vit à trois endroits :
// `package.json`, `macos/Info.plist`, et l'en-tête que l'application présente à
// MusicBrainz. Le troisième a été oublié : il annonçait encore « 1.0.7 » le jour
// où l'on préparait la 1.1.0, et rien ne l'avait vu — ni la suite de tests, ni
// la chaîne d'intégration, ni le workflow de publication, qui construit le
// paquet sans jamais vérifier ce qu'il déclare.
//
// C'est la forme classique du défaut de ce projet : chaque pièce est juste, et
// c'est leur accord qui ment. Un chiffre recopié à trois endroits vieillit trois
// fois plus vite qu'un chiffre lu à un seul.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_UTILISATEUR } from '../src/achats.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

const VERSION = JSON.parse(lire('package.json')).version;

test('package.json porte un numéro de version exploitable', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, `version illisible : « ${VERSION} »`);
});

test('macos/Info.plist annonce la même version que package.json', () => {
  // Le paquet livré porte CE numéro-là : c'est celui que macOS affiche dans
  // « À propos », et celui sur lequel l'utilisateur se fonde pour dire quelle
  // version il utilise quand il signale une panne.
  const plist = lire('macos/Info.plist');
  const trouvé = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);

  assert.ok(trouvé, 'CFBundleShortVersionString est introuvable dans Info.plist');
  assert.equal(
    trouvé[1], VERSION,
    `Info.plist annonce ${trouvé[1]} alors que package.json dit ${VERSION} : `
    + 'le paquet se présentera sous un mauvais numéro',
  );
});

test('l’en-tête envoyé à MusicBrainz porte la même version', () => {
  // La politique de MusicBrainz porte précisément sur cet en-tête : elle exige
  // qu'il identifie l'application ET sa version. En annoncer une fausse est le
  // genre de détail qui fait bloquer un client sans qu'on comprenne pourquoi.
  assert.match(
    AGENT_UTILISATEUR, new RegExp(`Zotijean/${VERSION.replace(/\./g, '\.')}( |$)`),
    `l’en-tête est « ${AGENT_UTILISATEUR} » alors que la version est ${VERSION}`,
  );

  // Et il ne doit jamais porter d'adresse personnelle : c'est une URL publique
  // de projet qu'on donne, pas un courriel.
  assert.doesNotMatch(AGENT_UTILISATEUR, /@/, 'une adresse personnelle est exposée');
});

test('la version se LIT, elle ne se recopie pas', () => {
  // La garde qui empêche le défaut de revenir sous la même forme : si quelqu'un
  // réécrit le numéro en dur dans achats.js, les trois tests ci-dessus resteront
  // verts jusqu'à la version suivante — puis échoueront trop tard, après le tag.
  assert.doesNotMatch(
    lire('src/achats.js'), /Zotijean\/\d+\.\d+\.\d+/,
    'un numéro de version est de nouveau écrit en dur dans src/achats.js : il '
    + 'vieillira sans que rien ne le signale, comme la dernière fois',
  );
});
