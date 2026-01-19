extends PanelContainer

const Actions = preload("res://scripts/actions.gd")
const Recipes = preload("res://scripts/recipes.gd")

@onready var inventory_label: Label = $VBoxContainer/InventoryScroll/InventoryLabel
@onready var recipes_container: VBoxContainer = $VBoxContainer/CraftingSection/RecipesContainer

var player_inventory: Dictionary
var furnace_request: Callable

func setup(inventory: Dictionary, furnace_callback: Callable) -> void:
	player_inventory = inventory
	furnace_request = furnace_callback
	_set_focus_none()
	_update_ui()

func refresh() -> void:
	_update_ui()

func _set_focus_none() -> void:
	focus_mode = Control.FOCUS_NONE
	for child in get_children():
		if child is Control:
			child.focus_mode = Control.FOCUS_NONE

func _update_ui() -> void:
	if player_inventory == null:
		return
	inventory_label.text = _build_inventory_text()
	_build_recipe_list()

func _build_inventory_text() -> String:
	var lines: Array[String] = []
	for item in player_inventory.keys():
		lines.append("%s: %d" % [item, int(player_inventory.get(item, 0))])
	lines.sort()
	return "\n".join(lines)

func _build_recipe_list() -> void:
	for child in recipes_container.get_children():
		child.queue_free()
	for recipe_id in Recipes.RECIPES.keys():
		var recipe: Dictionary = Recipes.RECIPES.get(recipe_id, {}) as Dictionary
		var cost: Dictionary = recipe.get("cost", {}) as Dictionary
		var output: Dictionary = recipe.get("output", {}) as Dictionary
		var output_item: String = str(output.get("item", ""))
		var output_amount: int = int(output.get("amount", 1))
		var row := HBoxContainer.new()
		var name_label := Label.new()
		name_label.text = "%s x%d" % [output_item, output_amount]
		row.add_child(name_label)
		var cost_label := Label.new()
		cost_label.text = _format_cost(cost)
		row.add_child(cost_label)
		var craft_button := Button.new()
		craft_button.text = "Craft"
		var can_craft: bool = Actions.can_craft(recipe_id, player_inventory)
		craft_button.disabled = not can_craft
		if not can_craft:
			name_label.text += " (missing)"
		craft_button.pressed.connect(func() -> void:
			if recipe_id == "furnace":
				if furnace_request.is_valid():
					furnace_request.call()
				_update_ui()
				return
			if Actions.craft_item(recipe_id, player_inventory):
				_update_ui()
		)
		row.add_child(craft_button)
		recipes_container.add_child(row)

func _format_cost(cost: Dictionary) -> String:
	var parts: Array[String] = []
	for item in cost.keys():
		parts.append("%s x%d" % [item, int(cost.get(item, 0))])
	parts.sort()
	return "Cost: " + ", ".join(parts)
