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

test('écrireAtomique laisse la cible intacte quand l’écriture échoue', () => {
  // Le test ci-dessus vérifie qu'aucun temporaire ne traîne — mais une écriture
  // DIRECTE le satisfait tout autant, puisqu'elle n'en crée aucun. Éprouvé en
  // cassant le code exprès : remplacer le détour par un temporaire suivi d'un
  // renommage par un simple writeFileSync sur la cible laissait toute la suite
  // au vert. Or c'est précisément ce détour qui protège la configuration d'une
  // coupure de courant, et le projet en fait une règle.
  //
  // Provoquer un échec AU BON MOMENT sans couper le courant : on occupe le nom
  // du fichier temporaire par un DOSSIER, ce qui rend son écriture impossible.
  //
  // Ce nom est reconstruit ici, donc couplé à celui que pose écrireAtomique. Si
  // ce test tombe après un changement de nommage du temporaire, c'est le TEST
  // qu'il faut mettre à jour : son message accuserait sinon l'écriture atomique
  // d'un défaut qu'elle n'a pas.
  const racine = bacÀSable();
  try {
    const cible = path.join(racine, 'etat.json');
    fs.writeFileSync(cible, '{"ancien":true}', 'utf8');
    const temporaire = `${cible}.${process.pid}.tmp`;
    fs.mkdirSync(temporaire);

    assert.throws(
      () => écrireAtomique(cible, '{"nouveau":true}'),
      (erreur) => {
        // On exige que l'échec vienne bien du TEMPORAIRE. Sans cette
        // vérification, le jour où le nommage du temporaire change — un
        // durcissement parfaitement plausible —, le dossier ne barrerait plus
        // la route, l'écriture réussirait, et le message d'échec accuserait à
        // tort l'écriture atomique d'un défaut qu'elle n'a pas.
        assert.equal(
          erreur.path,
          temporaire,
          `l’échec porte sur « ${erreur.path} » et non sur le fichier ` +
            `temporaire : ce test ne prouve plus rien. Si le nommage du ` +
            `temporaire a changé, c’est LE TEST qu’il faut mettre à jour.`,
        );
        return true;
      },
    );

    assert.equal(
      fs.readFileSync(cible, 'utf8'),
      '{"ancien":true}',
      'le contenu précédent a été perdu alors que la nouvelle écriture a ' +
        'échoué. C’est exactement ce que l’écriture atomique existe pour empêcher.',
    );
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('écrireAtomique efface son temporaire quand la mise en place échoue', () => {
  // Le test du cas nominal ne prouve rien ici : en cas de succès, le renommage
  // consomme le temporaire, il n'y a rien à nettoyer. Éprouvé en cassant le
  // code exprès : retirer le nettoyage de la branche d'erreur ne faisait tomber
  // aucun test. Un temporaire abandonné contient une copie PARTIELLE de ce
  // qu'on écrivait — gênant pour la configuration, franchement mauvais pour des
  // jetons de connexion.
  //
  // On fait échouer le renommage FINAL, donc après que le temporaire a bien été
  // écrit : c'est exactement la fenêtre où un résidu peut rester. Une cible qui
  // est un dossier non vide ne peut être remplacée sur aucun système.
  const racine = bacÀSable();
  try {
    const cible = path.join(racine, 'etat.json');
    fs.mkdirSync(cible);
    fs.writeFileSync(path.join(cible, 'occupe'), 'x');

    assert.throws(
      () => écrireAtomique(cible, '{"a":1}'),
      (erreur) => {
        // Sans cette exigence, ce test peut virer au vert POUR UNE MAUVAISE
        // RAISON : si l'échec survenait plus tôt — à l'écriture du temporaire,
        // ou à la création du dossier — le temporaire n'aurait jamais existé,
        // la liste des résidus serait vide, et le test passerait alors même que
        // le nettoyage aurait été supprimé. La fenêtre testée n'aurait pas été
        // atteinte, et rien ne le dirait.
        // Le code d'erreur diffère d'un système à l'autre ; l'appel système,
        // lui, est le même partout. C'est donc lui qu'on vérifie.
        assert.equal(
          erreur.syscall,
          'rename',
          `l’échec vient de « ${erreur.syscall} » (${erreur.code}) et non du ` +
            `renommage : aucun temporaire n’a été écrit, ce test ne prouve rien.`,
        );
        return true;
      },
    );

    const restes = fs.readdirSync(racine).filter((f) => f.includes('.tmp'));
    assert.deepEqual(
      restes,
      [],
      'un fichier temporaire est resté sur le disque après un échec : il ' +
        'contient une copie partielle de ce qu’on écrivait.',
    );
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('écrireAtomique pose les droits restrictifs demandés', {
  // Windows n'a pas de bits de permission POSIX : le contrôle n'y a aucun sens.
  // Ce test tourne sur macOS — la machine de destination — et sur Linux.
  skip: process.platform === 'win32' ? 'Pas de bits de permission POSIX sous Windows.' : false,
}, () => {
  // Le paramètre « mode » n'avait aucun test, et il n'a qu'un seul appelant :
  // l'écriture des jetons de connexion Spotify. Supprimer soit le mode passé à
  // l'écriture, soit le chmod final, laissait la suite entièrement verte et les
  // jetons de rafraîchissement lisibles par tous les comptes de la machine.
  // Le commentaire du code insiste pourtant : « un fichier de jetons brièvement
  // lisible par tous reste un fichier lisible par tous ».
  const racine = bacÀSable();
  try {
    const cible = path.join(racine, 'jetons.json');
    écrireAtomique(cible, '{"refresh":"secret"}', { mode: 0o600 });
    assert.equal(
      fs.statSync(cible).mode & 0o777,
      0o600,
      'le fichier de jetons Spotify est lisible au-delà de son propriétaire',
    );
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

test('écrireAtomique conserve le binaire intact, octet pour octet', () => {
  // CE QUE ÇA PROTÈGE. Les crates Serato sont de l'UTF-16BE : des octets nuls,
  // des octets au-delà de 127, aucune structure de texte. Elles passent par le
  // même chemin d'écriture atomique que la configuration, parce qu'une crate
  // tronquée par une coupure de courant serait lue telle quelle par Serato au
  // démarrage suivant.
  //
  // La fonction annonce un encodage « utf8 », que Node ignore quand on lui donne
  // un tampon. Ce test existe pour que personne ne « corrige » cette ligne en
  // croyant qu'elle corrompt du binaire — et pour le détecter si Node changeait
  // un jour d'avis.
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-bin-'));
  try {
    const binaire = Buffer.from([
      0x76, 0x72, 0x73, 0x6e, 0x00, 0x00, 0x00, 0x10,
      0x00, 0x31, 0x00, 0x2e, 0x00, 0xe9, 0x00, 0xff, 0x00, 0x00,
    ]);
    const cible = path.join(racine, 'essai.crate');
    écrireAtomique(cible, binaire);

    const relu = fs.readFileSync(cible);
    assert.equal(relu.length, binaire.length, 'la taille a changé');
    assert.ok(relu.equals(binaire), 'le contenu binaire a été altéré à l’écriture');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});
