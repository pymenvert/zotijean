# Zotijean — instructions du projet

Compagnon de **zotify** : surveille des playlists Spotify, télécharge automatiquement
les nouveaux titres selon un rythme configurable (48 h par défaut), et les range selon
des schémas d'organisation choisis par l'utilisateur.

Dépôt : `pymenvert/zotijean`. Langue du projet : **français** (code, commentaires,
commits, interface).

---

## Architecture — et pourquoi

**Moteur Node.js + interface web, zéro dépendance npm.** C'est le modèle éprouvé de
`cascade` et `pixelpusherbridge` : le programme tourne à l'identique sur Windows et
macOS, se lance par double-clic, et l'interface se regarde dans un navigateur.

Ce choix n'est pas esthétique, il est **structurel** : Pym développe depuis un PC
Windows alors que la cible est un Mac. Une app Swift native ne serait ni compilable ni
observable depuis le poste de développement. Node.js supprime le problème entièrement.

La coquille de barre des menus macOS viendra **après**, en Swift, compilée par GitHub
Actions. Elle n'a aucune interface à dessiner (un glyphe template + un `NSMenu` natif),
donc elle peut être écrite sans être vue. Toute la conception visuelle vit dans
`public/`.

**Ne pas réintroduire de dépendances npm.** Tout ce qui est utilisé vient de la
bibliothèque standard : `node:http`, `node:fs`, `node:path`, `node:child_process`,
`node:os`, `node:crypto`.

**zotify est piloté en sous-processus, jamais réimplémenté ni embarqué.** Pym l'a déjà
installé et authentifié sur son Mac. L'app appelle son binaire existant. Cela supprime
les deux plus gros postes de risque du projet : l'empaquetage d'un runtime Python signé,
et le pilotage du flux d'authentification librespot.

---

## Faits établis par la recherche — à ne pas redécouvrir

Ces points ont été vérifiés sur sources primaires en août 2026. Ils contraignent le code.

### Pilotage de zotify

- **Le code de sortie de zotify vaut `0` même quand des pistes échouent.** La seule
  vérité est la **vérification sur disque** : le fichier existe, sa taille est plausible.
  `stdout` ne sert qu'à la progression affichée.
- **La sortie utilise des retours chariot (`\r`)**, pas seulement des sauts de ligne.
  Un découpeur sur `\n` seul ne reçoit rien jusqu'à la fin du processus.
- **Le dépôt `zotify-dev/zotify` est mort depuis septembre 2024.** Le fork vivant est
  `Googolplexed0/zotify`. Toute documentation trouvée en ligne décrit probablement le
  dépôt mort — d'où le module `doctor.js`, qui interroge l'installation réelle plutôt
  que de supposer.
- **Sans ffmpeg dans le `PATH`, zotify renomme le fichier avant de découvrir l'absence
  et ne le restaure jamais** : des morceaux détruits sans message d'erreur. Vérifier
  ffmpeg au démarrage est non négociable.
- **Rythme : ~30 s entre les pistes** (`--bulk-wait-time`) pour éviter les erreurs de
  clé audio et limiter le risque de suspension de compte. Soit ~17 h pour 2 000 titres.
  L'interface doit annoncer cette durée, jamais la masquer.
- **`--lyrics-to-file false` ne suffit PAS à couper les paroles.** `fetch_lyrics`
  (`api.py`) ne renonce que si `lyrics_to_file` ET `lyrics_to_metadata` sont faux,
  et le second vaut `True` par défaut. zotify interroge donc les paroles de chaque
  titre, échoue le plus souvent, et écrit une ligne `SKIPPING: LYRICS FOR …
  (FAILED TO FETCH)` qui contient le mot « failed ». Vérifié sur sa source et
  sur trois exécutions réelles le 19 août 2026 : 19 des 22 « erreurs » venaient
  de là.
- **Toutes ses lignes ne sont pas des erreurs, même celles qui disent
  « failed ».** Une ligne d'information comptée comme erreur ne gonfle pas
  seulement un chiffre : elle empêche de marquer une playlist terminée, la remet
  en tête de la file, et espace la prochaine tentative planifiée. Trois chiffres
  doivent rester distincts : les lignes signalées, les titres perdus, et le fait
  d'être allé au bout.
- **`GRAVITÉ.INFO` ne veut pas dire « sans importance », mais « rien à
  reprendre ».** Un morceau retiré du catalogue n'arrivera jamais ; le compter
  comme perdu ferait reprendre la playlist indéfiniment.
- **Son journal global (`.song_archive`) ne se crée JAMAIS tout seul.**
  `SongArchive.__init__` (`utils.py:320`) pose
  `disabled = not Path(filepath).exists()`, et `add_obj` sort aussitôt : absent,
  il le reste pour toujours. Le créer vide une fois est ce qui débloque
  `--skip-prev-downloaded`, donc toute politique de retrait des fichiers
  d'origine. `--song-archive-location` prend un DOSSIER, auquel zotify ajoute
  lui-même le nom du fichier.
- **Il télécharge en `.tmp` puis renomme** : un fichier portant une extension
  audio est complet. C'est ce qui autorise à convertir PENDANT le téléchargement,
  et donc à ne jamais laisser de fichier dans le mauvais format après un arrêt.

### Qualité et formats

- Le plafond est l'**Ogg Vorbis 320 kb/s**, et il exige Spotify Premium. Le lossless
  Spotify (FLAC, livré en septembre 2025, inclus dans Premium) passe par un pipeline
  propriétaire **inaccessible à librespot**. Ne jamais laisser croire le contraire dans
  l'interface.
- **Rekordbox ne lit pas l'Ogg Vorbis.** Serato le lit nativement. Il n'existe donc
  aucun chemin « zéro conversion » de Spotify vers Rekordbox.
- Convertir un Ogg en FLAC ou AIFF **n'ajoute aucune perte** (on emballe le PCM décodé)
  mais **ne récupère rien** non plus. Convertir en MP3 ou AAC ajoute une vraie seconde
  génération de perte. Ces deux phrases doivent apparaître telles quelles dans l'UI.

### Système de fichiers

- **Normalisation NFC systématique** à l'écriture *et* à la comparaison. macOS conserve
  les octets tels quels : un « é » écrit en NFD par un outil et comparé en NFC par un
  autre désigne deux chaînes différentes pour le **même fichier**. C'est la cause
  numéro un de retéléchargements infinis dans une bibliothèque francophone.
- **Troncature sur les octets UTF-8, pas les caractères** (limite = 255 octets), en
  reculant jusqu'à une frontière valide. Tronquer au milieu d'une séquence produit un
  fichier illisible.
- **Vérifier que le volume est monté**, jamais l'existence du chemin : si un disque
  externe est débranché, macOS recrée un dossier vide sous `/Volumes/` et l'app
  retéléchargerait tout sur le disque de démarrage.

### Planification

- Un minuteur classique **gèle pendant la veille du Mac** : après dix nuits, un « 48 h »
  se déclenche à 58 h. `launchd` **perd** tout intervalle échu pendant la veille.
- La seule approche qui survit : **horloge murale + battement de cœur**. On persiste
  `dernierSuccès`, on réévalue toutes les 5 minutes, on compare des dates absolues.
  Prévoir une garde contre le recul d'horloge.
- Un garde-fou qui échoue **reporte** l'exécution sans avancer `dernierSuccès`.

---

## Règles de conception

- **Tout ce qui est arbitrable est configurable**, avec une **ligne d'explication
  honnête sous chaque choix**, incluant l'inconvénient. Ce texte fait partie du livrable,
  pas de la documentation. Pym est non-développeur : pas de jargon, pas de sigles nus.
- **On ne supprime jamais par défaut.** Politique de retrait en trois options, la
  première cochée : Conserver / Archiver / Corbeille. Jamais d'`unlink` direct.
- **Écritures atomiques** pour tout fichier d'état : écrire dans un `.tmp` puis
  renommer. Une coupure de courant ne doit jamais corrompre la configuration.
- **Une seule exécution à la fois**, garantie par un fichier verrou.
- Messages d'erreur en français, orientés action : ce qui s'est passé, ce que ça
  implique, quoi faire.

---

## Profil projet

Bloc lu par les commandes `/flow:*`. Chaque commande y figurant a été exécutée et
vérifiée le 16 août 2026 — jamais écrite au jugé.

- **type** : web (moteur local + interface dans le navigateur)
- **stack** : Node.js 22, runner de test natif, zéro dépendance npm
  (22.14.0 dans le paquet, `22` en intégration continue, `>=20` déclaré)
- **format** : aucun
- **lint** : aucun
- **typecheck** : aucun
- **test** : `node --test` → 500 tests. **500 verts sur macOS**, la cible ;
  le PC Windows en ignore 13, faute de pouvoir lancer le leurre zotify
- **build** : aucun en local ; le paquet est construit par
  `.github/workflows/publication.yml`
- **run** : `node server.js` → http://127.0.0.1:8787
- **critique** : `chemins`, `correspondance`, `organisation`, `conversion`,
  `planificateur` — une panne y détruit ou reperd des fichiers

---

## Commandes

```
node server.js            # démarre le moteur + l'interface web sur http://127.0.0.1:8787
node server.js --port 9000
node --test               # lance les tests (runner natif de Node, aucune dépendance)
```

Sur le Mac, `Zotijean - Mac.command` fait la même chose par double-clic.

**`node --test tests/` ne fonctionne pas.** Passer le dossier ne découvre plus les
fichiers : la commande rapporte un test unique et un échec, ce qui donne l'illusion
d'une suite cassée alors qu'elle est verte. Utiliser `node --test` sans argument,
comme le script `test` du `package.json`. Revérifié sous Node 22.14.0 le 19 août
2026 — ce n'est pas propre à une version récente.

**Le Mac de destination n'a AUCUN Node installé** : le paquet embarque le sien
dans `Contents/Resources/outils/node/`. Un script de test qui appelle « node » par
le `PATH` y sort en 127 — c'est ce qui faisait tomber six tests d'intégration sur
la machine cible pendant qu'ils passaient partout ailleurs. Utiliser
`process.execPath`.

**Lancer le serveur démarre le planificateur** (`planificateur.démarrer`, à la fin de
`server.js`), qui peut déclencher une synchronisation réelle. Sur le PC de
développement c'est sans effet — `zotify` n'y est pas installé — mais sur le Mac,
lancer le serveur n'est pas un geste neutre.

---

## État du projet

**Version 1.0.7 publiée** (17 août 2026). Le moteur, l'interface et la coquille de barre
des menus macOS sont écrits ; le paquet embarque Node, Python, ffmpeg et zotify, tous en
arm64. Voir `CHANGELOG.md`.

**Version 1.1.0 préparée** (19 août 2026), **non publiée** : elle n'est ni taguée
ni poussée. C'est la première version écrite après avoir vu l'application tourner
sur son Mac, avec le vrai zotify et une vraie bibliothèque.

Ce que cette mise en service a coûté, et qui est corrigé ici : une parole
manquante comptée comme un titre perdu (et donc un horaire de synchronisation
déplacé), treize fichiers coincés dans le mauvais format sans que rien ne les
rattrape, une politique de retrait refusée en silence à chaque exécution, six
réglages muets, et des pannes affichées en anglais brut. S'y ajoute une
fonctionnalité : retrouver où racheter chaque morceau en sans-perte.

**Toujours pas vu à l'œil sur cet écran.** Tout ce qui est visuel a été mesuré
par le moteur de rendu — contrastes composés, largeurs, nombres de lignes — et
une partie regardée dans un navigateur, mais la capture d'écran système rend une
image noire faute d'autorisation. Un chiffre conforme et un écran laid cohabitent
toujours aussi bien.

### La leçon qui revient : la pièce est juste, l'assemblage ment

Quatre défauts de la 1.1.0 partagent exactement cette forme, et aucun test
unitaire ne pouvait les voir :

- le catalogue savait traduire les erreurs ; le journal recopiait l'anglais ;
- les explications des réglages existaient ; l'interface écrivait `''` en dur ;
- la conversion marchait ; personne ne rattrapait ce qu'une interruption laissait ;
- `compterTitresPerdus` n'existait pas, mais chaque pièce du comptage était juste.

Corollaire pour les tests : un garde posé sur une seule pièce reste vert sur une
application cassée. Chaque lot de cette version ajoute donc un test qui rejoue le
CHAÎNAGE, et chacun a été éprouvé en cassant le code exprès.

### La leçon de la 1.0.5 : confronter, pas supposer

Dix suppositions sur zotify se sont révélées fausses en LISANT SON CODE SOURCE
(`Googolplexed0/zotify`, dépôt clonable, fichiers `config.py`, `api.py`,
`__main__.py`, `termoutput.py`). La pire : ses options booléennes exigent une valeur —
`--skip-existing` passé en drapeau nu avalait l'URL de la playlist, et **aucune version
publiée avant la 1.0.5 n'a jamais rien téléchargé**. Invisible par les 300 tests : la
doublure acceptait tout.

Avant d'écrire du code qui parle à zotify, vérifier dans sa source. Les acquis :
- Options booléennes : style « à valeur » (fork vivant) ou « drapeau nu » (vieux fork),
  détecté par le nom en capitales dans le texte d'aide.
- Sa table d'extensions ignore flac et aiff → ne JAMAIS lui déléguer la conversion.
- Il croit son archive interne, pas le disque → `--disable-directory-archives true`.
- `{playlist}`/`{playlist_num}` ne sont substitués que pour une source playlist ;
  `{genre}` n'existe pas du tout.
- Sans identifiants, il affiche une URL de connexion et attend un rappel HTTP.
- Il télécharge en `.tmp` puis renomme : un fichier à extension audio est complet.
- Son tableau de bord répète « Last Encountered Error: None » — pas une erreur.

### Ce que l'audit de la 1.0 a appris, et qui vaut pour la suite

Une vingtaine de défauts corrigés de la 1.0.1 à la 1.0.4, et presque tous partagent un
trait : **le code fonctionnait.** Chaque pièce était correcte, testée, verte. Ce qui
cassait, c'était leur assemblage — ou la phrase posée à côté.

Cinq réflexes, chacun payé par un vrai défaut :

- **Tester le chaînage, pas seulement les pièces.** L'avancement n'atteignait jamais
  l'écran à cause d'un ordre de clés dans un objet étalé ; 264 tests verts ne l'ont pas
  vu. Quand deux modules se parlent par un contrat implicite, écrire un test qui rejoue
  la condition exacte du consommateur.
- **Une opération longue doit prouver qu'elle avance.** Un écran figé est indiscernable
  d'un blocage : l'utilisateur force la fermeture, et déclenche les dégâts suivants.
- **Un garde-fou vérifié une seule fois au démarrage n'en est pas un.** Secteur, Wi-Fi,
  espace disque, volume monté : tout se relit pendant l'exécution.
- **Une explication vieillit.** Quatre textes honnêtes le jour où ils ont été écrits
  annonçaient en 1.0.3 des limites levées depuis. Aucun test ne détecte ça. Après avoir
  ajouté une capacité, relire ce que l'app dit d'elle-même.
- **Un détecteur qui ne trouve rien doit d'abord prouver qu'il trouve.** Deux balayages
  de code mort sont revenus vides parce que l'outillage mangeait les antislashs. Faire
  démarrer tout scanner par un cas positif connu.

### Pièges de l'outillage, vérifiés à la dure

- **Les heredocs de cette session mangent les antislashs.** `'\\b'` arrive en `'\b'`
  (retour arrière). A cassé une regex de nommage de fichiers, puis rendu deux scanners
  silencieux. Pour éditer du code, passer par l'outil d'édition, jamais par une
  manipulation de chaînes.
- **`io.open(f,'w').write(io.open(f).read())` vide le fichier** : Python tronque avant
  d'évaluer l'argument.
- **Un test ne doit jamais hériter de `process.platform`** : il passe sur le poste
  Windows et échoue sur le serveur macOS, le seul qui compte ici.

Publier une version : bumper `package.json` **et** `macos/Info.plist` (mêmes numéros),
compléter `CHANGELOG.md`, commiter, **attendre la CI verte**, puis pousser le tag
`vX.Y.Z` — `.github/workflows/publication.yml` construit et publie la release. Il refuse
un paquet incomplet ou non natif Apple Silicon.

Trois choses qui ne se devinent pas, et qui ont chacune coûté du temps le 19 août 2026 :

- **La CI ne se déclenche PAS quand on pousse une branche.** `tests.yml` écoute
  `push` sur `main`, les demandes de fusion, et `workflow_dispatch`. Pousser
  `release/1.1.0` ne lance donc rien, et on croit la branche vérifiée alors que
  rien n'a tourné. Pour l'éprouver : ouvrir la demande de fusion, ou
  `gh workflow run Tests --ref <branche>`.
- **Toucher à un fichier de `.github/workflows/` exige la portée `workflow`**
  sur le jeton, en plus de `repo`. Sans elle GitHub REFUSE la poussée entière —
  pas seulement ce fichier — avec un message explicite. `gh auth refresh -s workflow`.
- **Une machine neuve n'a aucun identifiant git** : ni clé SSH, ni jeton dans le
  trousseau. `git push` échoue sur « could not read Username ». Il faut
  s'authentifier une fois avant toute publication.

### Ce qui reste ouvert : `docs/reste-a-faire.md`

Défauts connus non corrigés, chantiers en pause, et surtout **ce qui n'a jamais été
vérifié en conditions réelles** — zotify réel, l'API Spotify réelle, un vrai Mac, Safari.
C'est la frontière à garder en tête avant d'affirmer que quelque chose « marche ».

**Ne rien dupliquer ici.** Ce fichier-ci dit ce qui CONTRAINT le code : des invariants,
qui ne se rayent pas. `docs/reste-a-faire.md` dit ce qui est OUVERT : tout y est destiné
à disparaître une ligne à la fois. Les deux listes ont divergé le jour même où la seconde
a été créée — trois éléments en double, et une phrase devenue fausse ici.

Une seule chose à savoir, parce qu'elle ne se devine pas : ce `CLAUDE.md` est chargé
automatiquement à chaque conversation, `docs/reste-a-faire.md` non. Il faut aller
l'ouvrir.
