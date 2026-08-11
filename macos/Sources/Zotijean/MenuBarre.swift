import AppKit
import ServiceManagement

/// L'icône dans la barre des menus et son menu déroulant.
///
/// Un vrai `NSMenu`, pas un panneau dessiné à la main : il hérite gratuitement
/// de l'apparence du système, du mode sombre, de la navigation au clavier et de
/// VoiceOver. Toute la conception visuelle de Zotijean vit dans son interface
/// web ; ici, on ne dessine rien.
final class MenuBarre: NSObject, NSMenuDelegate {

    private let élément = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let moteur = Moteur()
    private let menu = NSMenu()

    private var état = Moteur.État()
    private var minuterie: Timer?
    private var imagesAnimation: [NSImage] = []
    private var indexAnimation = 0
    private var minuterieAnimation: Timer?

    // MARK: - Mise en place

    func installer() {
        construireImages()
        élément.button?.image = imagesAnimation.first
        élément.button?.toolTip = "Zotijean"
        menu.delegate = self
        élément.menu = menu

        // AU TOUT PREMIER LANCEMENT, ON MONTRE QUELQUE CHOSE.
        //
        // Sans ça, double-cliquer sur l'application ne produit rien de visible
        // qu'un petit glyphe en haut de l'écran. Pour quelqu'un qui découvre
        // l'app, c'est indiscernable d'un échec — et le premier lancement guidé,
        // qui existe justement pour ce moment-là, ne serait jamais vu.
        //
        // Uniquement la PREMIÈRE fois : ouvrir le navigateur à chaque démarrage
        // serait envahissant pour une application censée se faire oublier.
        let premierLancement = !moteur.donnéesExistantes()

        if let erreur = moteur.démarrer() {
            présenterErreurDémarrage(erreur)
        } else if premierLancement {
            ouvrirTableauQuandPrêt()
        }

        rafraîchir()
        // Toutes les cinq secondes : assez pour que le menu soit juste quand on
        // l'ouvre, assez rare pour ne rien coûter.
        minuterie = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.rafraîchir()
        }
    }

    func éteindre() {
        minuterie?.invalidate()
        minuterieAnimation?.invalidate()
        moteur.arrêter()
    }

    // MARK: - Icône

    /// Douze images pré-rendues, permutées par une minuterie pendant une
    /// synchronisation. On n'utilise pas `symbolEffect` : dans un élément de
    /// barre de menus, il est irrégulier et saccadé.
    private func construireImages() {
        imagesAnimation = (0..<12).map { étape in
            let taille = NSSize(width: 18, height: 18)
            let image = NSImage(size: taille, flipped: false) { rect in
                let centre = NSPoint(x: rect.midX, y: rect.midY)
                let rayon: CGFloat = 7

                // Un disque, comme une platine : douze traits dont un seul est
                // plein, qui tourne. Silhouette épaisse, sans trait fin : la
                // barre des menus de macOS est transparente et un dessin trop
                // léger y disparaît.
                for index in 0..<12 {
                    let angle = CGFloat(index) / 12 * 2 * .pi - .pi / 2
                    let actif = index == étape
                    NSColor.black.withAlphaComponent(actif ? 1 : 0.28).setStroke()

                    let trait = NSBezierPath()
                    trait.lineWidth = actif ? 2.4 : 1.6
                    trait.lineCapStyle = .round
                    trait.move(to: NSPoint(
                        x: centre.x + cos(angle) * (rayon - 2.6),
                        y: centre.y + sin(angle) * (rayon - 2.6)
                    ))
                    trait.line(to: NSPoint(
                        x: centre.x + cos(angle) * rayon,
                        y: centre.y + sin(angle) * rayon
                    ))
                    trait.stroke()
                }

                NSColor.black.setFill()
                NSBezierPath(ovalIn: NSRect(
                    x: centre.x - 2, y: centre.y - 2, width: 4, height: 4
                )).fill()
                return true
            }
            // Image « template » : macOS la reteinte automatiquement selon le
            // thème et l'état de la barre. Une image en couleur y serait
            // illisible en mode sombre.
            image.isTemplate = true
            return image
        }
    }

    private func démarrerAnimation() {
        guard minuterieAnimation == nil else { return }
        minuterieAnimation = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.indexAnimation = (self.indexAnimation + 1) % self.imagesAnimation.count
            self.élément.button?.image = self.imagesAnimation[self.indexAnimation]
        }
    }

    private func arrêterAnimation() {
        minuterieAnimation?.invalidate()
        minuterieAnimation = nil
        élément.button?.image = imagesAnimation.first
    }

    // MARK: - État

    private func rafraîchir() {
        moteur.interroger { [weak self] nouvel in
            guard let self else { return }
            self.état = nouvel

            if nouvel.enSynchronisation {
                self.démarrerAnimation()
                self.élément.button?.title = nouvel.nbNouveaux > 0 ? " \(nouvel.nbNouveaux)" : ""
            } else {
                self.arrêterAnimation()
                self.élément.button?.title = ""
            }

            self.élément.button?.toolTip = nouvel.joignable
                ? "Zotijean — \(nouvel.phrase)"
                : "Zotijean — moteur arrêté"
            self.élément.button?.alphaValue = nouvel.joignable ? 1 : 0.4
        }
    }

    // MARK: - Menu

    /// Le menu est reconstruit à chaque ouverture : c'est le seul moment où son
    /// contenu est vu, donc le seul moment où le construire a un sens.
    func menuWillOpen(_ menu: NSMenu) {
        menu.removeAllItems()

        let entête = NSMenuItem(title: état.joignable ? état.phrase : "Moteur arrêté",
                                action: nil, keyEquivalent: "")
        entête.isEnabled = false
        menu.addItem(entête)

        if !état.détail.isEmpty {
            let détail = NSMenuItem(title: état.détail, action: nil, keyEquivalent: "")
            détail.isEnabled = false
            détail.attributedTitle = NSAttributedString(
                string: état.détail,
                attributes: [
                    .font: NSFont.menuFont(ofSize: 11),
                    .foregroundColor: NSColor.secondaryLabelColor,
                ]
            )
            menu.addItem(détail)
        }

        menu.addItem(.separator())

        ajouter("Ouvrir le tableau de bord", "o", #selector(ouvrirTableau))

        if état.joignable {
            if état.enSynchronisation {
                ajouter("Arrêter la synchronisation", "", #selector(arrêterSynchro))
            } else {
                ajouter("Synchroniser maintenant", "s", #selector(synchroniser))
            }
            ajouter("Ouvrir le dossier de musique", "", #selector(ouvrirDossier))
        } else {
            ajouter("Redémarrer le moteur", "", #selector(redémarrerMoteur))
            let aide = NSMenuItem(title: "Voir le journal de démarrage",
                                  action: #selector(ouvrirJournalDémarrage),
                                  keyEquivalent: "")
            aide.target = self
            menu.addItem(aide)
        }

        menu.addItem(.separator())

        let démarrage = NSMenuItem(title: "Lancer au démarrage",
                                   action: #selector(basculerDémarrage),
                                   keyEquivalent: "")
        démarrage.target = self
        démarrage.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(démarrage)

        ajouter("Notice d’utilisation", "", #selector(ouvrirNotice))

        menu.addItem(.separator())

        // Le libellé dit la conséquence : sans icône dans le Dock, rien d'autre
        // ne rappellera que quitter arrête aussi les vérifications automatiques.
        ajouter("Quitter — les vérifications s’arrêteront", "q", #selector(quitter))
    }

    private func ajouter(_ titre: String, _ raccourci: String, _ action: Selector) {
        let entrée = NSMenuItem(title: titre, action: action, keyEquivalent: raccourci)
        entrée.target = self
        menu.addItem(entrée)
    }

    // MARK: - Actions

    @objc private func ouvrirTableau() {
        NSWorkspace.shared.open(Moteur.adresse)
    }

    /// Ouvre le tableau de bord dès que le moteur répond, et pas avant.
    ///
    /// Le moteur met une à deux secondes à écouter — davantage au tout premier
    /// lancement, où il monte son environnement de téléchargement. Ouvrir le
    /// navigateur immédiatement afficherait « connexion refusée », c'est-à-dire
    /// la pire première impression possible.
    ///
    /// On abandonne au bout de trente secondes plutôt que d'attendre sans fin :
    /// si le moteur n'a pas démarré, une page d'erreur n'aiderait personne, et
    /// le menu porte déjà de quoi consulter le journal de démarrage.
    private func ouvrirTableauQuandPrêt(essai: Int = 0) {
        guard essai < 30 else { return }

        moteur.interroger { [weak self] état in
            if état.joignable {
                self?.ouvrirTableau()
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    self?.ouvrirTableauQuandPrêt(essai: essai + 1)
                }
            }
        }
    }

    @objc private func ouvrirNotice() {
        NSWorkspace.shared.open(Moteur.adresse.appendingPathComponent("notice.html"))
    }

    @objc private func synchroniser() {
        moteur.agir("api/synchroniser")
        démarrerAnimation()
    }

    @objc private func arrêterSynchro() {
        moteur.agir("api/arreter")
    }

    @objc private func ouvrirDossier() {
        moteur.agir("api/ouvrir-dossier")
    }

    @objc private func redémarrerMoteur() {
        if let erreur = moteur.démarrer() {
            présenterErreurDémarrage(erreur)
        } else {
            rafraîchir()
        }
    }

    @objc private func ouvrirJournalDémarrage() {
        guard let chemin = Moteur.cheminJournalDémarrage() else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: chemin))
    }

    @objc private func basculerDémarrage() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            alerter(
                titre: "Impossible de modifier le lancement au démarrage",
                message: """
                \(error.localizedDescription)

                Vous pouvez le faire à la main dans Réglages Système, \
                Général, Ouverture et extensions.
                """
            )
        }
    }

    @objc private func quitter() {
        éteindre()
        NSApp.terminate(nil)
    }

    // MARK: - Alertes

    private func présenterErreurDémarrage(_ message: String) {
        alerter(titre: "Zotijean n’a pas pu démarrer", message: message)
    }

    private func alerter(titre: String, message: String) {
        let alerte = NSAlert()
        alerte.messageText = titre
        alerte.informativeText = message
        alerte.alertStyle = .warning
        alerte.addButton(withTitle: "Fermer")
        // Une app sans icône dans le Dock doit se mettre au premier plan
        // elle-même, sinon l'alerte s'ouvre derrière tout le reste et personne
        // ne la voit.
        NSApp.activate(ignoringOtherApps: true)
        alerte.runModal()
    }
}
