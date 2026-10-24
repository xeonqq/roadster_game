const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  boost: ['ShiftLeft', 'ShiftRight'],
  handbrake: ['KeyK', 'ControlLeft'],
  fire: ['KeyJ'],
  switchWeapon: ['KeyQ', 'Tab'],
  mute: ['KeyM'],
  pause: ['Escape', 'KeyP'],
  start: ['Enter'],
  restart: ['KeyR'],
  horn: ['KeyH'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, down: false, justDown: false, justUp: false, wheel: 0 };
    this.anyKeyPressed = false;
    // set by the touch layer: phones drive with an always-on throttle + brake button
    this.autoThrottle = false;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.anyKeyPressed = true;
      if (e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouse.down = false;
    });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouse.down = true;
        this.mouse.justDown = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouse.down = false;
        this.mouse.justUp = true;
      }
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: true });
  }

  isDown(action) {
    const codes = BINDINGS[action];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  // on-screen touch buttons inject the same key codes the bindings already use,
  // so gameplay code never has to know the difference
  setVirtual(code, active) {
    if (active) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
      this.anyKeyPressed = true;
    } else {
      if (this.down.has(code)) this.released.add(code);
      this.down.delete(code);
    }
  }

  wasPressed(action) {
    const codes = BINDINGS[action];
    if (!codes) return false;
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  mouseDown() { return this.mouse.down || this.isDown('fire'); }

  switchPressed() {
    return this.wasPressed('switchWeapon') || this.mouse.wheel !== 0;
  }

  // clears one-shot (edge) input without dropping held keys
  consumeEdges() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.justDown = false;
    this.mouse.justUp = false;
    this.mouse.wheel = 0;
    this.anyKeyPressed = false;
  }

  endFrame() {
    this.consumeEdges();
  }
}
