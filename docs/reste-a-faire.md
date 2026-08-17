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

Dernière mise à jour : 17 août 2026, pendant la préparation de la 1.0.7.

---

## Défauts constatés

### Les encadrés d'explication sont indiscernables d'une option cochée

**Ce qu'on voit.** Les encadrés qui expliquent un réglage ont exactement l'allure
d'une option sélectionnée : fond orangé pâle, bordure orangée. L'œil les compte
donc comme des choix actifs, et une carte qui contient trois explications semble
avoir trois réglages cochés.

**Où.** `public/app.css` — la règle `.note` et la règle `.option.choisi` posent
le **même** fond `var(--accent-doux)`, avec des bordures orangées qui ne
diffèrent que par leur intensité (`--accent` plein contre `--accent` à 25 %).
Rien dans la palette ne distingue « ceci est sélectionné » de « ceci est une
explication ».

**Pourquoi ça compte.** L'orange est, partout ailleurs dans l'app, la couleur de
« vous avez choisi ceci ». S'en servir aussi pour du texte purement informatif
retire au signal sa signification. C'est un défaut de sens, pas de goût.

**Confirmé en regardant l'écran** (17 août 2026). Les deux surfaces sont
strictement identiques — même fond, même rayon de 8 px —, et le seul écart est
l'opacité de la bordure. Sur un trait d'un pixel, cet écart *n'existe pas* : le
relecteur ne l'a pas vu alors qu'il savait où regarder.

Où ça mord le plus : onglet **Qualité**, carte « format des fichiers ». Sous les
cinq options, la note sur l'offre sans perte de Spotify s'ajoute à la liste avec
l'allure exacte de l'option sélectionnée quatre lignes plus haut. Elle se lit
comme une sixième option, cochée elle aussi. Même teinte encore pour la ligne
« Exemple » du tableau d'aperçu, et — plus curieux — pour l'encadré du numéro de
version dans Diagnostic : un numéro de version peint dans la couleur de
l'avertissement, au bas d'un écran de contrôle.

**Piste retenue :** garder l'ambre pour ce qui est *choisi*, et donner aux notes
un fond neutre avec un filet vertical à gauche — comme les lignes du Diagnostic,
qui elles fonctionnent bien.

### Le titre de l'option recommandée est coupé en quatre

**Ce qu'on voit.** Dans les listes de réglages présentées en colonnes, le titre
d'une option portant l'étiquette « Recommandé » se casse mot par mot, sur trois
ou quatre lignes, alors que la place ne manque pas.

**Où.** `public/app.css` — `.option-titre` est un conteneur `display: flex` sans
`flex-wrap`, et il contient deux choses côte à côte : le libellé (un texte nu,
que le navigateur transforme en élément flex anonyme) et l'étiquette
« Recommandé ». Quand la colonne est étroite — `.choix.compact` est une grille
dont les colonnes descendent à 190 px — l'étiquette garde sa largeur et c'est le
libellé qui est comprimé jusqu'à sa plus petite largeur possible, donc jusqu'au
mot.

**Pourquoi ça compte.** L'option recommandée est celle qu'on veut rendre la plus
facile à lire. C'est précisément celle qui est illisible.

**Confirmé en regardant l'écran** (17 août 2026), et c'est pire qu'annoncé.
Onglet **Planification**, carte « vérification automatique » : « Tous les deux
jours » s'affiche sur **quatre lignes** — un mot par ligne. Et ce n'est pas un
problème de fenêtre étroite : identique à 1699 px de large comme à 984 px.

Effet en cascade, qui est le vrai dégât : la rangée entière s'aligne sur la carte
la plus haute. Les trois voisines — « Toutes les 6 heures », « Tous les trois
jours », « Une fois par semaine » — deviennent des rectangles avec un titre sur
une ligne et une soixantaine de pixels de vide dessous. C'est le seul endroit de
l'application où la grille est manifestement cassée.

**Des deux défauts de cette section, c'est de loin le plus grave à l'œil** — et
ce n'est pas comparable : celui-ci saute aux yeux en une seconde, l'autre demande
qu'on s'y attarde. À traiter en premier.

---

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

### Safari n'a jamais rendu ces styles

Toute l'interface a été mesurée et regardée dans un moteur Chromium, sur un PC
Windows. La cible est un Mac, où la fenêtre s'ouvrira dans Safari.

Ce n'est pas une inquiétude théorique : la feuille de style contient déjà au
moins un contournement écrit pour Safari — la bibliothèque d'icônes ne peut pas
être masquée par `display: none`, sinon Safari cesse de résoudre les renvois et
toutes les icônes disparaissent. Ce piège-là a été trouvé par la lecture, pas par
un rendu. Les autres, s'il y en a, sont encore là.

Les points à regarder en premier, parce qu'ils utilisent des propriétés dont le
support diffère : `:has()`, `color-mix()`, `backdrop-filter`, les pseudo-éléments
qui dessinent la coche, et la grille des colonnes automatiques.

**Ce qu'il faudrait pour le lever :** ouvrir l'app sur le Mac, dans les deux
thèmes, et regarder. Rien d'autre ne remplace ça.

### L'harmonie générale des teintes n'a jamais été regardée

Les contrastes de `public/app.css` ont été mesurés et corrigés — en 1.0.2 pour le
texte, en 1.0.7 pour le contour des contrôles. Mais mesurer n'est pas regarder :
personne n'a jamais jugé si les deux thèmes sont *beaux*, si les teintes
s'accordent, si quelque chose crie. Un chiffre conforme et un écran laid
cohabitent très bien.

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

### zotify réel

Le format exact de sa sortie, ses codes d'erreur, son comportement quand une
piste est indisponible dans le pays. Tout est testé contre une doublure. La
leçon de la 1.0.5 — dix suppositions fausses découvertes en lisant sa source —
dit assez ce que vaut une doublure qui accepte tout.

### Un vrai Mac

La chaîne de publication construit le paquet et le démarre, mais personne n'a
encore double-cliqué dessus sur la machine de destination.

---

## Relevés datés

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
