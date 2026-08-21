# Reste à faire

Ce que l'on sait imparfait, et qui n'a pas encore été corrigé.

Ce fichier existe parce que les tâches reportées ne survivaient qu'à l'intérieur
de conversations, qui disparaissent. Un défaut connu et non écrit redevient un
défaut inconnu au bout de quelques semaines — et se paie une deuxième fois, en
le redécouvrant.

**Ce fichier fait autorité sur ce qui est ouvert.** `CLAUDE.md`, lui, fait
autorité sur ce qui contraint le code : faits établis sur zotify, règles de
conception, profil du projet, procédure de publication. Des invariants, qui ne se
rayent pas. Ici au contraire, tout est destiné à disparaître une ligne à la fois.
Ne rien dupliquer entre les deux.

Quatre sections, et les distinctions comptent :

- **Défauts constatés** — vus, mesurés, situés dans le code. Il ne manque que le
  temps de les corriger.
- **Chantiers en pause** — le code existe, il est testé, mais il n'est
  volontairement pas branché : la décision appartient à l'utilisateur.
- **Angles morts** — on ne sait pas s'il y a un défaut, parce que personne n'a
  regardé. C'est pire qu'un défaut connu : on ne peut même pas en estimer la
  gravité.
- **Relevés datés** — ce qu'une vérification a trouvé, et qu'elle n'a pas corrigé.

Dernière mise à jour : 21 août 2026, après l'audit de fond du programme entier
mené sur la 1.1.0 fusionnée dans `main`. Le relevé de cet audit est le premier
des relevés datés ci-dessous ; il porte sept bloquants et huit points de dette.

---

## Défauts constatés

*Cette section est **vide** depuis le 21 août 2026. Le seul défaut qu'elle
portait — les actions de la chaîne d'intégration sur Node 20 — est corrigé.
L'entrée est conservée ci-dessous, barrée, parce que son conseil s'est révélé
faux et que c'est ce qui mérite d'être gardé.*

### ~~Les actions de la chaîne d'intégration ciblent Node 20, qui est déprécié~~ — corrigé le 21 août 2026

**Corrigé.** Les sept références sont passées en `@v7` : `actions/checkout`,
`actions/setup-node` et `actions/upload-artifact`. Vérifié après coup — plus
aucune action en `@v4` dans `.github/workflows/`.

**Mais le correctif que cette entrée conseillait était FAUX**, et c'est la seule
chose qui vaut d'être retenue ici. Elle disait « passer les trois actions en
`@v5` ». Or, interrogé le 21 août :

| action | `v4` | `v5` | `v6` | `v7` |
|---|---|---|---|---|
| `checkout` | node20 | node24 | node24 | node24 |
| `setup-node` | node20 | node24 | node24 | node24 |
| **`upload-artifact`** | node20 | **node20** | node24 | node24 |

`upload-artifact@v5` tourne **encore sur Node 20**. Le conseil aurait donc réparé
deux actions sur trois et laissé la troisième exactement dans l'état qu'on
croyait avoir corrigé — le pire résultat possible, parce qu'on aurait rayé
l'entrée.

Le saut jusqu'à `@v7` n'est pas une coquetterie de version : c'est le seul choix
qui laisse les trois actions sur le même runtime. Il est sûr ici parce que
l'usage est minimal — `checkout` est appelé **sans aucun paramètre**,
`setup-node` avec le seul `node-version`, et `upload-artifact` avec `name`,
`path` et `if-no-files-found`. Les trois paramètres existent toujours en `v7`,
vérifié dans les `action.yml` de chaque version avant de toucher aux fichiers.

**La leçon, elle, ne se raye pas : un correctif écrit à l'avance vieillit comme
une explication.** Celui-ci a été écrit deux jours avant d'être appliqué, et il
était déjà faux. Revérifier au moment de corriger, jamais faire confiance à la
recette notée en passant.

<details>
<summary>Le constat d'origine, tel qu'il était écrit le 19 août 2026</summary>

Vu le 19 août 2026 sur l'exécution `32280533751` : **les cinq tâches** annoncent
la même chose, sur les trois systèmes.

> Node.js 20 is deprecated. The following actions target Node.js 20 but are
> being forced to run on Node.js 24.

Trois actions, à sept endroits. *(Ce décompte disait « cinq » et en listait sept ;
corrigé le 21 août 2026 — les sept références ci-dessous ont été revérifiées une
par une et sont toutes exactes. Les « cinq » sont les cinq TÂCHES de la chaîne
d'intégration qui affichent l'avertissement, pas les endroits à corriger.)*

- `actions/checkout@v4` — `publication.yml:38`, `tests.yml:38`, `tests.yml:193`
- `actions/setup-node@v4` — `publication.yml:40`, `tests.yml:40`, `tests.yml:194`
- `actions/upload-artifact@v4` — `tests.yml:632`

**Ça n'échoue pas aujourd'hui**, parce que les runners forcent Node 24 à leur
place. Ça échouera le jour où GitHub retirera ce rattrapage — et ce jour-là, ce
sera la chaîne de PUBLICATION qui tombera, c'est-à-dire au pire moment.

Le correctif tient en cinq lignes : passer les trois actions en `@v5`. Il n'a pas
été fait le 19 août parce que ç'aurait été un huitième sujet dans une branche qui
en portait déjà sept, et que mélanger deux sujets rend un changement illisible
six mois plus tard. Les six défauts vus le 19 août 2026 sur le Mac — avec le
vrai zotify et une vraie bibliothèque — ont tous été corrigés dans la 1.1.0. Le
détail de chacun, et ce que sa correction a appris en marge, est dans les relevés
datés en fin de fichier.

Deux autres constats de ce jour-là appellent une décision plutôt qu'un correctif,
et sont écrits comme relevés plus bas : il existe un **second zotify** sur la
machine de Pym, plus récent en numéro et dépourvu de `--skip-existing`, et
**personne n'a encore regardé l'app à l'œil** sur cet écran.

</details>

## Chantiers en pause

### Écrire les ISRC dans les étiquettes des fichiers

La moitié restante du « pont sans perte ». Depuis la 1.0.6, la variable `{isrc}`
met déjà l'identifiant dans le NOM du fichier sans rien réécrire ; c'est le
chemin sûr. Écrire dans les étiquettes exigerait de réécrire le fichier, là où
Serato stocke points de repère et grilles rythmiques : à ne faire qu'**avec**
l'utilisateur, sur ses vrais fichiers, en commençant par une simulation.

---

## Angles morts

### ~~Safari n'a jamais rendu ces styles~~ — levé le 19 août 2026

Safari 16.3 a rendu la feuille, et les mesures sont dans le relevé daté du
19 août plus bas. Les quatre propriétés surveillées passent, `backdrop-filter`
grâce à son préfixe `-webkit-` déjà présent. Ce qui reste de cet angle mort
tient en deux lignes, et il est descendu d'un cran :

- **`text-wrap: balance` est ignoré par Safari 16.3** (`public/notice.css`,
  lignes **80 et 95**). Sans conséquence : le texte s'affiche, il n'est
  simplement pas équilibré. *(Ces lignes étaient données comme 91 et 106 ; le
  fichier a été décalé par l'extraction de la palette en 1.1.0. Revérifié le
  21 août 2026.)*
- **Le navigateur par défaut de ce Mac est Firefox, pas Safari.** L'app s'y
  ouvrira donc par `open`. Gecko n'a été mesuré ni ici ni ailleurs. L'angle mort
  n'a pas disparu, il a changé de moteur.

~~Et la question que les tests ne savaient pas poser a sa réponse : « Tous les
deux jours » ne tient PAS sur une ligne.~~ **Réglé le 19 août 2026** : la liste
des intervalles n'est plus une grille compacte de 190 px. Mesuré après
correction — une seule ligne à 420 px et au-delà ; en dessous, la mise en page
est celle d'un téléphone et le repli y est légitime.

### ~~L'harmonie générale des teintes n'a jamais été regardée~~ — regardée le 19 août 2026

Les deux thèmes ont enfin été VUS, sur l'écran du Mac : Safari en thème sombre,
puis les sept onglets dans les deux thèmes. Rien ne crie, rien ne jure. Gris
neutres, un seul accent, espacements réguliers, icônes toutes rendues — le
contournement `display: none` de la bibliothèque de symboles tient.

Deux remarques de goût, sans gravité et sans mesure derrière :

- **L'accent du thème clair est un brun**, pas un ambre. Il est parfaitement
  lisible (c'est le prix payé pour les 7,02 et 5,09 du bouton principal) mais il
  lit plus « sépia » que « ambre » : les deux thèmes ne se ressemblent pas
  autant que leurs variables le laissent croire. À arbitrer, pas à corriger.
- **Le fond des encadrés d'explication est effectivement invisible en clair**,
  comme annoncé : seul le filet à gauche fait exister le bloc. Vu, et ça
  fonctionne.

Reste hors de portée d'un regard : la notice, jamais ouverte à l'écran, et dont
le relevé du 17 août dit qu'elle n'a pas l'identité visuelle de l'app.

### Le vrai flux de connexion Spotify n'a jamais été joué

L'app sait renvoyer l'utilisateur vers Spotify puis récupérer sa réponse, mais
cette mécanique n'a jamais tourné en conditions réelles. Ce qui est exercé par
les tests, c'est **une seule branche** : celle où aucune connexion n'est en
cours, c'est-à-dire le cas où il n'y a rien à faire.

Tout le reste est supposé : le retour effectif depuis le navigateur, un jeton
refusé, un jeton expiré, un utilisateur qui refuse l'autorisation, une fenêtre
fermée en cours de route, deux connexions lancées coup sur coup, la pagination
sur un compte qui a beaucoup de playlists, et les quotas de l'API.

**Pourquoi ça compte.** C'est la porte d'entrée de la fonction principale. Une
panne ici ne dégrade pas l'app, elle l'empêche de servir — et le message d'erreur
que verrait l'utilisateur n'a lui non plus jamais été vu.

**Ce qu'il faudrait pour le lever :** une vraie connexion, avec un vrai compte,
sur le Mac. Puis écrire ce qui s'est réellement passé, ici même.

**Toujours ouvert au 19 août 2026.** L'app tourne sur le Mac, mais l'API Web de
Spotify n'y est pas activée : `/api/spotify/etat` répond `actif: false`,
`clientIdRenseigné: false`, `connecté: false`. Il n'y a donc rien à observer
tant que Pym n'a pas saisi son identifiant d'application — c'est le seul angle
mort de cette liste qui demande un geste de sa part, et non du temps machine.
À noter : le téléchargement, lui, ne passe pas par là. Les identifiants que
zotify utilise sont les siens, déjà en place
(`~/Library/Application Support/Zotify/credentials.json`), et ils fonctionnent.

### ~~zotify réel~~ — levé le 19 août 2026

zotify 0.17.4 a tourné trois fois et livré 17 titres. Le format de sa sortie,
son code de sortie menteur, son comportement sur une piste indisponible : tout
est vérifié, et consigné dans le relevé daté plus bas. Ce que ça a coûté est
dans « Défauts constatés » : la doublure acceptait des lignes que le vrai zotify
n'écrit pas de cette façon, et laissait passer celles qu'il écrit vraiment.

Ce qui n'a **pas** été vu, et qui reste supposé : une limitation de débit
Spotify, un compte sans Premium, un rattrapage long (le plus long a duré
20 minutes, pas 17 heures), et la veille du Mac pendant une synchronisation.

### ~~Un vrai Mac~~ — levé le 19 août 2026

Le paquet 1.0.7 est installé sur `~/Desktop/Zotijean.app`, lancé par
double-clic, et il tourne : coquille de barre des menus, moteur Node 22.14.0 en
sous-processus, environnement Python créé et zotify installé au premier
démarrage en 4 secondes. Diagnostic complet au vert sur la machine réelle —
zotify 0.17.4, ffmpeg 9.0 embarqué, identifiants Spotify présents, dossier de
musique accessible avec 27,2 Go libres.

**Détail qui contredit une hypothèse du projet** : l'écran de ce Mac rend à une
densité de **1×**, pas 2×. Les traits d'un pixel y sont donc *plus fins* que sur
le poste de développement où tout a été jugé à 1,5×, et non « un tiers plus
marqués » comme le craignait le relevé du 17 août.

---

## Relevés datés

### 21 août 2026 — deuxième épreuve de la suite par mutation

**33 cassages, tous appliqués, 24 attrapés, 9 survivants.** Menée dans une copie
du dépôt, jamais dans le dossier de travail. Dispositif prouvé avant de conclure :
`cléComparaison` rendue constante fait tomber 5 tests.

Un résultat qui se lit d'un coup d'œil :

| module | cassages | survivants |
|---|---|---|
| `correspondance.js` | 4 | **0** |
| `organisation.js` | 5 | **0** |
| `planificateur.js` | 4 | **0** |
| `conversion.js` | 6 | 1 |
| `achats.js` | 5 | 1 |
| `chemins.js` | 4 | 2 |
| **`spotify.js`** | **5** | **5** |

Les quatre modules éprouvés le 17 août tiennent : aucun cassage n'y survit, sauf
ceux que ce relevé-là avait déjà nommés. L'épreuve confirme donc sa propre
prédiction, ce qui est le meilleur signe qu'elle mesure quelque chose.

**Et le correctif phare de la 1.1.0 est gardé** : remettre `-map_metadata 0` à la
place de `0:s:0` fait tomber un test. Les étiquettes ne se reperdront pas en
silence.

Les neuf survivants sont **tous** de la même cause — *un test manque*. Aucun code
mort, aucun cassage équivalent : les neuf fonctions ont des appelants vivants, et
les neuf cassages changent réellement le comportement. Et **les neuf se bouchent
par des tests seuls, sans toucher au moteur** : `ZOTIJEAN_DONNEES` redirige déjà
le fichier de jetons (trois fichiers de test s'en servent), `globalThis.fetch` se
remplace dans un test, et `tests/diagnostic.test.js:34` porte déjà le helper
`sur(système, travail)` qui force `process.platform`.

#### `src/spotify.js` — cinq cassages, cinq survivants

Le module de l'authentification Spotify n'est protégé par rien. Ses deux seuls
tests couvrent des fonctions pures (`normaliserPistes`, `lireRetryAfter`).

- **Un état PKCE qui ne correspond pas est accepté** (`:142`, `if (état !==
  demandeEnCours.état)` remplacé par `if (false)`). C'est le contrôle qui empêche
  un tiers de faire aboutir SA connexion dans l'app de l'utilisateur. Le
  commentaire juste au-dessus le dit — rien ne le vérifie.
- **Le repli sur l'ancien jeton de rafraîchissement disparaît** (`:278`,
  `données.refresh_token || jetons.refresh_token` réduit au premier terme).
  Spotify ne renvoie pas toujours un nouveau jeton : sans ce repli, l'utilisateur
  est déconnecté au premier rafraîchissement. Le commentaire l'annonce mot pour
  mot.
- **Une révocation n'est plus jamais définitive** (`:254`, `définitif` forcé à
  `false`). L'app afficherait « connecté » pendant que plus rien ne fonctionne —
  exactement le défaut que ce code a été écrit pour corriger.
- **`estConnecté` ignore une autorisation révoquée** (`:74`).
- **La marge d'une minute avant expiration disparaît** (`:212`), donc un jeton qui
  expire pendant la requête produit une erreur incompréhensible.

Les tests à écrire tiennent dans un fichier, sur ce patron :

```js
// En tête de fichier, AVANT d'importer src/spotify.js — le module lit le
// dossier de données à l'import.
process.env.ZOTIJEAN_DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-spotify-'));

function avecFetch(réponses, travail) {
  const vrai = globalThis.fetch;
  let appel = 0;
  globalThis.fetch = async () => réponses[appel++];
  try { return travail(); } finally { globalThis.fetch = vrai; }
}
const réponse = (status, corps, entêtes = {}) => ({
  ok: status < 400, status,
  json: async () => corps,
  headers: { get: (n) => entêtes[n.toLowerCase()] ?? null },
});

test('une réponse dont l’état ne correspond pas à la demande est refusée', async () => {
  await préparerConnexion({ clientId: 'abc', redirection: 'http://127.0.0.1:8787/retour' });
  const r = await terminerConnexion('un-code', 'PAS-LE-BON-ETAT');
  assert.equal(r.réussi, false,
    'un tiers peut faire aboutir sa propre connexion dans l’app de l’utilisateur');
});

test('un rafraîchissement sans nouveau jeton garde l’ancien', async () => {
  écrireJetonsDeTest({ refresh_token: 'ANCIEN', access_token: 'a', expire_le: 0 });
  await avecFetch([réponse(200, { access_token: 'nouveau', expires_in: 3600 })],
    () => forcerRafraîchissement());
  assert.equal(lireJetonsDeTest().refresh_token, 'ANCIEN',
    'l’utilisateur est déconnecté au premier rafraîchissement');
});

test('un invalid_grant pose la reconnexion nécessaire, une panne passagère non', async () => {
  écrireJetonsDeTest({ refresh_token: 'R', access_token: 'a', expire_le: 0 });
  await avecFetch([réponse(400, { error: 'invalid_grant' })], () => forcerRafraîchissement());
  assert.equal(reconnexionNécessaire(), true,
    'l’app affichera « connecté » pendant que plus rien ne fonctionne');
  assert.equal(estConnecté(), false, 'estConnecté doit refuser une autorisation révoquée');

  écrireJetonsDeTest({ refresh_token: 'R', access_token: 'a', expire_le: 0 });
  await avecFetch([réponse(503, {})], () => forcerRafraîchissement());
  assert.equal(reconnexionNécessaire(), false,
    'une panne passagère ne doit pas exiger une reconnexion');
});

test('un jeton qui expire dans trente secondes est rafraîchi, pas réutilisé', async () => {
  écrireJetonsDeTest({ refresh_token: 'R', access_token: 'presque-mort',
    expire_le: Date.now() + 30_000 });
  let rafraîchi = false;
  await avecFetch([réponse(200, { access_token: 'frais', expires_in: 3600 })],
    async () => { rafraîchi = true; await profil(); });
  assert.ok(rafraîchi, 'le jeton expire pendant la requête, l’erreur sera incompréhensible');
});
```

*(`écrireJetonsDeTest` / `lireJetonsDeTest` écrivent et relisent
`spotify.json` dans `ZOTIJEAN_DONNEES` — `écrireJetons` n'est pas exportée.
`forcerRafraîchissement` passe par une fonction publique qui appelle
`jetonValable`, par exemple `profil()`.)*

#### `src/chemins.js` — les deux garde-fous du disque, jamais testés

- **`volumeMonté` rend toujours « oui »** (`:242`) : aucun test ne tombe. C'est le
  garde-fou que `CLAUDE.md` déclare non négociable, celui du disque externe
  débranché que macOS remplace par un dossier fantôme sous `/Volumes/`.
- **`espaceLibre` rend toujours une valeur énorme** (`:274`) : aucun test ne
  tombe non plus.

Le dégât de `volumeMonté` est le plus lourd du projet : faux positif, et deux
mille titres partent sur le disque de démarrage ; faux négatif, et plus aucune
synchronisation ne démarre. Le test doit forcer la plateforme, parce qu'un test
qui hérite de `process.platform` passe ici et échoue sur le Mac.

```js
// Le helper existe déjà : tests/diagnostic.test.js:34.
test('un dossier fantôme sous /Volumes n’est PAS pris pour un disque monté', (t) => {
  sur('darwin', () => {
    // Débranché : macOS a recréé un dossier vide, qui partage donc le
    // périphérique de la racine. C'est le SEUL signe.
    t.mock.method(fs, 'statSync', () => ({ dev: 16777220 }));
    assert.equal(volumeMonté('/Volumes/DJ-SSD/Musique/Été 2026'), false,
      'toute la bibliothèque se serait retéléchargée sur le disque de démarrage');
  });
});

test('un volume réellement monté est reconnu', (t) => {
  sur('darwin', () => {
    t.mock.method(fs, 'statSync', (c) => ({ dev: c === '/' ? 16777220 : 16777235 }));
    assert.equal(volumeMonté('/Volumes/DJ-SSD/Musique'), true,
      'un disque bien branché est refusé : plus aucune synchronisation ne part');
  });
});

test('le disque de démarrage n’est jamais refusé', () => {
  sur('darwin', () => assert.equal(volumeMonté('/Users/pym/Music'), true));
});

test('un /Volumes sans nom de volume est refusé', () => {
  sur('darwin', () => assert.equal(volumeMonté('/Volumes'), false));
});

test('espaceLibre rend des octets réels, pas une promesse', () => {
  assert.ok(espaceLibre(os.tmpdir()) > 0,
    'si statfsSync change de nom, les deux garde-fous « disque plein » '
    + 's’éteignent sans qu’un seul test rougisse');
});
```

#### `src/conversion.js` — le rapport d'un quart, déjà signalé le 17 août

Porter `octetsCible > octetsSource * 0.25` à `* 0.9` (`:182`) survit encore.
Ce n'est pas une régression : le relevé du 17 août 2026 nommait déjà cette borne
parmi les trois non épinglées. Elle le reste.

Les deux autres bornes de cette fonction sont en revanche mieux tenues qu'alors :
supprimer le plancher de 16 Ko et passer le sans-perte de `>` à `>=` font tomber
un test chacun.

```js
test('le rapport minimal d’un converti avec perte est épinglé, pas approximatif', () => {
  // Un MP3 320 tiré d'un Ogg 320 pèse environ autant : la garde doit accepter
  // le cas normal ET refuser un fichier coupé.
  assert.equal(tailleplausible(5_000_000, 4_000_000, 'mp3_320'), true);
  assert.equal(tailleplausible(5_000_000, 1_000_000, 'mp3_320'), false,
    'un fichier au cinquième de sa source passe pour plausible');
});
```

#### `src/achats.js` — un seul enregistrement MusicBrainz examiné au lieu de deux

`enregistrements.slice(0, 2)` réduit à `slice(0, 1)` (`:533`) ne fait tomber
aucun test : aucune doublure ne renvoie deux enregistrements pour un même ISRC.

C'est **exactement le cas limite** que la spécification d'origine exigeait — « le
rapport doit dire lequel il a retenu plutôt que d'en choisir un en silence » — et
que le successeur `docs/specs/racheter-en-sans-perte.md` ne reprend pas. Le
rapport nomme bien la sortie retenue et liste jusqu'à trois alternatives, donc il
ne choisit pas tout à fait en silence ; mais il écarte silencieusement tout
enregistrement au-delà du deuxième, et rien ne le dit.

```js
test('deux enregistrements pour un même ISRC sont tous deux examinés', async () => {
  const http = doublure({
    // Deux enregistrements : le premier sans lien d'achat, le second avec.
    'recording?query=isrc': { recordings: [ENREG_SANS_LIEN, ENREG_AVEC_BANDCAMP] },
  });
  const r = await résoudreSurMusicBrainz(PISTE, { transport: créerTransport({ http }) });
  assert.equal(r?.boutique, 'Bandcamp',
    'le second enregistrement est écarté en silence : le morceau est annoncé '
    + 'sans lien alors qu’il en a un');
});
```

#### Ce que cette campagne n'a pas éprouvé

- **`src/synchronisation.js`**, où vivent les deux pires bloquants de l'audit du
  même jour, n'était pas dans la liste. Sa couverture locale est de 21 % et ses
  18 tests d'intégration sont éteints sur le PC Windows : une campagne y demande
  un runner macOS.
- **`src/zotify.js`**, `src/diagnostic.js`, `src/api.js`, `src/analyse.js`,
  `src/exports-dj.js`, `src/securite.js` : jamais éprouvés, ni le 17 août ni ici.
- **Les points d'USAGE**, encore une fois. Cette campagne a muté des fonctions.
  L'angle mort déclaré du 17 août reste entier : un appelant qui oublierait
  d'appeler la garde ne serait attrapé par aucun de ces 33 cassages.

### 21 août 2026 — audit de fond du programme entier, après la fusion de la 1.1.0

Premier audit depuis la 1.0.7, sur les 22 600 lignes du projet et non sur un
diff. Trois agents — architecture, couverture de tests, interface — plus une
confrontation de ce fichier-ci au code réel. **Chaque constat ci-dessous a été
revérifié à la main avant d'être écrit** ; deux affirmations d'agent ont été
écartées pour cette raison (voir la fin de ce relevé).

Le fil commun de ce qui suit est le même qu'en 1.1.0, et c'est ce qui rend ces
défauts difficiles à voir : **chaque pièce fonctionne.** Ce qui casse, c'est ce
qu'une pièce croit de sa voisine.

> **Les sept bloquants ont été corrigés le jour même**, branche
> `fix/bloquants-de-l-audit`. Ils restent écrits ici en entier — le constat, la
> chaîne exacte et la conséquence — parce que c'est le RAISONNEMENT qui vaut
> d'être gardé, pas la ligne de code. Chaque correctif porte sa reproduction :
> les huit points de dette qui suivent, eux, restent ouverts.
>
> Trois des sept bloquants avaient exactement la même forme, et c'est la leçon
> générale de cet audit : **un succès ne se déduit pas d'une absence d'erreur
> connue.** zotify meurt muet, le chien de garde mord, ffmpeg répond n'importe
> quoi — dans les trois cas le code concluait « tout va bien » parce qu'aucun
> signal qu'il *sait lire* n'était arrivé. Le correctif n'est jamais d'ajouter un
> motif d'erreur de plus : c'est d'exiger une preuve positive.
>
> **Un seul test ne peut pas être vérifié depuis le PC Windows** : celui qui
> garde le CHAÎNAGE du premier bloquant (`tests/synchronisation.test.js`, « un
> zotify qui meurt sans rien dire n'avance PAS la date de référence »). Il porte
> la garde `SAUTER` comme les dix-huit autres tests d'intégration, et ne s'exécute
> que sur les serveurs macOS et Linux. Sa pièce, elle, est éprouvée partout
> (`tests/zotify.test.js`).

---

#### BLOQUANT — Une synchronisation totalement ratée compte comme un succès

Le plus grave de tout l'audit, et le seul dont la conséquence est *indéfinie*.

Quand zotify se lance et meurt sans écrire une ligne — environnement Python
abîmé, bibliothèque manquante, `.app` déplacé, quarantaine Gatekeeper — la
chaîne se déroule ainsi :

- `télécharger` (`src/zotify.js:1012`) résout `{ lancé: true, erreurs: [], nouveaux: [] }`.
- `src/synchronisation.js:528` → `lignesSignalées = []` → `titresPerdus = 0`.
- `interrompu` est faux, `expiré` est faux.
- **`bilan.échec` n'est renseigné nulle part pour ce cas.** Ses cinq points
  d'affectation sont `:250` (diagnostic bloquant), `:358` (disque débranché),
  `:448` (réglage bloquant), `:540` (connexion requise) et `:746` (exception).
  Aucun ne couvre « zotify s'est lancé et a échoué ».
- Donc `:700` `if (!bilan.interrompu && !bilan.échec)` → `marquerSuccès()`, qui
  avance `dernierSuccès` **et remet `échecsConsécutifs` à zéro**
  (`src/etat.js:118`).

Pire encore : `:585` enregistre bien `échec: résultat.lancé ? null : ...`, mais
dans la fiche de la playlist, pas dans `bilan.échec`. **Même un lanceur
introuvable passe donc pour un succès.**

Ce que l'utilisateur voit : « Aucune nouveauté », pastille verte, notification
rassurante. L'app attend 48 h, recommence, réaffiche « Aucune nouveauté ».
Indéfiniment, sans un seul signal. Le recul après échecs — écrit précisément
pour ce cas — ne s'enclenche jamais.

C'est le défaut de la 1.0.5 remonté d'un étage : rien n'est perdu, rien n'est
jamais téléchargé. Aucun test ne couvre `lancé === false` ni « sortie non nulle
et muette ».

#### BLOQUANT — Une expiration du chien de garde compte aussi comme un succès

Même mécanique, chemin plus fréquent. `expiré` n'apparaît que deux fois dans
`src/synchronisation.js` : `:610` pour calculer `alléAuBout`, et `:617` pour une
note de playlist. **Il n'atteint jamais `bilan.interrompu`.** Donc `:700`
marque un succès.

Wi-Fi coupé à 3 h du matin, zotify figé sur une socket morte, le chien de garde
le tue au bout de quinze minutes : zéro fichier, « Aucune nouveauté », date de
référence avancée de 48 h. Le cas `connexionRequise` est traité (`:540`) ; le
cas « réseau mort » ne l'est pas.

Correctif : une ligne à `:532`, `if (résultat.interrompu || résultat.expiré)`.

#### BLOQUANT — Un ffmpeg cassé passe le diagnostic au vert

`src/diagnostic.js:165` lance `ffmpeg -version` puis rend `GRAVITÉ.OK` sans
jamais examiner `résultat.code`, `résultat.erreur` ni `résultat.expiré`. Tout
fichier exécutable nommé `ffmpeg` dans le PATH enrichi passe le contrôle — y
compris un binaire de la mauvaise architecture, ou dont une bibliothèque
dynamique manque.

Conséquence : c'est le garde-fou que `CLAUDE.md` déclare non négociable, parce
que sans ffmpeg **zotify renomme le fichier avant de découvrir son absence et ne
le restaure jamais** — des morceaux détruits sans message. Le contrôle laisse
donc passer exactement le cas qu'il existe pour attraper.

Correctif : trois lignes. `contrôlerZotify`, `contrôlerFfmpeg`,
`contrôlerDestination`, `contrôlerIncomplets` et `contrôlerReprise` n'ont aucun
test direct — 28,6 % de couverture de fonctions sur le module qui décide si l'on
a le droit de télécharger.

#### BLOQUANT — Le garde-fou « disque débranché » ne se relit qu'une fois par playlist

La boucle des playlists est en `src/synchronisation.js:337`. Les trois contrôles
— `volumeMonté` (`:357`), `espaceLibre` (`:368`), `conditionToujoursRemplie`
(`:384`) — sont dedans, **avant** `télécharger` (`:496`). Rien ne les relit
ensuite.

Le commentaire de `:364` promet pourtant : « Le disque se remplit AU FIL de
l'exécution […] Sans cette relecture, zotify continuerait d'écrire sur un disque
plein ». La relecture existe — à la granularité de la playlist. Avec les chiffres
du projet (2 000 titres à 30 s), **une playlist unique dure 16,7 h et le contrôle
est fait une seule fois, à H+0**.

Conséquence, celle que `CLAUDE.md` nomme comme cause n° 1 : disque externe
débranché à H+3, macOS recrée un dossier vide sous `/Volumes/`, et treize heures
de musique partent sur le disque de démarrage sans un mot.

Le point d'accroche existe déjà : le rappel `surÉvénement` (`:501`) est appelé à
chaque ligne de zotify. Un contrôle limité à une fois toutes les cinq minutes y
coûte un `statfs`.

#### BLOQUANT — Fermer l'app pendant une conversion laisse un fichier fantôme, compté comme un morceau

Cinq faits, chacun correct, dont la rencontre casse :

1. La conversion continue **délibérément** après un arrêt
   (`src/conversion.js:440`) — c'est le correctif des treize fichiers coincés
   en Ogg.
2. Mais toute fermeture finit par `process.exit(0)` à cinq secondes
   (`server.js:533`), parce que le flux d'événements en `keep-alive`
   (`server.js:111`) empêche `serveur.close()` de rendre la main tant qu'un
   onglet est ouvert. Ce n'est donc pas un cas de coin : **c'est le chemin de
   fermeture normal.**
3. Le fichier en cours s'appelle `.Titre.1234.tmp.flac` (`conversion.js:227`) et
   n'est renommé qu'à `:279`, ce qui n'arrive jamais.
4. Aucun des deux balayages ne le ramasse : `nettoyerRestesTemporaires` ne prend
   que ce qui **finit** par `.tmp` (`zotify.js:676`), et le rattrapage de
   conversion ne regarde que les `.ogg` (`conversion.js:423`).
5. `listerAudio` (`bibliotheque.js:64`) le **compte**, parce qu'il filtre sur
   l'extension seule sans écarter les noms commençant par un point.

Conséquence : un fichier invisible dans le Finder qui entre dans la liste de
lecture, l'export Rekordbox, l'export Serato et le rapport des rachats. C'est mot
pour mot le scénario que `zotify.js:692` décrit et prévient — pour les
téléchargements, jamais pour les conversions.

*Établi par lecture des cinq chemins, pas par observation : ffmpeg n'est pas sur
le poste de développement.*

#### BLOQUANT — Le retrait des sources contourne la seule protection NFC du projet

`src/organisation.js:186` promet, en toutes lettres : « Toute comparaison de
chemins dans le projet passe par ici — c'est la seule protection contre le piège
NFC/NFD. »

`src/synchronisation.js:848` ne passe pas par là :

```js
const retirables = réussis.filter(({ source }) => inscrits.has(path.resolve(source)));
```

`inscrits` sort de `cheminsDéjàTéléchargés` (`zotify.js:587`), qui lit le journal
`.song_archive` **écrit par Python** et rend ses chaînes brutes. C'est le seul
endroit de tout le projet où une chaîne produite par un autre runtime est
comparée à une chaîne produite par `readdirSync` — la définition exacte du piège
que `CLAUDE.md` désigne comme « la cause numéro un de retéléchargements infinis
dans une bibliothèque francophone ».

Le sens du dégât est heureusement le sens sûr : si la comparaison échoue, aucune
source n'est retirée. Mais alors **la politique de retrait ne s'applique jamais**,
et `:852` affiche un message devenu faux (« ils ont été téléchargés avant la mise
en service du journal »). L'utilisateur a posé « Corbeille » et l'app le lui
reprend en silence : c'est le défaut du 19 août que la 1.1.0 était censée fermer.

**Et la doublure ne peut structurellement pas le montrer** : `aide-faux-zotify.js`
inscrit au journal la même chaîne JavaScript qu'il vient de passer à
`writeFileSync`. Les deux côtés sont identiques par construction. Les deux tests
qui gardent cette mécanique emploient pourtant des titres accentués — « Été
2026 », « Étienne de Crécy » —, ce qui donne l'illusion que le cas est couvert.

#### BLOQUANT — L'interface enseigne activement qu'un compte gratuit suffit

Voir la question ouverte plus bas : **ce point attend un arbitrage factuel de
Pym** avant d'être corrigé, parce que la correction dépend de la réponse.

Cinq textes, cohérents entre eux, construisent le modèle mental
*Premium = meilleure qualité, gratuit = qualité moindre mais ça marche* :

- `src/options.js:33` — « Exige un abonnement Premium : sans lui, Spotify
  redescend silencieusement à 160 kb/s. »
- `src/options.js:41` — « **La qualité d'un compte gratuit.** »
- `public/notice.html:37` — « Premium pour la meilleure qualité. Sans Premium,
  Spotify plafonne à 160 kb/s sans le dire. »
- `README.md:82` — même formulation.
- `CLAUDE.md:88` — « Le plafond est l'Ogg Vorbis 320 kb/s, et il exige Spotify
  Premium. »

Le pire endroit est le message d'erreur `src/erreurs.js:65`, motif
`/premium|subscription required/i`, dont le geste conseillé est : « **Passez la
qualité sur « Élevée » dans Qualité** ». Si Premium est requis toujours, c'est le
seul message qui interceptera l'échec de l'utilisateur, et il l'envoie dans le
mur : il baisse la qualité, relance, et perd une seconde exécution.

Réciproque vérifiée : les **cinq écrans de l'assistant de premier lancement** ne
mentionnent Premium qu'une fois (`public/app.js:1663`), et pour parler de ce que
l'utilisateur ne peut **pas** avoir (le sans-perte Spotify). La seule mention
avant le premier téléchargement présuppose qu'il est déjà abonné.

Deux libellés quasi identiques désignent par ailleurs deux choses opposées : la
ligne « Connexion Spotify » du Diagnostic parle des identifiants **zotify**,
pendant que la carte « Compte Spotify » de Playlists parle de l'**API Web**.

À la décharge de l'interface : la carte de `app.js:1151` dit bien « Cela expose
un second compte en plus de votre compte d'écoute ». La distinction existe — elle
arrive au deuxième paragraphe, après le mot « Facultatif ».

---

#### Le rapport des rachats ne peut pas être arrêté, et l'interface promet une issue qui n'existe pas

`src/api.js:565` appelle `produireRapport(config(), { surProgrès })` —
**`arrêtDemandé` n'est jamais passé**. Il garde son défaut `() => false`
(`achats.js:1001`), donc le `break` de `achats.js:675` ne peut jamais s'exécuter,
donc `interrompu` vaut structurellement `false`.

Cette phrase de `public/app.js:1561` est donc inatteignable :

> « Recherche interrompue — ce qui est trouvé est conservé, relancer reprendra la suite. »

Toute la mécanique de reprise existe et est testée. Elle n'est pas branchée.
`index.html:238` ne contient qu'une barre et une ligne — aucun bouton Arrêter —
et `src/api.js` n'expose aucun point d'entrée d'annulation. Sur 2 000 titres,
c'est une heure quarante sans porte de sortie, et la seule issue est de quitter
l'app, ce qui déclenche le fichier fantôme ci-dessus.

Deux points de la même famille, établis par lecture : `#progression-achats`
démarre `hidden` et rien ne le rouvre au chargement, contrairement à la
synchronisation (`app.js:144`) ; et aucun verrou ne protège le rapport, alors que
la règle du projet est « une seule exécution à la fois ».

#### Ouvrir la page lance un `ffprobe` par fichier de la bibliothèque

`src/achats.js:956` appelle `lireMétadonnées(fichier)` dans une boucle
séquentielle, à chaque `GET /api/achats/estimation`. Or cette fonction
(`exports-dj.js:39`) **accepte déjà un binaire ffprobe en second argument** — et
aucun de ses deux appelants ne s'en sert. Pire, `trouverExécutable`
(`processus.js:106`) **ne met rien en cache** : il reparcourt tout le PATH à
chaque fichier.

Mesuré : 62 ms par aller-retour de spawn. À 2 000 titres, deux minutes de
processus à chaque chargement de page — y compris pendant les 17 h de
synchronisation, où la page reste précisément ouverte pour regarder la
progression, en concurrence avec les conversions que `conversion.js:296`
sérialise justement « pour ne pas disputer le disque au pire moment ».

Invisible aujourd'hui : la bibliothèque réelle fait 17 morceaux. `estimerRapport`
n'a besoin que d'un compte de fichiers ; seul `nbAvecISRC` exige ffprobe, et il
peut s'annoncer inconnu.

#### Une erreur de syntaxe dans la palette mange une couleur du thème clair

`public/palette.css:163`, dans `:root[data-theme="light"]` :

```css
  --bord-vif:      #d0d5dc;
  --fond, la plus foncée. Une teinte déduite par symétrie tomberait sous le
  --bord-controle: #81868f;
```

Un fragment du commentaire de la ligne 109, recopié sans son `/*`. Le parseur
avale la déclaration malformée **et celle qui suit** : `--bord-controle` est
absent du bloc, vérifié dans le navigateur (18 déclarations au lieu de 19).

**Sans conséquence aujourd'hui, pour une raison qui est elle-même un défaut :
la bascule manuelle de thème n'existe pas.** Aucun code du dépôt ne pose
`data-theme` — vérifié sur `public/` entier. Or `palette.css:23` et
`tests/contraste.test.js:421` affirment tous deux que « la notice offre une
bascule manuelle qui pose data-theme ». Soit une quarantaine de lignes de CSS
qui ne s'appliquent jamais, un commentaire qui décrit une fonctionnalité absente,
et un test qui garde le tout.

Et le test ne pouvait pas l'attraper : il extrait les noms de variables par une
expression régulière sur le texte source, qui trouve `--bord-controle` dans la
ligne cassée. Il ne peut structurellement pas voir qu'un navigateur l'a jetée.
C'est la leçon du projet — « un détecteur qui ne trouve rien doit d'abord prouver
qu'il trouve » — appliquée au détecteur lui-même.

#### Trois récits contradictoires sur la provenance de zotify

Trois textes, tous affichés, tous incompatibles :

| Où | Ce qui est écrit |
|---|---|
| `public/notice.html:26` | « le moteur, Python, ffmpeg et zotify **voyagent dans l'application**. Vous n'installez rien, vous ne tapez aucune commande. » |
| `public/app.js:1588` (assistant, écran 1) | « il pilote **votre installation de zotify, celle que vous utilisez déjà**. » |
| Diagnostic, vu à l'écran | « zotify est introuvable. Vérifiez qu'il répond en tapant **« zotify --version » dans le Terminal**. » |

Pour le paquet macOS livré, seul le premier est vrai. L'écran 1 de l'assistant
date d'avant l'empaquetage. Le `README.md` porte la même contradiction : « il
pilote votre installation de zotify, qui doit déjà être installée » vingt lignes
avant « l'application embarque Node.js, Python, ffmpeg et zotify ».

Conséquence : le premier message d'erreur qu'un non-développeur rencontrera lui
demande d'ouvrir un Terminal, dans une application qui vient de lui promettre le
contraire.

#### Un lien de playlist manifestement faux est accepté sans broncher

Testé à l'écran : `https://open.spotify.com/playlist/ZZZZ` → notification verte
« Playlist ajoutée. », et la ligne apparaît sous SURVEILLÉES.

Cause : `src/api.js:63`, `([A-Za-z0-9]+)` accepte un identifiant d'**un seul
caractère**, quand un identifiant Spotify en fait exactement 22.

Conséquence : un lien tronqué par un copier-coller raté est confirmé comme
valide, donc l'utilisateur n'y revient pas, et découvre au bout de 48 h — ou
jamais — que rien n'en est descendu. Le cas franchement invalide, lui, est très
bien traité, avec un message rattaché au bon champ.

#### `volumeMonté` et `espaceLibre` n'ont aucun test, dans aucune branche

`grep -rn "volumeMonté\|espaceLibre" tests/` ne rend **rien**. Couverture :
`src/chemins.js:243-282` jamais exécuté.

Et même sur le Mac de la chaîne d'intégration, la branche dangereuse n'est jamais
atteinte : les tests d'intégration travaillent dans `os.tmpdir()`, soit
`/var/folders/…`, qui sort au `return true` de la ligne 255. **La comparaison de
`dev` qui distingue un vrai volume d'un dossier fantôme n'a jamais tourné nulle
part.**

`espaceLibre` rend `null` sur toute exception, et ses deux appelants écrivent
`if (libre !== null && …)`. Si `fs.statfsSync` change de nom, les deux garde-fous
« disque plein » s'éteignent **sans qu'un seul test rougisse**.

#### L'assistant de premier lancement est inatteignable au clavier

Mesuré sur une page fraîchement chargée, modale ouverte : `document.activeElement`
vaut `<body>` — le focus n'entre jamais dans la boîte de dialogue. L'arrière-plan
n'est ni `inert` ni `aria-hidden`. L'ordre de tabulation compte **huit arrêts sur
des commandes invisibles** avant d'atteindre « Passer la configuration ».

`aria-modal="true"` est bien posé (`index.html:418`) mais ne parle qu'aux
lecteurs d'écran.

---

#### Trouvé en corrigeant, et laissé en place

**Une garde inatteignable dans `volumeMonté`** (`src/chemins.js:258`). Découvert
en écrivant son test : `if (segments.length < 2) return false;` ne peut jamais
s'exécuter. Pour arriver là, il faut avoir passé `résolu.startsWith('/Volumes/')`
— donc avoir au moins deux segments. Et `/Volumes` tout seul ne passe pas ce
test de préfixe : il est traité comme le disque de démarrage, et rend `true`.

Sans conséquence : personne ne range sa bibliothèque dans `/Volumes` lui-même.
Laissée en place parce que la retirer ne changerait aucun comportement, et que le
test qui l'entoure documente désormais la vraie frontière. À savoir si l'on
touche un jour à cette fonction.

#### Dette assumable — relevée, pas corrigée

- **`appliquerPolitiqueRetrait` (`bibliotheque.js:204`) : 62 lignes, 6 tests,
  zéro appelant.** Le vrai chemin de retrait est le bloc en ligne de
  `synchronisation.js:845`, dont le garde-fou a une structure *différente*
  (appartenance au journal, pas de ratio à 50 %). Deux implémentations
  divergentes attendent le jour où l'on branchera la politique. Six tests verts
  qui ne protègent aucun octet.
- **`src/api.js` n'a aucun fichier de test** — 600 lignes, 37 % de couverture de
  fonctions. `PUT /api/config` (`:215`) porte un commentaire décrivant un défaut
  qui a déjà effacé la liste des playlists d'un utilisateur ; sa correction tient
  en deux lignes (`:247`) et **rien ne l'épingle**. Idem pour
  `POST /api/spotify/suivre` (`:372`).
- **`tests/energie.test.js:60` ne peut pas échouer** : son corps est enveloppé
  dans `if (résultat !== null)`, et `conditionToujoursRemplie` rend `null` sous
  Windows comme sur un runner macOS branché. Ce test n'a jamais exécuté une seule
  assertion, sur aucune machine — et les deux branches qu'il prétend garder,
  celles qui *arrêtent* une synchronisation en itinérance, ne sont pas couvertes.
- **`tests/exports-dj.test.js:313` hérite de `process.platform`**, alors que le
  dépôt a déjà l'outil pour l'éviter (`tests/diagnostic.test.js:34`, `sur()`).
  Même famille : `tests/organisation.test.js` assertions sur `path.sep`.
- **Six clés de `bilan` calculées, persistées, envoyées au navigateur et lues par
  personne** : `nbConvertis`, `rattrapés`, `àReprendre`, `déjàPrêts`,
  `sourcesTraitées`, `diagnostics` — zéro occurrence dans `public/app.js`.
- **Le verrou écrit `date` (`synchronisation.js:87`) et ne la relit jamais.** La
  seule péremption est `processusVivant(pid)`. Sur réutilisation de PID après un
  `kill -9`, l'app reste bloquée sur « Une autre instance semble déjà en train de
  synchroniser », et il faut supprimer un fichier à la main — hors de portée de
  l'utilisateur cible.
- **`écrireAtomique` (`chemins.js:165`) ne fait aucun `fsync`**, ni du fichier ni
  du répertoire, alors que son commentaire promet « soit l'ancien contenu, soit
  le nouveau ». Vrai en pratique sur APFS ; la garantie écrite reste plus forte
  que le code.
- **Le schéma des URL MusicBrainz n'est pas validé** : `achats.js:539` prend
  `relation.url.resource` tel quel et `:869` l'injecte dans un `href`.
  `échapperHTML` neutralise les guillemets, pas `javascript:`. Donnée éditable
  par la communauté MusicBrainz, rapport ouvert en `file://`.
- **`src/achats.js:78` annonce `Zotijean/1.0.7`** à MusicBrainz, dont la politique
  porte précisément sur cet en-tête. Aucun test ne le relie à `package.json`.
- **`estimerDurée` (`achats.js:737`) code en dur 1,05 s par requête** pendant que
  `RYTHME_MS` (`:81`) vaut 1100 et 1000. Deux nombres découplés, dont l'un est
  une promesse affichée avant une opération d'une heure.
- **Deux options de retrait sans effet restent cochables** (Planification, « quand
  un titre est retiré d'une playlist »). Le texte le dit franchement, mais l'app
  enregistre un choix qui ne fera rien. Et la notice dit du même point « même en
  choisissant d'archiver ou de mettre à la corbeille, rien n'est détruit », ce
  qui laisse croire que ces choix fonctionnent.
- **« Mesuré sur votre bibliothèque » s'affiche sur une bibliothèque vide**
  (`options.js:485`), à trente centimètres de « Aucun morceau dans la
  bibliothèque ». Sur le fond l'interface fait bien : le dénominateur est affiché
  (« 14 sur 17 »), donc rien n'est présenté comme une garantie. Ce qui manque est
  le mot que `docs/specs/racheter-en-sans-perte.md:121` dit et que l'interface
  tait : « les intervalles de confiance à 95 % sont larges ».
- **Un contraste à 4,36 pour 1** sur `.apercu-etiquette` en thème sombre, ligne
  mise en avant de l'aperçu de rangement — un seul mot, 3 % sous le seuil. Le
  test de contraste vérifie `--texte-3` contre les quatre surfaces de la palette,
  pas contre les surfaces teintées.
- **Les sept onglets n'ont aucun état programmatique** : ni `role="tab"`, ni
  `aria-selected`, ni `aria-current`. L'onglet actif se signale par la couleur,
  un fond teinté et une graisse — donc pas par la couleur seule, ce qui sauve
  l'essentiel, mais rien n'est annoncé à un lecteur d'écran.
- **`CHAMPS_SURCHARGEABLES` (`config.js:231`) est du code mort** : zéro référence
  dans `src/`, `server.js`, `public/` et `tests/`.
- **Le seuil « 2 Go » est écrit cinq fois** (`config.js:83`, `diagnostic.js:375`,
  `options.js:577`, `simulation.js:117`, `synchronisation.js:369`) et il existe
  quatre échappeurs HTML/XML distincts dans le dépôt.

#### Ce que ce fichier disait et qui était devenu faux

La confrontation de ce document au code a trouvé trois écarts. Ils sont corrigés
dans les sections concernées ; ils sont écrits ici parce que **c'est le fait
qu'ils existent qui compte**, pas leur contenu.

- **La rainure de la barre de progression** était encore classée « Non corrigé,
  et pour une raison précise » alors que la 1.1.0 l'a corrigée, raisonnement
  écrit dans `public/app.css:220`.
- **`text-wrap: balance`** était situé aux lignes 91 et 106 de `notice.css`. Il
  est aux lignes **80 et 95** : l'extraction de la palette a décalé le fichier.
  Le constat était vrai, ses coordonnées non.
- **Le défaut Node 20** annonce « trois actions, à cinq endroits », puis en liste
  **sept**. Les sept références sont exactes ; c'est le décompte qui est faux.

Et un écart dans `CLAUDE.md` : son bloc « Profil projet » annonce que « le PC
Windows en ignore 13 ». Mesuré le 21 août : **20 ignorés** sur 500 tests. Le
fichier qui interdit de répéter un chiffre en porte un qui a re-vieilli.

Enfin, `CLAUDE.md:51` renvoie au module **`doctor.js`**, qui n'a **jamais existé**
dans l'historique du dépôt — le module s'appelle `src/diagnostic.js`. Mauvais
pointeur dans le seul fichier chargé automatiquement à chaque conversation.

#### Le décompte de la suite, mesuré

`node --test` depuis la racine, sur le PC Windows : **500 tests · 480 verts ·
0 échec · 20 ignorés**. Couverture native : 67,7 % des lignes, 82,8 % des
branches, 69,5 % des fonctions.

Les trous ne sont pas répartis au hasard :

| module | lignes couvertes | remarque |
|---|---|---|
| `src/synchronisation.js` | **21,2 %** | `synchroniser()` ne s'exécute jamais ici |
| `src/analyse.js` | 29,5 % | **0 % de fonctions**, aucun fichier de test |
| `src/diagnostic.js` | 35,9 % | la porte devant tout le reste |
| `src/spotify.js` | 39,4 % | **20 % de fonctions** |
| `src/api.js` | 51,3 % | aucun fichier de test |
| `src/correspondance.js` | 100 % | — |

Les 20 ignorés : 18 dans `tests/synchronisation.test.js` (garde `SAUTER`,
ligne 45), 1 dans `tests/conversion.test.js:306`, 1 dans `tests/chemins.test.js:213`.

**Phrase à retenir, et qui manque au profil du projet : un `node --test` vert sur
le PC Windows ne dit rien du téléchargement, du verrou, de la politique de
retrait, de la liste de lecture, de la conversion au fil de l'eau ni du bouton
Arrêter.** Seules les branches macOS et Linux de la chaîne d'intégration les
exercent.

#### Ce que cet audit n'a PAS pu voir

Obligatoire, et à lire avant d'affirmer que quoi que ce soit « marche ».

- **Aucune image de l'interface.** Le panneau navigateur n'a jamais composé de
  frame : zéro capture d'écran sur toute la revue. Tout jugement visuel de ce
  relevé est une mesure du DOM (`getComputedStyle`, `getBoundingClientRect`), pas
  un regard. Un défaut purement optique — un alignement de travers, une icône
  coupée, un rythme d'espacement irrégulier — est passé sous le nez par
  construction.
- **Safari, et un vrai Mac.** Chromium sous Windows uniquement. Les dégradés,
  `:focus-visible`, `color-mix()` et `:has()` peuvent différer.
- **Le vrai zotify.** Absent du poste : 18 tests d'intégration éteints, aucune
  synchronisation, et **aucun message de `src/erreurs.js` jamais vu à l'écran**.
- **La vraie API Web de Spotify.** Jamais contactée, et **sans couture pour poser
  une doublure** : `src/spotify.js` appelle le `fetch` global à `:152`, `:231` et
  `:342`. Quinze fonctions ne sont exercées par rien, dont `terminerConnexion`,
  `rafraîchir` et la vérification de l'état PKCE.
- **Une vraie bibliothèque.** Zéro fichier, zéro playlist : conversion, politique
  de retrait, exports et rapport de rachat n'ont jamais tourné.
- **Un vrai disque externe débranché en cours de route.** La seule chose qui
  exercerait `chemins.js:242-282`. C'est aussi le scénario dont le dégât est le
  plus lourd de tout le projet.
- **MusicBrainz et Bandcamp en vrai.** `requêteHTTPS` (`achats.js:219`) et le
  limiteur de débit (`:204`) sont du code qui n'existe qu'en production : tous
  les tests injectent un transport.
- **Serato et Rekordbox.** Aucune crate produite par ce dépôt n'a jamais été
  ouverte par le logiciel auquel elle est destinée.

#### Deux affirmations d'agent écartées après vérification

Écrites ici parce qu'elles disent quelque chose sur la méthode, pas sur le code.

Les agents d'architecture **et** de couverture ont tous deux affirmé que le bloc
« Profil projet » de `CLAUDE.md` annonce « 432 tests, 419 verts, 13 ignorés » et
« Node.js 24 ». **C'est faux** : le fichier dit `500 tests` (`:148`) et
`Node.js 22` (`:143`). Les deux travaillaient sur la version d'avant la fusion de
la 1.1.0.

La leçon n'est pas qu'ils se sont trompés — c'est qu'ils se sont trompés **de la
même façon**, et que deux rapports concordants ne valent pas une vérification.
C'est en allant contrôler cette fausse affirmation que le vrai chiffre périmé
(« 13 ignorés » contre 20 mesurés) a été trouvé.

### 19 août 2026 — première mise en service sur le Mac

La 1.0.7 a été installée et lancée sur la machine de destination. Trois
synchronisations réelles, 17 titres téléchargés, puis une passe de mesure dans
Safari. Ce qui suit est ce que la machine a dit, pas ce qu'on attendait d'elle.

#### La suite de tests n'était PAS verte sur le Mac

**Six tests sur 432 tombaient**, tous dans `tests/synchronisation.test.js`,
c'est-à-dire l'unique test d'intégration de bout en bout. Ils passent sur le PC,
ils passent en intégration continue, et ils échouaient sur la seule machine qui
compte.

La cause tient en un mot. Le leurre est lancé par un script `#!/bin/sh` qui fait
`exec node …` — or **ce Mac n'a pas de Node installé** : le paquet embarque le
sien. Le lanceur sortait en 127, le faux zotify ne répondait donc pas à
`--help`, le diagnostic en concluait que cette version de zotify n'accepte aucun
dossier de destination, et la synchronisation était annulée avant de commencer.

Corrigé en passant par `process.execPath`. **432 sur 432 depuis, sur le Mac** —
et 0 ignoré, là où le PC en ignore 13.

La leçon est celle que le fichier `CLAUDE.md` énonce déjà, mais retournée : un
test ne doit pas hériter de `process.platform`, et il ne doit pas non plus
hériter du `PATH`. Le commentaire de ce test affirmait que ces cas « tournent
donc pour de bon sur macOS, qui est la plateforme cible ». Ils y tournaient au
rouge depuis le début.

#### La jauge n'est pas bloquée. La politique ne l'a jamais visée.

C'était le point marqué « à vérifier en priorité sur le Mac ». Réponse mesurée,
dans Safari 16.3 et dans un moteur Chromium :

- `élément.style.width = '73%'` **s'applique** : jauge posée à 73 %, 970,2 px
  mesurés pour 970,2 px attendus. **Aucune violation de politique.**
- `élément.setAttribute('style', …)` **est bloqué**, avec une violation
  `style-src-attr` — mais l'app n'écrit jamais de cette façon.
- L'app réelle, chargée entièrement, ne déclenche **aucune** violation.

`tests/styles-en-ligne.test.js` disait donc vrai, et la phrase du relevé du
17 août qui l'accusait était fausse. La « rafale de messages à chaque
chargement » n'est reproductible sur aucun des deux moteurs de cette machine.

Au passage, la solution de rechange envisagée fonctionne aussi
(`insertRule` sur une feuille servie) : elle n'est simplement pas nécessaire.

#### Ce que Safari 16.3 gère, mesuré et non supposé

| Propriété | Safari 16.3 |
|---|---|
| `:has()`, `:is()`, `:focus-visible` | oui |
| `color-mix()` | oui |
| `backdrop-filter` **sans préfixe** | **non** |
| `-webkit-backdrop-filter` | oui — et `app.css:785` porte bien les deux |
| `accent-color` | oui |
| grille `auto-fit` / `minmax` | oui |
| `text-wrap: balance` | **non** — ignoré dans `notice.css` |

#### Les contrastes, cette fois calculés par le moteur

Toutes les valeurs précédentes venaient d'un calcul sur la source. Celles-ci
sortent de `getComputedStyle`, sur le vrai balisage, dans les deux palettes.
Elles composent les mélanges (`color-mix`), les fonds translucides et les
dégradés — ce qu'aucune relecture de fichier ne sait faire.

Repère de confiance : le bouton principal actif donne 7,02 et 5,09 en thème
clair, exactement les deux chiffres écrits en commentaire dans `app.css`. La
méthode retrouve donc ce qui était déjà connu avant d'annoncer ce qui ne l'était
pas.

- **Bouton principal désactivé : 1,64 en sombre, 1,36 en clair.** Confirmé, et
  pire que les « environ 1,5 » annoncés. C'est l'état au repos de l'app.
- **Rainure de la barre de progression : 1,22 en sombre, 1,25 en clair**, pour
  un seuil de 3. Confirmé. Mais la tension redoutée n'existe pas : l'écart entre
  la rainure et la jauge ambre est de 6,83 et 4,07 — il y a toute la place pour
  éclaircir la rainure sans la confondre avec ce qu'elle contient.
- **Les deux étiquettes de format : le relevé du 17 août les surestimait.** Sur
  quatre situations mesurées par thème, **une seule** passe sous le seuil :
  « perte ajoutée » sur l'option choisie en thème sombre, à **4,41** pour 4,5.
  Les sept autres vont de 4,82 à 7,46. L'affirmation « le rouge échoue dans les
  deux thèmes » est démentie : en clair il donne 4,83 et 5,32.
- Le texte d'explication sous chaque réglage tient : 5,25 en sombre, 6,43 en
  clair.

#### Ce que la fenêtre étroite révèle, et ce qu'elle ne révèle pas

À **375 px** : rien à signaler. Aucun débordement, tuiles en 2 × 2, la barre
latérale devient une rangée d'icônes en haut, tout reste lisible. Le point noté
« non vérifié » le 17 août est donc bon.

À **356 px** : 5 px de débordement (`nav.rail`, `main.scene`). Le seuil est à
361 px, sous toute largeur de fenêtre réaliste.

À **976 px** : **trois tuiles plus une**, exactement le « bancal » décrit le
17 août — confirmé sur le Mac.

Attention à un piège de mesure rencontré ici : un cadre de 375 px de large donne
une vue utile de 356 px une fois ses bordures et sa barre de défilement
retirées, et fait donc franchir un seuil qu'une vraie fenêtre de 375 px ne
franchit pas. Les deux chiffres ci-dessus viennent de deux mesures distinctes,
pas d'une seule interprétée deux fois.

#### Les six explications vides sont bien six, et on sait pourquoi

Mesuré sur l'app réelle : 6 explications vides sur 32, toutes dans
Planification, toutes des intervalles — « Toutes les 6 heures », « Deux fois par
jour », « Une fois par jour », « Tous les deux jours », « Tous les trois
jours », « Une fois par semaine ».

La cause est à `src/options.js:372` : `INTERVALLES` est la seule liste d'options
du fichier dont les entrées n'ont pas de champ `explication`.

#### Trois questions tranchées en marge

- **Le bouton « Retour » de la première étape est bien désactivé**
  (`public/app.js:1603`). Reste à savoir s'il *se lit* comme désactivé, ce qui
  est le même sujet que le bouton principal ci-dessus.
- **Les quatre Ogg de « Deep dive » ont été supprimés à la main**, dans le
  Finder, à 15 h 36. Pas par l'app : le garde-fou a été rejoué en isolation avec
  la configuration réelle et il conserve bien les sources. Conséquence à
  connaître quand même — ces quatre titres seront **retéléchargés** à la
  prochaine synchronisation, puisque zotify se repère sur la présence du fichier
  qu'il écrirait, c'est-à-dire l'Ogg.
- **`node --test tests/` échoue aussi sous Node 22.** L'avertissement de
  `CLAUDE.md` est juste sur le fond, faux sur la version : le projet tourne sur
  Node 22 partout — 22.14.0 dans le paquet, `22` en intégration continue,
  `>=20` dans `package.json`. Nulle part Node 24.

#### Ce que ce relevé n'a PAS pu établir

- **Personne n'a encore *regardé* l'app sur cet écran.** La capture d'écran
  système rend une image noire, faute d'autorisation d'enregistrement. Tout ce
  qui précède est mesuré par le moteur de rendu, pas vu. L'angle mort
  « l'harmonie générale des teintes » reste donc entier : un chiffre conforme et
  un écran laid cohabitent toujours aussi bien.
- **Le thème clair n'a pas été rendu par le système.** Il a été obtenu en
  appliquant les variables du bloc `prefers-color-scheme: light` à un sous-arbre.
  Les couleurs composées sont donc bien calculées par Safari, mais une règle qui
  ne vivrait QUE dans une requête de média n'aurait pas été exercée.
- **Aucun test de charge.** La plus longue exécution a duré 20 minutes pour
  12 titres. Le rattrapage de 17 heures reste théorique.

### 17 août 2026 — épreuve de la suite de tests

La suite était passée de 326 à 424 tests sans avoir jamais prouvé qu'elle
détecte quoi que ce soit. Dix-sept cassages délibérés ont été appliqués au code
des cinq modules critiques, un à la fois, en exigeant que la suite tombe.

**Résultat initial : cinq cassages sur dix-sept survivaient**, c'est-à-dire que
le code était cassé et que tous les tests restaient verts. Chacun était un test
manquant — aucun code mort, aucun cassage sans effet réel. Les cinq trous sont
désormais bouchés, et l'épreuve rejouée donne 17 sur 17.

Ce qui n'était pas gardé, et qui aurait dû l'être :

- **L'écriture atomique** — la règle la plus explicite du projet, et elle n'était
  pas testée. Remplacer le détour par un fichier temporaire suivi d'un renommage
  par une écriture directe ne faisait tomber aucun test. Le test existant
  vérifiait qu'aucun résidu ne traîne — ce qu'une écriture directe satisfait
  parfaitement, puisqu'elle n'en crée aucun. Une coupure de courant pendant
  l'écriture aurait laissé une configuration à moitié écrite.
- **Le nettoyage du temporaire après un échec**, pour la même raison : le cas
  nominal ne prouve rien, le renommage y consomme le temporaire.
- **Le seuil du garde-fou de rapprochement** pouvait passer de 50 % à 5 % —
  autant dire être neutralisé — sans rien casser. Le seul cas couvert était
  « pas un seul fichier reconnu », qui reste sous n'importe quel seuil.
- **Le plancher de 16 Ko** sur la taille d'un fichier converti : les cas testés
  échouaient pour deux raisons à la fois, le plancher n'était donc jamais seul
  responsable du rejet.
- **Le cas d'égalité exacte** entre la taille d'un fichier sans perte et celle de
  sa source, qui signale une copie déguisée plutôt qu'une conversion.

**La leçon, et elle vaut au-delà de ces cinq trous :** quatre de ces cinq tests
existaient déjà sous une forme voisine. Ils vérifiaient le cas nominal, ou un cas
extrême qui passe sous n'importe quelle borne. Ce qui manquait était toujours la
même chose — **le cas où la garde est SEULE à pouvoir refuser**.

**Ce que cette épreuve n'a PAS couvert :** cinq modules sur vingt-trois. Les
dix-huit autres — dont la synchronisation, les exports DJ, la sécurité, l'API
Spotify et le pilotage de zotify — n'ont jamais été éprouvés de cette façon. Leur
suite est verte ; personne ne sait encore ce que ça vaut.

**Et surtout : l'épreuve a muté des fonctions, pas leurs points d'usage.** La
relecture qui a suivi a trouvé ce que cette méthode ne pouvait pas voir — une
fonction impeccablement testée en isolation, et personne pour vérifier qu'on
l'appelle correctement. Trois trous de cette nature ont été bouchés dans la
foulée : la garde qui jette un fichier converti invraisemblable n'avait jamais
tourné, les droits restrictifs du fichier de jetons Spotify n'étaient vérifiés
nulle part, et deux tests pouvaient virer au vert sans avoir atteint la situation
qu'ils prétendaient éprouver. C'est exactement la forme de trou qui avait fait
qu'aucune version avant la 1.0.5 ne téléchargeait quoi que ce soit.

### Ce qui reste ouvert sur la conversion et le rapprochement

**Une troncature à mi-parcours n'est pas détectée.** La vérification de taille
attrape un fichier presque vide, pas un fichier coupé en son milieu : un FLAC
issu d'un Ogg de 5 Mo en pèse environ 25, coupé en deux il en fait encore 12,
donc plus que sa source, et il passe. Le commentaire du code annonçait le
contraire ; il est corrigé. Attraper ce cas demande de comparer les **durées**
avec `ffprobe`, déjà embarqué dans le paquet et déjà utilisé par les exports
Rekordbox.

**Trois bornes exactes ne sont pas épinglées** — le plancher de 16 Ko (passer de
« moins de » à « au plus » survit), le rapport d'un quart (le porter à 0,9
survit), et le seuil de rapprochement entre 40 % et 50 %. Aucune de ces dérives
n'est une neutralisation : les cassages grossiers, eux, sont bien attrapés.

**Un format de conversion inconnu** tombe silencieusement dans la branche « avec
perte ». Probablement voulu, mais nulle part écrit ni testé.

### 17 août 2026 — lot « contraste des contours »

Pendant la correction du contour des contrôles, un balayage automatique a mesuré
les contrastes du **reste** de l'interface, et quatre relecteurs ont examiné le
lot. Ce qui suit a été trouvé, vérifié, et volontairement **non corrigé** :
mélanger deux sujets rend un changement illisible six mois plus tard.

#### Les gris de la notice sont trop pâles pour du petit texte

Huit défauts, tous dans `public/notice.css`, chacun mesuré puis **re-mesuré par
une seconde analyse chargée de le réfuter**. Ce sont des chiffres reproduits, pas
des estimations.

La variable `--argent-bas` donne 4,00:1 en thème sombre et **3,38:1 en clair**,
là où du texte courant demande 4,5:1. Elle habille du texte de 11 à 14 px, ce
qui exclut toute tolérance « gros texte ». Sont touchés : les petites étiquettes
en capitales qui coiffent chaque section (neuf, plus celle de l'en-tête), les
libellés sous les gros chiffres du bandeau des durées (3,77:1 et 3,78:1, sur un
fond différent), les deux en-têtes du tableau des pannes, et la mention de bas
de page.

Le cas des libellés de durées est le plus gênant : le chiffre reste parfaitement
lisible, c'est la phrase qui dit **à quoi il se rapporte** qui s'efface. On se
retrouve avec quatre nombres nus, sans savoir lequel est le délai entre deux
morceaux et lequel est la durée totale — précisément ce que la notice cherche à
éviter pour que personne ne croie l'application bloquée.

`--ambre` en thème clair donne **4,36:1** contre 4,5 requis. Il s'en faut de peu,
mais le seuil n'est pas négociable en dessous. Sont touchés : les intitulés des
trois cartes de prérequis, les noms des sept onglets, les titres des encadrés
d'avertissement, et le texte du bouton « Synchroniser » — le seul bouton mis en
avant de toute la notice. Le thème sombre est conforme sur toute cette famille.

#### Trois palettes qui divergent

C'est la cause commune du point précédent, et le vrai sujet. `public/app.css`,
`public/notice.css` et `public/retour.css` ont chacune leur palette.

- `retour.css` redéclare cinq couleurs sous les **mêmes noms et les mêmes
  valeurs** qu'`app.css`. Duplication littérale, aucun argument pour.
- `notice.css` décrit les mêmes rôles sous d'autres noms — `--seam` pour un bord,
  `--panneau` pour une carte, `--argent-bas` pour du texte discret — avec les
  valeurs **d'avant** la correction de 1.0.2. C'est l'ancêtre non corrigé
  d'`app.css`, sous pseudonyme : les huit défauts ci-dessus ne sont pas un
  accident, ce sont les mêmes défauts, déjà payés une fois. Elle déclare en outre
  sa palette **trois fois** dans le même fichier.

~~**Ce que ça coûterait de régler :** un fichier `public/palette.css`…~~
**FAIT le 19 août 2026.** Voir le relevé daté en fin de fichier : les huit
défauts ont bien disparu comme effet de bord, et la mesure le confirme sur la
page réelle — zéro texte sous son seuil, dans les deux thèmes.

#### Trois défauts de l'app mesurés, confirmés, et laissés en place

Un second balayage a passé `public/app.css` au crible sous quatre angles : 210
mesures, 24 pistes, dont **8 seulement ont été soumises à une contre-analyse** —
les plus graves. Les 16 autres ne sont donc ni confirmées ni écartées. Quatre
défauts ont survécu à la réfutation ; le plus grave, le libellé illisible du
bouton principal en thème clair, a été corrigé dans le lot. Voici les trois
autres.

**La rainure de la barre de progression est invisible** — 1,38:1 en thème
sombre, 1,15:1 en clair, pour un seuil de 3:1. C'est elle qui dessine la
longueur totale du trajet ; la jauge ambre n'en occupe qu'une part. On voit donc
où on en est, mais pas par rapport à quoi.

~~Non corrigé, et pour une raison précise : l'éclaircir la rapprocherait de la
jauge ambre qu'elle contient, exactement la tension déjà rencontrée sur la
bascule — deux exigences qui tirent en sens inverse. Se règle en regardant
l'écran, pas au jugé.~~

**Corrigé dans la 1.1.0**, et pas de la façon envisagée ici : plutôt que
d'éclaircir la rainure, on lui a donné un contour. Les deux exigences sont alors
satisfaites au lieu d'être arbitrées. Le raisonnement mesuré est écrit dans
`public/app.css:220`. *(Ce paragraphe est resté « Non corrigé » deux jours après
l'être ; repéré le 21 août 2026 en confrontant ce fichier au code.)*

**Les deux étiquettes de format sont sous le seuil du texte** — « perte
ajoutée » en rouge et « sans perte ajoutée » en vert, dans l'onglet Qualité.
Mesures : de 3,63:1 à 4,38:1 selon l'étiquette, l'état de l'option et le thème,
pour un seuil de 4,5. Le rouge échoue dans les **deux** thèmes, y compris sur
l'option sélectionnée en sombre.

Détail qui compte : le format retenu par défaut est « l'Ogg d'origine », qui
porte l'étiquette verte. Le cas mesuré à 4,00:1 est donc celui de la **première
ouverture** de l'onglet, pas un état de coin. C'est le couple d'étiquettes qui
permet de trancher entre formats sans lire les explications — mais les libellés
de FLAC et AIFF répètent « sans perte ajoutée » en toutes lettres, ce qui limite
la perte réelle. Une correction doit traiter les deux étiquettes ensemble.

#### Les barres de progression déclenchent des refus de la politique de sécurité

**À vérifier en priorité sur le Mac.** Un relecteur a observé, à chaque
chargement de l'interface, une rafale de messages « Applying inline style … has
been blocked » dans la console du navigateur. L'origine est identifiée : les
trois seuls endroits où le programme pose un style directement sur un élément
(`public/app.js`, lignes 151, 779 et 1602) — **et les trois sont des barres de
progression**.

Ce que ça contredit : `tests/styles-en-ligne.test.js` affirme noir sur blanc
qu'une écriture de ce type « passe par le CSSOM, que la politique n'a jamais
couvert », et que « c'est la façon correcte d'animer une jauge ». Le relecteur a
d'ailleurs vérifié que la largeur s'applique quand même sur son navigateur : 73 %
posé, 73 % calculé. Les deux observations ne peuvent pas être vraies partout.

**Pourquoi ça ne peut pas attendre.** Si le moteur de la machine de destination
applique la règle strictement, la jauge se fige à zéro pendant qu'un
téléchargement de dix-sept heures avance sans rien montrer. C'est exactement ce
que le projet s'interdit : une opération longue doit prouver qu'elle avance,
sans quoi l'utilisateur force la fermeture — et déclenche les dégâts suivants.

**Ce qu'il faut faire :** ouvrir l'app sur le Mac, lancer une simulation, et
regarder la console **et** la jauge. Si elle ne bouge pas, remplacer l'écriture
directe par une règle insérée dans la feuille de style, et corriger la phrase
du fichier de test, qui serait alors fausse.

#### Quatre points relevés en regardant l'app tourner

**Le bouton principal désactivé est une bouillie beige sur beige** — environ
1,5:1 en thème clair. `opacity: .45` s'applique à tout le bouton, texte compris.
Un composant désactivé est explicitement exempté des seuils, et à juste titre —
mais celui-ci est visible sur les **sept** écrans, et l'état normal de
l'application au repos est précisément « on ne peut pas encore synchroniser ».
Il ne se lit pas comme « indisponible », il se lit comme un défaut d'affichage.
Baisser l'opacité du seul décor, en laissant le libellé plus lisible, suffirait.

**La case « Suivre » du journal reste une case native.** Sa couleur d'état a été
alignée sur l'ambre de l'app, mais elle garde la taille du système — 13 px,
contre 16 px pour toutes les autres — et elle ne passe pas par la mécanique
commune. C'est le seul contrôle de l'app qui ne soit pas redessiné. Non corrigé
plus avant parce que la refonte du balisage se juge à l'écran.

**Quatre tuiles en trois plus une.** Sur l'accueil en fenêtre moyenne (environ
980 px), les quatre tuiles de statistiques se rangent trois d'un côté et une
seule sur la ligne suivante, avec deux emplacements vides à sa droite. Sans
gravité, simplement bancal.

**La notice n'a pas l'identité visuelle de l'app** — titrage massif, cartes
dessinées autrement. Frappant quand on passe de l'une à l'autre. C'est le versant
visible du problème des trois palettes ci-dessus.

**Six réglages sans leur ligne d'explication.** Dans « vérification
automatique », les six options ont une explication VIDE. C'est le seul groupe de
réglages dans ce cas, et il contredit frontalement une règle du projet : chaque
choix arbitrable porte une ligne franche qui dit ce qu'on y perd. Ici, on
choisit un rythme de synchronisation sans qu'on vous dise ce que coûte chacun.

**Le fond des encadrés d'explication ne se voit pas en thème clair** — 1,04:1
contre la carte qui les porte, sous le seuil de perception. Seul le filet ambre
à gauche fait exister le bloc. Ce n'est pas un défaut : la forme retenue est
celle des lignes du Diagnostic et elle fonctionne. Mais c'est écrit ici pour que
personne ne croie disposer de trois signaux — fond, bordure, filet — alors qu'un
seul parle. Affaiblir le filet en pensant toucher un tiers du signal le
supprimerait en entier.

**Le bouton « Retour » de la première étape du premier lancement** est affiché
et paraît actif, à un endroit où il n'y a rien derrière. Non vérifié — il est
peut-être désactivé.

#### Ce que ce regard n'a PAS pu établir

Le relecteur n'a **pas pu tester les fenêtres étroites** : l'outil de
redimensionnement a cessé de répondre en annonçant des succès sans rien changer.
Le comportement à 375 px de large — et donc l'absence de défilement horizontal —
n'est pas vérifié.

Deux autres réserves, du même ordre que l'angle mort Safari : tout a été regardé
sous **Chrome, sur Windows**, à une densité d'écran de 1,5×. À cette densité, un
trait d'un pixel est écrasé sur un seul pixel physique ; sur un Mac Retina il en
occupera deux, à pleine épaisseur. Les contours du Mac seront donc **un tiers
plus marqués** que ceux qui ont été jugés « discrets et justes ». Et le thème
clair a dû être forcé à la main, faute de pouvoir changer le réglage du système.

#### La couleur du choix et celle de l'avertissement sont la même

`--accent`, qui veut dire « vous avez choisi ceci », et `--attention`, qui veut
dire « regardez ça de près », sont à **1,09:1** l'un de l'autre en thème sombre
et 1,16:1 en clair. Autrement dit : la même couleur. Deux significations
opposées — un choix qu'on a fait, un problème qu'on n'a pas vu — portent la
même teinte.

Cela n'a pas de conséquence tant que les deux ne se croisent pas sur le même
écran, et c'est aujourd'hui le cas. Mais c'est une collision qui attend : elle
s'est déjà produite une fois, quand la mention de version a repris l'habit des
encadrés d'explication au bas de la liste des diagnostics — corrigé le 17 août
2026 en sortant cette mention de la classe des encadrés, mais la cause est
restée.

**Ce qu'il faudrait :** écarter franchement `--attention` de `--accent`, en le
poussant vers l'orangé-rouge ou en le fonçant. À faire en regardant les deux
thèmes, pas au jugé — et en vérifiant que le nouveau ton ne se rapproche pas
d'`--erreur`, qui est le troisième de cette famille.

#### Deux tons de trait décoratif sans règle pour choisir

`--bord` (une vingtaine d'usages) et `--bord-vif` (trois) sont tous deux du
décor. La règle de choix est désormais écrite dans le commentaire de la palette,
mais la vraie forme serait **deux** tons — décor et contrôle —, pas trois.
Fusionner `--bord-vif` dans `--bord` demande trois remplacements. Non fait ici
parce que ça touche l'apparence de trois blocs qui n'ont aucun défaut.

#### Le cas positif des tests ne teste que le calcul

Le test « la mesure retrouve le défaut qu'elle a été écrite pour attraper » fige
quatre valeurs historiques, et il est **décoratif** : il n'exerce que la formule
de contraste, déjà couverte par six repères. Il ne touche aucun maillon de la
chaîne de *lecture* — trouver la règle, y trouver la propriété, en extraire la
variable, la résoudre dans le bon thème — qui est précisément là où ce dépôt a
déjà perdu deux scanners.

Un vrai cas positif ferait tourner cette chaîne sur une feuille de style factice,
dont on connaît d'avance le défaut. Ça demande de refermer les fonctions de
lecture sur un paramètre plutôt que sur la constante globale du fichier. C'est le
seul chemin honnête, et il n'est pas cher — mais il change la forme du fichier,
ce qui n'avait pas sa place dans un lot déjà consacré à autre chose.

#### Deux tests fragiles, préexistants

- Le test qui vérifie que la coche est bien posée par le balisage cherche le
  texte exact `class="puce carree"` : une simple inversion d'attributs le casse.
- La lecture d'une règle est aveugle aux sélecteurs indentés, donc à toute
  surcharge écrite dans une requête de média. Aucune n'est gardée aujourd'hui ;
  le message d'erreur nomme désormais cette cause pour ne pas envoyer chercher
  au mauvais endroit.

#### Angle mort de ce relevé lui-même

Rien n'a été **rendu** par un navigateur. Tout est calculé depuis la source, sur
un poste Windows, pour une application dont la cible est un Mac sous Safari. Les
valeurs composées — mélanges translucides, opacités — sont des calculs, pas ce
que Safari peint.

### 19 août 2026 — les étiquettes perdues entre le flux et le conteneur

Deux défauts, une seule cause, trouvés en préparant le rapport des rachats :
**l'Ogg range ses étiquettes sur le FLUX, pas sur le conteneur**, et deux
endroits du code ne lisaient que le conteneur. Reproduits sur de vrais fichiers
avec `ffprobe`, corrigés, revérifiés.

- `src/conversion.js` passait `-map_metadata 0`. Sur une source Ogg il n'y a
  rien à cet endroit — `[FORMAT]` est vide : **tout fichier converti sortait
  sans artiste, sans titre, sans album et sans ISRC.** Constaté sur les quatre
  MP3 de « Deep dive », dont les seules étiquettes étaient `TSSE=Lavf`.
  Corrigé en `0:s:0` ; le même fichier ressort alors complet, et `ffprobe` relit
  bien `isrc` sans qu'il faille toucher à la trame ID3.
- `src/exports-dj.js` ne lisait que `format.tags`. **Les exports Rekordbox et
  Serato ne voyaient donc AUCUNE étiquette des fichiers Ogg** — le format que
  l'app produit par défaut : ni album, ni année, ni tonalité, ni label, ni
  remixeur, ni ISRC. Seuls artiste et titre survivaient, déduits du nom de
  fichier. C'était précisément ce que l'export XML était censé apporter, et que
  Rekordbox ne lirait jamais autrement.

**Le test qui gardait la première ligne épinglait `'0'`** : il vérifiait la
présence du drapeau, jamais son effet. Encore la même forme de trou que le
17 août — une garde testée sur un cas où elle n'est pas seule à décider.

**Ce qui n'est pas rattrapé :** les fichiers déjà convertis restent sans
étiquettes. Le correctif ne vaut que pour les conversions à venir, et rien ne
repasse sur l'existant.


### 19 août 2026 — « Racheter en sans-perte », et deux défauts trouvés en chemin

Un sondage devait dire si la fonctionnalité décrite dans
`docs/specs/liens-flac-par-isrc.md` valait la peine d'être écrite. Réponse
mesurée : **non, pas telle quelle** — sa clé de recherche rendait zéro lien sur
treize. La spécification a été refondue et renommée
`docs/specs/racheter-en-sans-perte.md`, qui porte les chiffres.

Les deux défauts de métadonnées trouvés en chemin ont leur propre relevé
ci-dessus — ils avaient leur propre cause et leur propre correctif.

**Ce qui reste ouvert sur ce sujet :**

- Le rapport ne couvre que les morceaux **déjà téléchargés**, pas les playlists
  entières. Il faut pour cela l'API Spotify, aujourd'hui inactive (`spotify.actif`
  à `false`, aucun identifiant client). Et `inventaireComplet` (`src/analyse.js`)
  plafonne à 50 manquants par playlist.
- La couverture est mesurée sur **17 morceaux**. Les intervalles à 95 % sont
  larges. À rejouer sur la bibliothèque complète.
- La source Bandcamp passe par un point d'entrée **non documenté**. Elle est
  débrayable et sa panne est prévue, mais elle peut disparaître sans préavis.
- Les quatre MP3 déjà convertis restent sans étiquettes : le correctif ne vaut
  que pour les conversions à venir. Rien ne rattrape les fichiers existants.

### 19 août 2026 — la jauge de progression, mesurée sur le Mac

Le relevé du 17 août demandait de vérifier « en priorité sur le Mac » si la
politique de sécurité bloque les styles posés sur les barres de progression.
Mesuré ici, dans un moteur Chromium tournant sur le Mac, avec la vraie politique
servie par le serveur (`style-src 'self'`, sans `unsafe-inline`) :

- **aucun message dans la console au chargement**, et **aucun événement
  `securitypolicyviolation`** en écoutant l'événement dédié ;
- l'écriture en ligne s'applique : `height` posé à 9 px est calculé à 9 px, et
  une jauge posée à 73 % mesure 237,5 px pour un parent de 325,4 px ;
- la quatrième jauge de l'app — celle du rapport des rachats — a été regardée
  pendant une vraie exécution : 33 %, 67 %, 100 %, avec le nom du morceau en
  cours à côté.

**Deux pièges de mesure, tous deux rencontrés, et qui expliquent probablement les
observations contradictoires du 17 août :**

- tant que le bloc `#progression` est `hidden`, `getComputedStyle` renvoie
  fidèlement « 73% » **sans que rien ne soit rendu**. On croit avoir vérifié ;
- dans un onglet dont `visibilityState` vaut `hidden`, les transitions CSS sont
  **gelées** : la jauge reste à zéro indéfiniment, `playState` bloqué sur
  `running`. C'est un artefact de l'outil d'observation, pas un défaut de l'app.

**Recoupé avec la mesure Safari du même jour** (relevé « la jauge n'est pas
bloquée » plus haut) : les deux passes disent la même chose sur deux moteurs
différents. `élément.style.width` s'applique et ne déclenche aucune violation ;
c'est `setAttribute('style', …)` qui est bloqué, et l'app n'écrit jamais ainsi.

**Ce que la même mesure impose au rapport des rachats :** un bloc `<style>`
SERVI par le moteur, lui, est bien bloqué — violation `style-src-elem`, et
`feuille.sheet` vaut `null`. Le rapport embarque son style et doit donc rester
un fichier ouvert par le système, jamais une page servie. C'est écrit dans
`tests/styles-en-ligne.test.js`, et deux tests d'`achats.test.js` empêchent
qu'on l'oublie.

### 19 août 2026 — une parole manquante n'est plus une erreur

Le défaut le plus grave de la mise en service, et le plus instructif : **chaque
maillon faisait son travail, et l'ensemble mentait.**

Une ligne `SKIPPING: LYRICS FOR "…" (FAILED TO FETCH)` contient « failed ». Elle
devenait une erreur, l'erreur devenait un titre perdu, le titre perdu empêchait
« allé au bout », et « allé au bout » commandait l'enregistrement de la version
Spotify. Résultat : la playlist repartait de zéro à chaque exécution et le
planificateur espaçait la tentative suivante. **Une parole manquante déplaçait un
horaire de synchronisation.**

Quatre correctifs, indépendants et cumulés :

- `--lyrics-to-metadata false` est passé en plus de `--lyrics-to-file false`.
  Les lignes ne devraient plus apparaître du tout ; les trois autres correctifs
  valent quand même, pour un fork qui ignorerait l'option.
- Le catalogue reconnaît désormais cette ligne, en gravité INFO.
- **Trois chiffres sont découplés** là où il n'y en avait qu'un :
  `bilan.nbSignalements` (les lignes que zotify a marquées), `bilan.nbErreurs`
  (les TITRES réellement perdus) et `alléAuBout` (qui ne regarde plus que le
  second). Le bandeau d'accueil, l'historique et le rapport de diagnostic ont
  été relus dans la foulée : tous disaient « erreur » pour une ligne signalée.
- `bilan.àReprendre` ne mélange plus noms et URL : `nomAffichable()` tranche
  pour le nom, avec `playlist/<identifiant>` en repli — la même écriture que
  l'accueil. Le message « n'ont rien donné », écrit pour une règle disparue
  depuis longtemps, dit maintenant ce qui s'est réellement passé et **nomme**
  les playlists concernées.

**Ce que ce lot a appris en marge** : `GRAVITÉ.INFO` ne veut pas dire « sans
importance », il veut dire **« rien à reprendre »**. Un morceau retiré du
catalogue est INFO pour la raison exactement inverse des paroles — il n'arrivera
jamais, et le compter comme perdu ferait reprendre la playlist indéfiniment. La
gravité, et non le nombre de lignes, est donc le bon critère pour `alléAuBout`.
C'est écrit dans un test, parce que c'est contre-intuitif.

**Le test qui manquait** rejoue la chaîne entière : le faux zotify a gagné un
scénario `paroles-manquantes` qui écrit la ligne réelle du 19 août pendant que
les trois titres arrivent entiers. Aucun test unitaire ne pouvait voir ce
défaut : chaque pièce était juste.

### 19 août 2026 — convertir pendant, plus seulement après

L'ancienne chaîne était : inventaire avant, zotify jusqu'au bout, inventaire
après, conversion du lot. Deux exécutions arrêtées en cours de route ont donc
téléchargé sans rien convertir — `convertirLot` sortait à la première boucle
quand l'arrêt était déjà demandé — et **rien ne rattrapait jamais** ces
fichiers : la conversion ne regarde que les nouveautés de l'exécution en cours,
pendant que `--skip-existing` empêche zotify de les reproposer. Treize titres
sont restés en Ogg, dans des listes `.m3u8` que Rekordbox ne sait pas lire.

Trois changements, et un quatrième trouvé en chemin :

- **La conversion tourne pendant le téléchargement.** zotify écrit en `.tmp`
  puis renomme : un fichier portant une extension audio est complet, et ses
  trente secondes d'attente entre deux titres laissent tout le temps à ffmpeg.
  À l'instant d'un arrêt, tout ce qui est descendu est déjà converti.
- **Un rattrapage passe sur toute la bibliothèque au démarrage**, après le
  diagnostic — donc après la vérification de ffmpeg. C'est la même moisson,
  jouée une fois : une seule mécanique à garder juste.
- **Un arrêt ne coupe plus la conversion** des fichiers déjà descendus, et le
  journal explique pourquoi il prend ces quelques secondes. Les laisser
  inutilisables serait la pire des deux options.
- **Trouvé en marge, et c'est l'autre moitié du défaut** : quand la cible
  existe, `convertir` refuse de la réécrire — à raison, un fichier réanalysé par
  Serato porte des points de repère qui vivent dedans. Mais le lot rangeait
  alors le fichier dans « ignorés » **sans sa destination**. L'appelant, ne
  voyant aucune conversion, retombait sur les sources : les listes de lecture
  pointaient des `.ogg` alors que les `.mp3` étaient là, à côté. Ce cas est
  devenu le cas normal depuis que la moisson tourne — il fallait le traiter
  d'abord, sinon le correctif principal produisait le défaut qu'il corrigeait.

**Le leurre ffmpeg des tests produit maintenant un vrai fichier.** Il se
contentait de répondre à `-version` : suffisant tant que les tests
d'intégration utilisaient le format « copie », inutilisable pour prouver qu'une
interruption ne laisse aucun orphelin. Le nouveau leurre ne code rien, il
recopie et rallonge.

**Épreuve du test, faite** : la moisson désactivée, le test d'interruption tombe ;
rétablie, il passe. Il garde donc bien ce qu'il prétend garder.

**Conséquence pratique pour la bibliothèque réelle** : les treize Ogg encore sur
le disque seront convertis au démarrage de la prochaine synchronisation, sans
rien retélécharger.

### 19 août 2026 — la politique de retrait devient applicable

`saitReprendreSansLeFichier()` renvoyait `false` en dur. Le choix « Corbeille »
posé le 19 août à 15 h 27 était donc refusé en silence à **chaque**
synchronisation. Un réglage qu'on peut poser et que l'app reprend sans le dire
n'est pas un réglage.

**Ce que la source de zotify 0.17.4 a appris**, lue sur la machine plutôt que
supposée — et elle corrige deux points du plan :

- l'option a trois graphies (`-ip`, `--skip-prev-downloaded`,
  `--skip-previously-downloaded`) ; les deux longues sont acceptées ;
- **`--song-archive-location` existe** et prend un DOSSIER, auquel zotify ajoute
  lui-même `.song_archive` (`config.py:427`). Le journal n'a donc pas à rester
  dans un coin du système : il vit maintenant avec la configuration et l'état,
  se sauvegarde avec eux, et suit une installation portable ;
- `SongArchive.__init__` (`utils.py:320`) pose bien
  `disabled = not Path(filepath).exists()`, et `add_obj` sort immédiatement
  quand c'est le cas. Un journal absent ne se remplit donc jamais. Confirmé.

**Quatre garde-fous, et chacun doit pouvoir refuser seul :**

1. zotify déclare l'option ;
2. l'utilisateur a demandé un retrait — sinon on ne touche à rien. Activer le
   journal pour tout le monde retirerait « LE DISQUE FAIT FOI » à ceux qui n'ont
   rien demandé : supprimer un morceau à la main ne le ferait plus revenir ;
3. le journal existe, sans quoi zotify n'y écrit rien ;
4. **ce morceau-là y est inscrit.** C'est le garde-fou le plus important et le
   moins évident : tout peut être en place et zotify n'avoir rien écrit. On ne
   retire que ce qu'il dit savoir reprendre, et on annonce combien de fichiers
   ont été conservés faute de trace.

Le journal est copié après chaque synchronisation : il vaut désormais la
bibliothèque entière.

**Corrigé au passage** : `skip-previously-downloaded` figurait dans les candidats
de `ignorerExistants`, comme s'il était synonyme de `skip-existing`. Ce sont deux
portes différentes de `check_skippable`. Sur un fork qui ne déclarerait que la
seconde, un réglage serait passé pour un autre.

**Épreuve du test, faite** : le filtre du journal retiré, le test « un morceau
absent du journal garde sa source » tombe ; rétabli, il passe. Le faux zotify
reproduit fidèlement la règle du fichier absent — une doublure plus complaisante
que l'original est précisément ce qui a coûté le plus cher à ce projet.

### 19 août 2026 — les six explications manquantes, et où elles manquaient vraiment

Le relevé du matin accusait `src/options.js:372`, seule liste d'options sans
champ `explication`. C'était **la moitié de l'histoire**, et pas la moitié
décisive : `public/app.js` écrivait `explication: ''` **en dur** au moment de
fabriquer ces six options. Le texte aurait pu être parfaitement rédigé dans le
catalogue, il n'aurait jamais atteint l'écran.

Encore la même forme de défaut que la 1.0.5 et que les paroles : deux pièces
justes, un assemblage qui ment. Et la leçon pour les tests est la même — un
garde posé sur le seul catalogue serait resté vert sur une application muette.
Il y a donc **deux** gardes : l'un exige que chaque option arbitrable porte une
explication (avec une longueur minimale, pour qu'elle dise aussi l'inconvénient),
l'autre interdit à l'interface d'en vider une. Les deux ont été éprouvés en
cassant le code exprès.

**Et la mise en page suit le contenu.** La grille compacte à trois colonnes de
190 px datait de l'époque où ces choix n'avaient que leur libellé ; elle rendait
maintenant l'explication sur sept lignes, et « Recommandé » ne tenait pas à côté
de « Tous les deux jours » (il manquait 40 px, mesurés). Les intervalles passent
en pleine largeur, comme les rythmes et les formats.

### 19 août 2026 — les contrastes qui restaient

Tous mesurés par le moteur de rendu, avant et après, dans les deux thèmes.

**Le bouton principal désactivé : 1,64 et 1,36 → 5,14 et 5,05.** `opacity: .45`
éteignait le libellé avec le décor. On repeint plutôt qu'on estompe : surface
neutre, contour de contrôle, libellé en gris de texte. Un composant désactivé est
exempté des seuils — mais celui-ci est l'état de l'app au repos sur les sept
écrans, et il ne se lisait pas « indisponible », il se lisait « défaut
d'affichage ».

*Deux pièges rencontrés en le corrigeant, tous deux silencieux :*

- `.bouton.primaire` a la même spécificité que `.bouton:disabled` et vient plus
  bas dans le fichier : le correctif n'atteignait pas le seul bouton visé. Il
  faut nommer les variantes.
- `background: var(--…)` en RACCOURCI est « invalide au moment du calcul » au
  moindre problème, et **tous** ses sous-champs retombent alors à leur valeur
  initiale — fond transparent compris. Le dégradé disparaissait bien, rien ne le
  remplaçait. Les longhands séparément.

**La rainure de progression : 1,22 et 1,25 → un contour à 3,70 et 3,66.**
Et ici **le relevé du matin se trompait** en annonçant qu'il y avait « toute la
place » pour l'éclaircir. Mesuré : une rainure à 3 pour 1 contre la carte ne
laisse plus que 2,7 contre la jauge en sombre, et **en clair aucune valeur ne
satisfait les deux à la fois** — la carte est blanche, l'accent est un brun
foncé, les deux contraintes tirent en sens opposés. L'optimum arithmétique en
sombre plafonne à 2,86 des deux côtés.

D'où un autre dessin plutôt qu'un arbitrage : c'est un **contour** qui porte
désormais la longueur totale, avec la teinte déjà prévue pour ce qui se manipule
et déjà garantie à 3 pour 1 contre les quatre surfaces. Le fond de la rainure
peut alors rester discret, donc très contrasté avec la jauge (6,83 en sombre,
4,07 en clair). Les deux exigences sont satisfaites au lieu d'être arbitrées. La
barre passe de 4 à 6 px : le contour lui laisse les mêmes 4 px de remplissage.

**Les quatre tuiles ne se rangent plus en trois plus une.** Aucune combinaison de
`minmax` ne peut sauter le cas à trois colonnes ; il a fallu nommer les paliers —
quatre de front au-delà de 980 px, sinon deux par deux, jamais de rangée
orpheline.

**La case « Suivre » du journal n'est plus native.** Elle emprunte la même
mécanique que toutes les autres cases : 16 px au lieu de 13, et le jour où la
coche changera de dessin, elle suivra. Trois tests sont tombés au passage en
annonçant que la règle de la coche avait *disparu* — elle était devenue un
sélecteur groupé. La lecture de feuille de style le comprend désormais, et le
message trompeur n'enverra plus chercher au mauvais endroit.

**Plus aucun débordement horizontal, sur les sept onglets, à 356 px.** Deux
causes, pas une : les enfants de la grille principale réclamaient la largeur de
leur contenu (`min-width: auto` est la valeur initiale), et la barre d'outils du
journal refusait de replier ses boutons.

**Ce que je n'ai PAS corrigé, faute de reproduire le défaut.** L'étiquette
« perte ajoutée » sur l'option choisie en thème sombre était relevée à 4,41 pour
un seuil de 4,5. Mesurée ici, en composant l'étiquette translucide sur l'option
puis sur la carte : **4,83**. Les deux méthodes divergent de 0,4 et je ne sais
pas laquelle a raison. Le relevé du 17 août avait déjà surestimé cette famille —
et il demandait lui-même de ne pas corriger au-delà. Changer une couleur sur un
chiffre qu'on n'arrive pas à reproduire ferait le contraire.

### 19 août 2026 — il y a un SECOND zotify sur cette machine

Trouvé par accident, en montant une instance d'essai dans un dossier de données
jetable : le diagnostic y a résolu `zotify` vers **`~/.local/bin/zotify`,
version 1.1.2** — pas celui que l'app a installé (`0.17.4`, dans son venv).

Ce n'est pas un défaut aujourd'hui : `chemins.js` place le venv en tête du
`PATH`, et la configuration réelle dit simplement `zotify`. Mais cette
installation-là déclare **63 options et PAS `--skip-existing`**. Le jour où le
venv manquerait ou serait cassé, l'app se rabattrait dessus en silence et
**chaque synchronisation reprendrait toute la bibliothèque depuis le début**.

Le diagnostic le signalerait — il l'a fait, tout de suite — mais son message ne
dit pas QUEL zotify il a trouvé. C'est ce qui a fait perdre dix minutes à croire
à une régression. Faire nommer le chemin par ce contrôle coûterait deux lignes.

### 19 août 2026 — une couleur ne s'écrit plus qu'à un seul endroit

`public/palette.css` existe. Les trois pages la chargent — l'interface, la notice
et la page de retour Spotify — et **plus aucune valeur de couleur ne vit
ailleurs** : un test le vérifie fichier par fichier, après avoir prouvé qu'il
sait attraper une couleur en dur.

Ce qui a été fait, et ce qui a été délibérément laissé :

- `retour.css` redéclarait cinq couleurs sous les mêmes noms et les mêmes
  valeurs qu'`app.css`. Supprimées.
- `notice.css` déclarait sa palette **trois fois**, sous des noms d'atelier, avec
  les valeurs d'avant la 1.0.2. Les **noms restent, en alias** vers la palette :
  renommer une cinquantaine de renvois aurait mélangé deux sujets dans un même
  changement, et le vocabulaire de la notice a sa raison d'être.
- La palette porte **trois états de thème** — système, clair forcé, sombre forcé.
  Il en faut bien trois : la notice offre une bascule manuelle, et une couleur
  dont la seule définition vivrait dans une requête de média serait absente pour
  qui a basculé à la main.

**Vérifié à l'écran, pas déduit** : un balayage de TOUT le texte de la notice,
dans les deux thèmes, ne trouve plus aucun contraste sous son seuil. Les huit
défauts du 17 août ont disparu sans être touchés un par un — ils n'étaient que
le reflet d'une palette recopiée.

**Les deux contrôles de la chaîne de publication ont été étendus**, comme le
relevé le demandait : le paquet vérifie que `palette.css` est présent, et le
contrôle des pages vérifie qu'elle est servie, qu'elle déclare bien `--accent`,
et que les deux pages la chargent. C'est le fichier le plus sensible de la
chaîne depuis qu'il existe : il ne sert aucune page à lui seul, mais les trois
autres n'ont plus une seule couleur sans lui.

**Trente et un tests sont tombés d'un coup** au moment de la scission, en
annonçant des variables introuvables. C'est le bon symptôme : les gardes de
contraste lisaient `app.css`, où il n'y a plus de couleurs. Ils lisent désormais
les deux feuilles. Une lecture qui ne trouve plus rien doit échouer, jamais
passer.

### 19 août 2026 — les erreurs de zotify parlent français

L'utilisateur a lu ceci, tel quel, dans son journal :

```
zotify : ConnectionResetError: [Errno 54] Connection reset by peer
zotify : ConnectionRefusedError: [Errno 61] Connection refused
```

Le catalogue savait pourtant les traduire. C'est le journal qui recopiait la
ligne d'origine **avant** de passer par lui : toute la taxonomie d'`erreurs.js`
était contournée à l'endroit précis où elle sert le plus — le seul endroit que
l'on regarde quand quelque chose ne va pas.

`phraseJournal()` rend désormais « ce qui s'est passé, ce que ça implique, quoi
faire », et la ligne d'origine part en **détail**, pour qu'un rapport de panne
reste exploitable. Une ligne que le catalogue ne reconnaît pas est conservée
telle quelle : la traduire au jugé effacerait la seule information exploitable.

**Deux tests, et le second est le vrai.** L'un éprouve la fonction sur les deux
lignes réelles du 19 août ; l'autre rejoue une synchronisation entière et exige
qu'aucun `Errno` n'arrive dans le journal. C'est le maillon qui manquait — la
pièce était juste, personne ne l'appelait. Épreuve faite : la traduction retirée,
le second tombe.
