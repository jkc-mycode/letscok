'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 브라우저 음성 인식(Web Speech API) — 한 번 누르면 한 문장을 듣는다. 말이 끝나면 저절로 멈추고,
// [말 끝]으로 직접 멈출 수도 있다. 음성은 브라우저(구글·애플)가 처리하고 우리 서버로는 글자만 간다.
// 크롬·안드로이드는 SpeechRecognition, 사파리는 webkitSpeechRecognition — 둘 다 없으면 supported=false

// TS 기본 DOM 타입에 없는 브라우저가 있어 필요한 만큼만 선언한다
interface RecognitionResultList {
  length: number;
  [index: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': '마이크 권한이 꺼져 있어요. 브라우저·앱 설정에서 마이크를 허용하거나 글로 입력해 주세요.',
  'service-not-allowed': '이 기기에서는 음성 인식을 쓸 수 없어요. 글로 입력해 주세요.',
  'no-speech': '말소리가 들리지 않았어요. 다시 눌러 말해 주세요.',
  'audio-capture': '마이크를 찾지 못했어요. 글로 입력해 주세요.',
  network: '음성 인식에는 인터넷 연결이 필요해요.',
};

export function useSpeech(onFinal: (text: string) => void) {
  const [supported] = useState(() => getCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState(''); // 말하는 중에 보이는 글자
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false); // 권한 거부 — 마이크 버튼을 숨기고 글 입력만
  const recognition = useRef<Recognition | null>(null);
  const finalText = useRef('');
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => () => recognition.current?.abort(), []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || recognition.current) return;
    const rec = new Ctor();
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.continuous = false; // 한 문장 — 말이 끝나면 저절로 멈춘다
    rec.maxAlternatives = 1;
    finalText.current = '';
    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText.current += piece;
        else interimText += piece;
      }
      setInterim(finalText.current + interimText);
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setBlocked(true);
      setError(ERROR_TEXT[e.error] ?? '음성 인식이 중간에 끊겼어요. 다시 시도하거나 글로 입력해 주세요.');
    };
    rec.onend = () => {
      recognition.current = null;
      setListening(false);
      const text = finalText.current.trim();
      setInterim('');
      if (text) onFinalRef.current(text);
    };
    setError(null);
    setInterim('');
    recognition.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      recognition.current = null;
      setListening(false);
      setError('음성 인식을 시작하지 못했어요. 다시 눌러 주세요.');
    }
  }, []);

  // [말 끝] — 지금까지 들은 것으로 마무리(onend에서 onFinal 호출)
  const stop = useCallback(() => recognition.current?.stop(), []);
  // [취소] — 들은 것을 버린다
  const cancel = useCallback(() => {
    finalText.current = '';
    recognition.current?.abort();
  }, []);

  return { supported: supported && !blocked, listening, interim, error, start, stop, cancel };
}
