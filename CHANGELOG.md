# Journal des versions

## 1.0.1 — 12 août 2026

Six correctifs trouvés par un audit de la 1.0. Ils se déclenchent tous pendant un
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
