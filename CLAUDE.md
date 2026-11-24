# oil-forest 작업 규칙

계획과 판정 기준은 `PLAN.md` 의 여덟 칸 틀이 원장입니다. 틀의 근거는 `~/sonix/toy/guk-lab-docs/playbooks/game-build-prompt.md` 입니다.

## 원본 코드 — 고치지 않는 곳과 라이선스

- 이 레포는 Patch 의 oil-paint(MIT, 커밋 `804c65f`)를 바탕으로 합니다. `LICENSE` · `LICENCE-NOTES.md` 를 지우지 않습니다.
- `src/oilpaint/` 는 원본 그대로 둡니다. 바꿔야 하면 이유를 PLAN.md 에 적고 따로 커밋합니다.
- 원본 비교용 스냅샷은 `node tools/fetch-upstream.mjs` 로 `upstream/`(gitignore)에 받습니다.
- `lib/patch-block.js` 는 라이선스가 따로 적혀 있지 않아 쓰지 않고, `lib/block-shim.js`(이 레포 코드)로 대신합니다.

## 촬영 · 측정 — 맥에서는 CHROME 지정

```sh
npm run build
CHROME="$(find ~/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64 -path '*MacOS/*' -type f -perm +111 | head -1)" \
  node tools/shots.mjs <시점들> --time --size 2560x1440 --query "scene=hwadam" --out shots/work
```

도구들은 맥에서 ANGLE Metal 을 씁니다(원본은 Windows d3d11).

프레임을 재는 `--time` 측정은 다른 레포(oil-shooter)와 GPU 를 나눠 쓰면 숫자가 부풉니다. 재기 전에 `mkdir ~/sonix/toy/.gpu-measure.lock` 으로 잠그고, 끝나면 `rmdir` 합니다. mkdir 이 실패하면 30초 기다렸다가 다시 시도합니다. 스틸 촬영만 할 때는 잠그지 않습니다.

## 검증 — 화면만 보는 비평가

그림 · 색 · 붓 자국을 바꾼 묶음은 커밋 전에, 바꾼 구간을 찍어 **새** 서브에이전트에게 그림과 "이 구간이 보여 줄 인상" 한 줄만 줍니다. 코드 · diff · 설명은 주지 않습니다. 심각도(치명 · 큼 · 보통 · 사소함)와 함께 고칠 점 다섯 개까지 받고, 치명 · 큼부터 고쳐 다시 찍어 새 비평가에게 보냅니다. 라운드 수와 남은 지적을 PLAN.md 에 적습니다.

- 통과는 치명 · 큼 0개입니다. 새 비평가는 라운드마다 새 보통 · 사소함 지적을 내므로, 보통 이하는 PLAN.md 에 기록만 합니다.
- 만든 쪽이 정할 수 없는 지적(색 토큰 · 장소 해석 · 범위 같은 사용자 결정)은 관문에서 빼고 "사용자 결정 대기"로 넘깁니다.
- 라운드는 다섯 번까지입니다. 넘으면 남은 지적과 함께 "진행 중"으로 적고 멈춥니다.

## 물어볼 일

공개 레포 생성 · push · 배포는 사용자에게 묻습니다.
