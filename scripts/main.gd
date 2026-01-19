extends Node2D

const Constants = preload("res://scripts/constants.gd")
const Sim = preload("res://scripts/sim.gd")
const ResourceNode = preload("res://scripts/resource_node.gd")
const Furnace = preload("res://scripts/furnace.gd")
const Player = preload("res://scripts/player.gd")

@onready var world: Node2D = $World
@onready var units: Node2D = $Units
@onready var sim: Sim = $Systems/Sim
@onready var player: Player = $Units/Prime

@onready var inventory_label: Label = $UI/Panel/VBoxContainer/InventoryLabel
@onready var furnace_label: Label = $UI/Panel/VBoxContainer/FurnaceLabel
@onready var mine_button: Button = $UI/Panel/VBoxContainer/MineButton
@onready var build_furnace_button: Button = $UI/Panel/VBoxContainer/BuildFurnaceButton

func _ready() -> void:
	sim.world_node = world
	player.grid_pos = Vector2i(2, 2)
	player.position = sim.grid_to_world(player.grid_pos)
	_setup_resources()
	mine_button.pressed.connect(_on_mine_pressed)
	build_furnace_button.pressed.connect(_on_build_furnace_pressed)
	_update_ui()

func _process(delta: float) -> void:
	_handle_input()
	sim.tick(delta)
	sim.transfer_player_items_to_furnace(player.grid_pos, player.inventory)
	_update_ui()

func _handle_input() -> void:
	var direction := Vector2i.ZERO
	if Input.is_action_just_pressed("ui_up"):
		direction = Vector2i.UP
	elif Input.is_action_just_pressed("ui_down"):
		direction = Vector2i.DOWN
	elif Input.is_action_just_pressed("ui_left"):
		direction = Vector2i.LEFT
	elif Input.is_action_just_pressed("ui_right"):
		direction = Vector2i.RIGHT
	if direction != Vector2i.ZERO:
		player.move(direction, sim)

func _setup_resources() -> void:
	_add_resource(Vector2i(4, 2), Constants.ITEM_STONE, 20)
	_add_resource(Vector2i(6, 2), Constants.ITEM_COAL, 20)
	_add_resource(Vector2i(8, 2), Constants.ITEM_IRON_ORE, 20)
	_add_resource(Vector2i(10, 2), Constants.ITEM_COPPER_ORE, 20)

func _add_resource(pos: Vector2i, resource: String, amount: int) -> void:
	var node: ResourceNode = ResourceNode.new()
	node.setup(resource, amount)
	node.position = sim.grid_to_world(pos)
	world.add_child(node)
	sim.register_resource(node)

func _on_mine_pressed() -> void:
	player.mine(sim)

func _on_build_furnace_pressed() -> void:
	sim.build_furnace_at(player.grid_pos, player.inventory)

func _update_ui() -> void:
	inventory_label.text = "Inventory:\n" \
		+ "Stone: %d\n" % player.inventory.get(Constants.ITEM_STONE, 0) \
		+ "Coal: %d\n" % player.inventory.get(Constants.ITEM_COAL, 0) \
		+ "Iron ore: %d\n" % player.inventory.get(Constants.ITEM_IRON_ORE, 0) \
		+ "Copper ore: %d\n" % player.inventory.get(Constants.ITEM_COPPER_ORE, 0) \
		+ "Iron plate: %d\n" % player.inventory.get(Constants.ITEM_IRON_PLATE, 0) \
		+ "Copper plate: %d" % player.inventory.get(Constants.ITEM_COPPER_PLATE, 0)

	var furnace: Furnace = sim.get_furnace_at(player.grid_pos)
	if furnace == null:
		furnace_label.text = "Furnace: (stand on a furnace)"
		return
	furnace_label.text = "Furnace:\n" \
		+ "Fuel (coal): %d\n" % furnace.count(Constants.ITEM_COAL) \
		+ "Iron ore: %d\n" % furnace.count(Constants.ITEM_IRON_ORE) \
		+ "Copper ore: %d\n" % furnace.count(Constants.ITEM_COPPER_ORE) \
		+ "Iron plate: %d\n" % furnace.count(Constants.ITEM_IRON_PLATE) \
		+ "Copper plate: %d\n" % furnace.count(Constants.ITEM_COPPER_PLATE) \
		+ "Progress: %.1fs" % furnace.smelt_progress
