// Plan of the render architecture bench (P0-016; harness/design/ARCH_OPTIONS.md rows R, G, L, A, I, LD, OC, TX, AN, KT).
// Run by node harness/bench/arch.mjs render. The scene is game/bench/render/ (--arch=render:<tokens>, see
// render_bench.gd for the tokens). Every setup carries the signed look B load (stylised B, lean path, golden light).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BASE = 'city+i3+lod';
const KIT = 'kit+i3+lod';
const HI = '2880x1620';

const setups = [
  // R1: Forward+ with the look B load, on the recommended drawing path (I3 + LD1), four camera paths
  { id: 'r1_base', option: 'R1', group: 'base', tokens: BASE, paths: ['drive60', 'drive140', 'drive200', 'walk5'], primary: 'drive140' },
  { id: 'r1_look_only_1080', option: 'R1', group: 'base', tokens: 'empty', paths: ['wall'], note: 'the look B stack alone (sky, sun shadows, SSAO, SSIL, glow, fog, grade) over one ground plane at 1920x1080: the fixed cost under every other row' },
  { id: 'r1_look_only_1620', option: 'R1', group: 'base', tokens: 'empty', paths: ['wall'], resolution: HI, note: 'the same at 2880x1620' },
  // Instancing, with no LOD of any kind so all three draw the same triangles
  { id: 'i1', option: 'I1', group: 'inst', tokens: 'city+i1', paths: ['drive140', 'over'], note: 'one MeshInstance3D per building (unique mesh) and per prop; no LOD. Its 12000 nodes overflow the engine buffer for per-instance shader uniforms (the engineErrors of this row)' },
  { id: 'i2', option: 'I2', group: 'inst', tokens: 'city+i2', paths: ['drive140', 'over'], note: 'merged per 250 m tile and material (two meshes per tile: shadow casters and flat facade parts); no LOD' },
  { id: 'i3', option: 'I3', group: 'inst', tokens: 'city+i3', paths: ['drive140', 'over'], note: 'shells and ground merged per tile, one MultiMesh per module per 125 m cell; no LOD' },
  // LOD
  { id: 'ld1_on', option: 'LD1', group: 'lod', tokens: BASE, paths: ['drive140', 'over'], note: 'modules to 180 m, mid shell per cell 180 to 700 m, district skyline beyond 700 m, mesh LOD index buffers on' },
  { id: 'ld_off', option: 'LD none', group: 'lod', tokens: 'city+i3', paths: ['drive140', 'over'], note: 'same as i3: every module at every distance, mesh LOD off' },
  // Occlusion culling
  { id: 'oc_open_off', option: 'OC2', group: 'oc', tokens: BASE, paths: ['drive140', 'walk5'], note: 'open view: the 17 m wide city street' },
  { id: 'oc_open_on', option: 'OC1', group: 'oc', tokens: `${BASE}+oc`, paths: ['drive140', 'walk5'], note: 'open view, occluders from building boxes, one per tile' },
  { id: 'oc_lane_off', option: 'OC2', group: 'oc', tokens: KIT, paths: ['walk5'], note: 'dense lane view: on foot in a 5 m old city lane' },
  { id: 'oc_lane_on', option: 'OC1', group: 'oc', tokens: `${KIT}+oc`, paths: ['walk5'], note: 'dense lane view with occluders' },
  { id: 'oc_lane_nolod_off', option: 'OC2', group: 'oc', tokens: 'kit+i3', paths: ['walk5'], note: 'dense lane view, no LOD ranges, no occluders' },
  { id: 'oc_lane_nolod_on', option: 'OC1', group: 'oc', tokens: 'kit+i3+oc', paths: ['walk5'], note: 'dense lane view, no LOD ranges, with occluders' },
  // Lighting
  { id: 'l1', option: 'L1', group: 'light', tokens: BASE, paths: ['drive140', 'walk5'], note: 'sun, sky ambient, SSAO and SSIL (low), no real-time GI' },
  { id: 'l2_sdfgi', option: 'L2', group: 'light', tokens: `${BASE}+sdfgi`, paths: ['drive140', 'walk5'], note: 'SDFGI on top of L1, engine default cascades' },
  // Anti-aliasing and upscaling, Vulkan (GPU times)
  { id: 'a0_none_1080', option: 'A0', group: 'aa', tokens: BASE, paths: ['drive140'], note: 'the signed look: no anti-aliasing, native 1920x1080' },
  { id: 'a1_taa_1080', option: 'A1', group: 'aa', tokens: `${BASE}+taa`, paths: ['drive140'], note: 'native 1920x1080 with TAA' },
  { id: 'a2_fsr2_1080', option: 'A2', group: 'aa', tokens: `${BASE}+fsr2@0.67`, paths: ['drive140'], note: 'FSR 2.2 from 0.67 scale (1286x724) to 1920x1080' },
  { id: 'a0_none_1620', option: 'A0', group: 'aa', tokens: BASE, paths: ['drive140'], resolution: HI, note: 'native 2880x1620, no anti-aliasing' },
  { id: 'a1_taa_1620', option: 'A1', group: 'aa', tokens: `${BASE}+taa`, paths: ['drive140'], resolution: HI, note: 'native 2880x1620 with TAA' },
  { id: 'a2_fsr2_1620', option: 'A2', group: 'aa', tokens: `${BASE}+fsr2@0.67`, paths: ['drive140'], resolution: HI, note: 'FSR 2.2 from a 1080p-class render (1930x1085) to 2880x1620' },
  { id: 'a2_bilinear_1620', option: 'A2', group: 'aa', tokens: `${BASE}+bilinear@0.67`, paths: ['drive140'], resolution: HI, note: 'plain bilinear scale from 1930x1085 to 2880x1620 (no anti-aliasing): the floor for any upscaler' },
  { id: 'a2_fsr1_1620', option: 'A2', group: 'aa', tokens: `${BASE}+fsr1@0.67`, paths: ['drive140'], resolution: HI, note: 'FSR 1.0 (spatial) from 1930x1085 to 2880x1620' },
  // The same on the Metal driver: no GPU timer, so frame time with vsync off is the number (MetalFX needs Metal)
  { id: 'm_none_1080', option: 'A0', group: 'metal', driver: 'metal', tokens: BASE, paths: ['drive140'], note: 'Metal, native 1920x1080, no anti-aliasing' },
  { id: 'm_taa_1080', option: 'A1', group: 'metal', driver: 'metal', tokens: `${BASE}+taa`, paths: ['drive140'], note: 'Metal, native 1920x1080 with TAA' },
  { id: 'm_none_1620', option: 'A0', group: 'metal', driver: 'metal', tokens: BASE, paths: ['drive140'], resolution: HI, note: 'Metal, native 2880x1620, no anti-aliasing' },
  { id: 'm_taa_1620', option: 'A1', group: 'metal', driver: 'metal', tokens: `${BASE}+taa`, paths: ['drive140'], resolution: HI, note: 'Metal, native 2880x1620 with TAA' },
  { id: 'm_fsr2_1620', option: 'A2', group: 'metal', driver: 'metal', tokens: `${BASE}+fsr2@0.67`, paths: ['drive140'], resolution: HI, note: 'Metal, FSR 2.2 from 1930x1085 to 2880x1620' },
  { id: 'm_metalfx_1620', option: 'A2', group: 'metal', driver: 'metal', tokens: `${BASE}+metalfx@0.67`, paths: ['drive140'], resolution: HI, note: 'Metal, MetalFX temporal from 1930x1085 to 2880x1620' },
  { id: 'm_metalfxs_1620', option: 'A2', group: 'metal', driver: 'metal', tokens: `${BASE}+metalfxs@0.67`, paths: ['drive140'], resolution: HI, note: 'Metal, MetalFX spatial from 1930x1085 to 2880x1620 (no temporal AA)' },
  { id: 'm_bilinear_1620', option: 'A2', group: 'metal', driver: 'metal', tokens: `${BASE}+bilinear@0.67`, paths: ['drive140'], resolution: HI, note: 'Metal, plain bilinear scale from 1930x1085 to 2880x1620' },
  { id: 'm_metalfx_1080', option: 'A2', group: 'metal', driver: 'metal', tokens: `${BASE}+metalfx@0.67`, paths: ['drive140'], note: 'Metal, MetalFX temporal from 1286x724 to 1920x1080' },
  // Textures
  { id: 'tx1_vram', option: 'TX1', group: 'tx', tokens: 'tx+tx_vram', paths: ['wall'], note: 'kit albedo and normal arrays (12 layers of 1024), trim and decal atlas (2048), VRAM compressed' },
  { id: 'tx3_lossless', option: 'TX3', group: 'tx', tokens: 'tx+tx_raw', paths: ['wall'], note: 'the same textures imported lossless (uncompressed in video memory)' },
  { id: 'tx3_uncompressed', option: 'TX3', group: 'tx', tokens: 'tx+tx_unc', paths: ['wall'], note: 'the same textures imported VRAM uncompressed' },
  // Crowd
  { id: 'an_none', option: 'AN none', group: 'crowd', tokens: BASE, paths: ['crowd'], note: 'the crowd view with nobody (the base cost)' },
  { id: 'an1', option: 'AN1', group: 'crowd', tokens: `${BASE}+crowd_an1`, paths: ['crowd'], note: '300 people, all skinned (20 bones) with an AnimationTree each' },
  { id: 'an2', option: 'AN2', group: 'crowd', tokens: `${BASE}+crowd_an2`, paths: ['crowd'], note: '300 people: up to 40 skinned within 25 m, the rest baked vertex animation in MultiMeshes' },
  // Area kit block
  { id: 'kit_multimesh', option: 'KT1 + I3', group: 'kit', tokens: KIT, paths: ['walk5', 'over'], note: '500 m dense old city block, modules as MultiMesh per 125 m cell, LD1 ranges' },
  { id: 'kit_multimesh_nolod', option: 'KT1 + I3', group: 'kit', tokens: 'kit+i3', paths: ['walk5', 'over'], note: 'the same without LOD ranges' },
  { id: 'kit_merged', option: 'KT1 + I2', group: 'kit', tokens: 'kit+i2', paths: ['walk5', 'over'], note: 'the same block merged per 125 m tile and material' },
  // If time
  { id: 'r2_mobile', option: 'R2', group: 'iftime', must: false, tokens: BASE, paths: ['drive140', 'walk5'], engine: ['--rendering-method', 'mobile'], note: 'Mobile renderer, same scene (the look loses what Mobile does not have)' },
  { id: 'a3_msaa4_1080', option: 'A3', group: 'iftime', must: false, tokens: `${BASE}+msaa4`, paths: ['drive140'], note: 'MSAA 4x, native 1920x1080' },
  { id: 'g_metal_base', option: 'G1', group: 'iftime', must: false, driver: 'metal', tokens: BASE, paths: ['drive60', 'drive140', 'drive200', 'walk5'], primary: 'drive140', note: 'Metal against Vulkan frame pacing: the r1_base run on the Metal driver (frame times only)' },
];

const notMeasured = [
  { id: 'l4_lightmap', option: 'L4', reason: 'if time item, did not fit the time box: a LightmapGI bake needs second UV sets on every bench mesh and an editor bake step', estimate: 'ARCH_OPTIONS.md: near 0 ms at run time, bake minutes per block, 2 to 8 MB per 250 m tile' },
  { id: 'l3_voxelgi', option: 'L3', reason: 'if time item, did not fit the time box (a baked VoxelGI room scene)', estimate: 'ARCH_OPTIONS.md: 1 to 2 ms inside a zone' },
  { id: 'tx2_basis', option: 'TX2', reason: 'if time item, did not fit the time box', estimate: 'ARCH_OPTIONS.md: smallest on disk, slower loads' },
  { id: 'l1_vertex_ao', option: 'L1 (vertex AO part)', reason: 'vertex AO is vertex colour data computed in the bake: it has no run time cost by construction, so the bench shells carry no baked AO pass', estimate: '0 ms at run time' },
];

// ---------------------------------------------------------------- textures (TX1 against TX3)

const TEX = ['kit_albedo', 'kit_normal', 'trim', 'decal'];
const ARRAYS = new Set(['kit_albedo', 'kit_normal']);

function importFile(name, file, mode, hq) {
  const isArray = ARRAYS.has(name);
  const lines = ['[remap]', '', `importer="${isArray ? '2d_array_texture' : 'texture'}"`, `type="${isArray ? 'CompressedTexture2DArray' : 'CompressedTexture2D'}"`, '',
    '[deps]', '', `source_file="${file}"`, '', '[params]', '',
    `compress/mode=${mode}`, `compress/high_quality=${hq ? 'true' : 'false'}`, 'compress/lossy_quality=0.7', 'compress/hdr_compression=1', 'compress/channel_pack=0',
    'mipmaps/generate=true', 'mipmaps/limit=-1'];
  if (isArray) lines.push('slices/horizontal=4', 'slices/vertical=3');
  else lines.push('compress/normal_map=0', 'roughness/mode=0', 'process/fix_alpha_border=false', 'process/premult_alpha=false', 'detect_3d/compress_to=0');
  return lines.join('\n') + '\n';
}

function dirSize(dir, filter = () => true) {
  let bytes = 0;
  const byKind = {};
  if (!fs.existsSync(dir)) return { bytes, byKind };
  for (const f of fs.readdirSync(dir)) {
    if (!filter(f)) continue;
    const m = f.match(/\.(?:(s3tc|bptc|etc2|astc)\.)?(ctex|ctexarray)$/);
    if (!m) continue;
    const size = fs.statSync(path.join(dir, f)).size;
    bytes += size;
    const kind = m[1] || 'plain';
    byKind[kind] = (byKind[kind] || 0) + size;
  }
  return { bytes, byKind };
}

const MB = (b) => Math.round((b / 2 ** 20) * 10) / 10;

function godot(binary, args, timeoutMs = 900000) {
  const t0 = Date.now();
  const r = spawnSync(binary, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 2 ** 20 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  return { ms: Date.now() - t0, code: r.status, errors: out.split('\n').filter((l) => /^(ERROR|SCRIPT ERROR)/.test(l)).slice(0, 5) };
}

/** Generates the kit textures, imports them into the game project (for the tx setups) and into scratch projects
 * that differ only in the import sets and the compress mode (import time and cache size). */
function prepareTextures(ctx, report) {
  const { binary, root, log } = ctx;
  const scratch = path.join(ctx.outDir, 'render_tx');
  const src = path.join(scratch, 'src');
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(src, { recursive: true });
  log('[render] textures: generating the kit PNG files');
  const gen = godot(binary, ['--path', path.join(root, 'game'), '--headless', '-s', 'res://bench/render/tools/make_tex.gd', '--quit-after', '2000', '--', `--out=${src}`]);
  const out = { generateMs: gen.ms, sourcePngMB: {}, variants: {}, gameProject: {} };
  for (const n of TEX) {
    if (!fs.existsSync(path.join(src, `${n}.png`))) throw new Error(`texture generation failed (${n}.png missing): ${gen.errors.join(' | ')}`);
    out.sourcePngMB[n] = MB(fs.statSync(path.join(src, `${n}.png`)).size);
  }
  // scratch projects: what the import costs per choice. mode 2 = VRAM compressed, 0 = lossless, 3 = VRAM uncompressed
  const variants = [
    { id: 'vram_host_set', mode: 2, hq: false, s3tc: false, etc2: false, what: 'VRAM compressed, only the set this Mac needs (both project settings off)' },
    { id: 'vram_both_sets', mode: 2, hq: false, s3tc: true, etc2: true, what: 'VRAM compressed, both import sets on (TX1)' },
    { id: 'vram_both_sets_high_quality', mode: 2, hq: true, s3tc: true, etc2: true, what: 'VRAM compressed, both sets, high quality (BPTC and ASTC)' },
    { id: 'lossless', mode: 0, hq: false, s3tc: false, etc2: false, what: 'lossless (TX3)' },
    { id: 'vram_uncompressed', mode: 3, hq: false, s3tc: false, etc2: false, what: 'VRAM uncompressed (TX3)' },
  ];
  for (const v of variants) {
    const dir = path.join(scratch, v.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.godot'), ['config_version=5', '', '[application]', '', 'config/name="tx bench"', 'config/features=PackedStringArray("4.7", "Forward Plus")', '',
      '[rendering]', '', `textures/vram_compression/import_s3tc_bptc=${v.s3tc}`, `textures/vram_compression/import_etc2_astc=${v.etc2}`, ''].join('\n'));
    for (const n of TEX) {
      fs.copyFileSync(path.join(src, `${n}.png`), path.join(dir, `${n}.png`));
      fs.writeFileSync(path.join(dir, `${n}.png.import`), importFile(n, `res://${n}.png`, v.mode, v.hq));
    }
    log(`[render] textures: import ${v.id}`);
    const r = godot(binary, ['--path', dir, '--headless', '--import']);
    const size = dirSize(path.join(dir, '.godot', 'imported'));
    out.variants[v.id] = { what: v.what, importMs: r.ms, cacheMB: MB(size.bytes), cacheByFormatMB: Object.fromEntries(Object.entries(size.byKind).map(([k, b]) => [k, MB(b)])), errors: r.errors };
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // the game project: three imports of the same PNG files side by side, for the tx setups
  const gen2 = path.join(root, 'game', 'bench', 'render', 'tex_gen');
  fs.rmSync(gen2, { recursive: true, force: true });
  fs.mkdirSync(gen2, { recursive: true });
  for (const [suffix, mode] of [['vram', 2], ['raw', 0], ['unc', 3]]) {
    for (const n of TEX) {
      fs.copyFileSync(path.join(src, `${n}.png`), path.join(gen2, `${n}_${suffix}.png`));
      fs.writeFileSync(path.join(gen2, `${n}_${suffix}.png.import`), importFile(n, `res://bench/render/tex_gen/${n}_${suffix}.png`, mode, false));
    }
  }
  log('[render] textures: import into the game project');
  const r = godot(binary, ['--path', path.join(root, 'game'), '--headless', '--import']);
  const imported = path.join(root, 'game', '.godot', 'imported');
  out.gameProject = { importMs: r.ms, errors: r.errors, cacheMB: {} };
  for (const suffix of ['vram', 'raw', 'unc']) {
    const size = dirSize(imported, (f) => TEX.some((n) => f.startsWith(`${n}_${suffix}.png-`)));
    out.gameProject.cacheMB[suffix] = { total: MB(size.bytes), byFormat: Object.fromEntries(Object.entries(size.byKind).map(([k, b]) => [k, MB(b)])) };
  }
  fs.rmSync(src, { recursive: true, force: true });
  report.textures = out;
}

function cleanTextures(ctx) {
  if (ctx.keep) return;
  const gen = path.join(ctx.root, 'game', 'bench', 'render', 'tex_gen');
  fs.rmSync(gen, { recursive: true, force: true });
  const imported = path.join(ctx.root, 'game', '.godot', 'imported');
  if (fs.existsSync(imported)) {
    for (const f of fs.readdirSync(imported)) {
      if (TEX.some((n) => ['vram', 'raw', 'unc'].some((s) => f.startsWith(`${n}_${s}.png-`)))) fs.rmSync(path.join(imported, f), { force: true });
    }
  }
  fs.rmSync(path.join(ctx.outDir, 'render_tx'), { recursive: true, force: true });
}

// ---------------------------------------------------------------- SDFGI lag (L1 against L2)

/** Arrives at a point at 140 km/h, shoots at once, stands 5 s, shoots again: the difference is light that was
 * still catching up when the camera arrived. The L1 run is the control (its difference is noise). */
async function lagProbe(ctx, game, row) {
  const sharp = (await import('sharp')).default;
  const a = path.join(ctx.shotDir, `${row.id}_arrive.png`);
  const b = path.join(ctx.shotDir, `${row.id}_settled.png`);
  await game.client.call('bench', 'path', { name: 'drive140', seconds: 4 });
  await new Promise((r) => setTimeout(r, 4050));
  await game.client.call('shot', a);
  await new Promise((r) => setTimeout(r, 5000));
  await game.client.call('shot', b);
  const ra = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rb = await sharp(b).removeAlpha().raw().toBuffer();
  let sum = 0;
  let over = 0;
  let lumA = 0;
  let lumB = 0;
  const px = ra.info.width * ra.info.height;
  for (let i = 0; i < px; i++) {
    const o = i * 3;
    const d = Math.max(Math.abs(ra.data[o] - rb[o]), Math.abs(ra.data[o + 1] - rb[o + 1]), Math.abs(ra.data[o + 2] - rb[o + 2]));
    sum += d;
    if (d > 12) over++;
    lumA += ra.data[o] * 0.2126 + ra.data[o + 1] * 0.7152 + ra.data[o + 2] * 0.0722;
    lumB += rb[o] * 0.2126 + rb[o + 1] * 0.7152 + rb[o + 2] * 0.0722;
  }
  row.lag = {
    how: 'drive 4 s at 140 km/h (156 m), shot on arrival, shot again after standing 5 s; values 0 to 255',
    meanDiff: Math.round((sum / px) * 100) / 100, shareOver12: Math.round((over / px) * 10000) / 100,
    meanLumaOnArrival: Math.round((lumA / px) * 10) / 10, meanLumaSettled: Math.round((lumB / px) * 10) / 10,
    shots: [path.relative(ctx.root, a), path.relative(ctx.root, b)],
  };
}

const CAVEATS = [
  'Frame times are capped: on this Mac a Godot window runs at 120 fps at most even with vsync off (Vulkan and Metal). frameP50 and frameP95 are what a player sees; frameCostP50 and gpuP95 (measured with the GPU ballast) are the cost.',
  'gpuP95Capped is the plain debug.perf reading. Under the cap the GPU clocks down, so it shows 6 to 7 ms for any scene that costs less (the look alone reads 6.6 ms and costs 3.6 ms). Do not use it.',
  'The world is built by GDScript at load from 53 procedural modules. loadMs and buildMs are that build, not a tile load; tile format and streaming are measured by P0-018.',
  'The look is stylised B on its lean path at golden light, with no dressing, decals, signs, night lights or heat shimmer: add their measured costs (TECH.md "Performance budgets") on top.',
  'Grime: the wear value is a per-instance shader uniform and the engine holds about 4096 instances of those. Module MultiMeshes (i3, kit_multimesh) draw with wear 0; merged setups carry wear on every pixel. The i1 row overflows the buffer (engineErrors).',
  'The crowd people are procedural stand-ins: 20 bones, rigid parts, 1764 triangles, 11 animated bones, two clips blended. A Quaternius character has more bones and tracks, so its CPU cost per person will be higher than here.',
  'Occluders are one ArrayOccluder3D per tile made from the building body boxes. MultiMesh cells are culled as one box each, so occlusion only removes a cell when all of it is hidden.',
  'SDFGI uses the engine default settings (4 cascades). Its cost at 140 km/h is the cascade update while the camera moves; standing or walking it is much lower.',
  'Texture test files are noise: sizes and formats are what count. On this Apple Silicon Mac the importer writes S3TC as the host set when both project settings are off, and the game loads S3TC.',
];

const r2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/** Differences P0-020 needs, computed from the rows (null when a row is missing). */
function summarise(setups) {
  const row = (id, p) => { const s = setups[id]; if (!s || s.failed) return null; return p ? s.paths?.[p] || null : s; };
  const d = (a, b, k) => (a && b && a[k] != null && b[k] != null ? r2(a[k] - b[k]) : null);
  const base = row('r1_base', 'drive140');
  const look = row('r1_look_only_1080', 'wall');
  const out = {};
  out.base = base && { gpuP95: base.gpuP95, cpuP95: base.cpuP95, drawCalls: base.drawCalls, primitives: base.primitives, videoMB: base.videoMB,
    lookOnlyGpuP95: look?.gpuP95 ?? null, cityContentGpuMs: d(base, look, 'gpuP95'),
    byPathGpuP95: Object.fromEntries(Object.entries(setups.r1_base?.paths || {}).map(([k, v]) => [k, v.gpuP95])) };
  const inst = {};
  for (const id of ['i1', 'i2', 'i3']) {
    const a = row(id, 'drive140'); const o = row(id, 'over'); const s = row(id);
    if (a) inst[id] = { gpuP95: a.gpuP95, cpuP95: a.cpuP95, frameP95: a.frameP95, drawCalls: a.drawCalls, primitives: a.primitives, videoMB: a.videoMB, bufferMB: a.bufferMB, loadMs: s.loadMs, overGpuP95: o?.gpuP95 ?? null, overCpuP95: o?.cpuP95 ?? null, overDrawCalls: o?.drawCalls ?? null };
  }
  out.instancing = inst;
  const lodOn = row('ld1_on', 'drive140'); const lodOff = row('ld_off', 'drive140');
  out.lod = lodOn && lodOff && { gpuMsSaved: d(lodOff, lodOn, 'gpuP95'), cpuMsSaved: d(lodOff, lodOn, 'cpuP95'),
    primitivesCutPercent: r2(100 * (1 - lodOn.primitives / lodOff.primitives)), drawCallsCutPercent: r2(100 * (1 - lodOn.drawCalls / lodOff.drawCalls)),
    overGpuMsSaved: d(row('ld_off', 'over'), row('ld1_on', 'over'), 'gpuP95') };
  const oc = (on, off, p) => { const a = row(on, p); const b = row(off, p); return a && b && { gpuMsSaved: d(b, a, 'gpuP95'), cpuMsAdded: d(a, b, 'cpuP95'), drawCallsCutPercent: r2(100 * (1 - a.drawCalls / b.drawCalls)), primitivesCutPercent: r2(100 * (1 - a.primitives / b.primitives)) }; };
  out.occlusion = { openDrive140: oc('oc_open_on', 'oc_open_off', 'drive140'), openWalk5: oc('oc_open_on', 'oc_open_off', 'walk5'), laneWithLod: oc('oc_lane_on', 'oc_lane_off', 'walk5'), laneNoLod: oc('oc_lane_nolod_on', 'oc_lane_nolod_off', 'walk5') };
  out.lighting = { sdfgiGpuMsAddedDrive140: d(row('l2_sdfgi', 'drive140'), row('l1', 'drive140'), 'gpuP95'), sdfgiGpuMsAddedWalk5: d(row('l2_sdfgi', 'walk5'), row('l1', 'walk5'), 'gpuP95'),
    sdfgiVideoMBAdded: d(row('l2_sdfgi', 'drive140'), row('l1', 'drive140'), 'videoMB'), lagL1: setups.l1?.lag || null, lagL2: setups.l2_sdfgi?.lag || null };
  const a0 = row('a0_none_1080', 'drive140'); const m0 = row('m_none_1080', 'drive140');
  const gpu = (id) => row(id, 'drive140')?.gpuP95 ?? null;
  const cost = (id) => row(id, 'drive140')?.frameCostP50 ?? null;
  out.antiAliasing = {
    vulkanGpuP95: { none1080: gpu('a0_none_1080'), taa1080: gpu('a1_taa_1080'), fsr2To1080: gpu('a2_fsr2_1080'), msaa4x1080: gpu('a3_msaa4_1080'), none1620: gpu('a0_none_1620'), taa1620: gpu('a1_taa_1620'), fsr2To1620: gpu('a2_fsr2_1620'), bilinearTo1620: gpu('a2_bilinear_1620'), fsr1To1620: gpu('a2_fsr1_1620') },
    metalFrameCostP50: { none1080: cost('m_none_1080'), taa1080: cost('m_taa_1080'), metalfxTemporalTo1080: cost('m_metalfx_1080'), none1620: cost('m_none_1620'), taa1620: cost('m_taa_1620'), fsr2To1620: cost('m_fsr2_1620'), metalfxTemporalTo1620: cost('m_metalfx_1620'), metalfxSpatialTo1620: cost('m_metalfxs_1620'), bilinearTo1620: cost('m_bilinear_1620') },
    taaGpuMsAdded1080: d(row('a1_taa_1080', 'drive140'), a0, 'gpuP95'),
    metalAgainstVulkanFrameCost1080: m0 && a0 ? { metal: m0.frameCostP50, vulkan: a0.frameCostP50 } : null,
  };
  const texBase = look?.textureMB;
  const tex = (id) => { const s = row(id); return s && texBase != null ? { kitTextureMB: r2(s.textureMB - texBase), textureLoadMs: s.textureLoadMs ?? null } : null; };
  out.textures = { vram: tex('tx1_vram'), lossless: tex('tx3_lossless'), uncompressed: tex('tx3_uncompressed') };
  const an0 = row('an_none', 'crowd');
  const an = (id) => { const a = row(id, 'crowd'); return a && an0 && { cpuMsAdded: d(a, an0, 'cpuP95'), gpuMsAdded: d(a, an0, 'gpuP95'), drawCallsAdded: a.drawCalls - an0.drawCalls, primitivesAdded: a.primitives - an0.primitives }; };
  out.crowd = { people: 300, an1: an('an1'), an2: an('an2') };
  const kit = {};
  for (const id of ['kit_multimesh', 'kit_multimesh_nolod', 'kit_merged']) {
    const w = row(id, 'walk5'); const o = row(id, 'over'); const s = row(id);
    if (w) kit[id] = { laneGpuP95: w.gpuP95, laneDrawCalls: w.drawCalls, lanePrimitives: w.primitives, overGpuP95: o?.gpuP95 ?? null, overDrawCalls: o?.drawCalls ?? null, cpuP95: w.cpuP95, videoMB: w.videoMB, bufferMB: w.bufferMB, loadMs: s.loadMs, buildMs: s.buildMs };
  }
  out.areaKit = kit;
  const mob = row('r2_mobile', 'drive140');
  out.mobile = mob && base ? { gpuP95: mob.gpuP95, forwardPlusGpuP95: base.gpuP95, drawCalls: mob.drawCalls, lost: setups.r2_mobile.engineWarnings || [] } : null;
  return out;
}

export default {
  name: 'render',
  scene: 'game/bench/render/render_bench.tscn, game arg --arch=render:<tokens>',
  defaults: { resolution: '1920x1080', windowMs: 3000, warmMs: 1500 },
  howMeasured: 'One Godot run per setup, vsync off, look stylised B (lean path, golden light) on a procedural 2 km by 2 km city or a 500 m old city block built from the P0-009 stand-in kit. Per camera path: a warm-up pass, then debug.perf over the window while the camera moves (drive60, drive140, drive200 along the centre street at 2.2 m; walk5 on the footpath at 1.7 m; crowd, over, lane and wall are fixed views), twice. Pass 1 is plain: frameP50 and frameP95 (as a player sees them: the window is capped at 120 fps, 8.33 ms, on this Mac even with vsync off), cpuP95 (game logic plus render CPU), drawCalls, primitives (they include the 4 shadow splits) and video memory. Pass 2 keeps the GPU busy with a ballast in an offscreen viewport: gpuP95 and gpuP50 are the root viewport GPU time at full GPU clock (Vulkan only), and frameCostP50 is a ballast frame minus the ballast alone, the same cost from frame times (the only GPU cost number on Metal). gpuP95Capped is the pass 1 reading, kept to show the trap: under the cap the GPU clocks down and a light scene reads 6 to 7 ms whatever it costs. The flat numbers of a setup are its primary path. loadMs is process start to the bench scene ready and includes the GDScript build of the world (buildMs), which a baked game would not pay.',
  setups,
  notMeasured,
  async before(ctx, report) {
    if (ctx.selected.some((id) => id.startsWith('tx'))) prepareTextures(ctx, report);
  },
  extra: { l1: lagProbe, l2_sdfgi: lagProbe },
  async after(ctx, report) {
    if (ctx.selected.some((id) => id.startsWith('tx'))) cleanTextures(ctx);
    for (const id of ['tx1_vram', 'tx3_lossless', 'tx3_uncompressed']) {
      const row = report.setups[id];
      if (row && !row.failed && row.scene?.textures) row.textureLoadMs = Math.round(row.scene.textures.loadMs * 10) / 10;
    }
    report.caveats = CAVEATS;
    report.summary = summarise(report.setups);
  },
};
