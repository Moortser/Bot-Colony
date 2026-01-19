extends Node

const RECIPES := {
	"gear": {
		"output": {"item": "gear", "amount": 1},
		"cost": {"iron_plate": 2},
	},
	"wire": {
		"output": {"item": "wire", "amount": 1},
		"cost": {"copper_plate": 1},
	},
	"circuit": {
		"output": {"item": "circuit", "amount": 1},
		"cost": {"wire": 2, "iron_plate": 1},
	},
	"chassis": {
		"output": {"item": "chassis", "amount": 1},
		"cost": {"iron_plate": 4, "gear": 2},
	},
}
