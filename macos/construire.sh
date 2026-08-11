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

# LE CHEMIN DU BINAIRE DÉPEND DES OPTIONS DE COMPILATION. Demander « où est le
# binaire ? » sans répéter exactement les options qui l'ont produit renvoie un
# AUTRE dossier — celui de la compilation native, qui peut très bien être vide.
#
# Le piège ne se voyait pas tant qu'une compilation native avait eu lieu avant :
# le binaire s'y trouvait, hérité d'une étape précédente, et tout paraissait
# fonctionner. Sur une machine propre — celle qui publie — il n'y avait rien à
# copier, et la construction s'arrêtait sur un « aucun binaire » incompréhensible.
# On répète les options en toutes lettres dans les deux branches plutôt que de
# les ranger dans une variable : macOS livre bash 3.2, où un tableau vide sous
# « set -u » fait mourir le script. Deux lignes un peu redondantes valent mieux
# qu'une élégance qui ne fonctionne que sur la machine du développeur.
if swift build -c release --arch arm64 --arch x86_64 2>/dev/null; then
  DOSSIER_BINAIRE="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)"
  echo "       binaire universel (Apple Silicon + Intel)"
else
  # Repli mono-architecture : celle de la machine qui compile.
  swift build -c release
  DOSSIER_BINAIRE="$(swift build -c release --show-bin-path)"
  echo "       binaire natif de cette machine"
fi

BINAIRE="$DOSSIER_BINAIRE/Zotijean"
if [ ! -f "$BINAIRE" ]; then
  echo "  La compilation n'a produit aucun binaire."
  echo "  Cherché dans : $DOSSIER_BINAIRE"
  ls -la "$DOSSIER_BINAIRE" 2>/dev/null | head -20
  exit 1
fi

echo "  2/4  Assemblage du paquet…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/moteur"
cp "$BINAIRE" "$APP/Contents/MacOS/Zotijean"
cp "$ICI/Info.plist" "$APP/Contents/Info.plist"

echo "  3/5  Copie du moteur…"
# Le moteur n'a aucune dépendance npm : on copie les sources telles quelles.
cp "$RACINE/server.js" "$APP/Contents/Resources/moteur/"
cp "$RACINE/package.json" "$APP/Contents/Resources/moteur/"
cp -R "$RACINE/src" "$APP/Contents/Resources/moteur/"
cp -R "$RACINE/public" "$APP/Contents/Resources/moteur/"

echo "  4/5  Copie des outils embarqués…"
# Node, Python, ffmpeg et les paquets de zotify. C'est ce qui fait qu'un double
# clic suffit : rien n'est exigé de la machine.
if [ -d "$ICI/outils" ]; then
  cp -R "$ICI/outils" "$APP/Contents/Resources/outils"
  # Le copiage perd parfois le bit d'exécution selon le système de fichiers.
  for binaire in node/node python/bin/python3 ffmpeg/ffmpeg ffmpeg/ffprobe; do
    [ -f "$APP/Contents/Resources/outils/$binaire" ] \
      && chmod +x "$APP/Contents/Resources/outils/$binaire"
  done
  echo "       $(du -sh "$APP/Contents/Resources/outils" | cut -f1) embarqués"
else
  echo "       AUCUN — lancez d'abord ./outils.sh, sinon l'app exigera"
  echo "       que Node, ffmpeg et zotify soient déjà installés."
fi

echo "  5/5  Signature…"
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
