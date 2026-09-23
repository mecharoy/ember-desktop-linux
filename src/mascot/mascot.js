/* Elytra mascot — v1.0. Pair with elytra-mascot.css. No dependencies.
   Usage:  const m = ElytraMascot.mount(el);  m.set('listening');  m.once('saving');
   Or:     <elytra-beetle state="idle" style="width:72px"></elytra-beetle>
   Or:     ElytraMascot.bindEditor(m, textareaEl)  — listening / thinking / sleeping from typing. */
/* Vendored from elytra-package/mascot-kit, UMD wrapper swapped for ESM.
   Do not edit by hand: re-vendor from the kit and re-apply this header. */
const ElytraMascot = (function () {
  'use strict';
  const STATES = ['idle','listening','thinking','saving','flying','loading','celebrate','sleeping'];
  // how long one cycle of the one-shot states lasts, in ms (matches the CSS keyframes)
  const CYCLE = { saving: 2800, celebrate: 3200 };
  let uid = 0;

  function template() {
    const g = 'ely' + (++uid);
    return "<svg viewBox=\"0 0 200 240\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\">\n  <defs>\n    <linearGradient id=\"" + g + "\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\n      <stop offset=\"0\" stop-color=\"var(--b-moss,#6E9C6C)\"/><stop offset=\"1\" stop-color=\"var(--b-forest,#3D5A3A)\"/>\n    </linearGradient>\n  </defs>\n  <g class=\"b-root\">\n    <g class=\"b-fx\">\n      <circle class=\"b-ring\" cx=\"100\" cy=\"156\" r=\"72\" fill=\"none\" stroke=\"var(--b-moss,#6E9C6C)\" stroke-width=\"2\"/>\n      <g class=\"b-burst\" stroke=\"var(--b-moss,#6E9C6C)\" stroke-width=\"2.6\" stroke-linecap=\"round\">\n        <line x1=\"100\" y1=\"84\" x2=\"100\" y2=\"68\"/><line x1=\"160\" y1=\"116\" x2=\"174\" y2=\"108\"/><line x1=\"160\" y1=\"196\" x2=\"174\" y2=\"204\"/>\n        <line x1=\"100\" y1=\"228\" x2=\"100\" y2=\"240\"/><line x1=\"40\" y1=\"196\" x2=\"26\" y2=\"204\"/><line x1=\"40\" y1=\"116\" x2=\"26\" y2=\"108\"/>\n      </g>\n      <text class=\"b-z\" x=\"128\" y=\"46\" font-size=\"18\" fill=\"var(--b-body)\">z</text>\n      <text class=\"b-z\" x=\"137\" y=\"37\" font-size=\"13\" fill=\"var(--b-body)\">z</text>\n      <g class=\"b-dots\" fill=\"var(--b-body)\">\n        <circle class=\"b-dot\" cx=\"132\" cy=\"48\" r=\"2.2\"/><circle class=\"b-dot\" cx=\"141\" cy=\"39\" r=\"2.8\"/><circle class=\"b-dot\" cx=\"152\" cy=\"29\" r=\"3.4\"/>\n      </g>\n    </g>\n    <g class=\"b-body\">\n      <g class=\"b-legs\" fill=\"none\" stroke=\"var(--b-body)\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n        <g class=\"b-leg b-leg-lf\">\n          <path class=\"b-femur\" d=\"M72 104 L52 88\"/><path class=\"b-tibia\" d=\"M52 88 L40 100\"/>\n          <path class=\"b-tarsus\" d=\"M40 100 C38 106,36 110,32 112\"/><path class=\"b-claw\" d=\"M32 112 L29 108\"/>\n          <circle class=\"b-joint b-body-fill\" cx=\"52\" cy=\"88\" r=\"2.6\" fill=\"var(--b-body)\" stroke=\"none\"/>\n        </g>\n        <g class=\"b-leg b-leg-lm\">\n          <path class=\"b-femur\" d=\"M62 138 L36 134\"/><path class=\"b-tibia\" d=\"M36 134 L26 148\"/>\n          <path class=\"b-tarsus\" d=\"M26 148 C25 154,24 158,20 162\"/><path class=\"b-claw\" d=\"M20 162 L17 159\"/>\n          <circle class=\"b-joint b-body-fill\" cx=\"36\" cy=\"134\" r=\"2.6\" fill=\"var(--b-body)\" stroke=\"none\"/>\n        </g>\n        <g class=\"b-leg b-leg-lh\">\n          <path class=\"b-femur\" d=\"M68 174 L44 190\"/><path class=\"b-tibia\" d=\"M44 190 L46 208\"/>\n          <path class=\"b-tarsus\" d=\"M46 208 C48 214,50 218,54 222\"/><path class=\"b-claw\" d=\"M54 222 L57 219\"/>\n          <circle class=\"b-joint b-body-fill\" cx=\"44\" cy=\"190\" r=\"2.6\" fill=\"var(--b-body)\" stroke=\"none\"/>\n        </g>\n        <g class=\"b-leg b-leg-rf\">\n          <path class=\"b-femur\" d=\"M128 104 L148 88\"/><path class=\"b-tibia\" d=\"M148 88 L160 100\"/>\n          <path class=\"b-tarsus\" d=\"M160 100 C162 106,164 110,168 112\"/><path class=\"b-claw\" d=\"M168 112 L171 108\"/>\n          <circle class=\"b-joint b-body-fill\" cx=\"148\" cy=\"88\" r=\"2.6\" fill=\"var(--b-body)\" stroke=\"none\"/>\n        </g>\n        <g class=\"b-leg b-leg-rm\">\n          <path class=\"b-femur\" d=\"M138 138 L164 134\"/><path class=\"b-tibia\" d=\"M164 134 L174 148\"/>\n          <path class=\"b-tarsus\" d=\"M174 148 C175 154,176 158,180 162\"/><path class=\"b-claw\" d=\"M180 162 L183 159\"/>\n          <circle class=\"b-joint b-body-fill\" cx=\"164\" cy=\"134\" r=\"2.6\" fill=\"var(--b-body)\" stroke=\"none\"/>\n        </g>\n        <g class=\"b-leg b-leg-rh\">\n          <path class=\"b-femur\" d=\"M132 174 L156 190\"/><path class=\"b-tibia\" d=\"M156 190 L154 208\"/>\n          <path class=\"b-tarsus\" d=\"M154 208 C152 214,150 218,146 222\"/><path class=\"b-claw\" d=\"M146 222 L143 219\"/>\n          <circle class=\"b-joint b-body-fill\" cx=\"156\" cy=\"190\" r=\"2.6\" fill=\"var(--b-body)\" stroke=\"none\"/>\n        </g>\n      </g>\n      <path class=\"b-body-fill\" d=\"M70 98 C50 126,54 190,100 216 C146 190,150 126,130 98 Z\" fill=\"var(--b-body)\"/>\n      <g fill=\"none\" stroke=\"var(--b-eye)\" stroke-opacity=\".22\" stroke-width=\"1.3\">\n        <path d=\"M64 136 Q100 144 136 136\"/><path d=\"M64 162 Q100 170 136 162\"/><path d=\"M74 188 Q100 196 126 188\"/>\n      </g>\n      <g class=\"b-wing b-wing-l\"><g class=\"b-wing-in\">\n        <path d=\"M100 100 C64 100,22 128,14 196 C38 204,82 178,100 132 Z\" fill=\"var(--b-wing)\" fill-opacity=\".8\"/>\n        <path d=\"M100 104 C68 116,38 154,22 190\" fill=\"none\" stroke=\"var(--b-body)\" stroke-opacity=\".25\" stroke-width=\"1\"/>\n      </g></g>\n      <g class=\"b-wing b-wing-r\"><g class=\"b-wing-in\">\n        <path d=\"M100 100 C136 100,178 128,186 196 C162 204,118 178,100 132 Z\" fill=\"var(--b-wing)\" fill-opacity=\".8\"/>\n        <path d=\"M100 104 C132 116,162 154,178 190\" fill=\"none\" stroke=\"var(--b-body)\" stroke-opacity=\".25\" stroke-width=\"1\"/>\n      </g></g>\n      <g class=\"b-ely b-ely-l\"><g class=\"b-ely-in\">\n        <path class=\"b-ely-fill\" d=\"M100 97 C90 96,78 96,66 98 C44 124,50 186,100 220 Z\" fill=\"url(#" + g + ")\"/>\n        <path class=\"b-stria\" d=\"M84 101 C70 132,74 182,97 212\" fill=\"none\" stroke=\"#1D221D\" stroke-opacity=\".14\" stroke-width=\"1.3\"/>\n        <path class=\"b-gloss\" d=\"M70 106 C54 132,58 178,92 210\" fill=\"none\" stroke=\"var(--b-gloss)\" stroke-opacity=\".45\" stroke-width=\"1.8\" stroke-linecap=\"round\"/>\n        <line class=\"b-seam\" x1=\"100\" y1=\"97\" x2=\"100\" y2=\"220\" stroke=\"var(--b-body)\" stroke-width=\"1.5\"/>\n      </g></g>\n      <g class=\"b-ely b-ely-r\"><g class=\"b-ely-in\">\n        <path class=\"b-ely-fill\" d=\"M100 97 C110 96,122 96,134 98 C156 124,150 186,100 220 Z\" fill=\"url(#" + g + ")\"/>\n        <path class=\"b-stria\" d=\"M116 101 C130 132,126 182,103 212\" fill=\"none\" stroke=\"#1D221D\" stroke-opacity=\".14\" stroke-width=\"1.3\"/>\n        <path class=\"b-gloss\" d=\"M130 106 C146 132,142 178,108 210\" fill=\"none\" stroke=\"var(--b-gloss)\" stroke-opacity=\".45\" stroke-width=\"1.8\" stroke-linecap=\"round\"/>\n        <line class=\"b-seam\" x1=\"100\" y1=\"97\" x2=\"100\" y2=\"220\" stroke=\"var(--b-body)\" stroke-width=\"1.5\"/>\n      </g></g>\n      <path class=\"b-body-fill\" d=\"M80 72 C88 65,112 65,120 72 C128 80,134 90,134 96 C112 103,88 103,66 96 C66 90,72 80,80 72 Z\" fill=\"var(--b-body)\"/>\n      <g class=\"b-head\">\n        <circle class=\"b-body-fill\" cx=\"100\" cy=\"62\" r=\"16\" fill=\"var(--b-body)\"/>\n        <g class=\"b-ant b-ant-l\"><g class=\"b-ant-in\">\n          <path d=\"M91 53 C84 45,75 36,66 26\" fill=\"none\" stroke=\"var(--b-body)\" stroke-width=\"2.2\" stroke-linecap=\"round\"/>\n          <circle class=\"b-body-fill\" cx=\"64\" cy=\"23\" r=\"3.6\" fill=\"var(--b-body)\"/>\n        </g></g>\n        <g class=\"b-ant b-ant-r\"><g class=\"b-ant-in\">\n          <path d=\"M109 53 C116 45,125 36,134 26\" fill=\"none\" stroke=\"var(--b-body)\" stroke-width=\"2.2\" stroke-linecap=\"round\"/>\n          <circle class=\"b-body-fill\" cx=\"136\" cy=\"23\" r=\"3.6\" fill=\"var(--b-body)\"/>\n        </g></g>\n        <g class=\"b-eyes\">\n          <ellipse class=\"b-eye\" cx=\"93\" cy=\"60\" rx=\"2.8\" ry=\"3.2\" fill=\"var(--b-eye)\"/>\n          <ellipse class=\"b-eye\" cx=\"107\" cy=\"60\" rx=\"2.8\" ry=\"3.2\" fill=\"var(--b-eye)\"/>\n        </g>\n      </g>\n    </g>\n  </g>\n</svg>";
  }

  function mount(el, opts) {
    opts = opts || {};
    el.classList.add('beetle');
    el.innerHTML = template();
    if (opts.theme) el.dataset.theme = opts.theme;
    if (opts.motion) el.dataset.motion = opts.motion;
    let base = STATES.includes(opts.state) ? opts.state : 'idle', timer = null;
    const listeners = [];
    el.dataset.state = base;
    const emit = () => listeners.forEach(f => f(el.dataset.state));
    const api = {
      el,
      /** switch to a looping state and stay there */
      set(s) { if (!STATES.includes(s)) s = 'idle'; base = s; clearTimeout(timer); el.dataset.state = s; emit(); return api; },
      /** play one cycle of a state (default length from CYCLE), then return to the base state */
      once(s, ms) {
        clearTimeout(timer);
        el.dataset.state = s; emit();
        timer = setTimeout(() => { el.dataset.state = base; emit(); }, ms || CYCLE[s] || 1500);
        return api;
      },
      get state() { return el.dataset.state; },
      get base() { return base; },
      onChange(f) { listeners.push(f); return () => listeners.splice(listeners.indexOf(f), 1); },
      destroy() { clearTimeout(timer); el.innerHTML = ''; delete el.dataset.state; }
    };
    return api;
  }

  /** Wire a mascot to a text field: typing -> listening, pause -> thinking, long idle -> sleeping. */
  function bindEditor(m, field, o) {
    o = Object.assign({ idleAfter: 1600, thinkAfter: 5000, sleepAfter: 15000, thinking: true }, o || {});
    let idleT, thinkT, sleepT, paused = false;
    function wake() {
      clearTimeout(sleepT);
      if (m.base === 'sleeping') m.set('idle');
      sleepT = setTimeout(() => { if (!paused) m.set('sleeping'); }, o.sleepAfter);
    }
    function typed() {
      wake(); if (paused) return;
      m.set('listening');
      clearTimeout(idleT); clearTimeout(thinkT);
      idleT = setTimeout(() => m.set('idle'), o.idleAfter);
      if (o.thinking) thinkT = setTimeout(() => { if (document.activeElement === field) m.set('thinking'); }, o.thinkAfter);
    }
    const onBlur = () => { clearTimeout(thinkT); if (m.base === 'thinking') m.set('idle'); };
    field.addEventListener('input', typed);
    field.addEventListener('focus', wake);
    field.addEventListener('blur', onBlur);
    wake();
    return {
      /** stop reacting (e.g. during a page transition) */
      pause() { paused = true; clearTimeout(idleT); clearTimeout(thinkT); },
      resume() { paused = false; wake(); },
      wake,
      unbind() { clearTimeout(idleT); clearTimeout(thinkT); clearTimeout(sleepT);
        field.removeEventListener('input', typed); field.removeEventListener('focus', wake); field.removeEventListener('blur', onBlur); }
    };
  }

  // <elytra-beetle state="idle" theme="dark"></elytra-beetle>
  if (typeof HTMLElement !== 'undefined' && typeof customElements !== 'undefined' && !customElements.get('elytra-beetle')) {
    class ElytraBeetle extends HTMLElement {
      static get observedAttributes() { return ['state', 'theme']; }
      connectedCallback() {
        if (this._m) return;
        this.style.display = this.style.display || 'block';
        this._m = mount(this, { state: this.getAttribute('state') || 'idle', theme: this.getAttribute('theme') || undefined, motion: this.getAttribute('motion') || undefined });
      }
      attributeChangedCallback(n, _o, v) {
        if (!this._m) return;
        if (n === 'state') this._m.set(v || 'idle');
        if (n === 'theme') { if (v) this.dataset.theme = v; else delete this.dataset.theme; }
      }
      set(s) { return this._m && this._m.set(s); }
      once(s, ms) { return this._m && this._m.once(s, ms); }
      get mascot() { return this._m; }
    }
    customElements.define('elytra-beetle', ElytraBeetle);
  }

  return { mount, bindEditor, template, STATES, CYCLE, version: '1.0.0' };
})();

export default ElytraMascot;
export const { mount, bindEditor, STATES } = ElytraMascot;
