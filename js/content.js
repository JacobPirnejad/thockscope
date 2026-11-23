/*
 * ThockScope — content.js
 * Every word the app shows. Written for curious 12–14 year olds:
 * short sentences, one idea at a time, no math required.
 *
 * Exposes: window.ThockContent
 */
(function (global) {
  'use strict';

  /** Short "How it works" lessons, in reading order. `visual` hints which panel each one explains. */
  const lessons = [
    {
      id: 'sound',
      title: 'Sound is a wiggle',
      visual: 'waveform',
      short: 'Every sound is air wiggling back and forth, super fast.',
      body: 'When a key hits bottom, it shoves the air. That push spreads out like a ripple in a pond and wiggles your eardrum. The WAVE panel draws those wiggles: up is air squished together, down is air spread apart.',
    },
    {
      id: 'frequency',
      title: 'Fast wiggle = high pitch',
      visual: 'waveform',
      short: 'How fast the air wiggles is the pitch. We measure it in Hertz (Hz).',
      body: '1 Hz means one wiggle per second. A deep drum wiggles about 100 times a second (100 Hz). A whistle wiggles thousands of times (3000 Hz or more). Humans hear from about 20 Hz up to about 20,000 Hz.',
    },
    {
      id: 'mixed',
      title: 'Real sounds are a mix',
      visual: 'demo',
      short: 'A key press is lots of pitches playing at the same time.',
      body: 'A keystroke is not one clean pitch. It is a low thump from the case, a middle "body" sound, and a sharp high click from the plastic, all at once. Mixed together, the wave looks messy.',
    },
    {
      id: 'fourier',
      title: 'The smoothie trick (Fourier transform)',
      visual: 'demo',
      short: 'The Fourier transform un-blends a sound back into its ingredients.',
      body: 'Imagine a smoothie made of strawberries, bananas and blueberries. The Fourier transform is like a magic machine that takes the smoothie and tells you exactly how much of each fruit went in. For sound, the "fruits" are pitches. The computer tests the sound against every pitch and asks "how much of YOU is in here?" The FFT (Fast Fourier Transform) is just a really quick way to do that — your computer does it about 60 times every second.',
    },
    {
      id: 'spectrum',
      title: 'Reading the spectrum',
      visual: 'spectrum',
      short: 'Left = low pitches, right = high pitches. Taller bar = louder.',
      body: 'The SPECTRUM is the answer from the smoothie machine. Each bar is one range of pitches. Bars on the left are deep sounds (THOCK zone). Bars on the right are sharp sounds (CLACK zone). The smooth line on top is the frequency curve: the overall "shape" of the sound, like a fingerprint.',
    },
    {
      id: 'spectrogram',
      title: 'The spectrogram: sound over time',
      visual: 'spectrogram',
      short: 'It stacks spectrums side by side, like a flip-book of sound.',
      body: 'Each thin slice is one spectrum, turned sideways. Time moves left to right, pitch goes bottom (low) to top (high), and brighter color means louder. Every key press shows up as a bright stripe. A stripe that keeps going after the key press is a ring or echo.',
    },
    {
      id: 'profile',
      title: 'Thock vs Clack',
      visual: 'profile',
      short: 'Thock = mostly low pitches. Clack = mostly high pitches.',
      body: 'ThockScope finds the "balance point" of each key press (called the centroid, or brightness). If the balance point is low, the board sounds deep and thocky. If it is high, it sounds bright and clacky. Neither is better — it is about what YOU like.',
    },
    {
      id: 'fair-test',
      title: 'Make it a fair test',
      visual: 'none',
      short: 'Change one thing at a time and record the same way each time.',
      body: 'Different mics hear differently, so scores are best for comparing. Record before and after a mod with the same mic, the same spot, and the same typing. If you change two things at once, you won\'t know which one made the difference.',
    },
  ];

  /** Sound profile descriptions (ids match ThockEngine.PROFILES). */
  const profiles = {
    'deep-thock': { name: 'Deep Thock', soundsLike: 'a soft wooden "thud", like tapping a closed book', text: 'Almost all the sound is low. Very muted and deep.' },
    'thock':      { name: 'Thock',      soundsLike: 'a rounded "thok", like a marble dropped on wood', text: 'Mostly low with a little bit of click on top.' },
    'creamy':     { name: 'Creamy',     soundsLike: 'a smooth, soft "tock" with no harsh edges', text: 'Balanced: some low, some middle, not much harsh high end.' },
    'clack':      { name: 'Clack',      soundsLike: 'a crisp "clack", like plastic tapping plastic', text: 'Lots of middle and high sound. Snappy and lively.' },
    'sharp-clack':{ name: 'Sharp Clack',soundsLike: 'a bright "tick!", like a pen clicking', text: 'Mostly high, sharp sound. Very bright and loud-feeling.' },
  };

  /** The parts of a keyboard and what each does to the sound. */
  const parts = [
    {
      id: 'keycaps', name: 'Keycaps',
      what: 'The plastic caps your fingers touch.',
      sound: 'Thicker caps = deeper sound. Thin caps = higher, clackier. PBT plastic usually sounds a bit deeper and drier than ABS. Tall caps (like SA profile) sound deeper and louder than short ones.',
      tip: 'Keycaps are the easiest big sound change — no tools needed.',
    },
    {
      id: 'switches', name: 'Switches',
      what: 'The little spring mechanism under each key.',
      sound: 'Linear = smooth, no bump. Tactile = a small bump. Clicky = a built-in "click" (very bright). The housing plastic and the stem shape change the pitch of the bottom-out.',
      tip: 'Clicky switches will always score "clacky" — that click is the point!',
    },
    {
      id: 'lube', name: 'Lube & films',
      what: 'Special grease on the switch parts, and thin films between the switch halves.',
      sound: 'Lube makes switches smoother and deeper, and removes scratchy noise. Films stop wobble so the sound is tighter.',
      tip: 'A little goes a long way. Too much lube makes switches feel mushy.',
    },
    {
      id: 'springs', name: 'Springs',
      what: 'The metal spring inside each switch.',
      sound: 'Dry springs can "ping" — a tiny metallic ring after each press. Shows up as a thin line that lingers on the spectrogram.',
      tip: 'Bag-lubing springs (shake them in a bag with a drop of oil) fixes most ping.',
    },
    {
      id: 'stabilizers', name: 'Stabilizers',
      what: 'The wire parts under long keys: spacebar, Shift, Enter, Backspace.',
      sound: 'Badly tuned stabs rattle — a buzzy, jangly sound that is louder than the other keys.',
      tip: 'Clipping, lubing the wire ends, and the "band-aid mod" fix rattle.',
    },
    {
      id: 'plate', name: 'Plate',
      what: 'The sheet the switches snap into.',
      sound: 'Metal plates (aluminum, brass, steel) sound brighter and higher. Softer plates (polycarbonate, POM, FR4) sound deeper and more muted.',
      tip: 'Polycarbonate (PC) is a popular "thock" plate.',
    },
    {
      id: 'pcb', name: 'PCB',
      what: 'The circuit board that reads your key presses.',
      sound: 'The empty space under the PCB can echo. Tape or foam under it changes that.',
      tip: 'The "tape mod" (painter\'s tape on the back of the PCB) is cheap and makes things deeper and poppier.',
    },
    {
      id: 'case', name: 'Case',
      what: 'The outer shell.',
      sound: 'Empty space inside a case acts like a drum — it can sound hollow. Heavy cases (aluminum) sound solid; light plastic cases can sound hollow or rattly.',
      tip: 'Filling the empty space with foam is the #1 fix for hollowness.',
    },
    {
      id: 'foam', name: 'Foams',
      what: 'Foam layers: in the case, between plate and PCB, or under switches (PE foam).',
      sound: 'Case foam removes echo. Plate foam removes high ping. A thin PE foam sheet under the switches makes a "poppy", marbly sound.',
      tip: 'Add one foam at a time and record each step.',
    },
    {
      id: 'mount', name: 'Mounting style',
      what: 'How the plate is held inside the case: tray, top, gasket, and more.',
      sound: 'Gasket mounts float on soft pads — softer, deeper, more even. Tray mounts screw straight down — harsher and can sound different across the board.',
      tip: 'You usually choose this when buying a board, not change it later.',
    },
    {
      id: 'desk', name: 'Desk & mat',
      what: 'What the keyboard sits on.',
      sound: 'A hard desk adds its own echo. A desk mat soaks that up and makes everything a little deeper and quieter.',
      tip: 'Free test: record on the bare desk, then on a folded towel.',
    },
  ];

  /**
   * Sound recipes: "I want X → do this".
   * steps: { part, do, why }  part = id from `parts`
   * cost: 1 = free/cheap, 2 = some money, 3 = expensive
   * effort: 1 = 5 minutes, 2 = an afternoon, 3 = big project (open every switch)
   */
  const recipes = [
    {
      id: 'deeper-thock', goal: 'Deeper thock', want: 'I want my keyboard to sound deeper and more "thocky".',
      graph: 'Bars on the left (THOCK zone) get taller, bars on the right get shorter. Your score goes up.',
      cost: 2, effort: 2, tags: ['thock', 'deeper'],
      steps: [
        { part: 'keycaps', do: 'Switch to thick PBT keycaps (taller profiles go even deeper).', why: 'Thick plastic vibrates slower, so lower pitches.' },
        { part: 'pcb', do: 'Do the tape mod: 2–3 layers of painter\'s tape on the back of the PCB.', why: 'Cuts high-pitched echo under the board.' },
        { part: 'foam', do: 'Add case foam to fill the empty space.', why: 'Stops the case from acting like a drum.' },
        { part: 'plate', do: 'Try a polycarbonate (PC) or POM plate.', why: 'Soft plates soak up high frequencies.' },
        { part: 'lube', do: 'Lube your switches with a thick lube.', why: 'Smooths out scratchy high sounds.' },
        { part: 'desk', do: 'Put a desk mat under the keyboard.', why: 'Removes desk echo.' },
      ],
    },
    {
      id: 'crisp-clack', goal: 'Crisp clack', want: 'I want a bright, snappy, clacky sound.',
      graph: 'More energy in the right side (CLACK zone). Score goes down.',
      cost: 2, effort: 2, tags: ['clack', 'brighter'],
      steps: [
        { part: 'keycaps', do: 'Use thinner ABS keycaps, or a low/short profile.', why: 'Thin plastic rings at higher pitches.' },
        { part: 'switches', do: 'Pick switches with a long-pole stem or a hard housing (e.g. nylon/PC mix).', why: 'Hard parts hitting each other = sharp sound.' },
        { part: 'plate', do: 'Use an aluminum or brass plate.', why: 'Stiff metal reflects high frequencies.' },
        { part: 'lube', do: 'Use little or no lube on the bottom housing.', why: 'Lube softens the clack.' },
      ],
    },
    {
      id: 'creamy', goal: 'Creamy & smooth', want: 'I want a smooth, soft sound with no harsh edges.',
      graph: 'A gentle hill-shaped curve with no sharp spikes. Score in the middle (45–62).',
      cost: 2, effort: 3, tags: ['creamy', 'smooth'],
      steps: [
        { part: 'switches', do: 'Use linear switches with a POM or UHMWPE stem.', why: 'These plastics are naturally smooth and quiet.' },
        { part: 'lube', do: 'Lube switches carefully and add films.', why: 'Removes scratch and wobble — the "harsh edges".' },
        { part: 'stabilizers', do: 'Tune your stabilizers.', why: 'Rattle is the opposite of creamy.' },
        { part: 'foam', do: 'Add plate foam and case foam.', why: 'Rounds off spikes in the spectrum.' },
      ],
    },
    {
      id: 'marbly-poppy', goal: 'Marbly / poppy', want: 'I want a "poppy" sound, like marbles clicking together.',
      graph: 'A strong bump in the Mid (Body) zone and a short decay (sound stops quickly).',
      cost: 1, effort: 1, tags: ['poppy', 'marbly'],
      steps: [
        { part: 'foam', do: 'Put a thin PE foam sheet between the PCB and the switches.', why: 'Famous for the "marbly" pop.' },
        { part: 'pcb', do: 'Add the tape mod too.', why: 'Tape + PE foam stack well together.' },
        { part: 'keycaps', do: 'Try thick PBT or SA-profile caps.', why: 'Adds a rounder note to the pop.' },
      ],
    },
    {
      id: 'quieter', goal: 'Quieter (class, library, late night)', want: 'I want my keyboard to be quieter so I don\'t bother anyone.',
      graph: 'Lower loudness (peak dB) on every key press, and fewer bars in the CLACK zone.',
      cost: 2, effort: 2, tags: ['quiet'],
      steps: [
        { part: 'switches', do: 'Use "silent" switches (they have rubber pads inside).', why: 'Pads cushion the bottom-out and the top-out.' },
        { part: 'keycaps', do: 'Add O-rings under the keycaps.', why: 'Stops the cap from slamming down (they change the feel a little).' },
        { part: 'foam', do: 'Fill the case with foam.', why: 'Less echo = less volume.' },
        { part: 'desk', do: 'Use a thick desk mat.', why: 'Stops the desk from amplifying the sound.' },
        { part: 'switches', do: 'Type a bit lighter — don\'t slam the keys to the bottom.', why: 'Free and it works!' },
      ],
    },
    {
      id: 'fix-ping', goal: 'Fix spring ping', want: 'I hear a tiny metal "ting" after each key press.',
      graph: 'ThockScope shows "ringy". On the spectrogram you see a thin line that keeps going after each hit.',
      cost: 1, effort: 2, tags: ['fix', 'ping'],
      steps: [
        { part: 'springs', do: 'Bag-lube the springs: put springs in a small bag with 1–2 drops of thin oil and shake.', why: 'A thin coat of oil stops the metal from ringing.' },
        { part: 'foam', do: 'Add plate foam.', why: 'Soaks up ringing from the plate.' },
        { part: 'case', do: 'Check for loose screws or a ringing case (tap it gently).', why: 'Sometimes the case pings, not the switch.' },
      ],
    },
    {
      id: 'fix-rattle', goal: 'Fix rattly spacebar / big keys', want: 'My spacebar (or Shift/Enter) sounds rattly or jangly.',
      graph: 'Long keys score much brighter and louder than the others. Consistency score drops.',
      cost: 1, effort: 2, tags: ['fix', 'rattle', 'stabilizers'],
      steps: [
        { part: 'stabilizers', do: 'Put a little thick lube (dielectric grease) on the ends of the stabilizer wire.', why: 'The wire tapping plastic is the rattle.' },
        { part: 'stabilizers', do: 'Do the band-aid mod: a small piece of band-aid under where the stabilizer stems land.', why: 'Cushions the hard landing.' },
        { part: 'stabilizers', do: 'Clip the little legs on the stabilizer stems (if your stabs have them).', why: 'Makes the bottom-out quieter and softer.' },
      ],
    },
    {
      id: 'fix-hollow', goal: 'Fix hollow / echo sound', want: 'My keyboard sounds empty, like typing on a cardboard box.',
      graph: 'Long decay time (sound lasts a long time). ThockScope shows "hollow".',
      cost: 1, effort: 1, tags: ['fix', 'hollow'],
      steps: [
        { part: 'foam', do: 'Fill the empty space in the case with foam (even cut-up packing foam works to test).', why: 'Empty space echoes like a drum.' },
        { part: 'pcb', do: 'Tape mod the back of the PCB.', why: 'Blocks echo from under the board.' },
        { part: 'case', do: 'Tighten every case screw.', why: 'Loose parts buzz and echo.' },
        { part: 'desk', do: 'Add a desk mat.', why: 'Less bounce from the desk.' },
      ],
    },
    {
      id: 'consistent', goal: 'Every key sounds the same', want: 'Some keys sound different from others.',
      graph: 'The consistency score goes up. Hit-by-hit scores stay close together.',
      cost: 1, effort: 3, tags: ['fix', 'consistent'],
      steps: [
        { part: 'stabilizers', do: 'Tune the stabilizers first — big keys are the usual odd ones out.', why: 'They have the most moving parts.' },
        { part: 'mount', do: 'Check the plate sits evenly; gasket-mounted boards are more even.', why: 'Keys near screws can sound harsher.' },
        { part: 'lube', do: 'Lube all switches the same amount.', why: 'Uneven lube = uneven sound.' },
        { part: 'foam', do: 'Use foam that covers the whole case, not just part of it.', why: 'Echo changes from one spot to another otherwise.' },
      ],
    },
    {
      id: 'less-scratch', goal: 'Less scratchy noise', want: 'My switches sound scratchy or gritty when I press them.',
      graph: 'Extra fuzzy energy in the CLACK zone between key presses.',
      cost: 1, effort: 3, tags: ['fix', 'smooth'],
      steps: [
        { part: 'lube', do: 'Open the switches and lube the stem rails and bottom housing.', why: 'Plastic rubbing plastic causes scratch.' },
        { part: 'switches', do: 'Or try factory-lubed or "smooth" switches.', why: 'No tools needed.' },
      ],
    },
    {
      id: 'budget-thock', goal: 'Budget thock (cheap mods)', want: 'I want a better sound but I don\'t have much money.',
      graph: 'Try one step at a time and record after each — watch your score climb.',
      cost: 1, effort: 1, tags: ['thock', 'budget'],
      steps: [
        { part: 'desk', do: 'Free: put a folded towel or mouse pad under the keyboard.', why: 'Instant test of how much the desk adds.' },
        { part: 'pcb', do: 'Tape mod with painter\'s tape (around $3).', why: 'One of the biggest changes for the price.' },
        { part: 'foam', do: 'Cut packing foam or shelf liner to fill the case.', why: 'Free or nearly free.' },
        { part: 'springs', do: 'Bag-lube springs if you hear ping.', why: 'Tiny cost, big fix.' },
      ],
    },
    {
      id: 'streaming', goal: 'Sounds good on stream / video', want: 'I want my keyboard to sound nice on recordings, not annoying.',
      graph: 'Avoid tall spikes and a big CLACK zone — those cut through voices.',
      cost: 2, effort: 2, tags: ['quiet', 'creamy'],
      steps: [
        { part: 'switches', do: 'Use linear or silent switches.', why: 'Clicky switches are very loud on mics.' },
        { part: 'foam', do: 'Add case foam and plate foam.', why: 'Removes echo the mic picks up.' },
        { part: 'stabilizers', do: 'Tune your spacebar.', why: 'The spacebar is the loudest key on most recordings.' },
        { part: 'desk', do: 'Point your mic away from the keyboard.', why: 'Distance helps more than any mod.' },
      ],
    },
    {
      id: 'clicky-fun', goal: 'Loud and clicky', want: 'I like loud, clicky typing!',
      graph: 'Very bright: a big CLACK zone and a low score. That\'s the goal here.',
      cost: 2, effort: 1, tags: ['clack', 'loud'],
      steps: [
        { part: 'switches', do: 'Use clicky switches (click-bar or click-jacket types).', why: 'They make a click on purpose.' },
        { part: 'plate', do: 'Use a metal plate.', why: 'Makes the click ring out more.' },
        { part: 'foam', do: 'Skip the foam.', why: 'Foam would soften the click.' },
      ],
    },
  ];

  /** What a report's diagnosis ids mean, and what to try. */
  const diagnosis = {
    'too-few-hits': { kind: 'info', title: 'Type a bit more', text: 'Type at least 10–20 keys (try a sentence) so the results are reliable.', recipes: [] },
    'clipping':     { kind: 'warn', title: 'Too loud for the mic', text: 'The mic got overloaded, so some sound got chopped off. Move the mic a little farther away.', recipes: [] },
    'too-quiet':    { kind: 'warn', title: 'Very quiet', text: 'Your key presses are very quiet. Move the mic closer (about 30 cm / 1 foot) and type normally.', recipes: [] },
    'very-bright':  { kind: 'tip',  title: 'Very bright', text: 'Most of your sound is in the CLACK zone. Love it? Great! Want deeper?', recipes: ['deeper-thock', 'budget-thock', 'quieter'] },
    'bright':       { kind: 'tip',  title: 'On the clacky side', text: 'More high sound than low. A few mods can round it off.', recipes: ['deeper-thock', 'creamy', 'marbly-poppy'] },
    'balanced':     { kind: 'tip',  title: 'Nicely balanced', text: 'Your sound sits in the middle — not too deep, not too bright.', recipes: ['creamy', 'deeper-thock', 'crisp-clack'] },
    'deep':         { kind: 'tip',  title: 'Deep and thocky', text: 'Most of your sound is in the THOCK zone. Want even more, or something crisper?', recipes: ['marbly-poppy', 'crisp-clack'] },
    'ringy':        { kind: 'warn', title: 'Ringing detected', text: 'Something keeps ringing after the key press — often a spring "ping".', recipes: ['fix-ping'] },
    'hollow':       { kind: 'warn', title: 'Sounds hollow', text: 'The sound lasts a long time after each press, like an echo in an empty box.', recipes: ['fix-hollow'] },
    'inconsistent': { kind: 'warn', title: 'Keys sound different', text: 'Some keys sound quite different from others (often the spacebar or big keys).', recipes: ['fix-rattle', 'consistent'] },
  };

  const recordingTips = [
    'Put the mic (or phone/laptop) about 30 cm (1 foot) from the keyboard.',
    'Turn off fans, music and TV — quiet room = cleaner graph.',
    'Type a normal sentence. Then try just the spacebar 10 times.',
    'To compare two boards or a mod, keep the mic in the SAME spot.',
    'Headphones on (or speakers off) so the app doesn\'t hear itself.',
  ];

  const glossary = [
    { term: 'Hertz (Hz)', def: 'Wiggles per second. Higher Hz = higher pitch.' },
    { term: 'Frequency', def: 'Another word for pitch: how fast the sound wiggles.' },
    { term: 'Spectrum', def: 'A chart showing how loud each pitch is.' },
    { term: 'Fourier transform', def: 'The math that splits a sound into its pitches (the smoothie un-blender).' },
    { term: 'FFT', def: 'Fast Fourier Transform — a speedy recipe for doing the Fourier transform on a computer.' },
    { term: 'Spectrogram', def: 'Many spectrums in a row, showing how sound changes over time.' },
    { term: 'Decibel (dB)', def: 'A way to measure loudness. +6 dB is about twice as strong.' },
    { term: 'Thock', def: 'A deep, muted keyboard sound.' },
    { term: 'Clack', def: 'A bright, sharp keyboard sound.' },
    { term: 'Brightness (centroid)', def: 'The "balance point" of a sound\'s pitches. Low = deep, high = bright.' },
    { term: 'Decay', def: 'How long a sound takes to fade away.' },
    { term: 'Ping', def: 'A tiny metal ring, usually from a switch spring.' },
  ];

  /** Short labels used around the visualisers. */
  const ui = {
    tagline: 'See what your keyboard sounds like.',
    waveform: 'WAVE — the sound as wiggles',
    spectrum: 'SPECTRUM — which pitches are inside',
    spectrogram: 'SPECTROGRAM — pitches over time',
    profile: 'SOUND PROFILE',
    demo: 'TRY IT: the smoothie machine',
    meterLeft: 'CLACK',
    meterRight: 'THOCK',
    micHint: 'Press Start Mic, then type on your keyboard!',
  };

  global.ThockContent = { lessons, profiles, parts, recipes, diagnosis, recordingTips, glossary, ui };
})(typeof window !== 'undefined' ? window : globalThis);
