extends Node2D

const Constants = preload("res://scripts/constants.gd")
const SIM_SCENE = preload("res://scripts/sim.gd")
const RESOURCE_NODE_SCENE = preload("res://scripts/resource_node.gd")
const FURNACE_SCENE = preload("res://scripts/furnace.gd")
const PLAYER_SCENE = preload("res://scripts/player.gd")
const INVENTORY_OVERLAY_SCENE = preload("res://scripts/inventory_overlay.gd")
const ACTIONS_SCRIPT = preload("res://scripts/actions.gd")

@onready var world: Node2D = $World
@onready var units: Node2D = $Units
@onready var sim: Sim = $Systems/Sim
@onready var player: Player = $Units/Prime

@onready var inventory_overlay: Control = $UI/InventoryOverlay

var placement_mode := false
var inventory_open := false

func _ready() -> void:
	sim.world_node = world
	var start_pos: Vector2i = Vector2i(int(sim.world_size.x / 2.0), int(sim.world_size.y / 2.0))
	player.grid_pos = start_pos
	player.position = sim.grid_to_world(start_pos)
	_setup_resources()
	inventory_overlay.setup(player.inventory, _request_furnace_placement)

func _process(delta: float) -> void:
	if Input.is_action_just_pressed("toggle_inventory"):
		inventory_open = not inventory_open
		inventory_overlay.visible = inventory_open
		print("toggle_inventory -> ", inventory_open)
	_handle_input()
	sim.tick(delta)
	sim.transfer_player_items_to_furnace(player.grid_pos, player.inventory)
	if inventory_overlay.visible:
		inventory_overlay.refresh()

func _handle_input() -> void:
	if inventory_open:
		return
	if Input.is_action_just_pressed("ui_cancel"):
		placement_mode = false
	if Input.is_action_just_pressed("mine_action"):
		ACTIONS_SCRIPT.mine_at_player(sim, player)
	if Input.is_action_just_pressed("build_action"):
		_handle_build_action()
	var direction := Vector2i.ZERO
	if Input.is_action_just_pressed("move_up"):
		direction = Vector2i.UP
	elif Input.is_action_just_pressed("move_down"):
		direction = Vector2i.DOWN
	elif Input.is_action_just_pressed("move_left"):
		direction = Vector2i.LEFT
	elif Input.is_action_just_pressed("move_right"):
		direction = Vector2i.RIGHT
	if direction != Vector2i.ZERO:
		player.move(direction, sim)

func _setup_resources() -> void:
	_add_resource(Vector2i(4, 2), Constants.ITEM_STONE, 20)
	_add_resource(Vector2i(6, 2), Constants.ITEM_COAL, 20)
	_add_resource(Vector2i(8, 2), Constants.ITEM_IRON_ORE, 20)
	_add_resource(Vector2i(10, 2), Constants.ITEM_COPPER_ORE, 20)

func _add_resource(pos: Vector2i, resource: String, amount: int) -> void:
	var node: ResourceNode = RESOURCE_NODE_SCENE.new()
	node.setup(resource, amount)
	node.position = sim.grid_to_world(pos)
	world.add_child(node)
	sim.register_resource(node)

func _request_furnace_placement() -> void:
	if ACTIONS_SCRIPT.arm_furnace_placement(player.inventory):
		placement_mode = true

func _handle_build_action() -> void:
	if not placement_mode:
		placement_mode = ACTIONS_SCRIPT.arm_furnace_placement(player.inventory)
		return
	if ACTIONS_SCRIPT.place_furnace(sim, player.grid_pos, player.inventory):
		placement_mode = false
