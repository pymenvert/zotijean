// Taxonomie des erreurs.
//
// zotify écrit ses erreurs en anglais, en une ligne technique. Telles quelles,
// elles ne servent à rien : « Failed fetching audio key » ne dit ni ce qui s'est
// passé, ni quoi faire. Ce module les reconnaît et les traduit en un diagnostic
// utilisable — cause probable, geste à faire, et surtout si c'est grave ou non.
//
// RÈGLE : un message d'erreur qui ne dit pas quoi faire est un message raté.

/** Gravité, qui décide de la couleur et de l'insistance dans l'interface. */
export const GRAVITÉ = {
  INFO: 'info',           // normal, on informe
  ATTENTION: 'attention', // le titre est perdu, la synchronisation continue
  SÉRIEUX: 'serieux',     // il faut agir, sinon ça se reproduira
};

/**
 * Chaque entrée reconnaît un motif dans la sortie de zotify.
 * L'ordre compte : le premier motif qui correspond gagne, donc les cas les plus
 * spécifiques sont placés avant les plus généraux.
 */
export const CATALOGUE = [
  {
    code: 'cle_audio',
    motif: /audio.?key|failed fetching audio/i,
    titre: 'Spotify a refusé de livrer un morceau',
    gravité: GRAVITÉ.ATTENTION,
    explication:
      'C’est le signe que Spotify trouve les demandes trop rapprochées. Le morceau ' +
      'est sauté, pas perdu : il sera repris à la prochaine synchronisation.',
    geste: 'Si ça revient souvent, passez le rythme sur « Prudent » dans Planification.',
  },
  {
    code: 'limite_debit',
    motif: /rate.?limit|too many requests|429/i,
    titre: 'Trop de demandes envoyées à Spotify',
    gravité: GRAVITÉ.SÉRIEUX,
    explication:
      'Spotify a temporairement bridé le compte. Continuer à ce rythme augmente ' +
      'nettement le risque pour votre compte.',
    geste: 'Choisissez le rythme « Prudent » et attendez quelques heures avant de relancer.',
  },
  {
    code: 'premium_requis',
    motif: /premium|subscription required|not.*premium/i,
    titre: 'Cette qualité demande un abonnement Premium',
    gravité: GRAVITÉ.SÉRIEUX,
    explication:
      'Sans Premium, Spotify plafonne à 160 kb/s. Il ne renvoie pas d’erreur : il ' +
      'livre simplement une qualité inférieure à celle demandée.',
    geste: 'Passez la qualité sur « Élevée » dans Qualité, ou vérifiez votre abonnement.',
  },
  {
    code: 'identifiants',
    motif: /login|credential|authenticat|unauthorized|bad.?session|token/i,
    titre: 'La connexion à Spotify n’est plus valable',
    gravité: GRAVITÉ.SÉRIEUX,
    explication:
      'Les identifiants enregistrés par zotify ont expiré, ou le mot de passe du ' +
      'compte a changé.',
    geste:
      'Lancez zotify une fois dans le Terminal pour vous reconnecter, puis relancez ' +
      'la synchronisation.',
  },
  {
    code: 'indisponible',
    motif: /unavailable|not available|region|market|restricted/i,
    titre: 'Un morceau n’est pas disponible',
    gravité: GRAVITÉ.INFO,
    explication:
      'Le titre a été retiré du catalogue, ou n’est pas distribué dans votre pays. ' +
      'Rien à corriger de votre côté.',
    geste: null,
  },
  {
    code: 'ffmpeg',
    motif: /ffmpeg|ffprobe/i,
    titre: 'Problème avec ffmpeg',
    gravité: GRAVITÉ.SÉRIEUX,
    explication:
      'ffmpeg est absent ou a refusé un fichier. C’est grave : sans lui, zotify ' +
      'renomme le fichier avant de s’en apercevoir et le morceau est détruit.',
    geste: 'Installez-le avec « brew install ffmpeg », puis relancez le diagnostic.',
  },
  {
    code: 'disque_plein',
    motif: /no space|disk full|enospc/i,
    titre: 'Le disque est plein',
    gravité: GRAVITÉ.SÉRIEUX,
    explication: 'Il n’y a plus assez de place pour écrire les fichiers.',
    geste: 'Libérez de l’espace, ou choisissez un autre dossier dans Rangement.',
  },
  {
    code: 'reseau',
    motif: /network|connection|timeout|timed out|dns|unreachable|econnre/i,
    titre: 'Problème de connexion',
    gravité: GRAVITÉ.ATTENTION,
    explication:
      'La connexion a été interrompue pendant le téléchargement. Les morceaux non ' +
      'récupérés seront repris à la prochaine synchronisation.',
    geste: 'Vérifiez votre connexion internet.',
  },
  {
    code: 'droits',
    motif: /permission denied|eacces|eperm|read.?only/i,
    titre: 'Écriture refusée',
    gravité: GRAVITÉ.SÉRIEUX,
    explication:
      'Le système refuse d’écrire dans le dossier de destination. C’est fréquent ' +
      'avec les dossiers Bureau, Documents et Téléchargements, que macOS protège.',
    geste: 'Choisissez un dossier ailleurs, par exemple dans votre dossier Musique.',
  },
  {
    code: 'introuvable',
    motif: /no such file|enoent|not found/i,
    titre: 'Un fichier ou un dossier est introuvable',
    gravité: GRAVITÉ.ATTENTION,
    explication:
      'Un chemin attendu n’existe pas. Si votre bibliothèque est sur un disque ' +
      'externe, il a peut-être été débranché.',
    geste: 'Vérifiez que le disque de destination est bien connecté.',
  },
];

/**
 * Reconnaît une ligne d'erreur. Renvoie toujours quelque chose d'utilisable :
 * si aucun motif ne correspond, on rend un diagnostic générique honnête plutôt
 * que de recracher la ligne technique telle quelle.
 */
export function reconnaître(ligne) {
  const texte = String(ligne || '');

  for (const entrée of CATALOGUE) {
    if (entrée.motif.test(texte)) {
      return { ...entrée, ligneOrigine: texte, reconnu: true };
    }
  }

  return {
    code: 'inconnu',
    titre: 'Erreur non identifiée',
    gravité: GRAVITÉ.ATTENTION,
    explication:
      'zotify a signalé un problème que Zotijean ne sait pas interpréter. Le détail ' +
      'technique est conservé dans le journal.',
    geste: 'Si le problème se répète, copiez la ligne du journal pour la signaler.',
    ligneOrigine: texte,
    reconnu: false,
  };
}

/**
 * Regroupe les erreurs d'une exécution par type, avec leur nombre.
 *
 * Afficher « 47 erreurs » n'aide personne. Afficher « 47 fois : Spotify a refusé
 * de livrer un morceau — passez le rythme sur Prudent » donne une action.
 */
export function synthétiser(lignes) {
  const parCode = new Map();

  for (const ligne of lignes) {
    const texte = typeof ligne === 'string' ? ligne : ligne?.texte;
    if (!texte) continue;

    const diagnostic = reconnaître(texte);
    const existant = parCode.get(diagnostic.code);

    if (existant) {
      existant.nombre += 1;
      if (existant.exemples.length < 3) existant.exemples.push(texte);
    } else {
      parCode.set(diagnostic.code, {
        code: diagnostic.code,
        titre: diagnostic.titre,
        gravité: diagnostic.gravité,
        explication: diagnostic.explication,
        geste: diagnostic.geste,
        nombre: 1,
        exemples: [texte],
      });
    }
  }

  const ordre = { serieux: 0, attention: 1, info: 2 };
  return [...parCode.values()].sort(
    (a, b) => ordre[a.gravité] - ordre[b.gravité] || b.nombre - a.nombre,
  );
}

/** Une phrase résumant l'état d'une exécution, pour la notification et le bandeau. */
export function phraseBilan({ nbFichiers = 0, erreurs = [], interrompu = false }) {
  const synthèse = synthétiser(erreurs);
  const sérieux = synthèse.filter((s) => s.gravité === GRAVITÉ.SÉRIEUX);

  const titres = nbFichiers === 0
    ? 'Aucune nouveauté'
    : `${nbFichiers} nouveau${nbFichiers > 1 ? 'x' : ''} titre${nbFichiers > 1 ? 's' : ''}`;

  if (interrompu) return `${titres} — synchronisation interrompue`;
  if (sérieux.length) return `${titres} — ${sérieux[0].titre.toLowerCase()}`;

  const perdus = synthèse
    .filter((s) => s.gravité === GRAVITÉ.ATTENTION)
    .reduce((somme, s) => somme + s.nombre, 0);

  if (perdus) return `${titres}, ${perdus} repris plus tard`;
  return titres;
}
