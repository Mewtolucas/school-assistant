/* ────────────────────────────────────────────────────────────
   StudyFlash — app.js
   Single-page application: router + views + data layer
   ──────────────────────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════
   SUPABASE CONFIG
   ─────────────────────────────────────────────────────────
   To enable the community Public Sets page:
   1. Go to https://supabase.com → New project (free)
   2. In the SQL Editor run:

      CREATE TABLE public_sets (
        id           TEXT PRIMARY KEY,
        name         TEXT,
        description  TEXT,
        card_count   INTEGER,
        encoded      TEXT,
        publisher_id TEXT,
        published_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE public_sets ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "read all"   ON public_sets FOR SELECT USING (true);
      CREATE POLICY "insert all" ON public_sets FOR INSERT WITH CHECK (true);
      CREATE POLICY "delete own" ON public_sets FOR DELETE USING (true);

   3. Go to Settings → API → copy Project URL and anon public key
   4. Paste them below.
   ═══════════════════════════════════════════════════════════ */
const SUPABASE_URL      = 'YOUR_SUPABASE_URL';       // e.g. https://xyzxyz.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';  // long JWT string

let _db = null;
function getDb() {
  if (_db) return _db;
  if (SUPABASE_URL === 'YOUR_SUPABASE_URL') return null;
  try {
    _db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) { _db = null; }
  return _db;
}

// Stable anonymous ID for this browser
function getPublisherId() {
  let id = localStorage.getItem('sf_publisher_id');
  if (!id) { id = uid(); localStorage.setItem('sf_publisher_id', id); }
  return id;
}

async function publishSetToCloud(set) {
  const db = getDb();
  if (!db) return;
  try {
    await db.from('public_sets').upsert({
      id:           `${getPublisherId()}_${set.id}`,
      name:         set.name,
      description:  set.description || '',
      card_count:   set.cards.length,
      encoded:      encodeSet(set),
      publisher_id: getPublisherId(),
      published_at: new Date().toISOString(),
    });
  } catch (e) { console.warn('Failed to publish set:', e); }
}

async function unpublishSetFromCloud(setId) {
  const db = getDb();
  if (!db) return;
  try {
    await db.from('public_sets').delete().eq('id', `${getPublisherId()}_${setId}`);
  } catch (e) { console.warn('Failed to unpublish set:', e); }
}

/* ═══════════════════════════════════════════════════════════
   DATA LAYER  (localStorage)
   ═══════════════════════════════════════════════════════════ */
const DB = (() => {
  const KEY_SETS     = 'sf_sets';
  const KEY_PROGRESS = 'sf_progress';

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function getSets() {
    return JSON.parse(localStorage.getItem(KEY_SETS) || '[]');
  }
  function saveSets(sets) {
    localStorage.setItem(KEY_SETS, JSON.stringify(sets));
  }
  function getProgress() {
    return JSON.parse(localStorage.getItem(KEY_PROGRESS) || '{}');
  }
  function saveProgress(p) {
    localStorage.setItem(KEY_PROGRESS, JSON.stringify(p));
  }

  function getSetById(id) {
    return getSets().find(s => s.id === id) || null;
  }

  function createSet({ name, description = '', cards = [], isPublic = false }) {
    const sets = getSets();
    const set = { id: uid(), name, description, cards, isPublic, createdAt: Date.now() };
    sets.push(set);
    saveSets(sets);
    return set;
  }

  function updateSet(id, updates) {
    const sets = getSets();
    const idx = sets.findIndex(s => s.id === id);
    if (idx < 0) return null;
    sets[idx] = { ...sets[idx], ...updates, updatedAt: Date.now() };
    saveSets(sets);
    return sets[idx];
  }

  function deleteSet(id) {
    saveSets(getSets().filter(s => s.id !== id));
    const p = getProgress();
    delete p[id];
    saveProgress(p);
  }

  // Progress helpers
  function getSetProgress(setId) {
    const p = getProgress();
    return p[setId] || { cards: {}, quizHistory: [] };
  }

  function recordCardAnswer(setId, cardId, correct) {
    const p = getProgress();
    if (!p[setId]) p[setId] = { cards: {}, quizHistory: [] };
    if (!p[setId].cards[cardId]) p[setId].cards[cardId] = { correct: 0, incorrect: 0 };
    correct ? p[setId].cards[cardId].correct++ : p[setId].cards[cardId].incorrect++;
    p[setId].cards[cardId].lastStudied = Date.now();
    saveProgress(p);
  }

  function recordQuizResult(setId, score, total) {
    const p = getProgress();
    if (!p[setId]) p[setId] = { cards: {}, quizHistory: [] };
    if (!p[setId].quizHistory) p[setId].quizHistory = [];
    p[setId].quizHistory.push({ date: Date.now(), score, total });
    saveProgress(p);
  }

  // Compute mastery % for a set (cards with more correct than incorrect answers)
  function getMastery(set) {
    const sp = getSetProgress(set.id);
    if (!set.cards.length) return 0;
    let mastered = 0;
    for (const card of set.cards) {
      const cp = sp.cards[card.id];
      if (cp && cp.correct > cp.incorrect && cp.correct > 0) mastered++;
    }
    return Math.round((mastered / set.cards.length) * 100);
  }

  return {
    getSets, saveSets, getSetById,
    createSet, updateSet, deleteSet,
    getSetProgress, recordCardAnswer, recordQuizResult,
    getMastery,
  };
})();

/* ═══════════════════════════════════════════════════════════
   PARSING  — "Front|Back" textarea format
   ═══════════════════════════════════════════════════════════ */
function parseCards(text) {
  const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
  const cards  = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const sep = lines[i].indexOf('|');
    if (sep < 0) {
      errors.push(`Line ${i + 1}: missing "|" separator`);
      continue;
    }
    const front = lines[i].slice(0, sep).trim();
    const back  = lines[i].slice(sep + 1).trim();
    if (!front || !back) {
      errors.push(`Line ${i + 1}: front and back must not be empty`);
      continue;
    }
    // Preserve or generate an ID so we keep progress across edits
    cards.push({ id: uid(), front, back });
  }
  return { cards, errors };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ═══════════════════════════════════════════════════════════
   SHARING  — encode/decode a set into a URL-safe string
   ═══════════════════════════════════════════════════════════ */
function encodeSet(set) {
  try {
    return btoa(encodeURIComponent(JSON.stringify({
      name: set.name,
      description: set.description,
      cards: set.cards,
    })));
  } catch { return ''; }
}

function decodeSet(str) {
  try {
    return JSON.parse(decodeURIComponent(atob(str)));
  } catch { return null; }
}

function shareUrl(set) {
  const base = window.location.href.split('#')[0];
  return `${base}#shared/${encodeSet(set)}`;
}

/* ═══════════════════════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════════════════════ */
function navigate(hash) {
  window.location.hash = hash;
}

function render() {
  const raw   = window.location.hash.slice(1) || 'home';
  // "shared" payloads may contain "/" inside them, so only split first two parts
  const slash = raw.indexOf('/');
  const view  = slash < 0 ? raw : raw.slice(0, slash);
  const param = slash < 0 ? '' : raw.slice(slash + 1);

  const app = document.getElementById('app');
  app.innerHTML = '';

  switch (view) {
    case 'home':      renderHome(app);                break;
    case 'public':    renderPublicSets(app);          break;
    case 'create':    renderCreate(app, null);        break;
    case 'edit':      renderCreate(app, param);       break;
    case 'study':     renderStudy(app, param);        break;
    case 'quiz':      renderQuiz(app, param);         break;
    case 'written':   renderWrittenQuiz(app, param);  break;
    case 'shared':    renderShared(app, param);       break;
    case 'tools':     renderToolsHub(app);            break;
    case 'geo':       renderGeoHub(app);              break;
    case 'geo-quiz':  renderGeoQuiz(app, param);      break;
    case 'math':      renderMathHub(app);             break;
    case 'math-quiz': renderMathQuiz(app, param);     break;
    case 'language':  renderLanguageHub(app);         break;
    case 'lang-quiz': renderLangQuiz(app, param);     break;
    case 'elements':  param ? renderPeriodicQuiz(app, param) : renderPeriodicHub(app); break;
    case 'essay':     renderEssayGrader(app);         break;
    default:          renderHome(app);
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('load', render);

/* ═══════════════════════════════════════════════════════════
   HOME VIEW
   ═══════════════════════════════════════════════════════════ */
function renderHome(app) {
  const sets = DB.getSets();

  if (sets.length === 0) {
    app.innerHTML = `
      <div class="empty-state">
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <rect x="2" y="3" width="20" height="14" rx="3"/>
          <path d="M8 21h8M12 17v4"/>
        </svg>
        <h2>No flashcard sets yet</h2>
        <p>Create your first set to start studying.</p>
        <button class="btn btn-primary btn-lg" onclick="navigate('create')">+ Create a Set</button>
      </div>`;
    return;
  }

  const grid = sets.map(set => {
    const mastery   = DB.getMastery(set);
    const sp        = DB.getSetProgress(set.id);
    const lastQuiz  = sp.quizHistory && sp.quizHistory.length
      ? sp.quizHistory[sp.quizHistory.length - 1] : null;

    return `
      <div class="set-card">
        <div class="set-card-top">
          <div>
            <div class="set-card-title">${escHtml(set.name)}</div>
            ${set.description ? `<div class="set-card-desc">${escHtml(set.description)}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:.3rem;align-items:flex-end;flex-shrink:0">
            <span class="badge badge-count">${set.cards.length} card${set.cards.length !== 1 ? 's' : ''}</span>
            <span class="badge ${set.isPublic ? 'badge-public' : 'badge-private'}">
              ${set.isPublic ? '🌐 Public' : '🔒 Private'}
            </span>
          </div>
        </div>

        <div class="progress-bar-wrap">
          <div class="progress-bar-label">
            <span>Mastery</span>
            <span>${mastery}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width:${mastery}%"></div>
          </div>
          ${lastQuiz ? `<div style="font-size:.75rem;color:var(--text-muted)">Last quiz: ${lastQuiz.score}/${lastQuiz.total} (${Math.round(lastQuiz.score/lastQuiz.total*100)}%)</div>` : ''}
        </div>

        <div class="set-card-actions">
          <button class="btn btn-primary btn-sm" onclick="navigate('study/${set.id}')">Study</button>
          <button class="btn btn-outline btn-sm" onclick="navigate('quiz/${set.id}')">Quiz</button>
          <button class="btn btn-outline btn-sm" onclick="navigate('written/${set.id}')">Written</button>
          <button class="btn btn-ghost btn-sm" onclick="navigate('edit/${set.id}')">Edit</button>
          ${set.isPublic
            ? `<button class="btn btn-ghost btn-sm" onclick="openShare('${set.id}')">Share</button>`
            : ''}
          <button class="btn btn-ghost btn-sm" onclick="openDeleteModal('${set.id}','${escAttr(set.name)}')"
            style="color:var(--danger);border-color:var(--danger-light)">Delete</button>
        </div>
      </div>`;
  }).join('');

  app.innerHTML = `
    <div class="home-header">
      <div>
        <h1>My Flashcard Sets</h1>
        <p>${sets.length} set${sets.length !== 1 ? 's' : ''}</p>
      </div>
      <button class="btn btn-primary" onclick="navigate('create')">+ New Set</button>
    </div>
    <div class="sets-grid">${grid}</div>`;
}

/* ═══════════════════════════════════════════════════════════
   PUBLIC SETS VIEW
   ═══════════════════════════════════════════════════════════ */
function renderPublicSets(app) {
  const db = getDb();

  app.innerHTML = `
    <div class="home-header">
      <div>
        <h1>Community Sets</h1>
        <p>Flashcard sets shared by everyone — import any set to start studying</p>
      </div>
      <button class="btn btn-ghost" onclick="navigate('home')">← Home</button>
    </div>
    <div id="public-sets-body">
      <div class="public-loading">
        <div class="public-spinner"></div>
        Loading sets…
      </div>
    </div>`;

  if (!db) {
    document.getElementById('public-sets-body').innerHTML = `
      <div class="empty-state">
        <div style="font-size:2.5rem">🔧</div>
        <h2>Supabase not configured</h2>
        <p>Add your Supabase project URL and anon key to <code>app.js</code> to enable community sets.</p>
        <button class="btn btn-ghost btn-lg" onclick="navigate('home')">← Back</button>
      </div>`;
    return;
  }

  db.from('public_sets')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(50)
    .then(({ data, error }) => {
      const body = document.getElementById('public-sets-body');
      if (!body) return;

      if (error) throw error;

      if (!data || data.length === 0) {
        body.innerHTML = `
          <div class="empty-state">
            <div style="font-size:2.5rem">📭</div>
            <h2>No community sets yet</h2>
            <p>Be the first! Create a set, turn on <strong>Make Public</strong>, and save it.</p>
            <button class="btn btn-primary btn-lg" onclick="navigate('create')">Create a Set</button>
          </div>`;
        return;
      }

      const myId = getPublisherId();
      const list = data.map(d => {
        const isOwn = d.publisher_id === myId;
        return `
          <div class="public-set-card">
            <div class="public-set-info">
              <div class="set-card-title">${escHtml(d.name)}</div>
              ${d.description ? `<div class="set-card-desc">${escHtml(d.description)}</div>` : ''}
              <div style="display:flex;gap:.5rem;align-items:center;margin-top:.4rem;flex-wrap:wrap">
                <span class="badge badge-count">${d.card_count} card${d.card_count !== 1 ? 's' : ''}</span>
                <span class="badge badge-public">🌐 Public</span>
                ${isOwn ? '<span class="badge" style="background:var(--primary-light);color:var(--primary-dark)">Your set</span>' : ''}
              </div>
            </div>
            <div class="public-set-actions">
              <button class="btn btn-primary btn-sm" onclick="studyShared('${escAttr(d.encoded)}')">Study</button>
              <button class="btn btn-outline btn-sm" onclick="quizShared('${escAttr(d.encoded)}')">Quiz</button>
              <button class="btn btn-outline btn-sm" onclick="writtenShared('${escAttr(d.encoded)}')">Written</button>
              <button class="btn btn-ghost btn-sm" onclick="importSharedSet('${escAttr(d.encoded)}')">⬇ Import</button>
            </div>
          </div>`;
      }).join('');

      body.innerHTML = `<div class="public-sets-list">${list}</div>`;
    })
    .catch(err => {
      const body = document.getElementById('public-sets-body');
      if (body) body.innerHTML = `
        <div class="empty-state">
          <div style="font-size:2.5rem">⚠️</div>
          <h2>Couldn't load sets</h2>
          <p>${escHtml(String(err.message || err))}</p>
          <button class="btn btn-ghost" onclick="navigate('public')">Retry</button>
        </div>`;
    });
}

window.copyPublicUrl = function(btn, url) {
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  }).catch(() => {
    showToast('Copy failed — click the link field and copy manually.');
  });
};

/* ═══════════════════════════════════════════════════════════
   CREATE / EDIT VIEW
   ═══════════════════════════════════════════════════════════ */
function renderCreate(app, setId) {
  const editing = setId ? DB.getSetById(setId) : null;
  const isEdit  = !!editing;

  const existingText = editing
    ? editing.cards.map(c => `${c.front}|${c.back}`).join('\n')
    : '';

  app.innerHTML = `
    <div class="create-header">
      <button class="icon-btn" onclick="history.back()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <h2>${isEdit ? 'Edit Set' : 'Create New Set'}</h2>
    </div>

    <div class="form-card">
      <div class="form-group">
        <label for="set-name">Set Name</label>
        <input id="set-name" type="text" placeholder="e.g. Biology Chapter 3"
          value="${isEdit ? escAttr(editing.name) : ''}" maxlength="120" />
      </div>

      <div class="form-group">
        <label for="set-desc">Description <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
        <input id="set-desc" type="text" placeholder="e.g. Cell structure and function"
          value="${isEdit ? escAttr(editing.description || '') : ''}" maxlength="240" />
      </div>

      <div class="toggle-row">
        <div class="toggle-label">
          <strong>Make Public</strong>
          <span>Generate a shareable link so others can view &amp; study this set</span>
        </div>
        <label class="toggle">
          <input type="checkbox" id="set-public" ${editing && editing.isPublic ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="form-group">
        <label for="cards-input">Flashcards</label>
        <textarea id="cards-input" placeholder="Front side|Back side
Another front|Another back
Capital of France|Paris">${escHtml(existingText)}</textarea>
        <span class="hint">One card per line. Separate front and back with a pipe character <code>|</code></span>
      </div>

      <div id="card-preview" class="card-preview-section" style="display:none">
        <div class="section-heading">Preview</div>
        <div id="card-preview-list" class="card-preview-list"></div>
      </div>

      <div class="form-actions">
        <button class="btn btn-ghost" onclick="history.back()">Cancel</button>
        <button class="btn btn-primary" onclick="saveSet(${isEdit ? `'${setId}'` : 'null'})">
          ${isEdit ? 'Save Changes' : 'Create Set'}
        </button>
      </div>
    </div>`;

  // Live preview as user types
  const textarea = document.getElementById('cards-input');
  textarea.addEventListener('input', updatePreview);
  if (isEdit) updatePreview();

  function updatePreview() {
    const { cards, errors } = parseCards(textarea.value);
    const previewSection = document.getElementById('card-preview');
    const list = document.getElementById('card-preview-list');

    if (!textarea.value.trim()) {
      previewSection.style.display = 'none';
      return;
    }
    previewSection.style.display = '';

    let html = '';
    for (const card of cards) {
      html += `
        <div class="card-preview-item">
          <span class="card-preview-front">${escHtml(card.front)}</span>
          <span class="card-preview-sep">→</span>
          <span class="card-preview-back">${escHtml(card.back)}</span>
        </div>`;
    }
    for (const err of errors) {
      html += `<div class="parse-error">${escHtml(err)}</div>`;
    }
    list.innerHTML = html;
  }
}

window.saveSet = function(setId) {
  const name = document.getElementById('set-name').value.trim();
  const desc = document.getElementById('set-desc').value.trim();
  const isPublic = document.getElementById('set-public').checked;
  const rawText  = document.getElementById('cards-input').value;

  if (!name) { showToast('Please enter a set name.'); return; }

  const { cards, errors } = parseCards(rawText);
  if (errors.length > 0 && cards.length === 0) {
    showToast('Fix card errors before saving.');
    return;
  }
  if (cards.length === 0) {
    showToast('Add at least one card.');
    return;
  }

  if (setId) {
    const updated = DB.updateSet(setId, { name, description: desc, cards, isPublic });
    if (isPublic) publishSetToCloud(updated);
    else unpublishSetFromCloud(setId);
    showToast('Set updated!');
  } else {
    const created = DB.createSet({ name, description: desc, cards, isPublic });
    if (isPublic) publishSetToCloud(created);
    showToast('Set created!');
  }
  navigate('home');
};

/* ═══════════════════════════════════════════════════════════
   STUDY VIEW
   ═══════════════════════════════════════════════════════════ */
function renderStudy(app, setId) {
  const set = DB.getSetById(setId);
  if (!set) { navigate('home'); return; }

  // Shuffle cards for variety
  const cards = shuffle([...set.cards]);
  let current = 0;
  let flipped  = false;
  let gotIt    = 0;
  let learning = 0;
  const answered = new Set();

  function cardHtml(card, idx) {
    const mastery = DB.getMastery(set);
    const progress = answered.size ? Math.round((answered.size / cards.length) * 100) : 0;

    return `
      <div class="study-header">
        <div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">Studying</div>
          <h2>${escHtml(set.name)}</h2>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="navigate('home')">← Back</button>
      </div>

      <div class="card-counter">Card ${idx + 1} of ${cards.length}</div>

      <div class="flashcard-scene" onclick="flipCard()">
        <div class="flashcard" id="flashcard">
          <div class="card-face card-face-front">
            <div class="card-face-label">Front</div>
            <div class="card-content">${escHtml(card.front)}</div>
            <div class="card-hint">Click to reveal answer</div>
          </div>
          <div class="card-face card-face-back">
            <div class="card-face-label">Answer</div>
            <div class="card-content">${escHtml(card.back)}</div>
          </div>
        </div>
      </div>

      <div class="study-controls">
        <button class="btn btn-ghost" onclick="prevCard()" ${idx === 0 ? 'disabled' : ''}>← Prev</button>
        <button class="btn btn-ghost" onclick="nextCard()" ${idx === cards.length - 1 ? 'disabled' : ''}>Next →</button>
      </div>

      <div class="study-feedback-btns">
        <button class="btn btn-danger" onclick="markCard(false)" title="Still learning">
          ✗ Still Learning
        </button>
        <button class="btn btn-success" onclick="markCard(true)" title="Got it">
          ✓ Got It
        </button>
      </div>

      <div class="study-progress-section">
        <div class="progress-bar-wrap" style="margin-top:1.5rem">
          <div class="progress-bar-label">
            <span>Session progress</span>
            <span>${answered.size}/${cards.length} answered</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width:${progress}%"></div>
          </div>
        </div>
        <div style="display:flex;gap:1rem;margin-top:.5rem;font-size:.8rem">
          <span style="color:var(--success)">✓ Got it: ${gotIt}</span>
          <span style="color:var(--danger)">✗ Still learning: ${learning}</span>
          <span style="color:var(--text-muted)">Overall mastery: ${mastery}%</span>
        </div>
      </div>`;
  }

  function renderCard() {
    if (current >= cards.length) {
      showComplete();
      return;
    }
    app.innerHTML = cardHtml(cards[current], current);
    flipped = false;
  }

  function showComplete() {
    const pct = cards.length ? Math.round(gotIt / cards.length * 100) : 0;
    app.innerHTML = `
      <div class="study-complete">
        <div style="font-size:2.5rem">🎉</div>
        <h2>Session Complete!</h2>
        <p>You went through all ${cards.length} cards.</p>
        <div class="big-score">${pct}%</div>
        <p style="margin-bottom:1.5rem"><strong style="color:var(--success)">${gotIt}</strong> got it &nbsp;·&nbsp; <strong style="color:var(--danger)">${learning}</strong> still learning</p>
        <div class="complete-actions">
          <button class="btn btn-ghost" onclick="navigate('home')">← Home</button>
          <button class="btn btn-outline" onclick="navigate('study/${setId}')">Study Again</button>
          <button class="btn btn-primary" onclick="navigate('quiz/${setId}')">Take Quiz</button>
        </div>
      </div>`;
  }

  window.flipCard = function() {
    flipped = !flipped;
    const fc = document.getElementById('flashcard');
    if (fc) fc.classList.toggle('flipped', flipped);
  };

  window.prevCard = function() {
    if (current > 0) { current--; renderCard(); }
  };

  window.nextCard = function() {
    if (current < cards.length - 1) { current++; renderCard(); }
  };

  window.markCard = function(correct) {
    DB.recordCardAnswer(setId, cards[current].id, correct);
    answered.add(cards[current].id);
    if (correct) gotIt++; else learning++;
    // Move to next
    if (current < cards.length - 1) { current++; renderCard(); }
    else showComplete();
  };

  renderCard();
}

/* ═══════════════════════════════════════════════════════════
   QUIZ VIEW
   ═══════════════════════════════════════════════════════════ */
function renderQuiz(app, setId) {
  const set = DB.getSetById(setId);
  if (!set) { navigate('home'); return; }

  const cards = set.cards;
  if (cards.length < 2) {
    app.innerHTML = `
      <div class="info-screen">
        <div style="font-size:2.5rem">📚</div>
        <h2>Not Enough Cards</h2>
        <p>You need at least 2 cards to take a quiz. Add more cards to this set.</p>
        <div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-ghost" onclick="navigate('home')">← Home</button>
          <button class="btn btn-primary" onclick="navigate('edit/${setId}')">Edit Set</button>
        </div>
      </div>`;
    return;
  }

  const shuffled = shuffle([...cards]);
  let qIndex  = 0;
  let score   = 0;
  let wrong   = 0;
  let answered = false;

  function makeOptions(questionCard) {
    const maxChoices = Math.min(4, cards.length);
    const others = shuffle(cards.filter(c => c.id !== questionCard.id)).slice(0, maxChoices - 1);
    const opts   = shuffle([questionCard, ...others]);
    return opts;
  }

  function renderQuestion() {
    if (qIndex >= shuffled.length) {
      showQuizResult();
      return;
    }
    answered = false;
    const card    = shuffled[qIndex];
    const options = makeOptions(card);
    const sp      = DB.getSetProgress(setId);
    const lastPct = sp.quizHistory && sp.quizHistory.length > 1
      ? Math.round(sp.quizHistory[sp.quizHistory.length - 2].score / sp.quizHistory[sp.quizHistory.length - 2].total * 100) + '% last time'
      : '';

    app.innerHTML = `
      <div class="quiz-header">
        <div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">Quiz</div>
          <h2>${escHtml(set.name)}</h2>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="navigate('home')">← Back</button>
      </div>

      <div style="max-width:640px;margin:0 auto .75rem">
        <div class="progress-bar-wrap">
          <div class="progress-bar-label">
            <span>Question ${qIndex + 1} of ${shuffled.length}</span>
            <span>${score} correct${lastPct ? ' · ' + lastPct : ''}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width:${Math.round(qIndex/shuffled.length*100)}%"></div>
          </div>
        </div>
      </div>

      <div class="quiz-card">
        <div class="quiz-question">${escHtml(card.front)}</div>
        <div class="quiz-options" id="quiz-options">
          ${options.map((opt, i) => `
            <button class="quiz-option" id="opt-${i}"
              onclick="checkAnswer('${escAttr(card.id)}','${escAttr(opt.id)}','${escAttr(card.id)}',${options.length})">
              ${escHtml(opt.back)}
            </button>`).join('')}
        </div>
        <div id="quiz-feedback" class="quiz-feedback"></div>
        <div id="quiz-next" class="quiz-next" style="display:none">
          <button class="btn btn-primary" onclick="nextQuestion()">
            ${qIndex < shuffled.length - 1 ? 'Next Question →' : 'See Results'}
          </button>
        </div>
      </div>`;
  }

  window.checkAnswer = function(correctId, selectedId, _cid, numOpts) {
    if (answered) return;
    answered = true;

    const isCorrect = selectedId === correctId;
    if (isCorrect) score++; else wrong++;
    DB.recordCardAnswer(setId, correctId, isCorrect);

    // Disable all options and highlight
    for (let i = 0; i < numOpts; i++) {
      const btn = document.getElementById(`opt-${i}`);
      if (!btn) continue;
      btn.classList.add('disabled');
      btn.onclick = null;
    }

    // Find which button matches correct answer and which was selected
    const optBtns = document.querySelectorAll('.quiz-option');
    optBtns.forEach(btn => {
      if (btn.id === `opt-${selectedId}`) btn.classList.add(isCorrect ? 'correct' : 'wrong');
    });

    // Use data attrs — re-find by text content comparison
    const card = cards.find(c => c.id === correctId);
    if (card) {
      optBtns.forEach(btn => {
        if (btn.textContent.trim() === card.back.trim() && !btn.classList.contains('wrong')) {
          btn.classList.add('show-correct');
        }
      });
    }

    const fb = document.getElementById('quiz-feedback');
    fb.textContent = isCorrect ? '✓ Correct!' : '✗ Incorrect';
    fb.className = `quiz-feedback ${isCorrect ? 'correct' : 'wrong'}`;

    document.getElementById('quiz-next').style.display = 'flex';
  };

  window.nextQuestion = function() {
    qIndex++;
    renderQuestion();
  };

  function showQuizResult() {
    DB.recordQuizResult(setId, score, shuffled.length);
    const pct = Math.round(score / shuffled.length * 100);

    // Score ring math
    const r   = 54;
    const circ = 2 * Math.PI * r;
    const dash = (pct / 100) * circ;
    const color = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';

    const sp = DB.getSetProgress(setId);
    const history = sp.quizHistory || [];
    const histText = history.length > 1
      ? `Best score: ${Math.max(...history.map(h => Math.round(h.score/h.total*100)))}% over ${history.length} quizzes`
      : 'First quiz complete!';

    app.innerHTML = `
      <div class="quiz-header">
        <div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">Quiz Results</div>
          <h2>${escHtml(set.name)}</h2>
        </div>
      </div>
      <div class="quiz-score-card">
        <div style="font-size:2rem">🏆</div>
        <h2>Quiz Complete!</h2>
        <p>You scored ${score} out of ${shuffled.length}</p>

        <div class="score-ring-wrap">
          <div class="score-ring">
            <svg width="140" height="140" viewBox="0 0 140 140">
              <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--border)" stroke-width="14"/>
              <circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="14"
                stroke-dasharray="${dash} ${circ}"
                stroke-linecap="round"/>
            </svg>
            <div class="score-ring-text">
              <span class="score-ring-pct" style="color:${color}">${pct}%</span>
              <span class="score-ring-label">Score</span>
            </div>
          </div>
        </div>

        <div class="score-breakdown">
          <div class="score-stat">
            <span class="score-stat-num correct">${score}</span>
            <span class="score-stat-label">Correct</span>
          </div>
          <div class="score-stat">
            <span class="score-stat-num wrong">${wrong}</span>
            <span class="score-stat-label">Incorrect</span>
          </div>
        </div>

        <div class="quiz-history">${histText}</div>

        <div class="complete-actions">
          <button class="btn btn-ghost" onclick="navigate('home')">← Home</button>
          <button class="btn btn-outline" onclick="navigate('quiz/${setId}')">Retry Quiz</button>
          <button class="btn btn-primary" onclick="navigate('study/${setId}')">Study Cards</button>
        </div>
      </div>`;
  }

  // Start quiz — but show wrong options by matching button text, not by id
  // Override checkAnswer to work with DOM text matching instead
  window.checkAnswer = function(_correctId, _selectedId, correctCardId, numOpts) {
    if (answered) return;
    answered = true;

    const correctCard = cards.find(c => c.id === correctCardId);
    const optBtns = Array.from(document.querySelectorAll('.quiz-option'));

    // Which button was clicked? We need to track the selected text
    // We'll store correct answer text and compare
    optBtns.forEach(btn => {
      btn.classList.add('disabled');
      btn.onclick = null;
    });

    // This version is called with the actual ids from onclick attributes
    // Re-derive: selectedId = the button the user clicked, correctId = the right card id
    // We need a different approach — see below
  };

  // Better approach: store answer mapping in closure
  let currentCorrectId = null;

  window.selectOption = function(selectedCardId) {
    if (answered) return;
    answered = true;

    const isCorrect = selectedCardId === currentCorrectId;
    if (isCorrect) score++; else wrong++;
    DB.recordCardAnswer(setId, currentCorrectId, isCorrect);

    const optBtns = Array.from(document.querySelectorAll('.quiz-option'));
    optBtns.forEach(btn => {
      btn.classList.add('disabled');
      btn.onclick = null;
      const cardId = btn.dataset.cardId;
      if (cardId === currentCorrectId) btn.classList.add('show-correct');
      if (cardId === selectedCardId && !isCorrect) btn.classList.add('wrong');
      if (cardId === selectedCardId && isCorrect)  btn.classList.add('correct');
    });

    const fb = document.getElementById('quiz-feedback');
    if (fb) {
      fb.textContent = isCorrect ? '✓ Correct!' : '✗ Incorrect';
      fb.className = `quiz-feedback ${isCorrect ? 'correct' : 'wrong'}`;
    }
    const qNext = document.getElementById('quiz-next');
    if (qNext) qNext.style.display = 'flex';
  };

  // Override renderQuestion to use data-card-id and window.selectOption
  function renderQuestion() {
    if (qIndex >= shuffled.length) { showQuizResult(); return; }
    answered = false;
    const card    = shuffled[qIndex];
    currentCorrectId = card.id;
    const options = makeOptions(card);

    const sp      = DB.getSetProgress(setId);
    const history = sp.quizHistory || [];
    const lastPct = history.length > 0
      ? Math.round(history[history.length - 1].score / history[history.length - 1].total * 100) + '% last quiz'
      : '';

    app.innerHTML = `
      <div class="quiz-header">
        <div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">Quiz</div>
          <h2>${escHtml(set.name)}</h2>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="navigate('home')">← Back</button>
      </div>

      <div style="max-width:640px;margin:0 auto .75rem">
        <div class="progress-bar-wrap">
          <div class="progress-bar-label">
            <span>Question ${qIndex + 1} of ${shuffled.length}</span>
            <span>${score} correct${lastPct ? ' · ' + lastPct : ''}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width:${Math.round(qIndex/shuffled.length*100)}%"></div>
          </div>
        </div>
      </div>

      <div class="quiz-card">
        <div class="quiz-question">${escHtml(card.front)}</div>
        <div class="quiz-options" id="quiz-options">
          ${options.map(opt => `
            <button class="quiz-option" data-card-id="${opt.id}"
              onclick="selectOption('${opt.id}')">
              ${escHtml(opt.back)}
            </button>`).join('')}
        </div>
        <div id="quiz-feedback" class="quiz-feedback"></div>
        <div id="quiz-next" class="quiz-next" style="display:none">
          <button class="btn btn-primary" onclick="nextQuestion()">
            ${qIndex < shuffled.length - 1 ? 'Next Question →' : 'See Results'}
          </button>
        </div>
      </div>`;
  }

  renderQuestion();
}

/* ═══════════════════════════════════════════════════════════
   WRITTEN QUIZ VIEW
   ═══════════════════════════════════════════════════════════ */
function renderWrittenQuiz(app, setId) {
  const set = DB.getSetById(setId);
  if (!set) { navigate('home'); return; }

  const cards = set.cards;
  if (cards.length === 0) {
    app.innerHTML = `
      <div class="info-screen">
        <div style="font-size:2.5rem">📚</div>
        <h2>No Cards</h2>
        <p>Add cards to this set before taking a written quiz.</p>
        <div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-ghost" onclick="navigate('home')">← Home</button>
          <button class="btn btn-primary" onclick="navigate('edit/${setId}')">Edit Set</button>
        </div>
      </div>`;
    return;
  }

  const shuffled = shuffle([...cards]);
  let qIndex  = 0;
  let score   = 0;
  let wrong   = 0;
  let answered = false;

  function normalize(s) {
    return String(s).trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
  }

  function renderQuestion() {
    if (qIndex >= shuffled.length) { showWrittenResult(); return; }
    answered = false;
    const card = shuffled[qIndex];

    const sp = DB.getSetProgress(setId);
    const history = sp.quizHistory || [];
    const lastPct = history.length > 0
      ? Math.round(history[history.length - 1].score / history[history.length - 1].total * 100) + '% last quiz'
      : '';

    app.innerHTML = `
      <div class="quiz-header">
        <div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">Written Quiz</div>
          <h2>${escHtml(set.name)}</h2>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="navigate('home')">← Back</button>
      </div>

      <div style="max-width:640px;margin:0 auto .75rem">
        <div class="progress-bar-wrap">
          <div class="progress-bar-label">
            <span>Question ${qIndex + 1} of ${shuffled.length}</span>
            <span>${score} correct${lastPct ? ' · ' + lastPct : ''}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width:${Math.round(qIndex/shuffled.length*100)}%"></div>
          </div>
        </div>
      </div>

      <div class="quiz-card">
        <div class="quiz-question">${escHtml(card.front)}</div>
        <div class="written-input-wrap">
          <input id="written-answer" type="text" class="written-answer-input"
            placeholder="Type your answer…" autocomplete="off" spellcheck="false" />
          <button class="btn btn-primary btn-wide" id="written-submit-btn" onclick="submitWritten()">Submit</button>
        </div>
        <div id="written-feedback" class="written-feedback"></div>
        <div id="quiz-next" class="quiz-next" style="display:none">
          <button class="btn btn-primary" onclick="nextWrittenQuestion()">
            ${qIndex < shuffled.length - 1 ? 'Next Question →' : 'See Results'}
          </button>
        </div>
      </div>`;

    const input = document.getElementById('written-answer');
    input.focus();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submitWritten(); });

    window.submitWritten = function() {
      if (answered) return;
      const userAnswer = document.getElementById('written-answer').value;
      if (!userAnswer.trim()) { showToast('Please type an answer first.'); return; }
      answered = true;

      const isCorrect = normalize(userAnswer) === normalize(card.back);
      if (isCorrect) score++; else wrong++;
      DB.recordCardAnswer(setId, card.id, isCorrect);

      const input = document.getElementById('written-answer');
      input.disabled = true;
      input.classList.add(isCorrect ? 'written-correct' : 'written-wrong');

      document.getElementById('written-submit-btn').disabled = true;

      const fb = document.getElementById('written-feedback');
      fb.className = `written-feedback ${isCorrect ? 'correct' : 'wrong'}`;
      fb.innerHTML = isCorrect
        ? '✓ Correct!'
        : `✗ Incorrect — the answer was: <strong>${escHtml(card.back)}</strong>`;

      document.getElementById('quiz-next').style.display = 'flex';
    };
  }

  window.nextWrittenQuestion = function() {
    qIndex++;
    renderQuestion();
  };

  function showWrittenResult() {
    DB.recordQuizResult(setId, score, shuffled.length);
    const pct = Math.round(score / shuffled.length * 100);

    const r    = 54;
    const circ = 2 * Math.PI * r;
    const dash = (pct / 100) * circ;
    const color = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';

    const sp = DB.getSetProgress(setId);
    const history = sp.quizHistory || [];
    const histText = history.length > 1
      ? `Best score: ${Math.max(...history.map(h => Math.round(h.score/h.total*100)))}% over ${history.length} quizzes`
      : 'First written quiz complete!';

    app.innerHTML = `
      <div class="quiz-header">
        <div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">Written Quiz Results</div>
          <h2>${escHtml(set.name)}</h2>
        </div>
      </div>
      <div class="quiz-score-card">
        <div style="font-size:2rem">✍️</div>
        <h2>Written Quiz Complete!</h2>
        <p>You scored ${score} out of ${shuffled.length}</p>

        <div class="score-ring-wrap">
          <div class="score-ring">
            <svg width="140" height="140" viewBox="0 0 140 140">
              <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--border)" stroke-width="14"/>
              <circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="14"
                stroke-dasharray="${dash} ${circ}"
                stroke-linecap="round"/>
            </svg>
            <div class="score-ring-text">
              <span class="score-ring-pct" style="color:${color}">${pct}%</span>
              <span class="score-ring-label">Score</span>
            </div>
          </div>
        </div>

        <div class="score-breakdown">
          <div class="score-stat">
            <span class="score-stat-num correct">${score}</span>
            <span class="score-stat-label">Correct</span>
          </div>
          <div class="score-stat">
            <span class="score-stat-num wrong">${wrong}</span>
            <span class="score-stat-label">Incorrect</span>
          </div>
        </div>

        <div class="quiz-history">${histText}</div>

        <div class="complete-actions">
          <button class="btn btn-ghost" onclick="navigate('home')">← Home</button>
          <button class="btn btn-outline" onclick="navigate('written/${setId}')">Retry Written</button>
          <button class="btn btn-outline" onclick="navigate('quiz/${setId}')">Multiple Choice</button>
          <button class="btn btn-primary" onclick="navigate('study/${setId}')">Study Cards</button>
        </div>
      </div>`;
  }

  renderQuestion();
}

/* ═══════════════════════════════════════════════════════════
   SHARED SET VIEW
   ═══════════════════════════════════════════════════════════ */
function renderShared(app, encoded) {
  const set = decodeSet(encoded);

  if (!set || !set.cards || set.cards.length === 0) {
    app.innerHTML = `
      <div class="info-screen">
        <div style="font-size:2.5rem">❌</div>
        <h2>Invalid Share Link</h2>
        <p>This link appears to be broken or expired.</p>
        <button class="btn btn-primary" onclick="navigate('home')">Go Home</button>
      </div>`;
    return;
  }

  const cardList = set.cards.map(c => `
    <div class="card-list-item">
      <div class="card-list-front">${escHtml(c.front)}</div>
      <div class="card-list-sep">|</div>
      <div class="card-list-back">${escHtml(c.back)}</div>
    </div>`).join('');

  app.innerHTML = `
    <div class="shared-banner">
      <div>
        <h2>${escHtml(set.name)}</h2>
        <p>${set.description ? escHtml(set.description) + ' · ' : ''}${set.cards.length} card${set.cards.length !== 1 ? 's' : ''} · Shared set</p>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn" style="background:rgba(255,255,255,.2);color:#fff" onclick="importSharedSet('${encoded}')">
          ⬇ Import to My Sets
        </button>
      </div>
    </div>

    <div style="margin-bottom:1rem;display:flex;gap:.75rem;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="studyShared('${encoded}')">Study This Set</button>
      <button class="btn btn-outline" onclick="quizShared('${encoded}')">Quiz Me</button>
    </div>

    <div class="section-heading">All Cards (${set.cards.length})</div>
    <div class="cards-list">${cardList}</div>`;
}

window.importSharedSet = function(encoded) {
  const shared = decodeSet(encoded);
  if (!shared) return;
  DB.createSet({ name: shared.name, description: shared.description || '', cards: shared.cards, isPublic: false });
  showToast('Set imported to your collection!');
  navigate('home');
};

window.studyShared = function(encoded) {
  // Import temporarily and study
  const shared = decodeSet(encoded);
  if (!shared) return;
  const set = DB.createSet({ name: shared.name, description: shared.description || '', cards: shared.cards, isPublic: false });
  navigate(`study/${set.id}`);
};

window.quizShared = function(encoded) {
  const shared = decodeSet(encoded);
  if (!shared) return;
  const set = DB.createSet({ name: shared.name, description: shared.description || '', cards: shared.cards, isPublic: false });
  navigate(`quiz/${set.id}`);
};

window.writtenShared = function(encoded) {
  const shared = decodeSet(encoded);
  if (!shared) return;
  const set = DB.createSet({ name: shared.name, description: shared.description || '', cards: shared.cards, isPublic: false });
  navigate(`written/${set.id}`);
};

/* ═══════════════════════════════════════════════════════════
   SHARE MODAL
   ═══════════════════════════════════════════════════════════ */
window.openShare = function(setId) {
  const set = DB.getSetById(setId);
  if (!set) return;
  const url = shareUrl(set);
  document.getElementById('share-url-input').value = url;
  document.getElementById('copy-feedback').classList.add('hidden');
  document.getElementById('share-overlay').classList.remove('hidden');
};

window.closeShare = function() {
  document.getElementById('share-overlay').classList.add('hidden');
};

window.copyShareUrl = function() {
  const input = document.getElementById('share-url-input');
  navigator.clipboard.writeText(input.value).then(() => {
    document.getElementById('copy-feedback').classList.remove('hidden');
    showToast('Link copied to clipboard!');
  }).catch(() => {
    input.select();
    document.execCommand('copy');
    document.getElementById('copy-feedback').classList.remove('hidden');
  });
};

/* ═══════════════════════════════════════════════════════════
   DELETE MODAL
   ═══════════════════════════════════════════════════════════ */
let pendingDeleteId = null;

window.openDeleteModal = function(setId, name) {
  pendingDeleteId = setId;
  document.getElementById('delete-set-name').textContent = name;
  document.getElementById('delete-overlay').classList.remove('hidden');
  document.getElementById('confirm-delete-btn').onclick = function() {
    unpublishSetFromCloud(pendingDeleteId);
    DB.deleteSet(pendingDeleteId);
    closeDeleteModal();
    navigate('home');
    showToast('Set deleted.');
  };
};

window.closeDeleteModal = function() {
  document.getElementById('delete-overlay').classList.add('hidden');
  pendingDeleteId = null;
};

/* ═══════════════════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════════════════ */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ═══════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ═══════════════════════════════════════════════════════════
   STUDY TOOLS — DATA
   ═══════════════════════════════════════════════════════════ */

const WORLD_CAPITALS = [
  {country:'United States',capital:'Washington D.C.',continent:'North America',flag:'🇺🇸'},
  {country:'Canada',capital:'Ottawa',continent:'North America',flag:'🇨🇦'},
  {country:'Mexico',capital:'Mexico City',continent:'North America',flag:'🇲🇽'},
  {country:'Cuba',capital:'Havana',continent:'North America',flag:'🇨🇺'},
  {country:'Jamaica',capital:'Kingston',continent:'North America',flag:'🇯🇲'},
  {country:'Haiti',capital:'Port-au-Prince',continent:'North America',flag:'🇭🇹'},
  {country:'Dominican Republic',capital:'Santo Domingo',continent:'North America',flag:'🇩🇴'},
  {country:'Guatemala',capital:'Guatemala City',continent:'North America',flag:'🇬🇹'},
  {country:'Honduras',capital:'Tegucigalpa',continent:'North America',flag:'🇭🇳'},
  {country:'Costa Rica',capital:'San José',continent:'North America',flag:'🇨🇷'},
  {country:'Panama',capital:'Panama City',continent:'North America',flag:'🇵🇦'},
  {country:'Brazil',capital:'Brasília',continent:'South America',flag:'🇧🇷'},
  {country:'Argentina',capital:'Buenos Aires',continent:'South America',flag:'🇦🇷'},
  {country:'Chile',capital:'Santiago',continent:'South America',flag:'🇨🇱'},
  {country:'Colombia',capital:'Bogotá',continent:'South America',flag:'🇨🇴'},
  {country:'Peru',capital:'Lima',continent:'South America',flag:'🇵🇪'},
  {country:'Venezuela',capital:'Caracas',continent:'South America',flag:'🇻🇪'},
  {country:'Ecuador',capital:'Quito',continent:'South America',flag:'🇪🇨'},
  {country:'Bolivia',capital:'Sucre',continent:'South America',flag:'🇧🇴'},
  {country:'Uruguay',capital:'Montevideo',continent:'South America',flag:'🇺🇾'},
  {country:'Paraguay',capital:'Asunción',continent:'South America',flag:'🇵🇾'},
  {country:'United Kingdom',capital:'London',continent:'Europe',flag:'🇬🇧'},
  {country:'France',capital:'Paris',continent:'Europe',flag:'🇫🇷'},
  {country:'Germany',capital:'Berlin',continent:'Europe',flag:'🇩🇪'},
  {country:'Italy',capital:'Rome',continent:'Europe',flag:'🇮🇹'},
  {country:'Spain',capital:'Madrid',continent:'Europe',flag:'🇪🇸'},
  {country:'Portugal',capital:'Lisbon',continent:'Europe',flag:'🇵🇹'},
  {country:'Netherlands',capital:'Amsterdam',continent:'Europe',flag:'🇳🇱'},
  {country:'Belgium',capital:'Brussels',continent:'Europe',flag:'🇧🇪'},
  {country:'Switzerland',capital:'Bern',continent:'Europe',flag:'🇨🇭'},
  {country:'Austria',capital:'Vienna',continent:'Europe',flag:'🇦🇹'},
  {country:'Poland',capital:'Warsaw',continent:'Europe',flag:'🇵🇱'},
  {country:'Czech Republic',capital:'Prague',continent:'Europe',flag:'🇨🇿'},
  {country:'Hungary',capital:'Budapest',continent:'Europe',flag:'🇭🇺'},
  {country:'Romania',capital:'Bucharest',continent:'Europe',flag:'🇷🇴'},
  {country:'Greece',capital:'Athens',continent:'Europe',flag:'🇬🇷'},
  {country:'Sweden',capital:'Stockholm',continent:'Europe',flag:'🇸🇪'},
  {country:'Norway',capital:'Oslo',continent:'Europe',flag:'🇳🇴'},
  {country:'Denmark',capital:'Copenhagen',continent:'Europe',flag:'🇩🇰'},
  {country:'Finland',capital:'Helsinki',continent:'Europe',flag:'🇫🇮'},
  {country:'Russia',capital:'Moscow',continent:'Europe',flag:'🇷🇺'},
  {country:'Ukraine',capital:'Kyiv',continent:'Europe',flag:'🇺🇦'},
  {country:'Turkey',capital:'Ankara',continent:'Europe',flag:'🇹🇷'},
  {country:'Croatia',capital:'Zagreb',continent:'Europe',flag:'🇭🇷'},
  {country:'Serbia',capital:'Belgrade',continent:'Europe',flag:'🇷🇸'},
  {country:'Ireland',capital:'Dublin',continent:'Europe',flag:'🇮🇪'},
  {country:'Slovakia',capital:'Bratislava',continent:'Europe',flag:'🇸🇰'},
  {country:'Bulgaria',capital:'Sofia',continent:'Europe',flag:'🇧🇬'},
  {country:'China',capital:'Beijing',continent:'Asia',flag:'🇨🇳'},
  {country:'Japan',capital:'Tokyo',continent:'Asia',flag:'🇯🇵'},
  {country:'South Korea',capital:'Seoul',continent:'Asia',flag:'🇰🇷'},
  {country:'North Korea',capital:'Pyongyang',continent:'Asia',flag:'🇰🇵'},
  {country:'India',capital:'New Delhi',continent:'Asia',flag:'🇮🇳'},
  {country:'Pakistan',capital:'Islamabad',continent:'Asia',flag:'🇵🇰'},
  {country:'Bangladesh',capital:'Dhaka',continent:'Asia',flag:'🇧🇩'},
  {country:'Indonesia',capital:'Jakarta',continent:'Asia',flag:'🇮🇩'},
  {country:'Philippines',capital:'Manila',continent:'Asia',flag:'🇵🇭'},
  {country:'Vietnam',capital:'Hanoi',continent:'Asia',flag:'🇻🇳'},
  {country:'Thailand',capital:'Bangkok',continent:'Asia',flag:'🇹🇭'},
  {country:'Malaysia',capital:'Kuala Lumpur',continent:'Asia',flag:'🇲🇾'},
  {country:'Myanmar',capital:'Naypyidaw',continent:'Asia',flag:'🇲🇲'},
  {country:'Saudi Arabia',capital:'Riyadh',continent:'Asia',flag:'🇸🇦'},
  {country:'Iran',capital:'Tehran',continent:'Asia',flag:'🇮🇷'},
  {country:'Iraq',capital:'Baghdad',continent:'Asia',flag:'🇮🇶'},
  {country:'Israel',capital:'Jerusalem',continent:'Asia',flag:'🇮🇱'},
  {country:'Jordan',capital:'Amman',continent:'Asia',flag:'🇯🇴'},
  {country:'UAE',capital:'Abu Dhabi',continent:'Asia',flag:'🇦🇪'},
  {country:'Kazakhstan',capital:'Astana',continent:'Asia',flag:'🇰🇿'},
  {country:'Afghanistan',capital:'Kabul',continent:'Asia',flag:'🇦🇫'},
  {country:'Nepal',capital:'Kathmandu',continent:'Asia',flag:'🇳🇵'},
  {country:'Mongolia',capital:'Ulaanbaatar',continent:'Asia',flag:'🇲🇳'},
  {country:'Cambodia',capital:'Phnom Penh',continent:'Asia',flag:'🇰🇭'},
  {country:'Laos',capital:'Vientiane',continent:'Asia',flag:'🇱🇦'},
  {country:'Sri Lanka',capital:'Sri Jayawardenepura Kotte',continent:'Asia',flag:'🇱🇰'},
  {country:'Taiwan',capital:'Taipei',continent:'Asia',flag:'🇹🇼'},
  {country:'Singapore',capital:'Singapore',continent:'Asia',flag:'🇸🇬'},
  {country:'Egypt',capital:'Cairo',continent:'Africa',flag:'🇪🇬'},
  {country:'Nigeria',capital:'Abuja',continent:'Africa',flag:'🇳🇬'},
  {country:'South Africa',capital:'Pretoria',continent:'Africa',flag:'🇿🇦'},
  {country:'Kenya',capital:'Nairobi',continent:'Africa',flag:'🇰🇪'},
  {country:'Ethiopia',capital:'Addis Ababa',continent:'Africa',flag:'🇪🇹'},
  {country:'Ghana',capital:'Accra',continent:'Africa',flag:'🇬🇭'},
  {country:'Tanzania',capital:'Dodoma',continent:'Africa',flag:'🇹🇿'},
  {country:'Morocco',capital:'Rabat',continent:'Africa',flag:'🇲🇦'},
  {country:'Algeria',capital:'Algiers',continent:'Africa',flag:'🇩🇿'},
  {country:'Sudan',capital:'Khartoum',continent:'Africa',flag:'🇸🇩'},
  {country:'Libya',capital:'Tripoli',continent:'Africa',flag:'🇱🇾'},
  {country:'Senegal',capital:'Dakar',continent:'Africa',flag:'🇸🇳'},
  {country:'Cameroon',capital:'Yaoundé',continent:'Africa',flag:'🇨🇲'},
  {country:'Angola',capital:'Luanda',continent:'Africa',flag:'🇦🇴'},
  {country:'Mozambique',capital:'Maputo',continent:'Africa',flag:'🇲🇿'},
  {country:'Madagascar',capital:'Antananarivo',continent:'Africa',flag:'🇲🇬'},
  {country:'Zimbabwe',capital:'Harare',continent:'Africa',flag:'🇿🇼'},
  {country:'Uganda',capital:'Kampala',continent:'Africa',flag:'🇺🇬'},
  {country:'Rwanda',capital:'Kigali',continent:'Africa',flag:'🇷🇼'},
  {country:'Tunisia',capital:'Tunis',continent:'Africa',flag:'🇹🇳'},
  {country:'Australia',capital:'Canberra',continent:'Oceania',flag:'🇦🇺'},
  {country:'New Zealand',capital:'Wellington',continent:'Oceania',flag:'🇳🇿'},
  {country:'Papua New Guinea',capital:'Port Moresby',continent:'Oceania',flag:'🇵🇬'},
  {country:'Fiji',capital:'Suva',continent:'Oceania',flag:'🇫🇯'},
];

const US_STATES = [
  {state:'Alabama',capital:'Montgomery',abbr:'AL'},
  {state:'Alaska',capital:'Juneau',abbr:'AK'},
  {state:'Arizona',capital:'Phoenix',abbr:'AZ'},
  {state:'Arkansas',capital:'Little Rock',abbr:'AR'},
  {state:'California',capital:'Sacramento',abbr:'CA'},
  {state:'Colorado',capital:'Denver',abbr:'CO'},
  {state:'Connecticut',capital:'Hartford',abbr:'CT'},
  {state:'Delaware',capital:'Dover',abbr:'DE'},
  {state:'Florida',capital:'Tallahassee',abbr:'FL'},
  {state:'Georgia',capital:'Atlanta',abbr:'GA'},
  {state:'Hawaii',capital:'Honolulu',abbr:'HI'},
  {state:'Idaho',capital:'Boise',abbr:'ID'},
  {state:'Illinois',capital:'Springfield',abbr:'IL'},
  {state:'Indiana',capital:'Indianapolis',abbr:'IN'},
  {state:'Iowa',capital:'Des Moines',abbr:'IA'},
  {state:'Kansas',capital:'Topeka',abbr:'KS'},
  {state:'Kentucky',capital:'Frankfort',abbr:'KY'},
  {state:'Louisiana',capital:'Baton Rouge',abbr:'LA'},
  {state:'Maine',capital:'Augusta',abbr:'ME'},
  {state:'Maryland',capital:'Annapolis',abbr:'MD'},
  {state:'Massachusetts',capital:'Boston',abbr:'MA'},
  {state:'Michigan',capital:'Lansing',abbr:'MI'},
  {state:'Minnesota',capital:'Saint Paul',abbr:'MN'},
  {state:'Mississippi',capital:'Jackson',abbr:'MS'},
  {state:'Missouri',capital:'Jefferson City',abbr:'MO'},
  {state:'Montana',capital:'Helena',abbr:'MT'},
  {state:'Nebraska',capital:'Lincoln',abbr:'NE'},
  {state:'Nevada',capital:'Carson City',abbr:'NV'},
  {state:'New Hampshire',capital:'Concord',abbr:'NH'},
  {state:'New Jersey',capital:'Trenton',abbr:'NJ'},
  {state:'New Mexico',capital:'Santa Fe',abbr:'NM'},
  {state:'New York',capital:'Albany',abbr:'NY'},
  {state:'North Carolina',capital:'Raleigh',abbr:'NC'},
  {state:'North Dakota',capital:'Bismarck',abbr:'ND'},
  {state:'Ohio',capital:'Columbus',abbr:'OH'},
  {state:'Oklahoma',capital:'Oklahoma City',abbr:'OK'},
  {state:'Oregon',capital:'Salem',abbr:'OR'},
  {state:'Pennsylvania',capital:'Harrisburg',abbr:'PA'},
  {state:'Rhode Island',capital:'Providence',abbr:'RI'},
  {state:'South Carolina',capital:'Columbia',abbr:'SC'},
  {state:'South Dakota',capital:'Pierre',abbr:'SD'},
  {state:'Tennessee',capital:'Nashville',abbr:'TN'},
  {state:'Texas',capital:'Austin',abbr:'TX'},
  {state:'Utah',capital:'Salt Lake City',abbr:'UT'},
  {state:'Vermont',capital:'Montpelier',abbr:'VT'},
  {state:'Virginia',capital:'Richmond',abbr:'VA'},
  {state:'Washington',capital:'Olympia',abbr:'WA'},
  {state:'West Virginia',capital:'Charleston',abbr:'WV'},
  {state:'Wisconsin',capital:'Madison',abbr:'WI'},
  {state:'Wyoming',capital:'Cheyenne',abbr:'WY'},
];

const PERIODIC_ELEMENTS = [
  {number:1,symbol:'H',name:'Hydrogen',mass:'1.008'},
  {number:2,symbol:'He',name:'Helium',mass:'4.003'},
  {number:3,symbol:'Li',name:'Lithium',mass:'6.941'},
  {number:4,symbol:'Be',name:'Beryllium',mass:'9.012'},
  {number:5,symbol:'B',name:'Boron',mass:'10.81'},
  {number:6,symbol:'C',name:'Carbon',mass:'12.01'},
  {number:7,symbol:'N',name:'Nitrogen',mass:'14.01'},
  {number:8,symbol:'O',name:'Oxygen',mass:'16.00'},
  {number:9,symbol:'F',name:'Fluorine',mass:'19.00'},
  {number:10,symbol:'Ne',name:'Neon',mass:'20.18'},
  {number:11,symbol:'Na',name:'Sodium',mass:'22.99'},
  {number:12,symbol:'Mg',name:'Magnesium',mass:'24.31'},
  {number:13,symbol:'Al',name:'Aluminum',mass:'26.98'},
  {number:14,symbol:'Si',name:'Silicon',mass:'28.09'},
  {number:15,symbol:'P',name:'Phosphorus',mass:'30.97'},
  {number:16,symbol:'S',name:'Sulfur',mass:'32.07'},
  {number:17,symbol:'Cl',name:'Chlorine',mass:'35.45'},
  {number:18,symbol:'Ar',name:'Argon',mass:'39.95'},
  {number:19,symbol:'K',name:'Potassium',mass:'39.10'},
  {number:20,symbol:'Ca',name:'Calcium',mass:'40.08'},
  {number:26,symbol:'Fe',name:'Iron',mass:'55.85'},
  {number:29,symbol:'Cu',name:'Copper',mass:'63.55'},
  {number:30,symbol:'Zn',name:'Zinc',mass:'65.38'},
  {number:35,symbol:'Br',name:'Bromine',mass:'79.90'},
  {number:36,symbol:'Kr',name:'Krypton',mass:'83.80'},
  {number:47,symbol:'Ag',name:'Silver',mass:'107.87'},
  {number:50,symbol:'Sn',name:'Tin',mass:'118.71'},
  {number:53,symbol:'I',name:'Iodine',mass:'126.90'},
  {number:54,symbol:'Xe',name:'Xenon',mass:'131.29'},
  {number:79,symbol:'Au',name:'Gold',mass:'196.97'},
  {number:80,symbol:'Hg',name:'Mercury',mass:'200.59'},
  {number:82,symbol:'Pb',name:'Lead',mass:'207.2'},
  {number:92,symbol:'U',name:'Uranium',mass:'238.03'},
];

const SPANISH_VERBS = [
  {infinitive:'hablar',english:'to speak',
   present:{yo:'hablo','tú':'hablas','él/ella':'habla',nosotros:'hablamos',vosotros:'habláis','ellos/ellas':'hablan'},
   preterite:{yo:'hablé','tú':'hablaste','él/ella':'habló',nosotros:'hablamos',vosotros:'hablasteis','ellos/ellas':'hablaron'}},
  {infinitive:'comer',english:'to eat',
   present:{yo:'como','tú':'comes','él/ella':'come',nosotros:'comemos',vosotros:'coméis','ellos/ellas':'comen'},
   preterite:{yo:'comí','tú':'comiste','él/ella':'comió',nosotros:'comimos',vosotros:'comisteis','ellos/ellas':'comieron'}},
  {infinitive:'vivir',english:'to live',
   present:{yo:'vivo','tú':'vives','él/ella':'vive',nosotros:'vivimos',vosotros:'vivís','ellos/ellas':'viven'},
   preterite:{yo:'viví','tú':'viviste','él/ella':'vivió',nosotros:'vivimos',vosotros:'vivisteis','ellos/ellas':'vivieron'}},
  {infinitive:'ser',english:'to be (permanent)',
   present:{yo:'soy','tú':'eres','él/ella':'es',nosotros:'somos',vosotros:'sois','ellos/ellas':'son'},
   preterite:{yo:'fui','tú':'fuiste','él/ella':'fue',nosotros:'fuimos',vosotros:'fuisteis','ellos/ellas':'fueron'}},
  {infinitive:'estar',english:'to be (temporary)',
   present:{yo:'estoy','tú':'estás','él/ella':'está',nosotros:'estamos',vosotros:'estáis','ellos/ellas':'están'},
   preterite:{yo:'estuve','tú':'estuviste','él/ella':'estuvo',nosotros:'estuvimos',vosotros:'estuvisteis','ellos/ellas':'estuvieron'}},
  {infinitive:'tener',english:'to have',
   present:{yo:'tengo','tú':'tienes','él/ella':'tiene',nosotros:'tenemos',vosotros:'tenéis','ellos/ellas':'tienen'},
   preterite:{yo:'tuve','tú':'tuviste','él/ella':'tuvo',nosotros:'tuvimos',vosotros:'tuvisteis','ellos/ellas':'tuvieron'}},
  {infinitive:'hacer',english:'to do/make',
   present:{yo:'hago','tú':'haces','él/ella':'hace',nosotros:'hacemos',vosotros:'hacéis','ellos/ellas':'hacen'},
   preterite:{yo:'hice','tú':'hiciste','él/ella':'hizo',nosotros:'hicimos',vosotros:'hicisteis','ellos/ellas':'hicieron'}},
  {infinitive:'ir',english:'to go',
   present:{yo:'voy','tú':'vas','él/ella':'va',nosotros:'vamos',vosotros:'vais','ellos/ellas':'van'},
   preterite:{yo:'fui','tú':'fuiste','él/ella':'fue',nosotros:'fuimos',vosotros:'fuisteis','ellos/ellas':'fueron'}},
  {infinitive:'poder',english:'to be able to',
   present:{yo:'puedo','tú':'puedes','él/ella':'puede',nosotros:'podemos',vosotros:'podéis','ellos/ellas':'pueden'},
   preterite:{yo:'pude','tú':'pudiste','él/ella':'pudo',nosotros:'pudimos',vosotros:'pudisteis','ellos/ellas':'pudieron'}},
  {infinitive:'querer',english:'to want/love',
   present:{yo:'quiero','tú':'quieres','él/ella':'quiere',nosotros:'queremos',vosotros:'queréis','ellos/ellas':'quieren'},
   preterite:{yo:'quise','tú':'quisiste','él/ella':'quiso',nosotros:'quisimos',vosotros:'quisisteis','ellos/ellas':'quisieron'}},
  {infinitive:'venir',english:'to come',
   present:{yo:'vengo','tú':'vienes','él/ella':'viene',nosotros:'venimos',vosotros:'venís','ellos/ellas':'vienen'},
   preterite:{yo:'vine','tú':'viniste','él/ella':'vino',nosotros:'vinimos',vosotros:'vinisteis','ellos/ellas':'vinieron'}},
  {infinitive:'dar',english:'to give',
   present:{yo:'doy','tú':'das','él/ella':'da',nosotros:'damos',vosotros:'dais','ellos/ellas':'dan'},
   preterite:{yo:'di','tú':'diste','él/ella':'dio',nosotros:'dimos',vosotros:'disteis','ellos/ellas':'dieron'}},
  {infinitive:'saber',english:'to know (facts)',
   present:{yo:'sé','tú':'sabes','él/ella':'sabe',nosotros:'sabemos',vosotros:'sabéis','ellos/ellas':'saben'},
   preterite:{yo:'supe','tú':'supiste','él/ella':'supo',nosotros:'supimos',vosotros:'supisteis','ellos/ellas':'supieron'}},
  {infinitive:'ver',english:'to see',
   present:{yo:'veo','tú':'ves','él/ella':'ve',nosotros:'vemos',vosotros:'veis','ellos/ellas':'ven'},
   preterite:{yo:'vi','tú':'viste','él/ella':'vio',nosotros:'vimos',vosotros:'visteis','ellos/ellas':'vieron'}},
  {infinitive:'poner',english:'to put/place',
   present:{yo:'pongo','tú':'pones','él/ella':'pone',nosotros:'ponemos',vosotros:'ponéis','ellos/ellas':'ponen'},
   preterite:{yo:'puse','tú':'pusiste','él/ella':'puso',nosotros:'pusimos',vosotros:'pusisteis','ellos/ellas':'pusieron'}},
];

const SPANISH_VOCAB = {
  'Colors':[
    {es:'rojo',en:'red'},{es:'azul',en:'blue'},{es:'verde',en:'green'},
    {es:'amarillo',en:'yellow'},{es:'blanco',en:'white'},{es:'negro',en:'black'},
    {es:'naranja',en:'orange'},{es:'morado',en:'purple'},{es:'rosa',en:'pink'},
    {es:'gris',en:'gray'},{es:'marrón',en:'brown'},
  ],
  'Numbers 1–20':[
    {es:'uno',en:'one'},{es:'dos',en:'two'},{es:'tres',en:'three'},
    {es:'cuatro',en:'four'},{es:'cinco',en:'five'},{es:'seis',en:'six'},
    {es:'siete',en:'seven'},{es:'ocho',en:'eight'},{es:'nueve',en:'nine'},
    {es:'diez',en:'ten'},{es:'once',en:'eleven'},{es:'doce',en:'twelve'},
    {es:'trece',en:'thirteen'},{es:'catorce',en:'fourteen'},{es:'quince',en:'fifteen'},
    {es:'dieciséis',en:'sixteen'},{es:'diecisiete',en:'seventeen'},{es:'dieciocho',en:'eighteen'},
    {es:'diecinueve',en:'nineteen'},{es:'veinte',en:'twenty'},
  ],
  'Family':[
    {es:'madre',en:'mother'},{es:'padre',en:'father'},{es:'hermano',en:'brother'},
    {es:'hermana',en:'sister'},{es:'abuelo',en:'grandfather'},{es:'abuela',en:'grandmother'},
    {es:'hijo',en:'son'},{es:'hija',en:'daughter'},{es:'tío',en:'uncle'},
    {es:'tía',en:'aunt'},{es:'primo',en:'cousin (m)'},{es:'esposo',en:'husband'},{es:'esposa',en:'wife'},
  ],
  'Food':[
    {es:'manzana',en:'apple'},{es:'pan',en:'bread'},{es:'leche',en:'milk'},
    {es:'agua',en:'water'},{es:'pollo',en:'chicken'},{es:'carne',en:'meat'},
    {es:'pescado',en:'fish'},{es:'arroz',en:'rice'},{es:'queso',en:'cheese'},
    {es:'huevo',en:'egg'},{es:'fruta',en:'fruit'},{es:'café',en:'coffee'},
    {es:'jugo',en:'juice'},{es:'sopa',en:'soup'},
  ],
  'School':[
    {es:'libro',en:'book'},{es:'lápiz',en:'pencil'},{es:'cuaderno',en:'notebook'},
    {es:'mesa',en:'table'},{es:'silla',en:'chair'},{es:'pizarra',en:'blackboard'},
    {es:'maestro',en:'teacher (m)'},{es:'maestra',en:'teacher (f)'},{es:'estudiante',en:'student'},
    {es:'tarea',en:'homework'},{es:'examen',en:'exam'},{es:'biblioteca',en:'library'},
    {es:'clase',en:'class'},{es:'escuela',en:'school'},
  ],
  'Animals':[
    {es:'perro',en:'dog'},{es:'gato',en:'cat'},{es:'caballo',en:'horse'},
    {es:'pájaro',en:'bird'},{es:'vaca',en:'cow'},{es:'cerdo',en:'pig'},
    {es:'elefante',en:'elephant'},{es:'tigre',en:'tiger'},{es:'león',en:'lion'},
    {es:'oso',en:'bear'},{es:'conejo',en:'rabbit'},{es:'serpiente',en:'snake'},
  ],
};

const FRENCH_VOCAB = {
  'Colors':[
    {fr:'rouge',en:'red'},{fr:'bleu',en:'blue'},{fr:'vert',en:'green'},
    {fr:'jaune',en:'yellow'},{fr:'blanc',en:'white'},{fr:'noir',en:'black'},
    {fr:'orange',en:'orange'},{fr:'violet',en:'purple'},{fr:'rose',en:'pink'},
    {fr:'gris',en:'gray'},{fr:'marron',en:'brown'},
  ],
  'Numbers 1–20':[
    {fr:'un',en:'one'},{fr:'deux',en:'two'},{fr:'trois',en:'three'},
    {fr:'quatre',en:'four'},{fr:'cinq',en:'five'},{fr:'six',en:'six'},
    {fr:'sept',en:'seven'},{fr:'huit',en:'eight'},{fr:'neuf',en:'nine'},
    {fr:'dix',en:'ten'},{fr:'onze',en:'eleven'},{fr:'douze',en:'twelve'},
    {fr:'treize',en:'thirteen'},{fr:'quatorze',en:'fourteen'},{fr:'quinze',en:'fifteen'},
    {fr:'seize',en:'sixteen'},{fr:'dix-sept',en:'seventeen'},{fr:'dix-huit',en:'eighteen'},
    {fr:'dix-neuf',en:'nineteen'},{fr:'vingt',en:'twenty'},
  ],
  'Family':[
    {fr:'mère',en:'mother'},{fr:'père',en:'father'},{fr:'frère',en:'brother'},
    {fr:'sœur',en:'sister'},{fr:'grand-père',en:'grandfather'},{fr:'grand-mère',en:'grandmother'},
    {fr:'fils',en:'son'},{fr:'fille',en:'daughter'},{fr:'oncle',en:'uncle'},
    {fr:'tante',en:'aunt'},{fr:'cousin',en:'cousin (m)'},{fr:'mari',en:'husband'},{fr:'femme',en:'wife'},
  ],
  'Food':[
    {fr:'pomme',en:'apple'},{fr:'pain',en:'bread'},{fr:'lait',en:'milk'},
    {fr:'eau',en:'water'},{fr:'poulet',en:'chicken'},{fr:'viande',en:'meat'},
    {fr:'poisson',en:'fish'},{fr:'riz',en:'rice'},{fr:'fromage',en:'cheese'},
    {fr:'œuf',en:'egg'},{fr:'fruit',en:'fruit'},{fr:'café',en:'coffee'},
    {fr:'jus',en:'juice'},{fr:'soupe',en:'soup'},
  ],
  'School':[
    {fr:'livre',en:'book'},{fr:'crayon',en:'pencil'},{fr:'cahier',en:'notebook'},
    {fr:'table',en:'table'},{fr:'chaise',en:'chair'},{fr:'tableau',en:'blackboard'},
    {fr:'professeur',en:'teacher'},{fr:'élève',en:'student'},
    {fr:'devoir',en:'homework'},{fr:'examen',en:'exam'},{fr:'bibliothèque',en:'library'},
    {fr:'classe',en:'class'},{fr:'école',en:'school'},
  ],
  'Animals':[
    {fr:'chien',en:'dog'},{fr:'chat',en:'cat'},{fr:'cheval',en:'horse'},
    {fr:'oiseau',en:'bird'},{fr:'vache',en:'cow'},{fr:'cochon',en:'pig'},
    {fr:'éléphant',en:'elephant'},{fr:'tigre',en:'tiger'},{fr:'lion',en:'lion'},
    {fr:'ours',en:'bear'},{fr:'lapin',en:'rabbit'},{fr:'serpent',en:'snake'},
  ],
};

/* ═══════════════════════════════════════════════════════════
   TOOLS HUB
   ═══════════════════════════════════════════════════════════ */
function renderToolsHub(app) {
  const tools = [
    {icon:'🌍', title:'Geography Quiz', desc:'World capitals, US state capitals, country flags, and continents.', route:'geo'},
    {icon:'➕', title:'Math Trainer', desc:'Arithmetic, times tables, fractions, and algebra practice with instant feedback.', route:'math'},
    {icon:'💬', title:'Language Tools', desc:'Spanish & French vocabulary and Spanish verb conjugation drills.', route:'language'},
    {icon:'⚗️', title:'Periodic Table', desc:'Quiz yourself on element names, symbols, and atomic numbers.', route:'elements'},
    {icon:'🧠', title:'AI Essay Grader', desc:'An AI generates open-ended questions on any topic, then grades your paragraph responses.', route:'essay'},
  ];
  app.innerHTML = `
    <div class="home-header">
      <div>
        <h1>Study Tools</h1>
        <p>Specialized tools to help you study every subject</p>
      </div>
      <button class="btn btn-ghost" onclick="navigate('home')">← My Sets</button>
    </div>
    <div class="tools-grid">
      ${tools.map(t => `
        <div class="tool-card" onclick="navigate('${t.route}')">
          <div class="tool-icon">${t.icon}</div>
          <div class="tool-title">${t.title}</div>
          <div class="tool-desc">${t.desc}</div>
          <button class="btn btn-primary btn-sm" style="margin-top:auto">Open →</button>
        </div>`).join('')}
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   GEOGRAPHY QUIZ
   ═══════════════════════════════════════════════════════════ */
function renderGeoHub(app) {
  const modes = [
    {label:'Country → Capital',sub:'See a country name, pick its capital',route:'geo-quiz/country-capital'},
    {label:'Capital → Country',sub:'See a capital city, pick its country',route:'geo-quiz/capital-country'},
    {label:'Flag → Country',sub:'See a flag emoji, pick the country',route:'geo-quiz/flag-country'},
    {label:'US State → Capital',sub:'See a US state, pick its capital',route:'geo-quiz/us-state-capital'},
    {label:'US Capital → State',sub:'See a capital, pick the US state',route:'geo-quiz/us-capital-state'},
    {label:'Country → Continent',sub:'Identify which continent a country belongs to',route:'geo-quiz/country-continent'},
  ];
  app.innerHTML = `
    <div class="home-header">
      <div><h1>🌍 Geography Quiz</h1><p>Pick a quiz mode to start</p></div>
      <button class="btn btn-ghost" onclick="navigate('tools')">← Tools</button>
    </div>
    <div class="tools-grid">
      ${modes.map(m => `
        <div class="tool-card" onclick="navigate('${m.route}')">
          <div class="tool-title">${m.label}</div>
          <div class="tool-desc">${m.sub}</div>
          <button class="btn btn-primary btn-sm" style="margin-top:auto">Start →</button>
        </div>`).join('')}
    </div>`;
}

function renderGeoQuiz(app, mode) {
  let pool, getQuestion, getOptions, getCorrect;
  const Q = 20;

  if (mode === 'country-capital') {
    pool = shuffle([...WORLD_CAPITALS]).slice(0, Q);
    getQuestion = d => `What is the capital of ${d.country}? ${d.flag}`;
    getCorrect  = d => d.capital;
    getOptions  = (d, all) => buildOpts(d.capital, all.map(x => x.capital));
  } else if (mode === 'capital-country') {
    pool = shuffle([...WORLD_CAPITALS]).slice(0, Q);
    getQuestion = d => `${d.flag} ${d.capital} is the capital of which country?`;
    getCorrect  = d => d.country;
    getOptions  = (d, all) => buildOpts(d.country, all.map(x => x.country));
  } else if (mode === 'flag-country') {
    pool = shuffle([...WORLD_CAPITALS]).slice(0, Q);
    getQuestion = d => `Which country does this flag represent?  ${d.flag}`;
    getCorrect  = d => d.country;
    getOptions  = (d, all) => buildOpts(d.country, all.map(x => x.country));
  } else if (mode === 'us-state-capital') {
    pool = shuffle([...US_STATES]).slice(0, Q);
    getQuestion = d => `What is the capital of ${d.state}?`;
    getCorrect  = d => d.capital;
    getOptions  = (d, all) => buildOpts(d.capital, all.map(x => x.capital));
  } else if (mode === 'us-capital-state') {
    pool = shuffle([...US_STATES]).slice(0, Q);
    getQuestion = d => `${d.capital} is the capital of which US state?`;
    getCorrect  = d => d.state;
    getOptions  = (d, all) => buildOpts(d.state, all.map(x => x.state));
  } else if (mode === 'country-continent') {
    pool = shuffle([...WORLD_CAPITALS]).slice(0, Q);
    getQuestion = d => `${d.flag} Which continent is ${d.country} in?`;
    getCorrect  = d => d.continent;
    getOptions  = (d, all) => buildOpts(d.continent, ['Africa','Asia','Europe','North America','South America','Oceania']);
  }

  runMCQuiz(app, pool, getQuestion, getCorrect, getOptions, '🌍 Geography', mode, 'geo');
}

function buildOpts(correct, allValues) {
  const others = shuffle([...new Set(allValues.filter(v => v !== correct))]).slice(0, 3);
  return shuffle([correct, ...others]);
}

/* ═══════════════════════════════════════════════════════════
   SHARED MC QUIZ RUNNER
   ═══════════════════════════════════════════════════════════ */
function runMCQuiz(app, pool, getQuestion, getCorrect, getOptions, label, mode, backRoute) {
  let idx = 0, score = 0, answered = false;

  function renderQ() {
    if (idx >= pool.length) { showResult(); return; }
    answered = false;
    const item = pool[idx];
    const correct = getCorrect(item);
    const opts = getOptions(item, pool);

    app.innerHTML = `
      <div class="quiz-header">
        <div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">${label}</div>
          <h2>Question ${idx+1} of ${pool.length}</h2>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="navigate('${backRoute}')">← Back</button>
      </div>
      <div style="max-width:640px;margin:0 auto .75rem">
        <div class="progress-bar"><div class="progress-bar-fill" style="width:${Math.round(idx/pool.length*100)}%"></div></div>
      </div>
      <div class="quiz-card">
        <div class="quiz-question" style="font-size:1.3rem">${escHtml(getQuestion(item))}</div>
        <div class="quiz-options" id="quiz-options">
          ${opts.map(o => `<button class="quiz-option" data-val="${escAttr(o)}" onclick="mcPick(this,'${escAttr(correct)}')">${escHtml(o)}</button>`).join('')}
        </div>
        <div id="quiz-feedback" class="quiz-feedback"></div>
        <div id="quiz-next" class="quiz-next" style="display:none">
          <button class="btn btn-primary" onclick="mcNext()">
            ${idx < pool.length-1 ? 'Next →' : 'See Results'}
          </button>
        </div>
      </div>`;
  }

  window.mcPick = function(btn, correct) {
    if (answered) return;
    answered = true;
    const selected = btn.dataset.val;
    const isCorrect = selected === correct;
    if (isCorrect) score++;
    document.querySelectorAll('.quiz-option').forEach(b => {
      b.onclick = null; b.classList.add('disabled');
      if (b.dataset.val === correct) b.classList.add('show-correct');
      if (b.dataset.val === selected && !isCorrect) b.classList.add('wrong');
      if (b.dataset.val === selected && isCorrect) b.classList.add('correct');
    });
    const fb = document.getElementById('quiz-feedback');
    fb.textContent = isCorrect ? '✓ Correct!' : `✗ Incorrect — answer: ${correct}`;
    fb.className = `quiz-feedback ${isCorrect ? 'correct' : 'wrong'}`;
    document.getElementById('quiz-next').style.display = 'flex';
  };

  window.mcNext = function() { idx++; renderQ(); };

  function showResult() {
    const pct = Math.round(score / pool.length * 100);
    const color = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
    const r = 54, circ = 2*Math.PI*r, dash = (pct/100)*circ;
    app.innerHTML = `
      <div class="quiz-score-card">
        <div style="font-size:2rem">🏆</div>
        <h2>Quiz Complete!</h2>
        <p>You scored ${score} out of ${pool.length}</p>
        <div class="score-ring-wrap"><div class="score-ring">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--border)" stroke-width="14"/>
            <circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="14"
              stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/>
          </svg>
          <div class="score-ring-text">
            <span class="score-ring-pct" style="color:${color}">${pct}%</span>
            <span class="score-ring-label">Score</span>
          </div>
        </div></div>
        <div class="complete-actions">
          <button class="btn btn-ghost" onclick="navigate('${backRoute}')">← Back</button>
          <button class="btn btn-primary" onclick="navigate('${mode}')">Try Again</button>
        </div>
      </div>`;
  }

  renderQ();
}

/* ═══════════════════════════════════════════════════════════
   MATH HELPERS  (shared by Math Trainer + Math Quiz)
   ═══════════════════════════════════════════════════════════ */

// Greek letter name → symbol map (used in both normalization and display)
const GREEK = {
  theta:'θ', alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ε',
  lambda:'λ', mu:'μ', phi:'φ', omega:'ω', sigma:'σ', pi:'π',
  rho:'ρ', tau:'τ', psi:'ψ', eta:'η', nu:'ν', xi:'ξ', zeta:'ζ'
};

// Normalize a math answer for comparison: both sides get the same treatment
// so equivalent-looking answers are treated as equal.
function normalizeMath(s) {
  let t = String(s).trim().toLowerCase();
  // Greek letter words → symbol (must happen before space-removal)
  for (const [name, sym] of Object.entries(GREEK)) {
    t = t.replace(new RegExp(`\\b${name}\\b`, 'g'), sym);
  }
  // "x = 2 or x = 3"  →  "x=2,x=3"  (before space removal)
  t = t.replace(/\bor\b/g, ',');
  // Unicode √ → text "sqrt" so all sqrt forms unify
  t = t.replace(/√/g, 'sqrt');
  // Strip all whitespace
  t = t.replace(/\s+/g, '');
  // Normalize operators
  t = t.replace(/[×✕⋅]/g, '*');
  t = t.replace(/÷/g, '/');
  // sqrt(x) → sqrtx  for simple single-token args (sqrt(5) == sqrt5 == √5)
  t = t.replace(/sqrt\(([a-z0-9]+)\)/g, 'sqrt$1');
  return t;
}

// Pretty-print a math string for display: converts text notation to symbols
function prettyMath(s) {
  let t = String(s);
  // sqrt(x) → √x  (simple single-arg cases first, then complex)
  t = t.replace(/sqrt\(([^)]+)\)/gi, (_, arg) => `√(${arg})`);
  t = t.replace(/√\((\w+)\)/g, '√$1'); // √(5) → √5 when arg is simple
  // Unicode √ with no parens already looks fine
  // Greek letter words → symbols (case-insensitive, whole-word only)
  for (const [name, sym] of Object.entries(GREEK)) {
    t = t.replace(new RegExp(`\\b${name}\\b`, 'gi'), sym);
  }
  // Common exponent shorthands
  t = t.replace(/\^2\b/g, '²').replace(/\^3\b/g, '³');
  return t;
}

/* ═══════════════════════════════════════════════════════════
   MATH TRAINER
   ═══════════════════════════════════════════════════════════ */
function renderMathHub(app) {
  const selectStyle = 'width:100%;padding:.55rem .75rem;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:1rem;background:var(--surface);color:var(--text)';
  const suggestions = ['Factoring quadratics','Long division','Derivatives','Systems of equations',
    'Fractions & decimals','Times tables','Geometry area & perimeter','Probability','Trigonometry','Exponents & radicals'];

  app.innerHTML = `
    <div class="home-header">
      <div><h1>➕ Math Trainer</h1><p>AI-generated problems on any math topic</p></div>
      <button class="btn btn-ghost" onclick="navigate('tools')">← Tools</button>
    </div>
    <div class="form-card" style="max-width:560px;margin:0 auto">
      ${renderAIProviderSection()}

      <div class="form-group">
        <label for="math-topic">What do you want to practice?</label>
        <input id="math-topic" type="text"
          placeholder="e.g. factoring quadratics, long division, derivatives…"
          maxlength="150" />
        <div class="math-suggestions">
          ${suggestions.map(s => `<button class="suggestion-chip" onclick="document.getElementById('math-topic').value='${s}'">${s}</button>`).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div class="form-group">
          <label for="math-qcount">Number of Questions</label>
          <select id="math-qcount" style="${selectStyle}">
            <option value="5">5 questions</option>
            <option value="10" selected>10 questions</option>
            <option value="20">20 questions</option>
          </select>
        </div>
        <div class="form-group">
          <label for="math-difficulty">Difficulty</label>
          <select id="math-difficulty" style="${selectStyle}">
            <option value="easy">Easy</option>
            <option value="medium" selected>Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary btn-lg" id="math-gen-btn" onclick="mathGenerate()">
          Generate Quiz →
        </button>
      </div>
      <div id="math-hub-error" style="color:var(--danger);margin-top:.75rem;display:none"></div>
    </div>`;

  window.mathGenerate = async function() {
    const { provider, apiKey } = getAIConfig();
    const topic      = document.getElementById('math-topic').value.trim();
    const qcount     = parseInt(document.getElementById('math-qcount').value, 10);
    const difficulty = document.getElementById('math-difficulty').value;
    const errEl      = document.getElementById('math-hub-error');
    errEl.style.display = 'none';

    if (!apiKey) { errEl.textContent = 'Please enter your API key.'; errEl.style.display=''; return; }
    if (!topic)  { errEl.textContent = 'Please enter a topic to practice.'; errEl.style.display=''; return; }

    const btn = document.getElementById('math-gen-btn');
    btn.textContent = 'Generating…'; btn.disabled = true;

    try {
      const raw = await callAI(provider, apiKey,
        'You are a math teacher creating practice problems. Respond only with valid JSON.',
        `Generate ${qcount} ${difficulty}-level math problems about: "${topic}".

Rules:
- Each problem must have one clear, unambiguous answer
- Answers should be concise (a number, expression, or short phrase)
- Include a short hint for each problem
- Include a "format" field that tells the student exactly how to write their answer (e.g. "Enter as a decimal rounded to 2 places", "Write both solutions as x = ___ or x = ___", "Give as a simplified fraction", "List coordinates as (x, y)", "Enter the exact value — you can type sqrt() for roots")
- Match the difficulty: easy = straightforward, medium = requires a few steps, hard = multi-step or conceptual

Respond with ONLY a JSON array:
[{"question": "Solve: x² - 5x + 6 = 0", "answer": "x = 2 or x = 3", "hint": "Factor into (x-a)(x-b)", "format": "Write both solutions as x = ___ or x = ___"}, ...]`
      );

      let questions;
      try { questions = JSON.parse(raw.match(/\[[\s\S]*\]/)[0]); }
      catch { throw new Error('Could not parse questions from AI response. Try again.'); }

      runAIMathSession(app, questions, topic, difficulty, qcount);
    } catch(e) {
      btn.textContent = 'Generate Quiz →'; btn.disabled = false;
      errEl.textContent = 'Error: ' + e.message; errEl.style.display = '';
    }
  };
}

function runAIMathSession(app, questions, topic, difficulty, total) {
  let idx = 0, score = 0, wrong = 0;

  function renderQ() {
    if (idx >= questions.length) { showResult(); return; }
    const item = questions[idx];

    app.innerHTML = `
      <div class="quiz-header">
        <div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">
            ➕ ${escHtml(topic)} · ${difficulty}
          </div>
          <h2>Problem ${idx + 1} of ${questions.length}</h2>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="navigate('math')">← Back</button>
      </div>
      <div style="max-width:640px;margin:0 auto .75rem">
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width:${Math.round(idx/questions.length*100)}%"></div>
        </div>
      </div>
      <div class="quiz-card">
        <div class="quiz-question" style="font-size:1.25rem;font-family:monospace;letter-spacing:.02em;line-height:1.6">
          ${escHtml(prettyMath(item.question))}
        </div>
        ${item.format ? `
        <div style="display:inline-flex;align-items:center;gap:.4rem;margin:.75rem 0 0;padding:.35rem .65rem;background:var(--primary-soft,rgba(99,102,241,.1));border-radius:var(--radius-sm);font-size:.82rem;font-weight:600;color:var(--primary)">
          ✎ Format: <span style="font-weight:400">${escHtml(prettyMath(item.format))}</span>
        </div>` : ''}
        ${item.hint ? `
        <details class="math-hint-details">
          <summary>💡 Show hint</summary>
          <span>${escHtml(prettyMath(item.hint))}</span>
        </details>` : ''}
        <div class="written-input-wrap" style="margin-top:1.25rem">
          <input id="math-answer" type="text" class="written-answer-input"
            placeholder="Your answer…" autocomplete="off" />
          <button class="btn btn-primary btn-wide" id="math-check-btn" onclick="mathAISubmit()">Check</button>
        </div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-top:.35rem">
          Tip: type <code>sqrt(5)</code> for √5 · <code>theta</code> for θ · <code>pi</code> for π · <code>(2, 3)</code> or <code>(2,3)</code> both work
        </div>
        <div id="math-feedback" class="written-feedback"></div>
        <div id="math-next" class="quiz-next" style="display:none">
          <button class="btn btn-primary" onclick="mathAINext()">
            ${idx < questions.length - 1 ? 'Next →' : 'See Results'}
          </button>
        </div>
      </div>`;

    const inp = document.getElementById('math-answer');
    inp.focus();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') mathAISubmit(); });

    window.mathAISubmit = function() {
      const inp2 = document.getElementById('math-answer');
      if (!inp2 || inp2.disabled) return;
      const val = inp2.value.trim();
      if (!val) { showToast('Enter an answer first.'); return; }

      const isCorrect = normalizeMath(val) === normalizeMath(item.answer);

      if (isCorrect) score++; else wrong++;
      inp2.disabled = true;
      inp2.classList.add(isCorrect ? 'written-correct' : 'written-wrong');
      document.getElementById('math-check-btn').disabled = true;

      const fb = document.getElementById('math-feedback');
      fb.className = `written-feedback ${isCorrect ? 'correct' : 'wrong'}`;
      fb.innerHTML = isCorrect
        ? '✓ Correct!'
        : `✗ Incorrect — answer: <strong>${escHtml(prettyMath(item.answer))}</strong>`;

      document.getElementById('math-next').style.display = 'flex';
    };

    window.mathAINext = function() { idx++; renderQ(); };
  }

  function showResult() {
    const pct = Math.round(score / questions.length * 100);
    const color = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
    const r = 54, circ = 2 * Math.PI * r, dash = (pct / 100) * circ;
    app.innerHTML = `
      <div class="quiz-score-card">
        <div style="font-size:2rem">🔢</div>
        <h2>${escHtml(topic)} Complete!</h2>
        <p>You scored ${score} out of ${questions.length}</p>
        <div class="score-ring-wrap"><div class="score-ring">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--border)" stroke-width="14"/>
            <circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="14"
              stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/>
          </svg>
          <div class="score-ring-text">
            <span class="score-ring-pct" style="color:${color}">${pct}%</span>
            <span class="score-ring-label">Score</span>
          </div>
        </div></div>
        <div class="score-breakdown">
          <div class="score-stat"><span class="score-stat-num correct">${score}</span><span class="score-stat-label">Correct</span></div>
          <div class="score-stat"><span class="score-stat-num wrong">${wrong}</span><span class="score-stat-label">Incorrect</span></div>
        </div>
        <div class="complete-actions">
          <button class="btn btn-ghost" onclick="navigate('math')">← Back</button>
          <button class="btn btn-primary" onclick="navigate('math')">New Quiz</button>
        </div>
      </div>`;
  }

  renderQ();
}

function mathRandInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function mathGcd(a, b) { return b === 0 ? a : mathGcd(b, a % b); }

function generateMathProblem(mode) {
  if (mode === 'arith-easy') {
    const ops = ['+', '-'];
    const op = ops[Math.floor(Math.random()*2)];
    const a = mathRandInt(1, 20), b = mathRandInt(1, 20);
    if (op === '+') return {q:`${a} + ${b} = ?`, a:String(a+b)};
    const big = Math.max(a,b), small = Math.min(a,b);
    return {q:`${big} − ${small} = ?`, a:String(big-small)};
  }
  if (mode === 'arith-hard') {
    const ops = ['+', '-', '×', '÷'];
    const op = ops[Math.floor(Math.random()*4)];
    if (op==='+'){const a=mathRandInt(10,999),b=mathRandInt(10,999);return{q:`${a} + ${b} = ?`,a:String(a+b)};}
    if (op==='-'){const a=mathRandInt(50,999),b=mathRandInt(1,a);return{q:`${a} − ${b} = ?`,a:String(a-b)};}
    if (op==='×'){const a=mathRandInt(2,25),b=mathRandInt(2,25);return{q:`${a} × ${b} = ?`,a:String(a*b)};}
    const b=mathRandInt(2,12),ans=mathRandInt(2,25);return{q:`${b*ans} ÷ ${b} = ?`,a:String(ans)};
  }
  if (mode === 'times-tables') {
    const a = mathRandInt(2, 12), b = mathRandInt(1, 12);
    return {q:`${a} × ${b} = ?`, a:String(a*b)};
  }
  if (mode === 'fractions') {
    const d1=mathRandInt(2,8), d2=mathRandInt(2,8);
    const n1=mathRandInt(1,d1-1||1), n2=mathRandInt(1,d2-1||1);
    const numSum=n1*d2+n2*d1, denSum=d1*d2;
    const g=mathGcd(numSum,denSum);
    const rn=numSum/g, rd=denSum/g;
    const ans = rd===1 ? String(rn) : `${rn}/${rd}`;
    return {q:`${n1}/${d1} + ${n2}/${d2} = ? (simplify)`, a:ans, hint:`${rn}/${rd}`};
  }
  if (mode === 'algebra') {
    const a=mathRandInt(1,10), x=mathRandInt(-15,15), b=mathRandInt(-20,20);
    const c=a*x+b;
    const lhs = b>=0 ? `${a}x + ${b}` : `${a}x − ${Math.abs(b)}`;
    return {q:`Solve for x:  ${lhs} = ${c}`, a:String(x)};
  }
  return {q:'', a:''};
}

function renderMathQuiz(app, mode) {
  const TOTAL = 20;
  let idx=0, score=0, wrong=0;
  const modeLabels = {
    'arith-easy':'Arithmetic (Easy)', 'arith-hard':'Arithmetic (Hard)',
    'times-tables':'Times Tables', 'fractions':'Fractions', 'algebra':'Algebra'
  };
  const label = modeLabels[mode] || 'Math';

  function renderQ() {
    if (idx >= TOTAL) { showResult(); return; }
    const {q, a: correctAns} = generateMathProblem(mode);

    app.innerHTML = `
      <div class="quiz-header">
        <div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">➕ ${label}</div>
          <h2>Problem ${idx+1} of ${TOTAL}</h2>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="navigate('math')">← Back</button>
      </div>
      <div style="max-width:640px;margin:0 auto .75rem">
        <div class="progress-bar"><div class="progress-bar-fill" style="width:${Math.round(idx/TOTAL*100)}%"></div></div>
      </div>
      <div class="quiz-card">
        <div class="quiz-question" style="font-size:1.6rem;font-family:monospace;letter-spacing:.02em">${escHtml(prettyMath(q))}</div>
        <div class="written-input-wrap">
          <input id="math-answer" type="text" class="written-answer-input"
            placeholder="Your answer…" autocomplete="off" inputmode="decimal" />
          <button class="btn btn-primary btn-wide" onclick="mathSubmit('${escAttr(correctAns)}')">Check</button>
        </div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-top:.35rem">
          Tip: type <code>sqrt(5)</code> for √5 · <code>theta</code> for θ · <code>pi</code> for π
        </div>
        <div id="math-feedback" class="written-feedback"></div>
        <div id="math-next" class="quiz-next" style="display:none">
          <button class="btn btn-primary" onclick="mathNext()">
            ${idx < TOTAL-1 ? 'Next →' : 'See Results'}
          </button>
        </div>
      </div>`;

    const inp = document.getElementById('math-answer');
    inp.focus();
    inp.addEventListener('keydown', e => { if (e.key==='Enter') mathSubmit(correctAns); });
  }

  window.mathSubmit = function(correctAns) {
    const inp = document.getElementById('math-answer');
    if (!inp || inp.disabled) return;
    const val = inp.value.trim();
    if (!val) { showToast('Enter an answer first.'); return; }
    const isCorrect = normalizeMath(val) === normalizeMath(correctAns);
    if (isCorrect) score++; else wrong++;
    inp.disabled = true;
    inp.classList.add(isCorrect ? 'written-correct' : 'written-wrong');
    const fb = document.getElementById('math-feedback');
    fb.className = `written-feedback ${isCorrect ? 'correct' : 'wrong'}`;
    fb.innerHTML = isCorrect ? '✓ Correct!' : `✗ Incorrect — answer: <strong>${escHtml(prettyMath(correctAns))}</strong>`;
    document.getElementById('math-next').style.display = 'flex';
  };

  window.mathNext = function() { idx++; renderQ(); };

  function showResult() {
    const pct = Math.round(score/TOTAL*100);
    const color = pct>=80?'var(--success)':pct>=50?'var(--warning)':'var(--danger)';
    const r=54,circ=2*Math.PI*r,dash=(pct/100)*circ;
    app.innerHTML = `
      <div class="quiz-score-card">
        <div style="font-size:2rem">🔢</div>
        <h2>${label} Complete!</h2>
        <p>You scored ${score} out of ${TOTAL}</p>
        <div class="score-ring-wrap"><div class="score-ring">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--border)" stroke-width="14"/>
            <circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="14"
              stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/>
          </svg>
          <div class="score-ring-text">
            <span class="score-ring-pct" style="color:${color}">${pct}%</span>
            <span class="score-ring-label">Score</span>
          </div>
        </div></div>
        <div class="complete-actions">
          <button class="btn btn-ghost" onclick="navigate('math')">← Back</button>
          <button class="btn btn-primary" onclick="navigate('math-quiz/${mode}')">Try Again</button>
        </div>
      </div>`;
  }

  renderQ();
}

/* ═══════════════════════════════════════════════════════════
   LANGUAGE TOOLS
   ═══════════════════════════════════════════════════════════ */
function renderLanguageHub(app) {
  const esThemes = Object.keys(SPANISH_VOCAB).map(t =>
    `<button class="btn btn-outline btn-sm" onclick="navigate('lang-quiz/es-vocab-${encodeURIComponent(t)}')">${t}</button>`).join('');
  const frThemes = Object.keys(FRENCH_VOCAB).map(t =>
    `<button class="btn btn-outline btn-sm" onclick="navigate('lang-quiz/fr-vocab-${encodeURIComponent(t)}')">${t}</button>`).join('');

  app.innerHTML = `
    <div class="home-header">
      <div><h1>💬 Language Tools</h1><p>Vocabulary and conjugation drills</p></div>
      <button class="btn btn-ghost" onclick="navigate('tools')">← Tools</button>
    </div>
    <div class="lang-hub">
      <div class="lang-section">
        <div class="section-heading">🇪🇸 Spanish — Vocabulary</div>
        <div class="lang-btn-row">${esThemes}</div>
        <div class="section-heading" style="margin-top:1.5rem">🇪🇸 Spanish — Verb Conjugation</div>
        <div class="lang-btn-row">
          <button class="btn btn-outline btn-sm" onclick="navigate('lang-quiz/es-conj-present')">Present Tense</button>
          <button class="btn btn-outline btn-sm" onclick="navigate('lang-quiz/es-conj-preterite')">Preterite Tense</button>
        </div>
      </div>
      <div class="lang-section">
        <div class="section-heading">🇫🇷 French — Vocabulary</div>
        <div class="lang-btn-row">${frThemes}</div>
      </div>
    </div>`;
}

function renderLangQuiz(app, param) {
  const parts = param.split('-');
  const lang = parts[0]; // 'es' or 'fr'
  const type = parts[1]; // 'vocab' or 'conj'
  const detail = parts.slice(2).join('-'); // theme or tense

  if (type === 'vocab') {
    const theme = decodeURIComponent(detail);
    const dict = lang === 'es' ? SPANISH_VOCAB : FRENCH_VOCAB;
    const key = lang === 'es' ? 'es' : 'fr';
    const langName = lang === 'es' ? 'Spanish' : 'French';
    const pool = shuffle([...(dict[theme] || [])]);
    if (!pool.length) { navigate('language'); return; }
    const fullPool = lang === 'es'
      ? Object.values(SPANISH_VOCAB).flat()
      : Object.values(FRENCH_VOCAB).flat();

    const getQ  = d => `What is the ${langName} word for "${d.en}"?`;
    const getC  = d => d[key];
    const getO  = (d, all) => buildOpts(d[key], fullPool.map(x => x[key]));
    runMCQuiz(app, pool, getQ, getC, getO, `${langName} — ${theme}`, `lang-quiz/${param}`, 'language');

  } else if (type === 'conj') {
    const tense = detail; // 'present' or 'preterite'
    const subjects = ['yo','tú','él/ella','nosotros','vosotros','ellos/ellas'];
    const pool = [];
    shuffle([...SPANISH_VERBS]).forEach(v => {
      subjects.forEach(s => {
        pool.push({verb: v.infinitive, english: v.english, subject: s, answer: v[tense][s]});
      });
    });
    const q20 = shuffle(pool).slice(0, 20);
    const tenseLabel = tense === 'present' ? 'Present' : 'Preterite';

    let idx=0, score=0, wrong=0, quizAnswered=false;

    function renderConjQ() {
      if (idx >= q20.length) { showConjResult(); return; }
      quizAnswered = false;
      const item = q20[idx];
      const allAnswers = SPANISH_VERBS.flatMap(v => Object.values(v[tense]));
      const opts = buildOpts(item.answer, allAnswers);

      app.innerHTML = `
        <div class="quiz-header">
          <div>
            <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">🇪🇸 Spanish — ${tenseLabel}</div>
            <h2>Question ${idx+1} of ${q20.length}</h2>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="navigate('language')">← Back</button>
        </div>
        <div style="max-width:640px;margin:0 auto .75rem">
          <div class="progress-bar"><div class="progress-bar-fill" style="width:${Math.round(idx/q20.length*100)}%"></div></div>
        </div>
        <div class="quiz-card">
          <div class="quiz-question">
            <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.4rem">${item.verb} (${item.english})</div>
            What is the <strong>${tenseLabel.toLowerCase()}</strong> conjugation of
            <strong>${item.verb}</strong> for <strong>${item.subject}</strong>?
          </div>
          <div class="quiz-options">
            ${opts.map(o => `<button class="quiz-option" data-val="${escAttr(o)}" onclick="mcPick(this,'${escAttr(item.answer)}')">${escHtml(o)}</button>`).join('')}
          </div>
          <div id="quiz-feedback" class="quiz-feedback"></div>
          <div id="quiz-next" class="quiz-next" style="display:none">
            <button class="btn btn-primary" onclick="conjNext()">${idx < q20.length-1 ? 'Next →' : 'See Results'}</button>
          </div>
        </div>`;

      window.mcPick = function(btn, correct) {
        if (quizAnswered) return;
        quizAnswered = true;
        const sel = btn.dataset.val;
        const ok = sel === correct;
        if (ok) score++; else wrong++;
        document.querySelectorAll('.quiz-option').forEach(b => {
          b.onclick=null; b.classList.add('disabled');
          if (b.dataset.val===correct) b.classList.add('show-correct');
          if (b.dataset.val===sel && !ok) b.classList.add('wrong');
          if (b.dataset.val===sel && ok) b.classList.add('correct');
        });
        const fb=document.getElementById('quiz-feedback');
        fb.textContent = ok ? '✓ Correct!' : `✗ Incorrect — ${correct}`;
        fb.className = `quiz-feedback ${ok?'correct':'wrong'}`;
        document.getElementById('quiz-next').style.display='flex';
      };
      window.conjNext = function() { idx++; renderConjQ(); };
    }

    function showConjResult() {
      const pct=Math.round(score/q20.length*100);
      const color=pct>=80?'var(--success)':pct>=50?'var(--warning)':'var(--danger)';
      const r=54,circ=2*Math.PI*r,dash=(pct/100)*circ;
      app.innerHTML=`
        <div class="quiz-score-card">
          <div style="font-size:2rem">🇪🇸</div>
          <h2>Conjugation Quiz Complete!</h2>
          <p>You scored ${score} out of ${q20.length}</p>
          <div class="score-ring-wrap"><div class="score-ring">
            <svg width="140" height="140" viewBox="0 0 140 140">
              <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--border)" stroke-width="14"/>
              <circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="14"
                stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/>
            </svg>
            <div class="score-ring-text">
              <span class="score-ring-pct" style="color:${color}">${pct}%</span>
              <span class="score-ring-label">Score</span>
            </div>
          </div></div>
          <div class="complete-actions">
            <button class="btn btn-ghost" onclick="navigate('language')">← Back</button>
            <button class="btn btn-primary" onclick="navigate('lang-quiz/${param}')">Try Again</button>
          </div>
        </div>`;
    }

    renderConjQ();
  }
}

/* ═══════════════════════════════════════════════════════════
   PERIODIC TABLE QUIZ
   ═══════════════════════════════════════════════════════════ */
function renderPeriodicHub(app) {
  app.innerHTML = `
    <div class="home-header">
      <div><h1>⚗️ Periodic Table</h1><p>Pick a quiz mode</p></div>
      <button class="btn btn-ghost" onclick="navigate('tools')">← Tools</button>
    </div>
    <div class="tools-grid">
      <div class="tool-card" onclick="navigate('elements/symbol-name')">
        <div class="tool-title">Symbol → Name</div>
        <div class="tool-desc">See a chemical symbol, identify the element name.</div>
        <button class="btn btn-primary btn-sm" style="margin-top:auto">Start →</button>
      </div>
      <div class="tool-card" onclick="navigate('elements/name-symbol')">
        <div class="tool-title">Name → Symbol</div>
        <div class="tool-desc">See an element name, pick its chemical symbol.</div>
        <button class="btn btn-primary btn-sm" style="margin-top:auto">Start →</button>
      </div>
      <div class="tool-card" onclick="navigate('elements/number-name')">
        <div class="tool-title">Atomic Number → Name</div>
        <div class="tool-desc">See an atomic number, pick the element name.</div>
        <button class="btn btn-primary btn-sm" style="margin-top:auto">Start →</button>
      </div>
    </div>`;
}

function renderPeriodicQuiz(app, mode) {
  const pool = shuffle([...PERIODIC_ELEMENTS]).slice(0, 20);
  let getQ, getC, getO;
  if (mode === 'symbol-name') {
    getQ = e => `What element has the symbol  ${e.symbol} ?`;
    getC = e => e.name;
    getO = (e,all) => buildOpts(e.name, all.map(x=>x.name));
  } else if (mode === 'name-symbol') {
    getQ = e => `What is the chemical symbol for ${e.name}?`;
    getC = e => e.symbol;
    getO = (e,all) => buildOpts(e.symbol, all.map(x=>x.symbol));
  } else {
    getQ = e => `Atomic number ${e.number} belongs to which element?`;
    getC = e => e.name;
    getO = (e,all) => buildOpts(e.name, all.map(x=>x.name));
  }
  runMCQuiz(app, pool, getQ, getC, getO, '⚗️ Periodic Table', `elements/${mode}`, 'elements');
}

/* ═══════════════════════════════════════════════════════════
   AI ESSAY GRADER
   ═══════════════════════════════════════════════════════════ */
async function callClaude(apiKey, systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

/* ─── Multi-provider AI helpers ──────────────────────────── */
function renderAIProviderSection() {
  const p = localStorage.getItem('sf_ai_provider') || 'anthropic';
  const keys = {
    anthropic: escAttr(localStorage.getItem('sf_anthropic_key') || ''),
    openai:    escAttr(localStorage.getItem('sf_openai_key')    || ''),
    gemini:    escAttr(localStorage.getItem('sf_gemini_key')    || ''),
  };
  return `
    <div class="form-group">
      <label>AI Provider</label>
      <div class="ai-provider-tabs">
        <button type="button" class="ai-tab ${p==='anthropic'?'active':''}" onclick="setAIProvider('anthropic')">Anthropic (Claude)</button>
        <button type="button" class="ai-tab ${p==='openai'?'active':''}"    onclick="setAIProvider('openai')">OpenAI (ChatGPT)</button>
        <button type="button" class="ai-tab ${p==='gemini'?'active':''}"    onclick="setAIProvider('gemini')">Google (Gemini)</button>
      </div>
    </div>
    <div id="ai-key-anthropic" class="form-group" style="${p!=='anthropic'?'display:none':''}">
      <label>Anthropic API Key</label>
      <input id="ai-key-anthropic-inp" type="password" placeholder="sk-ant-…" value="${keys.anthropic}" autocomplete="off" />
      <span class="hint">Get your key at console.anthropic.com — stored only in your browser.</span>
    </div>
    <div id="ai-key-openai" class="form-group" style="${p!=='openai'?'display:none':''}">
      <label>OpenAI API Key</label>
      <input id="ai-key-openai-inp" type="password" placeholder="sk-…" value="${keys.openai}" autocomplete="off" />
      <span class="hint">Get your key at platform.openai.com — stored only in your browser.</span>
    </div>
    <div id="ai-key-gemini" class="form-group" style="${p!=='gemini'?'display:none':''}">
      <label>Google Gemini API Key</label>
      <input id="ai-key-gemini-inp" type="password" placeholder="AIza…" value="${keys.gemini}" autocomplete="off" />
      <span class="hint">Get your key at aistudio.google.com — stored only in your browser.</span>
    </div>`;
}

window.setAIProvider = function(p) {
  localStorage.setItem('sf_ai_provider', p);
  ['anthropic', 'openai', 'gemini'].forEach(provider => {
    const el = document.getElementById(`ai-key-${provider}`);
    if (el) el.style.display = provider === p ? '' : 'none';
  });
  document.querySelectorAll('.ai-tab').forEach(tab => {
    const labels = { anthropic:'anthropic', openai:'openai', gemini:'gemini' };
    const tabP = Object.keys(labels).find(k => tab.textContent.toLowerCase().includes(k));
    tab.classList.toggle('active', tabP === p);
  });
};

function getAIConfig() {
  const provider = localStorage.getItem('sf_ai_provider') || 'anthropic';
  const inputMap = { anthropic:'ai-key-anthropic-inp', openai:'ai-key-openai-inp', gemini:'ai-key-gemini-inp' };
  const storeMap = { anthropic:'sf_anthropic_key',     openai:'sf_openai_key',     gemini:'sf_gemini_key'     };
  const inp = document.getElementById(inputMap[provider]);
  const apiKey = (inp ? inp.value.trim() : '') || localStorage.getItem(storeMap[provider]) || '';
  if (apiKey) localStorage.setItem(storeMap[provider], apiKey);
  return { provider, apiKey };
}

async function callAI(provider, apiKey, systemPrompt, userPrompt) {
  if (provider === 'anthropic') return callClaude(apiKey, systemPrompt, userPrompt);

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 1024,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message || `OpenAI error ${res.status}`); }
    return (await res.json()).choices[0].message.content;
  }

  if (provider === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 1024 },
        }),
      }
    );
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message || `Gemini error ${res.status}`); }
    return (await res.json()).candidates[0].content.parts[0].text;
  }

  throw new Error('Unknown AI provider: ' + provider);
}

function renderEssayGrader(app) {
  const selectStyle = 'width:100%;padding:.55rem .75rem;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:1rem;background:var(--surface);color:var(--text)';
  const sets = DB.getSets();
  const setOptions = sets.length
    ? sets.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)} (${s.cards.length} cards)</option>`).join('')
    : '<option value="" disabled>No flashcard sets saved yet</option>';

  app.innerHTML = `
    <div class="home-header">
      <div><h1>🧠 AI Essay Grader</h1><p>AI-generated questions graded by AI</p></div>
      <button class="btn btn-ghost" onclick="navigate('tools')">← Tools</button>
    </div>
    <div class="form-card" style="max-width:640px;margin:0 auto">
      ${renderAIProviderSection()}
      <div class="form-group">
        <label style="margin-bottom:.5rem;display:block">Question Source</label>
        <div style="display:flex;gap:.5rem">
          <button id="essay-src-topic" class="btn btn-primary btn-sm" onclick="essaySetSource('topic')">Custom Topic</button>
          <button id="essay-src-set" class="btn btn-ghost btn-sm" onclick="essaySetSource('set')">From Flashcard Set</button>
        </div>
      </div>
      <div id="essay-topic-group" class="form-group">
        <label for="essay-topic">Topic / Subject</label>
        <input id="essay-topic" type="text" placeholder="e.g. The American Civil War, Photosynthesis, Romeo and Juliet…" maxlength="200" />
      </div>
      <div id="essay-set-group" class="form-group" style="display:none">
        <label for="essay-set-select">Flashcard Set</label>
        <select id="essay-set-select" style="${selectStyle}">
          ${setOptions}
        </select>
      </div>
      <div class="form-group">
        <label for="essay-qcount">Number of Questions</label>
        <select id="essay-qcount" style="${selectStyle}">
          <option value="3">3 questions</option>
          <option value="5" selected>5 questions</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary btn-lg" id="essay-gen-btn" onclick="essayGenerate()">Generate Questions →</button>
      </div>
      <div id="essay-error" style="color:var(--danger);margin-top:.75rem;display:none"></div>
    </div>`;

  window.essaySetSource = function(mode) {
    const topicGrp = document.getElementById('essay-topic-group');
    const setGrp   = document.getElementById('essay-set-group');
    const btnTopic = document.getElementById('essay-src-topic');
    const btnSet   = document.getElementById('essay-src-set');
    if (mode === 'topic') {
      topicGrp.style.display = '';
      setGrp.style.display   = 'none';
      btnTopic.className = 'btn btn-primary btn-sm';
      btnSet.className   = 'btn btn-ghost btn-sm';
    } else {
      topicGrp.style.display = 'none';
      setGrp.style.display   = '';
      btnTopic.className = 'btn btn-ghost btn-sm';
      btnSet.className   = 'btn btn-primary btn-sm';
    }
  };

  window.essayGenerate = async function() {
    const { provider, apiKey } = getAIConfig();
    const qcount  = parseInt(document.getElementById('essay-qcount').value, 10);
    const errEl   = document.getElementById('essay-error');
    const useSet  = document.getElementById('essay-set-group').style.display !== 'none';
    errEl.style.display = 'none';

    if (!apiKey) { errEl.textContent = 'Please enter your API key.'; errEl.style.display=''; return; }

    let topic, systemPrompt, userPrompt;

    if (useSet) {
      const setId = document.getElementById('essay-set-select').value;
      if (!setId) { errEl.textContent = 'Please select a flashcard set.'; errEl.style.display=''; return; }
      const set = DB.getSetById(setId);
      if (!set) { errEl.textContent = 'Flashcard set not found.'; errEl.style.display=''; return; }
      topic = set.name;
      const cardList = set.cards.slice(0, 60).map(c => `- ${c.front}: ${c.back}`).join('\n');
      systemPrompt = 'You are a teacher creating open-ended essay questions based on flashcard study material. Respond only with a valid JSON array of question strings.';
      userPrompt = `Here are flashcards from the set "${set.name}":\n${cardList}\n\nGenerate ${qcount} thoughtful open-ended questions that test deep understanding of this material. Questions should require paragraph responses (4–8 sentences) that demonstrate analysis, cause-and-effect reasoning, or the ability to connect multiple concepts from the cards.\nRespond with ONLY a JSON array: ["Question 1?", "Question 2?", ...]`;
    } else {
      topic = document.getElementById('essay-topic').value.trim();
      if (!topic) { errEl.textContent = 'Please enter a topic.'; errEl.style.display=''; return; }
      systemPrompt = 'You are a teacher creating open-ended essay questions for high school students. Respond only with a valid JSON array of question strings.';
      userPrompt = `Generate ${qcount} thoughtful open-ended questions about: "${topic}".\nEach question should require a paragraph response (4–8 sentences) testing analysis, cause-and-effect, comparison, or evaluation.\nRespond with ONLY a JSON array: ["Question 1?", "Question 2?", ...]`;
    }

    const btn = document.getElementById('essay-gen-btn');
    btn.textContent = 'Generating…'; btn.disabled = true;

    try {
      const raw = await callAI(provider, apiKey, systemPrompt, userPrompt);
      let questions;
      try { questions = JSON.parse(raw.match(/\[[\s\S]*\]/)[0]); }
      catch { throw new Error('Could not parse questions from AI response. Try again.'); }
      renderEssaySession(app, provider, apiKey, topic, questions);
    } catch(e) {
      btn.textContent = 'Generate Questions →'; btn.disabled = false;
      errEl.textContent = 'Error: ' + e.message; errEl.style.display = '';
    }
  };
}

function renderEssaySession(app, provider, apiKey, topic, questions) {
  let idx = 0;
  const results = [];

  function renderQuestion() {
    if (idx >= questions.length) { renderEssaySummary(); return; }
    const q = questions[idx];
    app.innerHTML = `
      <div class="quiz-header">
        <div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em">🧠 AI Essay Grader — ${escHtml(topic)}</div>
          <h2>Question ${idx+1} of ${questions.length}</h2>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="navigate('essay')">✕ Exit</button>
      </div>
      <div class="essay-card">
        <div class="essay-question">${escHtml(q)}</div>
        <textarea id="essay-answer" class="essay-textarea"
          placeholder="Write a paragraph response (4–8 sentences)…" rows="6"></textarea>
        <div id="essay-wc" style="font-size:.78rem;color:var(--text-muted);text-align:right;margin-top:.3rem">0 words</div>
        <div class="form-actions" style="margin-top:1rem">
          <button class="btn btn-primary" id="essay-submit-btn" onclick="essaySubmit()">Submit Answer →</button>
        </div>
        <div id="essay-grade-area" style="display:none"></div>
      </div>`;

    const ta = document.getElementById('essay-answer');
    ta.addEventListener('input', () => {
      const words = ta.value.trim().split(/\s+/).filter(Boolean).length;
      document.getElementById('essay-wc').textContent = `${words} word${words!==1?'s':''}`;
    });

    window.essaySubmit = async function() {
      const answer = document.getElementById('essay-answer').value.trim();
      if (answer.split(/\s+/).filter(Boolean).length < 10) {
        showToast('Please write at least a few sentences before submitting.'); return;
      }
      const btn = document.getElementById('essay-submit-btn');
      btn.textContent = 'Grading…'; btn.disabled = true;
      document.getElementById('essay-answer').disabled = true;

      try {
        const raw = await callAI(provider, apiKey,
          'You are a strict but fair teacher grading student essay responses. Respond only with valid JSON.',
          `Topic: "${topic}"
Question: "${q}"
Student answer: "${answer}"

Grade this response. Respond with ONLY this JSON:
{
  "score": <1-5>,
  "grade": "<Excellent|Good|Satisfactory|Needs Improvement|Poor>",
  "feedback": "<1-2 sentence overall comment>",
  "strengths": ["<strength1>", "<strength2>"],
  "improvements": ["<improvement1>", "<improvement2>"],
  "missingDetails": "<Key facts or concepts not mentioned that would earn full credit>"
}`
        );
        let result;
        try { result = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]); }
        catch { throw new Error('Could not parse grading response.'); }

        results.push({ q, answer, result });
        const scoreColor = result.score>=4?'var(--success)':result.score>=3?'var(--warning)':'var(--danger)';
        const gradeArea = document.getElementById('essay-grade-area');
        gradeArea.style.display = '';
        gradeArea.innerHTML = `
          <div class="essay-grade-box">
            <div class="essay-score-row">
              <span class="essay-score-badge" style="background:${scoreColor}">${result.score}/5 — ${escHtml(result.grade)}</span>
            </div>
            <p class="essay-feedback-text">${escHtml(result.feedback)}</p>
            ${result.strengths?.length ? `
              <div class="essay-grade-section">
                <strong style="color:var(--success)">✓ Strengths</strong>
                <ul>${result.strengths.map(s=>`<li>${escHtml(s)}</li>`).join('')}</ul>
              </div>` : ''}
            ${result.improvements?.length ? `
              <div class="essay-grade-section">
                <strong style="color:var(--danger)">✗ Areas to Improve</strong>
                <ul>${result.improvements.map(s=>`<li>${escHtml(s)}</li>`).join('')}</ul>
              </div>` : ''}
            ${result.missingDetails ? `
              <div class="essay-grade-section">
                <strong style="color:var(--primary)">💡 Missing Details for Full Credit</strong>
                <p style="margin:.3rem 0 0">${escHtml(result.missingDetails)}</p>
              </div>` : ''}
            <button class="btn btn-primary" style="margin-top:1rem" onclick="essayNext()">
              ${idx < questions.length-1 ? 'Next Question →' : 'See Summary'}
            </button>
          </div>`;
      } catch(e) {
        btn.textContent = 'Submit Answer →'; btn.disabled = false;
        document.getElementById('essay-answer').disabled = false;
        showToast('Grading error: ' + e.message);
      }
    };

    window.essayNext = function() { idx++; renderQuestion(); };
  }

  function renderEssaySummary() {
    const total = results.reduce((s,r)=>s+r.result.score, 0);
    const max   = results.length * 5;
    const pct   = Math.round(total/max*100);
    const color = pct>=80?'var(--success)':pct>=50?'var(--warning)':'var(--danger)';

    const breakdown = results.map((r,i) => `
      <div class="essay-summary-item">
        <div style="font-size:.85rem;font-weight:700;color:var(--text-muted)">Q${i+1}</div>
        <div style="flex:1;font-size:.9rem">${escHtml(r.q)}</div>
        <span class="essay-score-badge" style="background:${r.result.score>=4?'var(--success)':r.result.score>=3?'var(--warning)':'var(--danger)'};flex-shrink:0">
          ${r.result.score}/5
        </span>
      </div>`).join('');

    app.innerHTML = `
      <div class="home-header">
        <div><h1>🧠 Essay Grader — Results</h1><p>${escHtml(topic)}</p></div>
        <button class="btn btn-ghost" onclick="navigate('essay')">New Session</button>
      </div>
      <div class="quiz-score-card" style="margin-bottom:1.5rem">
        <h2>Session Complete!</h2>
        <p>Total: ${total} / ${max} points</p>
        <div class="big-score" style="color:${color}">${pct}%</div>
      </div>
      <div class="essay-summary-list">${breakdown}</div>`;
  }

  renderQuestion();
}
