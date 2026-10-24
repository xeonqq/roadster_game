import { PLAYER, TURBO_MAX, JUMP_COST, BOOST_DRAIN, BOOST_MIN, EXHAUST, WEAPONS, WEAPON_ORDER } from './config.js';
import { clamp, damp, dist, lerp, TAU } from './utils.js';

export class Player {
  constructor() {
    this.reset(0, -2);
  }

  reset(x = 0, y = -2) {
    this.x = x;
    this.y = y;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.heading = 0;
    this.angularVel = 0;

    this.health = PLAYER.maxHealth;
    this.maxHealth = PLAYER.maxHealth;
    this.shield = 0;
    this.turbo = 65;
    this.maxTurbo = TURBO_MAX;

    this.airborne = false;
    this.boosting = false;
    this.boostIntensity = 0;
    this.drifting = false;
    this.driftAmount = 0;
    this.handbraking = false;
    this.jumpCooldown = 0;
    this.landTimer = 0;
    this.tireTimer = 0;
    this.hitFlash = 0;
    this.invuln = 0;

    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.steer = 0;
    this.speed = 0;
    this.slipAngle = 0;
    this.topSpeed = 0;
    this.distance = 0;
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.comboPeak = 0;
    this.airTime = 0;
    this.flipAngle = 0;
    this.flipDone = false;

    this.weapon = 'smg';
    this.owned = { smg: 45 };
    this.fireCooldown = 0;
    this.muzzleFlash = 0;
    this.recoil = 0;
    this.wheelAngle = 0;

    this.dead = false;
    this.deathTimer = 0;
    this.engineHeat = 0;
    this.exhaustAcc = 0;
    this.gasIntensity = 0;
  }

  get speedKmh() { return Math.abs(this.forwardSpeed) * 3.6; }

  hasWeapon(id) { return (this.owned[id] || 0) > 0; }

  switchWeapon(dir = 1) {
    const available = WEAPON_ORDER.filter((id) => (this.owned[id] || 0) > 0);
    if (!available.length) return false;
    let idx = available.indexOf(this.weapon);
    if (idx < 0) idx = 0;
    idx = (idx + dir + available.length) % available.length;
    this.weapon = available[idx];
    return true;
  }

  selectWeapon(id) {
    if ((this.owned[id] || 0) > 0) { this.weapon = id; return true; }
    return false;
  }

  addWeapon(id, ammoBonus = 0, game = null) {
    const def = WEAPONS[id];
    if (!def) return;
    const cur = this.owned[id] || 0;
    const add = ammoBonus || def.ammo;
    this.owned[id] = Math.min(cur + add, def.ammo * 3);
    this.weapon = id;
    if (game) {
      game.fx.floatText(this.x, this.y, 3.2, `${def.name} +${add}`, def.color);
    }
  }

  refillAmmo(id, amount) {
    if ((this.owned[id] || 0) <= 0) return false;
    this.owned[id] = Math.min(this.owned[id] + amount, WEAPONS[id].ammo * 3);
    return true;
  }

  addTurbo(amount) {
    this.turbo = clamp(this.turbo + amount, 0, this.maxTurbo);
  }

  addShield(amount) {
    this.shield = clamp(this.shield + amount, 0, 60);
  }

  repair(amount) {
    this.health = clamp(this.health + amount, 0, this.maxHealth);
  }

  bumpCombo(game, n = 1) {
    this.combo = clamp(this.combo + n, 0, 99);
    this.comboTimer = 4.2;
    this.comboPeak = Math.max(this.comboPeak, this.combo);
  }

  get multiplier() {
    return 1 + Math.min(9, this.combo * 0.15);
  }

  addScore(base, game, label = null) {
    const pts = Math.round(base * this.multiplier);
    this.score += pts;
    if (label && game) game.fx.floatText(this.x, this.y, 3.4, `+${pts} ${label}`, '#8ffcff');
    return pts;
  }

  damage(amount, game, source = null) {
    if (this.dead || this.invuln > 0) return;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
      if (game) {
        game.fx.ring(this.x, this.y, 2.5, '#5ffbf1');
        game.addShake(0.3);
      }
    }
    if (amount <= 0) {
      this.invuln = 0.25;
      return;
    }
    this.health -= amount;
    this.invuln = 0.18;
    this.hitFlash = 1;
    this.combo = Math.max(0, this.combo - 2);
    if (game) {
      game.addShake(clamp(amount * 0.08, 0.2, 1.6));
      game.fx.sparks(this.x, this.y, 1, 6, '#ffb347', 8);
      game.audio.impact(amount / 8);
      game.hud.flashDamage();
    }
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathTimer = 0;
      if (game) game.onPlayerWrecked(source);
    }
  }

  applySpikeStrip(game) {
    if (this.tireTimer > 0) return;
    this.tireTimer = 3.6;
    this.damage(7, game);
    if (game) {
      game.hud.toast('TIRES SHREDDED — TRACTION LOST', 'danger');
      game.fx.sparks(this.x, this.y, 0.5, 18, '#ffd58a', 12);
      game.audio.impact(2);
    }
  }

  update(dt, input, game) {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.invuln = Math.max(0, this.invuln - dt);
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 12);
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.tireTimer = Math.max(0, this.tireTimer - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);

    if (this.dead) {
      this.deathTimer += dt;
      this.gasIntensity = 0;
      this.vx *= Math.exp(-2.2 * dt);
      this.vy *= Math.exp(-2.2 * dt);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      return;
    }

    const throttle = input.isDown('forward') ? 1 : 0;
    const brake = input.isDown('back') ? 1 : 0;
    const steerTarget = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    // smooth digital steering so taps don't snap the car sideways
    this.steer = damp(this.steer, steerTarget, 14, dt);
    const steer = this.steer;
    const handbrake = input.isDown('handbrake');
    this.handbraking = handbrake;

    // ── turbo abilities ────────────────────────────────────────────────
    if (input.wasPressed('jump') && !this.airborne && this.jumpCooldown <= 0 && this.turbo >= JUMP_COST) {
      this.z = 0.05;
      this.vz = PLAYER.jumpVel;
      this.airborne = true;
      this.airTime = 0;
      this.jumpCooldown = 0.45;
      this.turbo -= JUMP_COST;
      this.landTimer = 0;
      this.flipAngle = 0;
      this.flipDone = false;
      if (game) {
        game.fx.jumpJet(this.x, this.y, this.heading);
        game.fx.ring(this.x, this.y, 5, '#8ffcff');
        game.addShake(0.7);
        game.audio.jump();
        this.bumpCombo(game, 1);
        if (this.combo > 2) game.hud.toast('AIRBORNE — WEAPONS HOT', 'good');
      }
    }

    const wantsBoost = input.isDown('boost');
    this.boosting = wantsBoost && this.turbo > BOOST_MIN && this.forwardSpeed > -2;
    if (this.boosting) {
      this.turbo = Math.max(0, this.turbo - BOOST_DRAIN * dt);
      this.boostIntensity = damp(this.boostIntensity, 1, 8, dt);
    } else {
      this.boostIntensity = damp(this.boostIntensity, 0, 5, dt);
    }

    // ── steering ──────────────────────────────────────────────────────
    const speed = Math.hypot(this.vx, this.vy);
    const dirSign = this.forwardSpeed < -0.5 ? -1 : 1;
    const gripBase = this.airborne ? 0 : (this.tireTimer > 0 ? 2.0 : PLAYER.grip);
    let grip = gripBase;
    const steerSpeedFactor = clamp(speed / 11, 0, 1) * (1 - clamp(speed / 145, 0, 0.35));
    let turnRate = PLAYER.steerRate * steerSpeedFactor * (this.airborne ? 0.45 : 1);
    if (handbrake && !this.airborne) { grip = PLAYER.handbrakeGrip; turnRate *= 1.15; }
    if (this.boosting) turnRate *= 0.92;

    // gentle natural drift when cornering at speed (handbrake gives the big slides)
    const cornering = Math.abs(steer) * clamp(speed / 55, 0, 1);
    if (!this.airborne && !handbrake) grip = lerp(grip, PLAYER.driftGrip, cornering * 0.4);

    this.heading += steer * turnRate * dt * dirSign;
    if (this.heading > Math.PI) this.heading -= TAU;
    if (this.heading < -Math.PI) this.heading += TAU;

    const fx = Math.cos(this.heading);
    const fy = Math.sin(this.heading);
    const rx = -fy;
    const ry = fx;

    // project velocity on the new axes → this is what produces slip
    let fs = this.vx * fx + this.vy * fy;
    let ls = this.vx * rx + this.vy * ry;

    // ── longitudinal forces ───────────────────────────────────────────
    const maxSpeed = this.boosting ? PLAYER.boostSpeed : PLAYER.maxSpeed;
    if (!this.airborne) {
      if (throttle) {
        const falloff = clamp(1 - fs / maxSpeed, 0, 1);
        fs += PLAYER.accel * falloff * dt * (this.boosting ? 1.4 : 1);
      }
      if (brake) {
        if (fs > 0.5) fs -= PLAYER.brake * dt;
        else fs -= PLAYER.reverseAccel * dt * (1 - clamp(-fs / 18, 0, 1));
      }
      if (this.boosting) {
        fs += PLAYER.boostAccel * clamp(1 - fs / PLAYER.boostSpeed, 0, 1) * dt;
      }
      if (handbrake) fs -= 11 * dt * Math.sign(fs);
      // rolling drag
      fs *= Math.exp(-PLAYER.drag * dt);
      if (!throttle && !brake) fs *= Math.exp(-PLAYER.rollDrag * 0.35 * dt);
      fs = clamp(fs, -20, PLAYER.boostSpeed + 4);
    } else {
      // slight air drag + limited air steering retention
      fs *= Math.exp(-0.06 * dt);
      if (this.boosting) fs += PLAYER.boostAccel * 0.35 * dt;
      fs = clamp(fs, -20, PLAYER.boostSpeed + 10);
    }

    // lateral grip
    ls *= Math.exp(-grip * dt);

    this.vx = fx * fs + rx * ls;
    this.vy = fy * fs + ry * ls;
    this.forwardSpeed = fs;
    this.lateralSpeed = ls;
    this.speed = Math.hypot(this.vx, this.vy);
    this.slipAngle = Math.atan2(ls, Math.abs(fs) + 0.01);
    this.driftAmount = clamp(Math.abs(ls) / 16, 0, 1);
    this.drifting = !this.airborne && this.speed > 12 && Math.abs(ls) > 4;
    this.topSpeed = Math.max(this.topSpeed, this.speed);

    if (this.speed > 0.1) {
      this.distance += this.speed * dt;
      this.addTurbo(this.speed * dt * 0.026);
      this.score += this.speed * dt * 0.32 * this.multiplier;
    }
    if (this.drifting) {
      this.addTurbo(11 * dt);
      if (game && Math.random() < dt * 8) {
        game.fx.tireSmoke(this.x - fx * 1.4, this.y - fy * 1.4, this.heading, 1);
      }
      if (game && Math.random() < dt * 3.5) {
        game.fx.sparks(this.x - fx * 1.5, this.y - fy * 1.5, 0.3, 1, '#ffb347', 4);
      }
      if (game && Math.random() < dt * 2) game.addSkid(this.x, this.y, this.heading, 0.7);
    } else if (game && this.speed > 28 && Math.random() < dt * 1.2) {
      game.addSkid(this.x, this.y, this.heading, 0.2);
    }

    // ── exhaust gas: throttle billows, boost and mid-flip billow hard ──
    // gasIntensity doubles as the shove strength the police read each frame
    const flipping = this.airborne && this.flipAngle > 0.01 && this.flipAngle < TAU;
    this.gasIntensity = this.boosting ? 1 : flipping ? EXHAUST.flipGas : throttle ? EXHAUST.throttleGas : 0;
    if (game) {
      const gasRate = this.boosting ? EXHAUST.boostRate : flipping ? EXHAUST.flipRate : throttle ? EXHAUST.rate : 0;
      if (gasRate > 0) {
        this.exhaustAcc += gasRate * dt;
        while (this.exhaustAcc >= 1) {
          this.exhaustAcc -= 1;
          const side = Math.random() < 0.5 ? -1 : 1;
          game.fx.exhaust(
            this.x - fx * 2.6 + rx * 0.55 * side,
            this.y - fy * 2.6 + ry * 0.55 * side,
            this.heading,
            this.boosting ? 1.6 : flipping ? 1.2 : 0.5,
          );
        }
      }
    }

    // combo timer
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 0; if (game) game.hud.setCombo(0, 0); }
    }

    // ── vertical / jump arc ───────────────────────────────────────────
    if (this.airborne) {
      this.z += this.vz * dt;
      this.vz -= PLAYER.gravity * dt;
      this.airTime += dt;
      // full 360 body flip during the hang time
      if (this.flipAngle < TAU) {
        this.flipAngle = Math.min(TAU, this.flipAngle + (TAU / 0.72) * dt);
        if (this.flipAngle >= TAU) this.flipDone = true;
      }
      if (this.z <= 0) {
        const impact = Math.abs(this.vz);
        this.z = 0;
        this.airborne = false;
        this.vz = 0;
        this.landTimer = 0.25;
        if (game) {
          game.fx.landDust(this.x, this.y, impact);
          game.addShake(clamp(impact * 0.05, 0.15, 0.9));
          game.audio.land();
          if (this.flipDone) {
            this.bumpCombo(game, 1);
            this.addScore(240, game, '360 FLIP');
            this.addTurbo(10);
            game.hud.toast('360 FLIP — CLEAN LANDING +TURBO', 'good');
          }
          if (this.airTime > 0.7) {
            this.bumpCombo(game, 2);
            if (!this.flipDone) {
              this.addScore(60 + this.airTime * 80, game, 'AIRTIME');
              game.hud.toast(`AIR TIME ${this.airTime.toFixed(1)}s — +TURBO`, 'good');
            }
            this.addTurbo(8 + this.airTime * 4);
          }
        }
        this.flipAngle = 0;
        this.flipDone = false;
        this.airTime = 0;
      }
    }

    // ── integrate motion ──────────────────────────────────────────────
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.engineHeat = damp(this.engineHeat, this.boosting ? 1 : throttle ? 0.55 : 0.15, 2, dt);

    // ── weapons ───────────────────────────────────────────────────────
    if (input.switchPressed()) {
      if (this.switchWeapon(input.mouse.wheel > 0 ? 1 : -1)) {
        if (game) { game.audio.ui(); game.hud.setWeapon(this); }
      }
    }
    if (input.mouseDown() && !game?.paused) {
      this.tryFire(game);
    }
    this.wheelAngle += this.forwardSpeed * dt * 0.6;
  }

  tryFire(game) {
    if (!game || this.fireCooldown > 0) return;
    const def = WEAPONS[this.weapon];
    const ammo = this.owned[this.weapon] || 0;
    if (!def) return;
    if (ammo <= 0) {
      this.fireCooldown = 0.35;
      this.switchWeapon(1);
      game.audio.ui();
      game.hud.toast('OUT OF AMMO — SWITCH WEAPON', 'warn');
      return;
    }
    this.fireCooldown = 1 / def.rate;
    this.owned[this.weapon] = ammo - 1;

    // fire-control computer picks and leads the target; no player aiming
    const target = game.getAutoAimTarget(def);
    if (!target) {
      this.owned[this.weapon] = ammo;
      this.fireCooldown = 0.12;
      return;
    }
    this.muzzleFlash = 1;
    this.recoil = 1;

    const aimAngle = Math.atan2(target.y - this.y, target.x - this.x);
    const sx = this.x + Math.cos(aimAngle) * 1.9;
    const sy = this.y + Math.sin(aimAngle) * 1.9;
    const angle = Math.atan2(target.y - sy, target.x - sx);
    const count = def.pellets || 1;
    const shotZ = target.isAir ? target.z : this.z + 0.9;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() * 2 - 1) * def.spread;
      const a = angle + spread;
      const sp = def.speed * (0.94 + Math.random() * 0.12);
      game.spawnBullet({
        x: sx, y: sy, z: shotZ,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: target.isAir ? Math.max(def.life, 1.15) : def.life,
        damage: def.damage, owner: 'player',
        weapon: def, pierce: def.pierce || 0, splash: def.splash || 0,
        emp: !!def.emp, color: def.color, size: def.id === 'rocket' ? 1.5 : def.id === 'rail' ? 0.9 : 0.7,
        angle: a, air: !!target.isAir,
      });
    }
    // muzzle particles + light
    game.fx.muzzle(sx, sy, this.z + 0.9, angle, def.color);
    game.addShake(this.weapon === 'shotgun' ? 0.5 : this.weapon === 'rocket' ? 0.45 : 0.14);
    game.audio.gun(def.sound);
    game.hud.setWeapon(this);
    // small felt recoil
    this.vx -= Math.cos(angle) * (def.id === 'shotgun' ? 2.5 : def.id === 'rocket' ? 1.6 : 0.25);
    this.vy -= Math.sin(angle) * (def.id === 'shotgun' ? 2.5 : def.id === 'rocket' ? 1.6 : 0.25);
  }
}
