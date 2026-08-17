// Lecture de code source pour les garde-fous de dépôt.
//
// Deux tests relisent le code du projet plutôt que de l'exécuter : celui qui
// refuse les styles en ligne, et celui qui exige une politique de sécurité
// unique. Tous deux ont le même piège : dans ce dépôt, les commentaires CITENT
// le code en permanence — c'est même la consigne. Un garde-fou qui grep le texte
// brut dénonce donc l'explication au lieu du défaut.
//
// La logique délicate vit ici, à un seul endroit, pour que corriger l'un
// corrige l'autre. Précédent dans le dossier : aide-faux-zotify.js.

import fs from 'node:fs';
import path from 'node:path';

/** Remplace un passage par des blancs, en gardant ses retours à la ligne. */
export const blanchir = (bloc) => bloc.replace(/[^\n]/g, ' ');

/**
 * Neutralise les commentaires avant l'analyse.
 *
 * TOUTES les bornes exigent une ouverture en DÉBUT de ligne, et c'est la seule
 * chose qui empêche ces garde-fous de devenir aveugles. Un blanchiment qui
 * accepterait un ouvreur n'importe où se laisse ouvrir par ce qui n'est pas un
 * commentaire : une étoile suivie d'une barre oblique dans un glob de fichiers,
 * dans un href, dans une expression régulière ; un ouvreur de commentaire HTML
 * écrit à l'intérieur d'une chaîne. Tout ce qui suit jusqu'au prochain fermeur
 * disparaît alors — et un scanner qui regarde du vide rend exactement le même
 * verdict qu'un code propre. Ce dépôt a déjà payé deux scanners muets.
 *
 * Le contenu est blanchi et non supprimé : les retours à la ligne survivent,
 * donc les numéros de ligne des rapports désignent toujours la bonne ligne.
 */
export function sansCommentaires(texte) {
  return texte
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, blanchir) // bloc JavaScript et CSS
    .replace(/^[ \t]*<!--[\s\S]*?-->/gm, blanchir) // commentaire HTML
    .replace(/^[ \t]*\/\/.*$/gm, blanchir); // commentaire de ligne
}

/**
 * Liste les fichiers d'un dossier dont l'extension correspond.
 *
 * Volontairement NON récursif, et c'est un choix à surveiller : il n'existe
 * aujourd'hui aucun sous-dossier dans `public/` ni `src/`. Le jour où il y en
 * aura un, le test « aucun sous-dossier inattendu » plus bas le signalera au
 * lieu de laisser le balayage rétrécir en silence.
 */
export function listerFichiers(racine, dossier, motifExtension) {
  const complet = path.join(racine, dossier);
  return fs
    .readdirSync(complet, { withFileTypes: true })
    .filter((e) => e.isFile() && motifExtension.test(e.name))
    .map((e) => path.join(dossier, e.name));
}

/** Les sous-dossiers d'un dossier, pour vérifier qu'un balayage plat suffit. */
export function sousDossiers(racine, dossier) {
  return fs
    .readdirSync(path.join(racine, dossier), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dossier, e.name));
}
