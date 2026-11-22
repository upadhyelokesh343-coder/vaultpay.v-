import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const APK_SESSION_KEY = 'vaultpay_apk_mode_v1';

const NON_APK_REFERRER_APPS = [
  'android-app://com.android.chrome',
  'android-app://com.whatsapp',
  'android-app://com.instagram.android',
  'android-app://com.facebook.katana',
  'android-app://com.facebook.orca',
  'android-app://org.telegram.messenger',
  'android-app://com.google.android.googlequicksearchbox',
];

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as unknown as { standalone?: boolean };
  const ua = window.navigator.userAgent.toLowerCase();
  const win = window as unknown as Record<string, unknown>;

  let persistedApk = false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get('mode') === 'apk' ||
      params.get('apk') === '1' ||
      params.get('app') === '1' ||
      params.get('standalone') === '1'
    ) {
      window.sessionStorage.setItem(APK_SESSION_KEY, '1');
    }
    persistedApk = window.sessionStorage.getItem(APK_SESSION_KEY) === '1';
  } catch {
    // ignore storage errors
  }

  const isSocialInAppBrowser =
    /fban|fbav|fb_iab|instagram|whatsapp|line|micromessenger|snapchat|twitter|tiktok|bytedance|telegram|gsa\//.test(
      ua
    );
  const isAndroidApkWebView =
    /android/.test(ua) &&
    (/; wv\)/.test(ua) || /\bversion\/\d+\.\d+\b/.test(ua)) &&
    !isSocialInAppBrowser;
  const isCustomWrapperUa =
    /swiftapk|webintoapp|website2apk|appcreator|apkbuilder|median|gonative/.test(
      ua
    );
  const hasNativeBridge = Boolean(
    win.Android ||
      win.AndroidInterface ||
      win.ReactNativeWebView ||
      win.Capacitor ||
      win.cordova ||
      win.__median_library ||
      win.gonative ||
      win.SwiftAPK
  );

  const ref = document.referrer.toLowerCase();
  const isApkReferrer =
    ref.startsWith('android-app://') &&
    !NON_APK_REFERRER_APPS.some((pkg) => ref.startsWith(pkg));

  if (isAndroidApkWebView || isCustomWrapperUa || hasNativeBridge || isApkReferrer) {
    try {
      window.sessionStorage.setItem(APK_SESSION_KEY, '1');
    } catch {
      // ignore
    }
  }

  return (
    persistedApk ||
    isAndroidApkWebView ||
    isCustomWrapperUa ||
    hasNativeBridge ||
    isApkReferrer ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    nav.standalone === true
  );
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(detectStandalone);
  const [envChecked, setEnvChecked] = useState<boolean>(() =>
    detectStandalone()
  );
  const [justInstalled, setJustInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const syncDetected = detectStandalone();
    setIsStandalone(syncDetected);
    if (syncDetected) {
      setEnvChecked(true);
    }

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    // Check server-side X-Requested-With header (Android WebView sends package name e.g. com.vaultpay.app even if UA is spoofed)
    if (!syncDetected) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 1200);
      fetch('/api/client-env', {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (res) => {
          const ct = res.headers.get('content-type') || '';
          if (!res.ok || !ct.includes('application/json')) return;
          const data = (await res.json()) as { isApkWebView?: boolean };
          if (data.isApkWebView) {
            try {
              window.sessionStorage.setItem(APK_SESSION_KEY, '1');
            } catch {
              // ignore
            }
            setIsStandalone(true);
          }
        })
        .catch(() => {
          // ignore network / abort
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
          setEnvChecked(true);
        });
    }

    const mql = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => setIsStandalone(detectStandalone());
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onDisplayChange);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setJustInstalled(true);
      setDeferredPrompt(null);
      setIsStandalone(detectStandalone());
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', onDisplayChange);
      }
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    if (!deferredPrompt) return 'unavailable';
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setJustInstalled(true);
        setDeferredPrompt(null);
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    }
  }, [deferredPrompt]);

  return {
    isInstallable: Boolean(deferredPrompt),
    isStandalone,
    envChecked,
    justInstalled,
    isIOS,
    install,
  };
}
