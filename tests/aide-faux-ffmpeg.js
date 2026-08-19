// Faux ffmpeg, pour éprouver la conversion dans la chaîne complète.
//
// L'ancien leurre se contentait de répondre au diagnostic et de sortir en 0 sans
// rien produire. Cela suffisait tant que les tests d'intégration utilisaient le
// format « copie », qui ne convertit rien — mais dès qu'on veut prouver qu'une
// interruption ne laisse AUCUN fichier dans le mauvais format, il faut un ffmpeg
// qui produise vraiment un fichier.
//
// Il n'encode rien : il recopie la source et la rallonge d'un mégaoctet. Cela
// suffit à passer la garde de vraisemblance dans les deux sens — un format sans
// perte doit peser PLUS que sa source, un format avec perte au moins un quart.
// Ce qui est éprouvé ici, c'est l'orchestration, pas ffmpeg lui-même : la vraie
// conversion a ses propres tests, qui appellent le vrai binaire.

import fs from 'node:fs';

const arguments_ = process.argv.slice(2);

if (arguments_.includes('-version') || arguments_.includes('--version')) {
  process.stdout.write('ffmpeg version 7.1 (factice)\n');
  process.exit(0);
}

// La source suit « -i », la destination est le dernier argument.
const source = arguments_[arguments_.indexOf('-i') + 1];
const destination = arguments_[arguments_.length - 1];

if (!source || !destination || !fs.existsSync(source)) {
  process.stderr.write('faux ffmpeg : source introuvable\n');
  process.exit(1);
}

fs.copyFileSync(source, destination);
fs.appendFileSync(destination, Buffer.alloc(1024 * 1024, 7));
process.exit(0);
