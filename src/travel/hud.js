// The walk's HUD in travel mode: the place's name in a corner, the keys, and the boundary of the baked square. Near
// its edge a mist comes in and a hint says where to go next (M returns to the map).
import './travel.css';

/** Mounts the HUD. Returns setEdge(0..1) (how far the wanderer is into the boundary) and setName(). */
export function mountHud({ name, keys }) {
  const label = document.createElement('div');
  label.className = 'walk-name';
  label.textContent = name;
  const hint = document.createElement('p');
  hint.className = 'walk-keys';
  hint.textContent = keys;
  const mist = document.createElement('div');
  mist.className = 'walk-edge';
  const note = document.createElement('p');
  note.className = 'walk-edge-hint';
  note.textContent = '여기까지예요. M 을 누르면 지도에서 다른 곳을 고를 수 있어요.';
  document.body.append(label, hint, mist, note);
  return {
    setEdge(v) {
      mist.style.opacity = String(v * 0.9);
      note.style.opacity = String(v > 0.5 ? (v - 0.5) * 2 : 0);
    },
    setName(text) { label.textContent = text; },
    hideKeys() { hint.hidden = true; },
  };
}
