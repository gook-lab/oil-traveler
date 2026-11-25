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

프레임을 재는 `--time` 측정은 다른 레포(oil-shooter)와 GPU 를 나눠 쓰면 숫자가 부풉니다. 측정은 `tools/with-gpu-lock.sh <명령>` 으로만 돌립니다. 이 스크립트가 `~/sonix/toy/.gpu-measure.lock` 을 잡고, 직접 잡은 잠금만 풉니다. 잠금을 손으로 `rmdir` 하지 않습니다(남의 잠금을 지운 일이 있었음).

헤드리스 Chrome 을 띄우는 명령은 스틸 촬영 · 검사 도구(place-check · travel-check · cover-check 등)까지 모두 잠금 안에서 돌립니다. 2026-11-24 에 팀원 셋이 잠그지 않고 촬영하는 동안 잰 프레임이 15 → 23 ms 로 흩어졌습니다. 그때 잠금 없는 헤드리스 Chrome 둘이 동시에 떠 있는 것이 확인됐습니다. 빌드 직후 첫 실행은 셰이더 준비로 부풀므로 버리고, 2~3회 중앙값을 적습니다. 이 규칙은 도구가 강제합니다. `tools/with-gpu-lock.sh` 가 명령에 `GPU_LOCK_HELD=1` 을 넘기고, 이 값이 없으면 헤드리스 Chrome 도구(`tools/no-pointer-lock.mjs` 의 `guard` 또는 `requireGpuLock`)는 시작에서 멈춥니다.

## 검증 — 화면만 보는 비평가

그림 · 색 · 붓 자국을 바꾼 묶음은 커밋 전에, 바꾼 구간을 찍어 **새** 서브에이전트에게 그림과 "이 구간이 보여 줄 인상" 한 줄만 줍니다. 코드 · diff · 설명은 주지 않습니다. 심각도(치명 · 큼 · 보통 · 사소함)와 함께 고칠 점 다섯 개까지 받고, 치명 · 큼부터 고쳐 다시 찍어 새 비평가에게 보냅니다. 라운드 수와 남은 지적을 PLAN.md 에 적습니다.

- 통과는 치명 · 큼 0개입니다. 새 비평가는 라운드마다 새 보통 · 사소함 지적을 내므로, 보통 이하는 PLAN.md 에 기록만 합니다.
- 만든 쪽이 정할 수 없는 지적(색 토큰 · 장소 해석 · 범위 같은 사용자 결정)은 관문에서 빼고 "사용자 결정 대기"로 넘깁니다.
- 라운드는 다섯 번까지입니다. 넘으면 남은 지적과 함께 "진행 중"으로 적고 멈춥니다.

## 물어볼 일

공개 레포 생성 · push · 배포는 사용자에게 묻습니다.
