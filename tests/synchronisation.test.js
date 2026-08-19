// Test d'intégration de la chaîne complète.
//
// C'est le seul test qui exerce le module d'orchestration de bout en bout :
// diagnostic, lancement du sous-processus, lecture de sa sortie, vérification
// sur disque, nommage, liste de lecture, écriture de l'état. Tout le reste est
// testé unité par unité ; ici on vérifie que les pièces s'emboîtent.
//
// Le vrai zotify n'est ni installable en intégration continue ni présent sur le
// poste de développement : on lui substitue un leurre qui écrit de vrais
// fichiers et se comporte comme lui, retours chariot et code de sortie 0
// trompeur compris. Voir aide-faux-zotify.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DONNÉES = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-integ-'));
process.env.ZOTIJEAN_DONNEES = DONNÉES;

const { enregistrer, recharger, config } = await import('../src/config.js');
const { synchroniser, prendreVerrou, rendreVerrou, exécutionEnCours } =
  await import('../src/synchronisation.js');
const { listerAudio } = await import('../src/bibliotheque.js');

/**
 * Ces tests ne s'exécutent pas sous Windows.
 *
 * Depuis Node 20, `spawn` REFUSE de lancer un fichier .cmd ou .bat sans passer
 * par un shell — protection ajoutée après une faille d'injection de commande
 * (CVE-2024-27980). Or c'est le seul moyen d'écrire un leurre exécutable sous
 * Windows, et activer le shell pour contourner rouvrirait précisément la faille
 * dans du code qui reçoit des noms de playlists venus de Spotify.
 *
 * Sous Unix, un script à ligne shebang se lance directement, sans shell : les
 * tests tournent donc pour de bon sur macOS, qui est la plateforme cible, et
 * sur Linux. L'intégration continue couvre les deux.
 */
const SAUTER = process.platform === 'win32'
  ? 'Node refuse de lancer un .cmd sans shell ; ce test tourne sur macOS et Linux en intégration continue.'
  : false;

/** Le leurre, écrit à la volée avec sa ligne shebang. */
function fabriquerLanceur(dossier) {
  const cible = path.join(ICI, 'aide-faux-zotify.js').split(path.sep).join('/');
  const chemin = path.join(dossier, 'faux-zotify.sh');
  // `process.execPath` et non « node » : le Mac de destination n'a PAS de Node
  // installé — le paquet embarque le sien. Un lanceur qui appelle « node » y
  // sort en 127, le leurre ne répond donc pas à `--help`, le diagnostic conclut
  // que cette version de zotify n'accepte aucun dossier de destination, et six
  // tests d'intégration tombent. Ils passaient partout ailleurs : l'intégration
  // continue, elle, a bien un Node dans son PATH.
  fs.writeFileSync(chemin, `#!/bin/sh\nexec "${process.execPath}" "${cible}" "$@"\n`);
  fs.chmodSync(chemin, 0o755);
  return chemin;
}

/**
 * Un ffmpeg factice, posé dans le PATH le temps des tests.
 *
 * Le diagnostic refuse — à raison — de synchroniser sans ffmpeg : son absence
 * fait détruire des morceaux en silence. Mais ces tests utilisent le format
 * « copie », donc ils ne convertissent rien : ils n'ont pas à dépendre de la
 * présence réelle de ffmpeg sur la machine, qui manque notamment sur les
 * serveurs macOS d'intégration continue. On satisfait donc la vérification sans
 * prétendre tester la conversion, qui a ses propres tests.
 */
function poserFfmpegFactice(dossier) {
  const chemin = path.join(dossier, 'ffmpeg');
  fs.writeFileSync(chemin, '#!/bin/sh\necho "ffmpeg version 7.1 (factice)"\nexit 0\n');
  fs.chmodSync(chemin, 0o755);
  process.env.PATH = `${dossier}${path.delimiter}${process.env.PATH}`;
  return chemin;
}

function préparer(surcharges = {}) {
  const musique = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-musique-'));
  const outils = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-outils-'));
  const lanceur = fabriquerLanceur(outils);
  poserFfmpegFactice(outils);

  recharger();
  enregistrer({
    ...config(),
    général: { ...config().général, dossierMusique: musique },
    zotify: { commande: lanceur, argumentsSupplémentaires: '' },
    rythme: { préréglage: 'personnalise', attenteEntreTitres: 0 },
    planification: { ...config().planification, actif: false },
    playlists: [{
      id: 'test-1',
      url: 'https://open.spotify.com/playlist/aaaaaaaaaaaaaaaaaaaaaa',
      nom: null,
      actif: true,
      remplacements: {},
    }],
    ...surcharges,
  });

  return { musique, outils, nettoyer: () => {
    fs.rmSync(musique, { recursive: true, force: true });
    fs.rmSync(outils, { recursive: true, force: true });
  } };
}

// ---------------------------------------------------------------------------
// Chaîne nominale
// ---------------------------------------------------------------------------

test('une synchronisation complète télécharge, range et recense', { skip: SAUTER, timeout: 90_000 }, async () => {
  const { musique, nettoyer } = préparer();
  process.env.FAUX_ZOTIFY_SCENARIO = 'normal';
  process.env.FAUX_ZOTIFY_PLAYLIST = 'Été 2026';

  try {
    const résultat = await synchroniser('manuelle');

    assert.equal(résultat.lancé, true, résultat.raison);

    // Un échec ici doit dire CE QU'IL A TROUVÉ, pas seulement un compte qui ne
    // tombe pas juste : sans la liste des fichiers réellement écrits, le
    // diagnostic demande un aller-retour d'une heure avec l'intégration continue.
    const surDisque = [];
    const parcourir = (dossier) => {
      for (const entrée of fs.readdirSync(dossier, { withFileTypes: true })) {
        const complet = path.join(dossier, entrée.name);
        if (entrée.isDirectory()) parcourir(complet);
        else surDisque.push(path.relative(musique, complet));
      }
    };
    parcourir(musique);
    const inventaire = `\nfichiers réellement écrits :\n  ${surDisque.join('\n  ')}`;

    assert.equal(
      résultat.bilan.nbFichiers, 3,
      `trois pistes attendues, ${résultat.bilan.nbFichiers} comptée(s).${inventaire}`,
    );
    assert.equal(résultat.bilan.interrompu, false);

    const dossier = path.join(musique, 'Été 2026');
    assert.ok(fs.existsSync(dossier), 'le dossier de la playlist n’a pas été créé');
    assert.equal(listerAudio(dossier).length, 3);

    // Le nom de la playlist est déduit du dossier créé : c'est le seul moyen de
    // le connaître sans l'API Web de Spotify.
    assert.equal(résultat.bilan.playlists[0].nom, 'Été 2026');
  } finally {
    nettoyer();
  }
});

test('les caractères interdits sont neutralisés dans les noms produits', { skip: SAUTER, timeout: 90_000 }, async () => {
  const { musique, nettoyer } = préparer();
  process.env.FAUX_ZOTIFY_SCENARIO = 'normal';

  try {
    await synchroniser('manuelle');
    const noms = listerAudio(path.join(musique, 'Été 2026')).map((f) => path.basename(f));

    // « AC/DC » ne doit pas avoir créé de sous-dossier, et le guillemet de
    // « (12" Mix) » ne doit pas subsister.
    assert.ok(noms.some((n) => n.includes('AC_DC')), `noms produits : ${noms}`);
    assert.ok(!noms.some((n) => n.includes('"')));
    assert.equal(
      fs.existsSync(path.join(musique, 'Été 2026', 'AC')), false,
      'une barre oblique a créé un dossier parasite',
    );
  } finally {
    nettoyer();
  }
});

test('une liste de lecture est écrite à côté des fichiers', { skip: SAUTER, timeout: 90_000 }, async () => {
  const { musique, nettoyer } = préparer();
  process.env.FAUX_ZOTIFY_SCENARIO = 'normal';

  try {
    await synchroniser('manuelle');
    const liste = path.join(musique, 'Été 2026', 'Été 2026.m3u8');
    assert.ok(fs.existsSync(liste), 'la liste de lecture est absente');

    const octets = fs.readFileSync(liste);
    assert.notEqual(octets[0], 0xef, 'marque d’ordre des octets en tête');

    const contenu = octets.toString('utf8');
    assert.ok(contenu.startsWith('#EXTM3U'));
    assert.ok(!contenu.includes('\\'), 'antislash dans une liste de lecture');
    // Chemins relatifs : déplacer le dossier ne doit rien casser.
    assert.ok(!contenu.split('\n').some((l) => l.startsWith('/') || /^[A-Za-z]:/.test(l)));
  } finally {
    nettoyer();
  }
});

// ---------------------------------------------------------------------------
// Le disque comme seule vérité
// ---------------------------------------------------------------------------

test('un code de sortie 0 trompeur ne fait pas conclure au succès', { skip: SAUTER, timeout: 90_000 }, async () => {
  // Le vrai zotify renvoie 0 même quand tout échoue. Se fier au code de sortie
  // ferait croire à une bibliothèque complète alors qu'aucun fichier n'existe.
  const { musique, nettoyer } = préparer();
  process.env.FAUX_ZOTIFY_SCENARIO = 'echec-total';

  try {
    const résultat = await synchroniser('manuelle');
    assert.equal(résultat.bilan.nbFichiers, 0, 'des fichiers inexistants ont été comptés');
    assert.ok(résultat.bilan.nbErreurs > 0, 'les erreurs n’ont pas été relevées');
    assert.equal(listerAudio(musique).length, 0);
  } finally {
    nettoyer();
  }
});

test('les téléchargements avortés ne sont pas comptés comme des réussites', { skip: SAUTER, timeout: 90_000 }, async () => {
  // zotify laisse parfois un fichier de quelques octets. Le compter ferait
  // croire le morceau acquis, et il ne serait jamais repris.
  const { nettoyer } = préparer();
  process.env.FAUX_ZOTIFY_SCENARIO = 'fichiers-tronques';

  try {
    const résultat = await synchroniser('manuelle');
    assert.equal(résultat.bilan.nbFichiers, 0);
    assert.ok(résultat.bilan.playlists[0].nbSuspects > 0, 'les fichiers suspects sont ignorés');
  } finally {
    nettoyer();
  }
});

test('une piste en échec n’empêche pas les autres', { skip: SAUTER, timeout: 90_000 }, async () => {
  const { musique, nettoyer } = préparer();
  process.env.FAUX_ZOTIFY_SCENARIO = 'une-piste-echoue';

  try {
    const résultat = await synchroniser('manuelle');
    assert.equal(résultat.bilan.nbFichiers, 2, 'les pistes valides auraient dû passer');
    assert.ok(résultat.bilan.lignesErreur.length > 0, 'l’erreur n’a pas été conservée');
    assert.equal(listerAudio(path.join(musique, 'Été 2026')).length, 2);
  } finally {
    nettoyer();
  }
});

// ---------------------------------------------------------------------------
// Verrou d'exécution
// ---------------------------------------------------------------------------

test('deux synchronisations ne peuvent pas se chevaucher', { skip: SAUTER, timeout: 90_000 }, async () => {
  const { nettoyer } = préparer();
  process.env.FAUX_ZOTIFY_SCENARIO = 'normal';

  try {
    const [premier, second] = await Promise.all([
      synchroniser('manuelle'),
      synchroniser('planifiée'),
    ]);

    const lancés = [premier, second].filter((r) => r.lancé).length;
    assert.equal(lancés, 1, 'deux exécutions simultanées : risque de limitation par Spotify');
  } finally {
    nettoyer();
  }
});

test('un verrou laissé par un processus mort est repris', { skip: SAUTER, timeout: 90_000 }, async () => {
  // Sans cette reprise, un plantage ou une coupure de courant bloquerait l'app
  // définitivement, sans aucun moyen de s’en sortir pour un non-développeur.
  const { nettoyer } = préparer();
  const { fichierVerrou } = await import('../src/chemins.js');

  try {
    fs.writeFileSync(
      fichierVerrou(),
      JSON.stringify({ pid: 999999, date: new Date().toISOString() }),
    );
    assert.equal(prendreVerrou(), true, 'le verrou périmé n’a pas été repris');
    rendreVerrou();
  } finally {
    nettoyer();
  }
});

test('aucune exécution n’est signalée en cours au repos', { skip: SAUTER, timeout: 90_000 }, () => {
  assert.equal(exécutionEnCours(), null);
});

// ---------------------------------------------------------------------------
// Garde-fous
// ---------------------------------------------------------------------------

test('une destination introuvable arrête proprement', { skip: SAUTER, timeout: 90_000 }, async () => {
  const { nettoyer } = préparer();
  try {
    // Un chemin impossible : le diagnostic doit bloquer avant tout lancement.
    enregistrer({
      ...config(),
      général: {
        ...config().général,
        dossierMusique: process.platform === 'win32'
          ? 'Z:\\inexistant\\zotijean'
          : '/proc/interdit/zotijean',
      },
    });

    const résultat = await synchroniser('manuelle');
    assert.equal(résultat.lancé, false);
    assert.ok(résultat.raison.length > 20, 'le refus doit être expliqué');
  } finally {
    nettoyer();
  }
});

test('une playlist désactivée est ignorée', { skip: SAUTER, timeout: 90_000 }, async () => {
  const { musique, nettoyer } = préparer();
  process.env.FAUX_ZOTIFY_SCENARIO = 'normal';

  try {
    enregistrer({
      ...config(),
      playlists: config().playlists.map((p) => ({ ...p, actif: false })),
    });
    const résultat = await synchroniser('manuelle');
    assert.equal(résultat.bilan.nbFichiers, 0);
    assert.equal(listerAudio(musique).length, 0);
  } finally {
    nettoyer();
  }
});

test.after(() => {
  delete process.env.FAUX_ZOTIFY_SCENARIO;
  delete process.env.FAUX_ZOTIFY_PLAYLIST;
  fs.rmSync(DONNÉES, { recursive: true, force: true });
});
