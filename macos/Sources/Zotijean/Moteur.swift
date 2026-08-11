import Foundation

/// Pilotage du moteur Node : démarrage, arrêt, et lecture de son état.
///
/// La coquille ne contient aucune logique métier. Tout ce qui décide vit dans le
/// moteur JavaScript ; ici on se contente de le lancer, de le surveiller et de
/// relayer son état dans le menu. C'est ce qui permet de faire évoluer l'app
/// sans jamais recompiler quoi que ce soit.
final class Moteur {

    /// Port d'écoute. Identique à la valeur par défaut du moteur.
    static let port = 8787

    static var adresse: URL { URL(string: "http://127.0.0.1:\(port)")! }

    private var processus: Process?
    private let file = DispatchQueue(label: "fr.zotijean.moteur")

    // MARK: - Localisation des exécutables

    /// Emplacements où Node peut réellement se trouver.
    ///
    /// LE PIÈGE : une application lancée depuis le Finder n'hérite pas du PATH
    /// du Terminal. Elle reçoit un PATH minimal qui ne contient ni
    /// /opt/homebrew/bin (Homebrew sur Apple Silicon) ni /usr/local/bin. Chercher
    /// « node » sans le dire explicitement échoue systématiquement — alors que
    /// tout fonctionne quand on teste depuis un terminal.
    private static let dossiersNode = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        NSHomeDirectory() + "/.nvm/versions/node",
        NSHomeDirectory() + "/.volta/bin",
        NSHomeDirectory() + "/.local/bin",
    ]

    /// Le Node livré dans le paquet, s'il y en a un.
    ///
    /// Il passe AVANT tout ce qui est installé sur la machine : c'est celui dont
    /// on connaît la version, et c'est lui qui rend l'application utilisable sur
    /// un Mac où rien n'a jamais été installé.
    static func nodeEmbarqué() -> String? {
        guard let ressources = Bundle.main.resourceURL else { return nil }
        let candidat = ressources.appendingPathComponent("outils/node/node").path
        return FileManager.default.isExecutableFile(atPath: candidat) ? candidat : nil
    }

    static func trouverNode() -> String? {
        if let embarqué = nodeEmbarqué() { return embarqué }

        let gestionnaire = FileManager.default

        for dossier in dossiersNode {
            let candidat = dossier + "/node"
            if gestionnaire.isExecutableFile(atPath: candidat) { return candidat }
        }

        // Repli : demander au shell de connexion, qui lui a chargé le profil de
        // l'utilisateur et connaît donc les gestionnaires de versions.
        let shell = Process()
        shell.executableURL = URL(fileURLWithPath: "/bin/zsh")
        shell.arguments = ["-l", "-c", "command -v node"]
        let sortie = Pipe()
        shell.standardOutput = sortie
        shell.standardError = Pipe()

        do {
            try shell.run()
            shell.waitUntilExit()
            let données = sortie.fileHandleForReading.readDataToEndOfFile()
            let chemin = String(decoding: données, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !chemin.isEmpty, gestionnaire.isExecutableFile(atPath: chemin) { return chemin }
        } catch {
            // Le shell a refusé de se lancer : on rendra nil plus bas.
        }

        return nil
    }

    /// Le dossier qui contient server.js.
    ///
    /// Deux dispositions possibles : le moteur est copié dans le paquet de
    /// l'application (Contents/Resources/moteur), ou bien on travaille depuis le
    /// dépôt et il est à côté du binaire compilé.
    static func dossierMoteur() -> String? {
        let gestionnaire = FileManager.default
        var candidats: [String] = []

        if let ressources = Bundle.main.resourceURL?.appendingPathComponent("moteur").path {
            candidats.append(ressources)
        }

        // Depuis le dépôt : macos/.build/... → on remonte jusqu'à la racine.
        let binaire = Bundle.main.bundleURL
        candidats.append(binaire.deletingLastPathComponent().path)
        candidats.append(
            binaire.deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent().path
        )

        for candidat in candidats
        where gestionnaire.fileExists(atPath: candidat + "/server.js") {
            return candidat
        }
        return nil
    }

    // MARK: - Cycle de vie

    var estEnMarche: Bool { processus?.isRunning ?? false }

    /// Démarre le moteur. Renvoie un message d'erreur en français, ou nil.
    @discardableResult
    func démarrer() -> String? {
        if estEnMarche { return nil }

        guard let node = Moteur.trouverNode() else {
            return """
            Node.js est introuvable. Zotijean en a besoin pour fonctionner.
            Installez-le avec « brew install node », ou depuis nodejs.org, puis relancez.
            """
        }

        guard let dossier = Moteur.dossierMoteur() else {
            return """
            Le moteur de Zotijean est introuvable. Le fichier server.js devrait se
            trouver dans l’application. Retéléchargez-la.
            """
        }

        let tâche = Process()
        tâche.executableURL = URL(fileURLWithPath: node)
        tâche.arguments = ["server.js", "--sans-navigateur"]
        tâche.currentDirectoryURL = URL(fileURLWithPath: dossier)

        // On reconstruit le PATH pour le processus enfant, faute de quoi le
        // moteur ne trouverait ni zotify ni ffmpeg — avec, dans le cas de
        // ffmpeg, des morceaux détruits en silence.
        var environnement = ProcessInfo.processInfo.environment
        let cheminActuel = environnement["PATH"] ?? ""
        environnement["PATH"] = (Moteur.dossiersNode + [cheminActuel])
            .filter { !$0.isEmpty }
            .joined(separator: ":")

        // Le moteur surveille cet identifiant et s'arrête si nous disparaissons.
        // Sans cela, un « forcer à quitter » ou un plantage laisserait un
        // téléchargement tourner indéfiniment, invisible, en gardant le port
        // occupé : macOS ne tue pas les enfants avec leur parent.
        environnement["ZOTIJEAN_PARENT"] = String(ProcessInfo.processInfo.processIdentifier)

        tâche.environment = environnement

        // La sortie du moteur part dans un fichier plutôt que dans le vide :
        // sans ça, un démarrage qui échoue ne laisse aucune trace consultable.
        if let journal = Moteur.cheminJournalDémarrage() {
            FileManager.default.createFile(atPath: journal, contents: nil)
            if let poignée = FileHandle(forWritingAtPath: journal) {
                tâche.standardOutput = poignée
                tâche.standardError = poignée
            }
        }

        do {
            try tâche.run()
            processus = tâche
            return nil
        } catch {
            return "Le moteur n’a pas pu démarrer : \(error.localizedDescription)"
        }
    }

    static func cheminJournalDémarrage() -> String? {
        let base = NSHomeDirectory() + "/Library/Application Support/Zotijean"
        try? FileManager.default.createDirectory(
            atPath: base, withIntermediateDirectories: true
        )
        return base + "/demarrage.log"
    }

    /// Arrête le moteur proprement, en lui laissant le temps de finir.
    func arrêter() {
        guard let tâche = processus, tâche.isRunning else { return }
        tâche.terminate()

        // On attend brièvement une fin propre avant d'insister : le moteur ferme
        // ses fichiers d'état à la réception du signal.
        file.asyncAfter(deadline: .now() + 4) {
            if tâche.isRunning { kill(tâche.processIdentifier, SIGKILL) }
        }
        processus = nil
    }

    // MARK: - Interrogation

    struct État {
        var joignable = false
        var enSynchronisation = false
        var phrase = "Moteur arrêté"
        var détail = ""
        var nbPlaylists = 0
        var nbNouveaux = 0
    }

    /// Interroge l'API du moteur. Jamais sur le fil principal.
    func interroger(_ terminé: @escaping (État) -> Void) {
        var requête = URLRequest(
            url: Moteur.adresse.appendingPathComponent("api/tableau-de-bord")
        )
        requête.timeoutInterval = 4
        requête.setValue("local", forHTTPHeaderField: "X-Zotijean")

        URLSession.shared.dataTask(with: requête) { données, _, _ in
            var état = État()

            guard
                let données,
                let racine = try? JSONSerialization.jsonObject(with: données) as? [String: Any]
            else {
                DispatchQueue.main.async { terminé(état) }
                return
            }

            état.joignable = true

            if let héros = racine["phraseHéros"] as? [String: Any] {
                état.phrase = héros["texte"] as? String ?? état.phrase
                état.détail = héros["détail"] as? String ?? ""
            }
            if let playlists = racine["playlists"] as? [[String: Any]] {
                état.nbPlaylists = playlists.count
            }
            if let enCours = racine["enCours"] as? [String: Any] {
                état.enSynchronisation = true
                état.nbNouveaux = enCours["fichiersTéléchargés"] as? Int ?? 0
            }

            DispatchQueue.main.async { terminé(état) }
        }.resume()
    }

    /// Déclenche une action côté moteur (synchroniser, arrêter…).
    func agir(_ chemin: String, terminé: ((Bool) -> Void)? = nil) {
        var requête = URLRequest(url: Moteur.adresse.appendingPathComponent(chemin))
        requête.httpMethod = "POST"
        requête.timeoutInterval = 10
        // Le moteur refuse toute requête modifiante sans ce marqueur : c'est ce
        // qui empêche une page web ouverte ailleurs de le piloter.
        requête.setValue("local", forHTTPHeaderField: "X-Zotijean")

        URLSession.shared.dataTask(with: requête) { _, réponse, _ in
            let ok = (réponse as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { terminé?(ok) }
        }.resume()
    }
}
