// Tests du planificateur.
//
// C'est le module dont les erreurs sont les plus invisibles : une mauvaise
// décision ne plante pas, elle se traduit par une app qui ne synchronise jamais,
// ou qui synchronise en boucle. D'où l'insistance sur les cas limites.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Chaque exécution de test écrit dans un dossier temporaire isolé, pour ne
// jamais toucher la configuration réelle de l'utilisateur.
process.env.ZOTIJEAN_DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'zotijean-planif-'));

const {
  dansLesHeuresCalmes, prochaineÉchéance, évaluer,
  duréeEnFrançais, formaterÉchéance, reculAprèsÉchecs,
} = await import('../src/planificateur.js');
const étatModule = await import('../src/etat.js');

function configTest(surcharges = {}) {
  return {
    planification: {
      actif: true,
      intervalleHeures: 48,
      heuresCalmes: { actif: false, début: '23:00', fin: '08:00' },
      uniquementSurSecteur: false,
      uniquementEnWifi: false,
      ...surcharges.planification,
    },
    playlists: surcharges.playlists ?? [{ id: 'a', url: 'u', actif: true }],
  };
}

const à = (heure, minute = 0) => new Date(2026, 7, 15, heure, minute);

// ---------------------------------------------------------------------------
// Heures calmes
// ---------------------------------------------------------------------------

test('les heures calmes désactivées n’ont aucun effet', () => {
  const config = configTest();
  assert.equal(dansLesHeuresCalmes(config, à(2)), false);
});

test('une plage d’heures calmes dans la même journée', () => {
  const config = configTest({
    planification: { heuresCalmes: { actif: true, début: '09:00', fin: '18:00' } },
  });
  assert.equal(dansLesHeuresCalmes(config, à(8, 59)), false);
  assert.equal(dansLesHeuresCalmes(config, à(9, 0)), true);
  assert.equal(dansLesHeuresCalmes(config, à(12)), true);
  assert.equal(dansLesHeuresCalmes(config, à(17, 59)), true);
  assert.equal(dansLesHeuresCalmes(config, à(18, 0)), false);
});

test('une plage d’heures calmes qui traverse minuit', () => {
  // Le cas qui casse toute implémentation naïve : avec « début <= t < fin »,
  // 23:00 → 08:00 ne serait JAMAIS vrai, et l'option n'aurait aucun effet.
  const config = configTest({
    planification: { heuresCalmes: { actif: true, début: '23:00', fin: '08:00' } },
  });
  assert.equal(dansLesHeuresCalmes(config, à(23, 30)), true, 'juste après le début');
  assert.equal(dansLesHeuresCalmes(config, à(3)), true, 'au milieu de la nuit');
  assert.equal(dansLesHeuresCalmes(config, à(7, 59)), true, 'juste avant la fin');
  assert.equal(dansLesHeuresCalmes(config, à(8, 0)), false, 'à la fin');
  assert.equal(dansLesHeuresCalmes(config, à(14)), false, 'en pleine journée');
});

test('une plage dont le début égale la fin est ignorée', () => {
  const config = configTest({
    planification: { heuresCalmes: { actif: true, début: '10:00', fin: '10:00' } },
  });
  // Sinon on bloquerait soit zéro minute, soit vingt-quatre heures, selon
  // l'implémentation. Ne rien faire est le comportement sûr.
  assert.equal(dansLesHeuresCalmes(config, à(10)), false);
});

// ---------------------------------------------------------------------------
// Échéance
// ---------------------------------------------------------------------------

test('sans synchronisation précédente, l’échéance est immédiate', () => {
  const échéance = prochaineÉchéance(configTest(), null);
  assert.ok(échéance.getTime() <= Date.now() + 1000);
});

test('l’échéance ajoute l’intervalle au dernier succès', () => {
  const dernier = new Date('2026-08-10T09:00:00Z');
  const échéance = prochaineÉchéance(configTest(), dernier);
  assert.equal(échéance.toISOString(), '2026-08-12T09:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Décision
// ---------------------------------------------------------------------------

test('rien ne se lance si la planification est désactivée', () => {
  const décision = évaluer(configTest({ planification: { actif: false } }));
  assert.equal(décision.lancer, false);
  assert.equal(décision.code, 'desactive');
});

test('rien ne se lance sans playlist active', () => {
  assert.equal(évaluer(configTest({ playlists: [] })).code, 'aucune_playlist');
  assert.equal(
    évaluer(configTest({ playlists: [{ id: 'a', url: 'u', actif: false }] })).code,
    'aucune_playlist',
  );
});

test('rien ne se lance si une synchronisation tourne déjà', () => {
  const décision = évaluer(configTest(), { enCours: true });
  assert.equal(décision.lancer, false);
  assert.equal(décision.code, 'en_cours');
});

test('la première synchronisation part immédiatement', () => {
  const décision = évaluer(configTest());
  assert.equal(décision.lancer, true);
  assert.equal(décision.code, 'pret');
});

test('chaque refus porte une raison lisible en français', () => {
  // Un planificateur qui ne fait rien sans dire pourquoi est indébogable pour
  // quelqu'un qui n'est pas développeur.
  const cas = [
    évaluer(configTest({ planification: { actif: false } })),
    évaluer(configTest({ playlists: [] })),
    évaluer(configTest(), { enCours: true }),
  ];
  for (const décision of cas) {
    assert.ok(décision.raison.length > 10, `raison trop courte : ${décision.raison}`);
    assert.match(décision.raison, /[a-zàâçéèêëîïôûùüÿñæœ]/i);
  }
});

// ---------------------------------------------------------------------------
// Conditions d'alimentation et de réseau
// ---------------------------------------------------------------------------

test('sur batterie, la synchronisation est reportée si l’option l’exige', () => {
  // Branche restée longtemps inatteignable : rien ne fournissait le contexte,
  // donc l'interrupteur « seulement sur secteur » n'avait aucun effet.
  const config = configTest({ planification: { uniquementSurSecteur: true } });
  const décision = évaluer(config, { surSecteur: false });
  assert.equal(décision.lancer, false);
  assert.equal(décision.code, 'batterie');
  assert.match(décision.raison, /secteur/i);
});

test('branché sur secteur, l’option ne bloque rien', () => {
  const config = configTest({ planification: { uniquementSurSecteur: true } });
  assert.equal(évaluer(config, { surSecteur: true }).lancer, true);
});

test('sur réseau facturé, la synchronisation est reportée si l’option l’exige', () => {
  const config = configTest({ planification: { uniquementEnWifi: true } });
  const décision = évaluer(config, { réseauDisponible: false });
  assert.equal(décision.lancer, false);
  assert.equal(décision.code, 'reseau');
  assert.match(décision.raison, /Wi-Fi|Ethernet/i);
});

test('sans les options, ni la batterie ni le réseau ne bloquent', () => {
  // Les conditions sont facultatives : ne pas les cocher doit tout laisser passer.
  const décision = évaluer(configTest(), { surSecteur: false, réseauDisponible: false });
  assert.equal(décision.lancer, true);
});

test('une condition non remplie ne consomme pas l’échéance', () => {
  // Un report doit repartir dès que la condition redevient vraie, pas attendre
  // 48 heures de plus.
  const config = configTest({ planification: { uniquementSurSecteur: true } });
  assert.equal(évaluer(config, { surSecteur: false }).code, 'batterie');
  assert.equal(évaluer(config, { surSecteur: true }).lancer, true);
});

// ---------------------------------------------------------------------------
// Garde anti-recul d'horloge
// ---------------------------------------------------------------------------

test('une date de dernier succès dans le futur est ramenée à maintenant', () => {
  // Cas réel : changement de fuseau, correction d'horloge, ou état copié depuis
  // une autre machine. Sans cette garde, l'app ne synchroniserait plus jamais.
  const futur = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  étatModule.état().dernierSuccès = futur.toISOString();

  const sain = étatModule.dernierSuccèsSain();
  assert.ok(sain.getTime() <= Date.now() + 2000, 'la date future n’a pas été corrigée');
});

test('une date de dernier succès illisible est traitée comme absente', () => {
  étatModule.état().dernierSuccès = 'pas une date';
  assert.equal(étatModule.dernierSuccèsSain(), null);
});

// ---------------------------------------------------------------------------
// Recul après échecs
// ---------------------------------------------------------------------------

test('le recul s’allonge à chaque échec puis plafonne', () => {
  // Sans lui, une exécution ratée — qui n'avance pas la date de référence —
  // serait relancée au battement suivant, soit toutes les cinq minutes,
  // indéfiniment. Face à une panne durable, c'est le meilleur moyen d'aggraver
  // le problème auprès de Spotify.
  assert.equal(reculAprèsÉchecs(0), 0);
  assert.equal(reculAprèsÉchecs(1), 5 * 60 * 1000);
  assert.equal(reculAprèsÉchecs(2), 15 * 60 * 1000);
  assert.equal(reculAprèsÉchecs(3), 60 * 60 * 1000);
  assert.equal(reculAprèsÉchecs(4), 240 * 60 * 1000);
  // Au-delà, on plafonne au lieu de croître sans fin.
  assert.equal(reculAprèsÉchecs(50), 240 * 60 * 1000);
});

test('après un échec, la synchronisation est reportée et le dit', () => {
  const é = étatModule.état();
  é.dernierSuccès = null;
  é.échecsConsécutifs = 2;
  é.dernièreTentative = new Date(Date.now() - 60 * 1000).toISOString(); // il y a 1 min

  const décision = évaluer(configTest());
  assert.equal(décision.lancer, false);
  assert.equal(décision.code, 'recul_apres_echec');
  assert.match(décision.raison, /2 tentatives sans succès/);
});

test('le recul écoulé laisse repartir la synchronisation', () => {
  const é = étatModule.état();
  é.dernierSuccès = null;
  é.échecsConsécutifs = 1;
  é.dernièreTentative = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min

  assert.equal(évaluer(configTest()).lancer, true, 'le recul de 5 min est passé');
});

test('sans échec, aucun recul n’est appliqué', () => {
  const é = étatModule.état();
  é.dernierSuccès = null;
  é.échecsConsécutifs = 0;
  é.dernièreTentative = new Date().toISOString();

  assert.equal(évaluer(configTest()).lancer, true);
});

// ---------------------------------------------------------------------------
// Reprise après interruption
// ---------------------------------------------------------------------------

test('une exécution interrompue laisse une trace exploitable', () => {
  étatModule.ouvrirReprise('planifiée');
  étatModule.noterPlaylistTerminée('a');
  étatModule.noterPlaylistTerminée('b');

  const reprise = étatModule.repriseEnAttente();
  assert.ok(reprise, 'aucune trace de reprise');
  assert.deepEqual(reprise.playlistsTerminées, ['a', 'b']);
});

test('noter deux fois la même playlist ne la duplique pas', () => {
  étatModule.ouvrirReprise('manuelle');
  étatModule.noterPlaylistTerminée('a');
  étatModule.noterPlaylistTerminée('a');
  assert.deepEqual(étatModule.repriseEnAttente().playlistsTerminées, ['a']);
});

test('une exécution menée à terme ne laisse aucune trace', () => {
  étatModule.ouvrirReprise('planifiée');
  étatModule.noterPlaylistTerminée('a');
  étatModule.fermerReprise();
  assert.equal(étatModule.repriseEnAttente(), null);
});

test('une trace trop ancienne est ignorée', () => {
  // Passé un jour, la playlist a pu changer : refaire le travail coûte moins
  // cher que de rater des nouveautés.
  étatModule.ouvrirReprise('planifiée', new Date(Date.now() - 30 * 3600 * 1000));
  étatModule.noterPlaylistTerminée('a');
  assert.equal(étatModule.repriseEnAttente(), null);
});

test('une trace sans playlist terminée ne déclenche pas de reprise', () => {
  // Interrompue avant d'avoir fini quoi que ce soit : il n'y a rien à sauter.
  étatModule.ouvrirReprise('planifiée');
  assert.equal(étatModule.repriseEnAttente(), null);
  étatModule.fermerReprise();
});

test('un succès remet le compteur d’échecs à zéro', () => {
  étatModule.marquerÉchec();
  étatModule.marquerÉchec();
  assert.equal(étatModule.état().échecsConsécutifs, 2);
  étatModule.marquerSuccès();
  assert.equal(étatModule.état().échecsConsécutifs, 0);
});

// ---------------------------------------------------------------------------
// Formulation française
// ---------------------------------------------------------------------------

test('duréeEnFrançais accorde le pluriel', () => {
  assert.equal(duréeEnFrançais(30 * 1000), 'moins d’une minute');
  assert.equal(duréeEnFrançais(60 * 1000), '1 minute');
  assert.equal(duréeEnFrançais(5 * 60 * 1000), '5 minutes');
  assert.equal(duréeEnFrançais(3600 * 1000), '1 heure');
  assert.equal(duréeEnFrançais(3 * 3600 * 1000), '3 heures');
  assert.equal(duréeEnFrançais(24 * 3600 * 1000), '1 jour');
  assert.equal(duréeEnFrançais(3 * 24 * 3600 * 1000), '3 jours');
});

test('formaterÉchéance reste volontairement approximatif', () => {
  // Promettre une heure précise serait mentir : une machine endormie ne se
  // réveille pas pour respecter un rendez-vous.
  const maintenant = new Date(2026, 7, 15, 10, 0);
  assert.match(formaterÉchéance(new Date(2026, 7, 15, 14, 0), maintenant), /aujourd’hui vers 14 h/);
  assert.match(formaterÉchéance(new Date(2026, 7, 16, 9, 0), maintenant), /demain vers 9 h/);
  assert.match(formaterÉchéance(new Date(2026, 7, 18, 9, 0), maintenant), /mardi vers 9 h/);
  assert.match(formaterÉchéance(new Date(2026, 8, 20, 9, 0), maintenant), /le 20\/09\/2026/);
});

test('formaterÉchéance arrondit à la demi-heure', () => {
  const maintenant = new Date(2026, 7, 15, 10, 0);
  assert.match(formaterÉchéance(new Date(2026, 7, 15, 14, 45), maintenant), /14 h 30/);
  assert.match(formaterÉchéance(new Date(2026, 7, 15, 14, 10), maintenant), /14 h(?! 30)/);
});

test.after(() => {
  fs.rmSync(process.env.ZOTIJEAN_DONNEES, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Dates aberrantes : l'horloge n'est pas une source fiable
// ---------------------------------------------------------------------------
//
// CE QUE CES TESTS PROTÈGENT. Le fichier d'état peut contenir une date SITUÉE
// DANS LE FUTUR : l'horloge du Mac a été corrigée, on a changé de fuseau, ou
// l'état a été recopié depuis une autre machine en avance.
//
// La date du dernier succès était déjà protégée. Celle de la dernière tentative
// ne l'était pas, et l'oubli coûtait cher : le recul après échecs compare
// « maintenant » à cette date, la soustraction devient négative, et reste donc
// éternellement inférieure au recul. Le planificateur diffère à chaque
// battement — mesuré à 73 heures de blocage pour une avance de 3 jours.

test('une date de dernière tentative dans le futur ne bloque pas le planificateur', () => {
  étatModule.marquerSuccès(new Date(Date.now() - 100 * 3600 * 1000)); // échéance largement dépassée

  // Trois jours d'avance, et un échec pour activer le recul.
  étatModule.marquerTentative(new Date(Date.now() + 3 * 24 * 3600 * 1000));
  étatModule.marquerÉchec();

  const décision = évaluer(configTest(), {}, new Date());

  assert.notEqual(
    décision.code, 'recul_apres_echec',
    'une date future a mis le planificateur en attente pour des jours',
  );
  assert.equal(décision.lancer, true);
});

test('une date de dernière tentative normale déclenche bien le recul', () => {
  // Le pendant du test précédent : la garde ne doit pas neutraliser le recul
  // quand la date est saine. Sans cette vérification, on pourrait « corriger »
  // le bug en supprimant le recul, ce qui relancerait une synchronisation
  // toutes les cinq minutes face à une panne durable.
  étatModule.marquerSuccès(new Date(Date.now() - 100 * 3600 * 1000));
  étatModule.marquerTentative(new Date());
  étatModule.marquerÉchec();

  const décision = évaluer(configTest(), {}, new Date());
  assert.equal(décision.code, 'recul_apres_echec');
  assert.equal(décision.lancer, false);
});
