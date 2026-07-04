type RuntimeErrorRecord = {
  title: string;
  detail: string;
  count: number;
};

let installed = false;

export function installDevErrorOverlay() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const overlay = document.createElement('section');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.style.cssText = [
    'position:fixed',
    'right:14px',
    'bottom:14px',
    'z-index:9999',
    'max-width:min(680px,calc(100vw - 28px))',
    'font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'color:#fff',
    'background:rgb(80 0 12 / 94%)',
    'border:1px solid rgb(255 130 150 / 90%)',
    'box-shadow:0 0 32px rgb(255 0 45 / 45%)',
    'padding:10px 12px',
    'cursor:auto',
    'pointer-events:auto',
    'display:none',
  ].join(';');

  const header = document.createElement('button');
  header.type = 'button';
  header.style.cssText = [
    'all:unset',
    'display:block',
    'width:100%',
    'cursor:pointer',
    'font-weight:700',
    'letter-spacing:.08em',
    'text-transform:uppercase',
  ].join(';');

  const body = document.createElement('div');
  body.style.cssText = [
    'display:none',
    'margin-top:8px',
    'white-space:pre-wrap',
    'max-height:42vh',
    'overflow:auto',
    'color:rgb(255 225 230)',
  ].join(';');

  const actions = document.createElement('div');
  actions.style.cssText = 'display:none;gap:8px;margin-top:10px';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy error';
  copy.style.cssText = buttonCss();

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.style.cssText = buttonCss();

  actions.append(copy, dismiss);
  overlay.append(header, body, actions);
  document.body.append(overlay);

  let latest: RuntimeErrorRecord | null = null;
  let expanded = false;

  const render = () => {
    if (!latest) {
      overlay.style.display = 'none';
      return;
    }
    overlay.style.display = 'block';
    header.textContent = `⚠ Runtime error${latest.count > 1 ? ` (${latest.count})` : ''}: ${latest.title}`;
    body.textContent = latest.detail;
    body.style.display = expanded ? 'block' : 'none';
    actions.style.display = expanded ? 'flex' : 'none';
  };

  const showError = (title: string, detail: string) => {
    latest = {
      title: compact(title),
      detail,
      count: (latest?.count ?? 0) + 1,
    };
    expanded = latest.count === 1;
    render();
  };

  header.addEventListener('click', () => {
    expanded = !expanded;
    render();
  });

  copy.addEventListener('click', async () => {
    if (!latest) return;
    await navigator.clipboard?.writeText(latest.detail);
  });

  dismiss.addEventListener('click', () => {
    latest = null;
    expanded = false;
    render();
  });

  window.addEventListener('error', (event) => {
    const detail = event.error instanceof Error
      ? formatError(event.error)
      : `${event.message}\n${event.filename}:${event.lineno}:${event.colno}`;
    showError(event.message || 'Uncaught error', detail);
  });

  window.addEventListener('unhandledrejection', (event) => {
    showError('Unhandled promise rejection', formatUnknown(event.reason));
  });

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    showError('console.error', args.map(formatUnknown).join('\n'));
  };
}

function buttonCss() {
  return [
    'font:inherit',
    'color:#fff',
    'background:rgb(20 0 4 / 70%)',
    'border:1px solid rgb(255 160 176 / 70%)',
    'padding:4px 8px',
    'cursor:pointer',
  ].join(';');
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180) || 'Unknown error';
}

function formatUnknown(value: unknown): string {
  if (value instanceof Error) return formatError(value);
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatError(error: Error) {
  return error.stack || `${error.name}: ${error.message}`;
}
