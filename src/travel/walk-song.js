// 걷기 곡 고르기: 출발점 둘레 150 m 의 땅 쓰임 비율로 곡을 고릅니다.
// 바다(물)가 20% 를 넘으면 sea, 바위가 35% 를 넘으면 mountain, 나머지는 forest 입니다. 땅 쓰임 격자가 없으면 forest 입니다.
import { coverAt, hasCover, COVER } from '../hwadam/world/cover.js';

const RADIUS = 150;
const STEP = 5;

/** 곡 이름(public/music/<key>.mp3)을 돌려줍니다. x, z 는 걷기 장면의 좌표(m)입니다. */
export function walkSong(x, z) {
  if (!hasCover()) return 'forest';
  let n = 0, sea = 0, rock = 0;
  for (let dx = -RADIUS; dx <= RADIUS; dx += STEP) {
    for (let dz = -RADIUS; dz <= RADIUS; dz += STEP) {
      if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
      const c = coverAt(x + dx, z + dz);
      n++;
      if (c === COVER.WATER) sea++;
      else if (c === COVER.ROCK) rock++;
    }
  }
  if (sea / n > 0.2) return 'sea';
  if (rock / n > 0.35) return 'mountain';
  return 'forest';
}
