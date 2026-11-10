// Placeholder car model. Pure logic, no three.js, so it is unit tested.
// World axes (the one coordinate system of this game): east is +X, north is -Z, up is +Y, 1 unit = 1 metre.
// heading is the compass heading in radians: 0 = north, PI/2 = east (clockwise seen from above).

export interface CarState {
  x: number; // metres east
  z: number; // metres south (north is -Z)
  heading: number;
  speed: number; // m/s along the heading
}

export interface CarInput {
  throttle: number; // -1..1
  steer: number; // -1 (left) .. 1 (right)
}

export const CAR = { accel: 8, brake: 14, drag: 0.6, maxSpeed: 30, maxReverse: 8, turnRate: 1.6 };

export function forward(heading: number): [number, number] {
  return [Math.sin(heading), -Math.cos(heading)];
}

export function stepCar(s: CarState, inp: CarInput, dt: number): CarState {
  const t = Math.max(-1, Math.min(1, inp.throttle));
  const st = Math.max(-1, Math.min(1, inp.steer));
  let speed = s.speed;
  if (t > 0) speed += CAR.accel * t * dt;
  else if (t < 0) speed += (speed > 0 ? CAR.brake : CAR.accel) * t * dt;
  speed -= speed * CAR.drag * dt;
  speed = Math.max(-CAR.maxReverse, Math.min(CAR.maxSpeed, speed));
  if (Math.abs(speed) < 0.01 && t === 0) speed = 0;
  const grip = Math.min(1, Math.abs(speed) / 4);
  const heading = s.heading + st * CAR.turnRate * grip * Math.sign(speed) * dt;
  const [fx, fz] = forward(heading);
  return { x: s.x + fx * speed * dt, z: s.z + fz * speed * dt, heading, speed };
}
