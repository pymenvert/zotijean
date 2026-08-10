// Journalisation.
//
// Deux destinations : un fichier par jour (pour le diagnostic a posteriori) et un
// tampon circulaire en mémoire (pour l'affichage en direct dans l'interface).
//
// Les messages sont écrits pour être lus par quelqu'un qui n'est pas
// développeur : ils disent ce qui s'est passé et ce que ça implique, pas
// seulement un code d'erreur.

import fs from 'node:fs';
import path from 'node:path';
import { dossierJournaux, assurerDossier } from './chemins.js';

export const NIVEAU = {
  DEBUG: 'debug',
  INFO: 'info',
  AVERTISSEMENT: 'avertissement',
  ERREUR: 'erreur',
};

const ORDRE = { debug: 0, info: 1, avertissement: 2, erreur: 3 };
const TAILLE_TAMPON = 500;
const JOURS_CONSERVÉS = 14;

const tampon = [];
let fluxFichier = null;
let jourDuFlux = null;
let niveauMinimum = NIVEAU.INFO;
const abonnés = new Set();

function jourCourant() {
  // Date locale au format AAAA-MM-JJ, sans dépendre du fuseau UTC.
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function assurerFlux() {
  const jour = jourCourant();
  if (fluxFichier && jourDuFlux === jour) return fluxFichier;

  if (fluxFichier) fluxFichier.end();
  const dossier = assurerDossier(dossierJournaux());
  fluxFichier = fs.createWriteStream(path.join(dossier, `${jour}.log`), { flags: 'a' });
  jourDuFlux = jour;
  purgerAnciens(dossier);
  return fluxFichier;
}

function purgerAnciens(dossier) {
  try {
    const limite = Date.now() - JOURS_CONSERVÉS * 24 * 3600 * 1000;
    for (const nom of fs.readdirSync(dossier)) {
      if (!nom.endsWith('.log')) continue;
      const chemin = path.join(dossier, nom);
      if (fs.statSync(chemin).mtimeMs < limite) fs.unlinkSync(chemin);
    }
  } catch {
    // La purge est un confort : son échec ne doit jamais interrompre l'app.
  }
}

function horodatage(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function écrire(niveau, message, détails) {
  if (ORDRE[niveau] < ORDRE[niveauMinimum]) return;

  const entrée = {
    date: new Date().toISOString(),
    niveau,
    message,
    ...(détails !== undefined ? { détails } : {}),
  };

  tampon.push(entrée);
  if (tampon.length > TAILLE_TAMPON) tampon.shift();

  const suffixe = détails === undefined
    ? ''
    : ` — ${typeof détails === 'string' ? détails : JSON.stringify(détails)}`;
  const ligne = `${horodatage(new Date())} [${niveau}] ${message}${suffixe}\n`;

  try {
    assurerFlux().write(ligne);
  } catch {
    // Si le disque refuse l'écriture, on continue en mémoire plutôt que de
    // faire tomber l'app : perdre le journal est moins grave que perdre la sync.
  }

  if (niveau === NIVEAU.ERREUR) process.stderr.write(ligne);
  else process.stdout.write(ligne);

  for (const abonné of abonnés) {
    try {
      abonné(entrée);
    } catch {
      // Un abonné qui casse (connexion web fermée) ne doit rien interrompre.
    }
  }
}

export const journal = {
  debug: (message, détails) => écrire(NIVEAU.DEBUG, message, détails),
  info: (message, détails) => écrire(NIVEAU.INFO, message, détails),
  avertir: (message, détails) => écrire(NIVEAU.AVERTISSEMENT, message, détails),
  erreur: (message, détails) => écrire(NIVEAU.ERREUR, message, détails),

  /** Les dernières entrées, de la plus ancienne à la plus récente. */
  récent: (nombre = 200) => tampon.slice(-nombre),

  /** S'abonner au flux en direct. Renvoie une fonction de désabonnement. */
  abonner(rappel) {
    abonnés.add(rappel);
    return () => abonnés.delete(rappel);
  },

  définirNiveau(niveau) {
    if (niveau in ORDRE) niveauMinimum = niveau;
  },

  /** Chemin du fichier journal du jour, pour le bouton « Ouvrir le journal ». */
  fichierDuJour: () => path.join(dossierJournaux(), `${jourCourant()}.log`),
};
