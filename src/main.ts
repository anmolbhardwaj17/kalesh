// Minimal scaffold: ground, sky colour, a box car driven with the arrow keys. Phase 0 decides the real architecture.
// Axes: east +X, north -Z, up +Y, 1 unit = 1 metre. No mirroring anywhere.
import * as THREE from 'three';
import { stepCar, type CarState } from './car';
import { installHooks } from './debug/hooks';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudEl = document.getElementById('hud') as HTMLDivElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

const SKY = 0x9fc6e0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 150, 600);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x8a7a5a, 1.2));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
sun.position.set(60, 120, 40);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: 0xc8b48a }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const road = new THREE.Mesh(new THREE.PlaneGeometry(10, 2000), new THREE.MeshLambertMaterial({ color: 0x4a4a4e }));
road.rotation.x = -Math.PI / 2;
road.position.y = 0.01;
scene.add(road);
// A north marker (red post) 50 m north of the origin, to read orientation in shots.
const north = new THREE.Mesh(new THREE.BoxGeometry(1, 6, 1), new THREE.MeshLambertMaterial({ color: 0xc0392b }));
north.position.set(0, 3, -50);
scene.add(north);

const car = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 4.2), new THREE.MeshLambertMaterial({ color: 0xf2c200 }));
body.position.y = 0.7;
const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2), new THREE.MeshLambertMaterial({ color: 0x222831 }));
cabin.position.set(0, 1.4, 0.3);
car.add(body, cabin);
scene.add(car);

let state: CarState = { x: 0, z: 0, heading: 0, speed: 0 };
const keys = new Set<string>();
const override = new Map<string, number>();
window.addEventListener('keydown', (e) => keys.add(e.key));
window.addEventListener('keyup', (e) => keys.delete(e.key));
const axis = (neg: string, pos: string) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);
let camOverride: { pos: [number, number, number]; target: [number, number, number] } | null = null;

const hooks = installHooks({
  version: '0.0.1',
  renderer,
  scene: () => 'scaffold',
  player: () => ({ pos: [state.x, 0, state.z], heading: state.heading, speed: state.speed }),
  setInput: (a, v) => override.set(a, typeof v === 'number' ? v : v === true ? 1 : 0),
  load: () => {
    state = { x: 0, z: 0, heading: 0, speed: 0 };
    override.clear();
  },
  teleport: (p) => {
    state = { ...state, x: p[0], z: p[2], speed: 0 };
  },
  setCamera: (pose) => {
    camOverride = pose;
  },
  setHud: (on) => {
    hudEl.hidden = !on;
  },
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number) {
  const t0 = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const sdt = hooks.clock.advance(dt);
  const throttle = override.get('throttle') ?? axis('ArrowDown', 'ArrowUp');
  const steer = override.get('steer') ?? axis('ArrowLeft', 'ArrowRight');
  if (sdt > 0) state = stepCar(state, { throttle, steer }, sdt);
  car.position.set(state.x, 0, state.z);
  car.rotation.y = -state.heading; // a three.js object faces -Z (north) at rotation 0
  if (camOverride) {
    camera.position.fromArray(camOverride.pos);
    camera.lookAt(new THREE.Vector3().fromArray(camOverride.target));
  } else {
    const fx = Math.sin(state.heading), fz = -Math.cos(state.heading);
    camera.position.set(state.x - fx * 10, 4.5, state.z - fz * 10);
    camera.lookAt(state.x + fx * 6, 1, state.z + fz * 6);
  }
  renderer.render(scene, camera);
  hooks.frameDone(performance.now() - t0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
