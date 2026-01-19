extends Node2D

class_name Player

const Constants = preload("res://scripts/constants.gd")

var grid_pos := Vector2i.ZERO
var inventory := {
	Constants.ITEM_IRON_ORE: 0,
	Constants.ITEM_COPPER_ORE: 0,
	Constants.ITEM_COAL: 0,
	Constants.ITEM_STONE: 0,
	Constants.ITEM_IRON_PLATE: 0,
	Constants.ITEM_COPPER_PLATE: 0,
}

var _rect: ColorRect

func _ready() -> void:
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
