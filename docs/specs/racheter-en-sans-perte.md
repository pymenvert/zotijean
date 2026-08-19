# Racheter en sans-perte

*Ce fichier s'appelait « liens-flac-par-isrc.md ». Il a été renommé le 19 août
2026 parce que sa clé de recherche — l'ISRC — a été mesurée et écartée. Ce qui
suit est ce qui a été écrit, pas ce qui avait été imaginé.*

## Problème

Spotify plafonne à l'Ogg 320 kb/s avec perte, et Rekordbox ne lit pas l'Ogg. Pour
jouer un morceau suivi par Zotijean, il faut donc soit le convertir — sans jamais
récupérer ce qui a été perdu —, soit le racheter ailleurs en vrai sans-perte.
Retrouver ces morceaux à la main, un par un, prend des heures.

## Usage

Pym ouvre l'onglet Qualité, clique « Chercher les liens », et obtient une page de
liens cliquables classés par confiance. Il achète ce qu'il veut et dépose les
fichiers lui-même. Zotijean n'achète rien et ne télécharge rien.

---

## Le sondage qui a tout changé — 19 août 2026

La version précédente de ce document faisait de l'ISRC la clé de recherche, et
interrogeait MusicBrainz une fois par morceau. Un sondage sur 17 morceaux réels
de la bibliothèque, en partant des ISRC **fournis par Spotify** (jamais de ceux
de MusicBrainz, ce qui aurait rendu la première question vraie par construction),
a mesuré ceci :

| Chemin | Liens trouvés |
|---|---|
| ISRC → MusicBrainz → liens de l'**enregistrement** — *la spec d'origine* | **0 / 13** |
| ISRC → MusicBrainz → liens des **sorties** | 2 / 13 |
| artiste + titre → MusicBrainz → liens des sorties | 8 / 17 |
| artiste + titre → **Bandcamp**, vente confirmée sur la page | 14 / 17 |
| les deux sources réunies | **15 / 17** |

Trois conclusions, toutes contre-intuitives :

1. **L'ISRC est une mauvaise clé pour ce répertoire.** Pas parce que MusicBrainz
   ignore les morceaux — il en connaît 9 sur 13 — mais parce qu'il n'a **aucun
   ISRC attaché** à 7 d'entre eux. C'est son index ISRC qui est vide, pas son
   catalogue. Vérifié morceau par morceau (`recording/{mbid}?inc=isrcs`).
2. **Les liens d'achat de MusicBrainz vivent sur les sorties**, jamais sur
   l'enregistrement. La spec d'origine aurait rendu « aucun lien trouvé » sur
   **13 lignes sur 13**, après une heure et demie de requêtes pour 2 000 titres.
3. **Bandcamp est de loin la meilleure source** sur du répertoire électronique et
   indépendant, et la seule qui donne le lien du *morceau* plutôt que de l'album.

Et un défaut trouvé en chemin, qui aurait vidé la fonctionnalité de sa clé :
**la conversion détruisait toutes les étiquettes**, ISRC compris
(`-map_metadata 0` sur une source Ogg, dont les commentaires sont sur le flux).

---

## Ce qui a été écrit

`src/achats.js`, appelé depuis l'onglet **Qualité** — là où l'interface explique
déjà que Spotify plafonne et que convertir ne récupère rien. C'est à cet endroit
que la question « et si je le rachetais ? » se pose.

### Quatre étages de confiance, jamais mélangés

C'est le point sur lequel un rapport de ce genre peut mentir le plus facilement :
présenter une recherche pré-remplie et un lien vérifié dans la même colonne
laisserait croire à une couverture qui n'existe pas.

1. **Lien vers le morceau** — trouvé sur Bandcamp, page ouverte, artiste et titre
   confirmés *par la page*, vente confirmée. Bandcamp propose le FLAC sur tout
   téléchargement : ces liens mènent bien à du sans-perte.
2. **Lien vers l'album** — le morceau n'est pas vendu seul ; l'album l'est.
3. **Lien référencé** — MusicBrainz connaît un lien d'achat, mais la page du
   vendeur n'a pas été ouverte. Peut être périmé, et **toutes ces boutiques ne
   vendent pas du sans-perte** : un lien Apple Music est signalé comme tel.
4. **Recherche pré-remplie** — rien de connu, et c'est écrit.

### Critères d'acceptation

1. Un rapport HTML et un CSV sont écrits à la racine de la bibliothèque, avec
   artiste, titre, album, ISRC quand il existe, boutique, prix et lien. ✅
2. Un morceau vendu sur Bandcamp porte le lien de **sa** page, pas celle d'un
   homonyme : la page doit confirmer artiste **et** titre. ✅
3. Bandcamp prime sur les autres boutiques, qui priment sur celles qui ne vendent
   pas de sans-perte. ✅
4. Un morceau sans lien porte des recherches pré-remplies, explicitement marquées
   comme recherches. ✅
5. Un morceau sans ISRC est traité comme les autres — c'est ce qui marche le
   mieux — et le rapport dit combien sont dans ce cas. ✅
   *(La spec d'origine exigeait une section à part. Elle n'a plus de sens : sur
   ce répertoire, l'ISRC ne sert que dans un cas sur sept.)*
6. La durée est annoncée **avant** de lancer (`GET /api/achats/estimation`), et
   l'avancement défile pendant. ✅
7. Un rapport interrompu reprend là où il s'est arrêté. ✅
8. Le rapport indique combien de morceaux ont un lien vérifié, combien un lien
   référencé, et combien n'ont qu'une recherche. ✅

---

## Hors périmètre

- **Aucun téléchargement, aucun achat automatique.**
- **Aucun réseau de partage de fichiers.**
- Aucun remplacement automatique d'un Ogg par un FLAC acheté.
- Aucune vérification que le fichier vendu est un vrai sans-perte — **sauf sur
  Bandcamp**, où le FLAC est proposé sur tout téléchargement.
- Aucune interrogation de Beatport : son interface est réservée à ses partenaires
  approuvés. Ses liens ne viennent que de MusicBrainz.

## Risques et inconnues

- **Le point d'entrée Bandcamp n'est pas documenté.** Ce n'est pas son interface
  vendeurs (réservée aux labels) mais celle de son propre champ de recherche.
  Elle peut changer ou cesser de répondre sans préavis. Trois garde-fous : la
  source est débrayable dans les réglages, une panne la désactive pour le reste
  de l'exécution au lieu d'interrompre le rapport, et le rythme reste à une
  requête par seconde — la charge d'un humain qui navigue.
  **Sans Bandcamp, la couverture retombe à 47 %.** C'est écrit dans le réglage.
- **Un lien d'achat peut être périmé.** Un album retiré laisse une page morte.
- **La durée.** Environ trois secondes par morceau, soit plus d'une heure pour
  2 000 titres. Même ordre de grandeur qu'une synchronisation.
- **La mesure porte sur 17 morceaux.** Les intervalles de confiance à 95 % sont
  larges. À rejouer sur la bibliothèque complète — ce qui suppose de connecter
  l'API Spotify, aujourd'hui inactive.

## Ce qui n'est pas fait

- **Le rapport ne couvre que les morceaux DÉJÀ TÉLÉCHARGÉS**, pas l'intégralité
  des playlists suivies. Couvrir les playlists entières demande l'API Spotify :
  `spotify.actif` vaut `false` et aucun identifiant client n'est renseigné.
  `inventaireComplet` (`src/analyse.js`) plafonne en outre à 50 morceaux
  manquants par playlist — à lever quand cette source sera branchée.
- Le rapport n'est pas régénéré automatiquement après une synchronisation.
