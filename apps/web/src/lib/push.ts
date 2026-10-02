// 웹 푸시 구독 — 브라우저 구독(PushManager)과 서버 등록(/push/subscriptions)을 한 쌍으로 다룬다

import { IPushPublicKey, ISubscribePushDto } from '@letscok/shared-types';
import { isInstalled, isIos } from '@/components/install-prompt';
import { api } from './api';

// unsupported   푸시 불가(카톡 인앱·구형 브라우저·서버 키 없음·개발 모드) — UI 숨김
// needs-install iOS 사파리 탭 — 홈 화면 앱에서만 푸시를 받을 수 있다
// denied        권한 거부 — 코드로 다시 물을 수 없어 설정 경로를 안내해야 한다
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

let publicKeyPromise: Promise<string | null> | null = null;
function getPublicKey(): Promise<string | null> {
  publicKeyPromise ??= api<IPushPublicKey>('/push/public-key')
    .then((data) => data.publicKey)
    .catch(() => {
      publicKeyPromise = null; // 서버가 잠들어 실패했을 수 있다 — 다음에 다시 시도
      return null;
    });
  return publicKeyPromise;
}

// serviceWorker.ready는 워커가 없으면 영영 안 끝난다(개발 모드엔 등록 안 함) — getRegistration으로 확인
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

// VAPID 공개키(base64url) → PushManager가 받는 바이트 배열
function toApplicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// 권한은 pushManager 쪽으로 읽는다 — iOS는 설정에서 알림을 끄면 이 값이 바뀌지만
// Notification.permission은 페이지를 연 시점 값이 남아 있을 수 있다
function currentPermission(registration: ServiceWorkerRegistration): Promise<PermissionState> {
  return registration.pushManager.permissionState({ userVisibleOnly: true });
}

export async function getPushState(): Promise<PushState> {
  // iOS는 사파리 탭에 PushManager 자체가 없어서 지원 여부보다 먼저 판정해야 안내가 나간다
  if (isIos() && !isInstalled()) return 'needs-install';
  if (!('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (!(await getPublicKey())) return 'unsupported';

  const registration = await getRegistration();
  if (!registration) return 'unsupported';
  const permission = await currentPermission(registration);
  if (permission === 'denied') return 'denied';
  const subscription = await registration.pushManager.getSubscription();
  return subscription && permission === 'granted' ? 'on' : 'off';
}

// 권한이 막힌 사람에게 보여줄 설정 경로 — 웹은 설정 화면을 직접 열 수 없어 문장으로 안내한다
// (Android 13+ 설치 앱은 Android 앱 알림 토글이 기준이고 크롬 사이트 설정은 읽기 전용이 된다)
export function deniedGuide(): string {
  if (isIos()) return '설정 → 알림 → 렛츠콕';
  if (isInstalled()) return '렛츠콕 아이콘 길게 누르기 → 앱 정보 → 알림';
  return '주소창 왼쪽 아이콘 → 권한 → 알림';
}

async function register(memberId: string, subscription: PushSubscription): Promise<void> {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('구독 정보를 읽지 못했습니다.');
  const body: ISubscribePushDto = { memberId, endpoint, p256dh: keys.p256dh, auth: keys.auth };
  await api('/push/subscriptions', { method: 'POST', body });
}

// 반드시 버튼 클릭 핸들러 안에서 호출 — iOS는 사용자 동작 없이 권한을 요청하면 거부한다
export async function enablePush(memberId: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const [registration, publicKey] = await Promise.all([getRegistration(), getPublicKey()]);
  if (!registration || !publicKey) return 'unsupported';

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true, // 무음 푸시 금지 — 모든 푸시는 알림으로 보인다(브라우저 필수 조건)
      applicationServerKey: toApplicationServerKey(publicKey),
    }));
  await register(memberId, subscription);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const registration = await getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    // 서버 먼저 지운다 — 브라우저 쪽만 끊기면 서버는 410을 받기 전까지 계속 보내려 한다
    await api('/push/subscriptions', {
      method: 'DELETE',
      body: { endpoint: subscription.endpoint },
    }).catch(() => undefined);
    await subscription.unsubscribe();
  }
  return 'off';
}

// /m 진입·앱 복귀 시 서버와 맞춘다
// - 허용 상태: 재등록 — 서버에서 지워졌거나(410 정리·회원 복구) 같은 폰을 다른 사람이 쓰게 된 경우 복구
// - 거부 상태: 서버 구독 삭제 — 설정에서 알림을 꺼도 구독은 남아 서버가 모르고 계속 보내기 때문
//   (특히 iOS는 기기에서 조용히 버려 발송 결과로도 알 수 없다)
export async function syncPush(memberId: string): Promise<void> {
  const registration = await getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!registration || !subscription) return;

  const permission = await currentPermission(registration);
  if (permission === 'granted') {
    await register(memberId, subscription).catch(() => undefined);
  } else if (permission === 'denied') {
    await api('/push/subscriptions', {
      method: 'DELETE',
      body: { endpoint: subscription.endpoint },
    }).catch(() => undefined);
  }
}
