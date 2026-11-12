// Command line of the bake driver (P1-007). Pure: tools/bake/main.ts passes process.argv in.
//
//   npm run bake -- <stage|block> [--stage <step>] [--tiles x_z,x_z] [--out <tile folder>] [--force] [--offline]
//
// <stage|block>  a stage of harness/data/districts.json "stages" (pilot) or a block id (once blocks have outlines)
// --stage        run the steps up to and including this one: sources, ground, graph, repair, lanes, elevation, mesh, tiles (default: all)
// --tiles        a partial bake: only these world tiles (x_z, integers) are written
// --out          write tiles to this folder instead of game/world/tiles/
// --force        fetch every source again even when a good pinned file is there
// --offline      never touch the network: a source that is not pinned and on disk fails

export const STEPS = ['sources', 'ground', 'graph', 'repair', 'lanes', 'elevation', 'mesh', 'tiles'] as const;
export type Step = (typeof STEPS)[number];

export interface BakeArgs {
  target: string;
  steps: Step[];
  tiles: { x: number; z: number }[] | null;
  out: string | null;
  force: boolean;
  offline: boolean;
}

export const USAGE = 'usage: npm run bake -- <stage|block> [--stage sources|ground|graph|repair|lanes|elevation|mesh|tiles] [--tiles x_z,x_z] [--out <tile folder>] [--force] [--offline]';

export function parseArgs(argv: readonly string[]): BakeArgs {
  const out: BakeArgs = { target: '', steps: [...STEPS], tiles: null, out: null, force: false, offline: false };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value. ${USAGE}`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--stage') {
      const step = value(i++, a);
      const k = (STEPS as readonly string[]).indexOf(step);
      if (k < 0) throw new Error(`unknown step "${step}" (steps: ${STEPS.join(', ')})`);
      out.steps = STEPS.slice(0, k + 1);
    } else if (a === '--tiles') {
      out.tiles = value(i++, a).split(',').filter(Boolean).map((t) => {
        const m = /^(-?\d+)_(-?\d+)$/.exec(t.trim());
        if (!m) throw new Error(`--tiles: "${t}" is not x_z with integers`);
        return { x: Number(m[1]), z: Number(m[2]) };
      });
      if (!out.tiles.length) throw new Error('--tiles: no tile given');
    } else if (a === '--out') {
      out.out = value(i++, a);
    } else if (a === '--force') {
      out.force = true;
    } else if (a === '--offline') {
      out.offline = true;
    } else if (a.startsWith('--')) {
      throw new Error(`unknown option ${a}. ${USAGE}`);
    } else if (!out.target) {
      out.target = a;
    } else {
      throw new Error(`one stage or block only (got "${out.target}" and "${a}"). ${USAGE}`);
    }
  }
  if (!out.target) throw new Error(USAGE);
  if (out.force && out.offline) throw new Error('--force and --offline do not go together');
  return out;
}
