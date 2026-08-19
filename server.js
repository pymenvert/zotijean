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

import { config, assurerFichierConfig } from './src/config.js';
import { journal } from './src/journal.js';
import { routes, ErreurRequête, définirPortÉcoute } from './src/api.js';
import { refuser, ENTÊTES_SÉCURITÉ } from './src/securite.js';
import { lireContextePlateforme } from './src/energie.js';
import { terminerConnexion as terminerConnexionSpotify } from './src/spotify.js';
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
      // Le contenu est déjà entièrement en mémoire : annoncer sa taille évite
      // l'encodage par morceaux et permet au client de savoir où il va.
      'Content-Length': contenu.length,
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

/**
 * Retire d'une URL les paramètres qui ne doivent jamais être écrits.
 *
 * Le retour de Spotify porte un code d'autorisation en clair dans son adresse.
 * Journaliser l'URL brute d'une requête refusée l'inscrirait donc dans un
 * fichier que l'utilisateur peut exporter et transmettre pour signaler un
 * problème. Le code est à usage unique et de courte durée, mais un secret qui
 * traîne dans un fichier partagé reste un secret qui traîne.
 */
const PARAMÈTRES_SENSIBLES = new Set(['code', 'state', 'access_token', 'refresh_token']);

export function cheminSansSecret(url) {
  try {
    const analysée = new URL(url, 'http://127.0.0.1');
    for (const clé of analysée.searchParams.keys()) {
      if (PARAMÈTRES_SENSIBLES.has(clé)) analysée.searchParams.set(clé, '(masqué)');
    }
    return analysée.pathname + (analysée.search || '');
  } catch {
    // URL illisible : on ne garde que ce qui précède le premier « ? », pour ne
    // pas recopier une chaîne inconnue dans le journal.
    return String(url).split('?')[0];
  }
}

// ---------------------------------------------------------------------------
// Retour de Spotify après autorisation
// ---------------------------------------------------------------------------

const ÉCHAPPEMENTS_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const échapperHTML = (texte) =>
  String(texte ?? '').replace(/[&<>"']/g, (c) => ÉCHAPPEMENTS_HTML[c]);

/**
 * Page de fin de connexion, affichée dans le navigateur de l'utilisateur.
 *
 * Elle porte son style dans une feuille SÉPARÉE, comme tout le reste de
 * l'interface. Le bloc `<style>` qu'elle avait avant obligeait à réécrire la
 * politique de sécurité rien que pour elle, en y rouvrant « unsafe-inline » :
 * deux politiques divergentes à maintenir, pour une seule page. `src/securite.js`
 * est désormais la seule.
 *
 * La contrepartie est assumée : si la feuille ne se charge pas, la page s'affiche
 * nue. Or c'est PRÉCISÉMENT celle qui annonce si l'authentification a abouti. Le
 * verdict est donc écrit en toutes lettres, dans le premier élément du corps, en
 * gras par la balise et non par le style. La couleur ne fait que le confirmer.
 */
export function pageRetour({ titre, message, réussi }) {
  // `=== true`, et pas seulement une valeur vraie. Les deux erreurs possibles ne
  // se valent pas : annoncer un échec sur une réussite fait relancer une
  // connexion qui marchait, annoncer une réussite sur un échec envoie
  // l'utilisateur attendre des téléchargements qui ne viendront jamais. Une
  // chaîne 'false', un objet vide ou un 1 renvoyés par un appelant distrait
  // basculaient du mauvais côté.
  const aAbouti = réussi === true;
  const verdict = aAbouti ? 'Connexion réussie' : 'Connexion non établie';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zotijean — ${échapperHTML(titre)}</title>
<link rel="stylesheet" href="/palette.css">
<link rel="stylesheet" href="/retour.css">
</head><body class="${aAbouti ? 'reussi' : 'echec'}"><main class="boite">
  <p class="verdict"><span class="pastille" aria-hidden="true"></span><strong>${verdict}</strong></p>
  <h1>${échapperHTML(titre)}</h1>
  <p class="message">${échapperHTML(message)}</p>
</main></body></html>`;
}

async function servirRetourSpotify(url, réponse) {
  const envoyer = (contenu, statut = 200) => {
    réponse.writeHead(statut, {
      // Aucune politique locale : cette page suit la politique commune, qui
      // autorise déjà « style-src 'self' » — donc /retour.css.
      ...ENTÊTES_SÉCURITÉ,
      'Content-Type': 'text/html; charset=utf-8',
    });
    réponse.end(contenu);
  };

  const erreur = url.searchParams.get('error');
  if (erreur) {
    return envoyer(pageRetour({
      titre: 'Connexion annulée',
      message: erreur === 'access_denied'
        ? 'Vous avez refusé l’accès. Vous pouvez fermer cet onglet et réessayer quand vous voulez.'
        // Borné en plus d'être échappé : ce paramètre vient de l'extérieur, et
        // rien ne garantit qu'il ressemble à un code d'erreur.
        : `Spotify a renvoyé : ${
            /^[A-Za-z0-9_-]{1,64}$/.test(erreur) ? erreur : 'une erreur inattendue'
          }. Vous pouvez fermer cet onglet.`,
      réussi: false,
    }));
  }

  // L'échange avec Spotify passe par le réseau : une coupure de Wi-Fi au
  // mauvais moment produisait une page blanche « Erreur interne », sans que
  // l'utilisateur sache s'il devait recommencer.
  let résultat;
  try {
    résultat = await terminerConnexionSpotify(
      url.searchParams.get('code'),
      url.searchParams.get('state'),
    );
  } catch (erreur) {
    journal.avertir('Échange du code Spotify impossible.', erreur.message);
    résultat = {
      réussi: false,
      raison: 'La connexion à Spotify a été interrompue. Vérifiez votre accès à ' +
        'internet, puis relancez la connexion depuis Zotijean.',
    };
  }

  return envoyer(pageRetour(résultat.réussi
    ? {
        titre: 'Compte Spotify connecté',
        message: 'Vous pouvez fermer cet onglet et revenir à Zotijean.',
        réussi: true,
      }
    : { titre: 'La connexion a échoué', message: résultat.raison, réussi: false }));
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
      chemin: cheminSansSecret(requête.url),
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

  // La page de retour de Spotify est un cas à part : c'est le NAVIGATEUR que
  // Spotify redirige ici, pas notre interface. Elle doit donc répondre en HTML
  // lisible, et non en JSON.
  if (chemin === '/api/spotify/retour') return servirRetourSpotify(url, réponse);
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

/**
 * Reprend le port à un moteur Zotijean abandonné.
 *
 * Après un plantage, un moteur peut rester en écoute alors que plus rien ne le
 * pilote : l'application refuserait alors de démarrer sur un « port déjà
 * utilisé » que l'utilisateur ne sait pas résoudre.
 *
 * ON N'ARRÊTE QUE CE QU'ON A IDENTIFIÉ. Tuer à l'aveugle ce qui occupe un port
 * reviendrait à arrêter le programme de quelqu'un d'autre : on interroge donc
 * la carte d'identité, et on s'abstient au moindre doute.
 */
async function reprendreLePort(port) {
  let identité;
  try {
    const réponse = await fetch(`http://127.0.0.1:${port}/api/identite`, {
      signal: AbortSignal.timeout(3000),
      headers: { 'X-Zotijean': 'local' },
    });
    if (!réponse.ok) return false;
    identité = await réponse.json();
  } catch {
    return false; // injoignable ou muet : ce n'est pas nous, on ne touche à rien
  }

  if (identité?.application !== 'zotijean' || !Number.isInteger(identité.pid)) return false;
  if (identité.pid === process.pid) return false;

  journal.avertir(
    `Un moteur Zotijean tournait encore sur le port ${port} (démarré le ` +
      `${new Date(identité.démarréLe).toLocaleString('fr-FR')}). Il est arrêté ` +
      'pour laisser la place à celui-ci.',
  );

  try {
    process.kill(identité.pid, 'SIGTERM');
  } catch {
    return false; // déjà parti, ou hors de notre portée
  }

  // On lui laisse le temps de s'arrêter proprement : il écrit son état et
  // interrompt une éventuelle synchronisation.
  for (let essai = 0; essai < 20; essai++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      process.kill(identité.pid, 0);
    } catch {
      return true; // il a rendu la main
    }
  }

  try {
    process.kill(identité.pid, 'SIGKILL');
  } catch { /* déjà parti */ }
  return true;
}

/**
 * S'arrêter quand l'application qui nous a lancés disparaît.
 *
 * LE TROU QUE CELA COMBLE. À une fermeture normale, la coquille macOS nous
 * envoie un signal et tout s'arrête proprement. Mais un « forcer à quitter » ou
 * un plantage ne déclenche AUCUN signal, et macOS ne tue pas les processus
 * enfants avec leur parent : ils sont rattachés au système et continuent.
 *
 * L'utilisateur croit alors avoir tout arrêté, pendant qu'un téléchargement
 * poursuit sa route, invisible, et garde le port occupé — ce qui empêche le
 * prochain démarrage.
 *
 * On surveille donc le parent nous-mêmes. Uniquement quand la coquille nous a
 * transmis son identifiant : lancée depuis un terminal, l'app doit pouvoir
 * survivre à la fermeture du shell.
 */
function surveillerParent(arrêter) {
  const parent = Number(process.env.ZOTIJEAN_PARENT);
  if (!Number.isInteger(parent) || parent <= 1) return;

  const minuterie = setInterval(() => {
    try {
      // Le signal 0 ne tue rien : il teste seulement l'existence.
      process.kill(parent, 0);
    } catch (erreur) {
      if (erreur.code === 'EPERM') return; // existe, mais ne nous appartient pas
      clearInterval(minuterie);
      journal.info('L’application hôte s’est fermée : arrêt du moteur.');
      arrêter('parent disparu');
    }
  }, 5000);

  minuterie.unref();
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

  // L'adresse de retour de Spotify doit désigner le port réellement écouté,
  // pas celui des réglages.
  définirPortÉcoute(port);
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

  let repriseTentée = false;

  serveur.on('error', async (erreur) => {
    if (erreur.code !== 'EADDRINUSE') {
      journal.erreur('Erreur du serveur.', erreur.message);
      return;
    }

    // Une seule tentative : deux instances qui se reprendraient le port l'une à
    // l'autre tourneraient en boucle.
    if (!repriseTentée) {
      repriseTentée = true;
      if (await reprendreLePort(port)) {
        serveur.listen(port, '127.0.0.1');
        return;
      }
    }

    journal.erreur(
      `Le port ${port} est occupé par un autre programme que Zotijean. ` +
        'Fermez-le, ou lancez Zotijean sur un autre port avec ' +
        '« node server.js --port 9000 ».',
    );
    process.exit(1);
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
    // Pose les réglages sur le disque s'ils n'y sont pas encore. C'est aussi ce
    // fichier qui permet à la coquille macOS de reconnaître un premier
    // lancement, et de montrer le tableau de bord à ce moment-là.
    assurerFichierConfig();

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

  // UNE PROMESSE REJETÉE NE DOIT PAS TUER LE MOTEUR EN SILENCE.
  //
  // Depuis Node 15, un rejet non rattrapé arrête le processus. Au milieu d'un
  // rattrapage de dix-sept heures, ça veut dire un téléchargement qui s'arrête
  // sans un mot et sans rien dans le journal — l'utilisateur retrouve une
  // bibliothèque à moitié remplie et aucune explication.
  //
  // On préfère rester debout et le dire. Le verrou et l'état sont écrits de
  // façon atomique : continuer est plus sûr que mourir.
  process.on('unhandledRejection', (raison) => {
    journal.erreur(
      'Une opération a échoué sans être rattrapée. Le moteur continue, mais signalez-le.',
      raison?.stack || String(raison),
    );
  });

  process.on('uncaughtException', (erreur) => {
    journal.erreur('Erreur inattendue dans le moteur.', erreur?.stack || String(erreur));
  });

  surveillerParent(arrêterProprement);

  return serveur;
}

// Lancement direct (« node server.js »), pas lors d'un import en test.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  démarrer();
}
