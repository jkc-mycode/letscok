'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

// 설치된 앱으로 실행 중인지 — iOS 사파리는 display-mode를 제대로 안 알려줘 둘 다 본다
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    setStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
  }, []);
  return standalone;
}

// 홈(/)으로 가는 로고 링크 — 설치된 앱에서는 링크를 걷어내고 로고만 남긴다.
// 홈은 모임원 앱(scope /m)에도 관제판 앱(scope /admin)에도 속하지 않아서, 누르면 앱을 벗어나
// 브라우저가 열린다. iOS는 앱과 브라우저의 저장소가 분리돼 있어 그 순간 체크인 상태를 잃는다
export function HomeLink({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const standalone = useStandalone();
  if (standalone) {
    return <span className={className}>{children}</span>;
  }
  return (
    <Link href="/" className={className} title={title}>
      {children}
    </Link>
  );
}
