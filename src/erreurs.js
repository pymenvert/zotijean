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
  // EN PREMIER, ET CE N'EST PAS UN DÉTAIL D'ORDRE.
  //
  // Cette ligne contient « FAILED TO FETCH » : sans entrée dédiée elle tombait
  // en « erreur non identifiée », gravité ATTENTION, c'est-à-dire « le titre est
  // perdu ». Le 19 août 2026, 19 des 22 « erreurs » de la journée étaient
  // celle-ci — pendant que les titres arrivaient entiers sur le disque.
  //
  // Elle ne devrait plus apparaître du tout depuis que Zotijean passe
  // « --lyrics-to-metadata false », mais un vieux fork qui ignore cette option
  // continuera de l'écrire. La reconnaître coûte trois lignes ; ne pas la
  // reconnaître coûtait un horaire de synchronisation reporté.
  {
    code: 'paroles_absentes',
    motif: /skipping:?\s*lyrics|lyrics (?:for|not)/i,
    titre: 'Paroles introuvables pour un morceau',
    gravité: GRAVITÉ.INFO,
    explication:
      'Le morceau est téléchargé normalement : seules ses paroles manquent, et vous ' +
      'ne les avez pas demandées. Rien n’est perdu.',
    geste: 'Rien à faire.',
  },
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
    titre: 'Le téléchargement demande un compte Spotify Premium',
    gravité: GRAVITÉ.SÉRIEUX,
    // LE GESTE CONSEILLÉ ENVOYAIT DANS LE MUR. Il disait « passez la qualité sur
    // Élevée » — ce qui n'y change rien, puisque Premium est requis pour
    // télécharger, pas seulement pour le 320 kb/s. C'est le seul message qui
    // intercepte l'échec d'un utilisateur sans abonnement : lui faire baisser la
    // qualité et relancer lui coûtait une seconde exécution pour rien.
    explication:
      'Spotify réserve le téléchargement aux comptes Premium. Baisser la qualité ' +
      'ne change rien : c’est l’accès lui-même qui est refusé, pas le débit.',
    geste:
      'Vérifiez que le compte connecté à zotify est bien un compte Premium et que ' +
      'l’abonnement est actif. Si vous venez de vous abonner, relancez zotify une ' +
      'fois dans le Terminal pour qu’il rafraîchisse vos identifiants.',
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

/**
 * Ce qu'une ligne de zotify doit devenir dans le journal.
 *
 * CE QU'ELLE RÉPARE. Le 19 août 2026, l'utilisateur a lu ceci, tel quel :
 *
 *     zotify : ConnectionResetError: [Errno 54] Connection reset by peer
 *     zotify : ConnectionRefusedError: [Errno 61] Connection refused
 *
 * Le catalogue savait pourtant les traduire — c'est le journal qui recopiait la
 * ligne d'origine AVANT de passer par lui. Toute la taxonomie de ce fichier
 * était contournée à l'endroit précis où elle sert le plus : le seul endroit où
 * l'utilisateur regarde quand quelque chose ne va pas.
 *
 * La règle du projet : « ce qui s'est passé, ce que ça implique, quoi faire. »
 * Un numéro d'erreur système ne dit aucune des trois.
 *
 * La ligne d'origine n'est pas jetée pour autant : elle part en détail, pour
 * qu'un rapport de panne reste exploitable. Et une ligne que le catalogue ne
 * reconnaît PAS est conservée telle quelle — la traduire au jugé effacerait la
 * seule information exploitable qu'elle contient.
 */
export function phraseJournal(ligne) {
  const diagnostic = reconnaître(ligne);
  if (!diagnostic.reconnu) return { texte: `zotify : ${ligne}` };

  const geste = diagnostic.geste ? ` ${diagnostic.geste}` : '';
  return {
    texte: `${diagnostic.titre} — ${diagnostic.explication}${geste}`,
    détail: String(ligne),
  };
}

/**
 * Combien de TITRES ont réellement été perdus.
 *
 * TROIS CHOSES ÉTAIENT CONFONDUES DANS UN SEUL CHIFFRE, et le projet l'a payé :
 *
 *   1. le nombre de lignes que zotify a signalées,
 *   2. le nombre de titres réellement perdus,
 *   3. le fait qu'une playlist soit allée jusqu'au bout.
 *
 * Une ligne d'information — des paroles introuvables — gonflait les trois. Elle
 * ne doit peser sur aucune des deux dernières : le morceau est sur le disque.
 *
 * Cette fonction répond à la deuxième question, et à elle seule. Un SÉRIEUX
 * compte aussi : une limitation de débit signifie bien un morceau non obtenu.
 */
export function compterTitresPerdus(lignes) {
  return synthétiser(lignes)
    .filter((s) => s.gravité === GRAVITÉ.ATTENTION || s.gravité === GRAVITÉ.SÉRIEUX)
    .reduce((somme, s) => somme + s.nombre, 0);
}

/** Une phrase résumant l'état d'une exécution, pour la notification et le bandeau. */
export function phraseBilan({
  nbFichiers = 0, erreurs = [], interrompu = false, échec = null,
}) {
  const synthèse = synthétiser(erreurs);
  const sérieux = synthèse.filter((s) => s.gravité === GRAVITÉ.SÉRIEUX);

  const titres = nbFichiers === 0
    ? 'Aucune nouveauté'
    : `${nbFichiers} nouveau${nbFichiers > 1 ? 'x' : ''} titre${nbFichiers > 1 ? 's' : ''}`;

  // UN ÉCHEC PASSE AVANT TOUT LE RESTE, et c'est le dernier tiers d'un correctif
  // qui n'en avait que deux. Un zotify qui meurt sans rien dire ne produit ni
  // fichier ni ligne d'erreur, et n'est pas « interrompu » : cette fonction
  // rendait donc « Aucune nouveauté », que l'interface affichait EN VERT et
  // envoyait en notification système, pendant que le bandeau, lui, disait bien
  // l'échec. La date de référence et le compteur d'échecs étaient corrigés ;
  // la phrase que l'utilisateur lit, non. Trouvé en revue le 21 août 2026.
  if (échec) return 'La synchronisation a échoué';

  if (interrompu) return `${titres} — synchronisation interrompue`;
  if (sérieux.length) return `${titres} — ${sérieux[0].titre.toLowerCase()}`;

  const perdus = synthèse
    .filter((s) => s.gravité === GRAVITÉ.ATTENTION)
    .reduce((somme, s) => somme + s.nombre, 0);

  if (perdus) return `${titres}, ${perdus} repris plus tard`;
  return titres;
}
