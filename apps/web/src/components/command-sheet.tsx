'use client';

import {
  AiCommandAction,
  Gender,
  Grade,
  IAiCommandResult,
  IAiGuestDraft,
  IMember,
  IAttendance,
  IGame,
  IAiCommandTarget,
  IGameRecommendation,
  IPushCallResult,
  RecommendationCategory,
} from '@letscok/shared-types';
import { useMemo, useState } from 'react';
import { GradeBadge } from '@/components/badges';
import { GRADES } from '@/components/multi-member-form';
import { Sheet } from '@/components/sheet';
import { api, ApiError } from '@/lib/api';
import { fixSpeech } from '@/lib/speech-fix';
import { useSpeech } from '@/lib/use-speech';

// AI 운영 명령 — 문장을 보내면 서버가 미리보기만 돌려주고, 운영진이 [확인]해야 기존 API로 실행한다
// (체크인만 예외: 기존 AI 체크인 규칙대로 확실한 사람은 바로 체크인된다)

const EXAMPLES = ['남복 짜줘', '민수랑 준호 넣어서 혼복', '3번 코트 끝났어', '민수 휴식', '홍길동 체크인', '게스트 홍길동 남자 C급 추가', '누가 제일 오래 기다렸어?'];

const CATEGORY_LABEL: Record<RecommendationCategory, string> = {
  ALL: '전체',
  MENS: '남복',
  WOMENS: '여복',
  MIXED: '혼복',
  OTHER: '기타 3:1',
};
const ACTION_LABEL: Record<Exclude<AiCommandAction, 'make_game'>, string> = {
  finish_game: '게임 종료',
  rest: '휴식',
  resume: '복귀',
  call: '호출',
};

type ChooseResult = Extract<IAiCommandResult, { kind: 'choose' }>;
type ActionPreview = Extract<IAiCommandResult, { kind: 'action_preview' }>;

// 미리보기를 보는 사이 다른 운영진이 바꾼 것 — 실시간 스냅샷으로 다시 확인해 표시한다(서버 규칙이 최종 판단)
interface Live {
  attendances: IAttendance[];
  games: IGame[];
}

// 추천 받을 때 상태와 지금 상태를 비교 — 바뀌었으면 이유 한 줄
function playerChange(live: Live, attendanceId: string, borrowedFrom: 'QUEUED' | 'PLAYING' | null): string | null {
  const a = live.attendances.find((x) => x.id === attendanceId);
  if (!a || a.status === 'LEFT') return '퇴장했어요';
  if (!a.shuttleConfirmedAt) return '콕 확인이 취소됐어요';
  if (a.status === 'RESTING') return '휴식 중이에요';
  if (borrowedFrom === null && a.status === 'MATCHED') return '그 사이 다른 조합에 들어갔어요';
  if (borrowedFrom !== 'PLAYING' && a.status === 'PLAYING') return '그 사이 게임을 시작했어요';
  return null;
}

function sameQueued(live: Live, ids: string[]): boolean {
  const key = [...ids].sort().join('|');
  return live.games.some(
    (g) => g.status === 'QUEUED' && (g.players ?? []).map((p) => p.attendanceId).sort().join('|') === key,
  );
}

// 게임 종료·휴식·복귀를 그 사이 다른 운영진이 이미 처리했는지
function actionStale(live: Live, preview: ActionPreview): string | null {
  if (preview.action === 'finish_game') {
    return live.games.some((g) => g.id === preview.gameId && g.status === 'PLAYING') ? null : '이미 끝난 게임이에요';
  }
  const statuses = preview.targets.map((t) => live.attendances.find((a) => a.id === t.attendanceId)?.status);
  if (statuses.some((s) => s === undefined || s === 'LEFT')) return '퇴장한 사람이 있어요';
  if (preview.action === 'rest' && statuses.every((s) => s === 'RESTING')) return '이미 휴식 중이에요';
  if (preview.action === 'resume' && statuses.every((s) => s !== 'RESTING')) return '이미 복귀했어요';
  return null;
}

export function CommandSheet({
  sessionId,
  live,
  run,
  onClose,
}: {
  sessionId: string;
  live: Live; // 관제판 실시간 스냅샷(출석·게임)
  run: (a: () => Promise<unknown>) => Promise<void>; // 실행은 보드 공용 실행기(실패 알림·새로고침)
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<IAiCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // 실행 결과 한 줄(호출 "2대 전송" 등)
  // 음성 인식이 잘못 적은 용어·이름을 바로잡을 기준 — 오늘 온 사람(퇴장 제외)
  const names = useMemo(
    () => live.attendances.filter((a) => a.status !== 'LEFT').map((a) => a.member?.name ?? '').filter(Boolean),
    [live.attendances],
  );
  const [heardRaw, setHeardRaw] = useState<string | null>(null); // 바로잡기 전 들린 말 — 고쳤을 때만 작게 보여 준다
  // 음성 — 다 들으면 바로잡아 입력칸에 채우고 바로 보낸다(틀렸으면 고쳐서 다시 보내면 된다)
  const speech = useSpeech((heard) => {
    const fixed = fixSpeech(heard, names);
    setHeardRaw(fixed !== heard ? heard : null);
    setText(fixed);
    void send(fixed);
  });

  const send = async (value = text) => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    setResult(null);
    try {
      setResult(
        await api<IAiCommandResult>(`/sessions/${sessionId}/ai-command`, {
          method: 'POST',
          admin: true,
          body: { text: trimmed },
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '명령을 처리하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSending(false);
    }
  };

  // 동명이인을 다 고른 뒤 — 게임 짜기는 id로 추천을 다시 받고(AI 재호출 없음), 나머지는 바로 미리보기로
  const afterChoose = async (choose: ChooseResult, picked: IAiCommandTarget[]) => {
    const targets = [...choose.resolved, ...picked];
    if (choose.action === 'make_game') {
      setSending(true);
      setError(null);
      try {
        const query = new URLSearchParams({
          category: choose.category,
          fixed: targets.map((t) => t.attendanceId).join(','),
        });
        const recommendations = await api<IGameRecommendation[]>(
          `/sessions/${sessionId}/game-recommendations?${query}`,
          { admin: true },
        );
        setResult(
          recommendations.length > 0
            ? { kind: 'game_preview', category: choose.category, recommendations }
            : { kind: 'message', text: '지금 대기 인원으로는 조합을 만들 수 없어요.' },
        );
      } catch (e) {
        setError(e instanceof ApiError ? e.message : '추천을 받지 못했어요.');
      } finally {
        setSending(false);
      }
      return;
    }
    setResult({
      kind: 'action_preview',
      action: choose.action,
      label: `${targets.map((t) => t.name).join(', ')} ${ACTION_LABEL[choose.action]}`,
      gameId: null,
      targets,
    });
  };

  const execute = (preview: ActionPreview) =>
    void run(async () => {
      if (preview.action === 'finish_game' && preview.gameId) {
        await api(`/games/${preview.gameId}/finish`, { method: 'PATCH', admin: true });
        onClose();
        return;
      }
      if (preview.action === 'call') {
        let devices = 0;
        for (const t of preview.targets) {
          devices += (await api<IPushCallResult>(`/attendances/${t.attendanceId}/call`, { method: 'POST', admin: true })).devices;
        }
        // 호출은 결과를 보여 주고 시트를 닫지 않는다(알림 미등록이면 직접 불러야 해서)
        setResult(null);
        setNotice(devices > 0 ? `${devices}대에 알림을 보냈어요` : '알림을 등록하지 않은 분이에요. 직접 불러주세요');
        return;
      }
      for (const t of preview.targets) {
        await api(`/attendances/${t.attendanceId}/${preview.action}`, { method: 'PATCH' });
      }
      onClose();
    });

  // 게스트 추가 — 새 게스트는 등록 후 체크인, 등록된 게스트는 체크인만(수동 체크인과 같은 API). 콕 확인은 명단에서 따로
  // 한 명이 실패해도 나머지는 계속하고 결과를 한 줄로 — 시트는 닫지 않는다(실패한 사람을 확인할 수 있게)
  const addGuests = (guests: GuestPick[]) =>
    void run(async () => {
      const failed: string[] = [];
      for (const guest of guests) {
        try {
          const memberId =
            guest.existingMemberId ??
            (
              await api<IMember>('/members', {
                method: 'POST',
                admin: true,
                body: { name: guest.name, gender: guest.gender, grade: guest.grade, isGuest: true },
              })
            ).id;
          await api(`/sessions/${sessionId}/attendances/manual`, { method: 'POST', admin: true, body: { memberId } });
        } catch (e) {
          failed.push(`${guest.name}(${e instanceof ApiError ? e.message : '실패'})`);
        }
      }
      const ok = guests.length - failed.length;
      setResult(null);
      setNotice(
        [
          ok > 0 ? `게스트 ${ok}명 체크인했어요. 콕을 내면 명단 맨 위에서 [콕 확인]을 눌러 주세요` : '',
          failed.length > 0 ? `못 한 사람: ${failed.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );
    });

  const addGame = (recommendation: IGameRecommendation) =>
    void run(async () => {
      await api(`/sessions/${sessionId}/games`, {
        method: 'POST',
        admin: true,
        body: { attendanceIds: recommendation.players.map((p) => p.attendanceId) },
      });
      onClose();
    });

  return (
    <Sheet
      ariaLabel="AI 명령"
      dismissible={false} // 명령을 고치는 중일 수 있어 바깥 배경 탭으로는 닫지 않음
      onClose={onClose}
      header={
        <>
          <h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">🎙 명령</h2>
          <p className="min-w-0 text-xs text-faint">말하듯 적으면 확인 후 실행해요</p>
        </>
      }
      footer={
        <div className="flex gap-2">
          {speech.supported && (
            <button
              onClick={speech.listening ? speech.stop : speech.start}
              disabled={sending}
              aria-label={speech.listening ? '말 끝' : '눌러서 말하기'}
              className={`h-12 w-12 shrink-0 rounded-xl border text-xl disabled:opacity-50 ${
                speech.listening ? 'border-coral bg-coral/15' : 'border-court/40'
              }`}
            >
              {speech.listening ? '■' : '🎙'}
            </button>
          )}
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setHeardRaw(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send();
            }}
            autoComplete="off"
            enterKeyHint="send"
            maxLength={200}
            placeholder="말하듯 적어 주세요"
            className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-panel2 px-4 text-sm outline-none placeholder:text-faint focus:border-court"
          />
          <button
            onClick={() => void send()}
            disabled={sending || !text.trim()}
            className="h-12 shrink-0 rounded-xl bg-court px-5 text-sm font-bold text-bg disabled:opacity-50"
          >
            보내기
          </button>
        </div>
      }
    >
      {speech.listening && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="relative flex h-16 w-16 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-court/30" />
            <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-court/20 text-3xl">🎙</span>
          </span>
          <p className="text-sm font-medium text-court">듣고 있어요… 말이 끝나면 저절로 멈춰요</p>
          <p className="min-h-6 text-lg font-bold">{fixSpeech(speech.interim, names)}</p>
          <div className="flex gap-2">
            <button onClick={speech.stop} className="h-12 rounded-xl bg-court px-6 text-sm font-bold text-bg">
              말 끝
            </button>
            <button onClick={speech.cancel} className="h-12 rounded-xl border border-line px-5 text-sm text-dim">
              취소
            </button>
          </div>
        </div>
      )}
      {heardRaw && !speech.listening && (
        <p className="text-xs text-faint">들린 말 &ldquo;{heardRaw}&rdquo;을 바로잡았어요</p>
      )}
      {speech.error && !speech.listening && (
        <p className="rounded-xl border border-coral/40 bg-coral/10 p-3 text-sm text-coral">{speech.error}</p>
      )}
      {!speech.listening && !result && !sending && !error && !notice && (
        <>
          {speech.supported && (
            <button
              onClick={speech.start}
              className="flex h-20 items-center justify-center gap-3 rounded-2xl border border-court/40 bg-court/10 text-base font-bold text-court"
            >
              <span className="text-2xl">🎙</span> 눌러서 말하기
            </button>
          )}
          <p className="text-xs text-dim">이렇게 말해 보세요</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => setText(example)}
                className="h-9 rounded-full border border-line px-3 text-sm text-dim"
              >
                {example}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-faint">
            게임 짜기·게임 종료·휴식·복귀·호출·게스트 추가는 미리보기를 보고 [확인]해야 실행돼요. 체크인은 이름이 정확히
            맞는 사람만 바로 처리돼요.
          </p>
        </>
      )}
      {!speech.listening && sending && <p className="py-6 text-center text-sm text-court">알아듣는 중이에요…</p>}
      {error && <p className="rounded-xl border border-coral/40 bg-coral/10 p-3 text-sm text-coral">{error}</p>}
      {notice && <p className="rounded-xl border border-court/40 bg-court/10 p-3 text-sm text-court">✓ {notice}</p>}
      {result && !sending && (
        <ResultView
          result={result}
          live={live}
          onAddGame={addGame}
          onExecute={execute}
          onChosen={afterChoose}
          onAddGuests={addGuests}
        />
      )}
    </Sheet>
  );
}

function ResultView({
  result,
  live,
  onAddGame,
  onExecute,
  onChosen,
  onAddGuests,
}: {
  result: IAiCommandResult;
  live: Live;
  onAddGame: (r: IGameRecommendation) => void;
  onExecute: (p: ActionPreview) => void;
  onChosen: (c: ChooseResult, picked: IAiCommandTarget[]) => void;
  onAddGuests: (guests: GuestPick[]) => void;
}) {
  switch (result.kind) {
    case 'guest_preview':
      return <GuestPreview guests={result.guests} onConfirm={onAddGuests} />;
    case 'message':
      return <p className="rounded-xl border border-line bg-panel2 p-3 text-sm text-dim">{result.text}</p>;
    // 상황 질문 답 — 숫자는 서버가 지금 현황으로 계산(실행할 것이 없어 버튼 없음)
    case 'answer':
      return (
        <div className="flex flex-col gap-1.5 rounded-xl border border-court/40 bg-court/5 p-4">
          <p className="text-xs font-medium text-court">{result.title}</p>
          {result.lines.map((line, i) => (
            <p key={i} className="text-base font-medium whitespace-normal">
              {line}
            </p>
          ))}
        </div>
      );
    case 'check_in':
      return (
        <p className="rounded-xl border border-court/40 bg-court/10 p-3 text-sm leading-relaxed">{result.result.message}</p>
      );
    case 'game_preview':
      return (
        <GamePreview category={result.category} recommendations={result.recommendations} live={live} onAdd={onAddGame} />
      );
    case 'action_preview': {
      const stale = actionStale(live, result);
      return (
        <div className="flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/5 p-4">
          <p className="text-base font-bold">{result.label}</p>
          {stale && <p className="text-sm font-medium text-coral">⚠ {stale} — 다른 운영진이 먼저 처리했을 수 있어요</p>}
          <button
            onClick={() => onExecute(result)}
            disabled={!!stale}
            className={`h-12 rounded-xl text-sm font-bold disabled:bg-panel2 disabled:text-faint ${
              result.action === 'finish_game' ? 'bg-court text-bg' : 'bg-amber text-bg'
            }`}
          >
            확인 — {ACTION_LABEL[result.action]}
          </button>
        </div>
      );
    }
    case 'choose':
      return <ChooseView choose={result} onDone={(picked) => onChosen(result, picked)} />;
  }
}

// 추천 미리보기 — 지정 인원은 (지정), [다른 추천]은 같은 결과의 2·3순위로(추가 호출 없음)
function GamePreview({
  category,
  recommendations,
  live,
  onAdd,
}: {
  category: RecommendationCategory;
  recommendations: IGameRecommendation[];
  live: Live;
  onAdd: (r: IGameRecommendation) => void;
}) {
  const [index, setIndex] = useState(0);
  const current = recommendations[index];
  const changes = current.players.map((p) => playerChange(live, p.attendanceId, p.borrowedFrom));
  const duplicate = sameQueued(live, current.players.map((p) => p.attendanceId));
  // 퇴장·콕 취소·휴식은 서버가 어차피 거절 — 미리 막는다. 다른 조합·게임에 들어간 건 겹침 허용이라 경고만
  const blocked = duplicate || changes.some((c) => c === '퇴장했어요' || c === '콕 확인이 취소됐어요' || c === '휴식 중이에요');
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/5 p-4">
      <p className="text-xs font-bold text-amber">
        {CATEGORY_LABEL[category]} · {current.genderLabel} · 추천 {index + 1}/{recommendations.length}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {current.players.map((p, i) => (
          <div
            key={p.attendanceId}
            className={`flex flex-col gap-0.5 rounded-lg border bg-panel2 p-2 text-sm ${
              changes[i] ? 'border-coral/50' : 'border-line'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <GradeBadge grade={p.grade} />
              <span className="min-w-0 truncate font-medium">{p.name}</span>
              {p.pinned && <span className="shrink-0 text-[11px] text-court">지정</span>}
            </span>
            {changes[i] && <span className="text-[11px] text-coral">{changes[i]}</span>}
          </div>
        ))}
      </div>
      {duplicate && <p className="text-sm font-medium text-coral">⚠ 같은 4명 조합이 이미 대기 중이에요 — 다른 운영진이 먼저 넣었어요</p>}
      {current.repeatPairCount > 0 && (
        <p className="text-xs text-dim">오늘 같이 친 짝 {current.repeatPairCount}쌍</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => onAdd(current)}
          disabled={blocked}
          className="h-12 flex-1 rounded-xl bg-amber text-sm font-bold text-bg disabled:bg-panel2 disabled:text-faint"
        >
          대기 조합에 넣기
        </button>
        {recommendations.length > 1 && (
          <button
            onClick={() => setIndex((i) => (i + 1) % recommendations.length)}
            className="h-12 shrink-0 rounded-xl border border-line px-4 text-sm text-dim"
          >
            다른 추천
          </button>
        )}
      </div>
    </div>
  );
}

// 동명이인 고르기 — 이름마다 후보 하나씩 고르면 [계속]
function ChooseView({ choose, onDone }: { choose: ChooseResult; onDone: (picked: IAiCommandTarget[]) => void }) {
  const [picked, setPicked] = useState<Record<string, IAiCommandTarget>>({});
  const done = choose.unresolved.every((u) => picked[u.name]);
  return (
    <div className="flex flex-col gap-3">
      {choose.unresolved.map((u) => (
        <div key={u.name} className="flex flex-col gap-2">
          <p className="text-sm font-medium">어느 {u.name}님인가요?</p>
          <div className="flex flex-wrap gap-2">
            {u.candidates.map((c) => (
              <button
                key={c.attendanceId}
                onClick={() => setPicked((prev) => ({ ...prev, [u.name]: c }))}
                className={`h-11 rounded-xl border px-3 text-sm ${
                  picked[u.name]?.attendanceId === c.attendanceId
                    ? 'border-court bg-court/15 font-bold text-court'
                    : 'border-line text-ink'
                }`}
              >
                {c.name} <span className="text-xs text-dim">{c.detail}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <button
        onClick={() => onDone(Object.values(picked))}
        disabled={!done}
        className="h-12 rounded-xl bg-court text-sm font-bold text-bg disabled:opacity-50"
      >
        계속
      </button>
    </div>
  );
}

// 확인을 누를 때 넘기는 게스트 — 성별·급수가 다 채워진 것
type GuestPick = { name: string; gender: Gender; grade: Grade; existingMemberId: string | null };

// 게스트 추가 미리보기 — 말한 성별·급수는 미리 골라 두고, 빠진 것만 눌러 채운다. 등록된 게스트는 저장값 그대로(체크인만)
function GuestPreview({ guests, onConfirm }: { guests: IAiGuestDraft[]; onConfirm: (picks: GuestPick[]) => void }) {
  const [picks, setPicks] = useState(() => guests.map((g) => ({ gender: g.gender, grade: g.grade })));
  const todo = guests.map((g, i) => ({ ...g, ...picks[i] })).filter((g) => !g.alreadyCheckedIn);
  const ready = todo.length > 0 && todo.every((g) => g.gender && g.grade);
  const set = (index: number, patch: Partial<{ gender: Gender; grade: Grade }>) =>
    setPicks((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const chip = (on: boolean) =>
    `h-9 min-w-9 rounded-lg border px-2 text-sm font-medium ${on ? 'border-court bg-court/15 text-court' : 'border-line text-dim'}`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/5 p-4">
      <p className="text-base font-bold">게스트 추가</p>
      {guests.map((guest, i) => (
        <div key={guest.name} className="flex flex-col gap-2 rounded-lg bg-panel2 p-3">
          <div className="flex items-center gap-2">
            <span className="font-bold">{guest.name}</span>
            <span className="text-xs text-faint">
              {guest.alreadyCheckedIn ? '오늘 이미 출석했어요' : guest.existingMemberId ? '등록된 게스트 — 체크인만' : '새 게스트'}
            </span>
          </div>
          {guest.note && <p className="text-xs text-amber whitespace-normal">{guest.note}</p>}
          {!guest.alreadyCheckedIn && !guest.existingMemberId && (
            <>
              <div className="flex gap-1.5">
                {(['MALE', 'FEMALE'] as const).map((g) => (
                  <button key={g} onClick={() => set(i, { gender: g })} className={chip(picks[i].gender === g)}>
                    {g === 'MALE' ? '남' : '여'}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {GRADES.map((grade) => (
                  <button key={grade} onClick={() => set(i, { grade })} className={chip(picks[i].grade === grade)}>
                    {grade}
                  </button>
                ))}
              </div>
            </>
          )}
          {guest.existingMemberId && !guest.alreadyCheckedIn && guest.grade && (
            <p className="flex items-center gap-1.5 text-xs text-dim">
              <GradeBadge grade={guest.grade} /> {guest.gender === 'FEMALE' ? '여' : '남'}
            </p>
          )}
        </div>
      ))}
      <button
        onClick={() =>
          onConfirm(
            todo.map((g) => ({ name: g.name, gender: g.gender!, grade: g.grade!, existingMemberId: g.existingMemberId })),
          )
        }
        disabled={!ready}
        className="h-12 rounded-xl bg-court text-base font-bold text-bg disabled:bg-panel2 disabled:text-faint"
      >
        {todo.length === 0 ? '체크인할 게스트가 없어요' : ready ? `게스트 ${todo.length}명 체크인` : '성별과 급수를 골라 주세요'}
      </button>
    </div>
  );
}
