extends PanelContainer

const Actions = preload("res://scripts/actions.gd")
const Recipes = preload("res://scripts/recipes.gd")

const SLOT_COUNT := 24
const SLOT_SIZE := Vector2(48, 48)

@onready var inventory_grid: GridContainer = $MarginContainer/HBoxContainer/InventoryPanel/InventoryGrid
@onready var recipes_container: VBoxContainer = $MarginContainer/HBoxContainer/CraftingPanel/CraftingList

var player_inventory: Dictionary
var furnace_request: Callable
var slot_labels: Array[Label] = []

func _ready() -> void:
	_set_focus_none()
	_build_slots()

func setup(inventory: Dictionary, furnace_callback: Callable) -> void:
	player_inventory = inventory
	furnace_request = furnace_callback
	_update_ui()

func refresh() -> void:
	_update_ui()

func _set_focus_none() -> void:
	_set_focus_none_recursive(self)

func _set_focus_none_recursive(node: Node) -> void:
	if node is Control:
		node.focus_mode = Control.FOCUS_NONE
	for child in node.get_children():
		_set_focus_none_recursive(child)

func _build_slots() -> void:
	for child in inventory_grid.get_children():
		child.queue_free()
	slot_labels.clear()
	for _i in range(SLOT_COUNT):
		var slot := PanelContainer.new()
		slot.custom_minimum_size = SLOT_SIZE
		var label := Label.new()
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		slot.add_child(label)
		slot_labels.append(label)
		inventory_grid.add_child(slot)

func _update_ui() -> void:
	if player_inventory == null:
		return
	_update_inventory_slots()
	_build_recipe_list()

func _update_inventory_slots() -> void:
	var items := player_inventory.keys()
	items.sort()
	for i in range(slot_labels.size()):
		var label := slot_labels[i]
		if i < items.size():
			var item_name: String = str(items[i])
			var count: int = int(player_inventory.get(item_name, 0))
			label.text = "%s\n%d" % [item_name.replace("_", " "), count]
		else:
			label.text = ""

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
