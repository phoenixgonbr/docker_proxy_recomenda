const form = document.getElementById('recommendation-form');
const list = document.getElementById('list');
const empty = document.getElementById('empty');
const count = document.getElementById('count');
const search = document.getElementById('search');
const message = document.getElementById('form-message');
const githubForm = document.getElementById('github-form');
const githubStatus = document.getElementById('github-message-status');
const githubResult = document.getElementById('github-result');
const githubTerminal = document.getElementById('github-terminal');
const githubFiles = document.getElementById('github-files');
let items = [];

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function render() {
  const query = search.value.trim().toLowerCase();
  const visible = items.filter(item => `${item.name} ${item.description} ${item.path}`.toLowerCase().includes(query));
  count.textContent = String(items.length);
  list.replaceChildren();
  visible.forEach(item => {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `<div class="card-top"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description || 'Aplicação recomendada')}</p></div><span class="tag ${item.status === 'tested' ? 'good' : 'warn'}">${item.status === 'tested' ? 'Testado' : 'A testar'}</span></div><div class="meta"><span class="tag">Porta ${item.port}</span><span class="tag">${escapeHtml(item.path)}/</span><span class="tag">${item.proxyMode === 'direct' ? 'Sem reescrita' : 'Com reescrita'}</span></div><label class="observation-label">Observação<textarea class="observation" maxlength="1000" rows="3" placeholder="Adicione uma observação...">${escapeHtml(item.observation || '')}</textarea></label><button class="secondary save-observation" type="button">Salvar observação</button><p class="card-message message" role="status"></p>`;
    const observation = card.querySelector('.observation');
    const saveButton = card.querySelector('.save-observation');
    const cardMessage = card.querySelector('.card-message');
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      cardMessage.className = 'card-message message';
      cardMessage.textContent = 'Salvando...';
      try {
        const response = await fetch(`/api/recommendations/${item.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ observation: observation.value }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Não foi possível salvar.');
        item.observation = data.recommendation.observation;
        cardMessage.className = 'card-message message ok';
        cardMessage.textContent = data.message;
      } catch (error) {
        cardMessage.className = 'card-message message error';
        cardMessage.textContent = error.message;
      } finally { saveButton.disabled = false; }
    });
    list.appendChild(card);
  });
  empty.hidden = visible.length > 0;
}

async function load() {
  const response = await fetch('/api/recommendations', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível carregar as recomendações.');
  items = data.recommendations;
  render();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  message.className = 'message';
  message.textContent = 'Salvando...';
  const body = Object.fromEntries(new FormData(form));
  body.port = Number(body.port);
  try {
    const response = await fetch('/api/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível salvar.');
    items.unshift(data.recommendation);
    form.reset();
    message.className = 'message ok';
    message.textContent = data.message;
    render();
  } catch (error) {
    message.className = 'message error';
    message.textContent = error.message;
  }
});

search.addEventListener('input', render);
document.getElementById('refresh').addEventListener('click', () => load().catch(error => {
  message.className = 'message error';
  message.textContent = error.message;
}));
load().catch(error => { message.className = 'message error'; message.textContent = error.message; });

async function loadGithubFiles() {
  const response = await fetch('/api/github/changes', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível listar os arquivos.');
  githubFiles.replaceChildren();
  data.files.forEach(file => {
    const row = document.createElement('div');
    row.className = 'github-file';
    row.innerHTML = `<span class="file-status">${escapeHtml(file.status)}</span><code>${escapeHtml(file.path)}</code><span class="file-label">${escapeHtml(file.label)}</span>`;
    githubFiles.appendChild(row);
  });
}

loadGithubFiles().catch(error => { githubFiles.innerHTML = `<p class="files-error">${escapeHtml(error.message)}</p>`; });

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab, .tab-panel').forEach(element => element.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
  if (tab.dataset.tab === 'github') loadGithubFiles().catch(error => { githubFiles.innerHTML = `<p class="files-error">${escapeHtml(error.message)}</p>`; });
}));

document.getElementById('refresh-files').addEventListener('click', () => loadGithubFiles().catch(error => { githubFiles.innerHTML = `<p class="files-error">${escapeHtml(error.message)}</p>`; }));

githubForm.addEventListener('submit', async event => {
  event.preventDefault();
  githubStatus.className = 'message';
  githubStatus.textContent = 'Publicando...';
  githubResult.hidden = true;
  githubTerminal.textContent = '$ iniciando deploy pelo GitHub CLI...';
  const submit = githubForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const response = await fetch('/api/github/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(githubForm))) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível publicar no GitHub.');
    githubStatus.className = 'message ok';
    githubStatus.textContent = data.message;
    githubTerminal.textContent = data.logs.join('\n');
    githubResult.hidden = false;
    githubResult.innerHTML = `Branch <strong>${escapeHtml(data.branch)}</strong> atualizada em <a href="${escapeHtml(data.repository)}" target="_blank" rel="noreferrer">${escapeHtml(data.repository)}</a>${data.commit ? ` · <a href="${escapeHtml(data.commit)}" target="_blank" rel="noreferrer">ver commit</a>` : ''}.`;
  } catch (error) {
    githubStatus.className = 'message error';
    githubStatus.textContent = error.message;
    githubTerminal.textContent += `\n✗ ${error.message}`;
  } finally { submit.disabled = false; }
});
