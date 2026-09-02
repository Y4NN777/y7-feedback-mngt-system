import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

import type { Locale } from "@y7-feedback/domain";

const copy = {
  fr: {
    offline: "L’application est prête à fonctionner hors ligne.",
    update: "Une nouvelle version est prête.",
    apply: "Mettre à jour",
    dismiss: "Plus tard",
  },
  en: {
    offline: "The application is ready to work offline.",
    update: "A new version is ready.",
    apply: "Update now",
    dismiss: "Later",
  },
} as const;

function currentLocale(): Locale {
  return document.documentElement.lang === "en" ? "en" : "fr";
}

export function PwaUpdateNotice({
  locale,
  needRefresh,
  offlineReady,
  onApply,
  onDismiss,
}: {
  readonly locale: Locale;
  readonly needRefresh: boolean;
  readonly offlineReady: boolean;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
}) {
  if (!needRefresh && !offlineReady) return null;
  const messages = copy[locale];
  return (
    <aside className="pwa-notice" aria-live="polite" aria-atomic="true">
      <p>{needRefresh ? messages.update : messages.offline}</p>
      {needRefresh ? (
        <button type="button" onClick={onApply}>
          {messages.apply}
        </button>
      ) : null}
      <button type="button" onClick={onDismiss}>
        {messages.dismiss}
      </button>
    </aside>
  );
}

export function PwaLifecycle() {
  const [locale, setLocale] = useState<Locale>(currentLocale);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setLocale(currentLocale());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <PwaUpdateNotice
      locale={locale}
      needRefresh={needRefresh}
      offlineReady={offlineReady}
      onApply={() => {
        void updateServiceWorker(true);
      }}
      onDismiss={() => {
        setNeedRefresh(false);
        setOfflineReady(false);
      }}
    />
  );
}
