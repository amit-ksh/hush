// "API key" section, rendered into the consent screen and the pause screen.
// The raw key only lives in the password input until it is submitted, then the input is cleared.
const api = () => window.hushKeys;
let status = { source: 'none', hint: '', text: 'No key: simulation only', encryptionAvailable: false };
const listeners = [];
const boxes = [];

export const keyStatus = () => status;
export function onKeyChange(fn) { listeners.push(fn); }

export async function refreshKeyStatus() {
  try { status = await api().getKeyStatus(); } catch { /* keep previous */ }
  for (const b of boxes) paint(b);
  for (const fn of listeners) fn(status);
  return status;
}

const SRC = { session: 'session', saved: 'saved', env: '.env' };
function chipText() { return status.source === 'none' ? 'No key' : 'Key set'; }

function paint(b) {
  for (const c of document.querySelectorAll('.keychip')) c.textContent = chipText();
  b.status.textContent = status.text + (status.hint ? `  (${status.hint})` : '');
  b.clear.disabled = !(status.hasSaved || status.source === 'session');
  b.remember.disabled = !status.encryptionAvailable;
  b.note.textContent = status.encryptionAvailable ? '' : 'Secure storage is unavailable on this system: a key can only be used for this session.';
}

export function mountKeySection(container) {
  container.innerHTML = `
    <div class="keybox">
      <div class="keyrow"><input type="password" class="keyinput" placeholder="Presage API key" autocomplete="off" spellcheck="false">
        <button type="button" class="showkey">Show</button></div>
      <div class="keyopts">
        <label><input type="checkbox" class="remember"> Remember (encrypted)</label>
        <a href="#" class="getkey">Get a key</a>
        <button type="button" class="clearkey link">Clear saved key</button>
      </div>
      <div class="keystatus"></div><div class="keymsg"></div><div class="keynote"></div>
    </div>`;
  const q = (c) => container.querySelector(c);
  const b = { input: q('.keyinput'), status: q('.keystatus'), msg: q('.keymsg'), note: q('.keynote'), clear: q('.clearkey'), remember: q('.remember') };
  boxes.push(b);
  q('.getkey').onclick = (e) => { e.preventDefault(); api().openRegister(); };
  q('.showkey').onclick = (e) => { const show = b.input.type === 'password'; b.input.type = show ? 'text' : 'password'; e.target.textContent = show ? 'Hide' : 'Show'; };
  // No "Use" button: the key is applied on paste, Enter or when the field loses focus.
  let applying = false;
  const apply = async () => {
    const v = b.input.value.trim();
    if (!v || applying) return;
    applying = true;
    try { await submit(v); } finally { applying = false; }
  };
  b.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  b.input.addEventListener('paste', () => setTimeout(apply, 0));
  b.input.addEventListener('change', apply);
  const submit = async (v) => {
    const r = await api().setKey(v, b.remember.checked);
    b.input.value = ''; b.input.type = 'password'; q('.showkey').textContent = 'Show';
    b.msg.textContent = r.ok ? (r.message || 'Key set for this session.') : r.message;
    await refreshKeyStatus();
  };
  q('.clearkey').onclick = async () => { const r = await api().clearKey(); b.msg.textContent = r.message; await refreshKeyStatus(); };
  paint(b);
  return b;
}
