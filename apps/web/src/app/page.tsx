'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

// 이스터에그 — 제목의 🏸를 1초 간격 내 10연타하면 셔틀콕 러너(크롬 공룡 게임 변형)가 열린다
const RUNNER_TAPS = 10;
const RUNNER_TAP_GAP_MS = 1000;

// 임시 허브 — 모임원은 보통 /m 링크로 들어와 /checkin(코드 입력)으로 넘어간다
export default function HomePage() {
  const tapCount = useRef(0);
  const lastTapAt = useRef(0);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const closeRunner = useCallback(() => setRunnerOpen(false), []);
  const handleTap = () => {
    const at = Date.now();
    if (at - lastTapAt.current > RUNNER_TAP_GAP_MS) tapCount.current = 0;
    lastTapAt.current = at;
    tapCount.current += 1;
    if (tapCount.current >= RUNNER_TAPS) {
      tapCount.current = 0;
      setRunnerOpen(true);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8">
      <div className="text-center">
        <p className="text-sm font-medium tracking-[0.3em] text-court">LETSCOK</p>
        <h1 className="mt-2 text-4xl font-bold">
          렛츠콕{' '}
          <span onClick={handleTap} className="cursor-default select-none" aria-hidden>
            🏸
          </span>
        </h1>
      </div>
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-3">
          <Link
            href="/admin"
            className="flex h-14 items-center rounded-xl bg-court px-8 font-bold text-bg"
          >
            운영진 관제판
          </Link>
          <Link
            href="/m/checkin"
            className="flex h-14 items-center rounded-xl border border-court px-8 font-bold text-court"
          >
            모임원 체크인
          </Link>
        </div>
        <Link
          href="/admin/history"
          className="flex h-11 items-center rounded-xl border border-line px-6 text-sm font-medium text-dim transition-colors hover:border-court/50"
        >
          🔒 지난 모임 기록
        </Link>
      </div>
      {runnerOpen && <ShuttleRunner onClose={closeRunner} />}
    </main>
  );
}

// ===== 셔틀콕 러너 =====

// 크롬 공룡 게임의 배드민턴 변형 — 🏸가 달리며 다가오는 네트를 점프로 넘는다
// 탭/스페이스 = 점프, 부딪히면 게임 오버, 최고 점수는 이 기기(localStorage)에만 남는다
const BEST_KEY = 'letscok-runner-best';

function ShuttleRunner({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [over, setOver] = useState(false);
  const [round, setRound] = useState(0); // 재시작마다 +1 — 게임 루프 effect를 다시 돌린다

  useEffect(() => {
    setBest(Number(localStorage.getItem(BEST_KEY) ?? 0));
  }, []);

  // 게임 루프 — 상태는 전부 지역 변수(ref 성격), React 상태는 점수 표시·게임오버 전환에만 사용
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 논리 크기 고정 + devicePixelRatio 보정 — 폰·태블릿 어디서든 같은 판
    const W = Math.min(window.innerWidth - 32, 560);
    const H = 240;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    const groundY = H - 36;
    const playerX = 48;
    const playerSize = 30;
    let playerY = groundY - playerSize;
    let vy = 0;
    let onGround = true;
    let speed = 4.5;
    let distance = 0;
    let spawnIn = 60; // 첫 장애물까지 여유
    let raf = 0;
    let ended = false;
    const nets: { x: number; w: number; h: number }[] = [];

    const jump = () => {
      if (ended) return;
      if (onGround) {
        vy = -11.5;
        onGround = false;
      }
    };
    const onPointer = () => jump();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        jump();
      }
    };
    canvas.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);

    const styles = getComputedStyle(document.documentElement);
    const colorLine = styles.getPropertyValue('--color-line').trim() || '#223028';
    const colorDim = styles.getPropertyValue('--color-dim').trim() || '#8ba496';

    const frame = () => {
      // 물리 — 60fps 기준 프레임 단위 (토이 스펙이라 dt 보정 없이 충분)
      vy += 0.65;
      playerY += vy;
      if (playerY >= groundY - playerSize) {
        playerY = groundY - playerSize;
        vy = 0;
        onGround = true;
      }
      speed = Math.min(speed + 0.0012, 11); // 갈수록 빨라진다 (dino와 동일한 긴장 곡선)
      distance += speed * 0.05;
      setScore(Math.floor(distance));

      spawnIn -= 1;
      if (spawnIn <= 0) {
        const h = 28 + Math.random() * 26; // 네트 높이 — 낮으면 여유, 높으면 정점 점프 필요
        nets.push({ x: W + 20, w: 10, h });
        spawnIn = 55 + Math.random() * 60 - speed * 2; // 빨라질수록 간격 체감 유지
      }
      for (const net of nets) net.x -= speed;
      while (nets.length && nets[0].x + nets[0].w < -10) nets.shift();

      // 충돌 — 이모지 여백을 감안해 판정 박스는 살짝 관대하게
      const px = playerX + 5;
      const pw = playerSize - 10;
      const py = playerY + 4;
      const ph = playerSize - 6;
      for (const net of nets) {
        if (px < net.x + net.w && px + pw > net.x && py + ph > groundY - net.h) {
          ended = true;
        }
      }

      // 그리기
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = colorLine;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY + 1);
      ctx.lineTo(W, groundY + 1);
      ctx.stroke();
      for (const net of nets) {
        // 네트 — 기둥 + 그물 가로줄
        ctx.strokeStyle = colorDim;
        ctx.lineWidth = 2;
        ctx.strokeRect(net.x, groundY - net.h, net.w, net.h);
        ctx.lineWidth = 1;
        for (let y = groundY - net.h + 5; y < groundY; y += 6) {
          ctx.beginPath();
          ctx.moveTo(net.x, y);
          ctx.lineTo(net.x + net.w, y);
          ctx.stroke();
        }
      }
      ctx.font = `${playerSize}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText('🏸', playerX, playerY);

      if (ended) {
        setOver(true);
        setBest((prev) => {
          const next = Math.max(prev, Math.floor(distance));
          localStorage.setItem(BEST_KEY, String(next));
          return next;
        });
        return; // 루프 종료 — 재시작은 round 갱신으로 effect 재실행
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [round]);

  const restart = () => {
    setOver(false);
    setScore(0);
    setRound((r) => r + 1);
  };

  return (
    <div className="fade-in fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-bg/95 p-4">
      <div className="flex w-full max-w-[560px] items-center">
        <p className="text-sm font-bold text-court">콕 러너</p>
        <p className="tabular ml-3 font-mono text-sm text-dim">
          {score}점 · 최고 {best}점
        </p>
        <button
          onClick={onClose}
          className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
        >
          닫기
        </button>
      </div>
      <div className="relative rounded-xl border border-line bg-panel p-2">
        <canvas ref={canvasRef} className="touch-none" />
        {over && (
          <button
            onClick={restart}
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-black/50"
          >
            <span className="text-xl font-bold text-white">게임 오버!</span>
            <span className="text-sm text-white/80">탭해서 다시 시작</span>
          </button>
        )}
      </div>
      <p className="text-xs text-faint">탭 또는 스페이스로 점프 — 네트를 넘으세요</p>
    </div>
  );
}
