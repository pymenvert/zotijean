#!/bin/bash
# Construit Zotijean.app à partir des sources Swift et du moteur Node.
#
# À lancer depuis un Mac. Le résultat est un paquet .app complet, moteur
# compris : il n'y a rien d'autre à installer que Node.js et zotify.
#
#     cd macos && ./construire.sh
#
# L'application est produite dans macos/build/Zotijean.app

set -euo pipefail

ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(dirname "$ICI")"
SORTIE="$ICI/build"
APP="$SORTIE/Zotijean.app"

echo ""
echo "  Construction de Zotijean.app"
echo "  ────────────────────────────────────────"
echo ""

if ! command -v swift >/dev/null 2>&1; then
  echo "  Swift est introuvable. Installez Xcode depuis l'App Store, ouvrez-le"
  echo "  une fois pour qu'il termine son installation, puis relancez ce script."
  exit 1
fi

echo "  1/4  Compilation…"
cd "$ICI"
swift build -c release --arch arm64 --arch x86_64 2>/dev/null \
  || swift build -c release   # repli mono-architecture si l'autre échoue

BINAIRE="$(swift build -c release --show-bin-path)/Zotijean"
if [ ! -f "$BINAIRE" ]; then
  echo "  La compilation n'a produit aucun binaire."
  exit 1
fi

echo "  2/4  Assemblage du paquet…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/moteur"
cp "$BINAIRE" "$APP/Contents/MacOS/Zotijean"
cp "$ICI/Info.plist" "$APP/Contents/Info.plist"

echo "  3/4  Copie du moteur…"
# Le moteur n'a aucune dépendance : on copie les sources telles quelles.
cp "$RACINE/server.js" "$APP/Contents/Resources/moteur/"
cp "$RACINE/package.json" "$APP/Contents/Resources/moteur/"
cp -R "$RACINE/src" "$APP/Contents/Resources/moteur/"
cp -R "$RACINE/public" "$APP/Contents/Resources/moteur/"

echo "  4/4  Signature…"
# Signature ad hoc : suffisante pour un usage personnel. Elle n'évite pas
# l'avertissement Gatekeeper au premier lancement — faites alors un clic droit
# sur l'app puis « Ouvrir », une seule fois.
codesign --force --deep --sign - "$APP" 2>/dev/null \
  || echo "      (signature ignorée — l'app fonctionnera quand même)"

echo ""
echo "  Terminé : $APP"
echo ""
echo "  Glissez Zotijean.app dans votre dossier Applications, puis ouvrez-la."
echo "  Au tout premier lancement, macOS affichera un avertissement : faites un"
echo "  clic droit sur l'app et choisissez « Ouvrir ». Une seule fois."
echo ""
