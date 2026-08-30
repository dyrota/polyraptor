import Matter from 'matter-js';
import type { Genome } from './types';

// Deliberately minimal morphology per the plan's de-risking guidance: a
// 3-segment chain (2 joints), not a biped or anything with more degrees of
// freedom. Getting a walker to visibly improve within a handful of
// generations is a known-hard tuning problem independent of any WebMCP
// concern — the fewer joints, the faster that tuning converges to *some*
// visible movement, which is what actually matters for a demo.
export const NUM_JOINTS = 2;
export const SEGMENT_WIDTH = 40;
export const SEGMENT_HEIGHT = 16;

export function randomGenome(): Genome {
  return {
    joints: Array.from({ length: NUM_JOINTS }, () => ({
      amplitude: 1.5 + Math.random() * 3.5,
      frequency: 0.4 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
    })),
  };
}

export interface CreatureBodies {
  segments: Matter.Body[];
  constraints: Matter.Constraint[];
}

// A single rigid pin constraint per joint holds segments together at a
// point. Bending is driven directly (see driveCreature) via angular
// velocity rather than by oscillating a constraint's length — an earlier
// version tried two length-oscillating "muscle" constraints (top+bottom per
// joint) and, empirically, never produced visible bending at all: with the
// creature lying flat on the ground, gravity and ground contact resisted the
// constraint-induced torque more than the constraint's stiffness could
// overcome, so the chain just sat there rigid despite the constraint length
// values genuinely oscillating underneath. Directly setting angular velocity
// sidesteps that fight with the solver entirely and reliably produces motion.
export function buildCreatureBodies(genome: Genome, startX: number, startY: number): CreatureBodies {
  const n = genome.joints.length + 1;
  const segments: Matter.Body[] = [];
  for (let i = 0; i < n; i++) {
    segments.push(
      Matter.Bodies.rectangle(startX + i * SEGMENT_WIDTH, startY, SEGMENT_WIDTH, SEGMENT_HEIGHT, {
        friction: 0.9,
        frictionStatic: 1,
        density: 0.001,
        // Negative group: a creature's own segments never collide with each
        // other. Each creature is simulated in its own isolated world (see
        // ga.ts's evaluateFitness / EvolvePanel's watch-run), so there's no
        // cross-creature collision to worry about.
        collisionFilter: { group: -1 },
      })
    );
  }

  const constraints: Matter.Constraint[] = [];
  for (let i = 0; i < genome.joints.length; i++) {
    constraints.push(
      Matter.Constraint.create({
        bodyA: segments[i],
        pointA: { x: SEGMENT_WIDTH / 2, y: 0 },
        bodyB: segments[i + 1],
        pointB: { x: -SEGMENT_WIDTH / 2, y: 0 },
        length: 0,
        stiffness: 1,
      })
    );
  }
  return { segments, constraints };
}

// Called once per physics tick. Joint j directly drives segments[j+1]'s
// angular velocity from that joint's sine wave — segments[0] ("the head") is
// never driven directly, it's just pulled along by the pin constraint to
// segments[1]. Two joints with independent frequency/phase can produce a
// traveling-wave-like flex along the body, the same mechanism real
// inchworm/snake locomotion uses, which combined with ground friction is
// what actually produces net horizontal displacement.
export function driveCreature(genome: Genome, segments: Matter.Body[], timeSeconds: number): void {
  for (let j = 0; j < genome.joints.length; j++) {
    const { amplitude, frequency, phase } = genome.joints[j];
    const angularVelocity = amplitude * frequency * Math.cos(2 * Math.PI * frequency * timeSeconds + phase);
    Matter.Body.setAngularVelocity(segments[j + 1], angularVelocity);
  }
}

export function centroidX(segments: Matter.Body[]): number {
  return segments.reduce((sum, s) => sum + s.position.x, 0) / segments.length;
}
