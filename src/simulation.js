// Mode simulation : montrer ce qui se passerait, sans rien télécharger.
//
// Pourquoi c'est une vraie fonctionnalité et pas un outil de mise au point : un
// premier rattrapage dure des heures et remplit un disque. Personne ne devrait
// avoir à le lancer pour découvrir qu'il visait le mauvais dossier, que le
// modèle de rangement ne donnait pas ce qu'il croyait, ou qu'il manque 30 Go.
//
// La simulation ne lance jamais zotify. Elle n'a donc aucun moyen de savoir
// combien de titres sont réellement nouveaux — et elle le dit, au lieu
// d'inventer un chiffre.

import path from 'node:path';

import { config, attenteEffective, configPourPlaylist } from './config.js';
import { espaceLibre, volumeMonté } from './chemins.js';
import { diagnostiquer, GRAVITÉ } from './diagnostic.js';
import { cheminRelatif, modèleActif } from './organisation.js';
import { trouver, FORMATS } from './options.js';
import { listerAudio } from './bibliotheque.js';
import { nécessiteConversion } from './conversion.js';
import { inventorier } from './zotify.js';
import { duréeEnFrançais } from './planificateur.js';

const Go = 1024 ** 3;
const Mo = 1024 ** 2;

/** Poids moyen d'un titre selon le format, pour l'estimation d'espace. */
const POIDS_MOYEN_MO = {
  copie: 10,     // Ogg Vorbis 320 kb/s, titre de 4 minutes
  flac: 25,
  aiff: 42,
  mp3_320: 10,
  aac_256: 8,
};

const MORCEAU_EXEMPLE = {
  playlist: 'Été 2026',
  numéro: 7,
  artiste: 'Étienne de Crécy',
  titre: 'Prix Choc',
  album: 'Super Discount',
  artiste_album: 'Étienne de Crécy',
  piste: 3,
  disque: 1,
  année: '1996',
  genre: 'French House',
};

/**
 * Établit le rapport de simulation.
 * Tout ce qui est incertain est présenté comme tel : mieux vaut « on ne peut pas
 * savoir » qu'un chiffre inventé qui décidera à la place de l'utilisateur.
 */
export async function simuler() {
  const c = config();
  const rapport = await diagnostiquer(c);
  const bloquants = rapport.contrôles.filter((x) => x.gravité === GRAVITÉ.BLOQUANT);

  const racineGlobale = c.général.dossierMusique;
  const actives = (c.playlists || []).filter((p) => p.actif);

  const playlists = actives.map((playlist) => {
    const cp = configPourPlaylist(c, playlist);
    const format = trouver(FORMATS, cp.qualité.format);
    const extension = format?.extension ?? 'ogg';

    // Le nom réel d'une playlist n'est connu qu'après la première
    // synchronisation : sans l'API Web de Spotify, on ne l'apprend qu'en voyant
    // le dossier que zotify crée. Afficher un faux nom en attendant ferait
    // croire à un dossier qui n'existera jamais.
    const nomConnu = playlist.nom;
    const exemple = cheminRelatif(
      cp.organisation,
      { ...MORCEAU_EXEMPLE, playlist: nomConnu || '(nom de la playlist)' },
      extension,
    );

    const dossier = path.join(cp.général.dossierMusique, path.dirname(exemple));

    return {
      id: playlist.id,
      nom: nomConnu || `Playlist non encore synchronisée`,
      nomConnu: !!nomConnu,
      url: playlist.url,
      dossier,
      exempleFichier: path.basename(exemple),
      cheminComplet: path.join(cp.général.dossierMusique, exemple),
      format: format?.libellé ?? cp.qualité.format,
      qualité: cp.qualité.niveau,
      modèle: modèleActif(cp.organisation),
      surchargée: Object.keys(playlist.remplacements || {}).length > 0,
      fichiersDéjàPrésents: listerAudio(dossier).length,
    };
  });

  // Ce qui existe déjà, tous dossiers confondus. C'est la seule chose qu'on
  // puisse affirmer sans lancer zotify.
  const inventaire = inventorier(racineGlobale);
  const octetsExistants = [...inventaire.values()].reduce((s, f) => s + f.taille, 0);

  const attente = attenteEffective(c);
  const libre = espaceLibre(racineGlobale);

  // Le poids réel n'est pas celui du seul fichier de destination : quand un
  // format de conversion est choisi, l'Ogg d'origine reste à côté par défaut.
  // Annoncer 25 Mo pour un FLAC alors qu'il en faut 35 conduisait à lancer un
  // rattrapage qui sature le disque à mi-parcours.
  const format = c.qualité.format;
  const poidsMoyen = (POIDS_MOYEN_MO[format] ?? 10)
    + (nécessiteConversion(format) && c.retrait?.sourcesAprèsConversion === 'conserver'
      ? POIDS_MOYEN_MO.copie
      : 0);

  // Le diagnostic refuse de synchroniser en dessous de ce seuil : la simulation
  // doit le prendre en compte, sinon elle annonce « ça tient » pour un cas que
  // l'app refusera ensuite de lancer.
  const réserve = (c.gardes?.espaceMinimumGo ?? 2) * Go;

  return {
    date: new Date().toISOString(),
    prêt: bloquants.length === 0,
    bloquants: bloquants.map((b) => ({ titre: b.titre, message: b.message })),
    avertissements: rapport.contrôles
      .filter((x) => x.gravité === GRAVITÉ.AVERTISSEMENT)
      .map((a) => ({ titre: a.titre, message: a.message })),

    destination: {
      racine: racineGlobale,
      volumeMonté: volumeMonté(racineGlobale),
      espaceLibre: libre,
      espaceLibreLisible: libre === null ? null : `${(libre / Go).toFixed(1)} Go`,
    },

    bibliothèque: {
      nbFichiers: inventaire.size,
      octets: octetsExistants,
      lisible: `${(octetsExistants / Go).toFixed(2)} Go`,
    },

    playlists,

    rythme: {
      attenteSecondes: attente,
      // On ne sait pas combien de titres seront téléchargés. On donne donc des
      // repères plutôt qu'une prévision.
      poidsMoyenMo: poidsMoyen,
      repères: [100, 500, 1000, 2000].map((n) => ({
        titres: n,
        durée: duréeEnFrançais(n * attente * 1000),
        espace: `${((n * poidsMoyen) / 1024).toFixed(1)} Go`,
        tientSurLeDisque: libre === null ? null : n * poidsMoyen * Mo + réserve < libre,
      })),
      noteEspace: nécessiteConversion(format) && c.retrait?.sourcesAprèsConversion === 'conserver'
        ? 'Les tailles comptent le fichier converti ET le fichier d’origine, que ' +
          'Zotijean conserve par défaut pour ne pas avoir à tout retélécharger si ' +
          'vous changez de format.'
        : null,
    },

    // Formulé comme une limite assumée, pas comme une lacune cachée.
    incertitude:
      'Zotijean ne peut pas savoir combien de titres sont nouveaux sans interroger ' +
      'Spotify, ce que seule une vraie synchronisation fait. Les durées ci-dessus ' +
      'sont des repères pour différentes tailles de rattrapage.',
  };
}
