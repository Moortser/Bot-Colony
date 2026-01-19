extends Node2D

class_name Player

const Constants = preload("res://scripts/constants.gd")

var grid_pos := Vector2i.ZERO
const SLOT_COUNT := 24

var inventory: Array[Dictionary] = []

var _rect: ColorRect

func _ready() -> void:
	if inventory.is_empty():
		inventory = _create_empty_inventory()
	_rect = ColorRect.new()
	_rect.size = Vector2(Constants.TILE_SIZE, Constants.TILE_SIZE)
	_rect.color = Color(0.2, 0.7, 1.0)
	add_child(_rect)
	_update_world_position()

func move(direction: Vector2i, sim: Sim) -> void:
	var target := grid_pos + direction
	if sim.is_in_bounds(target):
		grid_pos = target
		_update_world_position()

func mine(sim: Sim) -> bool:
	return sim.mine_resource_at(grid_pos, inventory)

func _update_world_position() -> void:
	position = Vector2(grid_pos.x * Constants.TILE_SIZE, grid_pos.y * Constants.TILE_SIZE)

func _create_empty_inventory() -> Array[Dictionary]:
	var slots: Array[Dictionary] = []
	for _i in range(SLOT_COUNT):
		var slot: Dictionary = {"item": "", "count": 0}
		slots.append(slot)
	return slots
