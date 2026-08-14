import Phaser from "phaser";
import { GameScene } from "./game/GameScene";
import { AppUi } from "./ui/AppUi";
import "./ui/styles.css";

new AppUi();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-canvas",
  backgroundColor: "#101718",
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: false,
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: "100%",
    height: "100%",
  },
  input: {
    activePointers: 3,
  },
  scene: [GameScene],
});
