import './style.css';
import { startGame } from './controller/gameController.ts';

const container = document.getElementById('scene-container');
if (!container) {
  throw new Error('main.ts: #scene-container not found in index.html');
}

startGame(container);
