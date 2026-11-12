// Map inspector: the mini overview (P1-039). A 2D canvas of the whole stage (outline, main roads, the high impact
// issues and the places) with the camera's view drawn on it as a marigold frame. A click flies the map there.
// North is up (-Z up), like the top view.
import { SEV } from './theme.js';

export class Minimap {
  constructor(canvas, onPick) {
    this.canvas = canvas;
    this.onPick = onPick;
    this.base = document.createElement('canvas');
    this.box = null;
    this.view = null;
    canvas.addEventListener('click', (e) => {
      if (!this.box) return;
      const r = canvas.getBoundingClientRect();
      const [x, z] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      onPick(x, z);
    });
  }

  /** Fits the stage into the canvas and draws the parts that do not move. */
  setData({ outline, roads, issues, places, isHigh }) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 200;
    const h = this.canvas.clientHeight || 160;
    this.canvas.width = this.base.width = Math.round(w * dpr);
    this.canvas.height = this.base.height = Math.round(h * dpr);
    const xs = outline.length ? outline.map((p) => p[0]) : issues.map((i) => i.x);
    const zs = outline.length ? outline.map((p) => p[1]) : issues.map((i) => i.z);
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minZ = Math.min(...zs); const maxZ = Math.max(...zs);
    const pad = 8;
    const s = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxZ - minZ || 1));
    const ox = (w - (maxX - minX) * s) / 2 - minX * s;
    const oz = (h - (maxZ - minZ) * s) / 2 - minZ * s;
    this.box = { s, ox, oz, dpr, w, h };
    const g = this.base.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (outline.length) {
      g.beginPath();
      outline.forEach(([x, z], k) => (k ? g.lineTo(...this.toPx(x, z)) : g.moveTo(...this.toPx(x, z))));
      g.closePath();
      g.fillStyle = '#1d1813';
      g.fill();
      g.strokeStyle = 'rgba(255,178,36,.45)';
      g.lineWidth = 1;
      g.stroke();
    }
    g.lineCap = 'round';
    for (const major of [false, true]) {
      g.strokeStyle = major ? 'rgba(214,200,176,.75)' : 'rgba(150,138,120,.28)';
      g.lineWidth = major ? 1.1 : 0.6;
      g.beginPath();
      for (const r of roads) {
        if (r.major !== major) continue;
        r.pts.forEach(([x, z], k) => (k ? g.lineTo(...this.toPx(x, z)) : g.moveTo(...this.toPx(x, z))));
      }
      g.stroke();
    }
    g.fillStyle = SEV.high;
    for (const i of issues) {
      if (!isHigh(i)) continue;
      const [px, pz] = this.toPx(i.x, i.z);
      g.fillRect(px - 1, pz - 1, 2.2, 2.2);
    }
    g.fillStyle = '#f6efe4';
    for (const p of places) {
      const [px, pz] = this.toPx(p.x, p.z);
      g.save(); g.translate(px, pz); g.rotate(Math.PI / 4); g.fillRect(-1.8, -1.8, 3.6, 3.6); g.restore();
    }
    this.draw();
  }

  toPx(x, z) { const b = this.box; return [x * b.s + b.ox, z * b.s + b.oz]; }
  toWorld(px, pz) { const b = this.box; return [(px - b.ox) / b.s, (pz - b.oz) / b.s]; }

  /** The camera's footprint on the ground (four [x, z] corners), or null when the view does not meet the ground. */
  setView(corners, target) {
    this.view = corners;
    this.target = target;
    this.draw();
  }

  draw() {
    if (!this.box) return;
    const g = this.canvas.getContext('2d');
    const { dpr, w, h } = this.box;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.view) {
      g.beginPath();
      this.view.forEach(([x, z], k) => (k ? g.lineTo(...this.toPx(x, z)) : g.moveTo(...this.toPx(x, z))));
      g.closePath();
      g.fillStyle = 'rgba(255,178,36,.12)';
      g.fill();
      g.strokeStyle = '#ffb224';
      g.lineWidth = 1.4;
      g.stroke();
    }
    if (this.target) {
      const [px, pz] = this.toPx(this.target[0], this.target[1]);
      g.fillStyle = '#ffb224';
      g.beginPath(); g.arc(Math.min(w, Math.max(0, px)), Math.min(h, Math.max(0, pz)), 2.4, 0, Math.PI * 2); g.fill();
    }
  }
}
