'use client';

import {
  BracketIssueLevel,
  computeTournamentStandings,
  IBracketIssue,
  IBracketNamePick,
  IBracketPreview,
  ITournament,
  ITournamentDetail,
  ITournamentStandings,
  tournamentOfficialScore,
  TournamentMatchStatus,
  TournamentMatchType,
  TournamentStatus,
  TournamentTeam,
} from '@letscok/shared-types';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AdminGate } from '@/components/admin-gate';
import { TOURNAMENT_TYPE_LABEL as TYPE_LABEL, TournamentBoard } from '@/components/admin/tournament-board';
import { TournamentEntry } from '@/components/admin/tournament-entry';
import { ConfirmButton } from '@/components/confirm-button';
import { TournamentBracket, TournamentRanking, TournamentScoreboard } from '@/components/tournament-live';
import { api, ApiError } from '@/lib/api';
import { useCopy } from '@/lib/use-copy';
import { useTournamentLive } from '@/lib/use-tournament-live';

// 대회 운영 화면 — 대회를 만들고 시트 대진표를 붙여 넣어 등록한 뒤, 시작하면 경기 진행 화면이 된다
// 종료하면 최종 결과 화면이 되고, "결과 내리기"를 누르면 모임원 화면과 전광판이 평소 화면으로 돌아간다

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
  // 다른 운영진 기기에서 바꾼 내용도 신호를 받아 다시 읽는다
  const { detail, loading, failed, stale, setDetail } = useTournamentLive({ admin: true });
  const standings = useMemo(() => (detail ? computeTournamentStandings(detail) : null), [detail]);
  // 입구 담당은 체크인 탭만 띄워 둔다. 대진표와 개인 순위는 모임원이 보는 현황과 같은 부품이다
  const [view, setView] = useState<'main' | 'bracket' | 'ranking' | 'entry'>('main');
  const open = detail?.tournament.status === TournamentStatus.OPEN;
  const closed = detail?.tournament.status === TournamentStatus.CLOSED;

  return (
    // 대회 중에는 노트북과 태블릿에서 코트 전체가 한 화면에 들어오게 넓게 쓴다
    <main className={`fade-in mx-auto flex min-h-dvh w-full flex-col gap-5 p-6 ${open || closed ? 'max-w-6xl' : 'max-w-2xl'}`}>
      <header>
        <Link href="/admin" className="text-sm text-dim transition-opacity hover:opacity-70">
          ← 운영 화면
        </Link>
        <h1 className="mt-1 text-2xl font-bold">자체 대회</h1>
      </header>

      {failed && !detail && <p className="py-10 text-center text-sm text-coral">대회를 불러오지 못했습니다.</p>}
      {stale && detail && (
        <p className="sticky top-2 z-10 rounded-xl border border-coral/50 bg-panel px-4 py-3 text-sm font-bold text-coral">
          연결이 끊겼어요. 다른 기기에서 바꾼 내용이 안 보일 수 있어요. 다시 연결하는 중이에요.
        </p>
      )}
      {loading && <p className="py-10 text-center text-sm text-dim">불러오는 중...</p>}
      {!loading && !failed && !detail && <CreateForm onCreated={(tournament) => setDetail({ tournament, participants: [], matches: [] })} />}
      {detail && (
        <>
          <Summary detail={detail} onChange={setDetail} />
          {closed && standings && <FinalResult detail={detail} standings={standings} />}
          {!closed && detail.participants.length > 0 && (
            <nav className="flex gap-2">
              {(
                [
                  ['main', open ? '경기 진행' : '대진표'],
                  ...(open ? ([['bracket', '대진표'], ['ranking', '개인 순위']] as const) : []),
                  ['entry', `입구 체크인 ${detail.participants.filter((p) => p.enteredAt !== null).length}/${detail.participants.length}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`h-10 flex-1 rounded-lg border text-sm font-bold ${
                    view === key ? 'border-court bg-court/10 text-court' : 'border-line text-dim'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
          {closed ? null : view === 'entry' && detail.participants.length > 0 ? (
            <div className="mx-auto w-full max-w-2xl">
              <TournamentEntry detail={detail} onChange={setDetail} />
            </div>
          ) : open && standings && view !== 'main' ? (
            <>
              <TournamentScoreboard standings={standings} showTotal />
              {view === 'bracket' ? (
                <TournamentBracket detail={detail} wide />
              ) : (
                <div className="mx-auto w-full max-w-2xl">
                  <TournamentRanking standings={standings} />
                </div>
              )}
            </>
          ) : (
            <>
            {open && standings && <TournamentScoreboard standings={standings} showTotal />}
            {open && <TournamentBoard detail={detail} onChange={setDetail} />}
            {/* 시작한 경기가 생기면 서버가 다시 넣기를 막는다 — 그때부터는 버튼도 숨긴다 */}
            {detail.matches.every((match) => match.status === TournamentMatchStatus.QUEUED) && (
              <BracketImport detail={detail} onImported={setDetail} />
            )}
            {detail.tournament.status === TournamentStatus.DRAFT && detail.matches.length > 0 && (
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

// 시트의 스코어 칸(청팀 점수, ":", 백팀 점수)에 그대로 붙여 넣을 글자 — 번호순으로 한 줄씩, 빠진 번호와 아직 안 끝난 경기는 빈 점수
// 대리 경기는 집계에 들어가는 점수(결원 팀 0:21)로 내보내 시트의 승리 팀 수식이 앱과 같은 결과를 내게 한다
function sheetScoreText(matches: ITournamentDetail['matches']): string {
  const byNo = new Map(matches.map((match) => [match.matchNo, match]));
  const numbers = matches.map((match) => match.matchNo);
  const lines: string[] = [];
  for (let no = Math.min(...numbers); no <= Math.max(...numbers); no += 1) {
    const match = byNo.get(no);
    const score = match ? tournamentOfficialScore(match) : null;
    lines.push(score ? `${score.blue}\t:\t${score.white}` : '\t:\t');
  }
  return lines.join('\n');
}

function SheetCopy({ matches }: { matches: ITournamentDetail['matches'] }) {
  const { copied, copy } = useCopy(useMemo(() => sheetScoreText(matches), [matches]));
  const first = Math.min(...matches.map((match) => match.matchNo));
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button onClick={() => void copy()} className="h-10 rounded-lg border border-line px-4 text-sm font-bold text-dim">
        {copied === 'done' ? '복사했어요' : '시트용 복사'}
      </button>
      <p className="text-caption text-faint">
        {copied === 'failed'
          ? '복사하지 못했어요. 주소가 https인지 확인해 주세요.'
          : `시트에서 ${first}번 경기의 청팀 점수 칸을 누르고 붙여 넣어요`}
      </p>
    </div>
  );
}

function Summary({ detail, onChange }: { detail: ITournamentDetail; onChange: (next: ITournamentDetail | null) => void }) {
  const { tournament, participants, matches } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 경기 상태가 바뀌면 앞서 띄운 안내("진행 중인 경기가 있어요")는 더 맞지 않는다
  useEffect(() => setError(null), [detail]);
  const count = (team: TournamentTeam) => participants.filter((p) => p.team === team).length;
  const done = matches.filter((m) => m.status === TournamentMatchStatus.FINISHED).length;

  const run = async (request: () => Promise<ITournamentDetail | null>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await request());
    } catch (e) {
      setError(failText(e, '요청에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };
  const path = `/tournaments/${tournament.id}`;

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
          : `경기 ${matches.length}건${tournament.status === TournamentStatus.DRAFT ? '' : ` 중 ${done}건 끝남`}, 참가자 ${participants.length}명 (청팀 ${count(TournamentTeam.BLUE)}명, 백팀 ${count(TournamentTeam.WHITE)}명), 코트 ${tournament.courtCount}개`}
      </p>
      {error && <p className="mt-1 text-sm text-coral">{error}</p>}
      {tournament.status !== TournamentStatus.DRAFT && done > 0 && <SheetCopy matches={matches} />}
      {tournament.status === TournamentStatus.DRAFT && matches.length > 0 && (
        <ConfirmButton
          label="대회 시작"
          confirmLabel="시작하면 모임원 링크가 대회 현황으로 바뀌어요. 한 번 더 누르면 시작"
          className="mt-3 min-h-12 rounded-xl px-5 py-2 font-bold"
          idleCls="bg-court text-bg"
          disabled={busy}
          onConfirm={() => void run(() => api<ITournamentDetail>(`${path}/open`, { method: 'POST', admin: true }))}
        />
      )}
      {tournament.status === TournamentStatus.OPEN && (
        <ConfirmButton
          label="대회 종료"
          confirmLabel="종료하면 되돌릴 수 없어요. 한 번 더 누르면 종료"
          className="mt-3 h-10 self-start rounded-lg px-4 text-sm font-bold"
          idleCls="border border-line text-dim"
          disabled={busy}
          onConfirm={() =>
            void run(() => api<ITournamentDetail>(`${path}/close`, { method: 'POST', admin: true }))
          }
        />
      )}
      {tournament.status === TournamentStatus.CLOSED && (
        <>
          <p className="mt-1 text-sm text-dim">
            최종 결과가 모임원 링크와 전광판에 떠 있어요. 평소 모임 전에 결과를 내려 주세요.
          </p>
          <ConfirmButton
            label="결과 내리기"
            confirmLabel="모임원 링크와 전광판이 평소 화면으로 돌아가요. 한 번 더 누르면 내리기"
            className="mt-2 h-10 self-start rounded-lg px-4 text-sm font-bold"
            idleCls="border border-line text-dim"
            disabled={busy}
            onConfirm={() =>
              void run(async () => {
                await api<null>(`${path}/hide-result`, { method: 'POST', admin: true });
                return null;
              })
            }
          />
        </>
      )}
    </section>
  );
}

// 끝난 대회 — 이긴 팀과 청백 승수, 개인 순위와 대진표를 한 화면에 둔다
function FinalResult({ detail, standings }: { detail: ITournamentDetail; standings: ITournamentStandings }) {
  return (
    <>
      <TournamentScoreboard standings={standings} final showTotal />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-sm font-bold text-dim">개인 순위</h2>
          <TournamentRanking standings={standings} />
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-body-sm font-bold text-dim">대진표</h2>
          <TournamentBracket detail={detail} />
        </section>
      </div>
    </>
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
