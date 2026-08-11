# Journal des versions

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
