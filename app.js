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
    case 'home':    renderHome(app);             break;
    case 'public':  renderPublicSets(app);       break;
    case 'create':  renderCreate(app, null);     break;
    case 'edit':    renderCreate(app, param);    break;
    case 'study':   renderStudy(app, param);        break;
    case 'quiz':    renderQuiz(app, param);         break;
    case 'written': renderWrittenQuiz(app, param);  break;
    case 'shared':  renderShared(app, param);       break;
    default:        renderHome(app);
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
        <h2>Firebase not configured</h2>
        <p>Add your Firebase project config to <code>app.js</code> to enable community sets.</p>
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
