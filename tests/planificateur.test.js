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
  duréeEnFrançais, formaterÉchéance,
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
