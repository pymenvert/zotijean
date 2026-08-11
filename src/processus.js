// Lancement de sous-processus, et surtout : construction d'un PATH utilisable.
//
// LE PIÈGE QUE CE MODULE EXISTE POUR ÉVITER.
//
// Une application lancée depuis le Finder n'hérite pas du PATH du Terminal. Elle
// reçoit un PATH minimal qui ne contient ni /opt/homebrew/bin (Homebrew sur
// Apple Silicon), ni ~/.local/bin (pipx). Autrement dit : tout ce que
// l'utilisateur a installé lui-même est invisible.
//
// Ce n'est pas un désagrément cosmétique. zotify renomme le fichier téléchargé
// AVANT de découvrir que ffmpeg est absent, et ne le restaure jamais : le
// morceau est détruit sans le moindre message d'erreur. On construit donc
// explicitement un PATH complet avant tout lancement.

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { dossiersEmbarqués } from './chemins.js';

/** Dossiers où vivent réellement les outils installés par l'utilisateur. */
function dossiersCandidats() {
  const maison = os.homedir();

  if (process.platform === 'darwin') {
    return [
      '/opt/homebrew/bin',                                   // Homebrew, Apple Silicon
      '/opt/homebrew/sbin',
      '/usr/local/bin',                                      // Homebrew, Intel
      '/usr/local/sbin',
      path.join(maison, '.local', 'bin'),                    // pipx, pip --user
      path.join(maison, 'Library', 'Python', '3.13', 'bin'),
      path.join(maison, 'Library', 'Python', '3.12', 'bin'),
      path.join(maison, 'Library', 'Python', '3.11', 'bin'),
      path.join(maison, '.pyenv', 'shims'),
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ];
  }

  if (process.platform === 'win32') {
    return [
      path.join(maison, '.local', 'bin'),
      path.join(maison, 'AppData', 'Roaming', 'Python', 'Scripts'),
      path.join(maison, 'scoop', 'shims'),
      'C:\\ProgramData\\chocolatey\\bin',
    ];
  }

  return [path.join(maison, '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/bin'];
}

/**
 * Le PATH d'origine, enrichi des dossiers candidats qui existent vraiment.
 *
 * Les outils EMBARQUÉS passent devant tout le reste : c'est ce qui garantit
 * qu'un paquet autonome utilise sa propre copie de ffmpeg et de zotify, et non
 * une version installée ailleurs sur la machine dont on ne sait rien.
 */
export function cheminEnrichi(supplémentaires = []) {
  const séparateur = process.platform === 'win32' ? ';' : ':';
  const embarqués = dossiersEmbarqués();
  const actuel = [...embarqués, ...(process.env.PATH || '').split(séparateur)]
    .filter(Boolean);

  const vus = new Set(actuel.map((d) => d.toLowerCase()));
  const ajouts = [];

  for (const dossier of [...supplémentaires, ...dossiersCandidats()]) {
    if (!dossier) continue;
    const clé = dossier.toLowerCase();
    if (vus.has(clé)) continue;
    try {
      if (fs.statSync(dossier).isDirectory()) {
        ajouts.push(dossier);
        vus.add(clé);
      }
    } catch {
      // Dossier absent sur cette machine : normal, on passe.
    }
  }

  return [...actuel, ...ajouts].join(séparateur);
}

/** L'environnement à passer à tout sous-processus lancé par l'app. */
export function environnement(extra = {}) {
  return {
    ...process.env,
    PATH: cheminEnrichi(),
    // zotify et ffmpeg écrivent des noms de fichiers accentués : sans un
    // encodage explicite, Python peut retomber sur l'ASCII et échouer.
    PYTHONIOENCODING: 'utf-8',
    LC_ALL: process.env.LC_ALL || 'fr_FR.UTF-8',
    ...extra,
  };
}

/**
 * Localise un exécutable, en cherchant d'abord dans le PATH enrichi.
 * Renvoie le chemin absolu, ou null.
 */
export function trouverExécutable(nom) {
  const séparateur = process.platform === 'win32' ? ';' : ':';
  const extensions = process.platform === 'win32'
    ? ['.exe', '.cmd', '.bat', '']
    : [''];

  for (const dossier of cheminEnrichi().split(séparateur)) {
    for (const ext of extensions) {
      const candidat = path.join(dossier, nom + ext);
      try {
        const stat = fs.statSync(candidat);
        if (stat.isFile()) {
          if (process.platform !== 'win32') {
            fs.accessSync(candidat, fs.constants.X_OK);
          }
          return candidat;
        }
      } catch {
        // Pas ici, on continue.
      }
    }
  }
  return null;
}

/**
 * Lance une commande et attend sa fin.
 * Ne rejette jamais sur un code de sortie non nul : l'appelant décide. C'est
 * volontaire — zotify renvoie 0 même en cas d'échec, donc un code de sortie
 * n'est de toute façon pas une source de vérité fiable dans ce projet.
 */
export function exécuter(commande, arguments_ = [], options = {}) {
  const { délaiMs = 15000, entrée = null, dossier = undefined } = options;

  return new Promise((résoudre) => {
    let processus;
    try {
      processus = spawn(commande, arguments_, {
        env: environnement(),
        cwd: dossier,
        windowsHide: true,
      });
    } catch (erreur) {
      résoudre({ code: null, stdout: '', stderr: String(erreur.message), erreur, expiré: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let expiré = false;

    const minuterie = setTimeout(() => {
      expiré = true;
      processus.kill('SIGKILL');
    }, délaiMs);

    processus.stdout?.on('data', (bloc) => { stdout += bloc.toString('utf8'); });
    processus.stderr?.on('data', (bloc) => { stderr += bloc.toString('utf8'); });

    processus.on('error', (erreur) => {
      clearTimeout(minuterie);
      résoudre({ code: null, stdout, stderr, erreur, expiré });
    });

    processus.on('close', (code) => {
      clearTimeout(minuterie);
      résoudre({ code, stdout, stderr, erreur: null, expiré });
    });

    if (entrée !== null) {
      processus.stdin?.end(entrée);
    }
  });
}
