// patch.gg 의 patch-block 도우미 대신 쓰는 최소 대체입니다(이 레포의 코드, MIT).
// 장면 코드가 부르는 progress · ready · state 를 받아 두고, 탭이 가려지면 onVisible(false) 를 알려요.
export function patchBlock(options = {}) {
  let visible = !document.hidden;
  document.addEventListener('visibilitychange', () => {
    if (visible === !document.hidden) return;
    visible = !document.hidden;
    options.onVisible?.(visible);
  });
  return {
    progress(value, label) {
      window.dispatchEvent(new CustomEvent('oil-progress', { detail: { value, label } }));
    },
    ready() {
      window.dispatchEvent(new CustomEvent('oil-ready'));
    },
    state() {},
    get visible() {
      return visible;
    },
  };
}
