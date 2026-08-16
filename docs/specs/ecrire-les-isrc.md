# Écrire les ISRC dans les étiquettes

## Problème

On croyait devoir écrire les ISRC dans les fichiers, mais personne n'a prouvé
qu'ils y manquent : le téléchargeur embarqué les écrit lui-même à la naissance
de chaque fichier (vérifié dans son code source), et la conversion recopie les
étiquettes. Ce qui manque vraiment : la preuve que le pont est entier sur la
bibliothèque réelle, et une réparation sûre pour les fichiers qui font
exception — sans jamais toucher aux points de repère et grilles que Serato
stocke à l'intérieur des fichiers.

## Usage

Pym, DJ. Après quelques synchronisations, il veut savoir si chaque morceau de
sa bibliothèque Zotijean porte son ISRC dans ses étiquettes — le lien stable
vers Spotify et ses outils DJ, qui survit au renommage du fichier — et combler
les trous s'il y en a, sans risquer son travail Serato.

## Critères d'acceptation

**État des lieux (lecture seule) :**

1. Étant donné une bibliothèque contenant des fichiers audio, quand
   l'utilisateur demande l'état du pont ISRC, alors chaque fichier est classé
   dans un état — « ISRC présent », « absent », « en conflit », « illisible » —
   avec le compte par état, et aucun fichier n'est modifié (dates de
   modification inchangées).
2. Étant donné un fichier dont le nom contient un ISRC (`[{isrc}]`) et des
   étiquettes portant un ISRC différent, quand l'état est dressé, alors le
   fichier est signalé « en conflit » avec les deux valeurs affichées.
3. Étant donné une bibliothèque vide ou un volume débranché, quand l'état est
   demandé, alors le rapport le dit sans erreur ni plantage.

**Réparation (écriture, seulement après un état des lieux) :**

4. Étant donné le rapport, quand l'utilisateur confirme la réparation, alors
   seuls les fichiers « absent » dont l'ISRC est établi avec certitude (nom de
   fichier, ou correspondance Spotify non ambiguë) sont réécrits ; chaque
   fichier écarté garde sa raison dans le rapport.
5. Étant donné un fichier réparé, quand on le relit, alors l'étiquette ISRC
   attendue est présente, toutes les autres étiquettes et blocs (dont les
   données Serato) sont identiques octet pour octet, et le flux audio est
   inchangé (même somme de contrôle).
6. Étant donné une écriture qui échoue à cette vérification, alors le fichier
   d'origine est restauré tel quel et l'échec est signalé — jamais de fichier
   laissé à moitié réécrit (temporaire puis bascule).
7. Étant donné un fichier déjà correct ou en conflit, quand la réparation
   tourne, alors il n'est pas touché.
8. Étant donné une interruption (fermeture de l'app, coupure) en pleine
   réparation, quand on relance, alors chaque fichier est soit dans son état
   d'origine, soit complètement réparé — jamais entre les deux.

## Hors périmètre

- L'écriture automatique (après synchronisation, ou planifiée) : action
  manuelle uniquement, état des lieux d'abord.
- Les fichiers étrangers à la bibliothèque Zotijean (bibliothèque DJ
  préexistante, autres dossiers).
- Toute étiquette autre que l'ISRC.
- La résolution des conflits : la v1 les signale, elle ne les tranche pas.
- La déduction d'ISRC par analyse du signal audio.

## Cas limites

- Fichier en lecture seule, disque plein ou volume débranché en cours de
  route : la réparation s'arrête proprement, les fichiers déjà traités restent
  valides, le rapport dit où elle s'est arrêtée.
- Morceau sans ISRC chez Spotify (ça existe) : état « sans ISRC connu »,
  jamais réparé, jamais compté comme un échec.
- Dossier `_incomplets/` et fichiers `.tmp` : ignorés.
- 2 000 fichiers : progression visible, opération interrompable.
- Serato ou Rekordbox ouvert pendant la réparation : au minimum un
  avertissement avant de commencer (le mécanisme exact se décide au design).
- Formats : l'état des lieux couvre tout ce que ffprobe lit ; la réparation
  peut ne couvrir qu'une partie des formats en v1, mais chaque format non
  couvert est listé « non réparable pour l'instant » — jamais ignoré en
  silence.

## Risques et inconnues

- **Zéro dépendance npm.** Écrire une étiquette sans rien perdre exige soit
  d'implémenter les formats à la main (simple pour FLAC, délicat pour Ogg dont
  l'en-tête vit dans le flux paginé, risqué pour ID3/GEOB où Serato range ses
  données), soit de passer par ffmpeg — qui réécrit le conteneur sans garantir
  les blocs inconnus. C'est LE risque ; il peut restreindre la réparation v1 à
  certains formats.
- La certitude de correspondance fichier↔morceau (quand le nom ne porte pas
  l'ISRC) repose sur le rapprochement approximatif existant : le taux
  d'« incertains » sur une vraie bibliothèque est inconnu.
- Rien de tout cela n'a tourné sur un vrai Mac ni sur de vrais fichiers
  analysés par Serato. L'état des lieux, en lecture seule, est précisément
  l'outil qui mesurera ces inconnues avant d'écrire quoi que ce soit.
- Hypothèse à confirmer par l'état des lieux : la plupart des fichiers ont
  déjà leur ISRC, écrit par le téléchargeur à la naissance. Si c'est faux, le
  périmètre de réparation grossit.
