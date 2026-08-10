import AppKit

/// Point d'entrée de la coquille macOS.
///
/// L'application n'a aucune fenêtre : elle vit dans la barre des menus et sert
/// son interface dans le navigateur. D'où `.accessory` — pas d'icône dans le
/// Dock, pas de basculement de fenêtres.

final class Délégué: NSObject, NSApplicationDelegate {
    private let barre = MenuBarre()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        barre.installer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Le moteur est un processus enfant : sans arrêt explicite, il
        // survivrait à la fermeture de l'app et garderait le port occupé, ce qui
        // empêcherait le prochain démarrage.
        barre.éteindre()
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
}

let application = NSApplication.shared
let délégué = Délégué()
application.delegate = délégué
application.run()
