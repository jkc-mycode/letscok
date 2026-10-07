// 음성 인식 글자 바로잡기 — 브라우저 음성 인식은 배드민턴 용어·사람 이름을 모르니 비슷한 소리로 적는다("남복"→"난복")
// 입력칸에 넣기 전에 ① 운영 용어 ② 오늘 출석자 이름을 고친다. 서버 AI도 문맥으로 알아듣지만, 화면 글자가 틀리면 운영진이 헷갈린다
// 애매하면 건드리지 않는다: 이름은 한 글자만 다르고 소리가 비슷하며 후보가 딱 하나일 때만

// 용어 — 틀린 꼴 뒤에 명령에 붙는 말이 올 때만(일상어 "여보"·"남북"을 아무 데서나 바꾸지 않게)
const TERM_TAIL = '(?=\\s*(?:$|[,.!?]|짜|자\\s*줘|게임|으로|로|하나|한\\s*게임|두\\s*게임|팀|이랑|랑|하고|조합|넣어|만들어))';
const TERM_FIXES: [RegExp, string][] = [
  [new RegExp(`(?:난복|남북|남보|날복|남폭|남뽁|남목|람복)${TERM_TAIL}`, 'g'), '남복'],
  [new RegExp(`(?:혼북|홈복|혼보|혼폭|혼뽁|혼목|온복|헌복)${TERM_TAIL}`, 'g'), '혼복'],
  [new RegExp(`(?:여북|여보|여폭|여뽁|여목|녀복)${TERM_TAIL}`, 'g'), '여복'],
  // "남복 자줘"·"짜져" — 복 다음의 짜줘만
  [/(복\s*)(?:자줘|짜져|짜조|짜죠|짜 줘|자 줘)/g, '$1짜줘'],
  // "3번 고트"·"3번 코드" — 숫자 뒤의 코트만
  [/(\d\s*번?\s*)(?:고트|코드|코투|커트)/g, '$1코트'],
];

// 이름 뒤에 붙는 말 — 떼어 내고 이름 부분만 비교한다(긴 것부터)
const PARTICLES = ['이랑', '하고', '이는', '이가', '이를', '이도', '랑', '와', '과', '이', '가', '은', '는', '을', '를', '도', '님', '씨', '한테', '에게'];

// 명령에 자주 나오는 말 — 이름과 한 글자 차이여도 바꾸지 않는다
const COMMAND_WORDS = new Set([
  '남복', '혼복', '여복', '짜줘', '코트', '게임', '휴식', '복귀', '호출', '불러줘', '끝났어', '종료', '넣어서', '빼고',
  '체크인', '대기', '조합', '다음', '지금', '전체', '기타', '팀으로', '같이', '해줘', '쉬어', '쉴게', '줘',
]);

const HANGUL_BASE = 0xac00;
// 한 글자를 초성·중성·종성 번호로
function jamo(ch: string): [number, number, number] | null {
  const code = ch.charCodeAt(0) - HANGUL_BASE;
  if (code < 0 || code > 11171) return null;
  return [Math.floor(code / 588), Math.floor((code % 588) / 28), code % 28];
}

// 두 글자가 소리로 비슷한가 — 초성·중성·종성 셋 중 둘 이상 같으면(난/남, 수/서)
function soundsAlike(a: string, b: string): boolean {
  const x = jamo(a);
  const y = jamo(b);
  if (!x || !y) return false;
  return (x[0] === y[0] ? 1 : 0) + (x[1] === y[1] ? 1 : 0) + (x[2] === y[2] ? 1 : 0) >= 2;
}

// 같은 길이에 한 글자만 다르고 그 글자가 비슷한 소리
function nearMiss(word: string, name: string): boolean {
  if (word.length !== name.length || word === name) return false;
  let diff = -1;
  for (let i = 0; i < word.length; i++) {
    if (word[i] === name[i]) continue;
    if (diff !== -1) return false;
    diff = i;
  }
  return diff !== -1 && soundsAlike(word[diff], name[diff]);
}

// 부르는 꼴 — 전체 이름과, 세 글자 이름이면 성을 뗀 두 글자("김민수"·"민수")
function callForms(names: string[]): Set<string> {
  const forms = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (!/^[가-힣]{2,4}$/.test(trimmed)) continue;
    forms.add(trimmed);
    if (trimmed.length === 3) forms.add(trimmed.slice(1));
  }
  return forms;
}

function fixWord(token: string, forms: Set<string>): string {
  const particle = PARTICLES.find((p) => token.endsWith(p) && token.length - p.length >= 2);
  const candidates = particle ? [[token.slice(0, -particle.length), particle], [token, '']] : [[token, '']];
  for (const [base, tail] of candidates) {
    if (!/^[가-힣]{2,4}$/.test(base) || COMMAND_WORDS.has(base) || forms.has(base)) {
      if (forms.has(base)) return token; // 이미 맞는 이름
      continue;
    }
    const hits = [...forms].filter((form) => nearMiss(base, form));
    if (hits.length === 1) return hits[0] + tail;
  }
  return token;
}

export function fixSpeech(text: string, names: string[]): string {
  let fixed = text;
  for (const [pattern, replacement] of TERM_FIXES) fixed = fixed.replace(pattern, replacement);
  const forms = callForms(names);
  if (forms.size === 0) return fixed;
  return fixed
    .split(/(\s+)/)
    .map((token) => (/^\s+$/.test(token) ? token : fixWord(token, forms)))
    .join('');
}
