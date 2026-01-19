extends Node

const Recipes = preload("res://scripts/recipes.gd")
const Player = preload("res://scripts/player.gd")
const Sim = preload("res://scripts/sim.gd")

static func mine_at_player(sim: Sim, player: Player) -> bool:
	return player.mine(sim)

static func can_craft(recipe_id: String, inventory: Dictionary) -> bool:
	var recipe: Dictionary = Recipes.RECIPES.get(recipe_id, {}) as Dictionary
	if recipe.is_empty():
		return false
	var cost: Dictionary = recipe.get("cost", {}) as Dictionary
	for item in cost.keys():
		var required: int = int(cost.get(item, 0))
		var current: int = int(inventory.get(item, 0))
		if current < required:
			return false
	return true

static func craft_item(recipe_id: String, inventory: Dictionary) -> bool:
	var recipe: Dictionary = Recipes.RECIPES.get(recipe_id, {}) as Dictionary
	if recipe.is_empty():
		return false
	var cost: Dictionary = recipe.get("cost", {}) as Dictionary
	for item in cost.keys():
		var required: int = int(cost.get(item, 0))
		var current: int = int(inventory.get(item, 0))
		if current < required:
			return false
	for item in cost.keys():
		var required: int = int(cost.get(item, 0))
		inventory[item] = int(inventory.get(item, 0)) - required
	var output: Dictionary = recipe.get("output", {}) as Dictionary
	var output_item: String = str(output.get("item", ""))
	var output_amount: int = int(output.get("amount", 1))
	if output_item == "":
		return false
	inventory[output_item] = int(inventory.get(output_item, 0)) + output_amount
	return true

static func arm_furnace_placement(inventory: Dictionary) -> bool:
	return can_craft("furnace", inventory)

static func place_furnace(sim: Sim, pos: Vector2i, inventory: Dictionary) -> bool:
	return sim.build_furnace_at(pos, inventory)
