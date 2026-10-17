// Game configuration — all the numbers live here so they're easy to tweak.

export const FIELD_RADIUS = 40;   // zombies spawn on this ring
export const PLAY_BOUND = 36;     // player movement / turret placement bound
export const BASE_HP = 500;
export const PLAYER_HP = 100;
export const START_MONEY = 120;

export const DESERT_START_WAVE = 20;   // the world turns to desert here
export const BOSS_EVERY = 5;           // sand worm boss on wave 20, 25, 30...

export const ZOMBIE_ORDER = [
  'normal', 'buff', 'fast', 'stone', 'fire', 'soccer',
  'sword', 'axe', 'baseball', 'hockey', 'hacker', 'acid', 'dust',
];

export const ZOMBIES = {
  normal: {
    name: 'Normal Zombie', emoji: '🧟',
    hp: 30, speed: 2.2, damage: 8, attackRate: 1.0, reward: 3,
    desc: 'Attacks turrets.',
  },
  buff: {
    name: 'Buff Zombie', emoji: '💪',
    hp: 75, speed: 1.8, damage: 26, attackRate: 0.8, reward: 6,
    desc: 'Does bigger damage.',
  },
  fast: {
    name: 'Fast Zombie', emoji: '💨',
    hp: 22, speed: 4.4, damage: 6, attackRate: 1.2, reward: 4,
    desc: 'Moves quickly.',
  },
  stone: {
    name: 'Stone Headed Zombie', emoji: '🗿',
    hp: 130, speed: 1.5, damage: 42, attackRate: 0.45, reward: 8,
    desc: 'Has a LOT of HP. Headbutts turrets doing big attacks.',
  },
  fire: {
    name: 'Fire Zombie', emoji: '🔥',
    hp: 35, speed: 2.2, damage: 5, attackRate: 1.0, reward: 6,
    desc: 'Lights turrets on fire!',
    burnDps: 6, burnTime: 5,
  },
  soccer: {
    name: 'Soccer Zombie', emoji: '⚽',
    hp: 45, speed: 2.4, damage: 8, attackRate: 1.0, reward: 7,
    desc: 'Targets your most powerful turret and kicks a soccer ball at it, stunning it for 10 seconds!',
    kickCooldown: 20, kickRange: 16, stunTime: 10,
  },
  sword: {
    name: 'Sword Zombie', emoji: '⚔️',
    hp: 55, speed: 2.2, damage: 18, attackRate: 0.9, reward: 7,
    desc: 'Slashes 2 turrets at a time doing bigger damage.',
    cleaveRange: 3.5,
  },
  axe: {
    name: 'Axe Zombie', emoji: '🪓',
    hp: 65, speed: 2.0, damage: 21, attackRate: 2.0, reward: 9,
    desc: 'Spins and attacks turrets doing GIGANTIC attacks really fast!',
  },
  baseball: {
    name: 'Baseball Zombie', emoji: '⚾',
    hp: 45, speed: 2.1, damage: 10, attackRate: 0.5, reward: 8,
    desc: 'Blocks 5 attacks with its bat and throws baseballs at turrets.',
    blocks: 5, throwRange: 9,
  },
  hockey: {
    name: 'Hockey Zombie', emoji: '🏒',
    hp: 210, speed: 1.8, damage: 12, attackRate: 0.9, reward: 10,
    desc: 'Has high HP and blocks 7 attacks.',
    blocks: 7,
  },
  hacker: {
    name: 'Hacker Zombie', emoji: '💻',
    hp: 45, speed: 2.0, damage: 5, attackRate: 1.0, reward: 10,
    desc: 'Hacks turrets — hacked turrets shoot OTHER turrets!',
    hackCooldown: 15, hackRange: 9, hackTime: 8,
  },
  acid: {
    name: 'Acid Zombie', emoji: '🧪',
    hp: 60, speed: 2.1, damage: 5, attackRate: 1.0, reward: 11,
    desc: 'Its acid attacks keep burning turrets with continuous damage!',
    acidDps: 8, acidTime: 6,
  },
  dust: {
    name: 'Dust Zombie', emoji: '🌪️',
    hp: 55, speed: 2.3, damage: 6, attackRate: 1.0, reward: 12,
    desc: 'Spawns 3 small sandstorms that wreck turrets for 3 seconds!',
    stormCooldown: 16, stormCount: 3, stormTime: 3, stormDps: 14, stormRange: 18,
  },
};

// The desert boss — an infected sand worm with sharp teeth. SUPER big.
export const BOSS = {
  name: 'Infected Sand Worm', emoji: '🪱',
  hp: 2200, speed: 1.3,
  biteDamage: 45, biteRate: 0.7, biteReach: 4.6,
  slashDamage: 20, slashRange: 4.4, slashCooldown: 2.5,
  stormCooldown: 24, stormTime: 8, stormDps: 12, stormRadius: 5,   // 1 GIANT sandstorm
  quakeCooldown: 30, quakeTurretDamage: 15, quakePlayerDamage: 10, // earthquake!
  summonCooldown: 26, summonCount: 5,                              // 5 dust zombies at a time
  reward: { money: 300, diamonds: 5, emeralds: 5 },
};

// Wave when each zombie type first appears.
export const ZOMBIE_UNLOCK_WAVE = {
  normal: 1, fast: 2, buff: 3, stone: 4, soccer: 5, fire: 6,
  sword: 7, baseball: 8, axe: 9, hockey: 10, hacker: 11,
  acid: 13,
  dust: DESERT_START_WAVE,
};

export const TURRET_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'dust', 'acid'];

export const TURRETS = {
  common: {
    name: 'Common Turret', emoji: '⚪', rarityColor: 0xb0b0b0,
    cost: { money: 50 }, damage: 6, range: 10, fireRate: 1.2, hp: 100,
  },
  uncommon: {
    name: 'Uncommon Turret', emoji: '🟢', rarityColor: 0x4caf50,
    cost: { money: 120 }, damage: 10, range: 11, fireRate: 1.5, hp: 150,
  },
  rare: {
    name: 'Rare Turret', emoji: '🔵', rarityColor: 0x2196f3,
    cost: { money: 300 }, damage: 18, range: 13, fireRate: 1.8, hp: 210,
  },
  epic: {
    name: 'Epic Turret', emoji: '🟣', rarityColor: 0x9c27b0,
    cost: { emeralds: 4 }, damage: 30, range: 15, fireRate: 2.2, hp: 300,
  },
  legendary: {
    name: 'Legendary Turret', emoji: '🟡', rarityColor: 0xffc107,
    cost: { emeralds: 10 }, damage: 55, range: 17, fireRate: 2.6, hp: 420,
  },
  dust: {
    name: 'Dust Turret', emoji: '🌪️', rarityColor: 0xd2a86e,
    cost: { emeralds: 7 }, damage: 20, range: 12, fireRate: 1.6, hp: 220,
    knockback: 2.5, stunChance: 0.25, stunTime: 2,
    special: 'Shoots sand that PUSHES zombies back — 25% chance to stun them!',
  },
  acid: {
    name: 'Acid Turret', emoji: '🧪', rarityColor: 0x7ee24a, acid: true,
    cost: { money: 500 }, damage: 10, range: 12, fireRate: 1.4, hp: 240,
    acidDps: 8, acidTime: 4,
    special: 'Acid shots keep hurting zombies with continuous damage!',
  },
};

// One costume per turret rarity. Owning one dresses up every turret of that
// rarity (current and future) and gives them +10% damage.
export const COSTUMES = {
  // projColor = what the dressed-up turret's shots look like (mustard shoots MUSTARD!)
  common:    { name: 'Mustard Costume',   emoji: '🌭', cost: { diamonds: 20 },  style: 'mustard', projColor: 0xffd21f },
  uncommon:  { name: 'Ketchup Costume',   emoji: '🍅', cost: { diamonds: 30 },  style: 'ketchup', projColor: 0xd32f2f },
  rare:      { name: 'Wizard Costume',    emoji: '🧙', cost: { diamonds: 50 },  style: 'wizard' },
  epic:      { name: 'King Costume',      emoji: '👑', cost: { diamonds: 80 },  style: 'crown' },
  legendary: { name: 'Dragon Costume',    emoji: '🐉', cost: { diamonds: 120 }, style: 'dragon' },
  dust:      { name: 'Cowboy Costume',    emoji: '🤠', cost: { diamonds: 60 },  style: 'cowboy' },
  acid:      { name: 'Scientist Costume', emoji: '🥼', cost: { diamonds: 60 },  style: 'scientist' },
};
export const COSTUME_DAMAGE_BONUS = 0.10;

export const WEAPON_ORDER = ['fists', 'bat', 'crowbar', 'gun', 'hammer', 'suit'];
export const WEAPONS = {
  fists:   { name: 'Fists',         emoji: '👊', cost: null,             damage: 5,  range: 2.6, rate: 2.5, kind: 'melee' },
  bat:     { name: 'Baseball Bat',  emoji: '🏏', cost: { money: 75 },   damage: 15, range: 3.2, rate: 2.2, kind: 'melee' },
  crowbar: { name: 'Crowbar',       emoji: '⛏️', cost: { money: 150 },  damage: 26, range: 3.2, rate: 2.0, kind: 'melee' },
  gun:     { name: 'Zapper Gun',    emoji: '🔫', cost: { money: 250 },  damage: 12, range: 22,  rate: 4.0, kind: 'ranged' },
  hammer:  { name: 'Repair Hammer', emoji: '🔨', cost: { money: 200 },  heal: 20,   range: 3.4, rate: 2.0, kind: 'repair' },
  suit:    { name: 'Robot Suit',    emoji: '🦾', cost: { money: 1000 }, damage: 55, range: 3.6, rate: 2.0, kind: 'melee', armor: 0.5,
             special: 'SOOPER STRONG — punches as hard as a Legendary Turret and blocks half of all damage!' },
};

// Helper robot — buy it, then hand it a tool.
export const ROBOT = {
  name: 'Helper Robot', emoji: '🤖', cost: { money: 300 },
  speed: 5.0, followDist: 3,
  repairAmount: 10, repairRate: 1.5, seekRange: 16,
  tools: { hammer: '🔨', bat: '🏏', crowbar: '⛏️' },
};

// Rescued people can join your squad and fight!
export const ALLY_CAP = 3;
export const ALLY_DAMAGE_MULT = 0.5;   // squad members swing softer than the player
export const ALLY_WEAPONS = ['bat', 'bat', 'bat', 'crowbar', 'crowbar', 'gun'];  // random pick

// Base upgrades. Level 1 is the starter house.
export const BASE_LEVELS = {
  2: { name: 'Barbed Wire',    cost: { money: 200 },  hp: 500,  wireRadius: 5.6, wireDps: 6,
       desc: 'Barbed wire around the base hurts zombies that cross it!' },
  3: { name: 'Stronger Base',  cost: { money: 400 },  hp: 800,  wireRadius: 5.6, wireDps: 9,
       desc: 'Reinforced walls — the base gets way more HP.' },
  4: { name: 'Mega Base',      cost: { money: 700 },  hp: 1200, wireRadius: 7.2, wireDps: 14,
       desc: 'Bigger, stronger, COOLER — with towers and a wider wire ring!' },
  5: { name: 'CASTLE',         cost: { money: 1200 }, hp: 2000, wireRadius: 7.2, wireDps: 20,
       desc: 'The ultimate base: a real castle with towers and battlements! 🏰' },
};

// Lootable building full of money and turrets.
export const LOOT_BUILDING = {
  everyNWaves: 2, minWave: 3,
  money: (wave) => 80 + wave * 12,
  turretChances: [
    ['common', 0.40], ['uncommon', 0.30], ['rare', 0.20], ['epic', 0.08], ['legendary', 0.02],
  ],
};

export const ITEM_ORDER = ['burger', 'pizza', 'trap'];
export const ITEMS = {
  burger: { name: 'Burger',      emoji: '🍔', cost: { money: 20 }, heal: 50,  desc: 'Heals you 50 HP.' },
  pizza:  { name: 'Whole Pizza', emoji: '🍕', cost: { money: 45 }, heal: 999, desc: 'Heals you ALL the way!' },
  trap:   { name: 'Spike Trap',  emoji: '🪤', cost: { money: 40 }, damage: 18, uses: 8, desc: 'Hurts zombies that step on it. 8 uses.' },
};

// How much tougher zombies get per wave.
export function zombieHpScale(wave)  { return 1 + 0.07 * (wave - 1); }
export function zombieDmgScale(wave) { return 1 + 0.03 * (wave - 1); }

// Build the list of zombie types for a wave.
export function waveComposition(wave) {
  const avail = ZOMBIE_ORDER.filter((t) => ZOMBIE_UNLOCK_WAVE[t] <= wave);
  const newType = ZOMBIE_ORDER.find((t) => ZOMBIE_UNLOCK_WAVE[t] === wave);
  const count = Math.min(32, 5 + Math.floor(wave * 1.7));
  const comp = [];
  if (newType && wave > 1) {
    const featured = Math.min(3, 1 + Math.floor(wave / 6));
    for (let i = 0; i < featured; i++) comp.push(newType);
  }
  while (comp.length < count) {
    const t = avail[Math.floor(Math.random() * avail.length)];
    comp.push(Math.random() < 0.35 ? 'normal' : t);
  }
  // shuffle
  for (let i = comp.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [comp[i], comp[j]] = [comp[j], comp[i]];
  }
  return comp;
}

// Rewards for finishing a wave.
export function waveReward(wave) {
  return {
    money: 25 + wave * 8,
    diamonds: 1,
    emeralds: 1,
  };
}

// Zombies only divert to attack a turret when it's within this range;
// otherwise they march on the base. Stops one far-away decoy turret
// from dragging entire waves across the map.
export const TURRET_AGGRO_RANGE = 20;
