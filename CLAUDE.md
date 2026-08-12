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

## Commandes

```
node server.js            # démarre le moteur + l'interface web sur http://127.0.0.1:8787
node server.js --port 9000
node --test tests/        # lance les tests (runner natif de Node, aucune dépendance)
```

Sur le Mac, `Zotijean - Mac.command` fait la même chose par double-clic.

---

## État du projet

**Version 1.0.4 publiée** (12 août 2026). Le moteur, l'interface et la coquille de barre
des menus macOS sont écrits ; le paquet embarque Node, Python, ffmpeg et zotify, tous en
arm64. 289 tests. Voir `CHANGELOG.md`.

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

### Ce qui n'a jamais été vérifié en conditions réelles

Tout ce qui suit est testé contre des doublures, jamais contre le vrai service. C'est la
frontière à garder en tête avant d'affirmer que quelque chose « marche » :

- **zotify réel** — le format exact de sa sortie, ses codes d'erreur, son comportement
  quand une piste est indisponible dans le pays.
- **L'API Spotify réelle** — le flux OAuth complet dans un vrai navigateur, la
  pagination sur de grosses playlists, les quotas.
- **Un vrai Mac** — la CI construit le paquet et le démarre, mais personne n'a encore
  double-cliqué dessus sur la machine de destination.

### Reste à faire

- **Écrire les ISRC dans les tags des fichiers** (le « pont sans perte »). Ils sont déjà
  récupérés et affichés, mais pas écrits : réécrire un fichier détruirait les points de
  repère et les grilles rythmiques que Serato stocke à l'intérieur. Il faut une passe qui
  préserve les blocs de tags inconnus.
- Quelques contrastes du thème clair, relevés lors de la revue visuelle.
