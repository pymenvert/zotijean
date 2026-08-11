// Reconnaître qu'un fichier du disque EST un morceau donné.
//
// Le problème est plus subtil qu'il n'y paraît. On connaît d'un côté le contenu
// exact d'une playlist — grâce à l'API Spotify — et de l'autre une liste de
// noms de fichiers écrits par zotify. Rien ne garantit qu'ils se ressemblent :
// zotify assainit les noms à sa façon, l'utilisateur a pu changer de modèle de
// rangement, ajouter ses propres fichiers, ou renommer.
//
// LA RÈGLE QUI GOUVERNE CE MODULE : dans le doute, on considère le morceau
// comme PRÉSENT. Se tromper dans ce sens coûte un morceau manquant qu'on ne
// signale pas ; se tromper dans l'autre relance un téléchargement de plusieurs
// heures et fait croire à l'utilisateur que sa bibliothèque est incomplète.
// L'erreur n'est pas symétrique, la prudence non plus.

import path from 'node:path';

/**
 * Réduit un texte à sa forme comparable.
 *
 * On retire les accents — macOS peut les écrire de deux façons — la ponctuation,
 * la casse et les espaces multiples. « Étienne de Crécy » et « etienne de crecy »
 * deviennent la même chose, ce qui est le but.
 */
export function normaliser(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // accents, une fois les caractères décomposés
    .toLowerCase()
    .replace(/[’'`´]/g, '')            // apostrophes de toutes formes
    .replace(/[^a-z0-9]+/g, ' ')       // le reste devient séparateur
    .trim();
}

/**
 * Les mots d'un titre qui ne le caractérisent pas.
 *
 * « (Radio Edit) », « - Remastered 2011 » et consorts sont ajoutés ou retirés
 * selon les sources. Les garder ferait conclure à tort qu'un morceau manque.
 */
const ORNEMENTS = [
  'remaster', 'remastered', 'radio edit', 'album version', 'single version',
  'bonus track', 'deluxe', 'explicit', 'feat', 'featuring', 'with',
  'original mix', 'extended mix', 'edit',
];

/** Forme courte d'un titre, débarrassée de ses ornements. */
export function noyau(titre) {
  let texte = normaliser(titre);
  for (const ornement of ORNEMENTS) {
    texte = texte.replace(new RegExp(`\\b${ornement}\\b`, 'g'), ' ');
  }
  const réduit = texte.replace(/\s+/g, ' ').trim();

  // Un titre RÉELLEMENT nommé « Edit » ou « Deluxe » se viderait entièrement,
  // et le morceau deviendrait introuvable à jamais — donc éternellement
  // « manquant », donc retéléchargé à chaque synchronisation. On garde alors le
  // titre normalisé tel quel.
  return réduit || normaliser(titre);
}

/**
 * Empreintes d'un morceau, de la plus sûre à la plus tolérante.
 * On en produit plusieurs parce qu'un fichier peut avoir été nommé selon
 * n'importe quel modèle : « artiste - titre », « 007 - artiste - titre »,
 * ou le titre seul.
 */
export function empreintes(piste) {
  const titre = noyau(piste.titre);
  if (!titre) return { sûres: [], laxistes: [] };

  // Toutes les façons dont l'artiste peut apparaître : le principal, la liste
  // complète — un fichier nommé d'après un morceau en featuring —, et chacun
  // pris isolément.
  const artistes = [
    piste.artiste,
    ...(piste.artistes || []),
    (piste.artistes || []).join(' '),
  ].map(normaliser).filter(Boolean);

  const propre = (f) => f.replace(/\s+/g, ' ').trim();

  const sûres = [...new Set(
    artistes.flatMap((a) => [propre(`${a} ${titre}`), propre(`${titre} ${a}`)]),
  )].filter(Boolean);

  // Le titre seul est une empreinte de dernier recours : deux morceaux
  // homonymes d'artistes différents la partagent. Elle est donc séparée, et
  // n'est essayée qu'après avoir épuisé les empreintes sûres — sinon un
  // rapprochement approximatif volerait le fichier d'une correspondance exacte
  // traitée plus tard.
  return { sûres, laxistes: [titre] };
}

/**
 * Empreintes tirées d'un nom de fichier.
 * On retire l'extension et le numéro de tête, qui varient selon le modèle.
 */
export function empreintesFichier(chemin) {
  const base = path.basename(chemin, path.extname(chemin));
  const sansNuméro = base.replace(/^\d{1,3}\s*[-._]\s*/, '');
  const normalisé = noyau(sansNuméro);

  // Le nom complet, plus chaque moitié autour du tiret séparateur : un fichier
  // « Artiste - Titre » doit pouvoir correspondre au titre seul.
  // Une chaîne vide dans l'index ferait correspondre n'importe quoi.
  const formes = normalisé ? [normalisé] : [];
  for (const morceau of sansNuméro.split(/\s+-\s+/)) {
    const propre = noyau(morceau);
    if (propre) formes.push(propre);
  }
  return [...new Set(formes)];
}

/**
 * Confronte le contenu réel d'une playlist aux fichiers présents.
 *
 * `pistes` vient de l'API Spotify, `fichiers` du disque. Renvoie ce qui manque,
 * ce qui est là, et ce qui est là SANS appartenir à la playlist — cette
 * dernière liste étant celle que la politique de retrait consomme.
 */
export function confronter(pistes, fichiers) {
  const indexFichiers = new Map();
  for (const fichier of fichiers) {
    for (const empreinte of empreintesFichier(fichier)) {
      if (!indexFichiers.has(empreinte)) indexFichiers.set(empreinte, fichier);
    }
  }

  // Un morceau peut figurer DEUX FOIS dans une playlist. Sans déduplication, le
  // second exemplaire ne trouve plus de fichier libre et reste éternellement
  // « manquant » — donc retéléchargé à chaque synchronisation.
  const vues = new Set();
  const uniques = pistes.filter((p) => {
    const clé = p.id || `${normaliser(p.artiste)}|${noyau(p.titre)}`;
    if (vues.has(clé)) return false;
    vues.add(clé);
    return true;
  });

  const présents = [];
  const fichiersReconnus = new Set();
  const disponible = (fichier) => fichier && !fichiersReconnus.has(fichier);

  const attribuer = (piste, formes) => {
    const trouvé = formes.map((e) => indexFichiers.get(e)).find(disponible);
    if (!trouvé) return false;
    présents.push({ piste, fichier: trouvé });
    fichiersReconnus.add(trouvé);
    return true;
  };

  // DEUX PASSES, et l'ordre compte. On épuise d'abord les correspondances qui
  // portent l'artiste, donc fiables. Ne rapprocher que par le titre au premier
  // tour laisserait un morceau approximatif voler le fichier d'une
  // correspondance exacte traitée plus tard dans la liste.
  const restantes = [];
  for (const piste of uniques) {
    const { sûres, laxistes } = empreintes(piste);
    if (!attribuer(piste, sûres)) restantes.push({ piste, laxistes });
  }

  const manquants = [];
  for (const { piste, laxistes } of restantes) {
    if (!attribuer(piste, laxistes)) manquants.push(piste);
  }

  return {
    présents,
    manquants,
    // Volontairement nommés « non reconnus » et non « à supprimer » : ce sont
    // aussi bien des morceaux retirés de la playlist que des fichiers déposés à
    // la main, ou simplement nommés d'une façon qu'on n'a pas su rapprocher.
    nonReconnus: fichiers.filter((f) => !fichiersReconnus.has(f)),
    fiabilité: fiabilité(uniques.length, présents.length, fichiers.length),
  };
}

/**
 * Jusqu'à quel point peut-on se fier à cette confrontation ?
 *
 * Si presque rien ne correspond alors que le dossier est plein, c'est que le
 * rapprochement a échoué — pas que la bibliothèque est vide. Aucune décision
 * destructrice ne doit être prise sur cette base.
 */
function fiabilité(nbPistes, nbTrouvés, nbFichiers) {
  if (nbPistes === 0) return { sûre: false, raison: 'La playlist est vide ou illisible.' };
  if (nbFichiers === 0) return { sûre: true, raison: 'Aucun fichier : tout est à télécharger.' };

  // On rapporte aux FICHIERS, pas aux pistes. Rapporté aux pistes, le garde-fou
  // se neutralisait lui-même : 100 morceaux attendus et 40 fichiers illisibles
  // donnaient « fiable », alors que pas un seul fichier n'avait été reconnu.
  // Ce qui doit alerter, c'est qu'une part importante des fichiers présents
  // reste orpheline.
  const partRattachée = nbTrouvés / nbFichiers;
  if (partRattachée < 0.5 && nbFichiers >= 5) {
    return {
      sûre: false,
      raison:
        `Seuls ${nbTrouvés} des ${nbFichiers} fichiers présents ont pu être ` +
        `rattachés aux ${nbPistes} morceaux de la playlist. Le rapprochement ` +
        'n’est pas fiable : aucun fichier ne sera déplacé.',
    };
  }

  return { sûre: true, raison: null };
}
