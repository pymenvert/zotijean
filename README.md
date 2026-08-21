# Zotijean

Compagnon de [zotify](https://github.com/Googolplexed0/zotify) : surveille vos playlists
Spotify, télécharge automatiquement les nouveaux titres au rythme que vous choisissez, et
les range selon le schéma d'organisation qui vous convient.

Interface web soignée, zéro dépendance à installer, un seul fichier à double-cliquer.

---

## Ce que ça fait

- **Surveille des playlists, des albums ou des artistes** Spotify, autant que vous voulez.
- **Vérifie toutes les 48 h** — ou 6 h, ou une fois par semaine : c'est un réglage.
- **Range les fichiers comme vous le voulez** : un dossier par playlist, une bibliothèque
  par artiste et album, par genre, par année, à plat, ou selon votre propre modèle — avec
  un aperçu en direct du résultat.
- **Explique chaque choix.** Sous chaque option, une phrase qui dit franchement ce qu'on
  gagne et ce qu'on perd. Pas de jargon.
- **Ne supprime jamais rien** sans que vous l'ayez demandé.

## Ce que ça ne fait pas

Zotijean **ne télécharge rien lui-même**. Il pilote votre installation de zotify, qui doit
déjà être installée et connectée à votre compte Spotify. C'est un choix délibéré : il n'y
a rien à réinstaller, rien à réauthentifier, et votre configuration zotify existante
continue de fonctionner exactement comme avant.

---

## Installation

**Rien à installer.** Téléchargez `Zotijean.zip` depuis la
[dernière version publiée](https://github.com/pymenvert/zotijean/releases/latest),
décompressez, glissez `Zotijean.app` dans Applications, et double-cliquez.

L'application embarque Node.js, Python, ffmpeg et zotify, tous en version Apple Silicon
native. Elle ne demande rien à votre Mac.

Deux choses restent à faire, et aucun paquet ne peut les éviter :

1. **Au tout premier lancement**, macOS affiche un avertissement pour toute application
   téléchargée hors de l'App Store. Faites un **clic droit sur l'app, puis Ouvrir**. Une
   seule fois.
2. **Connectez votre compte Spotify.** Zotijean pilote zotify, qui a besoin de vos
   identifiants — ils ne peuvent évidemment pas voyager dans le paquet. L'onglet
   **Diagnostic** vous dit où vous en êtes.

La première chose à regarder est justement cet onglet **Diagnostic** : il vérifie chaque
pièce et dit précisément quoi faire si quelque chose manque.

### Pour développer

Le moteur seul tourne partout où Node.js 20+ est installé, sans construire de paquet :

- **macOS** : `Zotijean - Mac.command`
- **Windows** : `Zotijean - PC.bat`

Dans ce mode, zotify et ffmpeg doivent être installés sur la machine
(`brew install ffmpeg`).

### Construire le paquet soi-même

Sur un Mac, avec Xcode installé :

```bash
cd macos && ./outils.sh && ./construire.sh
```

`outils.sh` télécharge Node, Python, ffmpeg et les paquets de zotify (quelques centaines de
mégaoctets, mis en cache). `construire.sh` compile la coquille et assemble le tout dans
`macos/build/Zotijean.app`.

> **ffmpeg n'est pas optionnel.** Sans lui, zotify renomme le fichier téléchargé avant de
> constater son absence et ne le restaure jamais : des morceaux sont détruits sans aucun
> message d'erreur. Le diagnostic bloque la synchronisation tant qu'il ne l'a pas trouvé.

---

## À savoir avant de commencer

**Il faut un compte Spotify Premium.** Pas pour avoir une meilleure qualité : pour
télécharger tout court. Spotify réserve cet accès à ses abonnés, et aucun réglage de
l'application ne contourne ça.

**La qualité plafonne à 320 kb/s en Ogg Vorbis.** Spotify a
lancé son offre sans perte en septembre 2025 et elle est incluse dans votre abonnement,
mais ce flux est réservé aux applications officielles de Spotify : aucun outil tiers n'y a
accès. Convertir ensuite en FLAC n'ajoute aucune perte, mais n'en récupère aucune non plus.

**Comptez environ 17 heures pour 2 000 titres** au rythme prudent (30 secondes entre chaque
titre). Ce rythme n'est pas une précaution excessive : c'est ce qui évite les erreurs de
clé audio et ce qui limite le risque pour votre compte. Vous pouvez l'accélérer dans les
réglages, en connaissance de cause.

**Télécharger depuis Spotify contrevient à ses conditions d'utilisation.** Des suspensions
de comptes et des réinitialisations forcées de mot de passe sont documentées. En droit
français, l'exception de copie privée suppose une source licite depuis la loi de 2011.
C'est à vous d'apprécier.

---

## Développement

Aucune dépendance, aucune étape de compilation.

```bash
node server.js              # démarre le moteur et l'interface
node server.js --port 9000  # sur un autre port
node --test                 # lance les tests
```

L'organisation du code est décrite dans [CLAUDE.md](CLAUDE.md), qui contient aussi les
faits vérifiés sur zotify, les formats et le système de fichiers qui contraignent
l'implémentation. À lire avant de modifier quoi que ce soit.

## Licence

MIT.
