// 시점 전환 버튼: 걷기 화면 오른쪽 아래. 지금 상태의 반대를 보여 줍니다(3인칭이면 "1인칭으로 보기").
// 캔버스 밖(body)에 붙여, 누를 때 캔버스의 포인터 잠금 요청(src/figure/input.js)으로 번지지 않게 합니다.
import './travel.css';

/** 버튼을 달고 { set(firstPerson) } 를 돌려줍니다. onToggle 은 누를 때 부릅니다. */
export function mountViewToggle(onToggle) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'walk-view';
  button.id = 'walk-view';
  button.addEventListener('mousedown', (e) => e.stopPropagation());
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    button.blur(); // so that Space or Enter does not press it again while he walks
    onToggle();
  });
  document.body.append(button);
  return {
    set(firstPerson) { button.textContent = firstPerson ? '3인칭으로 보기' : '1인칭으로 보기'; },
  };
}
