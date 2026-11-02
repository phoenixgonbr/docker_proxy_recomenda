const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { randomBytes } = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3100);
const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(__dirname, 'recomendacoes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const execFileAsync = promisify(execFile);
const IGNORED_DEPLOY_DIRS = new Set(['.git', '.local', '.aws', '.codex', '.agents', 'node_modules']);
const PROJECT_REPOSITORY = path.basename(__dirname);

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readItems() {
  try {
    const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeItems(items) {
  const temporary = `${DATA_FILE}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, DATA_FILE);
}

function validate(input = {}) {
  const item = {
    name: String(input.name || '').trim(),
    description: String(input.description || '').trim(),
    observation: String(input.observation || '').trim(),
    port: Number(input.port),
    path: String(input.path || '').trim(),
    proxyMode: input.proxyMode === 'direct' ? 'direct' : 'rewrite',
    status: input.status === 'pending' ? 'pending' : 'tested',
  };

  if (item.name.length < 2 || item.name.length > 80) throw new Error('Informe um nome entre 2 e 80 caracteres.');
  if (!Number.isInteger(item.port) || item.port < 1 || item.port > 65535) throw new Error('Informe uma porta entre 1 e 65535.');
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(item.path)) throw new Error('A rota deve começar com / e usar apenas letras, números, hífen ou _.');
  if (item.description.length > 180) throw new Error('Descrição muito longa.');
  if (item.observation.length > 1000) throw new Error('Observação muito longa.');
  return item;
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 16 * 1024) throw new Error('Dados enviados muito grandes.');
  }
  return JSON.parse(raw || '{}');
}

async function runGh(args) {
  try {
    const result = await execFileAsync('gh', args, { env: { ...process.env, GH_PAGER: 'cat' }, maxBuffer: 1024 * 1024 });
    return result.stdout.trim();
  } catch (error) {
    const detail = String(error.stderr || error.stdout || '').trim();
    if (/not logged in|token.*invalid|authentication|authenticate|auth login/i.test(detail)) {
      throw new Error('A sessão do GitHub CLI está inválida. Execute `gh auth login` e tente novamente.');
    }
    throw new Error(detail || 'O GitHub CLI não conseguiu concluir a operação.');
  }
}

async function projectFiles(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DEPLOY_DIRS.has(entry.name)) continue;
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await projectFiles(absolute, relative));
    else if (entry.isFile()) files.push({ relative, absolute });
  }
  return files;
}

async function getProjectChanges() {
  const files = await projectFiles(__dirname);
  const status = new Map();
  try {
    const output = await runCommand('git', ['status', '--short', '--untracked-files=all']);
    for (const line of output.split('\n').filter(Boolean)) {
      const rawCode = line.slice(0, 2).trim() || 'U';
      const code = rawCode === '??' ? 'U' : rawCode;
      const file = line.slice(3).replace(/^"|"$/g, '');
      status.set(file, code);
    }
  } catch { /* Projetos sem histórico Git tratam os arquivos como novos. */ }
  return files.map(file => ({
    path: file.relative,
    status: status.get(file.relative) || 'U',
    label: status.has(file.relative) ? 'modificado' : 'novo'
  }));
}

async function runCommand(command, args) {
  const result = await execFileAsync(command, args, { cwd: __dirname, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

async function publishProjectToGitHub(input = {}) {
  const owner = await runGh(['api', 'user', '--jq', '.login']);
  const repository = PROJECT_REPOSITORY;
  const branch = String(input.branch || 'main').trim() || 'main';
  const message = String(input.message || 'Atualiza projeto pelo DockProxy').trim();

  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('Informe uma branch válida.');
  if (message.length < 3 || message.length > 120) throw new Error('A mensagem deve ter entre 3 e 120 caracteres.');

  const repo = `${owner}/${repository}`;
  const logs = [`$ gh api repos/${repo}`, '✓ Repositório acessível.'];
  await runGh(['api', `repos/${repo}`, '--jq', '.full_name']);
  const files = await projectFiles(__dirname);
  logs.push(`$ preparando ${files.length} arquivos da pasta do projeto`);
  let lastCommit = null;
  for (const file of files) {
    const content = await fs.readFile(file.absolute);
    let sha = null;
    try {
      sha = await runGh(['api', `repos/${repo}/contents/${file.relative}?ref=${branch}`, '--jq', '.sha']);
    } catch (error) {
      if (!/HTTP 404|Not Found|404/i.test(error.message)) throw error;
    }
    const args = ['api', `repos/${repo}/contents/${file.relative}`, '--method', 'PUT', '--field', `message=${message}`, '--field', `content=${content.toString('base64')}`, '--field', `branch=${branch}`, '--jq', '{commit: .commit.html_url}'];
    if (sha) args.push('--field', `sha=${sha}`);
    const result = JSON.parse(await runGh(args));
    lastCommit = result.commit || lastCommit;
    logs.push(`✓ ${sha ? 'atualizado' : 'enviado'} ${file.relative}`);
  }
  logs.push('✓ Deploy concluído com sucesso.');
  return { commit: lastCommit, repository: `https://github.com/${owner}/${repository}`, branch, files: files.length, logs };
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/recommendations') {
    return sendJson(res, 200, { recommendations: await readItems() });
  }

  if (req.method === 'GET' && url.pathname === '/api/github/changes') {
    return sendJson(res, 200, { files: await getProjectChanges(), repository: PROJECT_REPOSITORY });
  }

  if (req.method === 'POST' && url.pathname === '/api/recommendations') {
    const item = {
      id: randomBytes(8).toString('hex'),
      ...validate(await readBody(req)),
      createdAt: new Date().toISOString()
    };
    const items = await readItems();
    await writeItems([item, ...items]);
    return sendJson(res, 201, { message: 'Recomendação salva no painel.', recommendation: item });
  }

  const match = url.pathname.match(/^\/api\/recommendations\/([a-f0-9]+)$/);
  if (req.method === 'PUT' && match) {
    const items = await readItems();
    const index = items.findIndex(item => item.id === match[1]);
    if (index === -1) return sendJson(res, 404, { error: 'Recomendação não encontrada.' });
    const observation = String((await readBody(req)).observation || '').trim();
    if (observation.length > 1000) return sendJson(res, 400, { error: 'Observação muito longa.' });
    items[index] = { ...items[index], observation };
    await writeItems(items);
    return sendJson(res, 200, { message: 'Observação salva.', recommendation: items[index] });
  }

  if (req.method === 'POST' && url.pathname === '/api/github/publish') {
    const result = await publishProjectToGitHub(await readBody(req));
    return sendJson(res, 200, { message: 'Projeto publicado no GitHub.', ...result });
  }

  if (req.method === 'DELETE' && match) {
    const items = await readItems();
    const updated = items.filter(item => item.id !== match[1]);
    if (updated.length === items.length) return sendJson(res, 404, { error: 'Recomendação não encontrada.' });
    await writeItems(updated);
    return sendJson(res, 200, { message: 'Recomendação removida.' });
  }

  sendJson(res, 404, { error: 'Endpoint não encontrado.' });
}

async function staticFile(req, res, url) {
  const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(PUBLIC_DIR, requested);
  if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`)) return sendJson(res, 403, { error: 'Acesso negado.' });
  try {
    const data = await fs.readFile(file);
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(data);
  } catch (error) {
    sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: 'Arquivo não encontrado.' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método não permitido.' });
    await staticFile(req, res, url);
  } catch (error) {
    sendJson(res, error instanceof SyntaxError ? 400 : 500, { error: error.message || 'Erro interno.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Editor de recomendações em http://${HOST}:${PORT}`);
  console.log(`Arquivo gerado: ${DATA_FILE}`);
});
