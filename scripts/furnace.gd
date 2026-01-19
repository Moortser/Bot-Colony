extends Node2D

class_name Furnace

const Constants = preload("res://scripts/constants.gd")

var inventory := {}
var smelt_progress := 0.0

var _rect: ColorRect

func _ready() -> void:
	_rect = ColorRect.new()
	_rect.size = Vector2(Constants.TILE_SIZE, Constants.TILE_SIZE)
	_rect.color = Color(0.4, 0.4, 0.4)
	add_child(_rect)

func add_item(item: String, amount: int = 1) -> void:
	inventory[item] = inventory.get(item, 0) + amount

func remove_item(item: String, amount: int = 1) -> bool:
	var current := inventory.get(item, 0)
	if current < amount:
		return false
	inventory[item] = current - amount
	return true

func count(item: String) -> int:
	return inventory.get(item, 0)

func has_fuel() -> bool:
	return count(Constants.ITEM_COAL) > 0

func has_ore() -> bool:
	return count(Constants.ITEM_IRON_ORE) > 0 or count(Constants.ITEM_COPPER_ORE) > 0
