## A style preset for the Phase 0 style tests (game arg --style=<id>): tonemap, post passes and the material layer
## settings of one look. Instances live in game/render/styles/<id>.tres, next to the style script <id>.gd that reads
## them. No class_name: loaded by path.
extends Resource

## Environment.ToneMapper value (4 = AgX, 2 = Filmic).
@export var tonemap := 4
@export var agx_contrast := 1.25
@export var exposure_scale := 1.0

@export var glow := true
@export var glow_intensity := 0.6
@export var glow_strength := 1.0
@export var glow_bloom := 0.04
@export var glow_threshold := 1.0

@export var ssao := true
@export var ssao_radius := 1.2
@export var ssao_intensity := 1.6
@export var ssao_power := 1.5
@export var ssao_light_affect := 0.1

@export var ssil := true
@export var ssil_radius := 4.0
@export var ssil_intensity := 0.7

## Post adjustments before the LUT.
@export var contrast := 1.05
@export var saturation := 1.0

## Material layer (game/render/shaders/surface.gdshader).
## Procedural surface detail on walls, roads and leaves (0 = flat vertex colour like the stand-in default).
@export var detail := 1.0
## Albedo saturation of walls and roads.
@export var albedo_saturation := 1.08
## Grime: area wear (node metadata "wear") times this. 0 = no grime (look B), 1 = the B+D grime layer.
@export var wear_scale := 0.0
## Rim light on satin parts (people, signs, goods) so people read against busy walls.
@export var rim := 0.25

## Wall decals (posters, stains, soot, patched plaster) and dust motes on blocks with wear at or above this; above 1 = off.
@export var decal_wear_min := 2.0
