// =====================================================================
// FluxoCaixa · controle pessoal de receitas, despesas e empréstimos
// Chave publicável: pode ficar no código. A proteção dos dados vem do
// login obrigatório + RLS (cada registro só é visível ao próprio usuário).
// =====================================================================
const SUPABASE_URL = 'https://egozlthyhwijtzssbogh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZSivqasHctyPiJGX6qGO-A_pDA3xcpR';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (v) => brlFmt.format(Number(v) || 0);
const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtData(s) {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
function diasNoMes(y, m) { return new Date(y, m, 0).getDate(); } // m = 1..12
function somaMeses(dataStr, k) {
  const [y, m, d] = dataStr.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + k;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, diasNoMes(ny, nm)))}`;
}
function intervaloMes(ym) {
  const inicio = `${ym}-01`;
  return { inicio, fim: somaMeses(inicio, 1) }; // fim exclusivo
}
const nomeMes = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${nomes[m - 1]}/${String(y).slice(2)}`;
};

function toast(texto, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + tipo;
  t.textContent = texto;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
function falha(e) {
  console.error(e);
  toast('Erro: ' + (e?.message || 'operação não concluída'), 'error');
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
function opcoes(lista, valorSel, vazio) {
  let html = vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : '';
  for (const o of lista) html += `<option value="${o.id}" ${o.id === valorSel ? 'selected' : ''}>${esc(o.nome)}</option>`;
  return html;
}

// ---------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------
const PALETA = ['#dc2626', '#ea580c', '#d97706', '#65a30d', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#475569'];
const st = { user: null, categorias: [], contas: [], imoveis: [], view: 'painel' };
const mesRef = () => $('mesRef').value;

async function carregarCadastros() {
  const [cats, contas, imoveis] = await Promise.all([
    q(sb.from('categorias').select('*').order('tipo').order('nome')),
    q(sb.from('contas').select('*').order('nome')),
    q(sb.from('imoveis').select('*').order('codigo')),
  ]);
  st.categorias = cats; st.contas = contas; st.imoveis = imoveis;
}
const catPorNome = (nome, tipo) => st.categorias.find((c) => c.nome === nome && c.tipo === tipo);
const contaPadrao = () => st.contas.find((c) => c.ativo) || null;

// =====================================================================
// AUTENTICAÇÃO
// =====================================================================
let authMode = 'login';
const authTextos = {
  login:   { sub: 'Entre para acessar seu controle financeiro.', btn: 'Entrar' },
  signup:  { sub: 'Crie seu acesso. Use uma senha com pelo menos 8 caracteres.', btn: 'Criar acesso' },
  reset:   { sub: 'Informe seu e-mail para receber o link de nova senha.', btn: 'Enviar link' },
  newpass: { sub: 'Defina sua nova senha.', btn: 'Salvar nova senha' },
};
function authMsg(texto, tipo) { const m = $('authMsg'); m.textContent = texto; m.className = 'msg ' + (tipo || ''); }
function setAuthMode(modo) {
  authMode = modo;
  authMsg('');
  $('loginSubtitle').textContent = authTextos[modo].sub;
  $('authBtn').textContent = authTextos[modo].btn;
  $('emailGroup').classList.toggle('hidden', modo === 'newpass');
  $('passwordGroup').classList.toggle('hidden', modo === 'reset');
  $('password').autocomplete = modo === 'login' ? 'current-password' : 'new-password';
  $('toggleSignup').textContent = modo === 'login' ? 'Primeiro acesso' : 'Voltar ao login';
  $('toggleReset').classList.toggle('hidden', modo !== 'login');
}
function traduzErro(e) {
  const m = (e?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail pelo link enviado antes de entrar.';
  if (m.includes('already registered')) return 'Este e-mail já tem acesso. Use "Esqueci a senha" se precisar.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'Novos cadastros estão desativados.';
  if (m.includes('password')) return 'Senha inválida. Use pelo menos 8 caracteres.';
  if (m.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos.';
  return 'Erro: ' + (e?.message || 'tente novamente.');
}

$('toggleSignup').onclick = () => setAuthMode(authMode === 'login' ? 'signup' : 'login');
$('toggleReset').onclick = () => setAuthMode('reset');

$('authForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  authMsg('');
  const email = $('email').value.trim();
  const password = $('password').value;
  if (authMode !== 'newpass' && !email) return authMsg('Informe o e-mail.', 'error');
  if (authMode !== 'reset' && password.length < 8) return authMsg('A senha precisa ter pelo menos 8 caracteres.', 'error');
  const btn = $('authBtn');
  btn.disabled = true;
  const redirect = window.location.origin + window.location.pathname;
  try {
    if (authMode === 'login') {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await entrar(data.user);
    } else if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
      if (error) throw error;
      if (data.session) await entrar(data.user);
      else authMsg('Acesso criado. Confirme pelo link enviado ao seu e-mail e depois entre.', 'ok');
    } else if (authMode === 'reset') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
      if (error) throw error;
      authMsg('Se o e-mail estiver cadastrado, você receberá o link em instantes.', 'ok');
    } else if (authMode === 'newpass') {
      const { data, error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      toast('Senha alterada com sucesso.');
      await entrar(data.user);
    }
  } catch (e) {
    authMsg(traduzErro(e), 'error');
  } finally {
    btn.disabled = false;
  }
});

$('logoutBtn').onclick = async () => { await sb.auth.signOut(); sair(); };

function sair() {
  st.user = null;
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  setAuthMode('login');
}

async function entrar(user) {
  st.user = user;
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('userEmail').textContent = user.email;
  if (!$('mesRef').value) $('mesRef').value = hoje().slice(0, 7);
  try {
    await carregarCadastros();
    preencherSelects();
    await render();
  } catch (e) { falha(e); }
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    $('appView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    setAuthMode('newpass');
  }
});

(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session && authMode !== 'newpass') await entrar(data.session.user);
  else if (authMode !== 'newpass') sair();
})();

// =====================================================================
// NAVEGAÇÃO
// =====================================================================
$('nav').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-view]');
  if (!b) return;
  st.view = b.dataset.view;
  document.querySelectorAll('#nav button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('section.view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + st.view));
  render().catch(falha);
});
$('mesRef').addEventListener('change', () => render().catch(falha));

async function render() {
  if (!st.user || !mesRef()) return;
  if (st.view === 'painel') return renderPainel();
  if (st.view === 'lancamentos') return renderLancamentos();
  if (st.view === 'imoveis') return renderImoveis();
  if (st.view === 'emprestimos') return renderEmprestimos();
  if (st.view === 'cadastros') return renderCadastros();
}

// =====================================================================
// PAINEL
// =====================================================================
async function renderPainel() {
  const ym = mesRef();
  const { inicio, fim } = intervaloMes(ym);
  const inicio6 = somaMeses(inicio, -5);
  const em30 = somaMeses(hoje(), 1);

  const [lancMes, hist, parcelasMes, parcelasAbertas, vencimentos] = await Promise.all([
    q(sb.from('lancamentos').select('*, categorias(nome)').gte('data', inicio).lt('data', fim)),
    q(sb.from('lancamentos').select('data, tipo, valor').eq('situacao', 'realizado').gte('data', inicio6).lt('data', fim)),
    q(sb.from('parcelas_emprestimo').select('valor, pago').gte('vencimento', inicio).lt('vencimento', fim)),
    q(sb.from('parcelas_emprestimo').select('amortizacao, emprestimos!inner(ativo)').eq('pago', false).eq('emprestimos.ativo', true)),
    q(sb.from('parcelas_emprestimo').select('*, emprestimos!inner(credor, ativo)').eq('pago', false)
      .eq('emprestimos.ativo', true).lte('vencimento', em30).order('vencimento').limit(15)),
  ]);

  const soma = (lista, f) => lista.filter(f).reduce((s, x) => s + num(x.valor), 0);
  const recReal = soma(lancMes, (l) => l.tipo === 'receita' && l.situacao === 'realizado');
  const recPrev = soma(lancMes, (l) => l.tipo === 'receita' && l.situacao === 'previsto');
  const despReal = soma(lancMes, (l) => l.tipo === 'despesa' && l.situacao === 'realizado');
  const despPrev = soma(lancMes, (l) => l.tipo === 'despesa' && l.situacao === 'previsto');
  const parcMesTotal = parcelasMes.reduce((s, p) => s + num(p.valor), 0);
  const parcMesAberto = parcelasMes.filter((p) => !p.pago).reduce((s, p) => s + num(p.valor), 0);
  const saldoDevedor = parcelasAbertas.reduce((s, p) => s + num(p.amortizacao), 0);
  const resultado = recReal - despReal;
  const projetado = resultado + recPrev - despPrev - parcMesAberto;

  $('kpis').innerHTML = `
    <div class="kpi k-receita"><span class="ico">💰</span><div class="label">Receitas realizadas</div><div class="value receita">${brl(recReal)}</div>
      <div class="sub">+ ${brl(recPrev)} previstas</div></div>
    <div class="kpi k-despesa"><span class="ico">💸</span><div class="label">Despesas realizadas</div><div class="value despesa">${brl(despReal)}</div>
      <div class="sub">+ ${brl(despPrev)} previstas</div></div>
    <div class="kpi k-resultado"><span class="ico">📊</span><div class="label">Resultado do mês</div><div class="value ${resultado >= 0 ? 'receita' : 'despesa'}">${brl(resultado)}</div>
      <div class="sub">Somente realizado</div></div>
    <div class="kpi k-projetado"><span class="ico">🔮</span><div class="label">Resultado projetado</div><div class="value ${projetado >= 0 ? 'receita' : 'despesa'}">${brl(projetado)}</div>
      <div class="sub">Inclui previstos e parcelas em aberto</div></div>
    <div class="kpi k-parcela"><span class="ico">📅</span><div class="label">Parcelas do mês</div><div class="value">${brl(parcMesTotal)}</div>
      <div class="sub ${parcMesAberto > 0 ? 'alerta' : ''}">${brl(parcMesAberto)} em aberto</div></div>
    <div class="kpi k-divida"><span class="ico">🏦</span><div class="label">Saldo devedor total</div><div class="value">${brl(saldoDevedor)}</div>
      <div class="sub">Principal a amortizar</div></div>`;

  // Aluguéis por imóvel
  const ativos = st.imoveis.filter((i) => i.ativo);
  if (!ativos.length) {
    $('painelImoveis').innerHTML = '<div class="empty">Nenhum imóvel cadastrado. Cadastre na aba Imóveis.</div>';
  } else {
    let tb = 0, tt = 0;
    const linhas = ativos.map((im) => {
      const recs = lancMes.filter((l) => l.imovel_id === im.id && l.tipo === 'receita');
      const desp = lancMes.filter((l) => l.imovel_id === im.id && l.tipo === 'despesa');
      const bruto = recs.reduce((s, l) => s + num(l.valor), 0);
      const custos = desp.reduce((s, l) => s + num(l.valor), 0);
      const pendente = recs.some((l) => l.situacao === 'previsto');
      tb += bruto; tt += custos;
      const sit = !recs.length ? '<span class="tag inativo">Não lançado</span>'
        : pendente ? '<span class="tag previsto">A receber</span>' : '<span class="tag realizado">Recebido</span>';
      return `<tr><td><strong style="color:var(--primary)">${im.codigo}</strong> · ${esc(im.nome)}</td><td class="num">${brl(bruto)}</td><td class="num despesa">${brl(custos)}</td>
        <td class="num">${brl(bruto - custos)}</td><td>${sit}</td></tr>`;
    }).join('');
    $('painelImoveis').innerHTML = `<table><thead><tr><th>Imóvel</th><th class="num">Bruto</th><th class="num">Custos</th>
      <th class="num">Líquido</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${brl(tb)}</td><td class="num despesa">${brl(tt)}</td><td class="num">${brl(tb - tt)}</td><td></td></tr></tfoot></table>`;
  }

  // Vencimentos
  $('painelVencimentos').innerHTML = !vencimentos.length
    ? '<div class="empty">Nenhuma parcela em aberto nos próximos 30 dias.</div>'
    : `<table><thead><tr><th>Vencimento</th><th>Credor</th><th>Parcela</th><th class="num">Valor</th></tr></thead><tbody>
      ${vencimentos.map((p) => `<tr class="${p.vencimento < hoje() ? 'row-atrasada' : ''}"><td class="${p.vencimento < hoje() ? 'despesa' : ''}">${fmtData(p.vencimento)}${p.vencimento < hoje() ? ' (atrasada)' : ''}</td>
        <td>${esc(p.emprestimos.credor)}</td><td>${p.numero}</td><td class="num">${brl(p.valor)}</td></tr>`).join('')}
      </tbody></table>`;

  // Despesas por categoria (realizado + previsto)
  const porCat = {};
  lancMes.filter((l) => l.tipo === 'despesa').forEach((l) => {
    const n = l.categorias?.nome || 'Sem categoria';
    porCat[n] = (porCat[n] || 0) + num(l.valor);
  });
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0][1] : 1;
  const totCat = cats.reduce((s, c) => s + c[1], 0);
  $('painelCategorias').innerHTML = !cats.length ? '<div class="empty">Nenhuma despesa no mês.</div>'
    : cats.map(([n, v], i) => { const cor = PALETA[i % PALETA.length]; const pct = totCat ? Math.round(v / totCat * 100) : 0;
        return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between">
        <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${cor};margin-right:6px"></i>${esc(n)}</span>
        <span><strong>${brl(v)}</strong> <span style="color:var(--muted);font-size:12px">${pct}%</span></span></div>
        <div class="bar"><div style="width:${(v / maxCat) * 100}%;background:${cor}"></div></div></div>`; }).join('');

  // Histórico 6 meses
  const meses = [];
  for (let k = 5; k >= 0; k--) meses.push(somaMeses(inicio, -k).slice(0, 7));
  const dadosHist = meses.map((m) => {
    const doMes = hist.filter((l) => l.data.startsWith(m));
    return { m, r: doMes.filter((l) => l.tipo === 'receita').reduce((s, l) => s + num(l.valor), 0),
      d: doMes.filter((l) => l.tipo === 'despesa').reduce((s, l) => s + num(l.valor), 0) };
  });
  const maxHist = Math.max(1, ...dadosHist.map((x) => Math.max(x.r, x.d)));
  const linhasHist = meses.map((m) => {
    const doMes = hist.filter((l) => l.data.startsWith(m));
    const r = doMes.filter((l) => l.tipo === 'receita').reduce((s, l) => s + num(l.valor), 0);
    const d = doMes.filter((l) => l.tipo === 'despesa').reduce((s, l) => s + num(l.valor), 0);
    return `<tr><td>${nomeMes(m)}</td><td class="hide-mobile"><div class="hist-bars"><div class="r" style="width:${r / maxHist * 100}%"></div><div class="d" style="width:${d / maxHist * 100}%"></div></div></td><td class="num receita">${brl(r)}</td><td class="num despesa">${brl(d)}</td>
      <td class="num ${r - d >= 0 ? 'receita' : 'despesa'}">${brl(r - d)}</td></tr>`;
  }).join('');
  $('painelHistorico').innerHTML = `<div class="legenda"><span><i style="background:var(--c-receita)"></i>Receitas</span><span><i style="background:var(--c-despesa)"></i>Despesas</span></div><table><thead><tr><th>Mês</th><th class="hide-mobile"></th><th class="num">Receitas</th><th class="num">Despesas</th>
    <th class="num">Resultado</th></tr></thead><tbody>${linhasHist}</tbody></table>`;
}

// Gera receitas (aluguel bruto) e despesas (taxa de administração) previstas do mês
$('btnLancarAlugueis').onclick = async () => {
  const ym = mesRef();
  const { inicio, fim } = intervaloMes(ym);
  const ativos = st.imoveis.filter((i) => i.ativo && num(i.valor_aluguel) > 0);
  if (!ativos.length) return toast('Cadastre imóveis com valor de aluguel primeiro.', 'error');
  try {
    const existentes = await q(sb.from('lancamentos').select('imovel_id').eq('tipo', 'receita')
      .not('imovel_id', 'is', null).gte('data', inicio).lt('data', fim));
    const jaLancados = new Set(existentes.map((e) => e.imovel_id));
    const catAluguel = catPorNome('Aluguel', 'receita');
    const catTaxa = catPorNome('Taxa de administração imobiliária', 'despesa');
    const conta = contaPadrao();
    const novos = [];
    const [y, m] = ym.split('-').map(Number);
    for (const im of ativos) {
      if (jaLancados.has(im.id)) continue;
      const dia = Math.min(im.dia_vencimento || 10, diasNoMes(y, m));
      const data = `${ym}-${pad(dia)}`;
      novos.push({ data, tipo: 'receita', valor: num(im.valor_aluguel), situacao: 'previsto', descricao: `Aluguel ${im.nome}`,
        categoria_id: catAluguel?.id || null, conta_id: conta?.id || null, imovel_id: im.id });
      const taxa = round2(num(im.valor_aluguel) * num(im.taxa_administracao_pct) / 100);
      if (taxa > 0) novos.push({ data, tipo: 'despesa', valor: taxa, situacao: 'previsto', descricao: `Taxa de administração ${im.nome}`,
        categoria_id: catTaxa?.id || null, conta_id: conta?.id || null, imovel_id: im.id });
    }
    if (!novos.length) return toast('Os aluguéis deste mês já foram lançados.');
    await q(sb.from('lancamentos').insert(novos));
    toast(`${novos.length} lançamento(s) previsto(s) criado(s).`);
    await render();
  } catch (e) { falha(e); }
};

// =====================================================================
// LANÇAMENTOS
// =====================================================================
function preencherSelects() {
  const tipo = $('lancTipo').value;
  const selCat = $('lancCategoria').value;
  $('lancCategoria').innerHTML = opcoes(st.categorias.filter((c) => c.tipo === tipo && c.ativo), selCat, 'Sem categoria');
  const selConta = $('lancConta').value;
  $('lancConta').innerHTML = opcoes(st.contas.filter((c) => c.ativo), selConta || contaPadrao()?.id, 'Sem conta');
  const selIm = $('lancImovel').value;
  $('lancImovel').innerHTML = opcoes(st.imoveis.map((i) => ({ id: i.id, nome: `${i.codigo} · ${i.nome}` })), selIm, 'Nenhum');
}
$('lancTipo').addEventListener('change', preencherSelects);

function limparLancForm() {
  $('lancForm').reset();
  $('lancId').value = '';
  $('lancData').value = hoje().slice(0, 7) === mesRef() ? hoje() : `${mesRef()}-01`;
  $('lancFormTitulo').textContent = 'Novo lançamento';
  $('lancCancelar').classList.add('hidden');
  preencherSelects();
}
$('lancCancelar').onclick = limparLancForm;

$('lancForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const reg = {
    data: $('lancData').value,
    tipo: $('lancTipo').value,
    descricao: $('lancDescricao').value.trim(),
    valor: round2(num($('lancValor').value)),
    situacao: $('lancSituacao').value,
    categoria_id: $('lancCategoria').value || null,
    conta_id: $('lancConta').value || null,
    imovel_id: $('lancImovel').value || null,
    observacao: $('lancObs').value.trim() || null,
  };
  if (!reg.data || !reg.descricao || reg.valor <= 0) return toast('Preencha data, descrição e valor.', 'error');
  try {
    const id = $('lancId').value;
    if (id) await q(sb.from('lancamentos').update(reg).eq('id', id));
    else await q(sb.from('lancamentos').insert(reg));
    toast('Lançamento salvo.');
    if (reg.data.slice(0, 7) !== mesRef()) { $('mesRef').value = reg.data.slice(0, 7); }
    limparLancForm();
    await renderLancamentos();
  } catch (e) { falha(e); }
});
$('lancFiltro').addEventListener('change', () => renderLancamentos().catch(falha));

let lancCache = [];
async function renderLancamentos() {
  if (!$('lancId').value && !$('lancData').value) limparLancForm();
  const { inicio, fim } = intervaloMes(mesRef());
  lancCache = await q(sb.from('lancamentos').select('*, categorias(nome), contas(nome), imoveis(nome)')
    .gte('data', inicio).lt('data', fim).order('data').order('created_at'));
  const f = $('lancFiltro').value;
  const lista = lancCache.filter((l) => !f || l.tipo === f || l.situacao === f);
  if (!lista.length) { $('lancLista').innerHTML = '<div class="empty">Nenhum lançamento neste mês.</div>'; return; }
  let tr = 0, td = 0;
  const linhas = lista.map((l) => {
    if (l.tipo === 'receita') tr += num(l.valor); else td += num(l.valor);
    return `<tr class="row-${l.tipo}">
      <td>${fmtData(l.data)}</td>
      <td>${esc(l.descricao)}${l.observacao ? `<div class="sub" style="color:var(--muted);font-size:12px">${esc(l.observacao)}</div>` : ''}</td>
      <td class="hide-mobile">${esc(l.categorias?.nome || '')}</td>
      <td class="hide-mobile">${esc(l.imoveis?.nome || '')}</td>
      <td><span class="tag ${l.situacao}">${l.situacao === 'previsto' ? 'Previsto' : 'Realizado'}</span></td>
      <td class="num ${l.tipo}">${l.tipo === 'despesa' ? '-' : ''}${brl(l.valor)}</td>
      <td class="actions">
        ${l.situacao === 'previsto' ? `<button class="small" data-acao="realizar" data-id="${l.id}">Confirmar</button>` : ''}
        <button class="small" data-acao="editar" data-id="${l.id}">Editar</button>
        <button class="small danger" data-acao="excluir" data-id="${l.id}">Excluir</button>
      </td></tr>`;
  }).join('');
  $('lancLista').innerHTML = `<table><thead><tr><th>Data</th><th>Descrição</th><th class="hide-mobile">Categoria</th>
    <th class="hide-mobile">Imóvel</th><th>Situação</th><th class="num">Valor</th><th></th></tr></thead><tbody>${linhas}</tbody>
    <tfoot><tr><td colspan="5">Receitas ${brl(tr)} · Despesas ${brl(td)}</td><td class="num ${tr - td >= 0 ? 'receita' : 'despesa'}">${brl(tr - td)}</td><td></td></tr></tfoot></table>`;
}

$('lancLista').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-acao]');
  if (!b) return;
  const l = lancCache.find((x) => x.id === b.dataset.id);
  if (!l) return;
  try {
    if (b.dataset.acao === 'realizar') {
      await q(sb.from('lancamentos').update({ situacao: 'realizado' }).eq('id', l.id));
      toast('Lançamento confirmado.');
      await renderLancamentos();
    } else if (b.dataset.acao === 'excluir') {
      if (l.parcela_id) return toast('Este lançamento é o pagamento de uma parcela. Desfaça pela aba Empréstimos.', 'error');
      if (!confirm(`Excluir "${l.descricao}"?`)) return;
      await q(sb.from('lancamentos').delete().eq('id', l.id));
      toast('Lançamento excluído.');
      await renderLancamentos();
    } else if (b.dataset.acao === 'editar') {
      $('lancId').value = l.id;
      $('lancData').value = l.data;
      $('lancTipo').value = l.tipo;
      preencherSelects();
      $('lancDescricao').value = l.descricao;
      $('lancValor').value = l.valor;
      $('lancSituacao').value = l.situacao;
      $('lancCategoria').value = l.categoria_id || '';
      $('lancConta').value = l.conta_id || '';
      $('lancImovel').value = l.imovel_id || '';
      $('lancObs').value = l.observacao || '';
      $('lancFormTitulo').textContent = 'Editar lançamento';
      $('lancCancelar').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch (e) { falha(e); }
});

// =====================================================================
// IMÓVEIS
// =====================================================================
function limparImovForm() {
  $('imovForm').reset();
  $('imovId').value = '';
  $('imovFormTitulo').textContent = 'Novo imóvel';
  $('imovCancelar').classList.add('hidden');
}
$('imovCancelar').onclick = limparImovForm;

$('imovForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const reg = {
    nome: $('imovNome').value.trim(),
    endereco: $('imovEndereco').value.trim() || null,
    inquilino: $('imovInquilino').value.trim() || null,
    valor_aluguel: round2(num($('imovAluguel').value)),
    taxa_administracao_pct: num($('imovTaxa').value),
    dia_vencimento: $('imovDia').value ? Number($('imovDia').value) : null,
    ativo: $('imovAtivo').value === 'true',
  };
  if (!reg.nome) return toast('Informe o nome do imóvel.', 'error');
  try {
    const id = $('imovId').value;
    if (id) await q(sb.from('imoveis').update(reg).eq('id', id));
    else await q(sb.from('imoveis').insert(reg));
    toast('Imóvel salvo.');
    limparImovForm();
    await carregarCadastros(); preencherSelects();
    await renderImoveis();
  } catch (e) { falha(e); }
});

function renderImoveis() {
  if (!st.imoveis.length) { $('imovLista').innerHTML = '<div class="empty">Nenhum imóvel cadastrado.</div>'; return; }
  let total = 0, liquido = 0;
  const linhas = st.imoveis.map((im) => {
    const taxa = round2(num(im.valor_aluguel) * num(im.taxa_administracao_pct) / 100);
    if (im.ativo) { total += num(im.valor_aluguel); liquido += num(im.valor_aluguel) - taxa; }
    return `<tr>
      <td class="num" style="text-align:center;font-weight:700;color:var(--primary)">${im.codigo ?? ''}</td>
      <td>${esc(im.nome)}${im.endereco ? `<div style="color:var(--muted);font-size:12px">${esc(im.endereco)}</div>` : ''}</td>
      <td class="hide-mobile">${esc(im.inquilino || '')}</td>
      <td class="num">${brl(im.valor_aluguel)}</td>
      <td class="num hide-mobile">${num(im.taxa_administracao_pct).toLocaleString('pt-BR')}%</td>
      <td class="num">${brl(num(im.valor_aluguel) - taxa)}</td>
      <td class="hide-mobile">${im.dia_vencimento ? 'Dia ' + im.dia_vencimento : ''}</td>
      <td>${im.ativo ? '<span class="tag realizado">Ativo</span>' : '<span class="tag inativo">Inativo</span>'}</td>
      <td class="actions"><button class="small" data-acao="editar" data-id="${im.id}">Editar</button>
        <button class="small danger" data-acao="excluir" data-id="${im.id}">Excluir</button></td></tr>`;
  }).join('');
  $('imovLista').innerHTML = `<table><thead><tr><th style="text-align:center">ID</th><th>Imóvel</th><th class="hide-mobile">Inquilino</th><th class="num">Aluguel</th>
    <th class="num hide-mobile">Taxa adm.</th><th class="num">Líquido</th><th class="hide-mobile">Vencimento</th><th>Situação</th><th></th></tr></thead>
    <tbody>${linhas}</tbody><tfoot><tr><td colspan="3">Total mensal (ativos)</td><td class="num">${brl(total)}</td>
    <td class="hide-mobile"></td><td class="num">${brl(liquido)}</td><td colspan="3"></td></tr></tfoot></table>`;
}

$('imovLista').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-acao]');
  if (!b) return;
  const im = st.imoveis.find((x) => x.id === b.dataset.id);
  if (!im) return;
  if (b.dataset.acao === 'editar') {
    $('imovId').value = im.id;
    $('imovCodigo').value = im.codigo ?? '';
    $('imovNome').value = im.nome;
    $('imovEndereco').value = im.endereco || '';
    $('imovInquilino').value = im.inquilino || '';
    $('imovAluguel').value = im.valor_aluguel;
    $('imovTaxa').value = im.taxa_administracao_pct;
    $('imovDia').value = im.dia_vencimento || '';
    $('imovAtivo').value = String(im.ativo);
    $('imovFormTitulo').textContent = 'Editar imóvel';
    $('imovCancelar').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (b.dataset.acao === 'excluir') {
    if (!confirm(`Excluir o imóvel "${im.nome}"? Os lançamentos já feitos são mantidos, sem vínculo com o imóvel. Para manter o histórico por imóvel, prefira marcar como Inativo.`)) return;
    try {
      await q(sb.from('imoveis').delete().eq('id', im.id));
      toast('Imóvel excluído.');
      await carregarCadastros(); preencherSelects();
      renderImoveis();
    } catch (e) { falha(e); }
  }
});

// =====================================================================
// EMPRÉSTIMOS
// =====================================================================
function gerarParcelas(valor, taxaPct, n, sistema, primeiroVenc) {
  const i = sistema === 'manual' ? 0 : taxaPct / 100;
  const parcelas = [];
  let saldo = valor;
  const pmt = i > 0 ? valor * i / (1 - Math.pow(1 + i, -n)) : valor / n;
  const amortSac = valor / n;
  for (let k = 1; k <= n; k++) {
    const juros = round2(saldo * i);
    let amort = sistema === 'sac' ? round2(amortSac) : round2(pmt - juros);
    if (sistema === 'manual' || i === 0) amort = round2(valor / n);
    if (k === n) amort = round2(saldo); // ajusta arredondamento na última
    saldo = round2(saldo - amort);
    parcelas.push({
      numero: k,
      vencimento: somaMeses(primeiroVenc, k - 1),
      amortizacao: amort,
      juros,
      valor: round2(amort + juros),
      saldo_devedor: Math.max(saldo, 0),
    });
  }
  return parcelas;
}

$('empForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const emp = {
    credor: $('empCredor').value.trim(),
    descricao: $('empDescricao').value.trim() || null,
    valor_contratado: round2(num($('empValor').value)),
    taxa_juros_mensal_pct: num($('empTaxa').value),
    num_parcelas: Number($('empParcelas').value),
    sistema: $('empSistema').value,
    data_contratacao: $('empDataContr').value || null,
    primeiro_vencimento: $('empPrimeiroVenc').value,
  };
  const jaPagas = Math.max(0, Number($('empJaPagas').value) || 0);
  if (!emp.credor || emp.valor_contratado <= 0 || !emp.num_parcelas || !emp.primeiro_vencimento)
    return toast('Preencha credor, valor, parcelas e 1º vencimento.', 'error');
  if (jaPagas > emp.num_parcelas) return toast('Parcelas pagas maior que o total.', 'error');
  try {
    const [criado] = await q(sb.from('emprestimos').insert(emp).select());
    const parcelas = gerarParcelas(emp.valor_contratado, emp.taxa_juros_mensal_pct, emp.num_parcelas, emp.sistema, emp.primeiro_vencimento)
      .map((p) => ({ ...p, emprestimo_id: criado.id, pago: p.numero <= jaPagas,
        data_pagamento: p.numero <= jaPagas ? p.vencimento : null, valor_pago: p.numero <= jaPagas ? p.valor : null }));
    try {
      await q(sb.from('parcelas_emprestimo').insert(parcelas));
    } catch (e) {
      await sb.from('emprestimos').delete().eq('id', criado.id); // desfaz se as parcelas falharem
      throw e;
    }
    toast(`Empréstimo criado com ${parcelas.length} parcelas.`);
    $('empForm').reset();
    await renderEmprestimos();
    abrirDetalhe(criado.id);
  } catch (e) { falha(e); }
});

let empCache = [];
async function renderEmprestimos() {
  empCache = await q(sb.from('emprestimos').select('*, parcelas_emprestimo(valor, amortizacao, pago, vencimento)').order('created_at'));
  if (!empCache.length) { $('empLista').innerHTML = '<div class="empty">Nenhum empréstimo cadastrado.</div>'; return; }
  let totalSaldo = 0;
  const linhas = empCache.map((e) => {
    const ps = e.parcelas_emprestimo || [];
    const pagas = ps.filter((p) => p.pago).length;
    const saldo = ps.filter((p) => !p.pago).reduce((s, p) => s + num(p.amortizacao), 0);
    const proxima = ps.filter((p) => !p.pago).sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
    if (e.ativo) totalSaldo += saldo;
    const sistema = { price: 'Price', sac: 'SAC', manual: 'Sem juros' }[e.sistema];
    return `<tr>
      <td>${esc(e.credor)}${e.descricao ? `<div style="color:var(--muted);font-size:12px">${esc(e.descricao)}</div>` : ''}</td>
      <td class="num hide-mobile">${brl(e.valor_contratado)}</td>
      <td class="hide-mobile">${sistema} · ${num(e.taxa_juros_mensal_pct).toLocaleString('pt-BR')}% a.m.</td>
      <td>${pagas}/${ps.length}<div class="bar"><div style="width:${ps.length ? pagas / ps.length * 100 : 0}%"></div></div></td>
      <td>${proxima ? `${fmtData(proxima.vencimento)}<div style="font-size:12px">${brl(proxima.valor)}</div>` : '<span class="tag realizado">Quitado</span>'}</td>
      <td class="num despesa">${brl(saldo)}</td>
      <td class="actions"><button class="small" data-acao="parcelas" data-id="${e.id}">Parcelas</button>
        <button class="small danger" data-acao="excluir" data-id="${e.id}">Excluir</button></td></tr>`;
  }).join('');
  $('empLista').innerHTML = `<table><thead><tr><th>Credor</th><th class="num hide-mobile">Contratado</th><th class="hide-mobile">Condições</th>
    <th>Pagas</th><th>Próxima</th><th class="num">Saldo devedor</th><th></th></tr></thead><tbody>${linhas}</tbody>
    <tfoot><tr><td colspan="5">Saldo devedor total</td><td class="num despesa">${brl(totalSaldo)}</td><td></td></tr></tfoot></table>`;
  if (empDetalheId) await abrirDetalhe(empDetalheId);
}

$('empLista').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-acao]');
  if (!b) return;
  const e = empCache.find((x) => x.id === b.dataset.id);
  if (!e) return;
  if (b.dataset.acao === 'parcelas') return abrirDetalhe(e.id);
  if (b.dataset.acao === 'excluir') {
    if (!confirm(`Excluir o empréstimo de "${e.credor}" e todas as parcelas? Os pagamentos já lançados ficam em Lançamentos.`)) return;
    try {
      await q(sb.from('emprestimos').delete().eq('id', e.id));
      if (empDetalheId === e.id) fecharDetalhe();
      toast('Empréstimo excluído.');
      await renderEmprestimos();
    } catch (err) { falha(err); }
  }
});

let empDetalheId = null, parcelasCache = [];
async function abrirDetalhe(id) {
  empDetalheId = id;
  const e = empCache.find((x) => x.id === id);
  parcelasCache = await q(sb.from('parcelas_emprestimo').select('*').eq('emprestimo_id', id).order('numero'));
  $('empDetalheTitulo').textContent = `Parcelas · ${e ? e.credor : ''}`;
  const h = hoje();
  const linhas = parcelasCache.map((p) => `<tr class="${p.pago ? 'row-paga' : (p.vencimento < h ? 'row-atrasada' : '')}">
    <td>${p.numero}</td>
    <td class="${!p.pago && p.vencimento < h ? 'despesa' : ''}">${fmtData(p.vencimento)}</td>
    <td class="num">${brl(p.valor)}</td>
    <td class="num hide-mobile">${brl(p.amortizacao)}</td>
    <td class="num hide-mobile">${brl(p.juros)}</td>
    <td class="num hide-mobile">${brl(p.saldo_devedor)}</td>
    <td>${p.pago ? `<span class="tag realizado">Paga ${p.data_pagamento ? fmtData(p.data_pagamento) : ''}</span>`
      : `<span class="tag ${p.vencimento < h ? 'atrasada' : 'previsto'}">${p.vencimento < h ? 'Atrasada' : 'Em aberto'}</span>`}</td>
    <td class="actions">${p.pago ? `<button class="small" data-acao="desfazer" data-id="${p.id}">Desfazer</button>`
      : `<button class="small primary" data-acao="pagar" data-id="${p.id}">Pagar</button>`}</td></tr>`).join('');
  $('empParcelasLista').innerHTML = `<table><thead><tr><th>Nº</th><th>Vencimento</th><th class="num">Valor</th>
    <th class="num hide-mobile">Amortização</th><th class="num hide-mobile">Juros</th><th class="num hide-mobile">Saldo após</th>
    <th>Situação</th><th></th></tr></thead><tbody>${linhas}</tbody></table>`;
  $('empDetalhe').classList.remove('hidden');
}
function fecharDetalhe() { empDetalheId = null; $('empDetalhe').classList.add('hidden'); }
$('empFecharDetalhe').onclick = fecharDetalhe;

$('empParcelasLista').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-acao]');
  if (!b) return;
  const p = parcelasCache.find((x) => x.id === b.dataset.id);
  const e = empCache.find((x) => x.id === empDetalheId);
  if (!p || !e) return;
  b.disabled = true;
  try {
    if (b.dataset.acao === 'pagar') {
      const valorTxt = prompt(`Valor pago na parcela ${p.numero} (R$):`, String(p.valor).replace('.', ','));
      if (valorTxt === null) return;
      const valorPago = round2(num(valorTxt.replace(/\./g, '').replace(',', '.')));
      if (valorPago <= 0) return toast('Valor inválido.', 'error');
      const data = hoje();
      await q(sb.from('lancamentos').insert({
        data, tipo: 'despesa', valor: valorPago, situacao: 'realizado',
        descricao: `Parcela ${p.numero}/${parcelasCache.length} · ${e.credor}`,
        categoria_id: catPorNome('Empréstimos', 'despesa')?.id || null,
        conta_id: contaPadrao()?.id || null, parcela_id: p.id,
      }));
      await q(sb.from('parcelas_emprestimo').update({ pago: true, data_pagamento: data, valor_pago: valorPago }).eq('id', p.id));
      toast('Parcela paga e lançada como despesa.');
    } else if (b.dataset.acao === 'desfazer') {
      if (!confirm(`Desfazer o pagamento da parcela ${p.numero}? O lançamento de despesa vinculado será excluído.`)) return;
      await q(sb.from('lancamentos').delete().eq('parcela_id', p.id));
      await q(sb.from('parcelas_emprestimo').update({ pago: false, data_pagamento: null, valor_pago: null }).eq('id', p.id));
      toast('Pagamento desfeito.');
    }
    await renderEmprestimos();
  } catch (err) { falha(err); } finally { b.disabled = false; }
});

// =====================================================================
// CADASTROS
// =====================================================================
async function renderCadastros() {
  const lanc = await q(sb.from('lancamentos').select('conta_id, tipo, valor').eq('situacao', 'realizado'));
  const linhaCat = (c) => `<tr><td>${esc(c.nome)}</td>
    <td>${c.ativo ? '' : '<span class="tag inativo">Inativa</span>'}</td>
    <td class="actions"><button class="small" data-acao="toggle" data-id="${c.id}">${c.ativo ? 'Desativar' : 'Ativar'}</button></td></tr>`;
  const rec = st.categorias.filter((c) => c.tipo === 'receita');
  const desp = st.categorias.filter((c) => c.tipo === 'despesa');
  $('catLista').innerHTML = `<table><thead><tr><th colspan="3" class="receita">Receitas</th></tr></thead><tbody>${rec.map(linhaCat).join('')}</tbody>
    <thead><tr><th colspan="3" class="despesa">Despesas</th></tr></thead><tbody>${desp.map(linhaCat).join('')}</tbody></table>`;

  const tipos = { banco: 'Banco', cartao: 'Cartão', dinheiro: 'Dinheiro', investimento: 'Investimento', outro: 'Outro' };
  $('contaLista').innerHTML = !st.contas.length ? '<div class="empty">Nenhuma conta.</div>'
    : `<table><thead><tr><th>Conta</th><th>Tipo</th><th class="num">Saldo atual</th><th></th></tr></thead><tbody>
    ${st.contas.map((c) => {
      const mov = lanc.filter((l) => l.conta_id === c.id).reduce((s, l) => s + (l.tipo === 'receita' ? 1 : -1) * num(l.valor), 0);
      const saldo = num(c.saldo_inicial) + mov;
      return `<tr><td>${esc(c.nome)} ${c.ativo ? '' : '<span class="tag inativo">Inativa</span>'}</td><td>${tipos[c.tipo]}</td>
        <td class="num ${saldo >= 0 ? 'receita' : 'despesa'}">${brl(saldo)}</td>
        <td class="actions"><button class="small" data-acao="toggle" data-id="${c.id}">${c.ativo ? 'Desativar' : 'Ativar'}</button></td></tr>`;
    }).join('')}</tbody></table>
    <div style="color:var(--muted);font-size:12px;margin-top:8px">Saldo atual = saldo inicial + lançamentos realizados na conta.</div>`;
}

$('catForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const nome = $('catNome').value.trim();
  if (!nome) return;
  try {
    await q(sb.from('categorias').insert({ nome, tipo: $('catTipo').value }));
    $('catForm').reset();
    toast('Categoria adicionada.');
    await carregarCadastros(); preencherSelects(); await renderCadastros();
  } catch (e) { falha(e); }
});
$('contaForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const nome = $('contaNome').value.trim();
  if (!nome) return;
  try {
    await q(sb.from('contas').insert({ nome, tipo: $('contaTipo').value, saldo_inicial: round2(num($('contaSaldo').value)) }));
    $('contaForm').reset();
    toast('Conta adicionada.');
    await carregarCadastros(); preencherSelects(); await renderCadastros();
  } catch (e) { falha(e); }
});
async function toggleAtivo(tabela, lista, id) {
  const item = lista.find((x) => x.id === id);
  if (!item) return;
  try {
    await q(sb.from(tabela).update({ ativo: !item.ativo }).eq('id', id));
    await carregarCadastros(); preencherSelects(); await renderCadastros();
  } catch (e) { falha(e); }
}
$('catLista').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-acao="toggle"]');
  if (b) toggleAtivo('categorias', st.categorias, b.dataset.id);
});
$('contaLista').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-acao="toggle"]');
  if (b) toggleAtivo('contas', st.contas, b.dataset.id);
});
