import './style.css';

type Environment = 'local' | 'prod';

type Overview = {
  ok: true;
  votes: number;
  matchups: number;
  participants: number;
  latestVoteAt: string | null;
};

type Vote = {
  id: string;
  createdAt: string;
  themeId: string;
  aLevelId: string;
  bLevelId: string;
  verdict: string;
  sentiment: string | null;
  playCountA: number;
  playCountB: number;
  bestScoreA: number | null;
  bestScoreB: number | null;
  dataClass: string;
  participantHash: string;
};

type VotesResponse = { ok: true; votes: Vote[] };
type HashResponse = { ok: true; participantHash: string };
type DeleteResponse = { ok: true; deletedVotes: number; deletedMatchups: number };

type FeedbackTone = '' | 'success' | 'error';

const app = document.querySelector<HTMLDivElement>('#admin-app');
if (!app) throw new Error('Missing #admin-app');
const adminApp = app;

app.innerHTML = `
  <header class="topbar">
    <div>
      <p class="eyebrow">Pareto Rail dev tool</p>
      <h1>Vote data administration</h1>
    </div>
    <div class="environment-control">
      <label for="env-select">Database environment</label>
      <select id="env-select">
        <option value="local">LOCAL</option>
        <option value="prod">PROD</option>
      </select>
    </div>
  </header>
  <div id="production-banner" class="production-banner" hidden>PRODUCTION — destructive actions require confirmation</div>
  <main class="content">
    <div id="feedback" class="feedback" role="status" aria-live="polite"></div>
    <section class="overview card">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Current environment</p>
          <h2>Overview</h2>
        </div>
        <button id="refresh-button" type="button">Refresh</button>
      </div>
      <div class="overview-grid">
        <div class="stat"><span>Votes</span><strong id="vote-count">—</strong></div>
        <div class="stat"><span>Matchups</span><strong id="matchup-count">—</strong></div>
        <div class="stat"><span>Participants</span><strong id="participant-count">—</strong></div>
        <div class="stat"><span>Latest vote</span><strong id="latest-vote">—</strong></div>
      </div>
    </section>

    <div class="tools-grid">
      <section class="card tool-card">
        <div class="section-heading"><div><p class="eyebrow">Identity helper</p><h2>Participant hash</h2></div></div>
        <form id="hash-form" class="hash-form">
          <label for="participant-id">Participant id</label>
          <div class="input-row">
            <input id="participant-id" type="text" autocomplete="off" placeholder="tester@example.com" />
            <button type="submit">Compute hash</button>
          </div>
        </form>
        <div class="hash-output">
          <span>Active environment hash</span>
          <code id="participant-hash">Enter an id to compute its hash.</code>
        </div>
        <div class="button-row">
          <button id="filter-button" type="button" disabled>Filter table to this participant</button>
          <button id="delete-participant-button" type="button" class="danger" disabled>Delete this participant's votes</button>
        </div>
      </section>

      <section class="card tool-card destructive-card">
        <div class="section-heading"><div><p class="eyebrow">Irreversible actions</p><h2>Delete data</h2></div></div>
        <p>Deleting all data removes every vote and its matchup records from the active database.</p>
        <button id="delete-all-button" type="button" class="danger">Delete ALL votes + matchups</button>
      </section>
    </div>

    <section class="card votes-card">
      <div class="section-heading">
        <div><p class="eyebrow">Stored rows</p><h2>Votes</h2></div>
        <div id="filter-label" class="filter-label">Showing all rows</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Created</th><th>Theme</th><th>A level</th><th>B level</th><th>Verdict</th><th>Sentiment</th>
              <th>Plays A/B</th><th>Best A/B</th><th>Class</th><th>Participant</th>
            </tr>
          </thead>
          <tbody id="votes-body"></tbody>
        </table>
      </div>
    </section>
  </main>
`;

const environmentSelect = mustGet<HTMLSelectElement>('env-select');
const productionBanner = mustGet<HTMLDivElement>('production-banner');
const feedback = mustGet<HTMLDivElement>('feedback');
const refreshButton = mustGet<HTMLButtonElement>('refresh-button');
const hashForm = mustGet<HTMLFormElement>('hash-form');
const participantInput = mustGet<HTMLInputElement>('participant-id');
const participantHashOutput = mustGet<HTMLElement>('participant-hash');
const filterButton = mustGet<HTMLButtonElement>('filter-button');
const deleteParticipantButton = mustGet<HTMLButtonElement>('delete-participant-button');
const deleteAllButton = mustGet<HTMLButtonElement>('delete-all-button');
const votesBody = mustGet<HTMLTableSectionElement>('votes-body');
const filterLabel = mustGet<HTMLDivElement>('filter-label');

let environment: Environment = 'local';
let overview: Overview | null = null;
let votes: Vote[] = [];
let computedHash = '';
let filterHash: string | null = null;
let refreshSequence = 0;

refreshButton.addEventListener('click', () => {
  void refresh();
});

environmentSelect.addEventListener('change', () => {
  const next = environmentSelect.value;
  if (next !== 'local' && next !== 'prod') return;
  environment = next;
  overview = null;
  votes = [];
  filterHash = null;
  computedHash = '';
  participantHashOutput.textContent = 'Enter an id to compute its hash.';
  updateEnvironmentStyle();
  renderVotes();
  void refresh();
  if (participantInput.value.trim()) void computeHash();
});

participantInput.addEventListener('input', () => {
  computedHash = '';
  participantHashOutput.textContent = 'Enter an id to compute its hash.';
  filterButton.disabled = true;
  deleteParticipantButton.disabled = true;
});

hashForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void computeHash();
});

filterButton.addEventListener('click', () => {
  if (!computedHash) return;
  filterHash = computedHash;
  renderVotes();
  setFeedback(`Showing votes for ${shortHash(computedHash)}.`, 'success');
});

deleteParticipantButton.addEventListener('click', () => {
  if (!computedHash) return;
  void deleteData('participant', computedHash);
});

deleteAllButton.addEventListener('click', () => {
  void deleteData('all');
});

updateEnvironmentStyle();
void refresh();

async function refresh(): Promise<void> {
  const sequence = ++refreshSequence;
  refreshButton.disabled = true;
  setFeedback('Loading vote data…', '');
  try {
    const query = `?env=${environment}`;
    const [nextOverview, nextVotes] = await Promise.all([
      fetchJson<Overview>(`/dev/admin/api/overview${query}`),
      fetchJson<VotesResponse>(`/dev/admin/api/votes${query}`),
    ]);
    if (sequence !== refreshSequence) return;
    overview = nextOverview;
    votes = nextVotes.votes;
    renderOverview();
    renderVotes();
    setFeedback('', '');
  } catch (error) {
    if (sequence !== refreshSequence) return;
    setFeedback(errorMessage(error), 'error');
  } finally {
    if (sequence === refreshSequence) refreshButton.disabled = false;
  }
}

async function computeHash(): Promise<void> {
  const participantId = participantInput.value.trim();
  if (!participantId) {
    setFeedback('Enter a participant id first.', 'error');
    return;
  }
  filterButton.disabled = true;
  deleteParticipantButton.disabled = true;
  participantHashOutput.textContent = 'Computing…';
  try {
    const result = await fetchJson<HashResponse>(`/dev/admin/api/hash?env=${environment}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId }),
    });
    computedHash = result.participantHash;
    participantHashOutput.textContent = computedHash;
    filterButton.disabled = false;
    deleteParticipantButton.disabled = false;
    setFeedback('', '');
  } catch (error) {
    computedHash = '';
    participantHashOutput.textContent = 'Hash unavailable.';
    setFeedback(errorMessage(error), 'error');
  }
}

async function deleteData(scope: 'all' | 'participant', participantHash?: string): Promise<void> {
  const target = scope === 'all' ? 'all votes and matchup records' : `votes for ${shortHash(participantHash ?? '')}`;
  if (!window.confirm(`Delete ${target} from the ${environment} database?`)) return;
  if (environment === 'prod' && window.prompt('Type prod to confirm this production delete.') !== 'prod') {
    setFeedback('Production delete cancelled.', '');
    return;
  }

  const buttons = [deleteAllButton, deleteParticipantButton];
  buttons.forEach((button) => (button.disabled = true));
  try {
    const result = await fetchJson<DeleteResponse>(`/dev/admin/api/delete?env=${environment}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scope === 'all' ? { scope } : { scope, participantHash }),
    });
    await refresh();
    setFeedback(`Deleted ${result.deletedVotes} vote${result.deletedVotes === 1 ? '' : 's'} and ${result.deletedMatchups} matchup${result.deletedMatchups === 1 ? '' : 's'}.`, 'success');
    if (scope === 'participant') {
      filterHash = null;
      renderVotes();
    }
  } catch (error) {
    setFeedback(errorMessage(error), 'error');
  } finally {
    deleteAllButton.disabled = false;
    deleteParticipantButton.disabled = !computedHash;
  }
}

function renderOverview(): void {
  setText('vote-count', overview ? `${overview.votes}` : '—');
  setText('matchup-count', overview ? `${overview.matchups}` : '—');
  setText('participant-count', overview ? `${overview.participants}` : '—');
  setText('latest-vote', overview?.latestVoteAt ? formatDate(overview.latestVoteAt) : 'None');
}

function renderVotes(): void {
  const visibleVotes = filterHash ? votes.filter((vote) => vote.participantHash === filterHash) : votes;
  filterLabel.textContent = filterHash ? `Filtered to ${shortHash(filterHash)} · ${visibleVotes.length} row${visibleVotes.length === 1 ? '' : 's'}` : `Showing all rows · ${votes.length}`;
  votesBody.replaceChildren();
  if (visibleVotes.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 10;
    cell.className = 'empty-cell';
    cell.textContent = filterHash ? 'No votes match this participant.' : 'No votes found.';
    row.append(cell);
    votesBody.append(row);
    return;
  }

  for (const vote of visibleVotes) {
    const row = document.createElement('tr');
    appendCell(row, formatDate(vote.createdAt));
    appendCell(row, vote.themeId);
    appendCell(row, vote.aLevelId);
    appendCell(row, vote.bLevelId);
    appendCell(row, prettyValue(vote.verdict));
    appendCell(row, prettyValue(vote.sentiment));
    appendCell(row, `${vote.playCountA} / ${vote.playCountB}`);
    appendCell(row, `${vote.bestScoreA ?? '—'} / ${vote.bestScoreB ?? '—'}`);
    appendCell(row, prettyValue(vote.dataClass));
    const hashCell = appendCell(row, shortHash(vote.participantHash));
    hashCell.title = vote.participantHash;
    hashCell.className = 'hash-cell';
    votesBody.append(row);
  }
}

function updateEnvironmentStyle(): void {
  const production = environment === 'prod';
  adminApp.classList.toggle('production', production);
  productionBanner.hidden = !production;
  environmentSelect.value = environment;
}

function appendCell(row: HTMLTableRowElement, value: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = value;
  row.append(cell);
  return cell;
}

function setFeedback(message: string, tone: FeedbackTone): void {
  feedback.textContent = message;
  feedback.className = `feedback ${tone}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error('Could not reach the admin API. Is the Vite dev server running?');
  }
  let body: { ok?: unknown; error?: unknown };
  try {
    body = (await response.json()) as { ok?: unknown; error?: unknown };
  } catch {
    throw new Error(`Admin API returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok || body.ok !== true) {
    throw new Error(typeof body.error === 'string' ? body.error : `Admin API request failed (HTTP ${response.status}).`);
  }
  return body as T;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function prettyValue(value: string | null): string {
  return value ? value.replaceAll('_', ' ').toLowerCase() : '—';
}

function shortHash(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The admin request failed.';
}

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function setText(id: string, value: string): void {
  mustGet<HTMLElement>(id).textContent = value;
}
