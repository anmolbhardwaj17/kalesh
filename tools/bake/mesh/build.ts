// The road mesh of a bake stage (P1-014, MAP_REPAIR.md "Junction mesh builder", ARCH_OPTIONS J3): the entry of the
// mesh step. Order: the lane quads of every strip as faces over welded vertices; the junction surfaces and raised
// corners (planned ring first, the polygon set where it cannot be used); T joints taken out, so every edge two
// faces meet along is named by both; the boundary loops the ground is cut to; then the draw meshes: tops with the
// lane UV, kerb faces wherever two tops differ in height, edge treatments and supports on structures only, stop
// lines. It reads the lane model and the heights and builds neither again. Pure.
import { KERB_RAISE } from '../roads/model.ts';
import type { Strip } from '../roads/model.ts';
import { boundaryLoops, buildEdges, conform } from './conform.ts';
import type { BoundaryReport, ConformReport, EdgeMap } from './conform.ts';
import { FaceSet } from './faces.ts';
import type { MeshInput } from './input.ts';
import { addJunctionFaces } from './junctionfaces.ts';
import type { JunctionFaces } from './junctionfaces.ts';
import { paintMidBlock, paintStops } from './paint.ts';
import type { MidBlockPaint, StopLine } from './paint.ts';
import { addMedianFaces } from './medianfaces.ts';
import type { MedianReport } from './medianfaces.ts';
import { Sink, emitSteps, emitTops } from './solids.ts';
import type { StepReport, TopReport } from './solids.ts';
import { Borders, StripIndex, addStripFaces, borderMarks } from './stripfaces.ts';
import type { StripFaces } from './stripfaces.ts';
import { FaceGrid, buildStructures } from './structures.ts';
import type { StructureReport } from './structures.ts';

export interface RoadMesh {
  fs: FaceSet;
  index: StripIndex;
  borders: Borders;
  grid: FaceGrid;
  stripFaces: StripFaces;
  junctions: JunctionFaces;
  conform: ConformReport;
  edges: EdgeMap;
  boundary: BoundaryReport;
  sink: Sink;
  tops: TopReport;
  steps: StepReport;
  structures: StructureReport;
  stops: { lines: StopLine[]; crossings: number };
  /** Medians between paired carriageways (P1-032). */
  medians: MedianReport;
  /** Face numbers of the medians (for the overlap proof). */
  medianFaces: number[];
  /** Mid-block crossings drawn (P1-032): zebras and their stop lines. */
  midBlock: MidBlockPaint;
  /** Wall time of every part and of the whole build (ms). */
  ms: Record<string, number>;
}

export function buildRoadMesh(input: MeshInput): RoadMesh {
  const ms: Record<string, number> = {};
  const t0 = Date.now();
  let clock = t0;
  const lap = (name: string): void => {
    const now = Date.now();
    ms[name] = now - clock;
    clock = now;
  };
  const fs = new FaceSet();
  const borders = new Borders(input.strips, input.joints);
  const stripFaces = addStripFaces(fs, input.strips, input.kinds, borders);
  const index = new StripIndex(input.strips, input.kinds, borders);
  lap('stripFaces');
  const junctions = addJunctionFaces(fs, input, index);
  lap('junctionFaces');
  const medianFaces: number[] = [];
  const medians = addMedianFaces(fs, input.strips, input.kinds, borders, new FaceGrid(fs), input.pairs, input.medianRefs, stripFaces.first, medianFaces);
  lap('medians');
  const report = conform(fs);
  lap('conform');
  const edges = buildEdges(fs);
  const boundary = boundaryLoops(fs, edges);
  lap('boundary');
  const sink = new Sink();
  const marks = input.strips.map((s: Strip) => borderMarks(s.lanes));
  const first = input.strips.length;
  const tops = emitTops(
    fs, sink,
    (piece, lane) => (piece < first ? [(marks[piece] as number[])[lane] as number, (marks[piece] as number[])[lane + 1] as number] : null),
    (piece) => {
      const j = input.junctions[piece - first];
      return j ? { x: j.centre.x, z: j.centre.z, h: j.h } : null;
    },
  );
  lap('tops');
  const steps = emitSteps(fs, edges, sink, KERB_RAISE, junctions.setFaces);
  lap('kerbFaces');
  const grid = new FaceGrid(fs);
  const structures = buildStructures(input, fs, edges, grid, sink, borders, (si, i) => index.sheet(si, Math.min(i, (input.strips[si] as Strip).st.length - 2)));
  lap('structures');
  const stops = paintStops(input, sink);
  const midBlock = paintMidBlock(input, sink);
  lap('paint');
  ms['total'] = Date.now() - t0;
  return { fs, index, borders, grid, stripFaces, junctions, medians, medianFaces, conform: report, edges, boundary, sink, tops, steps, structures, stops, midBlock, ms };
}
