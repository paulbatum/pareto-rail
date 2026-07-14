export type Theme = 'dark' | 'light';

const THEME_KEY = 'pr-theme';
const THEME_COLORS: Record<Theme, string> = {
  dark: '#171410',
  light: '#FAF8F3',
};

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function setTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;

  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // The visual theme still works when storage is unavailable.
  }

  if (theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[theme];
}
