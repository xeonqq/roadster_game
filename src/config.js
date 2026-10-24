// ── global tuning constants ───────────────────────────────────────────────
export const BLOCK = 64;       // city grid pitch (world units)
export const ROAD = 18;        // asphalt width
export const CURB = 3;         // sidewalk width
export const LANE = ROAD * 0.25;

export const TURBO_MAX = 100;
export const JUMP_COST = 26;
export const BOOST_DRAIN = 27; // per second
export const BOOST_MIN = 6;

export const PLAYER = {
  width: 2.15,
  length: 4.7,
  radius: 2.25,
  maxHealth: 100,
  accel: 50,
  reverseAccel: 22,
  brake: 66,
  drag: 0.08,
  rollDrag: 0.9,
  maxSpeed: 62,
  boostSpeed: 96,
  boostAccel: 70,
  grip: 8.6,
  driftGrip: 2.2,
  handbrakeGrip: 1.2,
  steerRate: 2.25,
  airSteer: 1.6,
  gravity: 25,
  jumpVel: 17,
};

export const WEAPONS = {
  smg: {
    id: 'smg', name: 'VOLT SMG', short: 'SMG', slot: '1',
    ammo: 70, rate: 11, damage: 3.4, speed: 165, spread: 0.055, pellets: 1,
    life: 0.75, color: '#6ffcff', tracer: '#9ffcff', auto: true,
    sound: 'smg', icon: '⌁', desc: 'Rapid-fire arc carbine',
  },
  shotgun: {
    id: 'shotgun', name: 'BREACH-12', short: 'SHOTGUN', slot: '2',
    ammo: 16, rate: 1.7, damage: 5.5, speed: 135, spread: 0.19, pellets: 7,
    life: 0.34, color: '#ffb066', tracer: '#ffd2a0', auto: false,
    sound: 'shotgun', icon: '⁂', desc: 'Close-range flechette burst',
  },
  rocket: {
    id: 'rocket', name: 'HELLFIRE', short: 'ROCKET', slot: '3',
    ammo: 6, rate: 0.85, damage: 46, speed: 88, spread: 0.02, pellets: 1,
    life: 2.4, color: '#ff6347', tracer: '#ffb060', auto: false,
    splash: 17, sound: 'rocket', icon: '➤', desc: 'Guided-ish splash rocket',
  },
  rail: {
    id: 'rail', name: 'ARC RAIL', short: 'RAIL', slot: '4',
    ammo: 8, rate: 0.8, damage: 32, speed: 430, spread: 0.004, pellets: 1,
    life: 0.8, color: '#b98cff', tracer: '#e0ccff', auto: false,
    pierce: 2, sound: 'rail', icon: '≡', desc: 'Piercing hypersonic slug',
  },
  emp: {
    id: 'emp', name: 'EMP-9', short: 'EMP', slot: '5',
    ammo: 4, rate: 1.1, damage: 8, speed: 105, spread: 0.02, pellets: 1,
    life: 1.8, color: '#7dffc0', tracer: '#c2ffe4', auto: false,
    splash: 38, emp: true, sound: 'emp', icon: '◉', desc: 'Stuns every cruiser nearby',
  },
};

export const WEAPON_ORDER = ['smg', 'shotgun', 'rocket', 'rail', 'emp'];

export const COP = {
  interceptor: {
    name: 'SFPD INTERCEPTOR', health: 30, maxSpeed: 46, accel: 30,
    turn: 2.2, fireRate: 1.6, damage: 3.2, range: 92, accuracy: 0.085,
    score: 130, radius: 2.5, color: '#e8eef7',
  },
  heavy: {
    name: 'SFPD RIOT SUV', health: 95, maxSpeed: 40, accel: 24,
    turn: 1.55, fireRate: 2.4, damage: 5.5, range: 80, accuracy: 0.11,
    score: 240, radius: 2.9, color: '#c9d4e6',
  },
  rammer: {
    name: 'SFPD PURSUIT', health: 55, maxSpeed: 52, accel: 34,
    turn: 2.4, fireRate: 3.0, damage: 4, range: 60, accuracy: 0.14,
    score: 180, radius: 2.5, color: '#ffd9df',
  },
  drone: {
    name: 'SURVEILLANCE DRONE', health: 22, maxSpeed: 54, accel: 40,
    turn: 2.8, fireRate: 1.15, damage: 2.4, range: 100, accuracy: 0.08,
    score: 90, radius: 1.6, color: '#aab6c9', flying: true,
  },
};

// ── escape mission // the bay and the boat ───────────────────────────────
export const BAY = {
  edgeX: 768,
  pierEnd: 840,
  pierHalf: 7.5,
  gates: [-128, 0, 128],
  boatX0: 864,
  boatX1: 984,
  boatHalfY: 136,
  deckZ: 1.8,
  finishX: 920,
  finishY: 0,
};

// Four city data cores have to be pulled before the boat unlocks. Their
// positions are deliberately off the straight eastbound corridor so the run
// becomes a tour through the grid rather than a single straight drag race.
export const MISSION = {
  stops: [
    { x: 128, y: 128, label: 'SOMA RELAY' },
    { x: 64, y: 256, label: 'MISSION CACHE' },
    { x: -128, y: -256, label: 'NOB HILL UPLINK' },
    { x: 320, y: -192, label: 'FINANCIAL NODE' },
  ],
};

export const DISTRICTS = [
  'SOMA', 'MISSION BAY', 'FINANCIAL DISTRICT', 'TENDERLOIN', 'NOB HILL',
  'HAYES VALLEY', 'CASTRO', 'MARINA', 'RICHMOND', 'SUNSET', 'CHINATOWN',
  'NORTH BEACH', 'POTRERO HILL', 'JAPANTOWN', 'DOGPATCH', 'PRESIDIO',
];

export const SIGNS = [
  'NEON', 'ZAIBATSU', 'ARASAKA', 'KIROSHI', 'NIGHT CORP', 'SYNAPSE',
  'HOTEL', 'RAMEN', 'DATA', 'CYBER', 'NEXUS', 'OMNI', '未来', '電脳',
  '九龍', 'サイバー', 'BIO', 'ORBITAL', 'NOODLE', 'PAWN', 'SUSHI', '24H',
  'HOLO', 'TETRA', 'DRINK SYNTH', 'MILITECH', '夜色', 'CLINIC',
];

export const POLICE_RADIO = [
  'ALL UNITS — SUSPECT ROADSTER SPOTTED',
  'VEHICLE ISN\'T SLOWING. REPEAT, NOT SLOWING.',
  'DEPLOY ROADBLOCK AT 4TH & MARKET',
  'AIR UNIT, KEEP EYES ON THE RED TESLA',
  'SUSPECT ARMED — WEAPONS FREE',
  'HEAT RISING. REQUESTING RIOT SUPPORT',
  'DRONE SWARM RELEASED',
  'SPIKE STRIPS DEPLOYED',
  'THEY WENT AIRBORNE. HOW DID THEY—',
  'CONTAINMENT FAILING. ALL UNITS RESPOND',
];

export const GAME_TITLE = 'NEON OVERDRIVE';
export const GAME_SUBTITLE = 'SAN FRANCISCO // 2088';
