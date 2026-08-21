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
const { synchroniser, prendreVerrou, rendreVerrou, exécutionEnCours, demanderArrêt } =
  await import('../src/synchronisation.js');
const { listerAudio } = await import('../src/bibliotheque.js');
const { créerVeilleDuDisque } = await import('../src/synchronisation.js');
const { nomAffichable } = await import('../src/synchronisation.js');
const étatModule = await import('../src/etat.js');
const { journal } = await import('../src/journal.js');

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
 * fait détruire des morceaux en silence. Et depuis que la conversion tourne
 * PENDANT le téléchargement, deux de ces tests convertissent pour de bon : il ne
 * suffit plus de répondre à `-version`, il faut produire un fichier.
 *
 * Ce leurre ne code rien — il recopie et rallonge, ce qui suffit à passer la
 * garde de vraisemblance. Ce qui est éprouvé ici, c'est l'ORCHESTRATION : quand
 * un fichier est vu, quand il est converti, ce que la liste de lecture désigne.
 * La conversion elle-même a ses propres tests, qui appellent le vrai binaire.
 * Et la machine cible n'a de toute façon pas ffmpeg dans son PATH.
 */
function poserFfmpegFactice(dossier) {
  const chemin = path.join(dossier, 'ffmpeg');
  const cible = path.join(ICI, 'aide-faux-ffmpeg.js').split(path.sep).join('/');
  // Même raison que pour le leurre zotify : `process.execPath`, jamais « node ».
  // Le Mac de destination n'a pas de Node dans son PATH.
  fs.writeFileSync(chemin, `#!/bin/sh\nexec "${process.execPath}" "${cible}" "$@"\n`);
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

// ---------------------------------------------------------------------------
// Une ligne d'information n'est pas un titre perdu — la chaîne entière
// ---------------------------------------------------------------------------
//
// CE TEST EST LE PLUS IMPORTANT DE CE LOT, parce qu'il rejoue la situation
// exacte du 19 août 2026 : trois titres arrivent entiers sur le disque, et
// zotify écrit à côté une ligne par titre disant qu'il n'a pas trouvé les
// paroles. Cette ligne contient « failed ».
//
// Avant le correctif, chaque maillon faisait son travail et l'ensemble mentait :
// la ligne devenait une erreur, l'erreur devenait un titre perdu, le titre perdu
// empêchait « allé au bout », et « allé au bout » commandait l'enregistrement de
// la version Spotify — donc la playlist repartait de zéro à chaque fois et le
// planificateur espaçait la tentative suivante. Aucun test unitaire ne pouvait
// le voir : chaque pièce était juste.
test('des paroles introuvables ne font perdre aucun titre, et n’empêchent pas d’aller au bout',
  { skip: SAUTER, timeout: 90_000 }, async () => {
    const { musique, nettoyer } = préparer();
    process.env.FAUX_ZOTIFY_SCENARIO = 'paroles-manquantes';
    process.env.FAUX_ZOTIFY_PLAYLIST = 'Été 2026';

    try {
      const { bilan } = await synchroniser('manuelle');

      assert.equal(bilan.nbFichiers, 3, 'les trois titres sont bien arrivés');
      assert.equal(listerAudio(path.join(musique, 'Été 2026')).length, 3);

      // Les lignes sont conservées — on ne les cache pas — mais elles ne
      // comptent pas comme des titres perdus.
      assert.ok(bilan.lignesErreur.length >= 3, 'les lignes doivent rester consultables');
      assert.equal(bilan.nbErreurs, 0, 'aucun titre n’est perdu : ils sont tous sur le disque');
      assert.equal(bilan.nbSignalements, bilan.lignesErreur.length);

      assert.equal(bilan.phrase, '3 nouveaux titres',
        'la phrase annonçait « 3 repris plus tard » alors que les trois étaient là');
      assert.ok(!bilan.àReprendre?.length, 'rien à reprendre : la playlist est allée au bout');

      // Le maillon qui coûtait le plus cher, et le plus invisible.
      assert.ok(
        étatModule.repriseEnAttente() === null
        || étatModule.repriseEnAttente()?.playlistsTerminées?.includes('test-1'),
        'la playlist doit être marquée terminée',
      );
    } finally {
      nettoyer();
    }
  });

// Une seule ecriture pour une meme chose : le journal melangeait « Deep dive »
// et « https://open.spotify.com/playlist/2QZ… » dans la meme liste.
test('une playlist est toujours designee de la meme facon', () => {
  const url = 'https://open.spotify.com/playlist/2QZXaM9N2FaAoef9FYHFp8';
  assert.equal(nomAffichable({ nom: 'Deep dive', url }), 'Deep dive');
  assert.equal(nomAffichable({ nom: null, url }), 'playlist/2QZXaM9N2FaAoef9FYHFp8');
  assert.equal(nomAffichable({ nom: null, url }, 'Nom deduit du dossier'), 'Nom deduit du dossier');
  assert.equal(nomAffichable({ nom: null, url: 'spotify:album:abc123' }), 'album/abc123');
  assert.equal(nomAffichable({}), 'playlist sans nom');
});

// ---------------------------------------------------------------------------
// Aucun fichier ne reste dans le mauvais format
// ---------------------------------------------------------------------------
//
// CE QUE CES DEUX TESTS ATTRAPENT, et qui s'est produit en vrai : le 19 août
// 2026, deux exécutions arrêtées en cours de route ont laissé TREIZE fichiers en
// Ogg alors que le réglage demandait du MP3. `convertirLot` sortait à la
// première boucle quand l'arrêt était déjà demandé, et rien ne les rattrapait
// jamais — la conversion ne regardait que les nouveautés de l'exécution en
// cours, pendant que `--skip-existing` empêchait zotify de les reproposer. Les
// listes `.m3u8` pointaient donc des fichiers que Rekordbox ne lit pas.

/** Les sources restées sans jumeau converti, sous toute la bibliothèque. */
function orphelins(racine, extensionCible) {
  const trouvés = [];
  const parcourir = (dossier) => {
    for (const entrée of fs.readdirSync(dossier, { withFileTypes: true })) {
      const complet = path.join(dossier, entrée.name);
      if (entrée.isDirectory()) { parcourir(complet); continue; }
      if (!entrée.name.toLowerCase().endsWith('.ogg')) continue;
      const jumeau = `${complet.slice(0, -4)}.${extensionCible}`;
      if (!fs.existsSync(jumeau)) trouvés.push(path.relative(racine, complet));
    }
  };
  parcourir(racine);
  return trouvés;
}

test('une synchronisation ne laisse aucun fichier dans le mauvais format',
  { skip: SAUTER, timeout: 120_000 }, async () => {
    const { musique, nettoyer } = préparer({
      qualité: { niveau: 'tres_elevee', format: 'mp3_320', paroles: false },
    });
    process.env.FAUX_ZOTIFY_SCENARIO = 'normal';
    process.env.FAUX_ZOTIFY_PLAYLIST = 'Été 2026';

    try {
      const { bilan } = await synchroniser('manuelle');

      assert.deepEqual(orphelins(musique, 'mp3'), [], 'des Ogg sont restés sans converti');
      assert.equal(bilan.nbConvertis, 3);

      // Et la liste de lecture doit pointer les fichiers convertis, pas les
      // sources. C'est le second visage du même défaut : les .mp3 étaient
      // parfois là, mais le .m3u8 renvoyait quand même vers les .ogg.
      const liste = fs.readFileSync(
        path.join(musique, 'Été 2026', 'Été 2026.m3u8'), 'utf8',
      );
      assert.ok(!liste.includes('.ogg'), `la liste pointe encore des sources :\n${liste}`);
      assert.equal((liste.match(/\.mp3/g) || []).length, 3);
    } finally {
      nettoyer();
    }
  });

// LE CAS OÙ LA GARDE EST SEULE À POUVOIR REFUSER : la bibliothèque porte déjà
// des fichiers laissés dans le mauvais format par une exécution précédente, et
// zotify ne redescendra rien puisque les fichiers sont là. Sans le rattrapage,
// ces Ogg restent en Ogg pour toujours — c'est exactement l'état trouvé sur le
// disque du Mac.
test('les fichiers laissés dans le mauvais format sont rattrapés au démarrage',
  { skip: SAUTER, timeout: 120_000 }, async () => {
    const { musique, nettoyer } = préparer({
      qualité: { niveau: 'tres_elevee', format: 'mp3_320', paroles: false },
    });
    process.env.FAUX_ZOTIFY_SCENARIO = 'normal';
    process.env.FAUX_ZOTIFY_PLAYLIST = 'Été 2026';

    try {
      // L'état exact du 19 août, en miniature : des Ogg seuls, dans une playlist
      // que la synchronisation ne touchera pas.
      const abandonnée = path.join(musique, 'Interrompue');
      fs.mkdirSync(abandonnée, { recursive: true });
      for (const nom of ['01 - A.ogg', '02 - B.ogg', '03 - C.ogg']) {
        fs.writeFileSync(path.join(abandonnée, nom), Buffer.alloc(5_000_000, 1));
      }

      const { bilan } = await synchroniser('manuelle');

      assert.deepEqual(orphelins(musique, 'mp3'), [], 'le rattrapage n’a pas eu lieu');
      assert.equal(bilan.rattrapés, 3, 'le rattrapage doit être compté et annoncé');
    } finally {
      nettoyer();
    }
  });

// LE TEST QUE CE LOT DEVAIT PRODUIRE, et le plus proche de ce qui est arrivé :
// on appuie sur « Arrêter » au milieu d'une playlist. Avant, `convertirLot`
// sortait à la première boucle parce que l'arrêt était déjà demandé — les
// fichiers descendus restaient en Ogg, et plus rien ne les reprenait.
test('un arrêt en milieu de playlist ne laisse aucun fichier non converti',
  { skip: SAUTER, timeout: 120_000 }, async () => {
    const { musique, nettoyer } = préparer({
      qualité: { niveau: 'tres_elevee', format: 'mp3_320', paroles: false },
    });
    process.env.FAUX_ZOTIFY_SCENARIO = 'lent';
    process.env.FAUX_ZOTIFY_PLAYLIST = 'Été 2026';

    try {
      const enCours = synchroniser('manuelle');
      await new Promise((r) => { setTimeout(r, 1100); });
      assert.equal(demanderArrêt(), true, 'l’arrêt n’a pas été pris en compte');

      const { bilan } = await enCours;

      assert.equal(bilan.interrompu, true, 'le scénario devait bien être interrompu');
      const convertis = fs.existsSync(path.join(musique, 'Été 2026'))
        ? fs.readdirSync(path.join(musique, 'Été 2026')).filter((f) => f.endsWith('.mp3'))
        : [];
      assert.ok(convertis.length >= 1, 'au moins un titre devait être descendu puis converti');
      assert.deepEqual(orphelins(musique, 'mp3'), [],
        'des fichiers sont restés dans le mauvais format après l’arrêt');
    } finally {
      nettoyer();
    }
  });

// ---------------------------------------------------------------------------
// La politique de retrait, enfin applicable — et jamais aveuglément
// ---------------------------------------------------------------------------
//
// `saitReprendreSansLeFichier()` renvoyait `false` en dur : le choix
// « Archiver » ou « Corbeille » était donc refusé en silence à CHAQUE
// synchronisation. L'utilisateur a posé « Corbeille » le 19 août 2026 à 15 h 27,
// et l'app le lui a repris sans le dire, indéfiniment.

test('un retrait demandé s’applique quand zotify a bien inscrit le morceau',
  { skip: SAUTER, timeout: 120_000 }, async () => {
    const { musique, nettoyer } = préparer({
      qualité: { niveau: 'tres_elevee', format: 'mp3_320', paroles: false },
      retrait: { politique: 'conserver', sourcesAprèsConversion: 'archiver' },
    });
    process.env.FAUX_ZOTIFY_SCENARIO = 'normal';
    process.env.FAUX_ZOTIFY_PLAYLIST = 'Été 2026';
    delete process.env.FAUX_ZOTIFY_SANS_JOURNAL;

    try {
      const { bilan } = await synchroniser('manuelle');

      const dossier = path.join(musique, 'Été 2026');
      assert.equal(bilan.playlists[0].nbConvertis, 3);
      assert.equal(fs.readdirSync(dossier).filter((f) => f.endsWith('.ogg')).length, 0,
        'les sources devaient partir : le journal les connaît');
      assert.equal(fs.readdirSync(dossier).filter((f) => f.endsWith('.mp3')).length, 3);
      assert.ok(fs.existsSync(path.join(musique, '_Archive')), 'archivées, donc récupérables');

      // Le journal vaut desormais la bibliotheque : il doit exister ET etre copie.
      assert.ok(fs.existsSync(path.join(DONNÉES, '.song_archive')));
      assert.ok(fs.existsSync(path.join(DONNÉES, '.song_archive.sauvegarde')));
    } finally {
      nettoyer();
    }
  });

// LE CAS OÙ LA GARDE EST SEULE À POUVOIR REFUSER. Tout est en place — l'option
// déclarée, le journal créé, la politique demandée — mais zotify n'a rien
// inscrit. Sans ce filtre, on jetterait des sources qu'il ne saurait pas
// reprendre, et la bibliothèque repartirait par le réseau.
test('un morceau absent du journal garde sa source, même retrait demandé',
  { skip: SAUTER, timeout: 120_000 }, async () => {
    const { musique, nettoyer } = préparer({
      qualité: { niveau: 'tres_elevee', format: 'mp3_320', paroles: false },
      retrait: { politique: 'conserver', sourcesAprèsConversion: 'archiver' },
    });
    process.env.FAUX_ZOTIFY_SCENARIO = 'normal';
    process.env.FAUX_ZOTIFY_PLAYLIST = 'Été 2026';
    process.env.FAUX_ZOTIFY_SANS_JOURNAL = '1';

    try {
      const { bilan } = await synchroniser('manuelle');
      const dossier = path.join(musique, 'Été 2026');

      assert.equal(fs.readdirSync(dossier).filter((f) => f.endsWith('.ogg')).length, 3,
        'aucune source ne doit partir sans trace dans le journal');
      assert.equal(bilan.playlists[0].nbConvertis, 3, 'la conversion, elle, a bien eu lieu');
    } finally {
      delete process.env.FAUX_ZOTIFY_SANS_JOURNAL;
      nettoyer();
    }
  });

// LE CHAÎNAGE, ET NON LA PIÈCE. `phraseJournal` a son propre test unitaire ;
// celui-ci vérifie qu'elle est bien APPELÉE — c'est exactement le maillon qui
// manquait, puisque le catalogue savait déjà traduire et que le journal
// l'ignorait.
test('le journal ne recopie plus l’anglais brut de zotify',
  { skip: SAUTER, timeout: 90_000 }, async () => {
    const { nettoyer } = préparer();
    process.env.FAUX_ZOTIFY_SCENARIO = 'echec-total';

    try {
      await synchroniser('manuelle');
      const lignes = journal.récent(200).map((e) => e.message);
      const anglaises = lignes.filter((m) => /Errno|Rate limit exceeded|Failed fetching audio key/.test(m));
      assert.deepEqual(
        anglaises, [],
        `des lignes techniques anglaises sont arrivées telles quelles :\n  ${anglaises.join('\n  ')}`,
      );
      assert.ok(
        lignes.some((m) => /Spotify a refusé de livrer un morceau/.test(m)),
        'la traduction française n’apparaît pas',
      );
    } finally {
      nettoyer();
    }
  });

test.after(() => {
  delete process.env.FAUX_ZOTIFY_SCENARIO;
  delete process.env.FAUX_ZOTIFY_SANS_JOURNAL;
  delete process.env.FAUX_ZOTIFY_PLAYLIST;
  fs.rmSync(DONNÉES, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// LE CHAÎNAGE, pas seulement la pièce
//
// `échecDeLancement` est éprouvée dans tests/zotify.test.js. Ce test-ci vérifie
// qu'elle est BRANCHÉE — et c'est la leçon la plus chère du projet : l'avancement
// n'atteignait jamais l'écran alors que chaque pièce était juste, et 264 tests
// verts ne l'ont pas vu. Une garde correcte que personne n'appelle ne protège
// rien.
// ---------------------------------------------------------------------------

test('un zotify qui meurt sans rien dire n’avance PAS la date de référence',
  { skip: SAUTER, timeout: 90_000 }, async () => {
    const { musique, nettoyer } = préparer();
    process.env.FAUX_ZOTIFY_SCENARIO = 'mort-silencieuse';

    try {
      // Une date de référence connue, pour voir si elle bouge.
      étatModule.marquerSuccès(new Date('2026-01-01T00:00:00Z'));
      const référenceAvant = étatModule.état().dernierSuccès;

      const résultat = await synchroniser('manuelle');

      assert.equal(listerAudio(musique).length, 0, 'le scénario devait ne rien produire');

      assert.ok(
        résultat.bilan.échec,
        'un lancement totalement raté n’apparaît nulle part dans le bilan : '
        + 'l’app affichera « Aucune nouveauté », pastille verte',
      );
      assert.ok(
        résultat.bilan.lancementsRatés > 0,
        'le lancement raté n’a pas été compté',
      );
      assert.equal(
        étatModule.état().dernierSuccès, référenceAvant,
        'la date de référence a avancé alors que RIEN n’a été téléchargé : '
        + 'l’app attendra 48 h avant de réessayer, et recommencera à l’identique, '
        + 'indéfiniment',
      );
      assert.ok(
        (étatModule.état().échecsConsécutifs || 0) > 0,
        'le compteur d’échecs est resté à zéro : l’espacement progressif des '
        + 'tentatives ne s’enclenchera jamais',
      );
      // `versionSpotify` ne prouverait RIEN ici : elle n'est écrite que si
      // `analyse.version` est vraie, ce qui exige l'API Web de Spotify que les
      // tests n'activent pas. L'assertion serait vraie quoi qu'il arrive.
      //
      // Ce qui mord vraiment, c'est la liste des playlists à reprendre : c'est
      // elle que `alléAuBout` décide, et donc elle qui garde le terme
      // `!échecLancement` qu'on vient d'y ajouter.
      assert.deepEqual(
        résultat.bilan.àReprendre, ['test-1'],
        'la playlist est marquée terminée alors que zotify n’a rien fait : elle '
        + 'sera sautée aux synchronisations suivantes',
      );
    } finally {
      delete process.env.FAUX_ZOTIFY_SCENARIO;
      nettoyer();
    }
  });

// ---------------------------------------------------------------------------
// La veille du disque, relue PENDANT le téléchargement
//
// AUDIT DU 21 AOÛT 2026. Les trois garde-fous du disque étaient bien dans la
// boucle des playlists — mais avant l'appel à zotify, et jamais ensuite. Or
// deux mille titres à trente secondes tiennent dans une SEULE playlist : le
// contrôle était donc fait une fois, à H+0, pour seize heures de travail.
//
// La veille est une fonction pure, à qui l'on donne son horloge et ses deux
// sondes. Ces tests tournent donc partout, y compris là où les tests
// d'intégration sont éteints. Le BRANCHEMENT, lui, a son propre test plus bas —
// une garde correcte que personne n'appelle ne protège rien.
// ---------------------------------------------------------------------------

const GO = 1024 ** 3;
const CIBLE = { racine: '/Volumes/DJ-SSD', minimumOctets: 2 * GO };

test('la veille du disque ne coûte rien tant que l’intervalle n’est pas écoulé', () => {
  let sondes = 0;
  let horloge = 1_000_000;
  const veiller = créerVeilleDuDisque({
    intervalleMs: 300_000,
    maintenant: () => horloge,
    monté: () => { sondes += 1; return true; },
    libre: () => 50 * GO,
  });

  // Appelée à chaque ligne de zotify, soit plusieurs fois par seconde.
  for (let i = 0; i < 500; i += 1) { horloge += 100; veiller(CIBLE); }

  assert.ok(sondes <= 1, `le disque a été sondé ${sondes} fois en cinquante secondes`);
});

test('un disque débranché pendant le téléchargement est vu', () => {
  let horloge = 1_000_000;
  let branché = true;
  const veiller = créerVeilleDuDisque({
    intervalleMs: 300_000,
    maintenant: () => horloge,
    monté: () => branché,
    libre: () => 50 * GO,
  });

  horloge += 3 * 3600_000; // H+3, en pleine playlist
  assert.equal(veiller(CIBLE), null, 'rien ne devait être signalé tant que tout va bien');

  branché = false;
  horloge += 300_000;
  const alerte = veiller(CIBLE);

  assert.ok(
    alerte,
    'le disque débranché n’est pas vu : macOS recrée un dossier vide au même '
    + 'endroit, et treize heures de musique partent sur le disque de démarrage',
  );
  assert.match(alerte, /débranché/);
  assert.match(alerte, /reprendra/, 'le message doit dire que rien n’est perdu');
});

test('un disque qui se remplit en cours de route est vu', () => {
  let horloge = 1_000_000;
  let place = 50 * GO;
  const veiller = créerVeilleDuDisque({
    intervalleMs: 300_000,
    maintenant: () => horloge,
    monté: () => true,
    libre: () => place,
  });

  horloge += 300_000;
  assert.equal(veiller(CIBLE), null);

  place = 0.5 * GO; // deux mille titres plus tard
  horloge += 300_000;
  const alerte = veiller(CIBLE);

  assert.ok(alerte, 'zotify continuerait d’écrire sur un disque plein, donc de '
    + 'produire des fichiers tronqués à la chaîne');
  assert.match(alerte, /0\.5 Go/, 'le message doit chiffrer ce qui reste');
});

test('un espace disque INCONNU ne bloque pas la synchronisation', () => {
  // `null` veut dire « on n'a pas pu mesurer », pas « zéro ». Confondre les
  // deux arrêterait une synchronisation parfaitement saine.
  let horloge = 1_000_000;
  const veiller = créerVeilleDuDisque({
    intervalleMs: 300_000,
    maintenant: () => horloge,
    monté: () => true,
    libre: () => null,
  });

  horloge += 300_000;
  assert.equal(veiller(CIBLE), null);
});

test('la veille survit à un recul de l’horloge', () => {
  // Le Mac se réveille, l'heure est corrigée par le réseau et RECULE de dix
  // minutes. Sans garde, la veille resterait muette pendant tout ce temps —
  // dans une fenêtre de seize heures où elle est le seul filet. C'est la règle
  // que le projet applique déjà au planificateur.
  let horloge = 1_000_000;
  let branché = true;
  const veiller = créerVeilleDuDisque({
    intervalleMs: 300_000,
    maintenant: () => horloge,
    monté: () => branché,
    libre: () => 50 * GO,
  });

  horloge += 300_000;
  assert.equal(veiller(CIBLE), null);

  branché = false;
  horloge -= 60 * 60_000;   // l'horloge recule d'une heure
  veiller(CIBLE);           // la veille rebase sa référence sur l'heure reçue

  // Puis cinq vraies minutes passent. La garde borne l'aveuglement à UN
  // intervalle ; sans elle, il aurait duré aussi longtemps que le recul —
  // une heure entière pendant laquelle le disque peut disparaître.
  horloge += 300_000;

  assert.ok(
    veiller(CIBLE),
    'un recul d’horloge rend la veille muette pour toute la durée du recul : '
    + 'le disque peut être débranché sans que rien ne le voie',
  );
});

test('la veille ne se réarme PAS à chaque playlist', () => {
  // Une première version se construisait DANS la boucle des playlists. Pour
  // vingt playlists de trois minutes, elle ne se serait jamais déclenchée : le
  // trou était refermé pour « une grosse playlist » et rouvert pour « beaucoup
  // de petites ». C'est `synchroniser` qui construit l'instance, une seule fois.
  let horloge = 1_000_000;
  const veiller = créerVeilleDuDisque({
    intervalleMs: 300_000,
    maintenant: () => horloge,
    monté: () => false,          // débranché depuis le début
    libre: () => 50 * GO,
  });

  // Vingt playlists de trois minutes : aucune ne dépasse l'intervalle seule.
  let alerte = null;
  for (let playlist = 0; playlist < 20 && !alerte; playlist += 1) {
    for (let ligne = 0; ligne < 30 && !alerte; ligne += 1) {
      horloge += 6000;
      alerte = veiller(CIBLE);
    }
  }

  assert.ok(
    alerte,
    'la veille s’est réarmée à chaque playlist : sur une bibliothèque rangée en '
    + 'plusieurs listes courtes, elle ne se déclenche jamais',
  );
});

test('le disque débranché en pleine playlist interrompt, sans avancer la date',
  { skip: SAUTER, timeout: 90_000 }, async () => {
    // LE BRANCHEMENT, pas la pièce. Les six tests ci-dessus prouvent que la
    // veille MORD ; celui-ci prouve que quelqu'un l'APPELLE. Sans lui, on
    // pouvait supprimer les deux blocs de `synchroniser` et garder 541 tests
    // verts — c'est la leçon la plus chère de ce projet.
    const { nettoyer } = préparer();
    process.env.FAUX_ZOTIFY_SCENARIO = 'normal';

    try {
      étatModule.marquerSuccès(new Date('2026-01-01T00:00:00Z'));
      const référenceAvant = étatModule.état().dernierSuccès;

      let appels = 0;
      const résultat = await synchroniser('manuelle', {
        // À la deuxième ligne de zotify, le disque disparaît.
        créerVeille: () => () => (appels += 1) >= 2
          ? 'le disque de destination a été débranché pendant le téléchargement.'
          : null,
      });

      assert.ok(appels >= 2, 'la veille n’est jamais appelée pendant le téléchargement');
      assert.equal(résultat.bilan.interrompu, true,
        'l’alerte de la veille n’interrompt pas la synchronisation');
      assert.match(résultat.bilan.raisonInterruption, /débranché/);
      assert.equal(
        étatModule.état().dernierSuccès, référenceAvant,
        'la date de référence a avancé alors que le disque avait disparu : '
        + '48 h d’attente avant de découvrir que rien n’est arrivé',
      );
    } finally {
      delete process.env.FAUX_ZOTIFY_SCENARIO;
      nettoyer();
    }
  });
