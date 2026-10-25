import {
  BLOCK, ROAD, CURB, DISTRICTS, SIGNS, BAY,
} from './config.js';
import {
  mulberry32, hash2, clamp, randRange, randInt, pick, chance, pickWeighted,
  resolveCircleRect, pointRectDist,
} from './utils.js';

const PALETTES = [
  { accent: '#5ffbf1', win: '#7ffcff', base: '#111827' }, // cyan
  { accent: '#ff2fb9', win: '#ff9be0', base: '#1a1124' }, // magenta
  { accent: '#ffb347', win: '#ffd58a', base: '#1d1712' }, // amber
  { accent: '#b98cff', win: '#d7bcff', base: '#171327' }, // violet
  { accent: '#7dffc0', win: '#b5ffdb', base: '#0f1b1a' }, // mint
  { accent: '#ff5c6c', win: '#ffa3ae', base: '#1e1117' }, // red
];

const WIN_COLORS = ['#7ffcff', '#ffd58a', '#ff9be0', '#c9d7ff', '#b5ffdb', '#f4f7ff'];
const CAR_COLORS = ['#2a3142', '#3b2b3f', '#1f2c3d', '#402f26', '#2b3a35', '#7a2335', '#23365a'];

const BLOCK_TYPES = [
  ['tower', 25], ['midrise', 31], ['market', 10], ['park', 8],
  ['plaza', 7], ['construction', 6], ['parking', 12],
];

function windowPattern(rng, h, w) {
  const rows = clamp(Math.floor(h / 4.2), 2, 26);
  const cols = clamp(Math.floor(w / 3.4), 2, 5);
  const lit = new Uint8Array(rows * cols);
  const colors = new Uint8Array(rows * cols);
  for (let i = 0; i < lit.length; i++) {
    lit[i] = rng() < 0.34 ? 1 : 0;
    colors[i] = Math.floor(rng() * WIN_COLORS.length);
    if (rng() < 0.06) lit[i] = 2; // very bright
  }
  return { rows, cols, lit, colors };
}

function makeBuilding(rng, x0, y0, x1, y1, opts = {}) {
  const pal = PALETTES[Math.floor(rng() * PALETTES.length)];
  const w = x1 - x0;
  const h = opts.height ?? randRange(rng, 16, 72);
  const b = {
    x0, y0, x1, y1,
    h,
    seed: Math.floor(rng() * 1e9),
    style: opts.style || 'box',
    baseColor: opts.baseColor || pal.base,
    accent: opts.accent || pal.accent,
    roofColor: '#0c111c',
    windows: windowPattern(rng, h, w),
    sign: null,
    antenna: chance(rng, h > 45 ? 0.65 : 0.25),
    beacon: chance(rng, 0.4),
    crown: h > 62 && chance(rng, 0.4),
    awning: chance(rng, 0.35),
  };
  if (opts.noSign !== true && h > 18 && chance(rng, 0.52)) {
    b.sign = {
      text: pick(rng, SIGNS),
      color: PALETTES[Math.floor(rng() * PALETTES.length)].accent,
      type: chance(rng, 0.55) ? 'roof' : 'wall',
      side: chance(rng, 0.5) ? 'right' : 'left',
    };
  }
  return b;
}

export class World {
  constructor(seed = 2088) {
    this.seed = seed;
    this.blocks = new Map();
    this._districtCache = new Map();
  }

  key(bx, by) { return `${bx},${by}`; }

  getBlock(bx, by) {
    const k = this.key(bx, by);
    let b = this.blocks.get(k);
    if (!b) {
      b = this.generateBlock(bx, by);
      this.blocks.set(k, b);
    }
    return b;
  }

  generateBlock(bx, by) {
    const rng = mulberry32(hash2(bx, by, this.seed));
    const x0 = bx * BLOCK + ROAD / 2;
    const y0 = by * BLOCK + ROAD / 2;
    const x1 = x0 + BLOCK - ROAD;
    const y1 = y0 + BLOCK - ROAD;
    const lot = { x0: x0 + CURB, y0: y0 + CURB, x1: x1 - CURB, y1: y1 - CURB };
    const district = this.districtAt(bx * BLOCK + BLOCK / 2, by * BLOCK + BLOCK / 2);
    const block = {
      bx, by, x0, y0, x1, y1, lot,
      type: 'midrise',
      buildings: [],
      props: { lights: [], trees: [], signs: [], parked: [], holos: [], cranes: [], planters: [] },
      puddles: [],
      landmark: null,
      district,
      seed: rng() * 1e9,
    };

    // everything east of the seawall is the bay
    if (this.isBayBlock(bx, by)) {
      block.type = 'water';
      return block;
    }

    // landmarks near the spawning intersection -----------------------------
    if (bx === 0 && by === 2) {
      block.type = 'landmark';
      block.landmark = 'pyramid';
      const p = 4;
      const b = makeBuilding(rng, lot.x0 + p, lot.y0 + p, lot.x1 - p, lot.y1 - p, {
        height: 112, style: 'pyramid', noSign: true,
        baseColor: '#181c30', accent: '#ffcf7a',
      });
      b.name = 'TRANSAMERICA PYRAMID';
      block.buildings.push(b);
    } else if (bx === 2 && by === 0) {
      block.type = 'landmark';
      block.landmark = 'tower';
      const b = makeBuilding(rng, lot.x0 + 3, lot.y0 + 3, lot.x1 - 3, lot.y1 - 3, {
        height: 156, style: 'crown', noSign: true,
        baseColor: '#10182a', accent: '#59c7ff',
      });
      b.name = 'SALESFORCE TOWER';
      b.sign = { text: 'SALESFORCE', color: '#59c7ff', type: 'roof', side: 'right' };
      block.buildings.push(b);
    } else if (bx === -1 && by === 1) {
      block.type = 'landmark';
      block.landmark = 'holo';
      const b = makeBuilding(rng, lot.x0 + 6, lot.y0 + 6, lot.x1 - 6, lot.y1 - 6, {
        height: 74, style: 'box', noSign: true, accent: '#ff2fb9',
      });
      b.sign = { text: 'NEXUS', color: '#ff2fb9', type: 'billboard', side: 'right' };
      block.buildings.push(b);
    } else if (bx === 1 && by === 1) {
      // easter egg: the four-cylinder HQ. Crash it and rival EV flags rise.
      block.type = 'landmark';
      block.landmark = 'bmw';
      const b = makeBuilding(rng, lot.x0 + 10, lot.y0 + 10, lot.x1 - 10, lot.y1 - 10, {
        height: 98, style: 'cyl', noSign: true,
        baseColor: '#e6ecf4', accent: '#2f6df6',
      });
      b.name = 'BMW VIERZYLINDER HQ';
      b.special = 'bmw';
      block.buildings.push(b);
    } else {
      // ordinary city block ------------------------------------------------
      let type = pickWeighted(rng, BLOCK_TYPES);
      if (bx === 0 && by === 0) type = 'plaza';
      block.type = type;

      const m = 1.2; // margin inside lot
      if (type === 'tower') {
        if (chance(rng, 0.7)) {
          const b = makeBuilding(rng, lot.x0 + m, lot.y0 + m, lot.x1 - m, lot.y1 - m, {
            height: randRange(rng, 40, 96),
          });
          if (chance(rng, 0.16)) {
            b.style = 'crown';
            b.h = randRange(rng, 90, 135);
          }
          block.buildings.push(b);
        } else {
          const split = randRange(rng, 0.4, 0.6);
          const cx = lot.x0 + (lot.x1 - lot.x0) * split;
          block.buildings.push(
            makeBuilding(rng, lot.x0 + m, lot.y0 + m, cx - 1.5, lot.y1 - m, { height: randRange(rng, 38, 88) }),
            makeBuilding(rng, cx + 1.5, lot.y0 + m, lot.x1 - m, lot.y1 - m, { height: randRange(rng, 30, 76) }),
          );
        }
      } else if (type === 'midrise') {
        const gx = randRange(rng, lot.x0 + 14, lot.x0 + 26);
        const gy = randRange(rng, lot.y0 + 14, lot.y0 + 26);
        const cells = [
          [lot.x0 + m, lot.y0 + m, gx - 1, gy - 1],
          [gx + 1, lot.y0 + m, lot.x1 - m, gy - 1],
          [lot.x0 + m, gy + 1, gx - 1, lot.y1 - m],
          [gx + 1, gy + 1, lot.x1 - m, lot.y1 - m],
        ];
        const count = randInt(rng, 2, 4);
        for (let i = 0; i < cells.length; i++) {
          if (i >= count || chance(rng, 0.12)) continue;
          const c = cells[i];
          if (c[2] - c[0] < 6 || c[3] - c[1] < 6) continue;
          block.buildings.push(makeBuilding(rng, c[0], c[1], c[2], c[3], {
            height: randRange(rng, 12, 44),
            style: chance(rng, 0.15) ? 'crown' : 'box',
          }));
        }
      } else if (type === 'market') {
        const rows = randInt(rng, 2, 3);
        const rowH = (lot.y1 - lot.y0 - 6) / rows;
        for (let r = 0; r < rows; r++) {
          const count = randInt(rng, 1, 2);
          for (let c = 0; c < count; c++) {
            const w = (lot.x1 - lot.x0 - 8) / count;
            const bx0 = lot.x0 + 2 + c * w + randRange(rng, 0, 2);
            const by0 = lot.y0 + 2 + r * rowH + randRange(rng, 0, 2);
            block.buildings.push(makeBuilding(rng, bx0, by0, bx0 + w - 5, by0 + rowH - 5, {
              height: randRange(rng, 7, 17),
              style: 'shop',
            }));
          }
        }
        block.props.signs.push({
          x: lot.x0 + 3, y: lot.y0 + 3,
          text: pick(rng, ['RAMEN', 'NOODLE', '24H', 'SUSHI', 'PAWN', 'SYNTH']),
          color: pick(rng, ['#ff2fb9', '#ffb347', '#5ffbf1']), h: 7,
        });
      } else if (type === 'park') {
        const n = randInt(rng, 5, 10);
        for (let i = 0; i < n; i++) {
          block.props.trees.push({
            x: randRange(rng, lot.x0 + 3, lot.x1 - 3),
            y: randRange(rng, lot.y0 + 3, lot.y1 - 3),
            r: randRange(rng, 2.2, 4.2),
            hue: pick(rng, ['#1d5b4a', '#24634c', '#2b5b63', '#4b2a63']),
            seed: rng(),
          });
        }
        block.props.holos.push({
          x: (lot.x0 + lot.x1) / 2, y: (lot.y0 + lot.y1) / 2,
          kind: 'pond', r: 7, color: '#39d7ff',
        });
      } else if (type === 'plaza') {
        block.props.holos.push({
          x: (lot.x0 + lot.x1) / 2, y: (lot.y0 + lot.y1) / 2,
          kind: pick(rng, ['torus', 'koi', 'pyramid', 'diamond']),
          r: 10, color: pick(rng, ['#5ffbf1', '#ff2fb9', '#b98cff']),
          phase: rng() * 6,
        });
        for (let i = 0; i < 4; i++) {
          block.props.planters.push({
            x: randRange(rng, lot.x0 + 4, lot.x1 - 4),
            y: randRange(rng, lot.y0 + 4, lot.y1 - 4),
            r: 1.5,
          });
        }
      } else if (type === 'construction') {
        block.props.cranes.push({
          x: lot.x0 + 10, y: lot.y0 + 10, h: randRange(rng, 45, 70), rot: rng() * Math.PI,
        });
        block.props.holos.push({
          x: (lot.x0 + lot.x1) / 2, y: (lot.y0 + lot.y1) / 2,
          kind: 'site', r: 12, color: '#ffb347',
        });
      } else if (type === 'parking') {
        const cols = 4, rows = 3;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (chance(rng, 0.45)) continue;
            block.props.parked.push({
              x: lot.x0 + 6 + c * ((lot.x1 - lot.x0 - 12) / (cols - 1)),
              y: lot.y0 + 7 + r * ((lot.y1 - lot.y0 - 14) / (rows - 1)),
              heading: Math.PI / 2,
              color: pick(rng, CAR_COLORS),
            });
          }
        }
      }
    }

    // always some life on the sidewalk --------------------------------
    const corners = [
      [block.x0 + 1.6, block.y0 + 1.6],
      [block.x1 - 1.6, block.y0 + 1.6],
      [block.x0 + 1.6, block.y1 - 1.6],
      [block.x1 - 1.6, block.y1 - 1.6],
    ];
    for (let i = 0; i < 4; i++) {
      if (chance(rng, 0.78)) {
        block.props.lights.push({
          x: corners[i][0], y: corners[i][1],
          color: pick(rng, ['#5ffbf1', '#ffb347', '#ff2fb9', '#b98cff']),
          seed: rng(),
        });
      }
    }
    if (block.type === 'midrise' || block.type === 'tower') {
      const n = randInt(rng, 1, 3);
      for (let i = 0; i < n; i++) {
        block.props.signs.push({
          x: randRange(rng, block.x0 + 2, block.x1 - 2),
          y: pick(rng, [block.y0 + 1.2, block.y1 - 1.2]),
          text: pick(rng, SIGNS),
          color: pick(rng, ['#ff2fb9', '#5ffbf1', '#ffb347', '#b98cff']),
          h: randRange(rng, 4, 8),
        });
      }
    }

    // wet street puddles on the roads around this block ------------------
    for (let i = 0; i < 4; i++) {
      const edge = randInt(rng, 0, 3);
      let px, py;
      if (edge === 0) { px = randRange(rng, block.x0 - ROAD * 0.4, block.x0 - 1); py = randRange(rng, block.y0, block.y1); }
      else if (edge === 1) { px = randRange(rng, block.x1 + 1, block.x1 + ROAD * 0.4); py = randRange(rng, block.y0, block.y1); }
      else if (edge === 2) { px = randRange(rng, block.x0, block.x1); py = randRange(rng, block.y0 - ROAD * 0.4, block.y0 - 1); }
      else { px = randRange(rng, block.x0, block.x1); py = randRange(rng, block.y1 + 1, block.y1 + ROAD * 0.4); }
      block.puddles.push({
        x: px, y: py, rx: randRange(rng, 1.2, 3.8), ry: randRange(rng, 0.7, 2.2),
        color: pick(rng, ['#2a7f9e', '#8a2a70', '#7b5f2a']), a: randRange(rng, 0.05, 0.14),
      });
    }
    return block;
  }

  districtAt(x, y) {
    if (x >= BAY.edgeX) return 'SAN FRANCISCO BAY';
    const bx = Math.floor(x / BLOCK);
    const by = Math.floor(y / BLOCK);
    if (Math.abs(bx) < 3 && Math.abs(by) < 3) return 'SOMA';
    const cx = Math.floor(bx / 4), cy = Math.floor(by / 4);
    const k = `${cx},${cy}`;
    let d = this._districtCache.get(k);
    if (!d) {
      d = DISTRICTS[hash2(cx, cy, 911) % DISTRICTS.length];
      this._districtCache.set(k, d);
    }
    return d;
  }

  /** returns a rect list of buildings near a point */
  buildingsNear(x, y, radius = 0) {
    const out = [];
    const bx0 = Math.floor((x - radius - ROAD / 2) / BLOCK) - 1;
    const bx1 = Math.floor((x + radius + ROAD / 2) / BLOCK) + 1;
    const by0 = Math.floor((y - radius - ROAD / 2) / BLOCK) - 1;
    const by1 = Math.floor((y + radius + ROAD / 2) / BLOCK) + 1;
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const block = this.getBlock(bx, by);
        for (const b of block.buildings) {
          if (b.x1 < x - radius || b.x0 > x + radius || b.y1 < y - radius || b.y0 > y + radius) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  /** resolve a circle against every building around it; mutates pos object */
  collideCircle(pos, radius, onHit) {
    const list = this.buildingsNear(pos.x, pos.y, radius + 2);
    let hit = null;
    for (const b of list) {
      if (b.collapsed) continue; // collapsed buildings are passable rubble
      const res = resolveCircleRect(pos.x, pos.y, radius, b.x0, b.y0, b.x1, b.y1);
      if (res) {
        pos.x = res.x;
        pos.y = res.y;
        hit = res;
        if (onHit) onHit(res, b);
      }
    }
    return hit;
  }

  /**
   * nearest point on the street grid. Returns {x,y,onRoad,axis}
   * axis 'x' means the road runs along x (i.e. y is snapped to a road centre).
   */
  snapToRoad(x, y) {
    const rx = Math.round(x / BLOCK) * BLOCK;
    const ry = Math.round(y / BLOCK) * BLOCK;
    const dx = Math.abs(x - rx);
    const dy = Math.abs(y - ry);
    if (dx <= ROAD / 2 || dy <= ROAD / 2) {
      return { x, y, onRoad: true, axis: dx < dy ? 'x' : 'y' };
    }
    if (dx < dy) return { x: rx, y, onRoad: false, axis: 'y' };
    return { x, y: ry, onRoad: false, axis: 'x' };
  }

  randomRoadPoint(cx, cy, minDist, maxDist, rng = Math.random) {
    for (let i = 0; i < 24; i++) {
      const a = rng() * Math.PI * 2;
      const r = minDist + rng() * (maxDist - minDist);
      const p = this.snapToRoad(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      if (p.onRoad) return p;
    }
    return this.snapToRoad(cx + (rng() - 0.5) * 100, cy + (rng() - 0.5) * 100);
  }

  /** is a point clear of buildings? */
  isClear(x, y, radius = 2.5) {
    for (const b of this.buildingsNear(x, y, radius + 2)) {
      if (pointRectDist(x, y, b.x0, b.y0, b.x1, b.y1) < radius) return false;
    }
    return true;
  }

  // ── bay / escape route ────────────────────────────────────────────────
  isBayBlock(bx) {
    return bx >= Math.floor(BAY.edgeX / BLOCK);
  }

  isPier(x, y) {
    if (x < BAY.edgeX - 4 || x > BAY.pierEnd + 2) return false;
    for (const g of BAY.gates) if (Math.abs(y - g) <= BAY.pierHalf) return true;
    return false;
  }

  onBoat(x, y) {
    return x >= BAY.boatX0 && x <= BAY.boatX1 && Math.abs(y) <= BAY.boatHalfY;
  }

  isWater(x, y) {
    if (x < BAY.edgeX) return false;
    if (x <= BAY.pierEnd + 2) return !this.isPier(x, y);
    if (x < BAY.boatX0) return true;
    return !this.onBoat(x, y);
  }

  deckHeightAt(x, y) {
    return this.onBoat(x, y) ? BAY.deckZ : 0;
  }

  nearestGate(x, y) {
    let best = BAY.gates[0], bd = Infinity;
    for (const g of BAY.gates) {
      const d = Math.abs(y - g);
      if (d < bd) { bd = d; best = g; }
    }
    return { y: best, dist: bd };
  }

  blocksInRect(x0, y0, x1, y1) {
    const bx0 = Math.floor(x0 / BLOCK) - 1;
    const bx1 = Math.floor(x1 / BLOCK) + 1;
    const by0 = Math.floor(y0 / BLOCK) - 1;
    const by1 = Math.floor(y1 / BLOCK) + 1;
    const out = [];
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) out.push(this.getBlock(bx, by));
    }
    return out;
  }
}
