#!/bin/bash
# Récupère les outils à embarquer dans Zotijean.app.
#
# L'objectif est qu'un double-clic suffise : ni Node, ni Python, ni ffmpeg, ni
# zotify ne doivent être installés sur la machine. Tout vit dans le paquet.
#
# Ce script tourne sur un Mac (poste ou serveur d'intégration continue) et
# dépose son résultat dans macos/outils/. Il est séparé de construire.sh parce
# qu'il télécharge plusieurs centaines de mégaoctets : on ne le relance pas à
# chaque compilation.
#
#     cd macos && ./outils.sh

set -euo pipefail

ICI="$(cd "$(dirname "$0")" && pwd)"
OUTILS="$ICI/outils"
CACHE="$ICI/.cache-outils"

# Versions épinglées. Les laisser flotter, c'est accepter qu'une construction
# reproductible hier échoue demain sans qu'on ait rien changé.
VERSION_NODE="22.14.0"
VERSION_PYTHON="3.12.8"
ETIQUETTE_PYTHON="20250106"   # date de publication chez python-build-standalone

ARCH="$(uname -m)"   # arm64 sur Apple Silicon, x86_64 sur Intel

mkdir -p "$OUTILS" "$CACHE"

echo ""
echo "  Récupération des outils embarqués"
echo "  ────────────────────────────────────────"
echo "  Architecture : $ARCH"
echo ""

telecharger() {
  local url="$1" fichier="$2"
  if [ -f "$CACHE/$fichier" ]; then
    echo "      (déjà en cache)"
    return 0
  fi
  curl -fsSL --retry 3 --retry-delay 2 -o "$CACHE/$fichier.partiel" "$url"
  mv "$CACHE/$fichier.partiel" "$CACHE/$fichier"
}

# ---------------------------------------------------------------- Node.js

echo "  1/4  Node.js $VERSION_NODE"
if [ "$ARCH" = "arm64" ]; then NODE_ARCH="darwin-arm64"; else NODE_ARCH="darwin-x64"; fi
ARCHIVE_NODE="node-v$VERSION_NODE-$NODE_ARCH.tar.gz"
telecharger "https://nodejs.org/dist/v$VERSION_NODE/$ARCHIVE_NODE" "$ARCHIVE_NODE"

rm -rf "$OUTILS/node"
mkdir -p "$OUTILS/node"
# On ne garde que le binaire : le reste de la distribution (npm, en-têtes,
# documentation) pèse lourd et ne sert à rien, puisque le moteur n'a aucune
# dépendance à installer.
tar -xzf "$CACHE/$ARCHIVE_NODE" -C "$OUTILS/node" --strip-components=2 \
    "node-v$VERSION_NODE-$NODE_ARCH/bin/node"
chmod +x "$OUTILS/node/node"
echo "       $("$OUTILS/node/node" --version)"

# ---------------------------------------------------------------- Python

echo "  2/4  Python $VERSION_PYTHON (autonome)"
if [ "$ARCH" = "arm64" ]; then PY_CIBLE="aarch64-apple-darwin"; else PY_CIBLE="x86_64-apple-darwin"; fi
ARCHIVE_PY="cpython-$VERSION_PYTHON+$ETIQUETTE_PYTHON-$PY_CIBLE-install_only_stripped.tar.gz"
telecharger \
  "https://github.com/astral-sh/python-build-standalone/releases/download/$ETIQUETTE_PYTHON/$ARCHIVE_PY" \
  "$ARCHIVE_PY"

rm -rf "$OUTILS/python"
mkdir -p "$OUTILS/python"
tar -xzf "$CACHE/$ARCHIVE_PY" -C "$OUTILS/python" --strip-components=1
echo "       $("$OUTILS/python/bin/python3" --version)"

# ---------------------------------------------------------------- ffmpeg

echo "  3/4  ffmpeg"
# Sans ffmpeg, zotify renomme le fichier téléchargé avant de constater son
# absence et détruit le morceau en silence. Il n'est donc pas optionnel.
rm -rf "$OUTILS/ffmpeg"
mkdir -p "$OUTILS/ffmpeg"

if telecharger "https://evermeet.cx/ffmpeg/getrelease/zip" "ffmpeg.zip" 2>/dev/null; then
  unzip -qo "$CACHE/ffmpeg.zip" -d "$OUTILS/ffmpeg"
  chmod +x "$OUTILS/ffmpeg/ffmpeg" 2>/dev/null || true
fi

if [ ! -x "$OUTILS/ffmpeg/ffmpeg" ]; then
  # Repli : la copie du système, si elle existe. Le paquet reste utilisable,
  # simplement moins autonome — et le diagnostic de l'app le dira.
  if command -v ffmpeg >/dev/null 2>&1; then
    cp "$(command -v ffmpeg)" "$OUTILS/ffmpeg/ffmpeg"
    cp "$(command -v ffprobe)" "$OUTILS/ffmpeg/ffprobe" 2>/dev/null || true
    echo "       repli sur la copie du système"
  else
    echo "       INTROUVABLE — le paquet exigera un ffmpeg installé."
  fi
fi
[ -x "$OUTILS/ffmpeg/ffmpeg" ] && echo "       $("$OUTILS/ffmpeg/ffmpeg" -version 2>/dev/null | head -1 | cut -c1-40)"

# ---------------------------------------------------------------- zotify

echo "  4/4  zotify et ses dépendances"
# On télécharge les paquets sous forme de roues plutôt que d'installer
# directement : au premier lancement, l'app monte son environnement SANS RÉSEAU
# et sans git, à partir de ce dossier. C'est ce qui rend le paquet utilisable
# hors ligne et évite de dépendre des outils de développement d'Apple.
rm -rf "$OUTILS/roues"
mkdir -p "$OUTILS/roues"

# `pip wheel` et surtout PAS `pip download`.
#
# Un dépôt git ne se télécharge pas sous forme de roue : `pip download` rapporte
# alors des archives SOURCES, que l'installation hors ligne devrait compiler —
# ce qui exige un réseau et une chaîne de compilation, exactement ce qu'on
# cherche à éviter. `pip wheel` construit ici, maintenant, la roue de zotify ET
# celles de toutes ses dépendances. Le résultat s'installe ensuite sans réseau.
"$OUTILS/python/bin/python3" -m pip install --quiet --upgrade pip wheel setuptools

"$OUTILS/python/bin/python3" -m pip wheel \
  --wheel-dir "$OUTILS/roues" \
  "git+https://github.com/Googolplexed0/zotify.git"

NB_ROUES=$(ls -1 "$OUTILS/roues"/*.whl 2>/dev/null | wc -l | tr -d ' ')
echo "       $NB_ROUES roue(s)"

if [ "$NB_ROUES" -eq 0 ]; then
  echo "       AUCUNE ROUE PRODUITE — le paquet ne serait pas autonome."
  exit 1
fi

# Vérification immédiate : la roue de zotify elle-même doit être là. Sans elle,
# on n'aurait récupéré que des dépendances, et l'échec n'apparaîtrait qu'au
# premier lancement chez l'utilisateur.
if ! ls "$OUTILS/roues" | grep -qi '^zotify'; then
  echo "       La roue de zotify est absente :"
  ls -1 "$OUTILS/roues" | head -20
  exit 1
fi

# ---------------------------------------------------------------- Bilan

echo ""
echo "  Total : $(du -sh "$OUTILS" | cut -f1)"
echo "  Prêt pour ./construire.sh"
echo ""
