// Which picture is shown. Each is a whole world of its own, so going from one to the other loads the
// page again with the other named in its address: ?scene=travel (the traveller, and what a bare address shows),
// ?scene=aurora (the first), ?scene=autumn or ?scene=hwadam (the walk). The buttons on the page do it (src/boot.js). It is not a control on Patch's page: a control
// there has to take effect at once, and this can't.
const q = new URLSearchParams(location.search);
export const SCENE = q.get('scene') === 'autumn' ? 'autumn' : q.get('scene') === 'hwadam' ? 'hwadam' : q.get('scene') === 'aurora' ? 'aurora' : 'travel';

/** Goes to the other picture, from its start. Asked for the one already showing, does nothing. */
export function showScene(scene) {
  if (scene === SCENE || !['autumn', 'aurora', 'hwadam'].includes(scene)) return;
  const next = new URLSearchParams(location.search);
  next.set('scene', scene);
  location.search = next.toString();
}
