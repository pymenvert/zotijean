// Serveur HTTP : sert l'interface web et l'API JSON.
//
// N'écoute que sur 127.0.0.1. L'app pilote zotify et manipule la bibliothèque
// musicale de l'utilisateur : rien de tout cela ne doit être joignable depuis le
// réseau local, encore moins depuis l'extérieur.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { config } from './src/config.js';
import { journal } from './src/journal.js';
import { routes, ErreurRequête } from './src/api.js';
import { refuser, ENTÊTES_SÉCURITÉ } from './src/securite.js';
import { lireContextePlateforme } from './src/energie.js';
import { diagnostiquer } from './src/diagnostic.js';
import * as synchro from './src/synchronisation.js';
import * as planificateur from './src/planificateur.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ICI, 'public');

const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

// ---------------------------------------------------------------------------
// Utilitaires de requête
// ---------------------------------------------------------------------------

function répondreJSON(réponse, données, statut = 200) {
  const corps = JSON.stringify(données ?? null);
  réponse.writeHead(statut, {
    ...ENTÊTES_SÉCURITÉ,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corps),
    'Cache-Control': 'no-store',
  });
  réponse.end(corps);
}

function lireCorps(requête, maxOctets = 1_000_000) {
  return new Promise((résoudre, rejeter) => {
    let données = '';
    let taille = 0;

    requête.on('data', (bloc) => {
      taille += bloc.length;
      if (taille > maxOctets) {
        rejeter(new ErreurRequête('Requête trop volumineuse.', 413));
        requête.destroy();
        return;
      }
      données += bloc;
    });

    requête.on('end', () => {
      if (!données.trim()) return résoudre(null);
      try {
        résoudre(JSON.parse(données));
      } catch {
        rejeter(new ErreurRequête('Corps de requête illisible.'));
      }
    });

    requête.on('error', rejeter);
  });
}

/** Sert un fichier statique, en refusant toute sortie du dossier public. */
function servirStatique(chemin, réponse) {
  const relatif = chemin === '/' ? 'index.html' : decodeURIComponent(chemin.slice(1));
  const complet = path.join(PUBLIC, relatif);

  if (!path.resolve(complet).startsWith(path.resolve(PUBLIC))) {
    réponse.writeHead(403).end('Interdit');
    return;
  }

  fs.readFile(complet, (erreur, contenu) => {
    if (erreur) {
      réponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      réponse.end('Introuvable');
      return;
    }
    réponse.writeHead(200, {
      ...ENTÊTES_SÉCURITÉ,
      'Content-Type': TYPES_MIME[path.extname(complet).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    réponse.end(contenu);
  });
}

// ---------------------------------------------------------------------------
// Flux d'événements en direct (Server-Sent Events)
// ---------------------------------------------------------------------------

function servirÉvénements(requête, réponse) {
  réponse.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  réponse.write('retry: 3000\n\n');

  const envoyer = (événement) => {
    try {
      réponse.write(`data: ${JSON.stringify(événement)}\n\n`);
    } catch {
      // Connexion fermée pendant l'écriture : le nettoyage ci-dessous s'en charge.
    }
  };

  const désabonnerSynchro = synchro.abonner(envoyer);
  const désabonnerJournal = journal.abonner((entrée) =>
    envoyer({ type: 'journal', entrée }),
  );

  // Un commentaire périodique empêche les coupures silencieuses par un proxy ou
  // une mise en veille du navigateur.
  const battement = setInterval(() => {
    try {
      réponse.write(': battement\n\n');
    } catch {
      /* ignoré */
    }
  }, 25000);

  const nettoyer = () => {
    clearInterval(battement);
    désabonnerSynchro();
    désabonnerJournal();
  };

  requête.on('close', nettoyer);
  requête.on('error', nettoyer);
}

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

async function traiter(requête, réponse, port) {
  // Barrage avant toute autre chose : réattachement DNS et requêtes croisées.
  // Voir src/securite.js pour le détail des deux attaques visées.
  const refus = refuser(requête, port);
  if (refus) {
    journal.avertir(`Requête refusée par le contrôle d’origine : ${refus}`, {
      méthode: requête.method,
      chemin: requête.url,
    });
    return répondreJSON(
      réponse,
      { erreur: 'Requête refusée : elle ne provient pas de l’interface locale.' },
      403,
    );
  }

  const url = new URL(requête.url, 'http://127.0.0.1');
  const chemin = url.pathname;

  if (chemin === '/api/evenements') return servirÉvénements(requête, réponse);
  if (!chemin.startsWith('/api/')) return servirStatique(chemin, réponse);

  const clé = `${requête.method} ${chemin}`;
  const gestionnaire = routes[clé];

  if (!gestionnaire) {
    return répondreJSON(réponse, { erreur: `Route inconnue : ${clé}` }, 404);
  }

  try {
    const corps = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(requête.method)
      ? await lireCorps(requête)
      : null;
    répondreJSON(réponse, await gestionnaire(corps, url));
  } catch (erreur) {
    if (erreur instanceof ErreurRequête) {
      return répondreJSON(réponse, { erreur: erreur.message }, erreur.statut);
    }
    journal.erreur(`Erreur sur ${clé}`, erreur.stack || erreur.message);
    répondreJSON(réponse, { erreur: 'Erreur interne. Consultez le journal.' }, 500);
  }
}

function ouvrirNavigateur(adresse) {
  const commande = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const arguments_ = process.platform === 'win32' ? ['/c', 'start', '', adresse] : [adresse];
  try {
    const processus = spawn(commande, arguments_, { detached: true, stdio: 'ignore' });
    // L'événement « error » d'un exécutable absent arrive de façon asynchrone :
    // le try/catch ne l'attrape pas, et sans écouteur il termine le processus.
    // Le moteur s'arrêterait parce qu'il n'a pas su ouvrir un navigateur.
    processus.on('error', () => {
      journal.info(`Ouvrez ${adresse} dans votre navigateur.`);
    });
    processus.unref();
  } catch {
    // Pas grave : l'adresse est affichée dans le terminal.
  }
}

function lirePortDesArguments() {
  const index = process.argv.indexOf('--port');
  if (index === -1) return null;
  const valeur = Number(process.argv[index + 1]);
  return Number.isInteger(valeur) && valeur > 1023 && valeur < 65536 ? valeur : null;
}

export function démarrer() {
  const c = config();
  const port = lirePortDesArguments() ?? c.général.port;
  // Filet général. `traiter` est asynchrone : une exception hors de ses blocs
  // try — par exemple `decodeURIComponent` sur une URL contenant un « % » isolé —
  // deviendrait un rejet non rattrapé, ce qui termine le processus Node. Le
  // moteur s'arrêterait donc sur une simple requête malformée.
  const serveur = http.createServer((requête, réponse) => {
    Promise.resolve(traiter(requête, réponse, port)).catch((erreur) => {
      journal.erreur('Erreur non rattrapée pendant le traitement d’une requête.',
        erreur.stack || erreur.message);
      if (!réponse.headersSent) {
        réponse.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      réponse.end('Erreur interne.');
    });
  });

  serveur.on('error', (erreur) => {
    if (erreur.code === 'EADDRINUSE') {
      journal.erreur(
        `Le port ${port} est déjà utilisé. Zotijean est peut-être déjà lancé — ` +
          `ouvrez http://127.0.0.1:${port} — ou choisissez un autre port avec ` +
          '« node server.js --port 9000 ».',
      );
      process.exit(1);
    }
    journal.erreur('Erreur du serveur.', erreur.message);
  });

  serveur.listen(port, '127.0.0.1', async () => {
    const adresse = `http://127.0.0.1:${port}`;
    journal.info(`Zotijean démarré sur ${adresse}`);

    const rapport = await diagnostiquer(config());
    if (!rapport.prêt) {
      journal.avertir(
        'Des points bloquants ont été détectés : ouvrez l’onglet Diagnostic de l’interface.',
      );
    }

    // L'alimentation et le type de connexion sont relus périodiquement et
    // gardés en cache : sans eux, les réglages « seulement sur secteur » et
    // « seulement en Wi-Fi » n'auraient aucun effet.
    let contexteSystème = await lireContextePlateforme();
    setInterval(async () => {
      contexteSystème = await lireContextePlateforme();
    }, 60_000).unref();

    planificateur.démarrer({
      obtenirConfig: () => config(),
      obtenirContexte: () => ({
        enCours: !!synchro.exécutionEnCours(),
        ...contexteSystème,
      }),
      lancerSynchronisation: (déclencheur) => synchro.synchroniser(déclencheur),
    });

    if (config().général.ouvrirNavigateurAuDémarrage && !process.argv.includes('--sans-navigateur')) {
      ouvrirNavigateur(adresse);
    }
  });

  const arrêterProprement = (signal) => {
    journal.info(`Signal ${signal} reçu, arrêt en cours…`);
    synchro.demanderArrêt();
    serveur.close(() => process.exit(0));
    // Filet de sécurité si une connexion refuse de se fermer.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => arrêterProprement('SIGINT'));
  process.on('SIGTERM', () => arrêterProprement('SIGTERM'));

  return serveur;
}

// Lancement direct (« node server.js »), pas lors d'un import en test.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  démarrer();
}
