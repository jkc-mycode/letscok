'use client';

import {
  IAiCheckInResult,
  IAiCheckInStatus,
  IAttendance,
  IMember,
} from '@letscok/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GenderMarker, GradeBadge } from '@/components/badges';
import { ClearableInput } from '@/components/clearable-input';
import { SparkleIcon } from '@/components/icons';
import { AiThinking } from '@/components/logo-loader';
import { api, ApiError } from '@/lib/api';
import { shrinkImage } from '@/lib/image';

// AI 체크인 — 참석 신청 목록 캡처나 자연어 명령으로 확실한 사람만 자동 체크인한다
// 판단(누구를 체크인할지)은 서버의 결정적 규칙이 하고, 여기선 결과를 보여주고 남은 사람을 버튼으로 처리하게 돕는다

const MAX_IMAGES = 4; // 서버 한도 — 사진은 lib/image의 shrinkImage로 줄여서 보낸다

interface LogEntry {
  id: number;
  input: string; // "캡처 3장" 또는 입력한 명령
  result: IAiCheckInResult;
}

export function AiCheckInPanel({
  sessionId,
  attendances,
  run,
}: {
  sessionId: string;
  attendances: IAttendance[];
  run: (a: () => Promise<unknown>) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<{ steps: string[]; note?: string } | null>(null); // 처리 중 안내(단계 문구)
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]); // 이번 모달에서만 유지 — 서버 저장 없음
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  // 서버에 AI 키가 없으면 영역 자체를 숨긴다
  useEffect(() => {
    api<IAiCheckInStatus>('/ai-check-in/status', { admin: true })
      .then((status) => setEnabled(status.enabled))
      .catch(() => setEnabled(false));
  }, []);

  // 결과 카드의 버튼 상태(출석 중·취소 가능)는 실시간 스냅샷 기준으로 판단
  const attendanceByMemberId = useMemo(
    () => new Map(attendances.map((a) => [a.memberId, a])),
    [attendances],
  );

  const submit = async (
    input: string,
    request: () => Promise<IAiCheckInResult>,
    label: { steps: string[]; note?: string },
  ) => {
    if (working) return;
    setWorking(label);
    setError(null);
    try {
      const result = await request();
      setLog((prev) => [{ id: nextId.current++, input, result }, ...prev]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '요청에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setWorking(null);
    }
  };

  const uploadImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (files.length > MAX_IMAGES) {
      setError(`캡처는 한 번에 ${MAX_IMAGES}장까지 올릴 수 있어요. 나눠서 올려주세요.`);
      return;
    }
    const list = [...files];
    await submit(
      `캡처 ${list.length}장`,
      async () => {
        const form = new FormData();
        for (const [i, file] of list.entries()) {
          form.append('images', await shrinkImage(file), `capture-${i + 1}.jpg`);
        }
        return api<IAiCheckInResult>(`/sessions/${sessionId}/ai-check-in/images`, {
          method: 'POST',
          admin: true,
          body: form,
        });
      },
      {
        steps: ['캡처를 올리는 중이에요', '명단을 읽는 중이에요', '출석자와 맞춰 보는 중이에요'],
        note: '캡처가 많으면 수십 초 걸릴 수 있어요',
      },
    );
  };

  const sendCommand = async () => {
    const text = command.trim();
    if (!text) return;
    await submit(
      text,
      () =>
        api<IAiCheckInResult>(`/sessions/${sessionId}/ai-check-in/command`, {
          method: 'POST',
          admin: true,
          body: { text },
        }),
      { steps: ['명령을 알아듣는 중이에요', '출석자와 맞춰 보는 중이에요'] },
    );
    setCommand('');
  };

  // 후보 버튼 = 기존 수동 체크인 / 취소 버튼 = 기존 사전 체크인 취소(콕 확인 전만)
  const checkIn = (memberId: string) =>
    run(() =>
      api(`/sessions/${sessionId}/attendances/manual`, {
        method: 'POST',
        admin: true,
        body: { memberId },
      }),
    );
  const cancel = (attendanceId: string) =>
    run(() => api(`/attendances/${attendanceId}`, { method: 'DELETE', admin: true }));

  if (!enabled) return null;

  return (
    <div className="mb-3 rounded-xl bg-court/5 p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm font-bold whitespace-normal text-court"
      >
        <SparkleIcon /> AI 체크인 — 신청 명단 캡처·명령
        <span className="ml-auto shrink-0 text-xs font-normal text-dim">{open ? '접기' : '열기'}</span>
      </button>

      {/* 스크롤은 감싸는 수동 체크인 팝업이 맡는다(이중 스크롤 방지) */}
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void uploadImages(e.target.files);
              e.target.value = ''; // 같은 파일을 다시 골라도 onChange가 오게
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={!!working}
            className="min-h-11 rounded-xl bg-court px-3 text-sm font-bold whitespace-normal text-bg disabled:opacity-50"
          >
            참석 신청 목록 캡처 올리기 (최대 {MAX_IMAGES}장)
          </button>
          <div className="flex gap-2">
            <ClearableInput
              autoComplete="off"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void sendCommand()}
              maxLength={200}
              placeholder="예: 97년생 김민수 체크인해줘"
              className="h-11 rounded-xl border-2 border-transparent bg-panel2 px-3 text-sm outline-none focus:border-court"
              onClear={() => setCommand('')}
              wrapperClassName="min-w-0 flex-1"
            />
            <button
              onClick={() => void sendCommand()}
              disabled={!!working || !command.trim()}
              className="h-11 shrink-0 rounded-xl bg-court/10 px-3 text-sm font-medium text-court disabled:opacity-50"
            >
              실행
            </button>
          </div>
          <p className="text-caption text-faint">
            성+이름이 명단의 한 명과 정확히 맞을 때만 자동으로 체크인해요. 동명이인·이름만 적힌 경우는
            아래 후보 버튼으로, 못 찾은 사람은 검색으로 직접 체크인해주세요.
          </p>

          {working && <AiThinking steps={working.steps} note={working.note} />}
          {error && <p className="text-xs font-medium text-coral">{error}</p>}

          {log.map((entry) => (
            <ResultCard
              key={entry.id}
              entry={entry}
              attendanceByMemberId={attendanceByMemberId}
              onCheckIn={checkIn}
              onCancel={cancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({
  entry,
  attendanceByMemberId,
  onCheckIn,
  onCancel,
}: {
  entry: LogEntry;
  attendanceByMemberId: Map<string, IAttendance>;
  onCheckIn: (memberId: string) => Promise<void>;
  onCancel: (attendanceId: string) => Promise<void>;
}) {
  const { input, result } = entry;
  const present = (memberId: string) => {
    const status = attendanceByMemberId.get(memberId)?.status;
    return status !== undefined && status !== 'LEFT';
  };

  return (
    <div className="rounded-xl bg-panel2 p-3 text-sm">
      <p className="truncate text-caption text-faint">{input}</p>
      <p className="mt-1 font-medium">{result.message}</p>

      {/* 이번에 체크인된 사람 — 잘못 잡혔으면 바로 취소(콕 확인 전·게임 기록 없을 때만 서버가 허용) */}
      {result.checkedIn.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.checkedIn.map((m) => {
            const attendance = attendanceByMemberId.get(m.memberId);
            const cancellable = attendance?.status === 'CHECKED_IN' && !attendance.shuttleConfirmedAt;
            return (
              <span
                key={m.memberId}
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                  attendance ? 'border-court/40 bg-court/10 text-court' : 'border-line text-faint line-through'
                }`}
              >
                {m.name}
                {cancellable && (
                  <button
                    onClick={() => void onCancel(attendance.id)}
                    title="잘못 체크인됐으면 취소"
                    className="tap text-dim hover:text-coral"
                  >
                    ✕
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {result.alreadyIn.length > 0 && (
        <p className="mt-2 text-xs text-dim">이미 출석: {result.alreadyIn.map((m) => m.name).join(', ')}</p>
      )}
      {result.notFound.length > 0 && (
        <p className="mt-2 text-xs text-amber">못 찾음: {result.notFound.join(', ')}</p>
      )}

      {/* 확실하지 않은 사람 — 후보를 보고 운영진이 탭 한 번으로 체크인 */}
      {result.ambiguous.map((item) => (
        <div key={item.name} className="mt-2">
          <p className="text-xs text-amber">{item.name} — 누구인가요?</p>
          <div className="mt-1 flex flex-col gap-1">
            {item.candidates.map((candidate: IMember) => {
              const isPresent = present(candidate.id);
              return (
                <button
                  key={candidate.id}
                  onClick={() => !isPresent && void onCheckIn(candidate.id)}
                  disabled={isPresent}
                  className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs ${
                    isPresent ? 'border-line opacity-50' : 'border-amber/40 bg-amber/5'
                  }`}
                >
                  <GradeBadge grade={candidate.grade} />
                  <span className="font-medium">{candidate.name}</span>
                  <GenderMarker gender={candidate.gender} />
                  {candidate.isGuest && <span className="text-caption text-sky">G</span>}
                  <span className="ml-auto text-dim">
                    {isPresent ? '출석 중' : (candidate.birthDate ?? '')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
