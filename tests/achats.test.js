// Tests de la recherche de liens d'achat.
//
// CE QUE CES TESTS DOIVENT ATTRAPER, et qui ne se voit pas en lisant le code :
// une recherche floue rend TOUJOURS un résultat. Bandcamp comme MusicBrainz
// répondent quelque chose à peu près à tout. Le seul rempart contre un rapport
// plein de liens plausibles et faux est la vérification qui suit la recherche —
// et cette vérification ne s'exerce que sur le CHAÎNAGE complet, jamais sur une
// fonction prise à part.
//
// D'où la doublure de transport : chaque test scénarise une réponse mensongère
// et exige que le module la refuse. Un test qui ne ferait que « chercher, puis
// croire » passerait au vert sur un module entièrement cassé.
//
// Le second sujet est la promesse du rapport : « achetable en sans-perte ».
// Elle ne tient que si une boutique qui ne vend pas de sans-perte est comptée
// comme telle. Apple Music sert de cas positif à ce garde-fou.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ÉTAGES, LIBELLÉS_ÉTAGE,
  boutiqueDeLURL, normaliserPourComparaison, variantesDeTitre, artistePrincipal,
  déséchapperHTML, extraireFicheBandcamp, lireVenteBandcamp,
  recherchesPréRemplies, cléDePiste, estimerDurée, bilanDe,
  construireCSV, construireHTML, échapperHTML,
  créerTransport, résoudrePiste, résoudreToutes,
} from '../src/achats.js';

// ---------------------------------------------------------------------------
// Doublure de transport
// ---------------------------------------------------------------------------

/**
 * Répond selon des motifs d'URL. Toute URL non prévue rend 404 : un test qui
 * oublie un appel le voit, au lieu de recevoir un succès silencieux.
 */
function transportFactice(réponses) {
  const appels = [];
  const http = async (url, options = {}) => {
    appels.push({ url, corps: options.corps ?? null });
    for (const [motif, réponse] of réponses) {
      if (url.includes(motif)) {
        const valeur = typeof réponse === 'function' ? réponse(url, options) : réponse;
        return typeof valeur === 'string'
          ? { code: 200, corps: valeur }
          : { code: 200, corps: JSON.stringify(valeur) };
      }
    }
    return { code: 404, corps: '' };
  };
  return { transport: créerTransport({ http, rythmer: false }), appels };
}

const rechercheBandcamp = (résultats) => ['bcsearch_public_api', { auto: { results: résultats } }];

/** Une page Bandcamp réduite à ce que le module y lit vraiment. */
function pageBandcamp({ artiste, titre, vendable = true, prix = 1, album = null, pistes = null }) {
  const fiche = {
    artist: artiste,
    album_url: album,
    current: { title: titre, type: 'track', minimum_price: prix },
    packages: [{ currency: 'EUR' }],
    trackinfo: (pistes ?? [{ title: titre }]).map((p) => ({
      title: p.title, is_downloadable: vendable, unreleased_track: false,
    })),
  };
  return `<html><body><div data-tralbum="${JSON.stringify(fiche).replace(/"/g, '&quot;')}"></div></body></html>`;
}

const SANS_RÉSEAU = { transport: créerTransport({ http: async () => ({ code: 0, corps: '' }), rythmer: false }) };

// ---------------------------------------------------------------------------
// Comparaison de noms
// ---------------------------------------------------------------------------

test('la normalisation ignore casse et ponctuation', () => {
  assert.equal(normaliserPourComparaison('R U IN2 IT?'), normaliserPourComparaison('r u in2 it'));
  assert.equal(normaliserPourComparaison('Crossing The White Line (Gorge Interpretation)'),
    normaliserPourComparaison('Crossing the White Line - Gorge Interpretation'));
});

// Sans cette règle, « O$VMV$M » ne se retrouve nulle part : les deux morceaux de
// cet artiste dans la bibliothèque réelle en dépendent.
test('le dollar compte pour un S, comme dans les noms d’artistes électroniques', () => {
  assert.equal(normaliserPourComparaison('O$VMV$M'), 'osvmvsm');
});

test('deux titres réellement différents ne se confondent pas', () => {
  assert.notEqual(normaliserPourComparaison('To'), normaliserPourComparaison('Left To'));
  assert.notEqual(normaliserPourComparaison('Zen'), normaliserPourComparaison('Zen II'));
});

test('les variantes vont du titre complet au titre nu, sans doublon', () => {
  assert.deepEqual(variantesDeTitre('Bad Weather - STR4TA Remix Instrumental'),
    ['Bad Weather - STR4TA Remix Instrumental', 'Bad Weather']);
  assert.deepEqual(variantesDeTitre('Zen'), ['Zen']);
});

test('l’artiste principal se dégage des crédits multiples', () => {
  assert.equal(artistePrincipal('Logos, Mumdance'), 'Logos');
  assert.equal(artistePrincipal('Anushka feat. STR4TA'), 'Anushka');
  assert.equal(artistePrincipal('Walton'), 'Walton');
});

// ---------------------------------------------------------------------------
// La promesse « sans perte »
// ---------------------------------------------------------------------------

test('Apple Music est un lien d’achat, mais PAS un lien sans-perte', () => {
  const apple = boutiqueDeLURL('https://itunes.apple.com/us/album/id1346752462');
  assert.equal(apple.sansPerte, false, 'Apple ne vend pas de sans-perte');
});

test('une boutique inconnue reste dans le doute, jamais comptée comme sans-perte', () => {
  assert.equal(boutiqueDeLURL('http://www.hhv.de/item_97566.html').sansPerte, null);
  assert.equal(boutiqueDeLURL('pas une URL').sansPerte, null);
});

test('Bandcamp et Beatport sont reconnus comme sans-perte', () => {
  assert.equal(boutiqueDeLURL('https://iglew.bandcamp.com/track/x').sansPerte, true);
  assert.equal(boutiqueDeLURL('https://www.beatport.com/release/x/1').sansPerte, true);
});

// ---------------------------------------------------------------------------
// Lecture d'une page Bandcamp
// ---------------------------------------------------------------------------

test('les entités des attributs sont rendues avant l’analyse', () => {
  assert.equal(déséchapperHTML('&quot;a&quot; &amp; &#39;b&#39;'), '"a" & \'b\'');
});

test('une page sans fiche ne fait pas tomber la lecture', () => {
  assert.equal(extraireFicheBandcamp('<html></html>'), null);
  assert.equal(lireVenteBandcamp(null), null);
});

// Le cas où CETTE garde est SEULE à pouvoir refuser : la page existe, le titre
// et l'artiste sont les bons, le prix est affiché — et pourtant rien n'est
// vendu. Sans elle, le rapport enverrait vers une page d'écoute.
test('une page en écoute seule n’est pas vendable', () => {
  const écouteSeule = lireVenteBandcamp(
    extraireFicheBandcamp(pageBandcamp({ artiste: 'Mr. Mitch', titre: 'R U IN2 IT?', vendable: false })),
  );
  assert.equal(écouteSeule.vendable, false);
  assert.equal(écouteSeule.titre, 'R U IN2 IT?', 'le reste de la fiche est bien lu');
});

// ---------------------------------------------------------------------------
// Le chaînage — recherche PUIS vérification
// ---------------------------------------------------------------------------

const WALTON = { artiste: 'Walton', titre: 'Zen', album: 'Taiko', isrc: 'GBHLW1701196' };

test('un morceau vendu sur Bandcamp donne un lien de piste vérifié', async () => {
  const { transport } = transportFactice([
    rechercheBandcamp([{ name: 'Zen', item_url_path: 'https://walton.bandcamp.com/track/zen' }]),
    ['walton.bandcamp.com/track/zen', pageBandcamp({ artiste: 'Walton', titre: 'Zen', prix: 2 })],
  ]);

  const fiche = await résoudrePiste(WALTON, { transport });
  assert.equal(fiche.étage, ÉTAGES.PISTE);
  assert.equal(fiche.boutique, 'Bandcamp');
  assert.equal(fiche.sansPerte, true);
  assert.equal(fiche.prix, 2);
});

// LE test de ce fichier. La recherche renvoie un titre exact — mais la page
// appartient à quelqu'un d'autre. Sans la confrontation à la page, le rapport
// enverrait acheter le mauvais morceau, avec l'aplomb d'un lien direct.
test('un homonyme d’un autre artiste est refusé, malgré un titre exact', async () => {
  const { transport } = transportFactice([
    rechercheBandcamp([{ name: 'Zen', item_url_path: 'https://autre.bandcamp.com/track/zen' }]),
    ['autre.bandcamp.com/track/zen', pageBandcamp({ artiste: 'Quelqu’un d’autre', titre: 'Zen' })],
  ]);

  const fiche = await résoudrePiste(WALTON, { transport, sources: { bandcamp: true, musicbrainz: false } });
  assert.equal(fiche.étage, ÉTAGES.RECHERCHE, 'un homonyme ne doit jamais passer pour un lien direct');
  assert.equal(fiche.url, undefined);
});

test('un résultat au titre approchant est refusé avant même d’ouvrir la page', async () => {
  const { transport, appels } = transportFactice([
    rechercheBandcamp([{ name: 'Zen II', item_url_path: 'https://walton.bandcamp.com/track/zen-ii' }]),
  ]);

  const fiche = await résoudrePiste(WALTON, { transport, sources: { bandcamp: true, musicbrainz: false } });
  assert.equal(fiche.étage, ÉTAGES.RECHERCHE);
  assert.equal(appels.filter((a) => a.url.includes('/track/')).length, 0,
    'aucune page ne doit être ouverte pour un titre qui ne correspond pas');
});

test('une piste non vendue bascule vers l’album qui la porte', async () => {
  const { transport } = transportFactice([
    rechercheBandcamp([{ name: 'R U IN2 IT?', item_url_path: 'https://mrmitchmusic.bandcamp.com/track/r-u-in2-it' }]),
    ['/track/r-u-in2-it', pageBandcamp({
      artiste: 'Mr. Mitch', titre: 'R U IN2 IT?', vendable: false, album: '/album/work',
    })],
    ['/album/work', pageBandcamp({ artiste: 'Mr. Mitch', titre: 'WORK!', prix: 5 })],
  ]);

  const fiche = await résoudrePiste(
    { artiste: 'Mr. Mitch', titre: 'R U IN2 IT?', album: 'WORK!' }, { transport },
  );
  assert.equal(fiche.étage, ÉTAGES.ALBUM);
  assert.equal(fiche.url, 'https://mrmitchmusic.bandcamp.com/album/work');
  assert.match(fiche.note, /pas vendu séparément/);
});

// Un album trouvé par son nom peut ne pas contenir le morceau cherché : c'est
// arrivé sur la bibliothèque réelle. Le dire est le minimum ; le taire ferait
// acheter un album au hasard.
test('un album dont la liste ne contient pas le morceau est signalé comme incertain', async () => {
  const { transport } = transportFactice([
    ['search_filter":"t"', { auto: { results: [] } }],
    rechercheBandcamp([{ name: 'Imperial Flood', item_url_path: 'https://differentcircles.bandcamp.com/album/imperial-flood' }]),
    ['/album/imperial-flood', pageBandcamp({
      artiste: 'Logos', titre: 'Imperial Flood', pistes: [{ title: 'Autre chose' }],
    })],
  ]);

  const fiche = await résoudrePiste(
    { artiste: 'Logos, Mumdance', titre: 'Zoned In', album: 'Imperial Flood' },
    { transport, sources: { bandcamp: true, musicbrainz: false } },
  );
  assert.equal(fiche.étage, ÉTAGES.ALBUM);
  assert.equal(fiche.incertain, true);
  assert.match(fiche.note, /N’A PAS été retrouvé/);
});

// ---------------------------------------------------------------------------
// MusicBrainz — le détour par les sorties
// ---------------------------------------------------------------------------

// Mesuré sur la bibliothèque réelle : les liens d'achat portés par un
// enregistrement étaient au nombre de ZÉRO. Interroger l'enregistrement et
// s'arrêter là rendait un rapport entièrement vide.
test('le lien d’achat est cherché sur les sorties, pas seulement sur l’enregistrement', async () => {
  const { transport, appels } = transportFactice([
    ['/isrc/', { recordings: [{ id: 'abc', title: 'To', relations: [] }] }],
    ['/release?recording=abc', {
      releases: [{
        title: 'Mantis 11',
        relations: [{
          type: 'purchase for download',
          url: { resource: 'https://katatonicsilentio.bandcamp.com/album/mantis-11' },
        }],
      }],
    }],
  ]);

  const fiche = await résoudrePiste(
    { artiste: 'Katatonic Silentio', titre: 'To', isrc: 'NLM792300114' },
    { transport, sources: { bandcamp: false, musicbrainz: true } },
  );
  assert.equal(fiche.étage, ÉTAGES.RÉFÉRENCÉ);
  assert.equal(fiche.voie, 'ISRC');
  assert.ok(appels.some((a) => a.url.includes('/release?recording=')), 'les sorties doivent être interrogées');
});

test('un ISRC inconnu bascule sur la recherche par artiste et titre', async () => {
  const { transport } = transportFactice([
    ['/recording?query=', {
      recordings: [{
        id: 'def', title: 'Zen', score: 100,
        'artist-credit': [{ artist: { name: 'Walton' } }],
      }],
    }],
    ['/release?recording=def', {
      releases: [{ title: 'Taiko', relations: [{ type: 'purchase for download', url: { resource: 'https://www.beatport.com/release/taiko/1' } }] }],
    }],
  ]);

  const fiche = await résoudrePiste(WALTON, { transport, sources: { bandcamp: false, musicbrainz: true } });
  assert.equal(fiche.voie, 'artiste + titre');
  assert.equal(fiche.boutique, 'Beatport');
});

// Le score de MusicBrainz vaut 100 pour le meilleur résultat d'une recherche
// même mauvaise. S'y fier ferait entrer n'importe quoi dans le rapport.
test('un score de 100 ne suffit pas : les noms doivent correspondre', async () => {
  const { transport } = transportFactice([
    ['/recording?query=', {
      recordings: [{
        id: 'xyz', title: 'Zen Garden', score: 100,
        'artist-credit': [{ artist: { name: 'Un Autre' } }],
      }],
    }],
  ]);

  const fiche = await résoudrePiste(WALTON, { transport, sources: { bandcamp: false, musicbrainz: true } });
  assert.equal(fiche.étage, ÉTAGES.RECHERCHE);
});

test('Bandcamp passe devant Apple Music quand les deux sont connus', async () => {
  const { transport } = transportFactice([
    ['/isrc/', { recordings: [{ id: 'abc', title: 'X', relations: [] }] }],
    ['/release?recording=abc', {
      releases: [{
        title: 'Un album',
        relations: [
          { type: 'purchase for download', url: { resource: 'https://itunes.apple.com/us/album/id1' } },
          { type: 'purchase for download', url: { resource: 'https://truc.bandcamp.com/album/x' } },
        ],
      }],
    }],
  ]);

  const fiche = await résoudrePiste({ artiste: 'A', titre: 'X', isrc: 'AA000000000' },
    { transport, sources: { bandcamp: false, musicbrainz: true } });
  assert.equal(fiche.boutique, 'Bandcamp');
  assert.equal(fiche.sansPerte, true);
});

test('un lien Apple Music seul est rendu, mais annoncé comme sans sans-perte', async () => {
  const { transport } = transportFactice([
    ['/isrc/', { recordings: [{ id: 'abc', title: 'X', relations: [] }] }],
    ['/release?recording=abc', {
      releases: [{ title: 'Un album', relations: [{ type: 'purchase for download', url: { resource: 'https://itunes.apple.com/us/album/id1' } }] }],
    }],
  ]);

  const fiche = await résoudrePiste({ artiste: 'A', titre: 'X', isrc: 'AA000000000' },
    { transport, sources: { bandcamp: false, musicbrainz: true } });
  assert.equal(fiche.sansPerte, false);
  assert.match(fiche.note, /ne vend pas de sans-perte/);
});

// ---------------------------------------------------------------------------
// Dégradation : une source qui tombe ne fait pas tomber le rapport
// ---------------------------------------------------------------------------

test('sans réseau, chaque morceau reçoit des recherches pré-remplies, jamais une erreur', async () => {
  const fiche = await résoudrePiste(WALTON, SANS_RÉSEAU);
  assert.equal(fiche.étage, ÉTAGES.RECHERCHE);
  assert.equal(fiche.recherches.length, 3);
  assert.equal(fiche.artiste, 'Walton', 'le morceau reste identifiable dans le rapport');
});

test('une panne de Bandcamp désactive Bandcamp, pas le rapport', async () => {
  let appelsBandcamp = 0;
  const http = async (url) => {
    if (url.includes('bandcamp.com')) { appelsBandcamp += 1; return { code: 0, corps: '' }; }
    if (url.includes('/release?recording=')) {
      return { code: 200, corps: JSON.stringify({ releases: [{ title: 'T', relations: [{ type: 'purchase for download', url: { resource: 'https://www.beatport.com/release/t/1' } }] }] }) };
    }
    if (url.includes('/isrc/')) {
      return { code: 200, corps: JSON.stringify({ recordings: [{ id: 'r1', title: 'Zen', relations: [] }] }) };
    }
    return { code: 404, corps: '' };
  };

  const pistes = [WALTON, { ...WALTON, titre: 'Zen', isrc: 'GBHLW1701197' }];
  let aprèsLePremier = null;
  const { fiches } = await résoudreToutes(pistes, {
    transport: créerTransport({ http, rythmer: false }),
    reprise: false,
    écrireAvancement: () => {},
    surProgrès: () => { if (aprèsLePremier === null) aprèsLePremier = appelsBandcamp; },
  });

  assert.equal(fiches.length, 2);
  assert.equal(fiches[0].boutique, 'Beatport', 'le repli MusicBrainz a bien pris le relais');
  assert.equal(fiches[1].boutique, 'Beatport', 'et pour les suivants aussi');
  // Le transport réessaie une requête coupée : le premier morceau consomme donc
  // plusieurs appels réseau pour une seule tentative logique. Ce qui compte est
  // qu'après lui, plus AUCUN appel ne parte vers Bandcamp — sur deux mille
  // morceaux, s'entêter coûterait des heures pour zéro lien.
  assert.ok(aprèsLePremier > 0, 'Bandcamp doit bien avoir été essayé une fois');
  assert.equal(appelsBandcamp, aprèsLePremier, 'Bandcamp n’est plus rappelé après sa panne');
});

test('un morceau déjà traité n’est pas réinterrogé', async () => {
  let appels = 0;
  const http = async () => { appels += 1; return { code: 404, corps: '' }; };
  const pistes = [WALTON, WALTON];

  await résoudreToutes(pistes, {
    transport: créerTransport({ http, rythmer: false }),
    reprise: false,
    écrireAvancement: () => {},
  });
  const aprèsPremier = appels;
  assert.ok(aprèsPremier > 0, 'le premier morceau doit bien avoir été interrogé');
  assert.equal(appels, aprèsPremier, 'le second, identique, est servi par ce qui est déjà fait');
});

test('un arrêt demandé interrompt sans rien perdre', async () => {
  const { transport } = transportFactice([]);
  const pistes = [WALTON, { artiste: 'B', titre: 'Y' }, { artiste: 'C', titre: 'Z' }];
  let vus = 0;

  const { fiches, interrompu } = await résoudreToutes(pistes, {
    transport, reprise: false, écrireAvancement: () => {},
    arrêtDemandé: () => vus >= 1,
    surProgrès: () => { vus += 1; },
  });

  assert.equal(interrompu, true);
  assert.equal(fiches.length, 1, 'ce qui est fait est conservé');
});

// ---------------------------------------------------------------------------
// Reprise et durée annoncée
// ---------------------------------------------------------------------------

// Une reprise sert à finir ce qui a été interrompu, jamais à figer un résultat :
// sinon le rapport resservirait éternellement les mêmes liens, alors que les
// prix changent et que des albums sont retirés de la vente.
test('un rapport mené à son terme oublie son avancement, un rapport interrompu le garde', async () => {
  const { transport } = transportFactice([]);
  let effacé = 0;
  const commun = {
    transport, reprise: false, écrireAvancement: () => {}, oublierAvancement: () => { effacé += 1; },
  };

  await résoudreToutes([WALTON], commun);
  assert.equal(effacé, 1, 'terminé : l’avancement est oublié, la prochaine fois revérifiera');

  effacé = 0;
  const { interrompu } = await résoudreToutes(
    [WALTON, { artiste: 'B', titre: 'Y' }], { ...commun, arrêtDemandé: () => true },
  );
  assert.equal(interrompu, true);
  assert.equal(effacé, 0, 'interrompu : l’avancement est conservé pour la reprise');
});

test('la clé de reprise préfère l’ISRC et retombe sur le nom', () => {
  assert.equal(cléDePiste(WALTON), 'isrc:GBHLW1701196');
  assert.equal(cléDePiste({ artiste: 'Walton', titre: 'Zen' }), 'nom:walton/zen');
});

// La durée doit être calculable AVANT de commencer : c'est une règle du projet,
// pas un confort. Une opération d'une heure qui démarre sans l'annoncer est
// indiscernable d'un blocage.
test('la durée annoncée grandit avec le travail et se réduit sans Bandcamp', () => {
  const complet = estimerDurée(100);
  const sansBandcamp = estimerDurée(100, { sources: { bandcamp: false, musicbrainz: true } });
  assert.ok(complet.secondes > sansBandcamp.secondes);
  assert.ok(complet.secondes >= 100, 'au moins une seconde par morceau');
  assert.equal(estimerDurée(0).secondes, 0);
});

// ---------------------------------------------------------------------------
// Le rapport
// ---------------------------------------------------------------------------

const FICHES = [
  { artiste: 'Walton', titre: 'Zen', playlist: 'P', isrc: 'A', étage: ÉTAGES.PISTE, boutique: 'Bandcamp', sansPerte: true, url: 'https://walton.bandcamp.com/track/zen', prix: 2, devise: 'GBP' },
  { artiste: 'Logos', titre: 'Zoned In', playlist: 'P', isrc: '', étage: ÉTAGES.ALBUM, boutique: 'Bandcamp', sansPerte: true, url: 'https://x.bandcamp.com/album/y', incertain: true, note: 'à vérifier' },
  { artiste: 'Ikonika', titre: 'Where Is Your Wife?', playlist: 'P', isrc: 'C', étage: ÉTAGES.RÉFÉRENCÉ, boutique: 'Apple Music', sansPerte: false, url: 'https://itunes.apple.com/x' },
  { artiste: 'Freddie; Cruger', titre: 'Some "Good"', playlist: 'P', isrc: '', étage: ÉTAGES.RECHERCHE, sansPerte: null, recherches: recherchesPréRemplies({ artiste: 'Freddie Cruger', titre: 'Something Good' }) },
];

test('le bilan compte chaque étage séparément', () => {
  const b = bilanDe(FICHES);
  assert.deepEqual(
    { total: b.total, lienPiste: b.lienPiste, lienAlbum: b.lienAlbum, lienRéférencé: b.lienRéférencé, rechercheSeule: b.rechercheSeule },
    { total: 4, lienPiste: 1, lienAlbum: 1, lienRéférencé: 1, rechercheSeule: 1 },
  );
  assert.equal(b.sansPerte, 2, 'Apple Music ne compte pas dans les sans-perte');
  assert.equal(b.avecISRC, 2);
  assert.equal(b.àVérifier, 1);
});

test('le CSV protège les points-virgules et les guillemets des titres', () => {
  const lignes = construireCSV(FICHES).trim().split('\r\n');
  assert.ok(lignes[4].includes('"Freddie; Cruger"'), 'un point-virgule dans un nom casserait les colonnes');
  assert.ok(lignes[4].includes('"Some ""Good"""'), 'les guillemets sont doublés');
  assert.ok(construireCSV(FICHES).startsWith('﻿'), 'le BOM évite le charabia dans un tableur français');
});

test('le HTML échappe ce qui viendrait casser la page', () => {
  assert.equal(échapperHTML('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  const html = construireHTML([{ ...FICHES[0], titre: 'Zen <script>' }], bilanDe(FICHES));
  assert.ok(!html.includes('<script>'), 'aucun balisage ne doit sortir d’un titre');
});

// Un rapport qui présente une recherche pré-remplie comme un lien direct
// surestime sa propre couverture. C'est le seul mensonge que cette page peut
// commettre, et il est invisible à la lecture du code.
test('le HTML sépare les liens vérifiés des recherches, en toutes lettres', () => {
  const html = construireHTML(FICHES, bilanDe(FICHES));
  assert.ok(html.includes(LIBELLÉS_ÉTAGE[ÉTAGES.PISTE]));
  assert.ok(html.includes(LIBELLÉS_ÉTAGE[ÉTAGES.RECHERCHE]));
  assert.match(html, /Chercher sur Bandcamp/, 'une recherche est annoncée comme telle');
  assert.match(html, /pas de sans-perte ici/, 'Apple Music est signalé dans la page');
  assert.match(html, /2 morceau\(x\) sur 4/, 'le compte annoncé est celui des liens vérifiés');
});

test('le HTML dit quand Bandcamp était hors-jeu', () => {
  const html = construireHTML(FICHES, bilanDe(FICHES), { sources: { bandcamp: false } });
  assert.match(html, /moins complet/);
});

// ---------------------------------------------------------------------------
// Les deux tests qui paient l'exemption de tests/styles-en-ligne.test.js
// ---------------------------------------------------------------------------
//
// Ce module est le seul autorisé à embarquer un bloc <style>, parce que son
// rapport vit sur le disque et s'ouvre depuis le Finder. Les deux tests qui
// suivent tiennent cette justification : sans eux, l'exemption serait un trou.

test('le rapport est autonome : il emporte son style, il n’en réclame aucun', () => {
  const html = construireHTML(FICHES, bilanDe(FICHES));
  assert.match(html, /<style>/, 'un fichier ouvert depuis le Finder n’a aucune feuille à côté de lui');
  assert.ok(!/<link[^>]+stylesheet/i.test(html), 'aucun lien vers une feuille que le disque n’aura pas');
  assert.ok(!/<script/i.test(html), 'aucun script : la page est un document, pas une application');
});

test('le rapport n’est jamais servi par le serveur, où la politique s’appliquerait', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const racine = path.join(import.meta.dirname, '..');

  for (const fichier of ['src/api.js', 'server.js']) {
    const source = fs.readFileSync(path.join(racine, fichier), 'utf8');
    assert.ok(
      !source.includes('construireHTML'),
      `${fichier} sert le rapport : la politique de sécurité y effacerait son style. `
      + 'Ouvrir le fichier par le système, ou déplacer le style dans une feuille servie.',
    );
  }
});

// ÉPROUVÉ EN CASSANT LE CODE EXPRÈS, 21 août 2026. Réduire « slice(0, 2) » à
// « slice(0, 1) » dans résoudreSurMusicBrainz laissait toute la suite au vert :
// aucune doublure ne renvoyait deux enregistrements pour un même ISRC.
//
// Le cas n'est pas théorique : un même ISRC peut désigner plusieurs entrées de
// MusicBrainz — un mix radio et la version d'album, par exemple —, et rien ne
// garantit que celle qui porte le lien d'achat arrive en premier.
test('deux enregistrements pour un même ISRC sont tous deux examinés', async () => {
  const { transport, appels } = transportFactice([
    ['/isrc/', {
      recordings: [
        { id: 'premier', title: 'To (mix radio)', relations: [] },
        { id: 'second', title: 'To', relations: [] },
      ],
    }],
    ['/release?recording=premier', { releases: [] }],
    ['/release?recording=second', {
      releases: [{
        title: 'Mantis 11',
        relations: [{
          type: 'purchase for download',
          url: { resource: 'https://katatonicsilentio.bandcamp.com/album/mantis-11' },
        }],
      }],
    }],
  ]);

  const fiche = await résoudrePiste(
    { artiste: 'Katatonic Silentio', titre: 'To', isrc: 'NLM792300114' },
    { transport, sources: { bandcamp: false, musicbrainz: true } },
  );

  assert.equal(
    fiche.étage, ÉTAGES.RÉFÉRENCÉ,
    'le second enregistrement a été écarté en silence : le morceau est annoncé '
    + 'sans lien d’achat alors qu’il en a un',
  );
  assert.ok(
    appels.some((a) => a.url.includes('/release?recording=second')),
    'les sorties du second enregistrement n’ont jamais été demandées',
  );
});
