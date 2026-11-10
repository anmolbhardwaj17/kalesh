## A light preset for the Phase 0 style tests (game arg --light=<id>): sun, sky, ambient, haze and the grade tint
## for one time of day. Instances live in game/render/styles/light_<id>.tres. Read by the style scripts in
## game/render/styles/ (stylised.gd). No class_name: loaded by path, so nothing global appears in the default game.
extends Resource

## Sun position: compass azimuth of the sun (0 north, 90 east, 180 south, 270 west) and elevation above the horizon.
@export var sun_azimuth_deg := 235.0
@export var sun_elevation_deg := 52.0
@export var sun_color := Color("#fff0d8")
@export var sun_energy := 2.0
## Apparent sun size in degrees: soft shadow penumbra (0 = hard shadows).
@export var sun_angular_deg := 0.5
@export var shadow_max_distance := 240.0

@export var sky_top := Color("#8eabc4")
@export var sky_horizon := Color("#e2d3b4")
@export var ground_horizon := Color("#d4c4a2")
@export var ground_bottom := Color("#6f6350")
@export var sky_energy := 1.0
@export var sun_disc_deg := 30.0
@export var sun_curve := 0.15

@export var ambient_energy := 0.8
@export var exposure := 1.0

## Haze: exponential depth fog lit by the sun, a little thicker near the ground.
@export var fog_color := Color("#e0cfae")
@export var fog_density := 0.003
@export var fog_sun_scatter := 0.25
@export var fog_aerial := 0.45
@export var fog_sky_affect := 0.4
@export var fog_height := 6.0
@export var fog_height_density := 0.0

## Grade (a 3D LUT after the tonemap): tint offsets added to shadows and highlights (linear 0..1 units), and saturation.
@export var shadow_tint := Vector3(-0.01, 0.0, 0.015)
@export var highlight_tint := Vector3(0.03, 0.012, -0.025)
@export var grade_saturation := 1.12

## Multiplier for lamp heads, shop bulbs and signal lamps (values above 1 bloom through the glow pass).
@export var lamp_gain := 1.2
## Brightness of the dust motes in the grime style.
@export var dust_energy := 0.6

## Night and lights (style stylised_b): 0 in daylight, 1 at full night. Drives the sodium street lights, shop lights,
## headlights, lit windows and the neon (game/render/styles/stylised_b.gd).
@export var night := 0.0
## Share of windows lit from inside (0..1), used when night > 0.
@export var window_share := 0.0
## Heat shimmer over hot asphalt (0 none, 1 a hot afternoon).
@export var heat := 0.0
## Per-area haze (stylised_b): density of the dust and haze volume over a block, times the block's wear.
@export var area_haze := 0.02
@export var area_haze_color := Color(0.85, 0.74, 0.58)
