// swift-tools-version:5.9
//
// Coquille de barre des menus pour Zotijean.
//
// Volontairement construite avec le gestionnaire de paquets Swift plutôt qu'un
// projet Xcode : un fichier Package.swift se lit, se versionne et se compile en
// une commande, y compris sur un serveur d'intégration continue. Un projet
// Xcode est un fichier binaire déguisé que personne ne relit.

import PackageDescription

let package = Package(
    name: "Zotijean",
    platforms: [
        // macOS 13 débloque SMAppService, qui permet d'enregistrer le lancement
        // au démarrage sans script d'installation ni fichier système à copier.
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "Zotijean",
            path: "Sources/Zotijean"
        )
    ]
)
