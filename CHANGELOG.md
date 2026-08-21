# Journal des versions

## 1.1.0 — 21 août 2026

**La première version écrite APRÈS avoir vu l'application tourner sur son Mac.**
Toutes les 1.0.x ont été mises au point sur un PC Windows, contre une doublure du
téléchargeur. Trois synchronisations réelles ont suffi à montrer ce qu'aucun test
ne pouvait voir — et à faire tomber six tests qui passaient partout ailleurs.

Le fil commun de presque tout ce qui suit : **chaque pièce était juste, et
l'assemblage mentait.** Une ligne d'information devenait une erreur, une erreur
devenait un titre perdu, un titre perdu déplaçait un horaire de synchronisation.
Le catalogue savait traduire les pannes, personne ne l'appelait. Le texte des
réglages existait, l'interface le vidait. C'est ce genre de défaut que cette
version corrige, et pour lequel elle ajoute des garde-fous qui éprouvent le
CHAÎNAGE et non plus seulement les pièces.

### Les pannes s'expliquent en français

Le journal affichait « ConnectionResetError: [Errno 54] Connection reset by
peer ». L'application savait traduire cette ligne depuis longtemps — elle ne le
faisait simplement pas à cet endroit-là, le seul qu'on regarde quand quelque
chose ne va pas. Vous lisez maintenant ce qui s'est passé, ce que ça implique et
quoi faire ; la ligne technique reste consultable à côté, pour un signalement.

### La notice ressemble enfin à l'application

Les deux ne se ressemblaient pas, et ce n'était pas qu'une affaire de goût : la
notice avait sa propre copie des couleurs, figée à une version d'avant les
corrections de lisibilité. Ses petits textes gris étaient donc trop pâles —
huit endroits, tous mesurés, tous déjà corrigés une fois ailleurs.

Les couleurs vivent maintenant dans un seul fichier, partagé par les trois pages.
Les huit défauts ont disparu sans avoir été touchés un par un, et un contrôle
empêche désormais qu'une couleur soit réécrite ailleurs.

### Ce qui se voyait mal se voit

Le bouton principal désactivé — l'état de l'application au repos, sur les sept
écrans — était une bouillie de la couleur de son fond : son libellé passe de 1,4
à 5,1 de contraste. Il ne s'estompe plus, il se repeint : on lit « Synchroniser »
même quand on ne peut pas encore cliquer.

La rainure de la barre de progression était invisible : on voyait où on en
était, jamais par rapport à quoi. Elle a maintenant un contour, ce qui règle du
même coup une tension qu'on croyait devoir arbitrer — l'éclaircir suffisamment
l'aurait rapprochée de la jauge qu'elle contient.

Les quatre tuiles de l'accueil ne se rangent plus en trois plus une, avec deux
emplacements vides. La case « Suivre » du journal, seule case restée au dessin du
système, ressemble enfin aux autres. Et plus rien ne déborde horizontalement,
même sur une fenêtre de 356 pixels.

### Le rythme de vérification dit enfin ce que chaque choix coûte

Six réglages, six libellés nus, au milieu de vingt-six autres qui expliquent tous
ce qu'on y perd. On choisissait « Toutes les 6 heures » ou « Une fois par
semaine » sans qu'on vous dise ce que ça change — alors que c'est le réglage qui
décide de la fréquence à laquelle l'application parle à Spotify, donc de
l'exposition de votre compte.

Chacun porte maintenant sa phrase, avec son inconvénient. Et comme ces
explications prennent de la place, la liste passe en pleine largeur : au passage,
« Tous les deux jours » ne se casse plus en deux à côté de son étiquette
« Recommandé ».

### « Archiver » et « Corbeille » fonctionnent enfin

Ces deux réglages existaient, on pouvait les choisir, et l'application les
reprenait en silence à chaque synchronisation : les fichiers d'origine étaient
conservés quoi qu'il arrive. La raison était bonne — retirer un Ogg aurait fait
tout retélécharger — mais elle avait cessé d'être vraie.

Le téléchargeur sait tenir un journal de ce qu'il a pris, indépendant des
fichiers présents. Il ne le crée jamais tout seul : c'est ce détail, et lui
seul, qui bloquait tout. Zotijean le crée désormais, et le range avec vos
réglages plutôt que dans un dossier système — il est sauvegardé après chaque
synchronisation, parce qu'il vaut maintenant votre bibliothèque entière.

Un fichier d'origine n'est retiré que si le téléchargeur a réellement inscrit le
morceau. S'il ne l'a pas fait, l'Ogg reste en place et l'app vous le dit : mieux
vaut un fichier en trop qu'un téléchargement de dix-sept heures.

À savoir, et c'est écrit sous le réglage : tant qu'un retrait est demandé,
supprimer un morceau à la main ne le fera plus revenir tout seul.

### Les morceaux sont convertis pendant le téléchargement, plus après

Une synchronisation arrêtée en cours de route laissait ses fichiers dans le
format d'origine — et plus rien ne les reprenait jamais. Sur ce Mac, treize
titres étaient ainsi restés en Ogg alors que le réglage demandait du MP3, dans
des listes de lecture que Rekordbox ne sait pas lire. C'est précisément ce que
le choix du format devait éviter.

La conversion travaille désormais en même temps que le téléchargement : à
l'instant où vous appuyez sur « Arrêter », ce qui est descendu est déjà
converti. Un passage de rattrapage s'occupe en plus, au démarrage de chaque
synchronisation, des fichiers laissés en plan par le passé — sans rien
retélécharger.

Et l'avancement dit maintenant la conversion, pas seulement le téléchargement :
la moitié du travail était invisible.

### Une parole manquante n'était pas une erreur, et l'app le croyait

Le défaut le plus coûteux de la première mise en service. zotify allait chercher
les paroles de chaque titre — alors qu'elles étaient décochées —, échouait, et
écrivait une ligne contenant « failed ». Sur trois synchronisations réelles,
**19 des 22 « erreurs » étaient celle-là**, pendant que les morceaux arrivaient
entiers sur le disque.

Ce n'était pas qu'un chiffre faux. Cette fausse erreur empêchait de marquer une
playlist terminée, donc sa version Spotify n'était jamais enregistrée, donc elle
était retéléchargée en entier à chaque fois — et le planificateur espaçait la
tentative suivante. Une parole manquante déplaçait un horaire.

Quatre choses ont changé. zotify reçoit désormais les deux options qu'il faut
pour vraiment renoncer aux paroles. La ligne est reconnue pour ce qu'elle est :
une information. Et surtout, trois chiffres qui n'en faisaient qu'un sont
séparés — le nombre de lignes signalées, le nombre de titres réellement perdus,
et le fait qu'une playlist soit allée au bout. Le bandeau d'accueil,
l'historique et le rapport de diagnostic disaient tous « erreur » là où il n'y
avait rien de perdu.

Enfin, le message qui annonçait des playlists « qui n'ont rien donné » le disait
de playlists ayant livré tous leurs titres. Il dit maintenant ce qui s'est passé,
et nomme les playlists concernées au lieu d'afficher tantôt un nom, tantôt une
adresse.

### Racheter en sans-perte

Spotify plafonne à 320 kb/s et convertir ne récupère rien : le seul vrai FLAC est
celui qu'on rachète ailleurs. L'onglet Qualité gagne un bouton qui cherche, pour
chaque morceau de la bibliothèque, où il est vendu — et écrit une page de liens
cliquables à la racine du dossier de musique, plus un CSV.

Mesuré sur la bibliothèque réelle : **15 morceaux sur 17 ont un lien d'achat en
sans-perte**, dont 12 vers le morceau lui-même.

Le rapport ne ment pas sur ce qu'il sait. Quatre niveaux, écrits en toutes
lettres : un lien vers le morceau dont la vente a été vérifiée sur la page, un
lien vers l'album quand le morceau n'est pas vendu seul, un lien d'achat
seulement référencé ailleurs — et, pour le reste, une recherche à faire à la
main. Une boutique qui ne vend pas de sans-perte est signalée comme telle, même
quand le catalogue l'annonce en « achat ».

La durée est annoncée avant de cliquer, l'avancement défile pendant, et une
recherche interrompue reprend là où elle s'est arrêtée.

Ce qui avait été imaginé au départ — chercher par ISRC — a été mesuré puis
abandonné : sur ce répertoire, cette clé ne rendait **aucun lien sur treize**.
Le détail des chiffres est dans `docs/specs/racheter-en-sans-perte.md`.

### Les fichiers convertis perdaient toutes leurs étiquettes

Un morceau converti en MP3, FLAC ou AIFF sortait **sans artiste, sans titre, sans
album et sans identifiant** — alors que le fichier d'origine les portait tous.

La cause tient à une particularité de l'Ogg : il range ses étiquettes sur le flux
audio, pas sur le fichier. La conversion recopiait celles du fichier, où il n'y
avait rien. Le test qui gardait cette ligne vérifiait la présence de l'option,
jamais son effet.

Les fichiers déjà convertis restent sans étiquettes : le correctif ne vaut que
pour les conversions à venir.

### Les exports Rekordbox et Serato ignoraient les étiquettes des Ogg

Même cause, deuxième endroit, et il touchait le format que l'app produit par
défaut. Album, année, tonalité, label, remixeur, identifiant : rien n'arrivait
jusqu'à Rekordbox, qui ne recevait qu'un artiste et un titre déduits du nom de
fichier. C'était précisément ce que l'export XML était censé apporter.

---

*Ce qui suit vient d'un audit de fond mené le 21 août sur le programme entier,
et d'une campagne qui a cassé le code exprès pour vérifier que les tests le
remarquent. Ces défauts-là n'ont pas été trouvés en regardant l'application
tourner : ils étaient invisibles, et c'est ce qui les rendait chers.*

### Une synchronisation ratée ne se raconte plus comme un succès

**Le défaut le plus coûteux de cette version, et le seul dont la conséquence
n'avait pas de fin.**

Quand le téléchargeur démarrait puis mourait sans un mot — un environnement
Python abîmé, une bibliothèque manquante, l'application déplacée —, Zotijean n'y
voyait rien : aucune erreur, aucun titre perdu, aucune interruption. Il concluait
donc que tout allait bien. Il affichait « Aucune nouveauté » avec une pastille
verte, envoyait une notification rassurante, avançait sa date de référence et
remettait son compteur d'échecs à zéro. Puis il attendait 48 heures et
recommençait, à l'identique. **Indéfiniment, sans un seul signal.**

Rien n'était perdu. Rien n'était jamais téléchargé non plus — exactement le prix
payé de la 1.0 à la 1.0.4.

Deux autres pannes tombaient dans le même trou : une coupure réseau qui fige le
téléchargeur jusqu'à ce qu'un chien de garde le tue, et un ffmpeg présent mais
cassé — mauvaise architecture, bibliothèque manquante — que le diagnostic
déclarait bon parce qu'il ne regardait que son nom, jamais sa réponse. Ce
dernier point comptait double : sans un ffmpeg qui *fonctionne*, le téléchargeur
détruit des morceaux sans message.

La règle est désormais écrite dans le code, à trois endroits : **un succès ne se
déduit pas d'une absence d'erreur connue.** Il faut une preuve positive — un
fichier sur le disque, un code de sortie nul, une version lue.

### Le disque est surveillé PENDANT le téléchargement, plus seulement avant

Les trois garde-fous du disque — volume monté, place restante, conditions que
vous avez fixées — étaient bien vérifiés à chaque playlist, mais **avant** de
lancer le téléchargeur, jamais ensuite. Or deux mille titres à trente secondes
tiennent dans une seule playlist : le contrôle était donc fait une fois, à
l'instant zéro, pour seize heures et quarante minutes de travail.

Débrancher le disque externe à la troisième heure ne se voyait pas. macOS recrée
alors un dossier vide au même endroit, et treize heures de musique partaient sur
le disque de démarrage sans un mot — la panne que ce projet considère comme la
plus grave de toutes.

Le disque est maintenant relu toutes les cinq minutes pendant le téléchargement.
C'est un **report**, pas un échec : la date de référence n'avance pas, et la
synchronisation reprend d'elle-même dès que le disque revient.

### Un fichier de travail ne passe plus pour un morceau

Fermer l'application pendant une conversion laissait derrière elle un fichier
inachevé, invisible dans le Finder mais portant une extension audio. Il était
compté comme un morceau : il entrait dans la liste de lecture, dans l'export
Rekordbox, dans l'export Serato et dans le rapport des rachats — en double, sous
un nom que rien ne montrait, donc introuvable pour qui cherchait d'où venait le
doublon.

Ces restes sont désormais ramassés au début de chaque synchronisation, quand
rien ne convertit — et jamais pendant, ce qui reviendrait à retirer son fichier
au convertisseur en plein travail.

### La politique de retrait s'applique enfin aux morceaux accentués

« Archiver » et « Corbeille » ont été rendus fonctionnels plus haut dans cette
version. Ils ne s'appliquaient pourtant à **aucun morceau dont le titre porte un
accent** — c'est-à-dire à presque rien, dans une bibliothèque francophone.

La cause est un piège que ce projet connaît bien : le téléchargeur écrit son
journal depuis Python, Zotijean le relit depuis Node, et un « é » peut s'écrire
de deux façons différentes qui s'affichent à l'identique. C'était le seul endroit
du programme où ces deux mondes se comparaient directement, et le seul qui ne
passait pas par la protection prévue pour ça. L'application annonçait alors, à
tort, que ces morceaux dataient d'avant la mise en service du journal.

### L'application disait le contraire de la vérité sur Spotify Premium

**Un abonnement Premium est nécessaire pour télécharger. Toujours, sans
exception.** Ce n'est pas la condition de la meilleure qualité, c'est la
condition d'existence du logiciel.

Or cinq textes affirmaient le contraire, et de façon cohérente entre eux : une
qualité était présentée comme « celle d'un compte gratuit », les prérequis
disaient « Premium pour la meilleure qualité », et le message d'erreur — le seul
qui intercepte cet échec — conseillait de **baisser la qualité et de relancer**,
ce qui ne peut pas marcher et coûtait une seconde exécution de plusieurs heures.

Les cinq sont corrigés ensemble, et un contrôle automatique empêche désormais
l'une ou l'autre de ces formulations de revenir.

Au passage, une confusion voisine est levée. Il existe **deux connexions Spotify
distinctes** dans ce logiciel : celle du téléchargeur, obligatoire, et un accès
en lecture à vos playlists, facultatif, qui sert seulement à savoir ce qui
manque. Le mot « Facultatif » était posé sous un titre « Compte Spotify », ce qui
laissait conclure qu'aucun compte n'était nécessaire. Le titre nomme maintenant
ce que cet accès fait, et la première phrase dit lequel des deux reste
indispensable.

### Ce qui se voit moins, et qui compte quand même

- **La chaîne d'intégration sort de Node 20**, déprécié. Elle n'échouait pas
  encore — les serveurs compensaient — mais elle aurait cassé le jour où ce
  rattrapage disparaît, c'est-à-dire au moment de publier.
- **L'assistant de premier lancement défile.** À 356 pixels de large, son dernier
  paragraphe passait sous le pied de la fenêtre, inatteignable même au clavier.
- **La liste des rachats ne compte plus les fichiers cachés de macOS.**
- **L'application annonce enfin son vrai numéro de version** au service qui lui
  fournit les liens d'achat. Il était écrit en dur à un troisième endroit, oublié
  des deux autres, et disait encore « 1.0.7 » : le service en question exige
  précisément cet identifiant, et bloque les clients qui le renseignent mal. La
  version est désormais *lue*, plus recopiée — et un contrôle automatique refuse
  qu'on la réécrive à la main.

### Ce que la suite de tests garde vraiment

553 tests au lieu de 500, mais surtout : la suite a été **éprouvée en cassant le
code exprès**, 33 fois. Neuf de ces cassages ne faisaient tomber aucun test —
dont **les cinq du module d'authentification Spotify, qui n'était protégé par
rien**. On pouvait y accepter une réponse d'autorisation qui ne correspond pas à
la demande, déconnecter l'utilisateur à chaque renouvellement de jeton, ou
déclarer qu'un accès révoqué n'est jamais définitif.

Les neuf trous sont bouchés, et l'épreuve a été rejouée : **33 cassages, 33
détectés.**

### Ce que cette version ne prouve pas

Par honnêteté, parce que la liste compte autant que le reste :

- **Les deux connexions Spotify n'ont jamais été jouées en vrai.** Le flux
  d'autorisation, un accès révoqué, un jeton expiré : tout cela est du code
  vérifié par des doublures, jamais par Spotify.
- **Le message d'erreur Premium n'a jamais été affiché à l'écran.** Il est le
  seul à intercepter cet échec, et c'est celui que cette version réécrit.
- **Rien de cette version n'a été regardé à l'œil sur un Mac.** Les mesures
  d'affichage ont été calculées, pas vues.

Le détail de ce qui reste ouvert est dans `docs/reste-a-faire.md`.

## 1.0.7 — 17 août 2026

Une version qui ne change rien à ce que fait l'application, et beaucoup à ce
qu'on en voit. Plusieurs commandes étaient là depuis le début sans qu'on puisse
les distinguer du fond ; l'une d'elles était carrément illisible.

### Le bouton principal était illisible en thème clair

« Synchroniser », « Ajouter », « Connecter », « Enregistrer la sélection » : on
voyait la forme du bouton, pas le mot écrit dessus.

La cause tient en une ligne. La couleur du texte était fixée une fois pour
toutes, et elle avait été choisie pour l'orange vif du thème sombre — où elle
est parfaitement lisible. Mais le thème clair ne se contente pas d'éclaircir le
thème sombre : il **recalcule** ses couleurs, et ses orangés y deviennent des
bruns foncés. Un texte brun très sombre sur un fond brun foncé : la forme se
voit, le mot non.

### Ce qui se coche, se saisit et se clique se voit enfin

Une case à cocher décochée était à peine plus contrastée que le fond de sa
carte. Rien n'indiquait qu'il y avait là quelque chose à cocher. Le même défaut
touchait les puces rondes, les champs de texte, les jetons de nommage, les
bascules et les boutons — dix endroits, tous sous le seuil.

Ils ont désormais un contour franc, sans devenir criards : l'œil va toujours au
texte d'abord. Les bordures purement décoratives, elles, n'ont pas bougé — une
ligne qui ne dit rien n'a pas besoin de se voir.

Trois cas méritaient une attention particulière :

- **« Arrêter la synchronisation en cours »** n'avait pratiquement pas de
  contour. C'est le bouton qu'on cherche quand quelque chose va mal.
- **Le lien vers le tableau de bord Spotify**, dans la procédure de connexion,
  s'affichait dans le bleu par défaut du navigateur — presque noir sur fond
  sombre. C'est la première action de la seule procédure technique du programme.
- **Une bascule allumée** montrait un rond blanc sur orange clair, presque
  invisible. Le rond change maintenant de couleur avec l'état.

### Les explications ne se font plus passer pour des choix

Les encadrés qui expliquent un réglage avaient exactement l'apparence d'une
option sélectionnée : même fond orangé, même bordure. Dans la carte du format
des fichiers, la note glissée sous les cinq formats se lisait comme un sixième
format, coché lui aussi.

L'orange veut dire « vous avez choisi ceci » partout ailleurs dans
l'application. Il ne sert plus qu'à ça. Les explications ont désormais un fond
neutre et un filet vertical.

### « Tous les deux jours » s'affichait sur quatre lignes

Dans les réglages de vérification automatique, le titre de l'option recommandée
se cassait mot par mot — un mot par ligne — et faisait dépasser toute sa rangée
de cartes. L'étiquette « Recommandé » passe maintenant à la ligne d'un bloc, au
lieu de hacher le titre, et les cartes d'une même rangée ont la même hauteur.

### La fenêtre peut être rétrécie sans que la page déborde

En dessous d'environ 430 pixels de large, l'interface devenait plus large que sa
fenêtre : il fallait défiler horizontalement pour lire, sur tous les onglets.
Elle descend maintenant sous 280 pixels sans déborder.

### Sous le capot : des garde-fous qui ne gardaient rien

Le programme a été cassé volontairement, dix-sept fois, pour vérifier que ses
tests s'en apercevaient. **Cinq fois sur dix-sept, ils ne voyaient rien** — et
une relecture en a trouvé trois autres du même genre.

Le plus important concernait l'**écriture des fichiers de réglages**. Le
programme écrit d'abord dans un fichier provisoire, puis le met en place d'un
seul geste : c'est ce qui garantit qu'une coupure de courant ne laisse jamais
une configuration à moitié écrite. Rien ne vérifiait que ce détour existait
encore. Deux autres passaient tout aussi inaperçus : la protection qui **jette
un fichier converti manifestement raté** au lieu de le mettre dans votre
bibliothèque, et les **droits restrictifs du fichier de connexion Spotify**, qui
pouvait redevenir lisible par n'importe quel compte de la machine sans qu'aucun
test ne bronche.

Aucun de ces défauts n'était présent dans la 1.0.6 : c'est leur *filet de
sécurité* qui manquait. Il est posé.

### Ce qui reste connu et non corrigé

Le fichier `docs/reste-a-faire.md` recense désormais, avec ses mesures, ce qui
est imparfait et pourquoi ça ne l'a pas été dans cette version : huit contrastes
trop faibles dans la notice, trois dans l'application, et deux angles morts —
Safari n'a jamais rendu ces styles, et la connexion Spotify n'a jamais été jouée
en conditions réelles.

## 1.0.6 — 12 août 2026

La suite du travail de la 1.0.5 : confronter chaque supposition au code réel —
celui du téléchargeur, et celui de l'API Spotify.

### Le pont vers votre logiciel DJ, sans toucher aux fichiers

Nouvelle variable `{isrc}` dans le modèle personnalisé de rangement.
L'identifiant international du morceau — le même sur toutes les plateformes —
peut désormais figurer **dans le nom du fichier** :

```
{playlist}/{numéro} - {artiste} - {titre} [{isrc}]
```

C'est un repère fiable vers Rekordbox ou Serato qui ne réécrit **aucun octet**
du fichier — donc ne touche jamais aux points de repère que Serato stocke
dedans.

### Un épisode de podcast ne deviendra plus un morceau fantôme

Le filtre des épisodes testait un champ que la requête à Spotify ne demandait
pas — et Spotify ne renvoie que ce qu'on demande. Un épisode glissé dans une
playlist mixte serait devenu un morceau éternellement manquant, retenté à
chaque synchronisation.

### Les paroles deviennent votre choix

Le téléchargeur écrivait d'office un fichier de paroles (.lrc) à côté de chaque
morceau. C'est maintenant un réglage dans l'onglet Qualité — désactivé par
défaut : Rekordbox et Serato ignorent ces fichiers.

### Et le reste

L'écran d'accueil en art ASCII du téléchargeur ne pollue plus l'affichage de
progression ; le correctif majeur de la 1.0.5 est durci contre deux cas
limites ; et les variables indisponibles le disent dans leur description.

## 1.0.5 — 12 août 2026

**Prenez cette version. Les précédentes ne téléchargeaient rien.**

Toute cette version vient d'une seule démarche : lire le code source du
téléchargeur (zotify) et le confronter, ligne par ligne, à ce que Zotijean
supposait de lui. Huit suppositions étaient fausses. La pire rendait
l'application inutilisable — proprement, sans un message.

### Les versions précédentes ne téléchargeaient rien, et ne le disaient pas

Une option que Zotijean passait sans valeur avalait l'argument suivant sur la
ligne de commande : **l'adresse de votre playlist**. Le téléchargeur se lançait,
ne trouvait rien à faire, se terminait sans erreur. L'app affichait « aucune
nouveauté » à chaque synchronisation — indéfiniment, avec un bilan vert.

Reproduit contre le vrai analyseur d'arguments, corrigé, et verrouillé dans les
deux sens : la nouvelle version du téléchargeur exige une valeur, l'ancienne
l'interdit, et Zotijean reconnaît maintenant les deux à leur texte d'aide.

### La première connexion Spotify devient un lien cliquable

Si le téléchargeur n'est pas encore connecté à votre compte, il affiche une
adresse d'autorisation et attend. Avant : quinze minutes de silence, puis un
message parlant de blocage. Maintenant : un bandeau avec un **lien cliquable**
apparaît dans l'interface. Vous cliquez, vous autorisez, et le téléchargement
reprend tout seul.

### Le morceau supprimé revient, celui qui est là n'est plus compté deux fois

Le téléchargeur tenait sa propre liste de morceaux « déjà pris » et la croyait
plutôt que votre disque. Un morceau que vous effaciez restait inscrit : il ne
revenait jamais. Zotijean lui impose désormais la règle de la maison — **le
disque fait foi**.

### Un rangement cassé, un rangement réparé

« Par genre » ne pouvait pas fonctionner : le téléchargeur ne connaît pas cette
variable, et tous vos morceaux seraient tombés dans un dossier nommé
littéralement `{genre}`. L'option le dit maintenant honnêtement.

À l'inverse, **les albums et les artistes étaient cassés** : leurs variables de
playlist restaient vides et produisaient le même dossier absurde. Ils reçoivent
maintenant les bonnes variables — nom d'album, numéro de piste.

### La conversion n'est plus jamais confiée au téléchargeur

Quand vous choisissiez FLAC ou AIFF, Zotijean demandait la conversion au
téléchargeur. Or celui-ci **ne connaît ni l'un ni l'autre** — le fichier serait
sorti incohérent — et même pour les formats qu'il connaît, sa conversion est
sommaire et **jette l'Ogg d'origine**, celui que Zotijean promet de conserver
pour pouvoir changer de format sans tout retélécharger.

Le téléchargeur livre désormais toujours l'Ogg tel quel ; la conversion passe
par le module dédié de Zotijean, avec ses précautions (réduction propre en
16 bits, étiquettes AIFF, contrôle de taille, écriture atomique).

### Des centaines de fausses erreurs en moins

Le tableau de bord du téléchargeur répète en boucle une ligne contenant le mot
« Error » — même quand tout va bien. Chaque rafraîchissement comptait comme une
erreur : le journal se remplissait, et le bilan annonçait des dizaines de
morceaux « repris plus tard » alors que tout était là.

### Et le ménage

Les fragments de téléchargement interrompus (`.tmp`) sont supprimés, les codes
de couleur du terminal ne polluent plus l'affichage, et une erreur en couleur
est de nouveau reconnue comme une erreur.

## 1.0.4 — 12 août 2026

Cette version ne change rien à ce que Zotijean fait. Elle change ce qu'il vous
**dit** — parce que quatre de ses messages étaient faux, dépassés, ou taisaient
l'essentiel.

### Il annonçait un succès complet alors que des morceaux avaient échoué

Après dix-sept heures avec quarante pistes indisponibles dans votre pays, l'app
affichait « 1 960 nouveaux titres téléchargés. » et rien d'autre. Vous croyiez
tout avoir, et vous découvriez les manques des semaines plus tard en cherchant
un morceau précis.

Elle dit maintenant « 1 960 nouveaux titres, **40 repris plus tard** », ou
« 1 200 nouveaux titres — **synchronisation interrompue** », ou encore
« 3 nouveaux titres — **trop de demandes envoyées à Spotify** ».

### « Choisissez un autre dossier » quand c'est macOS qui bloque

Si le système refuse l'accès au dossier de musique, l'app vous envoyait en
choisir un autre. C'est le mauvais conseil : depuis Ventura, **les disques
externes demandent une autorisation explicite**, et le dossier n'a rien
d'anormal.

Le message nomme désormais le réglage exact à ouvrir, et précise — pour un
disque externe — que le disque *est* bien branché. Sans ça, on part chercher un
câble.

### Les dix-sept heures ne comptaient pas le téléchargement

Les durées annoncées ne comptent que l'attente volontaire entre deux morceaux.
Le téléchargement s'y ajoute. Annoncer dix-sept heures pour en vivre vingt-deux
ressemble à une promesse trahie — il suffisait de le préciser, c'est fait.

### Une explication devenue fausse

Sous les options de retrait, l'app expliquait qu'il faudrait « interroger l'API
Spotify, ce que Zotijean ne fait pas encore ». Cette connexion existe depuis.
Rien ne change dans le comportement — **aucun de vos fichiers n'est jamais
déplacé ni jeté** — mais la raison donnée est maintenant la vraie.

## 1.0.3 — 12 août 2026

Deux défauts qui ne frappaient qu'au **tout premier lancement** — c'est-à-dire
au pire moment possible. **Prenez cette version plutôt qu'une plus ancienne si
vous installez Zotijean pour la première fois.**

### L'installation pouvait se saboter elle-même

Au premier démarrage, l'app prépare son téléchargeur. Cette préparation commence
par faire table rase. Or deux vérifications de l'installation partaient presque
en même temps — celle du moteur au lancement, celle de l'interface qui venait de
s'ouvrir — et lançaient chacune leur préparation : l'une effaçait le dossier que
l'autre était en train de remplir.

L'installation échouait, ou restait à moitié faite, sur la seule opération qui
doit réussir pour que l'app serve à quelque chose. Et le message parlait
d'environnement Python plutôt que de la vraie cause.

### Le premier double-clic ne montrait rien

L'app n'affichait qu'une petite icône en haut de l'écran. Rien ne disait qu'elle
avait démarré, et le premier lancement guidé — écrit précisément pour ce
moment — pouvait ne jamais être vu.

Le tableau de bord s'ouvre maintenant tout seul la **première fois**, une fois
le moteur prêt. Pas les fois suivantes : une app censée se faire oublier n'a pas
à s'imposer à chaque démarrage.

### Vos réglages existent maintenant sur le disque

Ils n'étaient écrits que le jour où vous changiez quelque chose. Ils sont posés
dès le premier démarrage — consultables et modifiables même si l'interface
refuse de s'ouvrir.

## 1.0.2 — 12 août 2026

Lisibilité de l'affichage, et une panne de planification qui pouvait bloquer la
synchronisation pendant des jours.

### La synchronisation pouvait rester bloquée trois jours

Zotijean note la date de sa dernière tentative. Si cette date se retrouve dans
le futur — l'horloge du Mac a été corrigée, vous avez changé de fuseau, ou vos
réglages viennent d'une autre machine —, le calcul de l'espacement après un
échec partait en vrille et **reportait la synchronisation à chaque fois**.
Mesuré : soixante-treize heures de blocage complet pour une avance de trois
jours, sans le moindre message.

Une date incohérente est maintenant simplement ignorée.

### Le texte qui explique chaque choix était le moins lisible de l'app

Sous chaque réglage, une ligne dit franchement ce qu'on gagne et ce qu'on perd.
C'est le texte le plus utile de Zotijean, et c'était le plus pâle.

Mesuré dans un vrai navigateur, dans les deux thèmes. En **thème clair**, deux
couleurs n'étaient carrément pas prévues pour un fond blanc : l'orange des
avertissements arrivait à 1,86 pour 1 de contraste — autant écrire en blanc sur
blanc — et c'est justement la couleur de ce qu'il ne faut pas rater. En **thème
sombre**, le texte d'aide était sous le seuil de lisibilité du texte courant.

Toutes les couleurs des deux thèmes passent maintenant le seuil, sur fond de
carte comme sur fond de page.

### Une connexion Spotify révoquée s'affichait comme « connecté »

Si Spotify retire son autorisation — mot de passe changé, accès révoqué depuis
votre compte —, l'app continuait d'annoncer une connexion valide pendant que
toutes les fonctions qui en dépendent échouaient en silence.

Elle le dit maintenant, et distingue ce cas de « jamais connecté » : vous n'avez
pas raté une étape, c'est votre autorisation qui a été annulée. Vos
téléchargements ne sont pas concernés — ils passent par zotify, pas par cette
connexion.

### Une erreur de téléchargement ne se distinguait plus des lignes ordinaires

Une piste indisponible dans votre pays, une clé audio refusée : ça défilait au
milieu du reste. La ligne d'avancement change maintenant de couleur.

### Deux précisions dans le manuel

Ce que la mise en veille change vraiment, et à quoi sert le dossier
`_incomplets` si vous tombez dessus.

### Un échec silencieux de moins

Quand un morceau tronqué ne peut pas être mis de côté — droits refusés, disque
en lecture seule —, le journal le dit maintenant, avec quoi faire. Avant, le
titre aurait manqué indéfiniment sans aucune explication.

## 1.0.1 — 12 août 2026

Huit correctifs trouvés par un audit de la 1.0. Ils se déclenchent tous pendant un
gros rattrapage — celui de la première utilisation, justement. **Mise à jour
recommandée avant votre première grosse synchronisation.**

### L'app avait l'air plantée pendant toute la nuit

L'avancement n'atteignait jamais l'écran : ni le titre en cours, ni le
pourcentage. L'interface affichait « Préparation… » pendant les dix-sept heures
d'un rattrapage de 2 000 titres. Une application qui n'avance pas de la nuit
passe pour bloquée, et on la force à quitter — en pleine écriture d'un fichier.

C'est corrigé, et c'est le correctif le plus important : il évitait le suivant.

### Un morceau coupé en pleine écriture restait sur le disque

Si l'app était interrompue au milieu d'un téléchargement, le fichier tronqué
restait là. Deux conséquences, toutes deux silencieuses :

- Le téléchargeur voyait le fichier et **sautait le morceau à chaque
  synchronisation suivante**. Le titre était définitivement absent, pendant que
  l'app annonçait « aucune nouveauté ».
- Un morceau coupé après dix secondes pèse assez pour passer pour un
  téléchargement réussi : il était converti, ajouté aux listes de lecture et
  **exporté vers Rekordbox et Serato**. On le découvrait en le jouant.

Ces fichiers partent désormais dans un dossier `_incomplets`. Rien n'est jamais
supprimé, et le morceau est retéléchargé tout seul. Le diagnostic vous dit
combien il y en a et que vous pouvez vider ce dossier.

### Le Mac s'endormait au milieu

Rien n'empêchait la veille. Les dix-sept heures annoncées s'étalaient en réalité
sur plusieurs jours, avec une interruption à chaque cycle de sommeil.

Zotijean empêche maintenant le Mac de s'endormir tout seul pendant une
synchronisation. **Fermer le couvercle l'endort quand même** — c'est écrit dans
la simulation, à côté de la durée annoncée.

### Vos réglages ne tenaient que la première seconde

« Seulement sur secteur » et « seulement en Wi-Fi » n'étaient vérifiés qu'au
moment de démarrer. On lance chez soi branché en Wi-Fi, on débranche trois heures
plus tard et on part avec le partage de connexion du téléphone : le
téléchargement continuait quatorze heures sur batterie et sur données mobiles.
Une quinzaine de gigaoctets en itinérance, alors que la case était cochée.

Ces conditions sont maintenant relues tout au long de l'exécution. Ce n'est pas
un échec mais une **pause** : ça repart tout seul dès que vous rebranchez, sans
refaire les playlists déjà traitées.

### L'espace disque n'était vérifié qu'au départ

Un disque qui se remplit en cours de route, c'est un téléchargeur qui continue
d'écrire dans le vide. Le seuil que vous avez fixé est désormais relu playlist
après playlist.

### Les crates Serato s'écrivent maintenant comme le reste

L'export Rekordbox était protégé contre une coupure en pleine écriture, les
crates Serato non. Une panne de courant au mauvais moment laissait un fichier
tronqué, que Serato lisait tel quel au démarrage suivant. Elles passent
désormais par le même chemin sûr.

### L'export DJ montre qu'il travaille

Il sonde chaque fichier de la bibliothèque un par un : sur 2 000 titres, ça prend
plusieurs minutes pendant lesquelles l'écran affichait un message figé. Un
compteur avance maintenant, avec le fichier en cours.

### Et l'historique dit enfin pourquoi

« Interrompue » tout court n'apprenait rien. Il donne maintenant la raison, et
précise que la reprise sera automatique.

## 1.0.0 — 11 août 2026

Première version publiée. Zotijean surveille des playlists Spotify, télécharge
les nouveaux titres via zotify et les range selon un schéma choisi.

### L'essentiel

- **Surveillance automatique** des playlists, au rythme de votre choix (48 h par
  défaut). L'horloge est une horloge murale : une nuit de veille du Mac ne
  décale plus rien.
- **Seuls les titres manquants sont téléchargés.** Zotijean lit le dossier de
  destination et compare, plutôt que de faire confiance à un historique.
- **Six schémas de rangement** — par playlist, par artiste, par genre, par date
  d'ajout, à plat — plus un modèle libre à composer soi-même.
- **Connexion Spotify facultative.** Sans elle, Zotijean fonctionne. Avec elle,
  il connaît la composition exacte des playlists et sait passer celles qui
  n'ont pas changé.
- **Export vers Rekordbox et Serato**, dans leurs formats respectifs.
- **Simulation avant de s'engager** : durée, place disque et nombre de titres,
  sans rien télécharger.
- **Diagnostic permanent** de l'installation, exportable pour poser une
  question.

### Ce qui vous protège

- **Rien n'est jamais supprimé par défaut.** Un titre retiré d'une playlist est
  conservé, archivé ou mis à la corbeille — vous choisissez, et le premier
  choix est de tout garder.
- **ffmpeg est vérifié avant tout téléchargement.** Sans lui, zotify renomme le
  fichier avant de découvrir son absence et ne le restaure jamais : des morceaux
  détruits sans message. Zotijean refuse de démarrer une synchronisation dans
  cet état.
- **Le volume de destination est vérifié comme monté**, pas comme existant. Un
  disque externe débranché fait apparaître un dossier vide à la même adresse —
  et provoquerait le retéléchargement de toute la bibliothèque sur le disque
  interne.
- **Écritures atomiques** pour tout fichier de réglages : une coupure de courant
  ne peut pas corrompre votre configuration.
- **Une seule synchronisation à la fois**, garantie par un verrou.
- **Reprise après interruption** : un téléchargement coupé reprend là où il en
  était, sans recommencer ni oublier.

### Le paquet macOS

- **Rien à installer.** L'application contient le moteur, Python, ffmpeg et le
  téléchargeur. Elle ne demande rien au Mac.
- **Le moteur s'arrête avec l'application**, y compris après un « forcer à
  quitter » ou un plantage.
- **Le port est repris** si un moteur y traîne encore après un plantage — mais
  jamais celui d'un autre programme, qui est identifié avant toute action.

### Ce que Zotijean ne fera pas

- **Pas de FLAC depuis Spotify.** Le plafond réel est l'Ogg Vorbis 320 kb/s, et
  il exige Spotify Premium. Le lossless de Spotify passe par un canal fermé,
  inaccessible. Convertir un Ogg en FLAC n'ajoute aucune perte, mais ne récupère
  rien non plus.
- **Rekordbox ne lit pas l'Ogg Vorbis.** Il n'existe donc aucun chemin sans
  conversion de Spotify vers Rekordbox. Serato, lui, le lit tel quel.
- **Comptez environ 17 heures pour 2 000 titres.** Zotijean attend une trentaine
  de secondes entre chaque morceau, volontairement : c'est ce qui évite les
  erreurs de clé audio et limite le risque pour votre compte.
