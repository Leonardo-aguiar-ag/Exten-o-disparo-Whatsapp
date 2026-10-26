/* ============================================================
   CONTENT — v10.0
   - Web Worker anti-throttling
   - Detecção de "digitando..." do contato
   - Envio de texto puro
   ============================================================ */

if (!window.botListenerAdded) {
    window.botListenerAdded = true;
    let ID_DISPARO = 0;

    /* Web Worker anti-throttling */
    let botWorker = null;
    let sleepId = 0;
    const sleepCallbacks = new Map();

    try {
        const workerCode = `self.onmessage = (e) => { const d = e.data || {}; if (d.acao === 'sleep') { setTimeout(() => self.postMessage({ acao: 'done', id: d.id }), d.ms); } };`;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        botWorker = new Worker(URL.createObjectURL(blob));
        botWorker.onmessage = (e) => {
            if (e.data && e.data.acao === 'done') {
                const cb = sleepCallbacks.get(e.data.id);
                if (cb) { sleepCallbacks.delete(e.data.id); cb(); }
            }
        };
        botWorker.onerror = () => { botWorker = null; };
    } catch (e) { botWorker = null; }

    function sleep(ms) {
        if (botWorker) {
            return new Promise(resolve => {
                const id = ++sleepId;
                sleepCallbacks.set(id, resolve);
                botWorker.postMessage({ acao: 'sleep', ms, id });
            });
        }
        return new Promise(r => setTimeout(r, ms));
    }

    const dispatchState = {
        rodando: false, pausado: false, total: 0, enviados: 0,
        contadorLote: 0, fila: null, duplicatas: {}, warmUpLimite: null,
        ignoraDuplicatas: false, numeroConta: null
    };

    function sendMsg(msg) { try { chrome.runtime.sendMessage(msg); } catch (e) {} }

    /* CONEXÃO */
    let ultimoEstadoConectado = null;
    function verificarConexao() {
        try {
            const painel = document.querySelector('#pane-side, div[data-testid="chat-list"]');
            const qr = document.querySelector('[data-testid="qrcode"], canvas');
            const input = document.querySelector('footer div[contenteditable="true"]');
            let conectado = false, numero = "Número Oculto", nome = "Conta Autenticada";
            if ((painel || input) && !qr) {
                conectado = true;
                let rawNum = window.localStorage.getItem('last-wid-md') || window.localStorage.getItem('last-wid') || document.body.getAttribute('data-number') || "";
                numero = rawNum.replace(/[^0-9]/g, '');
                if (numero.length < 8) numero = "Número Oculto";
                let rawNome = window.localStorage.getItem('smb_business_name') || window.localStorage.getItem('pushname') || window.localStorage.getItem('name') || document.querySelector('header ._amkf')?.innerText || "";
                nome = rawNome.replace(/"/g, '').trim();
                if (!nome || nome === "undefined" || nome === "null") nome = "Conta Autenticada";
            }
            dispatchState.numeroConta = numero;
            sendMsg({ acao: "wa_status", info: { conectado, numero, nome } });
            if (conectado && ultimoEstadoConectado !== true) {
                ultimoEstadoConectado = true;
                sendMsg({ acao: "content_ready", numero, nome });
            } else if (!conectado) {
                ultimoEstadoConectado = false;
            }
        } catch (e) { sendMsg({ acao: "wa_status", info: { conectado: false } }); }
    }
    setInterval(verificarConexao, 2000);
    verificarConexao();

    /* RESPOSTAS + DIGITANDO */
    const respostasVistas = new Set();
    const digitandoVistos = new Map();

    function iniciarObserver() {
        const pane = document.querySelector('#pane-side');
        if (!pane) { setTimeout(iniciarObserver, 3000); return; }
        new MutationObserver(() => { checarRespostas(pane); checarDigitando(); })
            .observe(pane, { childList: true, subtree: true, characterData: true });
        checarRespostas(pane);
        checarDigitando();
    }
    setTimeout(iniciarObserver, 5000);

    function checarRespostas(pane) {
        try {
            pane.querySelectorAll('div[role="listitem"]').forEach(chat => {
                const badge = chat.querySelector('span[aria-label*="não lid"], span[aria-label*="unread"], [data-testid="icon-unread-count"]');
                if (!badge) return;
                const nomeEl = chat.querySelector('span[title]');
                const nome = nomeEl ? nomeEl.getAttribute('title') : '';
                const prevEl = chat.querySelector('span[dir="ltr"]:not([title])');
                const preview = prevEl ? prevEl.innerText : '';
                if (!nome) return;
                const chave = nome + '::' + preview.slice(0, 40);
                if (respostasVistas.has(chave)) return;
                respostasVistas.add(chave);
                sendMsg({ acao: "resposta_cliente", numero: nome, texto: preview });
            });
        } catch (e) {}
    }

    // Detecção de "digitando..." no chat aberto
    function checarDigitando() {
        try {
            const header = document.querySelector('header');
            if (!header) return;
            const txt = (header.innerText || '').toLowerCase();
            // WhatsApp mostra "digitando..." ou "typing..." no header do chat aberto
            const estaDigitando = txt.includes('digitando') || txt.includes('typing') || txt.includes('gravando') || txt.includes('recording');
            if (!estaDigitando) return;

            // Pega o nome do contato no header (primeiro span com title)
            const nomeEl = header.querySelector('span[title]');
            const nome = nomeEl ? nomeEl.getAttribute('title') : '';
            if (!nome) return;

            // Evita duplicar eventos a cada 2s — só manda 1x por minuto por contato
            const ultimo = digitandoVistos.get(nome) || 0;
            if (Date.now() - ultimo < 60000) return;
            digitandoVistos.set(nome, Date.now());
            sendMsg({ acao: "digitando_cliente", numero: nome });
        } catch (e) {}
    }

    /* LISTENER */
    chrome.runtime.onMessage.addListener((req) => {
        if (req.acao === "iniciar_disparo") iniciarDisparo(req.fila, req.duplicatas || {}, req.warmUpLimite, req.ignoraDuplicatas);
        else if (req.acao === "pausar") { dispatchState.pausado = !dispatchState.pausado; sendMsg({ acao: "dispatch_status", pausado: dispatchState.pausado }); }
        else if (req.acao === "pausar_auto") { dispatchState.pausado = true; sendMsg({ acao: "dispatch_status", pausado: true }); }
        else if (req.acao === "parar") { dispatchState.rodando = false; dispatchState.pausado = false; }
        else if (req.acao === "ping") verificarConexao();
    });

    /* SPINTAX */
    function processarSpintax(texto) {
        let regex = /{([^{}]*)}/g, match;
        while ((match = regex.exec(texto)) !== null) {
            const opcoes = match[1].split('|');
            texto = texto.replace(match[0], opcoes[Math.floor(Math.random() * opcoes.length)]);
            regex.lastIndex = 0;
        }
        return texto;
    }

    /* HELPERS */
    function detectarErroNumero() {
        const txt = document.body.innerText.toLowerCase();
        const padroes = ["url é inválido", "telefone compartilhado", "não existe no whatsapp",
            "phone number shared via url is invalid", "não é um número de telefone válido",
            "invalid phone number", "número de telefone inválido"];
        for (const p of padroes) if (txt.includes(p)) return true;
        return false;
    }
    function pressionarEnter(campo) {
        if (!campo) return false;
        try {
            campo.focus();
            const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
            campo.dispatchEvent(new KeyboardEvent('keydown', opts));
            campo.dispatchEvent(new KeyboardEvent('keypress', opts));
            campo.dispatchEvent(new KeyboardEvent('keyup', opts));
            return true;
        } catch (e) { return false; }
    }

    /* ENVIO */
    async function enviarMensagem(numero, texto) {
        ID_DISPARO++;
        const idAtual = ID_DISPARO;
        console.log("[BOT] 📤", numero);
        for (let k = 0; k < 3; k++) {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(150);
        }
        const link = document.createElement('a');
        link.href = `https://web.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(texto)}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        let box = null;
        for (let i = 0; i < 20; i++) {
            if (idAtual !== ID_DISPARO) return "CANCELADO";
            await sleep(1000);
            if (detectarErroNumero()) {
                for (let k = 0; k < 3; k++) { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(200); }
                document.querySelectorAll('button').forEach(b => { if (b.innerText && b.innerText.toLowerCase().trim() === 'ok') b.click(); });
                return "INVÁLIDO";
            }
            box = document.querySelector('footer div[contenteditable="true"]');
            if (box && box.innerText.trim().length > 0) break;
        }
        if (idAtual !== ID_DISPARO) return "CANCELADO";
        if (!box) return "TIMEOUT";
        await sleep(1000);
        if (!box.innerText.trim().length) {
            box.focus();
            await sleep(200);
            try { document.execCommand('insertText', false, texto); } catch (e) {}
            await sleep(300);
        }
        pressionarEnter(box);
        await sleep(1500);
        if (box.innerText.trim().length > 0) { pressionarEnter(box); await sleep(1500); }
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(300);
        console.log("[BOT] ✅", numero);
        return "OK";
    }

    /* LOOP */
    async function iniciarDisparo(fila, duplicatas, warmUpLimite, ignoraDuplicatas) {
        if (dispatchState.rodando) return;
        dispatchState.rodando = true;
        dispatchState.pausado = false;
        dispatchState.fila = fila;
        dispatchState.duplicatas = duplicatas || {};
        dispatchState.warmUpLimite = warmUpLimite;
        dispatchState.ignoraDuplicatas = !!ignoraDuplicatas;
        dispatchState.total = fila.lista.length;
        dispatchState.enviados = fila.indice || 0;
        dispatchState.contadorLote = 0;
        console.log("[BOT] Iniciado. Total:", fila.lista.length, "| Worker:", botWorker ? "ativo ✅" : "fallback ❌");

        for (let i = fila.indice || 0; i < fila.lista.length; i++) {
            if (!dispatchState.rodando) break;
            while (dispatchState.pausado && dispatchState.rodando) await sleep(1000);
            if (!dispatchState.rodando) break;
            if (dispatchState.warmUpLimite !== null && dispatchState.warmUpLimite <= 0) {
                dispatchState.rodando = false;
                sendMsg({ acao: "dispatch_concluido" });
                return;
            }
            const cliente = fila.lista[i];
            let numeroDestino = "", nomeCliente = "Cliente";
            if (cliente && typeof cliente === 'object') {
                numeroDestino = cliente.num || "";
                nomeCliente = cliente.nome || "Cliente";
            } else numeroDestino = cliente || "";

            if (!ignoraDuplicatas && dispatchState.duplicatas[numeroDestino]) {
                dispatchState.enviados++;
                sendMsg({ acao: "log_resultado", numero: numeroDestino, nome: nomeCliente, status: "DUPLICADO", mensagem: "(pulou)", enviados: dispatchState.enviados, total: dispatchState.total });
                await sleep(200);
                continue;
            }

            let scripts = fila.scripts;
            let variante = null;
            if (fila.tipo === 'ab' && fila.variantes && fila.atribuicoes) {
                variante = fila.atribuicoes[numeroDestino];
                const v = fila.variantes.find(x => x.id === variante);
                if (v) scripts = v.scripts;
            }
            const textoSorteado = scripts[Math.floor(Math.random() * scripts.length)];
            let textoFinal = processarSpintax(textoSorteado);
            const nomeFormatado = nomeCliente.charAt(0).toUpperCase() + nomeCliente.slice(1).toLowerCase();
            textoFinal = textoFinal.replace(/\[NOME\]/g, nomeFormatado);

            const status = await enviarMensagem(numeroDestino, textoFinal);
            dispatchState.enviados++;
            if (dispatchState.warmUpLimite !== null) dispatchState.warmUpLimite--;

            sendMsg({ acao: "log_resultado", numero: numeroDestino, nome: nomeCliente, status, mensagem: textoFinal, enviados: dispatchState.enviados, total: dispatchState.total, variante });
            sendMsg({ acao: "progresso_fila", indice: i + 1 });

            if (fila.config.pausaLoteAtiva && dispatchState.rodando && !dispatchState.pausado) {
                dispatchState.contadorLote++;
                if (dispatchState.contadorLote >= fila.config.qtdLote) {
                    dispatchState.contadorLote = 0;
                    dispatchState.pausado = true;
                    await sleep(fila.config.tempoLoteMin * 60 * 1000);
                    dispatchState.pausado = false;
                }
            }
            if (i < fila.lista.length - 1 && dispatchState.rodando && !dispatchState.pausado) {
                const delayMs = (Math.random() * (fila.config.max - fila.config.min) + fila.config.min) * 1000;
                await sleep(status === "OK" ? delayMs : 2000);
            }
        }
        dispatchState.rodando = false;
        dispatchState.pausado = false;
        sendMsg({ acao: "dispatch_concluido" });
    }
}