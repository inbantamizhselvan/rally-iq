/* RALLY IQ — opponents (fictional) and the strategy lesson each one teaches. */
(function (root) {
  'use strict';
  const base = { shots: ['topspin', 'heavy', 'slice', 'flat', 'drop', 'lob'], aggr: 1, care: 1.1, temp: 0.12, net: 0.1, flatServe: 0.5, weak: null, pref: {}, deep: false };
  const S = (o) => Object.assign({}, base, o);
  const ROSTER = [
    { id: 'sam', name: 'Sam Steady', tag: 'Consistent rallier', color: '#5AA9FF', speed: 5.2, power: 0.95, skill: { FH: 1.1, BH: 1.1, VOL: 1.2, SRV: 1.1 },
      style: S({ shots: ['topspin', 'heavy', 'slice'], aggr: 0.7, care: 1.6, temp: 0.15 }),
      lesson: 'Crosscourt is king',
      scout: 'Never misses... if you give him time. Average pace, average speed.',
      tips: ['Rally CROSSCOURT and DEEP. The net is 15 cm lower in the middle and the diagonal is about 1.4 m longer, so you get more room for error.', 'Change direction only when you get a short ball.'] },
    { id: 'bella', name: 'Bella Backhand', tag: 'Big forehand, weak backhand', color: '#FF7AB6', speed: 5.4, power: 1.0, skill: { FH: 0.9, BH: 1.75, VOL: 1.1, SRV: 1.0 },
      style: S({ aggr: 1.1, weak: 'BH' }),
      lesson: 'Find the weakness',
      scout: 'Dangerous forehand. Her backhand breaks down under pressure.',
      tips: ['Test both sides early, then go to the weakness on big points.', 'Serve to her backhand. Rally to her backhand. Only go to her forehand to open the court.'] },
    { id: 'pat', name: 'Pat the Pusher', tag: 'Retriever: gets everything back', color: '#7CE0C3', speed: 6.1, power: 0.85, skill: { FH: 0.95, BH: 0.95, VOL: 1.3, SRV: 1.15 },
      style: S({ shots: ['heavy', 'slice', 'lob', 'topspin'], aggr: 0.55, care: 2.0, temp: 0.14, pref: { heavy: 0.15 }, deep: true, flatServe: 0.2 }),
      lesson: 'Patience, then attack',
      scout: 'Super fast and never misses, but gives you lots of short, slow balls.',
      tips: ['Don\'t go for winners from the back. That\'s what he wants.', 'Wait for the SHORT ball, attack it, and come to the net. He stays far back, so drop shots work too.'] },
    { id: 'rory', name: 'Rocket Rory', tag: 'Big hitter', color: '#FF8A4C', speed: 5.4, power: 1.08, skill: { FH: 1.05, BH: 1.15, VOL: 1.2, SRV: 0.95 },
      style: S({ shots: ['flat', 'topspin', 'drop'], aggr: 1.7, care: 0.55, temp: 0.1, flatServe: 0.85, pref: { flat: 0.12 } }),
      lesson: 'Absorb pace, stay deep',
      scout: 'Hits very hard and goes for the lines. Makes lots of errors.',
      tips: ['Don\'t try to out-hit him. Keep the ball DEEP and in play and let him miss.', 'When you\'re stretched, defend crosscourt with height or slice. Make him create pace from a low or high ball.'] },
    { id: 'lars', name: 'Lefty Lars', tag: 'Left-hander', color: '#C08BFF', hand: -1, speed: 5.5, power: 1.0, skill: { FH: 0.9, BH: 1.35, VOL: 1.0, SRV: 0.95 },
      style: S({ aggr: 1.1, weak: 'BH' }),
      lesson: 'Lefty patterns',
      scout: 'Left-handed. Strong forehand. His backhand is on the OTHER side compared with most players.',
      tips: ['His backhand is on YOUR forehand-crosscourt side. Rally forehand crosscourt into his backhand.', 'His crosscourt forehand comes to your backhand, so be ready for it.'] },
    { id: 'nina', name: 'Nina Net', tag: 'Serve-and-volley, net rusher', color: '#FFD35A', speed: 5.6, power: 1.0, skill: { FH: 1.0, BH: 1.05, VOL: 0.75, SRV: 0.95 },
      style: S({ shots: ['topspin', 'slice', 'flat'], aggr: 1.2, net: 0.75 }),
      lesson: 'Passing shots & lobs',
      scout: 'Rushes the net at every chance. Great volleys.',
      tips: ['When she\'s at the net: pass LOW and wide, hit at her feet, or LOB deep.', 'Don\'t give her a high, slow ball. That\'s an easy volley.'] },
    { id: 'mo', name: 'Moonball Mo', tag: 'High loopy balls from deep', color: '#9BE15D', speed: 5.6, power: 0.9, skill: { FH: 1.0, BH: 1.0, VOL: 1.4, SRV: 1.1 },
      style: S({ shots: ['heavy', 'lob', 'slice'], aggr: 0.75, care: 1.6, pref: { heavy: 0.3, lob: 0.1 }, deep: true, flatServe: 0.2 }),
      lesson: 'Take time away',
      scout: 'Stands far behind the baseline and hits high moonballs.',
      tips: ['Step INTO the court and attack the short ones. Come to the net and volley.', 'He stands very deep, so drop shots are deadly.'] },
    { id: 'kai', name: 'Champion Kai', tag: 'All-court champion', color: '#FF5C72', speed: 5.9, power: 1.03, skill: { FH: 0.85, BH: 0.9, VOL: 0.9, SRV: 0.9 },
      style: S({ aggr: 1.15, care: 1.25, net: 0.3, temp: 0.08 }),
      lesson: 'Put it all together',
      scout: 'No big weakness. Smart, fast and consistent.',
      tips: ['Play high-percentage tennis: crosscourt, deep, margin over the net.', 'Win the big points with your best patterns. Attack short balls, defend crosscourt.'] },
  ];
  const api = { ROSTER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Roster = api;
})(typeof self !== 'undefined' ? self : this);
