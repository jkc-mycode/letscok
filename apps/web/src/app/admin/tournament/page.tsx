'use client';

import {
  BracketIssueLevel,
  IBracketIssue,
  IBracketNamePick,
  IBracketPreview,
  ITournament,
  ITournamentDetail,
  TournamentMatchType,
  TournamentStatus,
  TournamentTeam,
} from '@letscok/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminGate } from '@/components/admin-gate';
import { ConfirmButton } from '@/components/confirm-button';
import { api, ApiError } from '@/lib/api';

// 관제판 대회 화면 — 대회를 만들고 시트 대진표를 붙여 넣어 등록한다

const TYPE_LABEL: Record<TournamentMatchType, string> = { MENS: '남복', WOMENS: '여복', MIXED: '혼복' };
const STATUS_LABEL: Record<TournamentStatus, string> = { DRAFT: '준비 중', OPEN: '진행 중', CLOSED: '종료' };
const INPUT_CLS = 'h-12 rounded-xl border border-line bg-panel px-4 text-body outline-none focus:border-court';
const PRIMARY_CLS = 'h-12 rounded-xl bg-court px-5 font-bold text-bg transition-opacity disabled:opacity-40';
const failText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

interface MatchLine {
  matchNo: number;
  round: number;
  courtNo: number;
  type: TournamentMatchType;
  blue: string[];
  white: string[];
}

export default function TournamentPage() {
  return (
    <AdminGate title="자체 대회">
      <TournamentHome />
    </AdminGate>
  );
}

function TournamentHome() {
  // undefined = 불러오는 중, null = 준비 중이거나 진행 중인 대회가 없음
  const [detail, setDetail] = useState<ITournamentDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ITournamentDetail | null>('/tournaments/current', { admin: true })
      .then((result) => setDetail(result ?? null))
      .catch((e) => setError(failText(e, '대회를 불러오지 못했습니다.')));
  }, []);

  return (
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 p-6">
      <header>
        <Link href="/admin" className="text-sm text-dim transition-opacity hover:opacity-70">
          ← 운영 화면
        </Link>
        <h1 className="mt-1 text-2xl font-bold">자체 대회</h1>
      </header>

      {error && <p className="py-10 text-center text-sm text-coral">{error}</p>}
      {!error && detail === undefined && <p className="py-10 text-center text-sm text-dim">불러오는 중...</p>}
      {detail === null && <CreateForm onCreated={(tournament) => setDetail({ tournament, participants: [], matches: [] })} />}
      {detail && (
        <>
          <Summary detail={detail} />
          <BracketImport detail={detail} onImported={setDetail} />
          {detail.matches.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-body-sm font-bold text-dim">등록된 대진표</h2>
              <MatchTable
                lines={detail.matches.map((match) => ({
                  matchNo: match.matchNo,
                  round: match.round,
                  courtNo: match.courtNo,
                  type: match.type,
                  blue: match.players.filter((p) => p.slot < 2).map((p) => p.name),
                  white: match.players.filter((p) => p.slot >= 2).map((p) => p.name),
                }))}
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}

function CreateForm({ onCreated }: { onCreated: (tournament: ITournament) => void }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await api<ITournament>('/tournaments', { method: 'POST', admin: true, body: { name: name.trim(), date } }));
    } catch (e) {
      setError(failText(e, '대회를 만들지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-panel p-5">
      <h2 className="text-body font-bold">대회 만들기</h2>
      <p className="text-sm text-dim">준비 중인 대회가 없어요. 대회를 만들면 대진표를 붙여 넣을 수 있어요.</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="대회 이름 (예: 2026 송년 청백전)"
        maxLength={30}
        className={`${INPUT_CLS} bg-panel2`}
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT_CLS} bg-panel2`} />
      {error && <p className="text-sm text-coral">{error}</p>}
      <button onClick={() => void submit()} disabled={busy || !name.trim() || !date} className={PRIMARY_CLS}>
        {busy ? '만드는 중...' : '대회 만들기'}
      </button>
    </section>
  );
}

function Summary({ detail }: { detail: ITournamentDetail }) {
  const { tournament, participants, matches } = detail;
  const count = (team: TournamentTeam) => participants.filter((p) => p.team === team).length;
  return (
    <section className="flex flex-col gap-1 rounded-2xl bg-panel p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-heading font-bold">{tournament.name}</h2>
        <span className="rounded-md bg-court/10 px-2 py-0.5 text-caption font-bold text-court">
          {STATUS_LABEL[tournament.status]}
        </span>
      </div>
      <p className="text-sm text-dim">{tournament.date}</p>
      <p className="mt-1 text-sm">
        {matches.length === 0
          ? '아직 대진표가 없어요'
          : `경기 ${matches.length}건, 참가자 ${participants.length}명 (청팀 ${count(TournamentTeam.BLUE)}명, 백팀 ${count(TournamentTeam.WHITE)}명), 코트 ${tournament.courtCount}개`}
      </p>
    </section>
  );
}

function BracketImport({ detail, onImported }: { detail: ITournamentDetail; onImported: (next: ITournamentDetail) => void }) {
  const id = detail.tournament.id;
  const hasBracket = detail.matches.length > 0;
  const [open, setOpen] = useState(!hasBracket);
  const [text, setText] = useState('');
  const [picks, setPicks] = useState<IBracketNamePick[]>([]);
  const [preview, setPreview] = useState<IBracketPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPreview = async (nextPicks: IBracketNamePick[]) => {
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await api<IBracketPreview>(`/tournaments/${id}/bracket/preview`, {
          method: 'POST',
          admin: true,
          body: { text, picks: nextPicks },
        }),
      );
    } catch (e) {
      setError(failText(e, '대진표를 읽지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const pick = (name: string, memberId: string) => {
    const next = [...picks.filter((p) => p.name !== name), { name, memberId }];
    setPicks(next);
    void runPreview(next);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onImported(await api<ITournamentDetail>(`/tournaments/${id}/bracket`, { method: 'PUT', admin: true, body: { text, picks } }));
      setText('');
      setPicks([]);
      setPreview(null);
      setOpen(false);
    } catch (e) {
      setError(failText(e, '대진표를 등록하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="h-12 rounded-xl border border-line text-sm font-bold text-dim transition-colors hover:border-court/40"
      >
        대진표 다시 붙여 넣기
      </button>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-panel p-5">
      <h2 className="text-body font-bold">대진표 가져오기</h2>
      <p className="text-sm text-dim">
        시트 대진표 탭에서 번호 칸부터 백팀 선수2 칸까지 끌어서 복사한 뒤 아래에 붙여 넣어 주세요. 제목 줄이나 스코어 칸이
        함께 들어와도 괜찮아요.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
          setPicks([]);
        }}
        placeholder="여기에 붙여 넣기"
        rows={6}
        className="rounded-xl border border-line bg-panel2 p-3 font-mono text-caption outline-none focus:border-court"
      />
      {error && <p className="text-sm text-coral">{error}</p>}
      {!preview && (
        <button onClick={() => void runPreview(picks)} disabled={busy || !text.trim()} className={PRIMARY_CLS}>
          {busy ? '읽는 중...' : '미리 보기'}
        </button>
      )}
      {preview && (
        <>
          <Issues issues={preview.issues} picks={picks} onPick={pick} />
          <div className="grid grid-cols-2 gap-3">
            <TeamNames label="청팀" names={preview.blueNames} cls="text-sky" />
            <TeamNames label="백팀" names={preview.whiteNames} cls="text-ink" />
          </div>
          <MatchTable lines={preview.rows} />
          {!preview.canImport ? (
            <p className="text-sm text-coral">
              {preview.rows.length === 0 ? '읽은 경기가 없어요.' : '빨간 항목을 고친 뒤 다시 붙여 넣어 주세요.'}
            </p>
          ) : hasBracket ? (
            <ConfirmButton
              label={`경기 ${preview.rows.length}건으로 덮어쓰기`}
              confirmLabel="지금 대진표를 지우고 새로 넣어요. 한 번 더 누르면 등록"
              className="min-h-12 rounded-xl px-5 py-2 font-bold"
              idleCls="bg-court text-bg"
              disabled={busy}
              onConfirm={() => void submit()}
            />
          ) : (
            <button onClick={() => void submit()} disabled={busy} className={PRIMARY_CLS}>
              {busy ? '등록하는 중...' : `경기 ${preview.rows.length}건 등록`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Issues({
  issues,
  picks,
  onPick,
}: {
  issues: IBracketIssue[];
  picks: IBracketNamePick[];
  onPick: (name: string, memberId: string) => void;
}) {
  if (issues.length === 0) return <p className="text-sm text-court">문제를 찾지 못했어요.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {issues.map((issue, index) => {
        const error = issue.level === BracketIssueLevel.ERROR;
        return (
          <li
            key={`${issue.code}-${index}`}
            className={`rounded-xl border p-3 text-sm ${error ? 'border-coral/50 bg-coral/10 text-coral' : 'border-amber/50 bg-amber/10 text-amber'}`}
          >
            <span className="font-bold">{error ? '고쳐야 해요' : '확인해 주세요'}</span> {issue.message}
            {issue.candidates && issue.name && (
              <div className="mt-2 flex flex-wrap gap-2">
                {issue.candidates.map((candidate) => (
                  <button
                    key={candidate.memberId}
                    onClick={() => onPick(issue.name!, candidate.memberId)}
                    className={`rounded-lg border px-3 py-1.5 text-ink ${
                      picks.some((p) => p.name === issue.name && p.memberId === candidate.memberId)
                        ? 'border-court bg-court/10'
                        : 'border-line bg-panel'
                    }`}
                  >
                    {candidate.label}
                  </button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TeamNames({ label, names, cls }: { label: string; names: string[]; cls: string }) {
  return (
    <div className="rounded-xl bg-panel2 p-3">
      <p className={`text-sm font-bold ${cls}`}>
        {label} {names.length}명
      </p>
      <p className="mt-1 text-caption text-dim">{names.join(', ')}</p>
    </div>
  );
}

// 라운드별로 묶어 보여 준다 — 미리 보기와 등록된 대진표가 같이 쓴다
function MatchTable({ lines }: { lines: MatchLine[] }) {
  const rounds = [...new Set(lines.map((line) => line.round))].sort((a, b) => a - b);
  return (
    <div className="flex flex-col gap-3">
      {rounds.map((round) => (
        <div key={round} className="rounded-xl bg-panel2 p-3">
          <p className="text-caption font-bold text-dim">{round}라운드</p>
          <ul className="mt-1 flex flex-col">
            {lines
              .filter((line) => line.round === round)
              .map((line) => (
                <li key={line.matchNo} className="flex items-center gap-2 border-t border-line py-1.5 text-sm first:border-t-0">
                  <span className="w-7 shrink-0 text-caption text-faint">{line.matchNo}</span>
                  <span className="w-12 shrink-0 text-caption text-dim">{line.courtNo}코트</span>
                  <span className="w-9 shrink-0 text-caption text-dim">{TYPE_LABEL[line.type]}</span>
                  <span className="min-w-0 flex-1 text-right text-sky">{line.blue.join(', ')}</span>
                  <span className="shrink-0 text-caption text-faint">vs</span>
                  <span className="min-w-0 flex-1">{line.white.join(', ')}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
