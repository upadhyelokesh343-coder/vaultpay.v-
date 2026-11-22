import React, { createContext, useContext, useEffect, useState } from 'react';
import { Language, TranslationDict, translations } from './translations';

const LANG_STORAGE_KEY = 'aurex_vault_lang_v1';

interface LanguageContextValue {
  lang: Language;
  t: TranslationDict;
  toggleLang: () => void;
  setLang: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'zh',
  t: translations.zh,
  toggleLang: () => {},
  setLang: () => {},
});

function loadSavedLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // ignore
  }
  return 'zh';
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [lang, setLangState] = useState<Language>(loadSavedLanguage);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // ignore
    }
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  const toggleLang = () => {
    setLangState((prev) => (prev === 'zh' ? 'en' : 'zh'));
  };

  const setLang = (next: Language) => {
    setLangState(next);
  };

  return (
    <LanguageContext.Provider
      value={{
        lang,
        t: translations[lang],
        toggleLang,
        setLang,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage() {
  return useContext(LanguageContext);
}
