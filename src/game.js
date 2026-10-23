import { BLOCK, ROAD, WEAPONS, WEAPON_ORDER, COP, BAY } from './config.js';
import {
  clamp, dist, randRange, pick, chance, segmentCircle, damp, TAU, formatNum,
} from './utils.js';
import { Player } from './player.js';
import { PoliceForce } from './police.js';
import { FX, SkidMarks } from './fx.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class Game {
  constructor({ canvas, input, audio, hud, renderer, world }) {
    this.canvas = canvas;
    this.input = input;
    this.audio = audio;
    this.hud = hud;
    this.renderer = renderer;
    this.world = world;

    this.player = new Player();
    this.police = new PoliceForce(this);
    this.fx = new FX();
    this.skids = new SkidMarks();
    this.bullets = [];
    this.pickups = [];
    this.missionGates = BAY.gates.map((y, i) => ({
      x: BAY.edgeX - 1, y,
      label: ['NORTH', 'CENTRAL', 'SOUTH'][i],
      route: i,
    }));

    this.state = 'menu';
    this.paused = false;
    this.autoAim = null;
    this.time = 0;
    this.menuTime = 0;
    this.heat = 1;
    this.playerRadius = 1.8;
    this.deathTimer = 0;
    this.spawnTimer = 2;
    this.dropCd = 0;
    this.radioCooldown = 8;
    this.lastRadio = '';
    this.best = this.loadBest();
    this.newBest = false;
    this.frame = 0;
    this.slowMo = 0;
    this.slowMoJump = false;
    this.winTimer = 0;
    this.escapeArmed = false;
    this.lastSafe = { x: 0, y: -2 };
    this.hud.setBest(this.best);

    this.player.reset(0, -2);
    this.renderer.snapCamera(this.player);
    this.hud.showMenu(this.best);
  }

  loadBest() {
    try { return Number(localStorage.getItem('neon-overdrive-best')) || 0; } catch { return 0; }
  }

  saveBest() {
    this.newBest = this.player.score > this.best;
    if (this.newBest) {
      this.best = Math.floor(this.player.score);
      try { localStorage.setItem('neon-overdrive-best', String(this.best)); } catch {}
      this.hud.setBest(this.best);
    }
  }

  startNew() {
    this.audio.init();
    this.audio.setMuted(this.audio.muted);
    this.player.reset(0, -2);
    this.police.reset();
    this.fx.reset();
    this.skids.reset();
    this.bullets.length = 0;
    this.pickups.length = 0;
    this.time = 0;
    this.heat = 1;
    this.deathTimer = 0;
    this.spawnTimer = 1.6;
    this.radioCooldown = 5;
    this.newBest = false;
    this.slowMo = 0;
    this.slowMoJump = false;
    this.winTimer = 0;
    this.escapeArmed = false;
    this.lastSafe = { x: this.player.x, y: this.player.y };
    this.state = 'playing';
    this.paused = false;
    this.autoAim = null;
    this.renderer.snapCamera(this.player);
    this.renderer.resetAmbience();

    // onboarding pickups ahead on the road
    this.spawnPickup(52, -2, 'weapon', { weapon: 'shotgun' });
    this.spawnPickup(96, -2, 'turbo');
    this.spawnPickup(148, -2, 'repair');
    this.spawnPickup(210, -2, 'weapon', { weapon: 'rocket' });
    this.spawnPickup(74, -2, 'boostpad', { angle: 0 });
    this.spawnPickup(120, -2, 'ramp', { angle: 0 });
    this.setupMissionFeatures();

    this.hud.hideOverlays();
    this.hud.showHUD(true);
    this.hud.alert('ESCAPE EAST', '3 BAY ROUTES // JACK THE BOAT');
    this.hud.toast('FOLLOW A ROUTE TO THE BAY • HILLS AND RAMPS LAUNCH YOU', 'info');
    this.hud.toast('THE ONLY WAY OUT IS THE BOAT', 'warn');
    this.audio.ui();
    this.audio.setEngine(0, false, true);
  }

  toMenu() {
    this.state = 'menu';
    this.hud.showMenu(this.best);
    this.hud.showHUD(false);
    this.audio.setEngine(0, false, false);
    this.audio.setSiren(0);
    this.audio.setBoost(false);
    this.player.reset(0, -2);
    this.police.reset();
    this.bullets.length = 0;
    this.pickups.length = 0;
    this.fx.reset();
    this.slowMo = 0;
    this.winTimer = 0;
    this.escapeArmed = false;
    this.renderer.snapCamera(this.player);
  }

  setupMissionFeatures() {
    const names = ['NORTH', 'CENTRAL', 'SOUTH'];
    BAY.gates.forEach((y, i) => {
      // natural launch hills, one per escape corridor
      const hill = this.spawnPickup(360, y, 'hill', { angle: 0 });
      if (hill) {
        hill.mission = true;
        hill.life = Infinity;
        hill.label = `${names[i]} HILL`;
      }
      // final ramp at the end of each pier
      const ramp = this.spawnPickup(831, y, 'ramp', { angle: 0 });
      if (ramp) {
        ramp.mission = true;
        ramp.life = Infinity;
        ramp.final = true;
        ramp.label = `${names[i]} PIER RAMP`;
      }
    });
  }

  triggerSlowMo(seconds = 0.9, title = null, sub = '') {
    this.slowMo = Math.max(this.slowMo, seconds);
    if (this.slowMo <= seconds + 0.02) this.audio.slowMo();
    if (title) this.hud.alert(title, sub);
  }

  checkJumpOverCops() {
    const p = this.player;
    if (this.state !== 'playing' || p.dead) return;
    if (!p.airborne && !this.slowMoJump) return;
    if (!p.airborne) { this.slowMoJump = false; return; }
    if (p.z < 1.35 || this.slowMoJump) return;
    let jumped = 0;
    for (const c of this.police.cops) {
      if (c.health <= 0 || c.type === 'drone') continue;
      if (Math.hypot(c.x - p.x, c.y - p.y) < 4.8) jumped++;
    }
    for (const b of this.police.barriers) {
      if (Math.hypot(b.x - p.x, b.y - p.y) < 5.2) jumped++;
    }
    if (jumped >= 2) {
      this.slowMoJump = true;
      this.triggerSlowMo(1.05, 'SLOW MOTION', `AIRBORNE OVER ${jumped} SFPD UNITS`);
      this.addScore(80 * jumped, 'BLOCKADE JUMP');
      p.addTurbo(12);
      this.addShake(0.5);
      this.fx.flash('#8ffcff', 0.18, 0.3);
    }
  }

  checkWaterAndBoat(dt) {
    const p = this.player;
    if (p.dead) return;
    // only the three bay gates and their piers arm the boat landing
    if (this.world.isPier(p.x, p.y)) {
      this.escapeArmed = true;
    } else if (!p.airborne && !this.world.isWater(p.x, p.y) && !this.world.onBoat(p.x, p.y)) {
      this.escapeArmed = false;
    }
    if (this.world.isWater(p.x, p.y) && p.z < 1.1) {
      p.x = this.lastSafe.x;
      p.y = this.lastSafe.y;
      p.z = 0;
      p.vz = 0;
      p.airborne = false;
      p.vx *= 0.18;
      p.vy *= 0.18;
      if (p.wallCd <= 0) {
        p.wallCd = 0.9;
        p.damage(4, this);
        this.hud.toast('SEAWALL — USE ONE OF THE 3 BAY GATES', 'warn');
        this.fx.ring(p.x, p.y, 3, '#ffb347');
        this.audio.impact(1);
      }
      return;
    }
    if (!this.world.isWater(p.x, p.y) && !p.airborne && p.z < 0.6 && !this.world.onBoat(p.x, p.y)) {
      this.lastSafe.x = p.x;
      this.lastSafe.y = p.y;
    }
    if (this.world.onBoat(p.x, p.y) && p.z <= BAY.deckZ + 0.35) {
      if (this.escapeArmed) {
        p.z = BAY.deckZ;
        p.vz = 0;
        p.airborne = false;
        this.win();
      } else {
        p.x = this.lastSafe.x;
        p.y = this.lastSafe.y;
        p.z = 0;
        p.vz = 0;
        p.airborne = false;
        p.vx *= 0.2;
        p.vy *= 0.2;
        this.hud.toast('OFF-ROUTE — REACH THE BOAT VIA A CYAN GATE', 'warn');
      }
    }
  }

  win() {
    if (this.state !== 'playing') return;
    this.state = 'won';
    this.winTimer = 2.8;
    this.slowMo = 0.9;
    this.addScore(5000, 'ESCAPED');
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.vz = 0;
    this.player.forwardSpeed = 0;
    this.player.lateralSpeed = 0;
    this.player.speed = 0;
    this.player.boosting = false;
    this.saveBest();
    this.fx.flash('#5ffbf1', 0.45, 0.7);
    this.fx.ring(this.player.x, this.player.y, 12, '#5ffbf1');
    this.addShake(1.4);
    this.hud.alert('BOAT SECURED', 'SFPD CANNOT FOLLOW // RUN COMPLETE');
    this.hud.toast('YOU MADE THE BOAT — ESCAPE CONFIRMED', 'good');
    this.audio.setEngine(0, false, false);
    this.audio.setSiren(0);
    this.audio.setBoost(false);
    this.audio.ui();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.audio.setEngine(0, false, false);
      this.audio.setSiren(0);
      this.audio.setBoost(false);
      this.hud.showPause(true);
      this.audio.ui();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.hud.showPause(false);
      this.audio.ui();
    }
  }

  update(dt) {
    this.frame++;
    if (this.input.wasPressed('mute')) {
      const muted = this.audio.toggleMute();
      this.hud.setMuted(muted);
    }

    if (this.state === 'menu') {
      this.menuTime += dt;
      if (this.input.wasPressed('start') || this.input.mouse.justDown) {
        if (!this.hud.isOverlayButton(this.input.mouse.x, this.input.mouse.y)) this.startNew();
      }
      return;
    }

    if (this.state === 'over') {
      this.fx.update(dt);
      this.skids.update(dt);
      if (this.input.wasPressed('restart') || this.input.wasPressed('start')) this.startNew();
      return;
    }

    if (this.state === 'won') {
      this.slowMo = Math.max(0, this.slowMo - dt);
      this.fx.update(dt);
      this.skids.update(dt);
      this.winTimer -= dt;
      this.hud.update(this);
      if (this.winTimer <= 0) {
        this.state = 'over';
        this.slowMo = 0;
        this.hud.showGameOver(this.stats(), true);
      }
      return;
    }

    if (this.state === 'paused') {
      if (this.input.wasPressed('pause')) this.togglePause();
      return;
    }

    if (this.state === 'playing' && this.input.wasPressed('pause')) {
      this.togglePause();
      return;
    }

    const active = this.state === 'playing';
    const slow = this.state === 'dying' ? 0.35 : 1;
    const slowMo = this.slowMo > 0 ? 0.38 : 1;
    const adt = dt * slow * slowMo;
    this.slowMo = Math.max(0, this.slowMo - dt);

    this.time += active ? adt : 0;

    if (active || this.state === 'dying') {
      this.player.update(adt, this.input, this);
      this.resolvePlayerWorldCollision(adt);
      this.checkWaterAndBoat(adt);
      this.police.update(adt, this);
      this.checkJumpOverCops();
      this.autoAim = active ? this.getAutoAimTarget(WEAPONS[this.player.weapon]) : null;
      this.updateBullets(adt);
      if (active) {
        this.updatePickups(adt);
        this.updateHeat(adt);
        this.checkNearMisses(adt);
      }
      this.fx.update(adt);
      this.skids.update(adt);
      this.updateAudio(adt);
    }

    if (this.state === 'dying') {
      this.deathTimer += dt;
      if (this.deathTimer > 2.2) {
        this.state = 'over';
        this.slowMo = 0;
        this.saveBest();
        this.hud.showGameOver(this.stats());
        this.audio.setEngine(0, false, false);
        this.audio.setSiren(0);
        this.audio.setBoost(false);
      }
    }

    if (this.state === 'playing' || this.state === 'dying' || this.state === 'won') {
      this.hud.update(this);
    }
  }

  stats() {
    return {
      score: Math.floor(this.player.score),
      best: this.best,
      newBest: this.newBest,
      distance: Math.floor(this.player.distance),
      topSpeed: Math.floor(this.player.topSpeed * 3.6),
      kills: this.player.kills,
      heat: Math.min(5, Math.ceil(this.heat)),
      time: this.time,
      combo: this.player.comboPeak,
    };
  }

  // ── world / driving helpers ───────────────────────────────────────────
  resolvePlayerWorldCollision(dt) {
    const p = this.player;
    if (p.dead) return;
    p.wallCd = (p.wallCd || 0) - dt;
    let impact = 0;
    this.world.collideCircle(p, 1.9, (res) => {
      const vn = p.vx * res.nx + p.vy * res.ny;
      if (vn < 0) {
        p.vx -= res.nx * vn * 1.35;
        p.vy -= res.ny * vn * 1.35;
        impact = Math.max(impact, Math.abs(vn));
      }
    });
    if (impact > 6) {
      if (impact > 13) {
        this.addSkid(p.x, p.y, p.heading, 1);
        this.fx.sparks(p.x, p.y, 1, Math.min(14, impact / 3), '#ffcc66', 9);
        this.addShake(clamp(impact * 0.02, 0.1, 0.8));
      }
      this.audio.impact(impact / 18);
      if (impact > 20 && p.wallCd <= 0) {
        p.wallCd = 0.6;
        p.damage(clamp(impact * 0.22, 2, 12), this);
        this.hud.toast('IMPACT — WATCH THE BUILDINGS', 'warn');
      }
    }
  }

  updateAudio(dt) {
    const p = this.player;
    this.audio.setEngine(p.speed, p.boosting, !p.dead);
    this.audio.setBoost(p.boosting, p.boostIntensity);
    let nearest = 999;
    for (const c of this.police.cops) nearest = Math.min(nearest, dist(c.x, c.y, p.x, p.y));
    for (const h of this.police.helicopters) nearest = Math.min(nearest, dist(h.x, h.y, p.x, p.y));
    const intensity = nearest < 140 ? (1 - nearest / 140) * (0.65 + this.heat * 0.07) : 0;
    this.audio.setSiren(p.dead ? 0 : intensity);
  }

  updateHeat(dt) {
    this.heat = clamp(this.heat + dt * 0.0095, 0.5, 5);
    this.radioCooldown -= dt;
  }

  policeRadio(heat) {
    if (this.radioCooldown > 0) return;
    const lines = [
      'SUSPECT HEADING ' + ['NORTH', 'EAST', 'SOUTH', 'WEST'][this.frame % 4],
      'RED ROADSTER CONFIRMED — NO PLATES',
      'REQUESTING SPIKE STRIP AT NEXT INTERSECTION',
      heat > 3 ? 'ALL UNITS, SUSPECT IS HEAVILY ARMED' : 'KEEP PRESSURE ON THE SUSPECT',
      heat > 2 ? 'DRONE FEED IS LIVE, TAGGING THE VEHICLE' : 'AIR UNIT ON STANDBY',
      'CIVILIAN TRAFFIC CLEARED FROM THE GRID',
      'SUSPECT HAS A CONVENTIONAL WEAPON — STAY SPREAD',
      'THEY ARE JUMPING THE BLOCKADES. REPEAT, JUMPING.',
    ];
    let line = pick(Math.random, lines);
    if (line === this.lastRadio) line = lines[(this.frame + 3) % lines.length];
    this.lastRadio = line;
    this.hud.radio(line);
    this.radioCooldown = rand(9, 16);
  }

  radio(text) {
    this.hud.radio(text);
  }

  addShake(amount) {
    this.renderer.addShake(amount);
  }

  addSkid(x, y, heading, strength) {
    this.skids.add(x, y, heading, strength);
  }

  // ── targeting ─────────────────────────────────────────────────────────
  // Automatic weapon lock: the car's computer picks the most immediate
  // police threat in range and leads the shot. The player never aims.
  getAutoAimTarget(def = WEAPONS[this.player.weapon]) {
    const p = this.player;
    const bulletSpeed = Math.max(60, def?.speed || 150);
    const range = Math.max(34, bulletSpeed * (def?.life || 0.7) * 0.95);
    const hx = Math.cos(p.heading), hy = Math.sin(p.heading);
    let best = null;
    let bestScore = Infinity;

    const consider = (x, y, vx, vy, z, isAir, ref, kind) => {
      const d = dist(p.x, p.y, x, y);
      if (d > range) return;
      const fwd = d > 0.01 ? ((x - p.x) * hx + (y - p.y) * hy) / d : 1;
      // prefer close targets, with a mild bonus for ones in the windscreen
      const score = d * (1.18 - 0.22 * clamp(fwd, -1, 1));
      if (score >= bestScore) return;
      const lead = Math.min(0.9, d / bulletSpeed);
      bestScore = score;
      best = {
        x: x + vx * lead, y: y + vy * lead, z, isAir,
        ref, kind, lead, dist: d,
      };
    };

    for (const c of this.police.cops) {
      if (c.health <= 0) continue;
      consider(c.x, c.y, c.vx || 0, c.vy || 0,
        c.type === 'drone' ? c.z : 0.9, c.type === 'drone', c, 'cop');
    }
    for (const h of this.police.helicopters) {
      if (h.health <= 0) continue;
      consider(h.x, h.y, h.vx || 0, h.vy || 0, h.z, true, h, 'heli');
    }
    return best;
  }

  // ── bullets ───────────────────────────────────────────────────────────
  spawnBullet(b) {
    const bullet = {
      x: b.x, y: b.y, z: b.z ?? 0.9, prevX: b.x, prevY: b.y,
      vx: b.vx, vy: b.vy, life: b.life, maxLife: b.life,
      damage: b.damage, owner: b.owner, weapon: b.weapon || null,
      pierce: b.pierce || 0, splash: b.splash || 0, emp: b.emp || false,
      color: b.color || '#8ffcff', size: b.size || 0.8, angle: b.angle || 0,
      air: !!b.air, dead: false,
    };
    this.bullets.push(bullet);
    return bullet;
  }

  updateBullets(dt) {
    const p = this.player;
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.prevX = b.x;
      b.prevY = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      if (b.owner === 'player') {
        // road barriers first (flat fire only)
        if (!b.air && this.police.bulletsHitBarrier(b, this)) {
          if (b.splash) this.explodeAt(b.x, b.y, b.splash, b.damage, b);
          if (b.emp) this.empBlastAt(b.x, b.y, b.splash || 34);
          b.dead = true;
          continue;
        }
        // helicopters (only elevated fire)
        if (b.z > 12) {
          for (const h of this.police.helicopters) {
            if (segmentCircle(b.prevX, b.prevY, b.x, b.y, h.x, h.y, h.radius + 0.8)) {
              this.police.damageHeli(h, b.damage, this);
              this.fx.sparks(h.x, h.y, h.z, 5, '#ffd58a', 9);
              if (b.splash) this.explodeAt(h.x, h.y, b.splash, b.damage * 0.8);
              b.dead = true;
              break;
            }
          }
          if (b.dead) continue;
        }
        // ground cops
        if (b.z < 12 && !b.air) {
          for (const c of this.police.cops) {
            if (c.type === 'drone') continue;
            if (segmentCircle(b.prevX, b.prevY, b.x, b.y, c.x, c.y, c.radius + 0.65)) {
              if (b.splash) {
                this.explodeAt(b.x, b.y, b.splash, b.damage, b);
                b.dead = true;
              } else {
                this.police.damageCop(c, b.damage, this);
                this.fx.sparks(b.x, b.y, 1, 4, '#ffd58a', 8);
                if (b.pierce > 0) b.pierce--; else b.dead = true;
              }
              if (b.emp) this.empBlastAt(b.x, b.y, b.splash || 34);
              break;
            }
          }
        } else if (b.z > 3 && b.z < 12) {
          for (const c of this.police.cops) {
            if (c.type !== 'drone') continue;
            if (segmentCircle(b.prevX, b.prevY, b.x, b.y, c.x, c.y, c.radius + 0.9)) {
              if (b.splash) { this.explodeAt(b.x, b.y, b.splash, b.damage, b); b.dead = true; }
              else {
                this.police.damageCop(c, b.damage, this);
                this.fx.sparks(c.x, c.y, c.z, 5, '#ffd58a', 8);
                if (b.pierce > 0) b.pierce--; else b.dead = true;
              }
              break;
            }
          }
        }
      } else {
        // police fire hits the player
        if (!p.dead && p.z < 1.7 && segmentCircle(b.prevX, b.prevY, b.x, b.y, p.x, p.y, 1.75)) {
          p.damage(b.damage, this);
          this.fx.sparks(b.x, b.y, 1, 4, '#ffb066', 7);
          b.dead = true;
        }
      }

      if (!b.dead && b.life <= 0) {
        if (b.splash) this.explodeAt(b.x, b.y, b.splash, b.damage * 0.6, b);
        if (b.emp) this.empBlastAt(b.x, b.y, b.splash || 34);
        b.dead = true;
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
    if (this.bullets.length > 260) this.bullets.splice(0, this.bullets.length - 260);
  }

  explodeAt(x, y, radius, damage = 40, bullet = null) {
    this.fx.explosion(x, y, 0.8, clamp(radius / 13, 0.9, 2.2), '#ff8a3c');
    this.audio.explosion(radius > 25);
    this.addShake(clamp(radius / 30, 0.3, 1.4));
    this.fx.flash('#ffb347', 0.1);
    for (const c of [...this.police.cops]) {
      const d = dist(x, y, c.x, c.y);
      if (d < radius + c.radius) {
        const falloff = 1 - clamp(d / (radius + c.radius), 0, 0.85);
        this.police.damageCop(c, damage * falloff, this);
      }
    }
    for (const h of this.police.helicopters) {
      if (dist(x, y, h.x, h.y) < radius + h.radius) this.police.damageHeli(h, damage * 0.8, this);
    }
    for (const b of this.police.barriers) {
      if (dist(x, y, b.x, b.y) < radius + 3) {
        b.hp -= damage * 0.9;
        b.flash = 1;
      }
    }
    for (const s of this.police.spikes) {
      if (dist(x, y, s.x, s.y) < radius + 4) s.armed = false;
    }
  }

  empBlastAt(x, y, radius) {
    this.fx.empPulse(x, y, radius);
    this.audio.empBlast();
    this.addShake(0.7);
    for (const c of this.police.cops) {
      if (dist(x, y, c.x, c.y) < radius + c.radius) {
        c.stun = 3.7;
        this.police.damageCop(c, 10, this);
      }
    }
    for (const h of this.police.helicopters) {
      if (dist(x, y, h.x, h.y) < radius + h.radius) {
        this.police.damageHeli(h, 36, this);
        h.fireCd = Math.max(h.fireCd, 2.5);
      }
    }
    for (const b of this.police.barriers) {
      if (dist(x, y, b.x, b.y) < radius + 3) { b.hp -= 30; b.flash = 1; }
    }
    for (const b of this.bullets) {
      if (b.owner === 'cop' && dist(x, y, b.x, b.y) < radius) b.dead = true;
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  // ── pickups ───────────────────────────────────────────────────────────
  spawnPickup(x, y, kind, extra = {}) {
    if (this.world.isWater(x, y) || this.world.onBoat(x, y)) return null;
    if (!this.world.isClear(x, y, 2.2)) return null;
    const p = {
      id: ++this._pickupId || (this._pickupId = 1),
      x, y, kind, bob: Math.random() * 6, life: 55, dead: false,
      weapon: extra.weapon || null, angle: extra.angle || 0,
    };
    this.pickups.push(p);
    return p;
  }

  randomPickupSpot(minD = 55, maxD = 165) {
    const p = this.player;
    for (let i = 0; i < 20; i++) {
      const a = p.heading + rand(-1.1, 1.1);
      const d = rand(minD, maxD);
      const base = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
      const snap = this.world.snapToRoad(base.x, base.y);
      if (!snap.onRoad) continue;
      if (!this.world.isClear(snap.x, snap.y, 3)) continue;
      let close = false;
      for (const q of this.pickups) if (dist(q.x, q.y, snap.x, snap.y) < 14) close = true;
      if (close) continue;
      return snap;
    }
    return null;
  }

  updatePickups(dt) {
    const p = this.player;
    this.spawnTimer -= dt;
    const groundCount = this.pickups.filter((q) =>
      q.kind !== 'ramp' && q.kind !== 'boostpad' && q.kind !== 'hill' && !q.mission).length;
    if (groundCount < 8 && this.spawnTimer <= 0) {
      this.spawnTimer = rand(1.5, 3.4);
      const r = Math.random();
      let kind = 'chip';
      if (r < 0.3) kind = 'weapon';
      else if (r < 0.52) kind = 'turbo';
      else if (r < 0.66) kind = 'repair';
      else if (r < 0.75) kind = 'shield';
      else if (r < 0.84) kind = 'boostpad';
      else if (r < 0.9) kind = 'ramp';
      const spot = this.randomPickupSpot(kind === 'ramp' || kind === 'boostpad' ? 80 : 45, 170);
      if (spot && !this.world.isWater(spot.x, spot.y) && !this.world.onBoat(spot.x, spot.y)) {
        let weapon = null;
        if (kind === 'weapon') {
          const missing = WEAPON_ORDER.filter((id) => !(p.owned[id] > 0));
          weapon = missing.length && Math.random() < 0.6 ? pick(Math.random, missing) : pick(Math.random, WEAPON_ORDER);
        }
        const angle = Math.abs(Math.cos(p.heading)) > Math.abs(Math.sin(p.heading)) ? (Math.cos(p.heading) >= 0 ? 0 : Math.PI) : (Math.sin(p.heading) >= 0 ? Math.PI / 2 : -Math.PI / 2);
        this.spawnPickup(spot.x, spot.y, kind, { weapon, angle });
      }
    }

    for (const q of this.pickups) {
      if (q.dead) continue;
      q.bob += dt * 2.4;
      q.life -= dt;
      const d = dist(p.x, p.y, q.x, q.y);
      q.cd = Math.max(0, (q.cd || 0) - dt);
      if (q.kind === 'hill') {
        // cresting a hill at speed throws the car without spending turbo
        if (!q.mission && q.life <= 0) q.dead = true;
        if (q.cd <= 0 && !p.airborne && p.z < 0.6 &&
            Math.abs(p.x - q.x) < 4.6 && Math.abs(p.y - q.y) < 9.5 && p.speed > 18) {
          q.cd = 3.2;
          p.z = 0.3;
          p.vz = 10.5 + clamp(p.speed * 0.075, 0, 6.5);
          p.airborne = true;
          p.airTime = 0;
          p.flipAngle = 0;
          p.flipDone = false;
          p.bumpCombo(this, 1);
          this.fx.jumpJet(p.x, p.y, p.heading);
          this.fx.ring(p.x, p.y, 5, '#7dffc0');
          this.audio.jump();
          this.addShake(0.7);
          this.hud.toast('HILL LAUNCH — CLEAR THE BLOCKADE', 'good');
        }
        continue;
      }
      if (q.kind === 'ramp' || q.kind === 'boostpad') {
        const inX = Math.abs(p.x - q.x) < 3.4;
        const inY = Math.abs(p.y - q.y) < 5.2;
        const angleOk = q.kind === 'boostpad'
          ? (Math.cos(q.angle) * Math.cos(p.heading) + Math.sin(q.angle) * Math.sin(p.heading)) > 0.1
          : true;
        if (inX && inY && p.z < 0.4 && angleOk && q.cd <= 0) {
          if (q.mission) q.cd = 2.8;
          else q.dead = true;
          if (q.kind === 'boostpad') {
            p.vx += Math.cos(q.angle) * 16;
            p.vy += Math.sin(q.angle) * 16;
            p.addTurbo(16);
            p.bumpCombo(this, 1);
            this.fx.ring(p.x, p.y, 5, '#5ffbf1');
            this.fx.floatText(p.x, p.y, 2.5, 'TURBO CELL', '#5ffbf1');
            this.audio.pickup('turbo');
          } else {
            p.z = 0.15;
            p.vz = q.final ? 14.6 : 13.2;
            p.airborne = true;
            p.airTime = 0;
            p.flipAngle = 0;
            p.flipDone = false;
            p.bumpCombo(this, 1);
            this.fx.jumpJet(p.x, p.y, p.heading);
            this.audio.jump();
            this.addShake(0.8);
            if (q.final) {
              this.escapeArmed = true;
              this.triggerSlowMo(1.25, 'FINAL JUMP', 'HIT THE BOAT DECK');
              this.hud.toast('BOAT JUMP — DO NOT LIFT OFF THE THROTTLE', 'warn');
              this.fx.ring(p.x, p.y, 7, '#5ffbf1');
            } else {
              this.hud.toast('RAMP — FULL SEND', 'good');
            }
          }
        }
        if (!q.mission && q.life <= 0) q.dead = true;
        continue;
      }
      if (d < 4.2 && p.z < 2.2) {
        this.collectPickup(q);
      }
      if (q.life <= 0) q.dead = true;
    }
    this.pickups = this.pickups.filter((q) => !q.dead && (q.mission || dist(q.x, q.y, p.x, p.y) < 260));
  }

  collectPickup(q) {
    const p = this.player;
    q.dead = true;
    this.fx.ring(q.x, q.y, 5, '#bffcff');
    this.fx.sparks(q.x, q.y, 1.4, 10, '#8ffcff', 8);
    switch (q.kind) {
      case 'weapon': {
        const id = q.weapon || pick(Math.random, WEAPON_ORDER);
        const def = WEAPONS[id];
        const already = (p.owned[id] || 0) > 0;
        p.addWeapon(id, already ? Math.round(def.ammo * 0.55) : def.ammo, this);
        this.hud.toast(`${def.name} ACQUIRED`, 'weapon');
        this.hud.setWeapon(p);
        break;
      }
      case 'turbo':
        p.addTurbo(34);
        this.fx.floatText(p.x, p.y, 3, '+TURBO', '#5ffbf1');
        this.hud.toast('TURBO RESERVOIR +34', 'good');
        break;
      case 'repair':
        p.repair(30);
        this.fx.floatText(p.x, p.y, 3, '+30 INTEGRITY', '#7dffc0');
        this.hud.toast('CHASSIS REPAIRED', 'good');
        break;
      case 'shield':
        p.addShield(30);
        this.fx.floatText(p.x, p.y, 3, '+SHIELD', '#5ffbf1');
        this.hud.toast('POLYMER SHIELD ONLINE', 'good');
        break;
      case 'chip':
        p.bumpCombo(this, 1);
        p.addTurbo(6);
        this.addScore(120, 'DATA CHIP');
        this.fx.floatText(p.x, p.y, 3, 'DATA +120', '#ffd58a');
        break;
      default:
        break;
    }
    this.audio.pickup(q.kind);
    this.hud.setWeapon(p);
  }

  dropLoot(x, y) {
    if (Math.random() > 0.55) return;
    const r = Math.random();
    if (r < 0.38) {
      const missing = WEAPON_ORDER.filter((id) => !(this.player.owned[id] > 0));
      const weapon = missing.length ? pick(Math.random, missing) : pick(Math.random, WEAPON_ORDER);
      this.spawnPickup(x, y, 'weapon', { weapon });
    } else if (r < 0.62) this.spawnPickup(x, y, 'repair');
    else if (r < 0.84) this.spawnPickup(x, y, 'turbo');
    else this.spawnPickup(x, y, 'chip');
  }

  // ── scoring & events ──────────────────────────────────────────────────
  addScore(base, label) {
    return this.player.addScore(base, this, label);
  }

  checkNearMisses(dt) {
    const p = this.player;
    if (p.speed < 20) return;
    for (const c of this.police.cops) {
      c.nearCd = Math.max(0, (c.nearCd || 0) - dt);
      const d = dist(p.x, p.y, c.x, c.y);
      if (d < 7.5 && c.nearCd <= 0) {
        c.nearCd = 2.5;
        p.bumpCombo(this, 1);
        p.addTurbo(3);
        this.addScore(25, 'NEAR MISS');
      }
    }
  }

  onCopDestroyed(cop) {
    const def = COP[cop.type];
    this.player.kills++;
    this.heat = clamp(this.heat + (cop.type === 'heavy' ? 0.24 : 0.15), 0.5, 5);
    this.player.bumpCombo(this, 1);
    this.player.addScore(def.score, this, 'COP DOWN');
    this.dropLoot(cop.x, cop.y);
    this.hud.killFeed(def.name);
    if (Math.random() < 0.35) this.hud.toast(`${def.name} NEUTRALIZED`, 'good');
  }

  onHeliDestroyed(heli) {
    this.player.kills++;
    this.heat = clamp(this.heat + 0.4, 0.5, 5);
    this.addScore(650, 'AIR UNIT');
    this.player.bumpCombo(this, 3);
    this.hud.alert('AIR UNIT DOWN', '+650 // HEAT RISING');
    this.fx.jumpJet(heli.x, heli.y, 0);
    this.dropLoot(heli.x, heli.y);
    this.hud.killFeed('AIR UNIT');
  }

  onPlayerWrecked(source) {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.deathTimer = 0;
    this.fx.explosion(this.player.x, this.player.y, 0.8, 2.2, '#ff7a3c');
    this.fx.explosion(this.player.x, this.player.y, 1.2, 1.4, '#5ffbf1');
    this.fx.flash('#ffffff', 0.5, 0.4);
    this.audio.explosion(true);
    this.addShake(2.2);
    this.audio.setEngine(0, false, false);
    this.audio.setSiren(0.3);
    this.audio.setBoost(false);
    this.hud.alert('CHASSIS CRITICAL', 'SIGNAL LOST');
  }

  // ── debug/test helpers ────────────────────────────────────────────────
  debugSpawnCop(type = 'interceptor') {
    this.police.spawnCop(this, type);
  }
  debugGrantAll() {
    for (const id of WEAPON_ORDER) this.player.addWeapon(id, WEAPONS[id].ammo * 2, this);
    this.player.addShield(60);
    this.player.repair(100);
    this.player.addTurbo(100);
  }
}
