'use client';

import { IMemberSummary } from '@letscok/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { GenderMarker, GradeBadge } from '@/components/badges';
import { api } from '@/lib/api';
import { useBackClose } from '@/lib/back-stack';

// 모임원 생일 캘린더 — 운영진 전용 명단(GET /members)의 생년월일로 그린다 (서버 변경 없음)
// 게스트는 생년월일을 받지 않는 정책이라 정회원만 나온다

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const UPCOMING_DAYS = 30; // 아래 "다가오는 생일" 목록 범위

interface Birthday {
  member: IMemberSummary;
  month: number; // 1~12
  day: number;
}

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// 2월 29일생은 평년엔 2월 28일에 표시한다
function dayInYear(b: Birthday, year: number): number {
  return b.month === 2 && b.day === 29 && !isLeapYear(year) ? 28 : b.day;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// 오늘부터 다음 생일까지 남은 날 수 (오늘이면 0)
function daysUntil(b: Birthday, today: Date): { days: number; date: Date } {
  let date = new Date(today.getFullYear(), b.month - 1, dayInYear(b, today.getFullYear()));
  if (date < today) {
    const next = today.getFullYear() + 1;
    date = new Date(next, b.month - 1, dayInYear(b, next));
  }
  return { days: Math.round((date.getTime() - today.getTime()) / 86_400_000), date };
}

function MemberLine({ member, note }: { member: IMemberSummary; note?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 text-sm">
      <GradeBadge grade={member.grade} />
      <span className="font-medium">{member.name}</span>
      <GenderMarker gender={member.gender} />
      {note && <span className="ml-auto shrink-0 text-xs text-dim">{note}</span>}
    </div>
  );
}

export function BirthdayCalendarModal({ onClose }: { onClose: () => void }) {
  useBackClose(onClose); // 안드로이드 뒤로가기 = 이 팝업 닫기
  const today = useMemo(startOfToday, []);
  const [members, setMembers] = useState<IMemberSummary[] | null>(null); // null = 로딩
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  useEffect(() => {
    api<IMemberSummary[]>('/members', { admin: true })
      .then(setMembers)
      .catch(() => setFailed(true));
  }, []);

  // 삭제·게스트·생년월일 없는 회원은 제외 (birthDate는 "YYYY-MM-DD")
  const birthdays = useMemo<Birthday[]>(
    () =>
      (members ?? [])
        .filter((m) => !m.deletedAt && !m.isGuest && m.birthDate)
        .map((m) => {
          const [, month, day] = (m.birthDate as string).split('-').map(Number);
          return { member: m, month, day };
        }),
    [members],
  );

  // 보고 있는 달의 날짜별 생일자
  const byDay = useMemo(() => {
    const map = new Map<number, IMemberSummary[]>();
    for (const b of birthdays) {
      if (b.month !== view.month) continue;
      const day = dayInYear(b, view.year);
      map.set(day, [...(map.get(day) ?? []), b.member]);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return map;
  }, [birthdays, view]);

  const upcoming = useMemo(
    () =>
      birthdays
        .map((b) => ({ ...b, ...daysUntil(b, today) }))
        .filter((b) => b.days <= UPCOMING_DAYS)
        .sort((a, b) => a.days - b.days || a.member.name.localeCompare(b.member.name, 'ko')),
    [birthdays, today],
  );

  const firstWeekday = new Date(view.year, view.month - 1, 1).getDay();
  const daysInMonth = new Date(view.year, view.month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const isThisMonth = view.year === today.getFullYear() && view.month === today.getMonth() + 1;

  const moveMonth = (delta: number) => {
    setSelectedDay(null);
    setView((v) => {
      const index = v.year * 12 + (v.month - 1) + delta;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });
  };

  const selected = selectedDay !== null ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-2 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-2xl border border-line bg-panel p-4 sm:p-5"
      >
        <div className="flex items-center pb-3">
          <h2 className="text-lg font-bold text-court">🎂 생일 캘린더</h2>
          <span className="ml-2 text-xs text-faint">정회원 {birthdays.length}명</span>
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 scroll-area">
          {failed && <p className="py-6 text-center text-sm text-coral">명단을 불러오지 못했어요</p>}
          {!failed && members === null && <p className="py-6 text-center text-sm text-dim">불러오는 중...</p>}

          {members !== null && (
            <>
              {/* 월 이동 */}
              <div className="flex items-center justify-between">
                <button onClick={() => moveMonth(-1)} className="h-9 w-9 rounded-lg border border-line text-dim">
                  ‹
                </button>
                <button
                  onClick={() => {
                    setSelectedDay(null);
                    setView({ year: today.getFullYear(), month: today.getMonth() + 1 });
                  }}
                  title="이번 달로"
                  className="font-bold"
                >
                  {view.year}년 {view.month}월
                </button>
                <button onClick={() => moveMonth(1)} className="h-9 w-9 rounded-lg border border-line text-dim">
                  ›
                </button>
              </div>

              {/* 달력 — 칸엔 첫 사람 이름만, 같은 날 여러 명이면 +N */}
              <div className="grid grid-cols-7 gap-1 text-center">
                {WEEKDAYS.map((w, i) => (
                  <span
                    key={w}
                    className={`pb-1 text-[11px] ${i === 0 ? 'text-coral' : i === 6 ? 'text-sky' : 'text-faint'}`}
                  >
                    {w}
                  </span>
                ))}
                {cells.map((day, i) => {
                  if (day === null) return <span key={`blank-${i}`} />;
                  const people = byDay.get(day) ?? [];
                  const isToday = isThisMonth && day === today.getDate();
                  return (
                    <button
                      key={day}
                      onClick={() => people.length > 0 && setSelectedDay(day === selectedDay ? null : day)}
                      disabled={people.length === 0}
                      // 오늘 표시는 ring 대신 테두리 — ring은 상자 바깥에 그려져 스크롤 영역 가장자리(토요일 칸)에서 잘린다
                      className={`flex min-h-12 flex-col items-center gap-0.5 rounded-lg border px-0.5 py-1 ${
                        selectedDay === day
                          ? 'border-court bg-court/15'
                          : isToday
                            ? `border-amber ${people.length > 0 ? 'bg-court/5' : ''}`
                            : people.length > 0
                              ? 'border-court/30 bg-court/5'
                              : 'border-transparent'
                      }`}
                    >
                      <span className={`text-[11px] ${isToday ? 'font-bold text-amber' : 'text-dim'}`}>{day}</span>
                      {people.length > 0 && (
                        <span className="w-full truncate text-[10px] font-medium leading-tight text-court">
                          {people[0].name}
                          {people.length > 1 && <span className="text-faint"> +{people.length - 1}</span>}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 날짜를 누르면 그날 생일자 전체 */}
              {selectedDay !== null && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-bold text-court">
                    {view.month}월 {selectedDay}일 생일 {selected.length}명
                  </p>
                  {selected.map((m) => (
                    <MemberLine key={m.id} member={m} />
                  ))}
                </div>
              )}

              {/* 다가오는 생일 — 모임 당일 축하할 사람 찾기용 */}
              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <p className="text-xs font-bold text-dim">다가오는 생일 ({UPCOMING_DAYS}일 안)</p>
                {upcoming.length === 0 && <p className="text-xs text-faint">한 달 안에 생일인 정회원이 없어요</p>}
                {upcoming.map((b) => (
                  <MemberLine
                    key={b.member.id}
                    member={b.member}
                    note={`${b.date.getMonth() + 1}/${b.date.getDate()} · ${
                      b.days === 0 ? '오늘 🎂' : b.days === 1 ? '내일' : `${b.days}일 뒤`
                    }`}
                  />
                ))}
              </div>
              <p className="text-[11px] text-faint">게스트는 생년월일을 받지 않아 표시되지 않아요.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
