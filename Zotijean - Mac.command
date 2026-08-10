#!/bin/bash
# Zotijean — lanceur macOS.
# Double-cliquez ce fichier dans le Finder. Une fenêtre de Terminal s'ouvre et
# l'interface apparaît dans votre navigateur. Fermez la fenêtre pour arrêter.

cd "$(dirname "$0")" || exit 1

printf '\033]0;Zotijean\007'
echo ""
echo "  ♫  Zotijean"
echo "  ────────────────────────────────────────────"
echo ""

# Node est-il installé ? Une app lancée depuis le Finder n'hérite pas du PATH
# du Terminal : on ajoute donc explicitement les emplacements habituels.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js est introuvable."
  echo ""
  echo "  Zotijean en a besoin pour fonctionner. Installez-le en une fois :"
  echo ""
  echo "      brew install node"
  echo ""
  echo "  Si vous n'avez pas Homebrew, téléchargez l'installeur sur nodejs.org"
  echo "  (choisissez la version LTS) puis relancez ce fichier."
  echo ""
  read -r -p "  Appuyez sur Entrée pour fermer."
  exit 1
fi

VERSION_MAJEURE=$(node -p "process.versions.node.split('.')[0]")
if [ "$VERSION_MAJEURE" -lt 20 ]; then
  echo "  Node.js $(node -v) est trop ancien : il faut au moins la version 20."
  echo "  Mettez-le à jour avec « brew upgrade node », puis relancez ce fichier."
  echo ""
  read -r -p "  Appuyez sur Entrée pour fermer."
  exit 1
fi

echo "  Node.js $(node -v)"
echo "  Démarrage…"
echo ""
echo "  Laissez cette fenêtre ouverte tant que vous utilisez Zotijean."
echo "  Pour arrêter : fermez la fenêtre, ou appuyez sur Ctrl+C."
echo ""

node server.js

echo ""
echo "  Zotijean est arrêté."
read -r -p "  Appuyez sur Entrée pour fermer."
