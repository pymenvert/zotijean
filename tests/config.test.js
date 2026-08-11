// Tests de la configuration.
//
// La règle qui gouverne ce module : l'app doit TOUJOURS démarrer. Un fichier
// corrompu, une valeur aberrante ou une option venue d'une version future ne
// doivent jamais empêcher le lancement — sinon l'utilisateur se retrouve devant
// une app morte, sans moyen de la réparer autrement qu'en éditant du JSON à la
// main.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-config-'));
process.env.ZOTIJEAN_DONNEES = DOSSIER;

const { config, enregistrer, modifier, recharger, attenteEffective, configPourPlaylist, assurerFichierConfig } =
  await import('../src/config.js');
const { fichierConfig } = await import('../src/chemins.js');
const { analyserLienSpotify } = await import('../src/api.js');

function écrireConfigBrute(contenu) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  fs.writeFileSync(fichierConfig(), contenu, 'utf8');
  return recharger();
}

// ---------------------------------------------------------------------------
// Robustesse au démarrage
// ---------------------------------------------------------------------------

test('sans fichier, on obtient les valeurs par défaut', () => {
  try {
    fs.unlinkSync(fichierConfig());
  } catch { /* déjà absent */ }
  const c = recharger();
  assert.equal(c.planification.intervalleHeures, 48);
  assert.equal(c.qualité.niveau, 'tres_elevee');
  assert.equal(c.retrait.politique, 'conserver');
  assert.deepEqual(c.playlists, []);
});

test('un fichier illisible ne bloque pas le démarrage', () => {
  // Cas réel : coupure de courant pendant l'écriture, ou édition manuelle ratée.
  const c = écrireConfigBrute('{ ceci n’est pas du JSON');
  assert.equal(c.planification.intervalleHeures, 48);
});

test('un fichier vide ne bloque pas le démarrage', () => {
  assert.equal(écrireConfigBrute('').planification.intervalleHeures, 48);
});

test('un fichier partiel est complété par les valeurs par défaut', () => {
  // C'est ce qui permet d'ajouter une option sans écrire de migration.
  const c = écrireConfigBrute(JSON.stringify({ planification: { intervalleHeures: 12 } }));
  assert.equal(c.planification.intervalleHeures, 12);
  assert.equal(c.planification.actif, true, 'valeur par défaut absente');
  assert.ok(c.qualité, 'section entière absente');
});

test('les clés inconnues sont ignorées sans faire échouer', () => {
  const c = écrireConfigBrute(JSON.stringify({
    sectionVenueDuFutur: { truc: 1 },
    qualité: { niveau: 'elevee', optionInconnue: true },
  }));
  assert.equal(c.qualité.niveau, 'elevee');
  assert.equal(c.sectionVenueDuFutur, undefined);
});

// ---------------------------------------------------------------------------
// Assainissement des valeurs
// ---------------------------------------------------------------------------

test('une qualité inconnue retombe sur la valeur par défaut', () => {
  const c = écrireConfigBrute(JSON.stringify({ qualité: { niveau: 'ultra_hd_8k' } }));
  assert.equal(c.qualité.niveau, 'tres_elevee');
});

test('un format inconnu retombe sur « copie »', () => {
  const c = écrireConfigBrute(JSON.stringify({ qualité: { format: 'wma' } }));
  assert.equal(c.qualité.format, 'copie');
});

test('un intervalle aberrant est corrigé', () => {
  for (const valeur of [0, -5, 100000, 'quarante-huit', null]) {
    const c = écrireConfigBrute(JSON.stringify({ planification: { intervalleHeures: valeur } }));
    assert.equal(c.planification.intervalleHeures, 48, `non corrigé : ${valeur}`);
  }
});

test('une attente négative ou démesurée est corrigée', () => {
  for (const valeur of [-1, 99999, 'trente']) {
    const c = écrireConfigBrute(JSON.stringify({ rythme: { attenteEntreTitres: valeur } }));
    assert.equal(c.rythme.attenteEntreTitres, 30, `non corrigé : ${valeur}`);
  }
});

test('un port hors plage est corrigé', () => {
  for (const valeur of [80, 0, 70000, 'huit-mille']) {
    const c = écrireConfigBrute(JSON.stringify({ général: { port: valeur } }));
    assert.equal(c.général.port, 8787, `non corrigé : ${valeur}`);
  }
});

test('un schéma personnalisé sans modèle retombe sur un schéma sûr', () => {
  // Sinon tous les fichiers porteraient le même nom et s'écraseraient.
  const c = écrireConfigBrute(JSON.stringify({
    organisation: { schéma: 'personnalise', modèlePersonnalisé: '   ' },
  }));
  assert.equal(c.organisation.schéma, 'par_playlist');
});

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

test('les playlists sans URL sont écartées', () => {
  const c = écrireConfigBrute(JSON.stringify({
    playlists: [
      { id: '1', url: 'https://open.spotify.com/playlist/abc' },
      { id: '2', url: '' },
      { id: '3' },
    ],
  }));
  assert.equal(c.playlists.length, 1);
});

test('une playlist sans identifiant en reçoit un', () => {
  const c = écrireConfigBrute(JSON.stringify({
    playlists: [{ url: 'https://open.spotify.com/playlist/abc' }],
  }));
  assert.ok(c.playlists[0].id);
  assert.equal(typeof c.playlists[0].id, 'string');
});

test('une playlist est active sauf mention contraire explicite', () => {
  const c = écrireConfigBrute(JSON.stringify({
    playlists: [
      { url: 'https://open.spotify.com/playlist/a' },
      { url: 'https://open.spotify.com/playlist/b', actif: false },
    ],
  }));
  assert.equal(c.playlists[0].actif, true);
  assert.equal(c.playlists[1].actif, false);
});

test('vider la liste des playlists est possible', () => {
  // Piège classique de fusion récursive : un tableau vide fusionné avec la
  // valeur par défaut redonnerait l'ancienne liste, et l'utilisateur ne pourrait
  // jamais tout retirer.
  écrireConfigBrute(JSON.stringify({
    playlists: [{ id: '1', url: 'https://open.spotify.com/playlist/abc' }],
  }));
  const après = modifier({ playlists: [] });
  assert.deepEqual(après.playlists, []);
});

// ---------------------------------------------------------------------------
// Persistance
// ---------------------------------------------------------------------------

test('l’enregistrement survit à un rechargement', () => {
  enregistrer({ ...config(), planification: { ...config().planification, intervalleHeures: 72 } });
  assert.equal(recharger().planification.intervalleHeures, 72);
});

test('le fichier écrit est du JSON lisible par un humain', () => {
  enregistrer(config());
  const brut = fs.readFileSync(fichierConfig(), 'utf8');
  assert.ok(brut.includes('\n  '), 'JSON non indenté');
  assert.doesNotThrow(() => JSON.parse(brut));
});

// ---------------------------------------------------------------------------
// Rythme effectif
// ---------------------------------------------------------------------------

test('le préréglage de rythme prime sur la valeur brute', () => {
  const c = écrireConfigBrute(JSON.stringify({
    rythme: { préréglage: 'rapide', attenteEntreTitres: 30 },
  }));
  assert.equal(attenteEffective(c), 3);
});

test('le rythme personnalisé utilise la valeur brute', () => {
  const c = écrireConfigBrute(JSON.stringify({
    rythme: { préréglage: 'personnalise', attenteEntreTitres: 17 },
  }));
  assert.equal(attenteEffective(c), 17);
});

// ---------------------------------------------------------------------------
// La route de réglages ne doit jamais toucher aux playlists
// ---------------------------------------------------------------------------

test('changer un réglage ne peut pas effacer les playlists', async () => {
  // RÉGRESSION. L'interface renvoie la configuration entière à chaque
  // modification, depuis un instantané pris au chargement de la page. Si cet
  // instantané est antérieur à l'ajout d'une playlist, il ne la contient pas —
  // et comme la fusion REMPLACE les tableaux, la liste du disque était écrasée.
  // Concrètement : ajouter une playlist puis cliquer sur « FLAC » l'effaçait,
  // sans le moindre message.
  const { routes } = await import('../src/api.js');

  modifier({ playlists: [] }); // point de départ propre, indépendant des autres tests
  const instantané = structuredClone(config()); // sans playlist, comme au chargement

  await routes['POST /api/playlists']({
    url: 'https://open.spotify.com/playlist/2222222222222222222222',
  });
  assert.equal(config().playlists.length, 1);

  // On rejoue le scénario : réglage modifié, instantané périmé renvoyé.
  instantané.qualité.niveau = 'elevee';
  await routes['PUT /api/config'](instantané);

  assert.equal(config().playlists.length, 1, 'la playlist a été effacée');
  assert.equal(config().qualité.niveau, 'elevee', 'le réglage n’a pas été appliqué');
});

test('une playlist supprimée ne peut pas ressusciter par un réglage', async () => {
  // Le symétrique du bug : un instantané pris AVANT la suppression la
  // réintroduisait, et le morceau se retéléchargeait.
  const { routes } = await import('../src/api.js');

  modifier({ playlists: [] });
  const ajoutée = await routes['POST /api/playlists']({
    url: 'https://open.spotify.com/playlist/3333333333333333333333',
  });
  const instantané = structuredClone(config()); // contient la playlist

  await routes['DELETE /api/playlists']({ id: ajoutée.id });
  assert.equal(config().playlists.length, 0);

  await routes['PUT /api/config'](instantané);
  assert.equal(config().playlists.length, 0, 'la playlist supprimée est revenue');
});

test('changer un réglage ne peut pas éteindre la connexion Spotify', async () => {
  // RÉGRESSION. L'instantané renvoyé par l'interface est pris au chargement de
  // la page, donc potentiellement AVANT la connexion. Sans reprise côté
  // serveur, le premier format cliqué après s'être connecté réécrivait
  // « actif: false » et coupait tout, pendant que la carte affichait toujours
  // « connecté ».
  const { routes } = await import('../src/api.js');

  modifier({ spotify: { actif: true, clientId: 'a'.repeat(32) } });
  const instantané = structuredClone(config());
  instantané.spotify = { actif: false, clientId: '' }; // instantané périmé

  await routes['PUT /api/config'](instantané);

  assert.equal(config().spotify.actif, true, 'la connexion a été éteinte');
  assert.equal(config().spotify.clientId.length, 32);
});

test('enregistrer une sélection de playlists n’efface pas les liens collés à la main', async () => {
  // RÉGRESSION. Le sélecteur ne montre que les playlists du compte. Un album ou
  // un lien collé n'y figure pas : le traiter comme « décoché » l'effaçait,
  // avec ses réglages propres, au premier enregistrement.
  const { routes } = await import('../src/api.js');

  modifier({ playlists: [] });
  const collée = await routes['POST /api/playlists']({
    url: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy',
  });
  await routes['PATCH /api/playlists']({
    id: collée.id, modifications: { remplacements: { format: 'flac' } },
  });

  // Le sélecteur ne propose QUE cette playlist-là, et elle est cochée.
  await routes['POST /api/spotify/suivre']({
    playlists: [{ url: 'https://open.spotify.com/playlist/4444444444444444444444', nom: 'Été' }],
    proposées: ['https://open.spotify.com/playlist/4444444444444444444444'],
  });

  const urls = config().playlists.map((p) => p.url);
  assert.ok(
    urls.includes('https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy'),
    'l’album collé à la main a été effacé',
  );
  const survivante = config().playlists.find((p) => p.url.includes('/album/'));
  assert.equal(survivante.remplacements.format, 'flac', 'ses réglages propres sont perdus');
});

test('décocher une playlist du sélecteur la retire bien', async () => {
  // Le pendant du test précédent : protéger les données ne doit pas rendre le
  // sélecteur inopérant.
  const { routes } = await import('../src/api.js');
  const url = 'https://open.spotify.com/playlist/5555555555555555555555';

  modifier({ playlists: [] });
  await routes['POST /api/spotify/suivre']({
    playlists: [{ url, nom: 'À retirer' }],
    proposées: [url],
  });
  assert.equal(config().playlists.length, 1);

  await routes['POST /api/spotify/suivre']({ playlists: [], proposées: [url] });
  assert.equal(config().playlists.length, 0, 'la playlist décochée est restée');
});

// ---------------------------------------------------------------------------
// Surcharges par playlist
// ---------------------------------------------------------------------------

test('sans surcharge, la configuration générale est renvoyée telle quelle', () => {
  const c = recharger();
  const playlist = { id: '1', url: 'u', remplacements: {} };
  // Identité stricte : pas de copie inutile, donc pas de divergence possible.
  assert.equal(configPourPlaylist(c, playlist), c);
  assert.equal(configPourPlaylist(c, { id: '1', url: 'u' }), c);
});

test('une surcharge ne modifie que le champ concerné', () => {
  const c = recharger();
  const fusionnée = configPourPlaylist(c, {
    id: '1', url: 'u', remplacements: { format: 'flac' },
  });

  assert.equal(fusionnée.qualité.format, 'flac');
  assert.equal(fusionnée.qualité.niveau, c.qualité.niveau, 'la qualité a bougé');
  assert.equal(fusionnée.organisation.schéma, c.organisation.schéma);
  assert.equal(fusionnée.général.dossierMusique, c.général.dossierMusique);
});

test('la surcharge ne contamine jamais la configuration générale', () => {
  // Le piège classique : une fusion superficielle partage les sous-objets, et
  // régler une playlist en FLAC ferait passer TOUTE la bibliothèque en FLAC.
  const c = recharger();
  const formatInitial = c.qualité.format;
  configPourPlaylist(c, { id: '1', url: 'u', remplacements: { format: 'aiff' } });
  assert.equal(c.qualité.format, formatInitial, 'la configuration générale a été modifiée');
});

test('plusieurs surcharges se cumulent', () => {
  const c = recharger();
  const fusionnée = configPourPlaylist(c, {
    id: '1', url: 'u',
    remplacements: { format: 'flac', niveau: 'elevee', schéma: 'plat' },
  });
  assert.equal(fusionnée.qualité.format, 'flac');
  assert.equal(fusionnée.qualité.niveau, 'elevee');
  assert.equal(fusionnée.organisation.schéma, 'plat');
});

test('une surcharge invalide est ignorée plutôt que d’être appliquée', () => {
  const c = recharger();
  const fusionnée = configPourPlaylist(c, {
    id: '1', url: 'u', remplacements: { format: 'wma', niveau: 'ultra' },
  });
  assert.equal(fusionnée.qualité.format, c.qualité.format);
  assert.equal(fusionnée.qualité.niveau, c.qualité.niveau);
});

test('un schéma personnalisé sans modèle ne remplace pas le schéma général', () => {
  // Sinon tous les fichiers de cette playlist porteraient le même nom et
  // s'écraseraient les uns les autres.
  const c = recharger();
  const fusionnée = configPourPlaylist(c, {
    id: '1', url: 'u', remplacements: { schéma: 'personnalise', modèlePersonnalisé: '  ' },
  });
  assert.equal(fusionnée.organisation.schéma, c.organisation.schéma);
});

test('un schéma personnalisé avec modèle est bien appliqué', () => {
  const c = recharger();
  const fusionnée = configPourPlaylist(c, {
    id: '1', url: 'u',
    remplacements: { schéma: 'personnalise', modèlePersonnalisé: '{genre}/{titre}' },
  });
  assert.equal(fusionnée.organisation.schéma, 'personnalise');
  assert.equal(fusionnée.organisation.modèlePersonnalisé, '{genre}/{titre}');
});

test('le dossier peut être surchargé par playlist', () => {
  const c = recharger();
  const fusionnée = configPourPlaylist(c, {
    id: '1', url: 'u', remplacements: { dossierMusique: '/Volumes/DJ-SSD/Sets' },
  });
  assert.equal(fusionnée.général.dossierMusique, '/Volumes/DJ-SSD/Sets');
});

// ---------------------------------------------------------------------------
// Analyse des liens Spotify
// ---------------------------------------------------------------------------

test('les formats d’URL Spotify courants sont reconnus', () => {
  const cas = [
    ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'playlist'],
    ['https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy', 'album'],
    ['https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF', 'artist'],
    ['spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', 'playlist'],
  ];
  for (const [entrée, type] of cas) {
    const analysé = analyserLienSpotify(entrée);
    assert.ok(analysé, `non reconnu : ${entrée}`);
    assert.equal(analysé.type, type);
  }
});

test('le paramètre de suivi est retiré du lien', () => {
  // Spotify ajoute « ?si=... » au copier-coller. Le garder ferait considérer
  // deux collages du même lien comme deux playlists différentes.
  const analysé = analyserLienSpotify(
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123&pt=xyz',
  );
  assert.equal(analysé.url, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
});

test('les liens localisés sont reconnus', () => {
  // Spotify insère le code pays dans l'URL selon la langue de l'utilisateur.
  const analysé = analyserLienSpotify(
    'https://open.spotify.com/intl-fr/album/4aawyAB9vmqN3uQ7FjRGTy',
  );
  assert.ok(analysé);
  assert.equal(analysé.type, 'album');
});

test('ce qui n’est pas un lien Spotify est rejeté', () => {
  for (const entrée of ['', '   ', 'bonjour', 'https://youtube.com/watch?v=abc', null]) {
    assert.equal(analyserLienSpotify(entrée), null, `accepté à tort : ${entrée}`);
  }
});

test('une surcharge de playlist conserve les garde-fous de sécurité', () => {
  // CE QUE CE TEST PROTÈGE. Pendant une synchronisation, les conditions
  // « seulement sur secteur » et « seulement en Wi-Fi », ainsi que le seuil
  // d'espace disque, sont relues playlist après playlist — à partir de la
  // configuration EFFECTIVE de la playlist en cours.
  //
  // Si une refonte de la fusion oubliait de recopier « planification » ou
  // « gardes », ces gardes deviendraient muettes : le téléchargement
  // continuerait sur batterie et sur données mobiles, ou remplirait le disque,
  // sans qu'aucun test ne s'en aperçoive. On le vérifie donc ici.
  const c = config();
  c.planification.uniquementSurSecteur = true;
  c.planification.uniquementEnWifi = true;
  c.gardes.espaceMinimumGo = 7;

  const cp = configPourPlaylist(c, {
    id: '1',
    url: 'u',
    remplacements: { dossierMusique: '/ailleurs' },
  });

  assert.notEqual(cp, c, 'la surcharge n’a pas été appliquée, le test ne prouve rien');
  assert.equal(cp.général.dossierMusique, '/ailleurs');
  assert.equal(cp.planification.uniquementSurSecteur, true);
  assert.equal(cp.planification.uniquementEnWifi, true);
  assert.equal(cp.gardes.espaceMinimumGo, 7);
});

test.after(() => {
  fs.rmSync(DOSSIER, { recursive: true, force: true });
});

test('le premier démarrage pose les réglages sur le disque, les suivants n’y touchent pas', () => {
  // CE QUE CE FICHIER SIGNIFIE, AU-DELÀ DES RÉGLAGES. C'est lui qui répond à
  // « cette application a-t-elle déjà tourné sur ce Mac ? ». La coquille macOS
  // s'en sert pour ouvrir le tableau de bord au tout premier lancement — et à
  // ce moment-là seulement, sinon l'app s'imposerait à chaque démarrage.
  //
  // Le dossier de données ne pourrait pas jouer ce rôle : le journal de
  // démarrage le crée avant même que la question ne se pose. Vérifié en vrai,
  // le fichier n'était pas écrit du tout avant cette correction.
  const chemin = path.join(process.env.ZOTIJEAN_DONNEES, 'config.json');
  fs.rmSync(chemin, { force: true });

  assert.equal(assurerFichierConfig(), true, 'un premier démarrage n’a pas été reconnu');
  assert.ok(fs.existsSync(chemin), 'les réglages n’ont pas été écrits');

  // Le contenu doit être relisible : c'est aussi ce qui permet de dépanner
  // quand l'interface refuse de s'ouvrir.
  const relu = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  assert.equal(typeof relu.général.dossierMusique, 'string');
  assert.equal(typeof relu.planification.intervalleHeures, 'number');

  // Second appel : le fichier existe, on n'y touche pas et on le dit.
  assert.equal(assurerFichierConfig(), false, 'un démarrage ordinaire a été pris pour le premier');
});
