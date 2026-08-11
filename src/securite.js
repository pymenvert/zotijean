// Protection du serveur local.
//
// LA MENACE, QUI N'EST PAS THÉORIQUE.
//
// Écouter sur 127.0.0.1 protège du réseau, pas du navigateur de l'utilisateur.
// N'importe quelle page web qu'il ouvre par ailleurs peut envoyer des requêtes
// vers http://127.0.0.1:8787. Deux attaques concrètes :
//
// 1. CSRF. Un formulaire ou un fetch depuis un site tiers peut déclencher
//    POST /api/synchroniser, ou pire, réécrire la configuration pour pointer le
//    dossier de destination ailleurs. Les requêtes « simples » (sans en-tête
//    personnalisé) partent sans contrôle préalable du navigateur.
//
// 2. Réattachement DNS. Un attaquant fait pointer evil.example vers 127.0.0.1
//    après le premier chargement ; le navigateur considère alors ses requêtes
//    comme de même origine et le pare-feu du navigateur ne joue plus. La parade
//    standard est de vérifier l'en-tête Host côté serveur : un navigateur
//    l'envoie toujours avec le nom de domaine demandé, jamais avec l'adresse IP
//    réelle.
//
// On applique les deux contrôles, plus des en-têtes qui verrouillent la page
// elle-même.

const HÔTES_AUTORISÉS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const MÉTHODES_MODIFIANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Lectures coûteuses, traitées comme des requêtes modifiantes.
 *
 * Elles ne changent rien, mais chacune déclenche un balayage complet de la
 * bibliothèque et une série d'appels à Spotify. Une simple balise <img> sur un
 * site tiers suffirait à les enchaîner : le contenu resterait inaccessible à
 * l'attaquant, mais le compte Spotify serait limité pour excès de requêtes.
 */
const LECTURES_COÛTEUSES = new Set([
  '/api/spotify/manquants',
  '/api/spotify/playlists',
  '/api/simulation',
  '/api/diagnostic',
]);

/**
 * Extrait le nom d'hôte d'un en-tête Host, sans le port.
 * Gère la forme IPv6 entre crochets, où les deux-points ne séparent pas le port.
 */
export function hôteSansPort(entête) {
  const texte = String(entête || '').trim().toLowerCase();
  if (!texte) return '';
  if (texte.startsWith('[')) {
    const fin = texte.indexOf(']');
    return fin === -1 ? texte : texte.slice(0, fin + 1);
  }
  return texte.split(':')[0];
}

/**
 * Vérifie qu'une requête vient bien de l'interface locale.
 * Renvoie `null` si tout va bien, ou un message d'explication à refuser.
 */
export function refuser(requête, port) {
  // --- Contrôle 1 : réattachement DNS -----------------------------------
  // Sans en-tête Host, on ne peut rien affirmer : on refuse.
  const hôte = hôteSansPort(requête.headers.host);
  if (!hôte || !HÔTES_AUTORISÉS.has(hôte)) {
    return `Hôte non autorisé : ${requête.headers.host || '(absent)'}`;
  }

  // --- Contrôle 2 : origine croisée -------------------------------------
  // Le navigateur pose Origin sur toute requête modifiante et sur toute requête
  // croisée. S'il est présent, il doit désigner notre propre serveur.
  const origine = requête.headers.origin;
  if (origine) {
    let analysée;
    try {
      analysée = new URL(origine);
    } catch {
      return `Origine illisible : ${origine}`;
    }

    const hôteOrigine = analysée.hostname.toLowerCase();
    const portOrigine = analysée.port || (analysée.protocol === 'https:' ? '443' : '80');

    if (!HÔTES_AUTORISÉS.has(hôteOrigine) || Number(portOrigine) !== Number(port)) {
      return `Origine refusée : ${origine}`;
    }
  } else if (
    MÉTHODES_MODIFIANTES.has(requête.method)
    || LECTURES_COÛTEUSES.has(String(requête.url || '').split('?')[0])
  ) {
    // Une requête modifiante sans Origin ne vient pas d'un navigateur moderne.
    // On tolère les outils en ligne de commande (curl, tests) uniquement s'ils
    // s'annoncent explicitement, ce qu'un site web ne peut pas falsifier :
    // ajouter un en-tête personnalisé déclenche un contrôle préalable que nous
    // ne validons jamais.
    if (requête.headers['x-zotijean'] !== 'local') {
      return 'Requête modifiante sans origine identifiable.';
    }
  }

  return null;
}

/**
 * En-têtes posés sur toute réponse.
 *
 * La politique de sécurité du contenu est stricte parce qu'elle le peut :
 * l'interface n'a aucune dépendance externe, donc rien n'a besoin d'être chargé
 * depuis ailleurs. `connect-src 'self'` empêche une éventuelle injection
 * d'exfiltrer quoi que ce soit.
 */
export const ENTÊTES_SÉCURITÉ = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
