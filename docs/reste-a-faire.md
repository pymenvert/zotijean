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

Dernière mise à jour : 19 août 2026, après la première mise en service réelle sur
le Mac.

---

## Défauts constatés

Tous ceux qui suivent ont été vus le 19 août 2026 sur le Mac, sur la 1.0.7
installée, avec le vrai zotify et une vraie bibliothèque. Aucun n'est déduit
d'une lecture : chacun porte la trace qui l'a montré.

### La politique de retrait des sources ne peut jamais s'appliquer

`saitReprendreSansLeFichier()` (`src/zotify.js:483`) renvoie `false`, en dur.
Le garde-fou force donc toujours « conserver ». Vérifié en isolation avec la
configuration réelle : la source survit, et l'avertissement part.

C'est le bon comportement — mais l'utilisateur a choisi « Corbeille » le 19 août
à 15 h 27, et il recevra cet avertissement à **chaque** synchronisation sans que
son choix prenne jamais effet. Un réglage qu'on peut poser et que l'app refuse
en silence à chaque fois n'est pas un réglage.

**Et le « false » en dur est désormais faux.** zotify 0.17.4 tient bien un
journal indépendant des fichiers présents, et sa source dit exactement comment
s'en servir (`api.py`, `check_skippable`) :

```
si  fichier présent   ET --skip-existing        ET --disable-directory-archives  → sauté
si  id dans .song_ids ET --skip-existing        ET PAS de --disable-directory-…  → sauté
si  id dans .song_archive (global) ET --skip-prev-downloaded                     → sauté
```

Zotijean n'emprunte que la première ligne, celle qui dépend du fichier. La
troisième est exactement le garde-fou recherché — et `--skip-prev-downloaded`
figure déjà dans la liste d'options que le diagnostic relève sur la machine.

**Un détail décide de tout, et il est contre-intuitif** : `SongArchive.__init__`
(`utils.py:320`) pose `disabled = not Path(self.filepath).exists() or …`. **Le
journal ne se crée jamais tout seul.** Vérifié sur la machine : après 17 titres
téléchargés, `~/Library/Application Support/Zotify/.song_archive` n'existe pas.
Il faut créer le fichier vide une fois pour que zotify commence à l'alimenter.

Ce qu'il faut peser avant de basculer : ce journal est **global à la machine**,
pas propre au dossier de musique ; et s'il est perdu alors que les Ogg ont été
jetés, c'est toute la bibliothèque qui se retéléchargerait. Le journal devient
alors un fichier aussi précieux que la configuration, et mérite le même soin.

### Cinq pixels de défilement horizontal sous 361 px de large

Mesuré dans Safari 16.3 puis reproduit sous Chromium : à 356 px de large utile,
`scrollWidth` vaut 361. Les deux coupables sont nommés — `nav.rail` et
`main.scene`. La page réclame 361 px et n'en descend pas.

**À 375 px, en revanche, tout est propre** : aucun débordement, tuiles en 2 × 2.
Le correctif du bandeau héros (commentaire d'`app.css:207`) a bien réglé le cas
qu'il visait. Ce qui reste ne se manifeste qu'en dessous de 361 px, largeur
qu'aucune fenêtre de navigateur n'atteint spontanément.

**Le point que le relecteur du 17 août n'avait pas pu vérifier est donc clos, et
il était moins grave qu'annoncé.** Priorité basse, mais écrit pour ne pas être
re-cherché.

### Les erreurs de zotify arrivent en anglais brut

`ConnectionResetError: [Errno 54] Connection reset by peer` et
`ConnectionRefusedError: [Errno 61] Connection refused` ont été affichées telles
quelles. Le motif `reseau` du catalogue attrape bien `connection` — mais le
journal, lui, recopie la ligne d'origine avant traduction. La règle du projet
veut un message en français orienté action.

## Chantiers en pause

### Écrire les ISRC dans les étiquettes des fichiers

La moitié restante du « pont sans perte ». Depuis la 1.0.6, la variable `{isrc}`
met déjà l'identifiant dans le NOM du fichier sans rien réécrire ; c'est le
chemin sûr. Écrire dans les étiquettes exigerait de réécrire le fichier, là où
Serato stocke points de repère et grilles rythmiques : à ne faire qu'**avec**
l'utilisateur, sur ses vrais fichiers, en commençant par une simulation.

### Brancher la politique de retrait (Archiver / Corbeille)

Le code est écrit et testé, volontairement non câblé : déplacer ou jeter des
fichiers de la bibliothèque se décide avec l'utilisateur. La note de l'interface
dit la vérité sur cet état.

---

## Angles morts

### ~~Safari n'a jamais rendu ces styles~~ — levé le 19 août 2026

Safari 16.3 a rendu la feuille, et les mesures sont dans le relevé daté du
19 août plus bas. Les quatre propriétés surveillées passent, `backdrop-filter`
grâce à son préfixe `-webkit-` déjà présent. Ce qui reste de cet angle mort
tient en deux lignes, et il est descendu d'un cran :

- **`text-wrap: balance` est ignoré par Safari 16.3** (`public/notice.css`,
  lignes 91 et 106). Sans conséquence : le texte s'affiche, il n'est simplement
  pas équilibré.
- **Le navigateur par défaut de ce Mac est Firefox, pas Safari.** L'app s'y
  ouvrira donc par `open`. Gecko n'a été mesuré ni ici ni ailleurs. L'angle mort
  n'a pas disparu, il a changé de moteur.

Et la question que les tests ne savaient pas poser a sa réponse : **« Tous les
deux jours » ne tient PAS sur une ligne.** Deux lignes à 976 px comme à 371 px,
à cause de l'étiquette « Recommandé » qui le suit. La 1.0.7 l'a fait passer de
quatre lignes à deux ; elle ne l'a pas réglé.

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

**Ce que ça coûterait de régler :** un fichier `public/palette.css` d'une
trentaine de lignes, une cinquantaine de renvois à renommer dans `notice.css`,
un lien à ajouter dans les deux pages et dans le serveur. Une demi-journée.
**Attention**, deux endroits de la chaîne de publication vérifient que chaque
feuille est bien servie : les oublier ferait passer un paquet où la palette
manque et où les trois pages s'afficheraient dans les couleurs par défaut du
navigateur.

**Ce que ça ferait gagner :** les huit défauts disparaissent comme effet de bord,
et `tests/contraste.test.js` — qui ne lit aujourd'hui qu'`app.css` — garderait
les trois pages au lieu d'une.

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

Non corrigé, et pour une raison précise : l'éclaircir la rapprocherait de la
jauge ambre qu'elle contient, exactement la tension déjà rencontrée sur la
bascule — deux exigences qui tirent en sens inverse. Se règle en regardant
l'écran, pas au jugé.

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
