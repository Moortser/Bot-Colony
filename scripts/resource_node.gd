class_name ResourceNode
extends Node2D

const Constants = preload("res://scripts/constants.gd")

@export var resource_type: String = ""
@export var amount: int = 0

var _rect: ColorRect

func _ready() -> void:
	_rect = ColorRect.new()
	_rect.size = Vector2(Constants.TILE_SIZE, Constants.TILE_SIZE)
	_rect.color = _color_for_resource(resource_type)
	add_child(_rect)

func setup(resource: String, amount: int) -> void:
	resource_type = resource
	self.amount = amount
	if _rect:
		_rect.color = _color_for_resource(resource_type)

func mine_one() -> bool:
	if amount == -1:
		return true
	if amount <= 0:
		return false
	amount -= 1
	return true

func _color_for_resource(resource: String) -> Color:
	match resource:
		Constants.ITEM_IRON_ORE:
			return Color(0.5, 0.5, 0.6)
		Constants.ITEM_COPPER_ORE:
			return Color(0.8, 0.45, 0.2)
		Constants.ITEM_COAL:
			return Color(0.2, 0.2, 0.2)
		Constants.ITEM_STONE:
			return Color(0.6, 0.6, 0.6)
		_:
			return Color.WHITE
