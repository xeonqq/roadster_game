import { BLOCK, ROAD, COP } from './config.js';
import {
  clamp, dist, angleDiff, turnToward, damp, resolveCircleRect, TAU,
} from './utils.js';

const rand = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;

function pickType(heat) {
  const r = Math.random();
  if (heat >= 3 && r < 0.12) return 'drone';
  if (heat >= 2 && r < 0.32) return 'heavy';
  if (heat >= 1 && r < 0.58) return 'rammer';
  return 'interceptor';
}

function chooseNextNode(cop, player, heat) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const options = [];
  for (const [dx, dy] of dirs) {
    const nx = cop.navX + dx * BLOCK;
    const ny = cop.navY + dy * BLOCK;
    if (cop.prevX === nx && cop.prevY === ny) continue;
    const d = Math.abs(nx - player.x) + Math.abs(ny - player.y);
    options.push({ nx, ny, score: d + rand(-14, 26) });
  }
  if (!options.length) {
    options.push({ nx: cop.navX + BLOCK, ny: cop.navY, score: 0 });
  }
  options.sort((a, b) => a.score - b.score);
  cop.prevX = cop.navX;
  cop.prevY = cop.navY;
  cop.navX = options[0].nx;
  cop.navY = options[0].ny;
}

function lineOfSight(world, ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by);
  if (d < 1) return true;
  const midX = (ax + bx) / 2, midY = (ay + by) / 2;
  const list = world.buildingsNear(midX, midY, d / 2 + 4);
  if (!list.length) return true;
  const steps = Math.min(30, Math.max(3, Math.ceil(d / 7)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    for (const b of list) {
      if (px > b.x0 && px < b.x1 && py > b.y0 && py < b.y1) return false;
    }
  }
  return true;
}

function segPointHitsBarrier(x, y, r, bar) {
  return resolveCircleRect(x, y, r, bar.x0, bar.y0, bar.x1, bar.y1);
}

export class PoliceForce {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.cops = [];
    this.helicopters = [];
    this.barriers = [];
    this.spikes = [];
    this.roadblocks = [];
    this.wrecks = [];
    this.spawnTimer = 2.2;
    this.roadblockTimer = 22;
    this.heliTimer = 8;
    this.radioTimer = 6;
    this.warnTimer = 0;
    this.alert = null;
    this.alertTimer = 0;
    this._nextId = 1;
  }

  get copCount() { return this.cops.length; }

  update(dt, game) {
    const player = game.player;
    const heat = game.heat;

    // ── spawning ───────────────────────────────────────────────────────
    const targetCops = clamp(2 + Math.floor(heat * 1.7), 2, 13);
    this.spawnTimer -= dt;
    if (this.cops.length < targetCops && this.spawnTimer <= 0) {
      const spawned = this.spawnCop(game, pickType(heat));
      this.spawnTimer = spawned ? Math.max(0.75, 3.1 - heat * 0.32) : 0.6;
    }

    this.roadblockTimer -= dt;
    if (heat >= 1.2 && this.roadblockTimer <= 0) {
      this.spawnRoadblock(game);
      this.roadblockTimer = Math.max(13, 30 - heat * 2.4) + rand(0, 7);
    }

    this.heliTimer -= dt;
    if (heat >= 2.4 && this.helicopters.length === 0 && this.heliTimer <= 0) {
      this.spawnHelicopter(game);
      this.heliTimer = 10;
    }

    this.radioTimer -= dt;
    if (this.radioTimer <= 0) {
      this.radioTimer = rand(10, 17);
      game.policeRadio(heat);
    }
    this.alertTimer = Math.max(0, this.alertTimer - dt);
    this.warnTimer = Math.max(0, this.warnTimer - dt);

    // ── units ──────────────────────────────────────────────────────────
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const cop = this.cops[i];
      cop.hitFlash = Math.max(0, cop.hitFlash - dt * 4);
      cop.stun = Math.max(0, cop.stun - dt);
      cop.fireCd -= dt;
      cop.ramCd -= dt;
      cop.losTimer -= dt;
      cop.phase += dt;

      if (dist(cop.x, cop.y, player.x, player.y) > 340) {
        this.cops.splice(i, 1);
        continue;
      }
      this.updateCop(cop, dt, game);
    }

    // ── helicopters ────────────────────────────────────────────────────
    for (let i = this.helicopters.length - 1; i >= 0; i--) {
      const h = this.helicopters[i];
      this.updateHelicopter(h, dt, game);
      if (h.health <= 0) {
        game.fx.explosion(h.x, h.y, h.z, 2.4, '#ff7a4a');
        game.audio.explosion(true);
        game.addShake(1.5);
        game.onHeliDestroyed(h);
        this.helicopters.splice(i, 1);
      }
    }

    for (const w of this.wrecks) w.life -= dt;
    for (let i = this.wrecks.length - 1; i >= 0; i--) if (this.wrecks[i].life <= 0) this.wrecks.splice(i, 1);

    // ── player vs roadblock hazards ────────────────────────────────────
    for (let i = this.barriers.length - 1; i >= 0; i--) {
      const b = this.barriers[i];
      if (b.hp <= 0) {
        game.fx.explosion(b.x, b.y, 1.2, 1.3, '#ffb347');
        game.audio.explosion(false);
        game.addShake(0.6);
        game.addScore(35, 'BARRIER');
        this.barriers.splice(i, 1);
      }
    }
    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const rb = this.roadblocks[i];
      rb.life -= dt;
      if (rb.life <= 0) this.roadblocks.splice(i, 1);
    }
    this.collidePlayer(game, dt);
  }

  spawnCop(game, typeOverride = null) {
    const player = game.player;
    const type = typeOverride || pickType(game.heat);
    const def = COP[type];
    let point = null;
    const hx = Math.cos(player.heading), hy = Math.sin(player.heading);
    let fallback = null;
    for (let i = 0; i < 30; i++) {
      const p = game.world.randomRoadPoint(player.x, player.y, 90, 165);
      if (!p.onRoad) continue;
      if (!game.world.isClear(p.x, p.y, 5)) continue;
      if (dist(p.x, p.y, player.x, player.y) < 72) continue;
      const ahead = (p.x - player.x) * hx + (p.y - player.y) * hy;
      if (!fallback) fallback = p;
      if (ahead < 18) continue;
      point = p;
      break;
    }
    if (!point) point = fallback;
    if (!point) return false;

    const cop = {
      id: this._nextId++,
      type, x: point.x, y: point.y, z: def.flying ? 5.5 : 0,
      vx: 0, vy: 0, heading: rand(-Math.PI, Math.PI),
      health: def.health * (1 + Math.max(0, game.heat - 2) * 0.1),
      maxHealth: def.health, radius: def.radius,
      fireCd: rand(1.2, 3.5), ramCd: 0, losTimer: 0, hasLos: false,
      navX: Math.round(point.x / BLOCK) * BLOCK,
      navY: Math.round(point.y / BLOCK) * BLOCK,
      prevX: 1e9, prevY: 1e9,
      navTimer: 0, direct: false,
      stuck: 0, lastX: point.x, lastY: point.y,
      stun: 0, hitFlash: 0, phase: rand(0, 6),
      boostGlow: 0, sirenPhase: rand(0, TAU),
      spawnGrace: 1.2,
    };
    this.cops.push(cop);
    if (game.heat >= 1.4 && chance(0.28)) game.radio('UNIT REQUESTING BACKUP');
    return true;
  }

  updateCop(cop, dt, game) {
    const player = game.player;
    const def = COP[cop.type];
    cop.spawnGrace = Math.max(0, cop.spawnGrace - dt);
    const dx = player.x - cop.x, dy = player.y - cop.y;
    const d = Math.hypot(dx, dy);

    // line-of-sight, throttled
    if (cop.losTimer <= 0) {
      cop.losTimer = 0.18;
      cop.hasLos = lineOfSight(game.world, cop.x, cop.y, player.x, player.y);
    }

    if (cop.stun > 0) {
      cop.vx = damp(cop.vx, 0, 2, dt);
      cop.vy = damp(cop.vy, 0, 2, dt);
      cop.x += cop.vx * dt;
      cop.y += cop.vy * dt;
      if (chance(dt * 16)) game.fx.sparks(cop.x, cop.y, 1, 1, '#7dffc0', 5);
      return;
    }

    // ── navigation target ──────────────────────────────────────────────
    let tx, ty;
    cop.direct = d < 92 && cop.hasLos;
    if (cop.direct) {
      tx = player.x + player.vx * 0.18;
      ty = player.y + player.vy * 0.18;
    } else {
      if (dist(cop.x, cop.y, cop.navX, cop.navY) < 8) {
        if (cop.prevX > 1e8) {
          cop.prevX = cop.navX;
          cop.prevY = cop.navY;
        }
        chooseNextNode(cop, player, game.heat);
      }
      tx = cop.navX;
      ty = cop.navY;
    }

    // ── steering ───────────────────────────────────────────────────────
    const targetAngle = Math.atan2(ty - cop.y, tx - cop.x);
    const err = Math.abs(angleDiff(cop.heading, targetAngle));
    const speedNow = Math.hypot(cop.vx, cop.vy);
    const turn = def.turn * (1 + game.heat * 0.025);
    if (err < 2.4) {
      cop.heading = turnToward(cop.heading, targetAngle, turn * dt * (1 + speedNow / 120));
    }
    let desired = def.maxSpeed * (0.82 + Math.min(5, game.heat) * 0.045);
    desired *= 1 - clamp(err / 2.4, 0, 0.62);
    // keep the pressure on: distant units get a catch-up boost unless the player is boosting away
    if (d > 110 && !player.boosting && player.speed < 80) {
      desired *= 1 + clamp((d - 110) / 300, 0, 0.28);
    }
    if (d < 28 && (cop.type === 'rammer' || cop.type === 'drone')) desired *= 1.25;
    if (!cop.hasLos) desired *= 0.92;

    let ax = Math.cos(cop.heading) * desired;
    let ay = Math.sin(cop.heading) * desired;

    // simple separation so cruisers don't stack
    for (const o of this.cops) {
      if (o === cop) continue;
      const sx = cop.x - o.x, sy = cop.y - o.y;
      const sd = Math.hypot(sx, sy);
      if (sd > 0.1 && sd < 7.5) {
        ax += (sx / sd) * 16;
        ay += (sy / sd) * 16;
      }
    }

    cop.vx = damp(cop.vx, ax, 3.6, dt);
    cop.vy = damp(cop.vy, ay, 3.6, dt);
    cop.x += cop.vx * dt;
    cop.y += cop.vy * dt;

    if (cop.type === 'drone') {
      cop.z = 5.5 + Math.sin(cop.phase * 3) * 0.7;
    } else {
      // hard collision with city geometry
      game.world.collideCircle(cop, cop.radius + 0.2, (hit) => {
        const vn = cop.vx * hit.nx + cop.vy * hit.ny;
        if (vn < 0) {
          cop.vx -= hit.nx * vn * 1.35;
          cop.vy -= hit.ny * vn * 1.35;
          cop.vx *= 0.65;
          cop.vy *= 0.65;
          if (Math.abs(vn) > 18 && chance(0.4)) {
            game.fx.sparks(cop.x, cop.y, 1, 4, '#ffcc66', 8);
          }
        }
        cop.stuck += dt * 2;
      });
    }

    // unstick logic
    const moved = dist(cop.x, cop.y, cop.lastX, cop.lastY);
    if (moved < 0.25) cop.stuck += dt; else cop.stuck = Math.max(0, cop.stuck - dt * 0.7);
    cop.lastX = cop.x; cop.lastY = cop.y;
    if (cop.stuck > 1.6) {
      cop.stuck = 0;
      cop.navX = Math.round(cop.x / BLOCK) * BLOCK + (chance(0.5) ? BLOCK : -BLOCK);
      cop.navY = Math.round(cop.y / BLOCK) * BLOCK;
      cop.prevX = 1e9; cop.prevY = 1e9;
    }

    // ── shooting ───────────────────────────────────────────────────────
    if (cop.spawnGrace <= 0 && cop.fireCd <= 0 && d < def.range && cop.hasLos && Math.abs(angleDiff(cop.heading, Math.atan2(dy, dx))) < 0.48) {
      const rateBoost = 1 + Math.max(0, game.heat - 1) * 0.09;
      cop.fireCd = def.fireRate / rateBoost + rand(-0.15, 0.25);
      this.copShoot(cop, game, d);
    }

    // ── ramming ────────────────────────────────────────────────────────
    const contactDist = cop.radius + game.playerRadius + 0.9;
    if (d < contactDist && player.z < 2.2 && cop.spawnGrace <= 0) {
      const nx = dx / (d || 1), ny = dy / (d || 1);
      const push = contactDist - d;
      cop.x -= nx * push * 0.55;
      cop.y -= ny * push * 0.55;
      player.x += nx * push * 0.5;
      player.y += ny * push * 0.5;
      if (cop.ramCd <= 0) {
        cop.ramCd = 0.85;
        const rel = Math.hypot(player.vx - cop.vx, player.vy - cop.vy);
        let dmg = (cop.type === 'rammer' ? 10 : 6) + rel * 0.22;
        if (cop.type === 'drone') dmg *= 0.7;
        player.damage(dmg, game, cop);
        game.fx.sparks((player.x + cop.x) / 2, (player.y + cop.y) / 2, 1, 8, '#ffd58a', 10);
        game.audio.impact(1.5);
        // player can trade paint
        if (rel > 24) this.damageCop(cop, rel * 0.55, game);
      }
      cop.boostGlow = 1;
    } else {
      cop.boostGlow = Math.max(0, cop.boostGlow - dt * 3);
    }
  }

  copShoot(cop, game, d) {
    const player = game.player;
    const def = COP[cop.type];
    const lead = Math.min(0.5, d / 240);
    const tx = player.x + player.vx * lead;
    const ty = player.y + player.vy * lead;
    const base = Math.atan2(ty - cop.y, tx - cop.x);
    const acc = def.accuracy * (1 - Math.min(0.5, game.heat * 0.06));
    let shots = 1;
    if (cop.type === 'heavy') shots = 3;
    if (cop.type === 'drone') shots = 2;

    const muzzleX = cop.x + Math.cos(cop.heading) * cop.radius;
    const muzzleY = cop.y + Math.sin(cop.heading) * cop.radius;
    for (let i = 0; i < shots; i++) {
      const a = base + rand(-acc, acc);
      const sp = 120;
      game.spawnBullet({
        x: muzzleX, y: muzzleY, z: 0.9,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: def.range / sp + 0.15, damage: def.damage * (cop.type === 'heavy' ? 0.8 : 1),
        owner: 'cop', color: '#ff6b6b', size: 0.75, angle: a,
      });
    }
    game.fx.muzzle(muzzleX, muzzleY, 1, base, '#ff9b6b');
    if (dist(cop.x, cop.y, player.x, player.y) < 70) game.audio.copGun();
  }

  damageCop(cop, amount, game) {
    if (cop.dead) return;
    cop.health -= amount;
    cop.hitFlash = 1;
    if (chance(0.6)) game.fx.sparks(cop.x, cop.y, 1, 2, '#ffd58a', 7);
    if (cop.health <= 0) {
      cop.dead = true;
      const idx = this.cops.indexOf(cop);
      if (idx >= 0) this.cops.splice(idx, 1);
      const big = cop.type === 'heavy';
      game.fx.explosion(cop.x, cop.y, 0.6, big ? 1.7 : 1.15, '#ff8a3c');
      game.audio.explosion(big);
      game.addShake(big ? 1.2 : 0.6);
      this.wrecks.push({ x: cop.x, y: cop.y, heading: cop.heading, type: cop.type, life: 7 });
      game.onCopDestroyed(cop);
    }
  }

  damageHeli(heli, amount, game) {
    heli.health -= amount;
    heli.hitFlash = 1;
    game.fx.sparks(heli.x, heli.y, heli.z, 3, '#ffd58a', 8);
  }

  // ── roadblocks ───────────────────────────────────────────────────────
  spawnRoadblock(game) {
    const player = game.player;
    const fx = Math.cos(player.heading), fy = Math.sin(player.heading);
    const ahead = 150 + Math.min(50, Math.abs(player.forwardSpeed) * 1.1);
    let bx = player.x + fx * ahead;
    let by = player.y + fy * ahead;
    let axis;
    if (Math.abs(fx) > Math.abs(fy)) {
      bx = Math.round(bx);
      by = Math.round(by / BLOCK) * BLOCK;
      axis = 'x';
    } else {
      bx = Math.round(bx / BLOCK) * BLOCK;
      by = Math.round(by);
      axis = 'y';
    }
    if (!game.world.isClear(bx, by, 4)) return;
    if (this.roadblocks.some((r) => dist(r.x, r.y, bx, by) < 90)) return;

    const gap = chance(0.62) ? Math.floor(rand(0, 4)) : -1;
    const count = 4;
    const span = ROAD - 1.5;
    for (let i = 0; i < count; i++) {
      if (i === gap) continue;
      const off = -span / 2 + (span / count) * (i + 0.5);
      const w = 3.8, len = (span / count) - 0.9;
      let x0, y0, x1, y1;
      if (axis === 'x') {
        x0 = bx - w / 2; x1 = bx + w / 2;
        y0 = by + off - len / 2; y1 = by + off + len / 2;
      } else {
        x0 = bx + off - len / 2; x1 = bx + off + len / 2;
        y0 = by - w / 2; y1 = by + w / 2;
      }
      this.barriers.push({
        x: (x0 + x1) / 2, y: (y0 + y1) / 2, x0, y0, x1, y1,
        w: x1 - x0, h: y1 - y0, hp: 55, maxHp: 55,
        axis, angle: axis === 'x' ? 0 : Math.PI / 2, flash: 0,
      });
    }
    // spike strip on the approach side
    const back = 18;
    let sx = bx, sy = by;
    if (axis === 'x') sx -= Math.sign(fx) * back; else sy -= Math.sign(fy) * back;
    this.spikes.push({
      x: sx, y: sy, axis, life: 55,
      x0: axis === 'x' ? sx - 1.1 : sx - ROAD / 2,
      x1: axis === 'x' ? sx + 1.1 : sx + ROAD / 2,
      y0: axis === 'x' ? sy - ROAD / 2 : sy - 1.1,
      y1: axis === 'x' ? sy + ROAD / 2 : sy + 1.1,
      armed: true,
    });
    this.roadblocks.push({ x: bx, y: by, axis, life: 55 });
    game.hud.alert('ROADBLOCK AHEAD', 'JUMP IT OR SHOOT THROUGH');
    game.audio.alert();
    game.radio('SPIKE STRIP AND BARRIER TEAM DEPLOYED');

    // a pair of cruisers take positions near the blockade
    for (let i = 0; i < 2; i++) {
      const p = { x: bx + fx * (12 + i * 10) + (i ? 8 : -8), y: by + fy * (12 + i * 10) + (i ? -8 : 8) };
      if (game.world.isClear(p.x, p.y, 4)) this.spawnCopAt(game, p.x, p.y, i === 0 ? 'heavy' : 'interceptor');
    }
  }

  spawnCopAt(game, x, y, type) {
    const def = COP[type];
    const cop = {
      id: this._nextId++,
      type, x, y, z: 0, vx: 0, vy: 0, heading: rand(-Math.PI, Math.PI),
      health: def.health, maxHealth: def.health, radius: def.radius,
      fireCd: rand(0.5, 1.8), ramCd: 0, losTimer: 0, hasLos: false,
      navX: Math.round(x / BLOCK) * BLOCK, navY: Math.round(y / BLOCK) * BLOCK,
      prevX: 1e9, prevY: 1e9, navTimer: 0, direct: false,
      stuck: 0, lastX: x, lastY: y, stun: 0, hitFlash: 0,
      phase: rand(0, 6), boostGlow: 0, sirenPhase: rand(0, TAU),
      spawnGrace: 0.6,
    };
    this.cops.push(cop);
    return cop;
  }

  collidePlayer(game, dt) {
    const p = game.player;
    if (p.dead) return;
    for (const b of this.barriers) {
      b.flash = Math.max(0, b.flash - dt * 5);
      if (p.z > 1.8) continue;
      const res = segPointHitsBarrier(p.x, p.y, 1.75, b);
      if (!res) continue;
      p.x = res.x; p.y = res.y;
      const vn = p.vx * res.nx + p.vy * res.ny;
      if (vn < 0) {
        p.vx -= res.nx * vn * 1.5;
        p.vy -= res.ny * vn * 1.5;
        const force = Math.abs(vn);
        if (force > 12) {
          p.damage(clamp(force * 0.24, 2, 16), game, b);
          b.hp -= force * 0.32;
          b.flash = 1;
          game.addShake(0.5);
          game.audio.impact(force / 20);
          game.fx.sparks((p.x + b.x) / 2, (p.y + b.y) / 2, 1, 7, '#ffcc66', 9);
        }
      }
    }
    for (const s of this.spikes) {
      if (!s.armed || p.z > 0.5) continue;
      if (p.x > s.x0 && p.x < s.x1 && p.y > s.y0 && p.y < s.y1) {
        s.armed = false;
        p.applySpikeStrip(game);
        game.fx.sparks(p.x, p.y, 0.3, 12, '#ffd58a', 8);
      }
    }
    // remove expired spikes
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      this.spikes[i].life -= dt;
      if (this.spikes[i].life <= 0) this.spikes.splice(i, 1);
    }
  }

  bulletsHitBarrier(bullet, game) {
    for (const b of this.barriers) {
      if (bullet.x > b.x0 && bullet.x < b.x1 && bullet.y > b.y0 && bullet.y < b.y1) {
        b.hp -= bullet.damage;
        b.flash = 1;
        game.fx.sparks(bullet.x, bullet.y, 1, 4, '#ffcf7a', 6);
        if (bullet.splash) game.explodeAt(bullet.x, bullet.y, bullet.splash, bullet.damage * 0.7);
        return true;
      }
    }
    return false;
  }

  // ── air support ──────────────────────────────────────────────────────
  spawnHelicopter(game) {
    const p = game.player;
    const h = {
      x: p.x + rand(-55, 55), y: p.y + rand(-55, 55), z: 34,
      vx: 0, vy: 0, health: 150, maxHealth: 150, radius: 5,
      rotor: 0, fireCd: 2.5, burst: 0, burstCd: 0, hitFlash: 0,
      phase: rand(0, 6), scan: rand(0, TAU), warn: 0,
    };
    this.helicopters.push(h);
    game.hud.alert('AIR UNIT INBOUND', 'KEEP MOVING — IT HAS A SPOTLIGHT');
    game.audio.alert();
    game.radio('AIR UNIT, LIGHT THEM UP');
  }

  updateHelicopter(h, dt, game) {
    const p = game.player;
    h.rotor += dt * 24;
    h.phase += dt;
    h.hitFlash = Math.max(0, h.hitFlash - dt * 4);
    h.scan += dt * 1.6;
    const tx = p.x - p.vx * 0.55;
    const ty = p.y - p.vy * 0.55;
    h.vx = damp(h.vx, (tx - h.x) * 0.55, 1.3, dt);
    h.vy = damp(h.vy, (ty - h.y) * 0.55, 1.3, dt);
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.z = 34 + Math.sin(h.phase * 1.3) * 2.5;

    h.fireCd -= dt;
    h.burstCd -= dt;
    h.warn = Math.max(0, h.warn - dt);
    if (h.burst > 0 && h.burstCd <= 0) {
      h.burst--;
      h.burstCd = 0.11;
      const d = dist(h.x, h.y, p.x, p.y);
      const lead = 0.12;
      const a = Math.atan2(p.y + p.vy * lead - h.y, p.x + p.vx * lead - h.x) + rand(-0.07, 0.07);
      game.spawnBullet({
        x: h.x, y: h.y, z: 0.8,
        vx: Math.cos(a) * 150, vy: Math.sin(a) * 150,
        life: 1.2, damage: 4.5, owner: 'cop', color: '#ff7b7b', size: 1, angle: a,
      });
      game.fx.muzzle(h.x, h.y, 1, a, '#ff9b6b');
      game.fx.sparks(h.x, h.y, h.z, 2, '#ffd58a', 5);
      game.audio.copGun();
    }
    if (h.fireCd <= 0 && dist(h.x, h.y, p.x, p.y) < 130) {
      h.fireCd = Math.max(1.7, 3.4 - game.heat * 0.25);
      h.burst = 4;
      h.burstCd = 0.45;
      h.warn = 0.75;
      game.addShake(0.1);
    }
    if (dist(h.x, h.y, p.x, p.y) > 340) {
      h.health = 0;
    }
  }
}
