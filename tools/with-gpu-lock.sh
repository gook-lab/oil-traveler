#!/bin/sh
# 사용: tools/with-gpu-lock.sh <명령...>
# 프레임 측정(--time)을 다른 레포와 겹치지 않게 GPU 잠금을 잡고 명령을 돌린다.
# 잠금은 이 스크립트가 직접 만든 경우에만 푼다. 20분 동안 못 잡으면 75 로 끝난다.
L="$HOME/sonix/toy/.gpu-measure.lock"
n=0
until mkdir "$L" 2>/dev/null; do
  n=$((n + 1))
  if [ "$n" -gt 40 ]; then echo "GPU 잠금을 20분째 못 잡음: $L (멈춘 세션의 잠금인지 확인)" >&2; exit 75; fi
  sleep 30
done
trap 'rmdir "$L" 2>/dev/null' EXIT INT TERM
# 명령에 GPU_LOCK_HELD=1 을 넘깁니다. 헤드리스 Chrome 도구는 이 값이 없으면 시작에서 멈춥니다(no-pointer-lock.mjs).
GPU_LOCK_HELD=1 "$@"
