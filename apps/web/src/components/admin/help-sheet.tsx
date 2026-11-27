'use client';

import { useState } from 'react';
import { Sheet } from '@/components/sheet';

// 관제판 도움말 — 맨 위 흐름 그림 + 접는 목차. 처음 열면 글이 거의 없고, 누른 주제만 펼쳐진다

type Figure = 'team' | 'wait';

// 글 안의 [라벨]은 화면의 버튼 모양 조각으로 그린다
type HelpTopic = {
  key: string;
  title: string;
  summary: string;
  steps?: string[]; // 순서대로 하는 일
  figures?: Figure[];
  examples?: string[]; // 마이크에 말하는 예
  tips?: string[];
};

const HELP_GROUPS: { title: string; topics: HelpTopic[] }[] = [
  {
    title: '기본',
    topics: [
      {
        key: 'attend',
        title: '출석과 콕 확인',
        summary: '콕 확인까지 해야 게임에 들어갈 수 있어요',
        steps: [
          '[출석 추가]로 올 사람을 넣어요. 사람들이 오기 전에 미리 넣어 두면 편해요.',
          '콕을 낸 사람은 명단 맨 위 콕 확인 대기에서 [콕 확인]을 눌러요.',
          '그때부터 명단으로 내려오고 대기 시간이 흘러요.',
        ],
        tips: [
          '일찍 와도 콕을 늦게 내면 순번이 앞서지 않아요. 콕 확인 시각이 기준이에요.',
          '잘못 눌렀으면 그 사람 줄의 [⋯]에서 콕 확인 취소를 눌러요. 조합이나 게임에 든 뒤에는 안 돼요.',
          '미리 넣었는데 못 오게 된 사람은 콕 확인 대기 줄의 [취소]로 지워요. 출석 기록 없이 빠져요.',
          '명단에 없는 사람은 [출석 추가] 안의 [신규 등록]으로 넣어요. 게스트는 이름, 급수, 성별만 받아요.',
        ],
      },
      {
        key: 'code',
        title: '입장 코드와 폰 연결',
        summary: '모임원이 자기 폰에서 내 차례를 보게 하는 방법',
        steps: ['모임원이 모임원 링크를 열고 [내 폰 연결하기]를 눌러요.', '입장 코드 4자리를 넣고 자기 이름을 골라요.'],
        tips: [
          '코드는 소모임 필독 공지사항을 올린 날짜 4자리예요. 11월 2일에 올렸으면 1102예요.',
          '공지를 새로 올렸으면 더보기의 입장 코드에서 [코드 변경]으로 같이 바꿔요. 바꾼 코드는 다음 모임에도 이어져요.',
          '코드를 여러 번 틀리면 그 폰은 잠시 막혀요.',
          '미리 출석 처리가 안 된 사람은 폰을 연결할 때 출석까지 돼요.',
          '한 번 연결하면 다음 모임에도 그대로예요. 홈 화면에 추가해 두라고 안내해 주세요.',
          '개인정보 동의는 본인이 처음 연결할 때 받아요. 운영진이 대신 체크하지 않아요.',
        ],
      },
      {
        key: 'make',
        title: '게임 짜기',
        summary: '4명 선택, 조합, 코트 배정, 종료',
        steps: [
          '명단에서 4명을 고르고 [조합 만들기]를 눌러요.',
          '대기 조합 카드에서 [코트 배정]을 눌러요.',
          '게임이 끝나면 [게임 종료]를 두 번 눌러요. 실수로 끝나지 않게 두 번이에요.',
        ],
        figures: ['team', 'wait'],
        tips: [
          '빈 코트가 여러 개면 대기 조합 위의 [빈 코트 채우기]로 순서대로 한 번에 넣어요.',
          '[게임 종료]만 게임 수가 올라가고 대기 시간이 새로 시작돼요.',
          '[대기로]는 조합을 그대로 둔 채 다음 게임 1번으로 돌려보내요.',
          '카드 [⋯]의 게임 취소와 해체는 없던 일로 해요. 게임 수가 올라가지 않아요.',
          '오늘 끝난 게임은 게임 기록에서 봐요. 이름으로 검색하면 그 사람 게임만 모여요.',
        ],
      },
    ],
  },
  {
    title: '게임 운영',
    topics: [
      {
        key: 'ahead',
        title: '미리 짜 두기',
        summary: '겹침 배지와 빈칸 조합',
        tips: [
          '한 사람을 여러 대기 조합에 넣을 수 있어요. 두 곳 이상이면 겹침 배지가 붙어요.',
          '조합이나 게임에 든 사람도 명단에 계속 보여서, 골라서 다음 조합에 미리 넣을 수 있어요.',
          '1~3명만 고르고 [빈칸 조합]을 누르거나 [+ 새 조합]을 누르면 빈칸이 있는 조합이 생겨요.',
          '빈칸을 눌러 한 명씩 채우고 이름 옆 ✕로 빼요. 4명이 다 차야 코트에 배정되고 모임원 앱에도 보여요.',
          '조합에 게임 중인 사람이 있으면 그 게임이 끝날 때까지 코트 배정이 잠겨요.',
        ],
      },
      {
        key: 'drag',
        title: '끌어서 옮기기',
        summary: '태블릿에서는 자석판처럼',
        tips: [
          '명단의 이름을 살짝 길게 누르면 들려요. [+ 새 조합]에 놓으면 새 조합, 빈칸에 놓으면 채우기, 카드의 사람 위에 놓으면 교체예요.',
          '대기 조합의 사람을 다른 조합에 놓으면 옮겨지고, 명단에 놓으면 조합에서 빠져요.',
          '카드 제목 옆 ⠿를 잡고 다른 조합 위에 놓으면 순서가 바뀌어요. 이건 폰에서도 돼요.',
          '⠿를 빈 코트에 놓으면 배정돼요. 4명이 다 찬 조합만 돼요.',
          '게임 중인 코트의 사람은 끌어낼 수 없어요. 교체로 바꿔요.',
        ],
      },
      {
        key: 'swap',
        title: '사람 바꾸기와 휴식',
        summary: '교체, 팀 바꾸기, 잠깐 쉬기',
        steps: ['카드 [⋯]에서 교체를 눌러요.', '위에서 빠질 사람, 아래에서 들어올 사람을 골라요. 같은 번호끼리 바뀌어요.'],
        tips: [
          '여러 명도 한 번에 바꿀 수 있어요. 타이머와 순서는 그대로고, 빠진 사람은 대기로 돌아와요.',
          '팀을 바꾸려면 폰에서는 사람을 길게 눌러 고른 뒤 바꿀 사람이나 빈칸을 눌러요. 태블릿에서는 같은 카드 안에서 끌어다 놓아요.',
          '모임원이 폰에서 [잠깐 쉴래요]를 누르면 조합 선택과 게임 추천에서 빠져요.',
          '쉬는 동안에도 대기 시간은 흘러서, 복귀하면 기다린 시간이 이어져요.',
          '명단 줄의 [⋯]에서 운영진이 대신 휴식과 복귀를 처리할 수 있어요.',
        ],
      },
      {
        key: 'recommend',
        title: '게임 추천',
        summary: '참고용 초안 4장에서 골라 넣기',
        tips: [
          '[게임 추천]을 누르면 공정성(오래 기다린 사람) 2장과 새 조합(오늘 안 만난 사람) 2장이 나와요.',
          '[대기에 추가]를 눌러도 창이 닫히지 않아서 여러 조합을 이어서 만들 수 있어요.',
          '[다시 추천]을 누를 때마다 다음 순위 후보로 넘어가요.',
          '남복, 여복, 혼복 탭을 누르면 그 구성으로만 추천해요. 3:1은 추천하지 않으니 명단에서 직접 짜 주세요.',
          '성별이 비어 있는 사람은 전체 탭에서만 나와요.',
          '게임 중이거나 대기 조합에 든 사람도 나와요. 그 조합이 코트에 들어갈 때 겹치지 않는 사람만 골라요.',
          '게임 수는 온 시간에 견줘 따져요. 늦게 온 사람이 연달아 추천되지 않아요.',
          '추천은 참고용이에요. 넣을지는 운영진이 정해요.',
        ],
      },
      {
        key: 'mic',
        title: '마이크로 말하기',
        summary: '말하듯 적으면 미리보기 뒤에 실행',
        steps: ['마이크 버튼을 눌러 말하거나 적어요.', '미리보기를 보고 [확인]을 눌러야 실행돼요.'],
        examples: [
          '민수랑 준호 넣어서 남복 짜줘',
          '3번 코트 끝났어',
          '민수 휴식',
          '홍길동 출석',
          '게스트 홍길동 남자 C급 추가해줘',
          '누가 제일 오래 기다렸어?',
          '빈 코트 있어?',
          '민수랑 준호 대회 연습한대',
        ],
        tips: [
          '성 없이 이름만 말해도 오늘 출석자 중 한 명이면 알아들어요.',
          '한 번에 세 개까지 말할 수 있어요. 하나를 [확인]하면 다음으로 넘어가고, 원치 않으면 [건너뛰기]예요.',
          '상황을 물어보면 지금 현황에서 바로 계산해서 알려 줘요.',
          '게스트를 추가할 때 빠진 성별과 급수는 미리보기에서 눌러 채워요. 콕 확인은 따로 해요.',
          '대회 연습 파트너를 말해 두면 그날 게임 추천이 두 사람을 같은 게임에 넣는 쪽으로 기울어요. 명단의 파트너 표시를 두 번 누르면 풀려요.',
        ],
      },
    ],
  },
  {
    title: '사람과 알림',
    topics: [
      {
        key: 'aiAttend',
        title: 'AI 출석',
        summary: '참석 신청 캡처로 한 번에 출석',
        steps: [
          '[출석 추가] 안의 [AI 출석]에 소모임 참석 신청 목록 캡처를 올려요. 4장까지 돼요.',
          '성과 이름이 한 명과 정확히 맞는 사람만 바로 출석 처리돼요.',
          '나머지는 물어보는 카드에서 고르거나 [모임원 찾아 연결]로 이어 줘요.',
        ],
        tips: [
          '성 없는 이름이나 별명은 한 번 고르면 기억해서 다음부터 묻지 않아요.',
          '잘못 연결했으면 모임원 관리의 그 사람 수정 화면에서 소모임 이름을 지워요.',
          '잘못 잡힌 사람은 결과 카드의 이름 옆 ✕로 취소해요. 콕 확인 전까지만 돼요.',
          '캡처 대신 "97년생 김민수 출석 처리해줘"처럼 문장으로 적어도 돼요.',
        ],
      },
      {
        key: 'notify',
        title: '알림 보내기',
        summary: '호출과 다시 알림',
        tips: [
          '모임원이 자기 화면에서 [게임 알림 받기]를 켜 두면 조합 등록, 코트 배정, 교체 투입, 콕 확인 때 알림이 가요.',
          '명단 줄 [⋯]의 호출은 그 사람에게 운영진이 찾는다고 알려요.',
          '코트 카드 [⋯]의 다시 알림은 그 게임 4명에게 코트 알림을 다시 보내요.',
          '버튼에 "N대 전송"이 뜨면 보낸 것이고, "알림 미등록"이면 직접 불러야 해요. 같은 사람에게는 30초에 한 번만 보내져요.',
          '아이폰은 홈 화면에 추가한 앱에서만 알림을 받아요. 알림은 보조 수단이라 현장 호명을 대신하지는 않아요.',
        ],
      },
      {
        key: 'members',
        title: '모임원 관리',
        summary: '명단 등록, 수정, 정리',
        tips: [
          '더보기의 모임원 관리에서 명단을 보고 등록, 수정, 정리해요. 모임 시작 전 화면에서도 열 수 있어요.',
          '여기의 [신규 등록]은 명단에만 넣어요. 모임 중에 온 사람은 [출석 추가] 안의 [신규 등록]으로 등록과 출석을 한 번에 해요.',
          '급수는 게임 추천에 바로 영향을 주니 실제 실력에 맞춰 주세요.',
          '역할(모임장, 운영진, 모임원)은 표시용이에요. 운영 화면에 들어오는 권한은 패스코드 하나로 같아요.',
          '자주 오는 게스트는 수정 화면의 [모임원으로 바꾸기]로 바꿔요. 생년월일이 필요해요.',
          '삭제는 명단에서만 감춰요. 지난 기록은 남고 삭제됨 탭에서 되살릴 수 있어요.',
          '[오래 안 온 게스트 정리]로 90일 넘게 안 온 게스트를 골라 한 번에 지워요.',
          '본인이 요청하면 [개인정보 삭제]를 써요. 이름, 생년월일, 성별이 지워지고 되돌릴 수 없어요.',
        ],
      },
      {
        key: 'memo',
        title: '메모',
        summary: '말로 받은 부탁 적어 두기',
        tips: ['"무릎 조심" 같은 부탁은 메모에 적어 두세요.', '모임이 끝나도 남아서 다음 모임에 이어져요. 처리했으면 ✕로 지워요.'],
      },
    ],
  },
  {
    title: '그 밖에',
    topics: [
      {
        key: 'shared',
        title: '공유 코트',
        summary: '다른 모임과 번갈아 쓰는 코트',
        steps: [
          '[코트 관리]에서 그 코트의 [공유]를 켜요.',
          '우리 게임이 끝나면 저절로 다른 모임 차례가 돼요.',
          '상대 게임이 끝나면 코트 카드의 [우리 차례로]를 눌러요.',
        ],
        tips: [
          '다른 모임 차례인 코트에는 배정이 막혀요.',
          '연달아 두 번 치기로 했으면 게임 종료 뒤 [우리 차례로]를 눌러 이어 가요.',
          '우리 차례를 양보할 때는 [다른 모임 차례로 넘기기]를 눌러요.',
          '[코트 관리]는 게임 중 구역 제목 옆과 더보기에 있어요.',
        ],
      },
      {
        key: 'close',
        title: '잠금과 모임 종료',
        summary: '나가기만 할지, 그날을 마감할지',
        tips: [
          '잠금은 운영 화면에서 나가기만 해요. 모임은 그대로예요.',
          '모임 종료는 그날 마감이에요. 진행 중 게임 정리, 전원 퇴장, 코트 해제 뒤에 마무리 카톡 문구가 떠요.',
          '모임 종료는 두 번 눌러야 실행되고, 문구 창을 닫으면 로그아웃돼요.',
          '둘 다 더보기 맨 아래에 있어요.',
        ],
      },
    ],
  },
];

// 맨 위 흐름 그림 — 누르면 그 단계를 설명하는 주제가 펼쳐진다
const FLOW: { label: string; topic: string }[] = [
  { label: '출석', topic: 'attend' },
  { label: '콕 확인', topic: 'attend' },
  { label: '조합', topic: 'make' },
  { label: '코트 배정', topic: 'make' },
  { label: '게임 종료', topic: 'make' },
];

// [라벨] → 버튼 모양 조각
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/).map((part, i) =>
        part.startsWith('[') ? (
          <span key={i} className="mx-0.5 inline-block rounded-md bg-court/15 px-1.5 text-caption font-bold whitespace-nowrap text-court">
            {part.slice(1, -1)}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

// 게임 카드의 자리 — 윗줄이 한 팀, 아랫줄이 상대 팀
function TeamFigure() {
  const row = (names: string[], label: string) => (
    <div className="flex items-center gap-1.5">
      {names.map((name) => (
        <span key={name} className="flex h-8 w-16 items-center justify-center rounded-lg bg-panel2 text-caption font-medium">
          {name}
        </span>
      ))}
      <span className="ml-1 text-caption text-dim">{label}</span>
    </div>
  );
  return (
    <figure className="flex flex-col gap-1.5 rounded-xl bg-bg p-3">
      {row(['민수', '준호'], '한 팀')}
      {row(['지은', '서연'], '상대 팀')}
      <figcaption className="mt-1 text-caption text-dim">카드의 윗줄 두 명이 한 팀이에요. 고른 순서대로 앉아요.</figcaption>
    </figure>
  );
}

// 대기 시간 색 — 보드의 강조 기준과 같은 색(10분 gold, 15분 amber, 20분 coral)
function WaitFigure() {
  return (
    <figure className="flex flex-col gap-2 rounded-xl bg-bg p-3">
      <div className="tabular flex items-center gap-4 text-body-sm font-bold">
        <span className="text-gold">10분</span>
        <span className="text-amber">15분</span>
        <span className="text-coral">20분</span>
      </div>
      <figcaption className="text-caption text-dim">조합에 안 든 사람의 대기 시간은 오래될수록 색이 바뀌어요. 다음 조합에 먼저 넣을 사람이에요.</figcaption>
    </figure>
  );
}

function TopicBody({ topic }: { topic: HelpTopic }) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {topic.steps && (
        <ol className="flex flex-col gap-2">
          {topic.steps.map((step, i) => (
            <li key={step} className="flex gap-2.5 text-body-sm leading-relaxed">
              <span className="tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-court text-caption font-bold text-bg">
                {i + 1}
              </span>
              <span>
                <RichText text={step} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {topic.figures?.map((figure) => (figure === 'team' ? <TeamFigure key={figure} /> : <WaitFigure key={figure} />))}
      {topic.examples && (
        <div className="flex flex-wrap gap-1.5">
          {topic.examples.map((example) => (
            <span key={example} className="rounded-full bg-bg px-3 py-1.5 text-caption text-dim">
              &ldquo;{example}&rdquo;
            </span>
          ))}
        </div>
      )}
      {topic.tips && (
        <ul className="flex flex-col gap-2">
          {topic.tips.map((tip) => (
            <li key={tip} className="flex gap-2.5 text-body-sm leading-relaxed text-dim">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />
              <span>
                <RichText text={tip} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  // 한 번에 하나만 펼친다 — 여러 개가 열려 다시 글 벽이 되지 않게
  const [openKey, setOpenKey] = useState<string | null>(null);

  const openTopic = (key: string) => {
    setOpenKey(key);
    // 펼쳐진 뒤 위치로 — 흐름 그림에서 누르면 주제가 화면 아래에 있을 수 있다
    requestAnimationFrame(() => document.getElementById(`help-${key}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  return (
    <Sheet
      ariaLabel="운영 도움말"
      onClose={onClose}
      width="sm:max-w-lg"
      bodyClassName="flex min-h-0 flex-1 flex-col gap-4 pb-1 scroll-area"
      header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">운영 도움말</h2>}
    >
      <section className="flex flex-col gap-2 rounded-2xl bg-panel2 px-2 py-3">
        <p className="px-2 text-caption font-bold text-dim">한 게임이 도는 순서</p>
        <ol className="grid grid-cols-5">
          {FLOW.map((step, i) => (
            <li key={step.label} className="relative">
              {/* 다음 단계로 이어지는 선 — 동그라미 가운데에서 옆 칸 가운데까지 */}
              {i < FLOW.length - 1 && <span className="absolute top-3.5 left-1/2 h-0.5 w-full bg-court/30" aria-hidden />}
              <button onClick={() => openTopic(step.topic)} className="relative flex w-full flex-col items-center gap-1.5 py-0.5">
                <span className="tabular flex h-7 w-7 items-center justify-center rounded-full bg-court text-body-sm font-bold text-bg">
                  {i + 1}
                </span>
                <span className="text-caption font-medium whitespace-nowrap">{step.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="px-2 text-caption text-faint">단계를 누르면 설명이 펼쳐져요</p>
      </section>
      {HELP_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5">
          <p className="px-1 text-caption font-bold text-dim">{group.title}</p>
          <div className="flex flex-col overflow-hidden rounded-2xl bg-panel2">
            {group.topics.map((topic) => {
              const open = openKey === topic.key;
              return (
                <div key={topic.key} id={`help-${topic.key}`} className="border-b border-line/60 last:border-b-0">
                  <button
                    onClick={() => (open ? setOpenKey(null) : openTopic(topic.key))}
                    aria-expanded={open}
                    className="flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className={`text-body font-medium ${open ? 'text-court' : ''}`}>{topic.title}</span>
                      <span className="text-caption text-dim">{topic.summary}</span>
                    </span>
                    <span className={`ml-auto shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
                      ›
                    </span>
                  </button>
                  {open && <TopicBody topic={topic} />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Sheet>
  );
}
