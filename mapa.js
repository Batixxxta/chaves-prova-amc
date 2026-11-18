// mapa.js — MOTOR do mapa de chaves de prova, em CANVAS.
//
// POR QUE EXISTE (16/11/2026, pedido dele por voz: "o site das chaves de prova esta ficando
// meio travado... tem que ficar mais fluido, isso e o mais importante"):
// o motor antigo era SVG. Medido com Playwright, com o mapa todo aberto (290 nos), arrastar
// rodava a 4 quadros por segundo (280 ms por quadro) e com 5x os dados congelava. Causa: a
// cada quadro o navegador re-rasterizava centenas de <text> girados com contorno, e a cada
// clique o innerHTML inteiro era refeito com medicao de texto no DOM.
//
// O QUE MUDA AQUI:
//   - desenho em Canvas 2D, so dentro de requestAnimationFrame e so quando algo mudou;
//   - CULLING: no fora da tela nao e desenhado;
//   - LOD: rotulo que ficaria menor que ~5 px na tela nao e desenhado (sobra a bolha);
//   - largura de rotulo por measureText com cache (zero reflow de DOM);
//   - fundo escuro atras do rotulo no lugar do contorno de texto (que e caro);
//   - clique por conta propria (hit-test no retangulo girado do rotulo).
//
// O MOTOR E SEPARADO DA PAGINA de proposito: mapa-chaves/index.html e so uma casca fina.
// Juntar com o estudo-amc num app so foi AVALIADO em 16/11 (ele pediu) e adiado para depois
// da prova, por conselho da Ana Bot e meu: o botao da questao ja abre o mapa em outra aba
// sem recarregar nada, e a fusao traria risco de hash/teclado/historico a 3 dias da prova.
// Quando for a hora, e so outra casca chamar criarMapa() — quem hospeda passa
// opts.irParaQuestao e opts.ativo.
//
// Uso: var mapa = window.criarMapa(elemento, { irParaQuestao: function(id){...},
//                                               ativo: function(){ return true; } });
(function () {
  "use strict";

  var CORES = ['#ffd166', '#4cc9f0', '#9d8cff', '#9ae6a0'];
  var TAM = [21, 17, 15, 13.5];
  var PESO = ['700', '600', '500', '400'];
  var FAMILIA = '"Segoe UI","Segoe UI Emoji",system-ui,-apple-system,sans-serif';
  var COR_FOCO = '#ffffff', COR_ALVO = '#ff5470', COR_LINHA = '#333333';
  var TAM_CONT = 11;
  var LOD_PX = 5;            // rotulo menor que isso na tela nao e desenhado
  var ESPACO_FOLHA = 34;     // px de perimetro reservados por folha visivel
  var ESC_MIN = 0.02, ESC_MAX = 4;

  var CSS = ''
    + '.mp{position:relative;width:100%;height:100%;background:#000;color:#e8e8e8;overflow:hidden;'
    + 'font-family:"Segoe UI",system-ui,-apple-system,sans-serif}'
    + '.mp-palco{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}'
    + '.mp-palco.arrastando{cursor:grabbing}.mp-palco.sobre{cursor:pointer}'
    + '.mp-rodape{position:absolute;left:14px;bottom:12px;font-size:12px;color:#6a6a6a;pointer-events:none;letter-spacing:.3px}'
    + '.mp-painel{position:absolute;right:14px;bottom:12px;width:min(460px,46vw);max-height:calc(100% - 90px);overflow:auto;z-index:12;'
    + 'background:rgba(12,12,12,.96);border:1px solid #2a2a2a;border-radius:12px;padding:12px 15px;display:none}'
    + '.mp-painel.on{display:block}'
    + '.mp-painel .txt{font-size:14.5px;line-height:1.45;color:#eee;font-weight:600;padding-right:22px}'
    + '.mp-painel .via{font-size:11.5px;color:#777;margin-top:3px}'
    + '.mp-painel .x{position:absolute;top:6px;right:8px;background:none;border:none;color:#888;font-size:18px;cursor:pointer;padding:4px 6px}'
    + '.mp-painel .x:hover{color:#fff}'
    + '.mp-painel a.irq{display:inline-block;margin:9px 6px 0 0;font-size:12.5px;color:#111;background:#9ae6a0;border-radius:999px;'
    + 'padding:5px 12px;text-decoration:none;font-weight:600;cursor:pointer}'
    + '.mp-painel a.irq:hover{filter:brightness(1.12)}'
    + '.mp-painel h4{margin:14px 0 6px;font-size:13px;color:#ffd166;font-weight:700;letter-spacing:.2px}'
    + '.mp-painel .qid{margin-top:12px;font-size:11px;color:#666;border-top:1px dashed #2a2a2a;padding-top:8px}'
    + '.mp-painel .par{font-size:13px;line-height:1.5;margin:5px 0;color:#ddd}'
    + '.mp-painel .par b{color:#9ae6a0;font-weight:600}'
    + '.mp-painel .ml{font-size:13px;line-height:1.5;margin:3px 0;color:#ccc}'
    + '.mp-painel .ml b{color:#4cc9f0;font-weight:600}'
    + '.mp-ajuda{position:absolute;inset:0;background:rgba(0,0,0,.93);display:none;align-items:center;justify-content:center;z-index:20}'
    + '.mp-ajuda.on{display:flex}'
    + '.mp-ajuda .caixa{max-width:620px;padding:28px 34px;border:1px solid #333;border-radius:12px}'
    + '.mp-ajuda h2{margin:0 0 18px;font-size:19px;color:#ffd166;font-weight:600}'
    + '.mp-ajuda table{border-collapse:collapse;width:100%}'
    + '.mp-ajuda td{padding:5px 10px;font-size:14px;vertical-align:top;color:#e8e8e8;border:none}'
    + '.mp-ajuda td:first-child{color:#4cc9f0;font-family:ui-monospace,Consolas,monospace;white-space:nowrap;width:1%}'
    + '.mp-busca{position:absolute;top:0;left:0;right:0;background:#111;border-bottom:1px solid #333;padding:12px 16px;display:none;z-index:15}'
    + '.mp-busca.on{display:block}'
    + '.mp-busca input{width:100%;background:transparent;border:none;outline:none;color:#e8e8e8;font-size:17px;font-family:inherit}'
    + '.mp-achados{max-height:40vh;overflow:auto;margin-top:8px}'
    + '.mp-achados div{padding:6px 4px;font-size:14px;cursor:pointer;color:#bbb}'
    + '.mp-achados div.sel{background:#1e1e1e;color:#fff}'
    + '.mp-achados small{color:#777;margin-left:8px}'
    + '.mp-rodape .cel{display:none}'
    + '.mp-bussola{position:absolute;top:12px;right:12px;z-index:13;display:none;width:46px;height:46px;border-radius:50%;'
    + 'border:1px solid #444;background:rgba(20,20,20,.92);font-size:24px;cursor:pointer;padding:0}'
    + '.mp-bussola.on{display:block}'
    // CELULAR (pedido dele 18/11): painel vira folha de baixo, rodape curto, ajuda rola
    + '@media (max-width:700px){'
    + '.mp-painel{left:8px;right:8px;bottom:8px;width:auto;max-height:46%;padding:12px 14px}'
    + '.mp-painel .x{font-size:24px;padding:6px 10px}'
    + '.mp-painel a.irq{font-size:14px;padding:8px 14px}'
    + '.mp-rodape{left:10px;right:10px;bottom:8px;font-size:11px}'
    + '.mp-rodape .pc{display:none}.mp-rodape .cel{display:inline}'
    + '.mp-ajuda{align-items:flex-start;overflow:auto}.mp-ajuda .caixa{padding:18px 16px;margin:10px}'
    + '.mp-ajuda td{font-size:13px}'
    + '}';

  var HTML = ''
    + '<canvas class="mp-palco"></canvas>'
    + '<div class="mp-rodape"><span class="pc">? atalhos · clique abre o ramo · arraste move · roda/W/S zoom · / busca · ◌ anel = escrita pela Mari</span>'
    + '<span class="cel">toque abre o ramo · arraste move · dois dedos = zoom e giro · ◌ = escrita pela Mari</span></div>'
    + '<button class="mp-bussola" title="endireitar o mapa">🧭</button>'
    + '<div class="mp-painel"></div>'
    + '<div class="mp-busca"><input placeholder="buscar chave..." autocomplete="off"><div class="mp-achados"></div></div>'
    + '<div class="mp-ajuda"><div class="caixa"><h2>Atalhos</h2><table>'
    + '<tr><td>setas</td><td>mover a visão</td></tr>'
    + '<tr><td>W / S</td><td>aproximar / afastar</td></tr>'
    + '<tr><td>roda do mouse</td><td>zoom no ponteiro</td></tr>'
    + '<tr><td>clique / Espaço</td><td>expandir ou colapsar o ramo</td></tr>'
    + '<tr><td>Tab / Shift+Tab</td><td>próximo / anterior irmão</td></tr>'
    + '<tr><td>F</td><td>enquadrar o mapa inteiro</td></tr>'
    + '<tr><td>R</td><td>voltar ao centro, zoom 100%</td></tr>'
    + '<tr><td>E / C</td><td>expandir tudo / colapsar tudo</td></tr>'
    + '<tr><td>/</td><td>buscar chave (Enter navega até ela)</td></tr>'
    + '<tr><td>Q</td><td>abrir a questão da chave focada</td></tr>'
    + '<tr><td>Esc</td><td>fecha busca, painel ou esta ajuda</td></tr>'
    + '<tr><td>&#9711; anel</td><td>chave escrita pela Mari (o recall não tinha gabarito válido)</td></tr>'
    + '<tr><td>?</td><td>mostra esta lista</td></tr>'
    + '</table></div></div>';

  function escapar(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
  }
  function semAcento(s) {
    return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
  }

  window.criarMapa = function (el, opts) {
    opts = opts || {};
    var DADOS = (window.CHAVES || []).slice();
    var POR_QUESTAO = window.POR_QUESTAO || {};
    var RESUMOS = window.RESUMOS_CHAVE || {};

    if (!document.getElementById('mp-css')) {
      var st = document.createElement('style'); st.id = 'mp-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    el.classList.add('mp');
    el.innerHTML = HTML;
    var canvas = el.querySelector('.mp-palco'), ctx = canvas.getContext('2d');
    var rodape = el.querySelector('.mp-rodape'), painel = el.querySelector('.mp-painel');
    var bussola = el.querySelector('.mp-bussola');
    // endireitar mantendo o centro da tela no mesmo ponto do mapa
    function endireitar() {
      if (!giro) return;
      var u = desgirar(LARG / 2, ALT / 2); giro = 0;
      deslocX += LARG / 2 - u.x; deslocY += ALT / 2 - u.y;
      atualizarBussola(); pedir();
    }
    function atualizarBussola() {
      if (!bussola) return;
      bussola.classList.toggle('on', !!giro);
      bussola.style.transform = 'rotate(' + giro + 'rad)';
    }
    if (bussola) bussola.addEventListener('click', endireitar);
    var busca = el.querySelector('.mp-busca'), campo = busca.querySelector('input');
    var achados = el.querySelector('.mp-achados'), ajuda = el.querySelector('.mp-ajuda');

    if (!DADOS.length) {
      // OneDrive com "arquivos sob demanda" pode deixar o chaves.js como placeholder: sem este
      // aviso a tela ficava preta e muda (alerta da CTI, 16/11).
      rodape.textContent = 'chaves.js não carregou — confira se a pasta está disponível neste dispositivo';
      rodape.style.color = '#ff5470';
      return null;
    }

    // ---------------------------------------------------------------- modelo
    var porId = Object.create(null), raiz = null, todosNos = [];
    DADOS.forEach(function (n) {
      var no = {id: n.id, texto: n.texto, nivel: n.nivel, pai: n.pai, q: (n.q || []).slice(),
                autor: n.autor || null, filhos: [], aberto: false,
                rotulo: (n.emoji ? n.emoji + ' ' : '') + n.texto,
                w: -1, wb: -1, wc: 0, x: 0, y: 0, ang: 0, r: 0, totalFolhas: 1, _folhasVis: 1};
      no.busca = semAcento(n.texto.toLowerCase());
      porId[n.id] = no; todosNos.push(no);
    });
    todosNos.forEach(function (no) {
      if (no.pai && porId[no.pai]) porId[no.pai].filhos.push(no); else raiz = no;
    });
    raiz.aberto = true;
    (function conta(n) {
      if (!n.filhos.length) { n.totalFolhas = 1; return 1; }
      var t = 0; n.filhos.forEach(function (f) { t += conta(f); });
      n.totalFolhas = t; return t;
    })(raiz);

    var giro = 0, escala = 1, deslocX = 0, deslocY = 0, focado = raiz, alvos = {};
    var vis = [], porNivel = [[], [], [], []];
    var larguraNivel = [0, 0, 0, 0];
    var LARG = 0, ALT = 0, DPR = 1;
    var sujo = false, quadros = 0, ultimoMs = 0, painelFechado = false;

    function fonte(nivel, forte) {
      return (forte ? '700' : PESO[nivel] || '400') + ' ' + (TAM[nivel] || 13.5) + 'px ' + FAMILIA;
    }
    function raioBolha(n) { return n.nivel === 0 ? 10 : (n.filhos.length ? 6 : 4); }

    // Largura do rotulo: medida UMA vez por no no canvas e guardada. Era a parte mais cara do
    // motor antigo (getComputedTextLength no DOM a cada clique, para todos os nos).
    function medir(n) {
      if (n.w >= 0) return;
      ctx.font = fonte(n.nivel, false);
      n.w = ctx.measureText(n.rotulo).width;
      // o no focado/alvo e desenhado em negrito e fica mais largo: mede as duas (Ana Bot, 16/11)
      ctx.font = fonte(n.nivel, true);
      n.wb = ctx.measureText(n.rotulo).width;
      if (n.filhos.length && n.nivel > 0) {
        ctx.font = TAM_CONT + 'px ' + FAMILIA;
        n.wc = ctx.measureText(String(n.totalFolhas)).width + 8;
      }
    }

    // ------------------------------------------------------------- layout RADIAL
    // Mesmo desenho que ele aprovou em 16/11 ("circular, saindo para todos os lados, 360"):
    // setor angular proporcional as folhas visiveis + piso de arco, raio por nivel, e cada
    // anel longe o bastante do anterior para o MAIOR rotulo daquele nivel caber no vao.
    function calcular() {
      vis = []; porNivel = [[], [], [], []];
      (function anda(n) {
        medir(n);
        vis.push(n); (porNivel[n.nivel] || (porNivel[n.nivel] = [])).push(n);
        if (n.aberto) for (var i = 0; i < n.filhos.length; i++) anda(n.filhos[i]);
      })(raiz);
      (function prep(n) {
        if (!n.aberto || !n.filhos.length) { n._folhasVis = 1; return 1; }
        var t = 0; for (var i = 0; i < n.filhos.length; i++) t += prep(n.filhos[i]);
        n._folhasVis = t; return t;
      })(raiz);

      for (var i = 0; i < vis.length; i++) {
        var v = vis[i], larg = v.wb + (v.filhos.length && !v.aberto ? v.wc : 0);
        // so cresce: encolher a cada clique faria o mapa pular de tamanho sem parar
        if (v.nivel > 0 && larg > larguraNivel[v.nivel]) larguraNivel[v.nivel] = larg;
      }
      // o titulo do centro fica CENTRALIZADO embaixo da bolha: o primeiro anel precisa passar
      // da metade da largura dele, senao o titulo encosta no no que cair na horizontal
      larguraNivel[0] = raiz.wb / 2 + 12;
      var total = raiz._folhasVis;
      var rFolha = Math.max(300, (total * ESPACO_FOLHA) / (2 * Math.PI));
      var raios = [0, rFolha * 0.34, rFolha * 0.64, rFolha];
      var FOLGA = 26;
      for (var k = 1; k <= 3; k++) {
        var minimo = raios[k - 1] + (larguraNivel[k - 1] || 0) + FOLGA;
        if (raios[k] < minimo) raios[k] = minimo;
      }
      raiz.ang = 0; raiz.x = 0; raiz.y = 0; raiz.r = 0;
      (function espalhar(n, de, ate) {
        if (!n.aberto || !n.filhos.length) return;
        var PISO = 2.5, soma = 0, i, f;
        for (i = 0; i < n.filhos.length; i++) { f = n.filhos[i]; f._peso = f._folhasVis + PISO; soma += f._peso; }
        var a = de;
        for (i = 0; i < n.filhos.length; i++) {
          f = n.filhos[i];
          var fatia = (ate - de) * (f._peso / soma);
          f.ang = a + fatia / 2;
          f.r = raios[f.nivel] != null ? raios[f.nivel] : f.nivel * rFolha / 3;
          f.x = Math.cos(f.ang) * f.r;
          f.y = Math.sin(f.ang) * f.r;
          espalhar(f, a, a + fatia);
          a += fatia;
        }
      })(raiz, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI);
    }

    // Geometria do rotulo de um no, em coordenadas LOCAIS do no (ja giradas): usada pelo
    // desenho, pelo clique e pelo teste — uma fonte so, para os tres nunca discordarem.
    function geo(n) {
      var r = raioBolha(n), h = (TAM[n.nivel] || 13.5) * 1.25;
      var w = (n === focado || alvos[n.id]) ? n.wb : n.w;
      if (n.nivel === 0) return {giro: 0, x0: -w / 2, x1: w / 2, y0: 26 - h / 2, y1: 26 + h / 2, raiz: true, r: r};
      var esq = Math.cos(n.ang) < 0;
      var larg = w + (n.filhos.length && !n.aberto ? n.wc : 0);
      var ini = r + 9;
      return {giro: n.ang + (esq ? Math.PI : 0), esq: esq, r: r,
              x0: esq ? -(ini + larg) : ini, x1: esq ? -ini : ini + larg, y0: -h / 2, y1: h / 2};
    }
    function textoVisivel(n) {
      return (TAM[n.nivel] || 13.5) * escala >= LOD_PX || n === focado || !!alvos[n.id];
    }

    // ---------------------------------------------------------------- desenho
    function ajustarTamanho() {
      var w = el.clientWidth, h = el.clientHeight, d = Math.min(2, window.devicePixelRatio || 1);   // teto 2: acima disso so custa (Ana Bot)
      if (w === LARG && h === ALT && d === DPR) return;
      LARG = w; ALT = h; DPR = d;
      canvas.width = Math.max(1, Math.round(w * d));
      canvas.height = Math.max(1, Math.round(h * d));
    }
    function pedir() {
      if (sujo) return;
      sujo = true;
      requestAnimationFrame(function () { sujo = false; desenhar(); });
    }
    // GIRO (pedido dele 18/11, dois dedos torcendo): a tela inteira gira em torno do centro.
    // Toda a logica antiga (zoom, clique, arrasto) continua em coordenadas "desgiradas".
    function por(a, b, c, d, e, f) {
      if (!giro) { ctx.setTransform(a, b, c, d, e, f); return; }
      var co = Math.cos(giro), si = Math.sin(giro), mx = DPR * LARG / 2, my = DPR * ALT / 2;
      ctx.setTransform(co, si, -si, co, mx - co * mx + si * my, my - si * mx - co * my);
      ctx.transform(a, b, c, d, e, f);
    }
    function desgirar(x, y) {           // ponto da tela -> ponto sem giro
      if (!giro) return {x: x, y: y};
      var co = Math.cos(-giro), si = Math.sin(-giro), mx = LARG / 2, my = ALT / 2, dx = x - mx, dy = y - my;
      return {x: mx + dx * co - dy * si, y: my + dx * si + dy * co};
    }
    function desenhar() {
      ajustarTamanho();
      if (!LARG || !ALT) return;       // escondido (aba de questoes na frente): nao gasta nada
      var t0 = performance.now();
      var s = DPR * escala, ox = DPR * deslocX, oy = DPR * deslocY;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);

      // janela visivel em coordenadas do mapa
      var vx0 = -deslocX / escala, vy0 = -deslocY / escala;
      var vx1 = (LARG - deslocX) / escala, vy1 = (ALT - deslocY) / escala;
      if (giro) {                        // girado: a janela vira o circulo que cobre a tela
        var raio = Math.hypot(LARG, ALT) / 2;
        vx0 = (LARG / 2 - raio - deslocX) / escala; vx1 = (LARG / 2 + raio - deslocX) / escala;
        vy0 = (ALT / 2 - raio - deslocY) / escala;  vy1 = (ALT / 2 + raio - deslocY) / escala;
      }
      var i, n, f, k;

      // ligacoes: um caminho so, um stroke so
      por(s, 0, 0, s, ox, oy);
      ctx.strokeStyle = COR_LINHA; ctx.lineWidth = Math.max(1.5, 1 / escala);
      ctx.beginPath();
      for (i = 0; i < vis.length; i++) {
        n = vis[i];
        if (!n.aberto) continue;
        var cn = Math.cos(n.ang), sn = Math.sin(n.ang);
        for (k = 0; k < n.filhos.length; k++) {
          f = n.filhos[k];
          var minX = n.x < f.x ? n.x : f.x, maxX = n.x > f.x ? n.x : f.x;
          var minY = n.y < f.y ? n.y : f.y, maxY = n.y > f.y ? n.y : f.y;
          var folga = (f.r - n.r);
          if (maxX + folga < vx0 || minX - folga > vx1 || maxY + folga < vy0 || minY - folga > vy1) continue;
          var rm = (n.r + f.r) / 2;
          ctx.moveTo(n.x, n.y);
          ctx.bezierCurveTo(cn * rm, sn * rm, Math.cos(f.ang) * rm, Math.sin(f.ang) * rm, f.x, f.y);
        }
      }
      ctx.stroke();

      // bolhas + rotulos, nivel por nivel. As BOLHAS de um nivel vao em lote (um caminho, um
      // fill, um stroke): com milhares de nos e o zoom la longe, e isso que segura o quadro.
      var especiais = [], naTela = [], aneis = [];
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      for (var nv = 0; nv < porNivel.length; nv++) {
        var lista = porNivel[nv]; if (!lista || !lista.length) continue;
        var cor = CORES[nv] || '#888', comTexto = (TAM[nv] || 13.5) * escala >= LOD_PX;
        naTela.length = 0;
        for (i = 0; i < lista.length; i++) {
          n = lista[i];
          var alcance = n.wb + n.wc + 40;
          if (n.x + alcance < vx0 || n.x - alcance > vx1 || n.y + alcance < vy0 || n.y - alcance > vy1) continue;
          if (n === focado || alvos[n.id]) { especiais.push(n); continue; }
          naTela.push(n);
          if (n.autor === 'mari') aneis.push(n);
        }
        if (!naTela.length) continue;
        por(s, 0, 0, s, ox, oy);
        ctx.strokeStyle = cor; ctx.lineWidth = 2;
        for (var passo = 0; passo < 2; passo++) {     // 0 = fechados com filhos (cheios), 1 = o resto (ocos)
          ctx.beginPath();
          for (i = 0; i < naTela.length; i++) {
            n = naTela[i];
            var cheio = n.filhos.length && !n.aberto;
            if ((passo === 0) !== !!cheio) continue;
            var rb = raioBolha(n);
            ctx.moveTo(n.x + rb, n.y); ctx.arc(n.x, n.y, rb, 0, 6.2832);
          }
          ctx.fillStyle = passo === 0 ? cor : '#000';
          ctx.fill(); ctx.stroke();
        }
        if (comTexto) {
          ctx.font = fonte(nv, false);
          for (i = 0; i < naTela.length; i++) rotulo(naTela[i], cor, s, ox, oy);
        }
      }
      if (aneis.length && 4 * escala >= 1.2) {
        por(s, 0, 0, s, ox, oy);
        ctx.beginPath();
        for (i = 0; i < aneis.length; i++) {
          n = aneis[i]; var ra = raioBolha(n) + 4.5;
          ctx.moveTo(n.x + ra, n.y); ctx.arc(n.x, n.y, ra, 0, 6.2832);
        }
        ctx.setLineDash([2.5, 2.5]); ctx.strokeStyle = 'rgba(255,209,102,.85)'; ctx.lineWidth = 1.4;
        ctx.stroke(); ctx.setLineDash([]);
      }
      // contadores (fonte unica)
      if (TAM_CONT * escala >= LOD_PX - 1) {
        ctx.font = TAM_CONT + 'px ' + FAMILIA; ctx.fillStyle = '#8a8a8a';
        for (i = 0; i < vis.length; i++) {
          n = vis[i];
          if (!n.filhos.length || n.aberto || n.nivel === 0) continue;
          if (n.x + 600 < vx0 || n.x - 600 > vx1 || n.y + 600 < vy0 || n.y - 600 > vy1) continue;
          var g = geo(n);
          girar(n, g.giro, s, ox, oy);
          ctx.fillStyle = '#8a8a8a';
          ctx.fillText(String(n.totalFolhas), g.esq ? g.x0 : g.x1 - n.wc + 8, 0);
        }
      }
      // focado e alvos por ultimo, por cima, sempre com texto
      for (i = 0; i < especiais.length; i++) {
        n = especiais[i];
        var c2 = alvos[n.id] ? COR_ALVO : COR_FOCO;
        ctx.font = fonte(n.nivel, true);
        bolha(n, alvos[n.id] ? COR_ALVO : (CORES[n.nivel] || '#888'), c2, s, ox, oy, true);
        rotulo(n, c2, s, ox, oy);
      }
      quadros++; ultimoMs = performance.now() - t0;
    }
    function girar(n, giro, s, ox, oy) {
      var c = Math.cos(giro) * s, se = Math.sin(giro) * s;
      por(c, se, -se, c, n.x * s + ox, n.y * s + oy);
    }
    function bolha(n, corFundo, corBorda, s, ox, oy, forte) {
      var r = raioBolha(n);
      por(s, 0, 0, s, n.x * s + ox, n.y * s + oy);
      if (n.autor === 'mari') {
        ctx.beginPath(); ctx.arc(0, 0, r + 4.5, 0, 6.2832);
        ctx.setLineDash([2.5, 2.5]); ctx.strokeStyle = 'rgba(255,209,102,.85)'; ctx.lineWidth = 1.4;
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832);
      ctx.fillStyle = (forte && alvos[n.id]) ? COR_ALVO : (n.filhos.length && !n.aberto ? corFundo : '#000');
      ctx.fill();
      ctx.strokeStyle = corBorda; ctx.lineWidth = forte ? 3 : 2; ctx.stroke();
    }
    function rotulo(n, cor, s, ox, oy) {
      var g = geo(n);
      girar(n, g.giro, s, ox, oy);
      // fundo escuro no lugar do contorno de texto: da a mesma legibilidade por cima das
      // linhas e custa um fillRect, em vez de um strokeText por rotulo
      ctx.fillStyle = 'rgba(0,0,0,.82)';
      ctx.fillRect(g.x0 - 3, g.y0, (g.x1 - g.x0) + 6, g.y1 - g.y0);
      ctx.fillStyle = cor;
      if (g.raiz) ctx.fillText(n.rotulo, g.x0, 26);
      else ctx.fillText(n.rotulo, g.esq ? g.x0 + (n.filhos.length && !n.aberto ? n.wc : 0) : g.x0, 0);
    }

    function redesenhar() { calcular(); mostrarPainel(); pedir(); }

    // ---------------------------------------------------------------- clique
    function noEm(px, py) {
      var wx = (px - deslocX) / escala, wy = (py - deslocY) / escala;
      var tol = 6 / escala;                    // 6 px de TELA em qualquer zoom (Ana Bot, 16/11)
      for (var i = vis.length - 1; i >= 0; i--) {
        var n = vis[i], dx = wx - n.x, dy = wy - n.y, r = raioBolha(n) + tol;
        if (dx * dx + dy * dy <= r * r) return n;
        if (!textoVisivel(n)) continue;
        var alcance = n.wb + n.wc + 40;
        if (dx > alcance || dx < -alcance || dy > alcance || dy < -alcance) continue;
        var g = geo(n), c = Math.cos(-g.giro), s = Math.sin(-g.giro);
        var lx = dx * c - dy * s, ly = dx * s + dy * c;
        if (lx >= g.x0 - 3 && lx <= g.x1 + 3 && ly >= g.y0 - 2 && ly <= g.y1 + 2) return n;
      }
      return null;
    }
    function posCanvas(e) {
      var r = canvas.getBoundingClientRect();
      return desgirar(e.clientX - r.left, e.clientY - r.top);
    }

    var LIMIAR = 5, arrastando = false, houveArrasto = false, ultX = 0, ultY = 0, iniX = 0, iniY = 0;
    // PINCA (celular, 18/11): com dois dedos na tela o gesto vira zoom, nunca toque
    var dedos = {}, pinca = null;
    function distDedos() {
      var k = Object.keys(dedos); if (k.length < 2) return null;
      var a = dedos[k[0]], b = dedos[k[1]];
      return {d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
              ang: Math.atan2(b.y - a.y, b.x - a.x)};
    }
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.pointerType === 'touch') {
        var r0 = canvas.getBoundingClientRect();
        dedos[e.pointerId] = {x: e.clientX - r0.left, y: e.clientY - r0.top};
        if (Object.keys(dedos).length >= 2) { pinca = distDedos(); houveArrasto = true; return; }
      }
      LIMIAR = e.pointerType === 'touch' ? 10 : 5;
      arrastando = true; houveArrasto = false;
      ultX = iniX = e.clientX; ultY = iniY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      canvas.classList.add('arrastando');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (dedos[e.pointerId]) {
        var r1 = canvas.getBoundingClientRect();
        dedos[e.pointerId] = {x: e.clientX - r1.left, y: e.clientY - r1.top};
        if (pinca) {
          var agora = distDedos();
          if (agora) {
            // o ponto do mapa embaixo dos dedos acompanha os dedos: move, aproxima e gira junto
            var u0 = desgirar(pinca.cx, pinca.cy);
            var wx = (u0.x - deslocX) / escala, wy = (u0.y - deslocY) / escala;
            var dAng = agora.ang - pinca.ang;
            if (dAng > Math.PI) dAng -= 2 * Math.PI; else if (dAng < -Math.PI) dAng += 2 * Math.PI;
            giro += dAng;
            escala = Math.min(ESC_MAX, Math.max(ESC_MIN, escala * agora.d / pinca.d));
            var u1 = desgirar(agora.cx, agora.cy);
            deslocX = u1.x - wx * escala; deslocY = u1.y - wy * escala;
            pinca = agora; atualizarBussola(); pedir();
          }
          return;
        }
      }
      if (!arrastando) {
        var p = posCanvas(e);
        canvas.classList.toggle('sobre', !!noEm(p.x, p.y));
        return;
      }
      if (Math.abs(e.clientX - iniX) > LIMIAR || Math.abs(e.clientY - iniY) > LIMIAR) houveArrasto = true;
      var ddx = e.clientX - ultX, ddy = e.clientY - ultY;
      if (giro) { var gc = Math.cos(-giro), gs = Math.sin(-giro), t = ddx * gc - ddy * gs; ddy = ddx * gs + ddy * gc; ddx = t; }
      deslocX += ddx; deslocY += ddy;
      ultX = e.clientX; ultY = e.clientY; pedir();
    });
    function soltar(e) {
      if (dedos[e.pointerId]) {
        delete dedos[e.pointerId];
        if (pinca) {
          if (Object.keys(dedos).length < 2) {
            pinca = null;
            // quase reto (menos de 4 graus) volta pro reto: evita mapa torto sem querer
            var g = Math.atan2(Math.sin(giro), Math.cos(giro));
            if (Math.abs(g) < 0.07) endireitar(); else giro = g;
            atualizarBussola();
          }
          // o dedo que sobrou continua arrastando de onde esta, sem pulo
          var k = Object.keys(dedos);
          if (k.length === 1) { var r2 = canvas.getBoundingClientRect(); ultX = dedos[k[0]].x + r2.left; ultY = dedos[k[0]].y + r2.top; }
          else { arrastando = false; canvas.classList.remove('arrastando'); }
          return;
        }
      }
      if (!arrastando) return;
      arrastando = false; canvas.classList.remove('arrastando');
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      if (houveArrasto || e.type === 'pointercancel') return;
      var p = posCanvas(e), n = noEm(p.x, p.y);
      if (!n) return;
      // o no clicado FICA ONDE ESTAVA na tela: sem isso, abrir um ramo redistribui o circulo
      // e o que voce acabou de clicar foge de baixo do ponteiro
      var sx = n.x * escala + deslocX, sy = n.y * escala + deslocY;
      focado = n; painelFechado = false;
      if (n.filhos.length) n.aberto = !n.aberto;
      calcular();
      deslocX = sx - n.x * escala; deslocY = sy - n.y * escala;
      mostrarPainel();
      // ...a nao ser que ele tenha ficado embaixo do painel que acabou de abrir
      var lu = largUtil();
      if (lu < LARG && sx > lu - 120) deslocX -= sx - (lu - 260);
      pedir();
    }
    canvas.addEventListener('pointerup', soltar);
    canvas.addEventListener('pointercancel', soltar);

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = posCanvas(e);
      zoomEm(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, {passive: false});

    function zoomEm(cx, cy, fator) {
      var novo = Math.min(ESC_MAX, Math.max(ESC_MIN, escala * fator));
      deslocX = cx - (cx - deslocX) * (novo / escala);
      deslocY = cy - (cy - deslocY) * (novo / escala);
      escala = novo; pedir();
    }

    // caixa do desenho inteiro, calculada da geometria (nao precisa de DOM)
    function caixaDe(lista) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      lista.forEach(function (n) {
        var g = geo(n), c = Math.cos(g.giro), s = Math.sin(g.giro);
        [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1], [0, 0]].forEach(function (p) {
          var x = n.x + p[0] * c - p[1] * s, y = n.y + p[0] * s + p[1] * c;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        });
      });
      return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
    }
    // Largura LIVRE: com o painel aberto, o que importa tem que caber a esquerda dele — no
    // primeiro screenshot do motor novo o painel abria por cima das chaves destacadas.
    function largUtil() {
      if (!painel.classList.contains('on')) return LARG;
      var u = LARG - painel.offsetWidth - 28;
      return u > LARG * 0.4 ? u : LARG;
    }
    function enquadrar(lista, teto) {
      ajustarTamanho();
      var cx = caixaDe(lista || vis);
      if (!isFinite(cx.w) || !LARG) return;
      var m = 60, lu = largUtil();
      escala = Math.min((lu - m * 2) / Math.max(cx.w, 1), (ALT - m * 2) / Math.max(cx.h, 1));
      escala = Math.min(teto || ESC_MAX, Math.max(ESC_MIN, escala));
      deslocX = (lu - cx.w * escala) / 2 - cx.x * escala;
      deslocY = (ALT - cx.h * escala) / 2 - cx.y * escala;
      pedir();
    }
    function centralizar(n) {
      ajustarTamanho();
      deslocX = largUtil() / 2 - n.x * escala; deslocY = ALT / 2 - n.y * escala; pedir();
    }
    function abrirCaminho(n) {
      var p = n.pai ? porId[n.pai] : null;
      while (p) { p.aberto = true; p = p.pai ? porId[p.pai] : null; }
    }

    // ------------------------------------------------- painel: chave + banca + mini-resumo
    // Pedido dele por voz (16/11): "eu quero que você adicione nas chaves de prova duas coisas:
    // como a banca diferencia e o mini resumo... porque isso é o que me faz associar as coisas
    // principais de cada questão pra eu decorar".
    var CAMPOS_MINI = [['🧬 Doença', 'doenca'], ['👤 Paciente clássico', 'paciente'],
      ['⚠️ Sintomas', 'sintomas'], ['🔎 Diagnóstico', 'diagnostico'],
      ['🧪 Laboratório/Imagem', 'exames'], ['💊 Tratamento', 'tratamento'],
      ['🚨 Complicações', 'complicacoes'], ['❌ Nunca faça', 'nunca'],
      ['🎯 Pegadinha AMC', 'pegadinha']];
    function vazio(v) { return v == null || v === '' || v === '-'; }
    function htmlResumo(idq, mostrarId) {
      var r = RESUMOS[idq]; if (!r) return '';
      var o = '';
      if (mostrarId) o += '<div class="qid">📄 Questão ' + escapar(idq) + '</div>';
      if (r.banca && r.banca.length) {
        o += '<h4>🎯 Como a banca diferencia</h4>';
        o += r.banca.map(function (b) {
          return '<div class="par">' + escapar(b[0]) + ' → <b>' + escapar(b[1]) + '</b></div>';
        }).join('');
      }
      if (r.mini) {
        var linhas = CAMPOS_MINI.filter(function (c) { return !vazio(r.mini[c[1]]); }).map(function (c) {
          return '<div class="ml"><b>' + c[0] + '</b> → ' + escapar(r.mini[c[1]]) + '</div>';
        }).join('');
        if (linhas) o += '<h4>📚 Mini-resumo</h4>' + linhas;
      }
      return o;
    }
    function mostrarPainel() {
      if (!focado || focado === raiz || painelFechado || !(focado.q || []).length && focado.nivel < 2) {
        painel.classList.remove('on'); painel.innerHTML = ''; return;
      }
      var qs = focado.q || [];
      var pai = focado.pai ? porId[focado.pai] : null;
      var html = '<button class="x" title="fechar (Esc)">×</button>'
               + '<div class="txt">' + (focado.nivel === 3 ? '🔑 ' : '📌 ') + escapar(focado.texto) + '</div>';
      if (pai) html += '<div class="via">' + escapar(pai.texto)
                     + (focado.autor === 'mari' ? ' · escrita pela Mari' : '') + '</div>';
      if (opts.irParaQuestao) html += qs.map(function (id) {
        return '<a class="irq" data-q="' + escapar(id) + '">📝 abrir a questão ' + escapar(id) + '</a>';
      }).join('');
      html += qs.map(function (id) { return htmlResumo(id, qs.length > 1); }).join('');
      painel.innerHTML = html;
      painel.scrollTop = 0;
      painel.classList.add('on');
    }
    painel.addEventListener('click', function (e) {
      if (e.target.closest('.x')) { painelFechado = true; mostrarPainel(); return; }
      var a = e.target.closest('a.irq');
      if (a && opts.irParaQuestao) { e.preventDefault(); opts.irParaQuestao(a.getAttribute('data-q')); }
    });

    // ---------------------------------------------------------------- busca
    var sel = 0, resultado = [];
    function abrirBusca() { busca.classList.add('on'); campo.value = ''; achados.innerHTML = ''; resultado = []; campo.focus(); }
    function fecharBusca() { busca.classList.remove('on'); campo.blur(); }
    campo.addEventListener('input', function () {
      var q = semAcento(campo.value.trim().toLowerCase());
      resultado = [];
      if (q) for (var i = 0; i < todosNos.length && resultado.length < 40; i++) {
        if (todosNos[i].busca.indexOf(q) >= 0) resultado.push(todosNos[i]);
      }
      sel = 0;
      achados.innerHTML = resultado.map(function (n, i) {
        var p = n.pai && porId[n.pai] ? porId[n.pai].texto : '';
        return '<div class="' + (i === 0 ? 'sel' : '') + '" data-i="' + i + '">' + escapar(n.texto)
             + '<small>' + escapar(p) + '</small></div>';
      }).join('');
    });
    achados.addEventListener('click', function (e) {
      var d = e.target.closest('div[data-i]'); if (d) irPara(resultado[+d.getAttribute('data-i')].id);
    });
    function irPara(id) {
      var n = porId[id]; if (!n) return;
      abrirCaminho(n); n.aberto = true; focado = n; painelFechado = false;
      fecharBusca(); calcular(); mostrarPainel();
      if (escala < 0.5) escala = 1;
      centralizar(n);
    }

    // ------------------------------------------------- abrir por QUESTAO
    function abrirQuestao(idq) {
      var ids = POR_QUESTAO[idq] || [];
      alvos = {};
      if (!ids.length) { redesenhar(); return false; }
      todosNos.forEach(function (n) { n.aberto = false; });
      raiz.aberto = true;
      var folhas = [], tema = null;
      ids.forEach(function (id) {
        var n = porId[id]; if (!n) return;
        alvos[id] = true;
        abrirCaminho(n);
        if (n.nivel === 3) folhas.push(n);
        if (n.nivel === 2) { n.aberto = true; tema = tema || n; }
      });
      // foca o TEMA: e nele que o painel mostra "como a banca diferencia" e o mini-resumo
      focado = tema || folhas[0] || porId[ids[0]] || raiz;
      painelFechado = false;
      calcular(); mostrarPainel();
      var marcados = Object.keys(alvos).map(function (id) { return porId[id]; }).filter(Boolean);
      enquadrar(marcados, 1.5);
      // folga: o enquadre justo cola o destaque na borda e esconde o contexto em volta
      zoomEm(largUtil() / 2, ALT / 2, 0.8);
      return true;
    }
    function limparAlvos() { alvos = {}; pedir(); }

    // ---------------------------------------------------------------- teclado
    function ativo() { return opts.ativo ? !!opts.ativo() : true; }
    window.addEventListener('keydown', function (e) {
      if (!ativo()) return;
      if (busca.classList.contains('on')) {
        if (e.key === 'Escape') { fecharBusca(); return; }
        if (e.key === 'Enter' && resultado[sel]) { irPara(resultado[sel].id); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          sel = Math.max(0, Math.min(resultado.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
          Array.prototype.forEach.call(achados.children, function (d, i) { d.className = i === sel ? 'sel' : ''; });
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      var passo = 70;
      switch (e.key) {
        case 'ArrowUp': deslocY += passo; pedir(); e.preventDefault(); break;
        case 'ArrowDown': deslocY -= passo; pedir(); e.preventDefault(); break;
        case 'ArrowLeft': deslocX += passo; pedir(); e.preventDefault(); break;
        case 'ArrowRight': deslocX -= passo; pedir(); e.preventDefault(); break;
        case 'w': case 'W': zoomEm(largUtil() / 2, ALT / 2, 1.18); break;
        case 's': case 'S': zoomEm(largUtil() / 2, ALT / 2, 1 / 1.18); break;
        case ' ':
          e.preventDefault();
          if (focado.filhos.length) { focado.aberto = !focado.aberto; redesenhar(); }
          break;
        case 'f': case 'F': enquadrar(); break;
        case 'r': case 'R': endireitar(); escala = 1; focado = raiz; alvos = {}; calcular(); mostrarPainel(); centralizar(raiz); break;
        case 'e': case 'E': todosNos.forEach(function (n) { n.aberto = true; }); calcular(); mostrarPainel(); enquadrar(); break;
        case 'c': case 'C':
          todosNos.forEach(function (n) { n.aberto = false; }); raiz.aberto = true; focado = raiz;
          calcular(); mostrarPainel(); enquadrar(); break;
        case 'q': case 'Q': {
          var qs = (focado && focado.q) || [];
          if (qs.length && opts.irParaQuestao) opts.irParaQuestao(qs[0]);
          break;
        }
        case '/': e.preventDefault(); abrirBusca(); break;
        case '?': ajuda.classList.toggle('on'); break;
        case 'Escape':
          if (ajuda.classList.contains('on')) ajuda.classList.remove('on');
          else if (painel.classList.contains('on')) { painelFechado = true; mostrarPainel(); }
          break;
        case 'Tab': {
          e.preventDefault();
          var p = focado.pai ? porId[focado.pai] : null; if (!p) break;
          var i = p.filhos.indexOf(focado);
          var j = (i + (e.shiftKey ? -1 : 1) + p.filhos.length) % p.filhos.length;
          focado = p.filhos[j]; painelFechado = false; mostrarPainel(); centralizar(focado); break;
        }
      }
    });
    ajuda.addEventListener('click', function () { ajuda.classList.remove('on'); });

    if (window.ResizeObserver) new ResizeObserver(function () { pedir(); }).observe(el);
    else window.addEventListener('resize', pedir);

    // ---------------------------------------------------------------- inicio
    raiz.filhos.forEach(function (n) { n.aberto = false; });
    calcular();
    var enquadrouUmaVez = false;
    function mostrar() {            // chamar quando o elemento passa a estar visivel
      ajustarTamanho();
      if (!enquadrouUmaVez && LARG) { enquadrouUmaVez = true; enquadrar(); }
      pedir();
    }
    mostrar();

    // Cantos do rotulo de um no NA TELA (retangulo girado real). E o que o teste usa para
    // provar que nada se sobrepoe: a mesma geometria que o desenho e o clique usam.
    function cantos(n) {
      var g = geo(n), c = Math.cos(g.giro), s = Math.sin(g.giro);
      return [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]].map(function (p) {
        return [(n.x + p[0] * c - p[1] * s) * escala + deslocX, (n.y + p[0] * s + p[1] * c) * escala + deslocY];
      });
    }

    return {
      porId: porId, raiz: raiz, total: DADOS.length, radial: true, motor: 'canvas',
      visiveis: function () { return vis.slice(); },
      angulos: function () { var o = {}; vis.forEach(function (n) { o[n.id] = n.ang; }); return o; },
      autores: function () { var t = 0; todosNos.forEach(function (n) { if (n.autor === 'mari') t++; }); return t; },
      comQuestao: function () { var t = 0; todosNos.forEach(function (n) { if (n.q.length) t++; }); return t; },
      porQuestao: POR_QUESTAO,
      abrirQuestao: abrirQuestao, limparAlvos: limparAlvos, mostrar: mostrar,
      enquadrar: function () { enquadrar(); }, irPara: irPara,
      alvos: function () { return Object.keys(alvos); },
      focado: function () { return focado && focado.id; },
      // --- para o teste
      telaDe: function (id) { var n = porId[id]; return n ? {x: n.x * escala + deslocX, y: n.y * escala + deslocY} : null; },
      cantos: function (id) { return porId[id] ? cantos(porId[id]) : null; },
      textoVisivel: function (id) { return porId[id] ? textoVisivel(porId[id]) : false; },
      estado: function () { return {escala: escala, x: deslocX, y: deslocY, larg: LARG, alt: ALT, quadros: quadros, ultimoMs: ultimoMs}; },
      desenharAgora: function () { calcular(); desenhar(); return ultimoMs; }
    };
  };
})();
