extends Node

const Recipes = preload("res://scripts/recipes.gd")

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
