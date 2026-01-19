extends Node

const Recipes = preload("res://scripts/recipes.gd")
const Constants = preload("res://scripts/constants.gd")

static func can_add_item(inventory: Array, item: String, amount: int) -> bool:
	if amount <= 0:
		return false
	for slot in inventory:
		var slot_dict: Dictionary = slot as Dictionary
		var slot_item: String = slot_dict.get("item", "") as String
		var slot_count: int = int(slot_dict.get("count", 0))
		if slot_item == item and slot_count > 0:
			return true
	for slot in inventory:
		var slot_dict: Dictionary = slot as Dictionary
		var slot_item: String = slot_dict.get("item", "") as String
		var slot_count: int = int(slot_dict.get("count", 0))
		if slot_item == "" and slot_count == 0:
			return true
	return false

static func add_item(inventory: Array, item: String, amount: int) -> bool:
	if amount <= 0:
		return false
	for slot in inventory:
		var slot_dict: Dictionary = slot as Dictionary
		var slot_item: String = slot_dict.get("item", "") as String
		if slot_item == item:
			slot_dict["count"] = int(slot_dict.get("count", 0)) + amount
			return true
	for slot in inventory:
		var slot_dict: Dictionary = slot as Dictionary
		var slot_item: String = slot_dict.get("item", "") as String
		var slot_count: int = int(slot_dict.get("count", 0))
		if slot_item == "" and slot_count == 0:
			slot_dict["item"] = item
			slot_dict["count"] = amount
			return true
	return false

static func has_items(inventory: Array, item: String, amount: int) -> bool:
	if amount <= 0:
		return false
	var remaining := amount
	for slot in inventory:
		var slot_dict: Dictionary = slot as Dictionary
		var slot_item: String = slot_dict.get("item", "") as String
		if slot_item != item:
			continue
		remaining -= int(slot_dict.get("count", 0))
		if remaining <= 0:
			return true
	return false

static func remove_item(inventory: Array, item: String, amount: int) -> bool:
	if amount <= 0:
		return false
	if not has_items(inventory, item, amount):
		return false
	var remaining := amount
	for slot in inventory:
		var slot_dict: Dictionary = slot as Dictionary
		var slot_item: String = slot_dict.get("item", "") as String
		if slot_item != item:
			continue
		var slot_count: int = int(slot_dict.get("count", 0))
		var taken := min(remaining, slot_count)
		slot_count -= taken
		remaining -= taken
		if slot_count <= 0:
			slot_dict["item"] = ""
			slot_dict["count"] = 0
		else:
			slot_dict["count"] = slot_count
		if remaining <= 0:
			return true
	return remaining <= 0

static func mine_at_player(sim: Sim, player: Player) -> bool:
	return player.mine(sim)

static func can_craft(recipe_id: String, inventory: Array) -> bool:
	var recipe: Dictionary = Recipes.RECIPES.get(recipe_id, {}) as Dictionary
	if recipe.is_empty():
		return false
	var cost: Dictionary = recipe.get("cost", {}) as Dictionary
	for item in cost.keys():
		var required: int = int(cost.get(item, 0))
		if not has_items(inventory, str(item), required):
			return false
	return true

static func craft_item(recipe_id: String, inventory: Array) -> bool:
	var recipe: Dictionary = Recipes.RECIPES.get(recipe_id, {}) as Dictionary
	if recipe.is_empty():
		return false
	var cost: Dictionary = recipe.get("cost", {}) as Dictionary
	for item in cost.keys():
		var required: int = int(cost.get(item, 0))
		if not has_items(inventory, str(item), required):
			return false
	for item in cost.keys():
		var required: int = int(cost.get(item, 0))
		if not remove_item(inventory, str(item), required):
			return false
	var output: Dictionary = recipe.get("output", {}) as Dictionary
	var output_item: String = str(output.get("item", ""))
	var output_amount: int = int(output.get("amount", 1))
	if output_item == "":
		return false
	return add_item(inventory, output_item, output_amount)

static func arm_furnace_placement(inventory: Array) -> bool:
	return can_craft("furnace", inventory)

static func place_furnace(sim: Sim, pos: Vector2i, inventory: Array) -> bool:
	if not remove_item(inventory, "stone", Constants.FURNACE_STONE_COST):
		return false
	return sim.build_furnace_at(pos, inventory)
