extends Node

class_name Sim

const Constants = preload("res://scripts/constants.gd")
const Furnace = preload("res://scripts/furnace.gd")
const ResourceNode = preload("res://scripts/resource_node.gd")

var world_size := Constants.WORLD_SIZE
var resources := {}
var furnaces := {}

var world_node: Node2D

func tick(delta: float) -> void:
	for pos in furnaces.keys():
		var furnace: Furnace = furnaces[pos]
		if furnace.has_fuel() and furnace.has_ore():
			furnace.smelt_progress += delta
			if furnace.smelt_progress >= Constants.SMELT_TIME:
				furnace.smelt_progress = 0.0
				_process_smelt(furnace)
		else:
			furnace.smelt_progress = 0.0

func _process_smelt(furnace: Furnace) -> void:
	if not furnace.remove_item(Constants.ITEM_COAL, 1):
		return
	if furnace.remove_item(Constants.ITEM_IRON_ORE, 1):
		furnace.add_item(Constants.ITEM_IRON_PLATE, 1)
		return
	if furnace.remove_item(Constants.ITEM_COPPER_ORE, 1):
		furnace.add_item(Constants.ITEM_COPPER_PLATE, 1)

func is_in_bounds(pos: Vector2i) -> bool:
	return pos.x >= 0 and pos.y >= 0 and pos.x < world_size.x and pos.y < world_size.y

func grid_to_world(pos: Vector2i) -> Vector2:
	return Vector2(pos.x * Constants.TILE_SIZE, pos.y * Constants.TILE_SIZE)

func world_to_grid(pos: Vector2) -> Vector2i:
	return Vector2i(int(pos.x / Constants.TILE_SIZE), int(pos.y / Constants.TILE_SIZE))

func register_resource(node: ResourceNode) -> void:
	resources[world_to_grid(node.position)] = node

func get_resource_at(pos: Vector2i) -> ResourceNode:
	return resources.get(pos) as ResourceNode

func mine_resource_at(pos: Vector2i, inventory: Dictionary) -> bool:
	var node: ResourceNode = resources.get(pos)
	if node == null:
		return false
	if not node.mine_one():
		return false
	var current_amount: int = int(inventory.get(node.resource_type, 0))
	inventory[node.resource_type] = current_amount + 1
	if node.amount == 0:
		resources.erase(pos)
		node.queue_free()
	return true

func can_build_furnace_at(pos: Vector2i) -> bool:
	return not furnaces.has(pos)

func build_furnace_at(pos: Vector2i, inventory: Dictionary) -> bool:
	if not can_build_furnace_at(pos):
		return false
	if int(inventory.get(Constants.ITEM_STONE, 0)) < Constants.FURNACE_STONE_COST:
		return false
	inventory[Constants.ITEM_STONE] -= Constants.FURNACE_STONE_COST
	var furnace := Furnace.new()
	furnace.position = grid_to_world(pos)
	furnaces[pos] = furnace
	if world_node:
		world_node.add_child(furnace)
	return true

func get_furnace_at(pos: Vector2i) -> Furnace:
	return furnaces.get(pos) as Furnace

func transfer_player_items_to_furnace(pos: Vector2i, inventory: Dictionary) -> void:
	var furnace: Furnace = furnaces.get(pos)
	if furnace == null:
		return
	for item in [Constants.ITEM_COAL, Constants.ITEM_IRON_ORE, Constants.ITEM_COPPER_ORE]:
		var item_amount: int = int(inventory.get(item, 0))
		if item_amount > 0:
			furnace.add_item(item, item_amount)
			inventory[item] = 0
